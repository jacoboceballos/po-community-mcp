import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { FhirUtilities } from "../fhir-utilities";
import { McpUtilities } from "../mcp-utilities";
import { NullUtilities } from "../null-utilities";
import { FhirClientInstance } from "../fhir-client";
import { fhirR4 } from "@smile-cdr/fhirts";

const COMMON_LAB_LOINC_CODES: Record<string, string> = {
  // Lipid panel
  "2093-3": "Total cholesterol",
  "2085-9": "HDL cholesterol",
  "2089-1": "LDL cholesterol",
  "2571-8": "Triglycerides",
  // Diabetes
  "4548-4": "Hemoglobin A1c (HbA1c)",
  "2339-0": "Glucose",
  "14749-6": "Glucose (fasting)",
  // CBC
  "6690-2": "White blood cells (WBC)",
  "789-8": "Red blood cells (RBC)",
  "718-7": "Hemoglobin",
  "4544-3": "Hematocrit",
  "777-3": "Platelets",
  // Renal
  "2160-0": "Creatinine",
  "3094-0": "Blood urea nitrogen (BUN)",
  "33914-3": "Estimated GFR (eGFR)",
  // Liver
  "1742-6": "ALT (alanine aminotransferase)",
  "1920-8": "AST (aspartate aminotransferase)",
  // Electrolytes
  "2951-2": "Sodium",
  "2823-3": "Potassium",
  // Cardiac
  "33762-6": "NT-proBNP",
  "10839-9": "Troponin I",
  "49563-0": "Troponin T (high sensitivity)",
};

class PatientLabResultsTool implements IMcpTool {
  registerTool(server: McpServer, req: Request) {
    server.registerTool(
      "GetPatientLabResults",
      {
        description:
          "Gets recent laboratory results for a patient. Supports filtering by LOINC code. Common labs include cholesterol panel, HbA1c, CBC, metabolic panel, liver enzymes, and cardiac markers.",
        inputSchema: {
          patientId: z
            .string()
            .describe(
              "The id of the patient. This is optional if patient context already exists",
            )
            .optional(),
          loincCode: z
            .string()
            .describe(
              "Optional LOINC code to filter by a specific lab test. " +
                "Common codes: 2093-3 (total cholesterol), 2085-9 (HDL), " +
                "2089-1 (LDL), 4548-4 (HbA1c), 718-7 (hemoglobin), " +
                "2160-0 (creatinine), 33914-3 (eGFR). " +
                "If not provided, returns all recent lab results.",
            )
            .optional(),
          count: z
            .string()
            .describe(
              "Maximum number of results to return. Defaults to 50.",
            )
            .optional(),
        },
      },
      async ({ patientId, loincCode, count }) => {
        if (!patientId) {
          patientId = NullUtilities.getOrThrow(
            FhirUtilities.getPatientIdIfContextExists(req),
            "A patient id is required. Provide it as a parameter or ensure patient context exists.",
          );
        }

        const maxCount = count ?? "50";
        const searchParams = [
          `patient=${patientId}`,
          "category=laboratory",
          "_sort=-date",
          `_count=${maxCount}`,
        ];

        if (loincCode) {
          searchParams.push(`code=http://loinc.org|${loincCode}`);
        }

        const bundle = await FhirClientInstance.search(
          req,
          "Observation",
          searchParams,
        );

        if (!bundle?.entry?.length) {
          const filterMsg = loincCode
            ? ` matching LOINC code ${loincCode} (${COMMON_LAB_LOINC_CODES[loincCode] ?? "unknown"})`
            : "";
          return McpUtilities.createTextResponse(
            `No laboratory results found for this patient${filterMsg}.`,
          );
        }

        const labs = bundle.entry
          .filter((e) => !!e.resource)
          .map((e) => e.resource as fhirR4.Observation)
          .map((obs) => this._formatLabResult(obs))
          .filter((l) => l !== null);

        if (!labs.length) {
          return McpUtilities.createTextResponse(
            "Laboratory observations were found but could not be parsed.",
          );
        }

        return McpUtilities.createTextResponse(
          JSON.stringify(labs, null, 2),
        );
      },
    );
  }

  private _formatLabResult(obs: fhirR4.Observation): object | null {
    const code = obs.code?.coding?.[0]?.code ?? "unknown";
    const display =
      obs.code?.text ??
      obs.code?.coding?.[0]?.display ??
      COMMON_LAB_LOINC_CODES[code] ??
      "Unknown lab";
    const effectiveDate =
      obs.effectiveDateTime ?? obs.effectivePeriod?.start ?? null;
    const status = obs.status;

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

    // Extract reference range if available
    let referenceRange: string | null = null;
    if (obs.referenceRange?.length) {
      const range = obs.referenceRange[0];
      const low = range?.low?.value;
      const high = range?.high?.value;
      const rangeUnit = range?.low?.unit ?? range?.high?.unit ?? unit;
      if (low !== undefined && high !== undefined) {
        referenceRange = `${low}-${high} ${rangeUnit ?? ""}`.trim();
      } else if (low !== undefined) {
        referenceRange = `>= ${low} ${rangeUnit ?? ""}`.trim();
      } else if (high !== undefined) {
        referenceRange = `<= ${high} ${rangeUnit ?? ""}`.trim();
      } else if (range?.text) {
        referenceRange = range.text;
      }
    }

    // Extract interpretation (e.g., High, Low, Normal)
    const interpretation =
      obs.interpretation?.[0]?.text ??
      obs.interpretation?.[0]?.coding?.[0]?.display ??
      null;

    return {
      observation: display,
      loincCode: code,
      value,
      unit,
      referenceRange,
      interpretation,
      effectiveDate,
      status,
    };
  }
}

export const PatientLabResultsToolInstance = new PatientLabResultsTool();