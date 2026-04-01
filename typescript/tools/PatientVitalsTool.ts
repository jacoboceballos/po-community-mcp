import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { FhirClientInstance } from "../fhir-client";
import { fhirR4 } from "@smile-cdr/fhirts";

const VITAL_SIGN_LOINC_CODES: Record<string, string> = {
  "85354-9": "Blood pressure panel",
  "8480-6": "Systolic blood pressure",
  "8462-4": "Diastolic blood pressure",
  "8867-4": "Heart rate",
  "29463-7": "Body weight",
  "39156-5": "Body mass index (BMI)",
  "8310-5": "Body temperature",
  "9279-1": "Respiratory rate",
  "2708-6": "Oxygen saturation (SpO2)",
  "8302-2": "Body height",
};

class PatientVitalsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "GetPatientVitals",
      {
        description:
          "Gets the most recent vital signs for a patient including blood pressure, heart rate, weight, BMI, temperature, respiratory rate, SpO2, and height.",
        inputSchema: {
          patientId: z
            .string()
            .describe(
              "The id of the patient. This is optional if patient context already exists",
            )
            .optional(),
          count: z
            .string()
            .describe(
              "Maximum number of observations to return. Defaults to 20.",
            )
            .optional(),
        },
      },
      async ({ patientId, count }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
            "A patient id is required. Provide it as a parameter or ensure patient context exists.",
          );
        }

        const maxCount = count ?? "20";

        const bundle = await FhirClientInstance.search(
          req,
          "Observation",
          [
            `patient=${patientId}`,
            "category=vital-signs",
            "_sort=-date",
            `_count=${maxCount}`,
          ],
        );

        if (!bundle?.entry?.length) {
          return McpUtilities.createTextResponse(
            "No vital sign observations found for this patient.",
          );
        }

        const vitals = bundle.entry
          .filter((e) => !!e.resource)
          .map((e) => e.resource as fhirR4.Observation)
          .map((obs) => this._formatObservation(obs))
          .filter((v) => v !== null);

        if (!vitals.length) {
          return McpUtilities.createTextResponse(
            "Vital sign observations were found but could not be parsed.",
          );
        }

        return McpUtilities.createTextResponse(
          JSON.stringify(vitals, null, 2),
        );
      },
    );
  }

  private _formatObservation(obs: fhirR4.Observation): object | null {
    const code = obs.code?.coding?.[0]?.code ?? "unknown";
    const display =
      obs.code?.text ??
      obs.code?.coding?.[0]?.display ??
      VITAL_SIGN_LOINC_CODES[code] ??
      "Unknown vital";
    const effectiveDate =
      obs.effectiveDateTime ?? obs.effectivePeriod?.start ?? null;
    const status = obs.status;

    // Handle component-based observations (e.g., blood pressure panel)
    if (obs.component?.length) {
      const components = obs.component
        .filter((c) => c.code?.coding?.[0])
        .map((c) => ({
          name:
            c.code?.text ??
            c.code?.coding?.[0]?.display ??
            VITAL_SIGN_LOINC_CODES[c.code?.coding?.[0]?.code ?? ""] ??
            "Unknown",
          value: c.valueQuantity?.value ?? null,
          unit: c.valueQuantity?.unit ?? c.valueQuantity?.code ?? null,
        }));

      return {
        observation: display,
        components,
        effectiveDate,
        status,
      };
    }

    // Handle single-value observations
    let value: string | number | null = null;
    let unit: string | null = null;

    if (obs.valueQuantity) {
      value = obs.valueQuantity.value ?? null;
      unit = obs.valueQuantity.unit ?? obs.valueQuantity.code ?? null;
    } else if (obs.valueCodeableConcept) {
      value =
        obs.valueCodeableConcept.text ??
        obs.valueCodeableConcept.coding?.[0]?.display ??
        null;
    } else if (obs.valueString) {
      value = obs.valueString;
    }

    return {
      observation: display,
      value,
      unit,
      effectiveDate,
      status,
    };
  }
}

export const PatientVitalsToolInstance = new PatientVitalsTool();