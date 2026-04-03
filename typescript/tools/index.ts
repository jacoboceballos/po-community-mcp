// ── Original tools (do not remove) ──────────────────────────
import { PatientAgeToolInstance } from "./PatientAgeTool";
import { PatientIdToolInstance } from "./PatientIdTool";
import { PatientVitalsToolInstance } from "./PatientVitalsTool";
import { PatientLabResultsToolInstance } from "./PatientLabResultsTool";

// ── New tools ─────────────────────────────────────────────────
import { PatientMedicationsToolInstance, PatientConditionsToolInstance, PatientAllergiesToolInstance } from "./SharedFhirTools";
import { AssessRedFlagsToolInstance, CheckDrugInteractionsToolInstance, RankDifferentialDiagnosesToolInstance, AssessRiskIndicatorsToolInstance } from "./DiagnosisAgentTools";
import { GenerateSoapNoteToolInstance, ReconcileMedicationsToolInstance, BuildRecoveryTimelineToolInstance } from "./CareCoordinationTools";

export {
  // Original
  PatientAgeToolInstance,
  PatientIdToolInstance,
  PatientVitalsToolInstance,
  PatientLabResultsToolInstance,
  // Shared FHIR data tools
  PatientMedicationsToolInstance,
  PatientConditionsToolInstance,
  PatientAllergiesToolInstance,
  // Agent 1 — Diagnosis
  AssessRedFlagsToolInstance,
  CheckDrugInteractionsToolInstance,
  RankDifferentialDiagnosesToolInstance,
  AssessRiskIndicatorsToolInstance,
  // Agent 2 + 3 — Care Coordination
  GenerateSoapNoteToolInstance,
  ReconcileMedicationsToolInstance,
  BuildRecoveryTimelineToolInstance,
};