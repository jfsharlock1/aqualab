const DEFAULT_TURBIDITY_CALIBRATION = {
  clearRaw: 2180,
  cloudyRaw: 1950,
  updatedAt: null
};

const CLARITY_LABELS = ["Clear", "Slightly Cloudy", "Cloudy", "Very Cloudy"];

export function getDefaultTurbidityCalibration() {
  return { ...DEFAULT_TURBIDITY_CALIBRATION };
}

export function normalizeTurbidityCalibration(value) {
  const clearRaw = Number(value?.clearRaw);
  const cloudyRaw = Number(value?.cloudyRaw);

  return {
    clearRaw: Number.isFinite(clearRaw) ? clearRaw : DEFAULT_TURBIDITY_CALIBRATION.clearRaw,
    cloudyRaw: Number.isFinite(cloudyRaw) ? cloudyRaw : DEFAULT_TURBIDITY_CALIBRATION.cloudyRaw,
    updatedAt: typeof value?.updatedAt === "string" ? value.updatedAt : null
  };
}

export function estimateClarity(reading, calibrationInput) {
  const calibration = normalizeTurbidityCalibration(calibrationInput);
  const raw = Number(reading?.turbidityRaw);

  if (!Number.isFinite(raw)) {
    return {
      label: "Unknown",
      score: null,
      explanation: "A raw turbidity sensor reading is needed before clarity can be estimated."
    };
  }

  const clearRaw = calibration.clearRaw;
  const cloudyRaw = calibration.cloudyRaw;
  const span = Math.max(1, clearRaw - cloudyRaw);
  const cloudyRatio = clamp((clearRaw - raw) / span, 0, 1.45);

  let label = "Very Cloudy";
  if (cloudyRatio <= 0.18) label = "Clear";
  else if (cloudyRatio <= 0.48) label = "Slightly Cloudy";
  else if (cloudyRatio <= 0.88) label = "Cloudy";

  return {
    label,
    score: Number(cloudyRatio.toFixed(3)),
    explanation: `Raw turbidity ${Math.round(raw)} compared with clear baseline ${Math.round(clearRaw)} and cloudy baseline ${Math.round(cloudyRaw)}.`
  };
}

export function classifyWaterCondition(reading, calibrationInput) {
  const clarity = estimateClarity(reading, calibrationInput);
  const tempF = Number(reading?.temperatureF);
  const reasons = [];

  let clarityPenalty = 2;
  if (clarity.label === "Clear") clarityPenalty = 0;
  else if (clarity.label === "Slightly Cloudy") clarityPenalty = 1;
  else if (clarity.label === "Cloudy") clarityPenalty = 2;
  else if (clarity.label === "Very Cloudy") clarityPenalty = 3;
  else reasons.push("turbidity data is missing");

  let tempPenalty = 0;
  if (!Number.isFinite(tempF)) {
    tempPenalty = 1;
    reasons.push("water temperature is missing");
  } else if (tempF < 65 || tempF > 92) {
    tempPenalty = 1;
    reasons.push(`water temperature is ${tempF.toFixed(1)} F`);
  } else {
    reasons.push(`water temperature is ${tempF.toFixed(1)} F`);
  }

  const penalty = clarityPenalty + tempPenalty;
  let level = "Poor";
  if (penalty <= 0) level = "Excellent";
  else if (penalty === 1) level = "Good";
  else if (penalty === 2) level = "Fair";

  let confidence = 0.45;
  if (Number.isFinite(Number(reading?.turbidityRaw))) confidence += 0.3;
  if (Number.isFinite(tempF)) confidence += 0.15;
  if (calibrationInput?.updatedAt) confidence += 0.1;

  const explanation = [
    `Estimated clarity is ${clarity.label}.`,
    reasons.length ? reasons.join("; ") + "." : "",
    "This prototype estimate uses turbidity and temperature only."
  ].filter(Boolean).join(" ");

  return {
    level,
    confidence: Number(clamp(confidence, 0, 1).toFixed(2)),
    explanation,
    clarity,
    inputs: {
      turbidityRaw: Number.isFinite(Number(reading?.turbidityRaw)) ? Number(reading.turbidityRaw) : null,
      temperatureF: Number.isFinite(tempF) ? tempF : null
    }
  };
}

export function getClarityLabels() {
  return CLARITY_LABELS.slice();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
