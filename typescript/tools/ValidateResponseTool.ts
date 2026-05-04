import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { McpUtilities } from "../mcp-utilities";

// ── ValidateResponse ──────────────────────────────────────────────────────────
// Privacy, scope, and accuracy guard.
// Called by the orchestrator after every agent response before returning to user.
// Pure deterministic logic — no LLM calls, instant execution.
// ─────────────────────────────────────────────────────────────────────────────

class ValidateResponseTool implements IMcpTool {
  registerTool(server: McpServer, _req: Request) {
    server.registerTool(
      "ValidateResponse",
      {
        description:
          "ALWAYS call this before returning any response to the user. Validates the agent response for: (1) PRIVACY — no cross-patient data leakage, (2) SCOPE — response is relevant to what was asked, (3) FACTUAL — no speculative or hallucinated content. Returns PASS or BLOCK. If BLOCK, use the safe_response field instead of the original response.",
        inputSchema: {
          agentResponse: z
            .string()
            .describe("The full response text from the agent before it is shown to the user"),
          originalQuestion: z
            .string()
            .describe("The original question or message the user sent"),
          patientName: z
            .string()
            .optional()
            .describe("Name of the patient currently in context (from the active FHIR session)"),
        },
      },
      async ({ agentResponse, originalQuestion, patientName }: {
        agentResponse: string;
        originalQuestion: string;
        patientName?: string;
      }) => {
        const responseText = agentResponse.toLowerCase();
        const questionText = originalQuestion.toLowerCase();
        const issues: Array<{ type: string; severity: string; detail: string }> = [];

        // ── 1. Privacy Check ────────────────────────────────────────────────
        const privacyTriggers = [
          "another patient",
          "other patient",
          "different patient",
          "patient record shows",
          "according to their file",
        ];

        for (const phrase of privacyTriggers) {
          if (responseText.includes(phrase)) {
            issues.push({
              type: "PRIVACY",
              severity: "HIGH",
              detail: `Cross-patient reference detected: "${phrase}"`,
            });
          }
        }

        // If a patient name is in context, check if a different name appears in the response
        // This catches cases like "How is Lane Carroll doing" when Lincoln Bednar is active
        if (patientName) {
  // Check if question is about someone other than the active session patient
  const activeName = patientName.toLowerCase();
  const activeFirst = activeName.split(" ")[0] ?? "";
  const activeLast = activeName.split(" ").slice(-1)[0] ?? "";
  if (
    !questionText.includes(activeFirst) &&
    !questionText.includes(activeLast) &&
    (questionText.includes("how is") ||
      questionText.includes("what medications") ||
      questionText.includes("tell me about") ||
      questionText.includes("doing") ||
      questionText.includes("patient"))
  ) {
    issues.push({
      type: "PRIVACY",
      severity: "HIGH",
      detail: `Question is about a different patient than the active session patient "${patientName}"`,
    });
  }

  // Check if response contains a name that isn't the active patient
  const activeFirstName = patientName.split(" ")[0]!.toLowerCase();
  const capitalizedWords = originalQuestion.match(/\b[A-Z][a-z]+\b/g) ?? [];
  for (const word of capitalizedWords) {
    if (
      word.toLowerCase() !== activeFirstName &&
      responseText.includes(word.toLowerCase()) &&
      word.length > 3
    ) {
      if (
        questionText.includes("how is") ||
        questionText.includes("what about") ||
        questionText.includes("tell me about") ||
        questionText.includes("doing") ||
        questionText.includes("patient")
      ) {
        issues.push({
          type: "PRIVACY",
          severity: "HIGH",
          detail: `Response may contain data for a different patient: "${word}" — active patient is "${patientName}"`,
        });
        break;
      }
    }
  }
}

        // ── 2. Scope Check ──────────────────────────────────────────────────
        const offTopicTriggers = [
          "capital of",
          "weather in",
          "stock price",
          "sports score",
          "recipe for",
          "how to cook",
          "box office",
          "election",
        ];

        for (const phrase of offTopicTriggers) {
          if (questionText.includes(phrase) || responseText.includes(phrase)) {
            issues.push({
              type: "SCOPE",
              severity: "MODERATE",
              detail: `Off-topic content detected: "${phrase}"`,
            });
          }
        }

        // ── 3. Factual Grounding Check ──────────────────────────────────────
        const speculativeTriggers = [
          "i assume",
          "i imagine",
          "probably has",
          "likely has",
          "i believe they have",
          "typically patients like",
          "most patients in this situation",
          "generally speaking for someone like",
        ];

        for (const phrase of speculativeTriggers) {
          if (responseText.includes(phrase)) {
            issues.push({
              type: "FACTUAL",
              severity: "MODERATE",
              detail: `Speculative language detected: "${phrase}"`,
            });
          }
        }

        // ── Result ──────────────────────────────────────────────────────────
        const highSeverityIssues = issues.filter((i) => i.severity === "HIGH");
        const passed = highSeverityIssues.length === 0;

        let safeResponse: string | null = null;
        if (!passed) {
          const issueTypes = issues.map((i) => i.type);
          if (issueTypes.includes("PRIVACY")) {
            safeResponse =
              "I can only provide information about your own health records. " +
              "If you believe there's been an error, please contact your care team directly.";
          } else if (issueTypes.includes("FACTUAL")) {
            safeResponse =
              "I wasn't able to provide a fully grounded answer based on your records for this question. " +
              "Please consult your care team for accurate information.";
          } else {
            safeResponse =
              "I wasn't able to provide a response within the scope of your health records. " +
              "Please speak with your care provider.";
          }
        }

        return McpUtilities.createTextResponse(
          JSON.stringify(
            {
              status: passed ? "PASS" : "BLOCK",
              issuesFound: issues.length,
              issues,
              instruction: passed
                ? "Response is safe. Deliver the original response to the user as-is."
                : `Response blocked. Deliver this safe_response to the user instead: "${safeResponse}"`,
              safeResponse,
            },
            null,
            2,
          ),
        );
      },
    );
  }
}

export const ValidateResponseToolInstance = new ValidateResponseTool();