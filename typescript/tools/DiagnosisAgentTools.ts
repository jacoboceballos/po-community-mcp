import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { Request } from "express";
import { IMcpTool } from "../IMcpTool";
import { z } from "zod";
import { McpUtilities } from "../mcp-utilities";

// ── AssessRedFlags ────────────────────────────────────────────
class AssessRedFlagsTool implements IMcpTool {
  registerTool(server: McpServer, _req: Request) {
    server.registerTool(
      "AssessRedFlags",
      {
        description:
          "Checks reported symptoms against clinical emergency red flag criteria. Returns urgency level (EMERGENCY, URGENT, PROMPT, ROUTINE) and matched triggers. Always run this first before differential diagnosis.",
        inputSchema: {
          symptoms: z.array(z.string()).describe("List of symptoms the patient is currently reporting"),
          patientAge: z.number().describe("Patient age in years").optional(),
          knownConditions: z.array(z.string()).describe("Patient's known conditions that may affect risk level").optional(),
        },
      },
      async ({ symptoms, patientAge, knownConditions }) => {
        const symptomsText = symptoms.map((s) => s.toLowerCase()).join(" ");
        const conditions = (knownConditions ?? []).map((c) => c.toLowerCase()).join(" ");

        const emergencyFlags: string[] = [];
        const urgentFlags: string[] = [];
        const promptFlags: string[] = [];

        const emergencyChecks = [
          { keywords: ["chest pain", "chest tightness", "chest pressure"], flag: "Chest pain — possible cardiac event" },
          { keywords: ["can't breathe", "cannot breathe", "difficulty breathing", "shortness of breath", "not breathing"], flag: "Acute breathing difficulty" },
          { keywords: ["stroke", "face drooping", "arm weakness", "speech difficulty", "sudden numbness", "sudden confusion", "sudden vision loss"], flag: "Possible stroke — FAST criteria triggered" },
          { keywords: ["worst headache", "thunderclap headache", "sudden severe headache"], flag: "Thunderclap headache — possible subarachnoid hemorrhage" },
          { keywords: ["uncontrolled bleeding", "severe bleeding", "won't stop bleeding"], flag: "Uncontrolled bleeding" },
          { keywords: ["throat closing", "tongue swelling", "severe allergic", "anaphylaxis"], flag: "Severe allergic reaction / anaphylaxis" },
          { keywords: ["altered mental", "unresponsive", "unconscious", "fainted", "passed out"], flag: "Altered mental status" },
          { keywords: ["suicidal", "want to die", "end my life", "kill myself"], flag: "Suicidal ideation — mental health emergency" },
        ];

        const urgentChecks = [
          { keywords: ["high fever", "fever over 103", "103 degrees", "104 degrees"], flag: "High fever requiring urgent evaluation" },
          { keywords: ["severe abdominal pain", "severe stomach pain"], flag: "Severe abdominal pain" },
          { keywords: ["blood in urine", "blood in stool", "coughing blood", "vomiting blood"], flag: "Blood in body fluids" },
          { keywords: ["broken bone", "fracture", "dislocated"], flag: "Possible fracture or dislocation" },
        ];

        const promptChecks = [
          { keywords: ["fever", "temperature", "chills"], flag: "Fever — schedule within 24-48 hours" },
          { keywords: ["rash", "hives", "skin reaction"], flag: "Skin reaction needing evaluation" },
          { keywords: ["persistent cough", "cough for weeks"], flag: "Persistent cough" },
          { keywords: ["burning urination", "painful urination", "frequent urination"], flag: "Possible UTI or urinary issue" },
        ];

        for (const check of emergencyChecks) {
          if (check.keywords.some((k) => symptomsText.includes(k))) emergencyFlags.push(check.flag);
        }

        if (symptomsText.includes("chest") && (conditions.includes("heart") || conditions.includes("cardiac") || conditions.includes("hypertension") || (patientAge && patientAge > 45))) {
          if (!emergencyFlags.some((f) => f.includes("Chest pain"))) {
            emergencyFlags.push("Chest pain with cardiac risk factors — treat as cardiac until ruled out");
          }
        }

        for (const check of urgentChecks) {
          if (check.keywords.some((k) => symptomsText.includes(k)) && emergencyFlags.length === 0) urgentFlags.push(check.flag);
        }

        for (const check of promptChecks) {
          if (check.keywords.some((k) => symptomsText.includes(k)) && emergencyFlags.length === 0 && urgentFlags.length === 0) promptFlags.push(check.flag);
        }

        let urgencyLevel = "ROUTINE";
        let recommendation = "Monitor symptoms. Self-care and follow up with your doctor if symptoms worsen.";
        if (emergencyFlags.length > 0) { urgencyLevel = "EMERGENCY"; recommendation = "CALL 911 IMMEDIATELY. Do not drive yourself."; }
        else if (urgentFlags.length > 0) { urgencyLevel = "URGENT"; recommendation = "Seek emergency or urgent care within 1-2 hours."; }
        else if (promptFlags.length > 0) { urgencyLevel = "PROMPT"; recommendation = "Schedule an appointment with your doctor within 24-48 hours."; }

        return McpUtilities.createTextResponse(JSON.stringify({ urgencyLevel, recommendation, emergencyFlags, urgentFlags, promptFlags, totalFlagsFound: emergencyFlags.length + urgentFlags.length + promptFlags.length }, null, 2));
      },
    );
  }
}

// ── CheckDrugInteractions ─────────────────────────────────────
class CheckDrugInteractionsTool implements IMcpTool {
  registerTool(server: McpServer, _req: Request) {
    server.registerTool(
      "CheckDrugInteractions",
      {
        description:
          "Checks a medication list for known dangerous drug interactions. Returns severity level (CRITICAL, HIGH, MODERATE) and clinical guidance for each interaction. Use after GetPatientMedications.",
        inputSchema: {
          medications: z.array(z.string()).describe("List of medication names the patient is currently taking"),
          newMedication: z.string().describe("Optional new medication being considered").optional(),
        },
      },
      async ({ medications, newMedication }) => {
        const allMeds = [...medications, ...(newMedication ? [newMedication] : [])].map((m) => m.toLowerCase());

        const interactions: Array<{ drugs: string[]; severity: string; description: string }> = [];

        const rules = [
          { drugs: ["warfarin", "aspirin"], severity: "HIGH", description: "Warfarin + Aspirin significantly increases bleeding risk. Requires close INR monitoring." },
          { drugs: ["warfarin", "ibuprofen"], severity: "HIGH", description: "NSAIDs increase warfarin anticoagulant effect and GI bleeding risk." },
          { drugs: ["warfarin", "naproxen"], severity: "HIGH", description: "NSAIDs increase warfarin anticoagulant effect and GI bleeding risk." },
          { drugs: ["ssri", "tramadol"], severity: "HIGH", description: "SSRIs + Tramadol can cause serotonin syndrome." },
          { drugs: ["sertraline", "tramadol"], severity: "HIGH", description: "Sertraline + Tramadol increases serotonin syndrome risk." },
          { drugs: ["fluoxetine", "tramadol"], severity: "HIGH", description: "Fluoxetine + Tramadol increases serotonin syndrome risk." },
          { drugs: ["lisinopril", "spironolactone"], severity: "MODERATE", description: "ACE inhibitors with potassium-sparing diuretics can cause dangerous hyperkalemia." },
          { drugs: ["lisinopril", "potassium"], severity: "MODERATE", description: "ACE inhibitors with potassium supplements can cause hyperkalemia." },
          { drugs: ["simvastatin", "amiodarone"], severity: "HIGH", description: "Amiodarone inhibits simvastatin metabolism — myopathy and rhabdomyolysis risk." },
          { drugs: ["clopidogrel", "omeprazole"], severity: "MODERATE", description: "Omeprazole reduces clopidogrel effectiveness. Consider switching to pantoprazole." },
          { drugs: ["methotrexate", "ibuprofen"], severity: "HIGH", description: "NSAIDs reduce methotrexate clearance, increasing toxicity." },
          { drugs: ["methotrexate", "naproxen"], severity: "HIGH", description: "NSAIDs reduce methotrexate clearance, increasing toxicity." },
          { drugs: ["maoi", "sertraline"], severity: "CRITICAL", description: "MAOIs + SSRIs cause life-threatening serotonin syndrome. Contraindicated." },
          { drugs: ["maoi", "fluoxetine"], severity: "CRITICAL", description: "MAOIs + SSRIs cause life-threatening serotonin syndrome. Contraindicated." },
          { drugs: ["digoxin", "amiodarone"], severity: "HIGH", description: "Amiodarone increases digoxin levels — risk of digoxin toxicity." },
          { drugs: ["metformin", "contrast"], severity: "HIGH", description: "Metformin should be held before/after contrast procedures — lactic acidosis risk." },
          { drugs: ["warfarin", "metronidazole"], severity: "HIGH", description: "Metronidazole significantly increases warfarin effect. Dose adjustment required." },
          { drugs: ["ciprofloxacin", "warfarin"], severity: "HIGH", description: "Ciprofloxacin inhibits warfarin metabolism, increasing bleeding risk." },
        ];

        for (const rule of rules) {
          const matched = rule.drugs.filter((d) => allMeds.some((m) => m.includes(d)));
          if (matched.length >= 2) interactions.push({ drugs: matched, severity: rule.severity, description: rule.description });
        }

        const hasCritical = interactions.some((i) => i.severity === "CRITICAL");
        const hasHigh = interactions.some((i) => i.severity === "HIGH");

        return McpUtilities.createTextResponse(JSON.stringify({
          medicationsChecked: allMeds,
          interactionsFound: interactions.length,
          highestSeverity: hasCritical ? "CRITICAL" : hasHigh ? "HIGH" : interactions.length > 0 ? "MODERATE" : "NONE",
          interactions,
          clinicalNote: interactions.length === 0 ? "No known major interactions detected." : "Review flagged interactions with prescribing clinician before proceeding.",
        }, null, 2));
      },
    );
  }
}

// ── RankDifferentialDiagnoses ─────────────────────────────────
class RankDifferentialDiagnosesTool implements IMcpTool {
  registerTool(server: McpServer, _req: Request) {
    server.registerTool(
      "RankDifferentialDiagnoses",
      {
        description:
          "Takes symptoms, medical history, and medications and returns a ranked list of possible diagnoses with confidence levels (HIGH/MODERATE/LOW), supporting factors, and recommended next steps. Always run AssessRedFlags first.",
        inputSchema: {
          symptoms: z.array(z.string()).describe("Current symptoms the patient is reporting"),
          patientHistory: z.string().describe("Medical history summary from GetPatientConditions or patient FHIR record"),
          medications: z.array(z.string()).describe("Current medications from GetPatientMedications").optional(),
          patientAge: z.number().describe("Patient age in years").optional(),
        },
      },
      async ({ symptoms, patientHistory, medications: _medications, patientAge }) => {
        const symptomsText = symptoms.map((s) => s.toLowerCase()).join(", ");
        const historyText = patientHistory.toLowerCase();

        const patterns = [
          { condition: "Type 2 Diabetes / Hyperglycemia", keywords: ["fatigue", "thirst", "frequent urination", "blurred vision", "slow healing", "weight loss", "polyuria", "polydipsia"], historyKeywords: ["diabetes", "a1c", "glucose", "insulin", "metformin"], riskFactors: ["obesity", "hypertension", "family history of diabetes"], nextStep: "Order fasting glucose and A1C. If already diagnosed, review current management." },
          { condition: "Hypertension Exacerbation", keywords: ["headache", "dizziness", "chest tightness", "blurred vision", "nosebleed", "palpitations"], historyKeywords: ["hypertension", "blood pressure", "lisinopril", "amlodipine", "metoprolol"], riskFactors: ["hypertension", "cardiovascular disease"], nextStep: "Check blood pressure immediately. Review medication adherence and sodium intake." },
          { condition: "Upper Respiratory Infection (URI)", keywords: ["cough", "sore throat", "runny nose", "congestion", "sneezing", "mild fever", "hoarse"], historyKeywords: ["sinusitis", "pharyngitis", "viral", "rhinitis"], riskFactors: ["recent illness exposure", "immunocompromised"], nextStep: "Rest, hydration, OTC symptom management. Follow up if symptoms persist beyond 10 days." },
          { condition: "Urinary Tract Infection (UTI)", keywords: ["burning urination", "painful urination", "frequent urination", "urgency", "cloudy urine", "pelvic pain"], historyKeywords: ["uti", "urinary tract", "cystitis"], riskFactors: ["female", "prior uti history", "diabetes"], nextStep: "Order urinalysis and urine culture. Consider empiric antibiotic therapy pending results." },
          { condition: "Anxiety / Panic Disorder", keywords: ["racing heart", "palpitations", "shortness of breath", "chest tightness", "dizziness", "panic", "anxious", "worry", "trembling"], historyKeywords: ["anxiety", "panic", "stress", "ssri", "sertraline", "lexapro", "buspirone"], riskFactors: ["stress", "social isolation"], nextStep: "Rule out cardiac cause if chest symptoms present. Discuss mental health support and stress management." },
          { condition: "Gastroesophageal Reflux Disease (GERD)", keywords: ["heartburn", "acid reflux", "chest burning", "regurgitation", "sour taste", "nausea after eating"], historyKeywords: ["gerd", "reflux", "omeprazole", "pantoprazole"], riskFactors: ["obesity", "high fat diet", "smoking", "alcohol"], nextStep: "Dietary modification, elevate head of bed. Consider PPI therapy if not already prescribed." },
          { condition: "Medication Side Effect", keywords: ["nausea", "fatigue", "dizziness", "headache", "rash", "stomach upset", "muscle aches"], historyKeywords: [], riskFactors: ["recent medication change", "new prescription", "dose increase"], nextStep: "Cross-reference symptoms with known side effects of patient's medications. Do not stop medications without consulting prescriber." },
          { condition: "Depression", keywords: ["sad", "hopeless", "no energy", "not sleeping", "sleeping too much", "no appetite", "can't concentrate", "worthless", "lost interest"], historyKeywords: ["depression", "antidepressant", "ssri", "sertraline", "fluoxetine", "bupropion"], riskFactors: ["social isolation", "stress", "chronic illness"], nextStep: "Administer PHQ-9 screening. Discuss therapy options, medication review, and safety assessment." },
        ];

        const diagnoses = patterns
          .map((p) => {
            const matchedSymptoms = p.keywords.filter((k) => symptomsText.includes(k));
            if (matchedSymptoms.length === 0) return null;
            const historyMatch = p.historyKeywords.filter((k) => historyText.includes(k));
            const riskMatch = p.riskFactors.filter((k) => historyText.includes(k) || symptomsText.includes(k));
            const score = matchedSymptoms.length + historyMatch.length * 1.5 + riskMatch.length;
            const confidence = score >= 4 ? "HIGH" : score >= 2 ? "MODERATE" : "LOW";
            return {
              condition: p.condition,
              confidence,
              supportingFactors: [
                ...matchedSymptoms.map((s) => `Symptom: "${s}"`),
                ...historyMatch.map((h) => `History: "${h}"`),
                ...riskMatch.map((r) => `Risk factor: "${r}"`),
              ],
              recommendedNextStep: p.nextStep,
            };
          })
          .filter(Boolean)
          .sort((a, b) => ({ HIGH: 0, MODERATE: 1, LOW: 2 }[a!.confidence] - { HIGH: 0, MODERATE: 1, LOW: 2 }[b!.confidence]))
          .slice(0, 5);

        return McpUtilities.createTextResponse(JSON.stringify({
          symptomsAnalyzed: symptoms,
          patientAge: patientAge ?? "Not provided",
          diagnosesFound: diagnoses.length,
          differentialDiagnoses: diagnoses,
          disclaimer: "Clinical decision support only. Does not replace physical examination or diagnostic testing.",
          note: diagnoses.length === 0 ? "No strong pattern matches found. Recommend clinical evaluation." : undefined,
        }, null, 2));
      },
    );
  }
}

// ── AssessRiskIndicators ──────────────────────────────────────
class AssessRiskIndicatorsTool implements IMcpTool {
  registerTool(server: McpServer, _req: Request) {
    server.registerTool(
      "AssessRiskIndicators",
      {
        description:
          "Analyzes lab values and vitals against clinical thresholds to surface predictive risk flags for diabetes, cardiovascular disease, kidney disease, anemia, and hypertensive crisis. Feed in results from GetPatientLabResults and GetPatientVitals.",
        inputSchema: {
          labs: z.object({
            a1c: z.number().optional(),
            fastingGlucose: z.number().optional(),
            ldl: z.number().optional(),
            hdl: z.number().optional(),
            egfr: z.number().optional(),
            hemoglobin: z.number().optional(),
            potassium: z.number().optional(),
          }).optional().describe("Numeric lab values from GetPatientLabResults"),
          vitals: z.object({
            systolicBp: z.number().optional(),
            diastolicBp: z.number().optional(),
            bmi: z.number().optional(),
            oxygenSaturation: z.number().optional(),
          }).optional().describe("Patient vitals from GetPatientVitals"),
          chiefComplaint: z.string().optional().describe("Chief complaint for context"),
        },
      },
      async ({ labs, vitals, chiefComplaint }) => {
        const flags: Array<{ indicator: string; value: string; threshold: string; severity: string; conditionRisk: string; recommendedAction: string }> = [];
        const l = labs ?? {};
        const v = vitals ?? {};

        if (l.a1c !== undefined) {
          if (l.a1c >= 6.5) flags.push({ indicator: "A1C", value: `${l.a1c}%`, threshold: "≥6.5%", severity: "HIGH", conditionRisk: "Diabetes", recommendedAction: "Confirm diagnosis. Initiate or review glucose management." });
          else if (l.a1c >= 5.7) flags.push({ indicator: "A1C", value: `${l.a1c}%`, threshold: "5.7–6.4%", severity: "MODERATE", conditionRisk: "Prediabetes", recommendedAction: "Lifestyle intervention. Recheck in 6 months." });
        }
        if (l.fastingGlucose !== undefined) {
          if (l.fastingGlucose >= 126) flags.push({ indicator: "Fasting Glucose", value: `${l.fastingGlucose} mg/dL`, threshold: "≥126 mg/dL", severity: "HIGH", conditionRisk: "Diabetes", recommendedAction: "Confirm with repeat test. Initiate diabetes management." });
          else if (l.fastingGlucose >= 100) flags.push({ indicator: "Fasting Glucose", value: `${l.fastingGlucose} mg/dL`, threshold: "100–125 mg/dL", severity: "MODERATE", conditionRisk: "Prediabetes", recommendedAction: "Dietary counseling, weight management. Recheck in 3 months." });
        }
        if (l.ldl !== undefined) {
          if (l.ldl >= 190) flags.push({ indicator: "LDL Cholesterol", value: `${l.ldl} mg/dL`, threshold: "≥190 mg/dL", severity: "HIGH", conditionRisk: "Cardiovascular Disease", recommendedAction: "High-intensity statin therapy indicated." });
          else if (l.ldl >= 130) flags.push({ indicator: "LDL Cholesterol", value: `${l.ldl} mg/dL`, threshold: "≥130 mg/dL", severity: "MODERATE", conditionRisk: "Elevated Cardiovascular Risk", recommendedAction: "Review 10-year ASCVD risk. Discuss statin initiation." });
        }
        if (l.hdl !== undefined && l.hdl < 40) flags.push({ indicator: "HDL Cholesterol", value: `${l.hdl} mg/dL`, threshold: "<40 mg/dL", severity: "MODERATE", conditionRisk: "Cardiovascular Risk", recommendedAction: "Exercise, smoking cessation, dietary changes to raise HDL." });
        if (l.egfr !== undefined) {
          if (l.egfr < 30) flags.push({ indicator: "eGFR", value: `${l.egfr} mL/min`, threshold: "<30", severity: "HIGH", conditionRisk: "Severe CKD (Stage 4)", recommendedAction: "Nephrology referral. Review nephrotoxic medications immediately." });
          else if (l.egfr < 60) flags.push({ indicator: "eGFR", value: `${l.egfr} mL/min`, threshold: "30–59", severity: "MODERATE", conditionRisk: "Moderate CKD (Stage 3)", recommendedAction: "Monitor renal function every 3 months. Adjust renally-cleared medications." });
        }
        if (l.hemoglobin !== undefined) {
          if (l.hemoglobin < 8) flags.push({ indicator: "Hemoglobin", value: `${l.hemoglobin} g/dL`, threshold: "<8 g/dL", severity: "HIGH", conditionRisk: "Severe Anemia", recommendedAction: "Urgent evaluation. Assess transfusion threshold." });
          else if (l.hemoglobin < 12) flags.push({ indicator: "Hemoglobin", value: `${l.hemoglobin} g/dL`, threshold: "<12 g/dL", severity: "MODERATE", conditionRisk: "Anemia", recommendedAction: "Iron studies, B12/folate. Investigate underlying cause." });
        }
        if (l.potassium !== undefined && (l.potassium > 5.5 || l.potassium < 3.0)) flags.push({ indicator: "Potassium", value: `${l.potassium} mEq/L`, threshold: "Normal: 3.5–5.0", severity: "HIGH", conditionRisk: "Electrolyte Imbalance / Arrhythmia", recommendedAction: "Urgent electrolyte management. EKG if symptomatic." });
        if (v.systolicBp !== undefined) {
          if (v.systolicBp >= 180) flags.push({ indicator: "Systolic BP", value: `${v.systolicBp} mmHg`, threshold: "≥180 mmHg", severity: "CRITICAL", conditionRisk: "Hypertensive Crisis", recommendedAction: "Immediate medical evaluation required." });
          else if (v.systolicBp >= 140) flags.push({ indicator: "Systolic BP", value: `${v.systolicBp} mmHg`, threshold: "≥140 mmHg", severity: "MODERATE", conditionRisk: "Stage 2 Hypertension", recommendedAction: "Review antihypertensive regimen. Screen for end-organ damage." });
        }
        if (v.bmi !== undefined) {
          if (v.bmi >= 35) flags.push({ indicator: "BMI", value: `${v.bmi}`, threshold: "≥35", severity: "MODERATE", conditionRisk: "Class II Obesity", recommendedAction: "Structured weight management. Screen for comorbidities." });
        }
        if (v.oxygenSaturation !== undefined) {
          if (v.oxygenSaturation < 90) flags.push({ indicator: "O2 Saturation", value: `${v.oxygenSaturation}%`, threshold: "<90%", severity: "CRITICAL", conditionRisk: "Hypoxemia — respiratory failure risk", recommendedAction: "Immediate oxygen and emergency evaluation." });
          else if (v.oxygenSaturation < 95) flags.push({ indicator: "O2 Saturation", value: `${v.oxygenSaturation}%`, threshold: "90–94%", severity: "HIGH", conditionRisk: "Mild–Moderate Hypoxemia", recommendedAction: "Evaluate respiratory cause. Consider supplemental oxygen." });
        }

        const criticalCount = flags.filter((f) => f.severity === "CRITICAL").length;
        const highCount = flags.filter((f) => f.severity === "HIGH").length;

        return McpUtilities.createTextResponse(JSON.stringify({
          totalFlags: flags.length,
          highestSeverity: criticalCount > 0 ? "CRITICAL" : highCount > 0 ? "HIGH" : flags.length > 0 ? "MODERATE" : "NONE",
          chiefComplaintContext: chiefComplaint ?? "Not provided",
          riskFlags: flags,
          summary: flags.length === 0 ? "No threshold-based risk indicators detected." : `${flags.length} risk indicator(s) detected. Review with clinical team.`,
        }, null, 2));
      },
    );
  }
}

export const AssessRedFlagsToolInstance = new AssessRedFlagsTool();
export const CheckDrugInteractionsToolInstance = new CheckDrugInteractionsTool();
export const RankDifferentialDiagnosesToolInstance = new RankDifferentialDiagnosesTool();
export const AssessRiskIndicatorsToolInstance = new AssessRiskIndicatorsTool();