import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { McpUtilities } from "../mcp-utilities";

class CreatePatientTool implements IMcpTool {
  registerTool(server: McpServer, _req: Request) {
    server.registerTool(
      "CreatePatientRecord",
      {
        description:
          "Creates a new patient record for a first-time patient. Call this only when FindPatientId returns no match. Returns the new patient ID and a FHIR bundle to upload to complete registration.",
        inputSchema: {
          firstName: z.string().describe("Patient's first name"),
          lastName: z.string().describe("Patient's last name"),
          dateOfBirth: z
            .string()
            .describe("Patient's date of birth in MM/DD/YYYY or YYYY-MM-DD format"),
        },
      },
      async ({ firstName, lastName, dateOfBirth }) => {
        try {
          // Normalize DOB to YYYY-MM-DD
          let normalizedDob = dateOfBirth;
          if (dateOfBirth.includes("/")) {
            const parts = dateOfBirth.split("/");
            if (parts.length === 3) {
              const p0 = parts[0] ?? "";
              const p1 = parts[1] ?? "";
              const p2 = parts[2] ?? "";
              if (p2.length === 4) {
                normalizedDob = `${p2}-${p0.padStart(2, "0")}-${p1.padStart(2, "0")}`;
              } else {
                normalizedDob = `${p2}-${p1.padStart(2, "0")}-${p0.padStart(2, "0")}`;
              }
            }
          }

          const newPatientId = `NEW-${firstName.toLowerCase()}-${Date.now()}`;

          // FHIR-compliant bundle for upload to Prompt Opinion
          // In production the backend would store this automatically.
          // For the demo, the agent displays this and the user uploads it manually
          // via Patient Data → Import in the Prompt Opinion portal.
          const fhirBundle = {
  resourceType: "Bundle",
  type: "batch",
  entry: [
    {
      resource: {
        resourceType: "Patient",
        name: [
          {
            use: "official",
            family: lastName,
            given: [firstName],
          },
        ],
        birthDate: normalizedDob,
        gender: "unknown",
        active: true,
      },
      request: {
        method: "POST",
        url: "Patient",
      },
    },
  ],
};

          const downloadUrl = `https://unconfoundingly-unencircled-son.ngrok-free.dev/download/patient/${newPatientId}`;

          return McpUtilities.createTextResponse(
            JSON.stringify({
              status: "CREATED",
              patientId: newPatientId,
              name: `${firstName} ${lastName}`,
              dateOfBirth: normalizedDob,
              downloadUrl,
              message: "Your record has been created. Click the link to download your registration file, then upload it at Patient Data → Import.",
              fhirBundle,
            }, null, 2),
          );
        } catch {
          return McpUtilities.createTextResponse(
            JSON.stringify({
              status: "ERROR",
              message: "Unable to create patient record at this time.",
              suggestion: "Please contact your care team to register as a new patient.",
            }, null, 2),
          );
        }
      },
    );
  }
}

export const CreatePatientToolInstance = new CreatePatientTool();