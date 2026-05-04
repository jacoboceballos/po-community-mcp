import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { FhirClientInstance } from "../fhir-client";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AppleWatchVitals {
  source: string;
  deviceModel: string;
  timestamp: string;
  lastSync: string;
  heartRate: { value: number; unit: string; status: string };
  restingHeartRate: { value: number; unit: string };
  heartRateVariability: { value: number; unit: string; status: string };
  bloodOxygen: { value: number; unit: string; status: string };
  ecgStatus: string;
  irregularRhythmNotification: boolean;
  respiratoryRate: { value: number; unit: string };
  steps: { value: number; unit: string; period: string };
  activeCalories: { value: number; unit: string };
  standHours: { value: number; unit: string };
  wristTemperature: { value: number; unit: string; baseline: number };
  bloodPressureEstimate?: { systolic: number; diastolic: number; note: string };
}

// ── Device Check ──────────────────────────────────────────────────────────────
// Checks the patient's Prompt Opinion documents for apple-watch-config.txt.
// Prompt Opinion only supports text/plain uploads, so the config is stored
// as a plain text file. In production this would check a real device registry.
// ─────────────────────────────────────────────────────────────────────────────

async function checkAppleWatchConnected(req: Request, patientId: string): Promise<boolean> {
  try {
    const bundle = await FhirClientInstance.search(req, "DocumentReference", [
      `subject=${patientId}`,
      "_count=50",
    ]);

    if (!bundle?.entry?.length) return false;

    for (const entry of bundle.entry) {
      const resource = entry.resource as any;

      // Check document title/description for apple-watch-config
      const title = (resource?.content?.[0]?.attachment?.title ?? "").toLowerCase();
      const description = (resource?.description ?? "").toLowerCase();

      const isWatchDoc =
        title.includes("apple-watch") ||
        title.includes("apple_watch") ||
        description.includes("apple-watch") ||
        description.includes("connectedwearable");

      if (isWatchDoc) {
        // Found the document — check its content for the flag
        const rawData = resource?.content?.[0]?.attachment?.data ?? "";
        if (rawData) {
          const decoded = Buffer.from(rawData, "base64").toString("utf-8");
          if (
            decoded.includes("connectedWearable: true") &&
            decoded.includes("healthKitConnected: true")
          ) {
            return true;
          }
        } else {
          // Document exists but content not inline — treat presence as confirmation
          return true;
        }
      }
    }

    return false;
  } catch {
    return false;
  }
}

// ── Mock Data Layer ───────────────────────────────────────────────────────────
// PRODUCTION SWAP: Replace this function body with:
//   const response = await fetch(`${HEALTHKIT_BACKEND_URL}/vitals/${patientId}`);
//   return await response.json();
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAppleWatchVitals(patientId: string): Promise<AppleWatchVitals> {
  const profiles: Record<string, Partial<AppleWatchVitals>> = {
    "high-risk": {
      heartRate: { value: 94, unit: "bpm", status: "Elevated" },
      restingHeartRate: { value: 81, unit: "bpm" },
      heartRateVariability: { value: 22, unit: "ms", status: "Low — may indicate cardiovascular stress" },
      bloodOxygen: { value: 95, unit: "%", status: "Borderline Low" },
      ecgStatus: "Sinus Tachycardia — Elevated rate detected",
      irregularRhythmNotification: true,
      respiratoryRate: { value: 18, unit: "breaths/min" },
      bloodPressureEstimate: {
        systolic: 158,
        diastolic: 92,
        note: "Estimate only — confirm with clinical measurement",
      },
    },
    "normal": {
      heartRate: { value: 68, unit: "bpm", status: "Normal" },
      restingHeartRate: { value: 62, unit: "bpm" },
      heartRateVariability: { value: 45, unit: "ms", status: "Normal" },
      bloodOxygen: { value: 98, unit: "%", status: "Normal" },
      ecgStatus: "Sinus Rhythm — No AFib detected",
      irregularRhythmNotification: false,
      respiratoryRate: { value: 14, unit: "breaths/min" },
    },
  };

  const isHighRisk =
    patientId.toLowerCase().includes("maria") ||
    patientId.toLowerCase().includes("cardiac");
  const profile = (isHighRisk ? profiles["high-risk"] : profiles["normal"]) ?? {};
  const heartRateJitter = Math.floor(Math.random() * 5) - 2;
  const now = new Date().toISOString();

  return {
    source: "Apple Health",
    deviceModel: "Apple Watch Series 9",
    timestamp: now,
    lastSync: now,
    heartRate: {
      value: (profile.heartRate?.value ?? 72) + heartRateJitter,
      unit: "bpm",
      status: profile.heartRate?.status ?? "Normal",
    },
    restingHeartRate: profile.restingHeartRate ?? { value: 65, unit: "bpm" },
    heartRateVariability: profile.heartRateVariability ?? { value: 40, unit: "ms", status: "Normal" },
    bloodOxygen: profile.bloodOxygen ?? { value: 98, unit: "%", status: "Normal" },
    ecgStatus: profile.ecgStatus ?? "Sinus Rhythm — No AFib detected",
    irregularRhythmNotification: profile.irregularRhythmNotification ?? false,
    respiratoryRate: profile.respiratoryRate ?? { value: 15, unit: "breaths/min" },
    steps: { value: Math.floor(Math.random() * 3000) + 500, unit: "steps", period: "today" },
    activeCalories: { value: Math.floor(Math.random() * 200) + 50, unit: "kcal" },
    standHours: { value: Math.floor(Math.random() * 5) + 2, unit: "hours" },
    wristTemperature: {
      value: Number((36.4 + Math.random() * 0.4).toFixed(1)),
      unit: "°C",
      baseline: 36.3,
    },
    ...(profile.bloodPressureEstimate && {
      bloodPressureEstimate: profile.bloodPressureEstimate,
    }),
  };
}

// ── MCP Tool ──────────────────────────────────────────────────────────────────

class AppleWatchVitalsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "GetAppleWatchVitals",
      {
        description:
          "Retrieves real-time vitals from the patient's connected Apple Watch via Apple HealthKit. First checks if the patient has an Apple Watch connected by looking for apple-watch-config.txt in their documents. If not connected, returns NO_DEVICE so the agent falls back to GetPatientVitals. Call this automatically when a patient reports any physical symptom.",
        inputSchema: {
          patientId: z
            .string()
            .describe("The id of the patient. Optional if patient context already exists.")
            .optional(),
        },
      },
      async ({ patientId }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
            "A patient id is required. Provide it as a parameter or ensure patient context exists.",
          );
        }

        // ── Step 1: Check if patient has Apple Watch connected ───────────────
        const isConnected = await checkAppleWatchConnected(req, patientId);

        if (!isConnected) {
          return McpUtilities.createTextResponse(
            JSON.stringify({
              status: "NO_DEVICE",
              message: "This patient does not have an Apple Watch connected to their account.",
              suggestion:
                "Use GetPatientVitals for the most recent clinically recorded measurements. " +
                "Patients can connect their Apple Watch during registration or through the patient portal.",
            }, null, 2),
          );
        }

        // ── Step 2: Fetch vitals ─────────────────────────────────────────────
        try {
          const vitals = await fetchAppleWatchVitals(patientId);

          const flags: string[] = [];
          if (vitals.irregularRhythmNotification) {
            flags.push("⚠️ IRREGULAR RHYTHM DETECTED — Review ECG data with cardiologist");
          }
          if (vitals.heartRate.value > 100) {
            flags.push("⚠️ TACHYCARDIA — Heart rate above 100 bpm");
          }
          if (vitals.heartRate.value < 50) {
            flags.push("⚠️ BRADYCARDIA — Heart rate below 50 bpm");
          }
          if (vitals.bloodOxygen.value < 95) {
            flags.push("⚠️ LOW BLOOD OXYGEN — SpO2 below 95%, monitor closely");
          }
          if (vitals.heartRateVariability.value < 25) {
            flags.push("⚠️ LOW HRV — May indicate cardiovascular stress or autonomic dysfunction");
          }

          return McpUtilities.createTextResponse(
            JSON.stringify({
              status: "CONNECTED",
              patientId,
              appleWatchVitals: vitals,
              clinicalFlags: flags,
              flagCount: flags.length,
              interpretation:
                flags.length > 0
                  ? "Wearable data contains clinical alerts — review flags before proceeding."
                  : "Wearable data within normal parameters.",
              disclaimer:
                "Apple Watch readings are supplementary data. All clinical decisions must be confirmed with calibrated medical-grade equipment.",
            }, null, 2),
          );
        } catch {
          return McpUtilities.createTextResponse(
            JSON.stringify({
              status: "SYNC_ERROR",
              error: "Unable to retrieve Apple Watch data.",
              reason: "Device may be offline, out of range, or not synced recently.",
              fallback: "Use GetPatientVitals for the most recent clinically recorded measurements.",
            }, null, 2),
          );
        }
      },
    );
  }
}

export const AppleWatchVitalsToolInstance = new AppleWatchVitalsTool();
