import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { FhirClientInstance } from "../fhir-client";
import { fhirR4 } from "@smile-cdr/fhirts";

// ── GetPatientMedications ─────────────────────────────────────
class PatientMedicationsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "GetPatientMedications",
      {
        description:
          "Gets current and historical medications for a patient including drug name, dosage, frequency, and status. Used by all three agents for medication context and reconciliation.",
        inputSchema: {
          patientId: z.string().describe("The id of the patient. Optional if patient context already exists.").optional(),
          statusFilter: z.enum(["active", "stopped", "all"]).describe("Filter by medication status. Defaults to 'all'.").optional(),
        },
      },
      async ({ patientId, statusFilter }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
            "A patient id is required. Provide it as a parameter or ensure patient context exists.",
          );
        }
        const searchParams = [`patient=${patientId}`, "_sort=-authoredon", "_count=50"];
        if (statusFilter && statusFilter !== "all") searchParams.push(`status=${statusFilter}`);

        const bundle = await FhirClientInstance.search(req, "MedicationRequest", searchParams);
        if (!bundle?.entry?.length) return McpUtilities.createTextResponse("No medication records found for this patient.");

        const medications = bundle.entry
          .filter((e) => !!e.resource)
          .map((e) => e.resource as fhirR4.MedicationRequest)
          .map((med) => {
            const name = med.medicationCodeableConcept?.text ?? med.medicationCodeableConcept?.coding?.[0]?.display ?? "Unknown medication";
            const dosageInstruction = med.dosageInstruction?.[0];
            const dose = dosageInstruction?.doseAndRate?.[0]?.doseQuantity?.value?.toString() ?? null;
            const doseUnit = dosageInstruction?.doseAndRate?.[0]?.doseQuantity?.unit ?? null;
            return {
              name,
              status: med.status ?? "unknown",
              dose: dose && doseUnit ? `${dose} ${doseUnit}` : dose ?? null,
              frequency: dosageInstruction?.text ?? dosageInstruction?.timing?.code?.text ?? null,
              route: dosageInstruction?.route?.text ?? dosageInstruction?.route?.coding?.[0]?.display ?? null,
              authoredDate: med.authoredOn ?? null,
              prescriber: med.requester?.display ?? null,
            };
          });

        return McpUtilities.createTextResponse(JSON.stringify(medications, null, 2));
      },
    );
  }
}

// ── GetPatientConditions ──────────────────────────────────────
class PatientConditionsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "GetPatientConditions",
      {
        description:
          "Gets active and historical medical conditions/diagnoses for a patient. Returns condition name, clinical status, onset date, and severity. Used for differential diagnosis context and care gap analysis.",
        inputSchema: {
          patientId: z.string().describe("The id of the patient. Optional if patient context already exists.").optional(),
          clinicalStatus: z.enum(["active", "resolved", "all"]).describe("Filter by clinical status. Defaults to 'active'.").optional(),
        },
      },
      async ({ patientId, clinicalStatus }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
            "A patient id is required. Provide it as a parameter or ensure patient context exists.",
          );
        }
        const statusToFetch = clinicalStatus ?? "active";
        const searchParams = [`patient=${patientId}`, "_sort=-onset-date", "_count=50"];
        if (statusToFetch !== "all") searchParams.push(`clinical-status=${statusToFetch}`);

        const bundle = await FhirClientInstance.search(req, "Condition", searchParams);
        if (!bundle?.entry?.length) return McpUtilities.createTextResponse(`No ${statusToFetch !== "all" ? statusToFetch : ""} conditions found for this patient.`);

        const conditions = bundle.entry
          .filter((e) => !!e.resource)
          .map((e) => e.resource as fhirR4.Condition)
          .map((cond) => ({
            name: cond.code?.text ?? cond.code?.coding?.[0]?.display ?? "Unknown condition",
            clinicalStatus: cond.clinicalStatus?.coding?.[0]?.code ?? "unknown",
            severity: cond.severity?.text ?? cond.severity?.coding?.[0]?.display ?? null,
            onsetDate: cond.onsetDateTime ?? cond.onsetPeriod?.start ?? null,
            abatementDate: cond.abatementDateTime ?? cond.abatementPeriod?.end ?? null,
            recordedDate: cond.recordedDate ?? null,
            category: cond.category?.[0]?.text ?? cond.category?.[0]?.coding?.[0]?.display ?? null,
          }));

        return McpUtilities.createTextResponse(JSON.stringify(conditions, null, 2));
      },
    );
  }
}

// ── GetPatientAllergies ───────────────────────────────────────
class PatientAllergiesTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "GetPatientAllergies",
      {
        description:
          "Gets all known allergies and adverse reactions for a patient including substance, reaction type, severity, and clinical status. Critical for medication safety and pre-visit preparation.",
        inputSchema: {
          patientId: z.string().describe("The id of the patient. Optional if patient context already exists.").optional(),
        },
      },
      async ({ patientId }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
            "A patient id is required. Provide it as a parameter or ensure patient context exists.",
          );
        }
        const bundle = await FhirClientInstance.search(req, "AllergyIntolerance", [`patient=${patientId}`, "_sort=-date", "_count=50"]);
        if (!bundle?.entry?.length) return McpUtilities.createTextResponse("No known allergies or adverse reactions found for this patient.");

        const allergies = bundle.entry
          .filter((e) => !!e.resource)
          .map((e) => e.resource as fhirR4.AllergyIntolerance)
          .map((a) => ({
            substance: a.code?.text ?? a.code?.coding?.[0]?.display ?? "Unknown substance",
            type: a.type ?? null,
            category: a.category ?? [],
            criticality: a.criticality ?? null,
            clinicalStatus: a.clinicalStatus?.coding?.[0]?.code ?? "unknown",
            verificationStatus: a.verificationStatus?.coding?.[0]?.code ?? "unknown",
            onsetDate: a.onsetDateTime ?? null,
            reactions: a.reaction?.map((r) => ({
              manifestation: r.manifestation?.[0]?.text ?? r.manifestation?.[0]?.coding?.[0]?.display ?? "Unknown reaction",
              severity: r.severity ?? null,
              description: r.description ?? null,
            })) ?? [],
          }));

        return McpUtilities.createTextResponse(JSON.stringify(allergies, null, 2));
      },
    );
  }
}

export const PatientMedicationsToolInstance = new PatientMedicationsTool();
export const PatientConditionsToolInstance = new PatientConditionsTool();
export const PatientAllergiesToolInstance = new PatientAllergiesTool();