// ── Original tools (do not remove) ──────────────────────────
import { PatientAgeToolInstance } from "./PatientAgeTool";
import { PatientIdToolInstance } from "./PatientIdTool";
import { PatientVitalsToolInstance } from "./PatientVitalsTool";
import { PatientLabResultsToolInstance } from "./PatientLabResultsTool";

// ── New tools ─────────────────────────────────────────────────
import { PatientMedicationsToolInstance, PatientConditionsToolInstance, PatientAllergiesToolInstance } from "./SharedFhirTools";
import { AssessRedFlagsToolInstance, CheckDrugInteractionsToolInstance, RankDifferentialDiagnosesToolInstance, AssessRiskIndicatorsToolInstance } from "./DiagnosisAgentTools";
import { GenerateSoapNoteToolInstance, ReconcileMedicationsToolInstance, BuildRecoveryTimelineToolInstance } from "./CareCoordinationTools";
import { ValidateResponseToolInstance } from "./ValidateResponseTool";
import { AppleWatchVitalsToolInstance } from "./AppleWatchVitalsTool";
import { CreatePatientToolInstance } from "./CreatePatientTool";


export {
  //Patient Fetch
  CreatePatientToolInstance,
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
  //Checker
  ValidateResponseToolInstance,
  //Apple Watch
  AppleWatchVitalsToolInstance,
};