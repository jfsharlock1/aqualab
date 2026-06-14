const PARAMS = {
  ph: { label: "pH", unit: "", confidenceKey: "__phConfidence" },
  freeCl: { label: "Free Chlorine", unit: "ppm", confidenceKey: "__freeClConfidence" },
  totalCl: { label: "Total Chlorine", unit: "ppm", confidenceKey: "__totalClConfidence" },
  combinedCl: { label: "Combined Chlorine", unit: "ppm", confidenceKey: null },
  alk: { label: "Total Alkalinity", unit: "ppm", confidenceKey: "__alkConfidence" },
  cya: { label: "CYA", unit: "ppm", confidenceKey: "__cyaConfidence" },
  hardness: { label: "Total Hardness", unit: "ppm", confidenceKey: "__hardnessConfidence" },
  bromine: { label: "Bromine", unit: "ppm", confidenceKey: "__bromineConfidence" }
};

const CONTEXT_LABELS = {
  chlorineTablets: "chlorine tablets/trichlor",
  liquidChlorine: "liquid chlorine",
  shock: "shock",
  stabilizer: "stabilizer",
  phReducer: "pH reducer/acid",
  phIncreaser: "pH increaser/soda ash",
  alkalinityAdjustment: "alkalinity adjustment",
  freshWater: "fresh water or drain/refill",
  aeration: "aeration",
  none: "none of these"
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function confidenceLabel(score) {
  if (score >= 0.78) return "High";
  if (score >= 0.52) return "Medium";
  return "Low";
}

function severityRank(severity) {
  return { Info: 0, Caution: 1, Warning: 2, Critical: 3 }[severity] ?? 0;
}

function maxSeverity(a, b) {
  return severityRank(b) > severityRank(a) ? b : a;
}

function latestHistory(history, key) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const value = toNumber(history[i]?.[key]);
    if (value != null) return { ...history[i], value };
  }
  return null;
}

function hasContext(context, keys) {
  const selected = Array.isArray(context?.recentActions) ? context.recentActions : [];
  if (selected.includes("none")) return false;
  return keys.some(key => selected.includes(key));
}

function padDebug(vals, key) {
  return vals?.__padDebug?.[key] || null;
}

function rawConfidenceScore(vals, key) {
  if (key === "combinedCl") {
    const fc = toNumber(vals?.__freeClConfidence);
    const tc = toNumber(vals?.__totalClConfidence);
    if (fc == null && tc == null) return 0.7;
    return Math.min(fc ?? 0.7, tc ?? 0.7);
  }
  const confKey = PARAMS[key]?.confidenceKey;
  const direct = confKey ? toNumber(vals?.[confKey]) : null;
  if (direct != null) return clamp(direct, 0, 1);
  const debug = padDebug(vals, key);
  if (debug?.confidence != null) return clamp(Number(debug.confidence), 0, 1);
  return 0.7;
}

function applyAdjustment(check, { code, penalty = 0.1, severity = "Caution", status = "Review", note }) {
  if (!check.reasonCodes.includes(code)) check.reasonCodes.push(code);
  check.adjustedScore = clamp(check.adjustedScore - penalty, 0, 1);
  check.severity = maxSeverity(check.severity, severity);
  check.status = status;
  if (note) check.notes.push(note);
}

function createCheck(vals, key, measuredValue) {
  const rawScore = rawConfidenceScore(vals, key);
  const param = PARAMS[key];
  return {
    parameter: param.label,
    key,
    measuredValue,
    unit: param.unit,
    rawConfidence: confidenceLabel(rawScore),
    adjustedConfidence: confidenceLabel(rawScore),
    rawScore,
    adjustedScore: rawScore,
    status: "Plausible",
    severity: "Info",
    reasonCodes: [],
    message: "",
    recommendedAction: "",
    notes: []
  };
}

function getHistoryChange(history, key, currentValue) {
  const previous = latestHistory(history, key);
  if (!previous || currentValue == null) return null;
  return {
    previousValue: previous.value,
    previousAt: previous.t || null,
    change: currentValue - previous.value,
    absChange: Math.abs(currentValue - previous.value),
    hours: previous.t ? Math.max(0, (Date.now() - previous.t) / 3600000) : null
  };
}

function buildMessage(check) {
  const valueText = `${check.measuredValue}${check.unit ? ` ${check.unit}` : ""}`;
  if (check.key === "cya" && check.reasonCodes.includes("UNLIKELY_HISTORY_JUMP")) {
    return {
      message: `CYA changed faster than expected, and this scan does not strongly support ${valueText}.`,
      action: "Retest in indirect daylight or confirm with a turbidity CYA test before adding stabilizer or draining water."
    };
  }
  if (check.key === "ph" && check.reasonCodes.includes("UNLIKELY_HISTORY_JUMP")) {
    return {
      message: `pH moved unusually quickly compared with the previous test.`,
      action: "Rescan or confirm with a fresh strip unless acid, soda ash, aeration, or alkalinity changes were made."
    };
  }
  if (check.key === "combinedCl" && check.reasonCodes.includes("CHEMISTRY_RELATIONSHIP_WARNING")) {
    return {
      message: `Combined chlorine is elevated, which can mean chloramines are present.`,
      action: "Consider oxidation/shock guidance if the reading is confident; retest first if the chlorine pads were low confidence."
    };
  }
  if (check.reasonCodes.includes("LOW_IMAGE_QUALITY")) {
    return {
      message: `${check.parameter} has reduced confidence because scan quality was low.`,
      action: "Move to indirect daylight, avoid glare, and rescan."
    };
  }
  if (check.reasonCodes.includes("LOW_DELTA_E_SEPARATION")) {
    return {
      message: `${check.parameter} is close to another chart color, so the match is ambiguous.`,
      action: "Rescan with neutral lighting or confirm before making a large chemical adjustment."
    };
  }
  return {
    message: `${check.parameter} appears plausible at ${valueText}.`,
    action: "Use normal pool-care judgment and retest after chemical changes."
  };
}

function finaliseCheck(check) {
  check.adjustedConfidence = confidenceLabel(check.adjustedScore);
  const content = buildMessage(check);
  check.message = content.message;
  check.recommendedAction = content.action;
  if (check.adjustedConfidence === "Low" && check.status === "Plausible") check.status = "Low confidence";
  return check;
}

function evaluatePadEvidence(vals, key, check, scanQuality) {
  const debug = padDebug(vals, key);
  if (!debug) return;
  const best = toNumber(debug.bestDeltaE);
  const second = toNumber(debug.secondDeltaE);
  const variance = toNumber(debug.variance);
  if (best != null && second != null && second - best < 2.2) {
    applyAdjustment(check, {
      code: "LOW_DELTA_E_SEPARATION",
      penalty: 0.16,
      severity: "Caution",
      status: "Ambiguous",
      note: `Best Delta-E ${best}; second-best Delta-E ${second}.`
    });
  }
  if (variance != null && variance > 14) {
    applyAdjustment(check, {
      code: "HIGH_FRAME_VARIANCE",
      penalty: 0.12,
      severity: "Caution",
      status: "Ambiguous",
      note: `Pad variance ${variance}.`
    });
  }
  if ((scanQuality?.score ?? 100) < 62) {
    applyAdjustment(check, {
      code: "LOW_IMAGE_QUALITY",
      penalty: 0.18,
      severity: "Caution",
      status: "Review"
    });
  }
}

function evaluateHistory(vals, history, context, check) {
  const current = toNumber(check.measuredValue);
  const change = getHistoryChange(history, check.key, current);
  if (!change) return;
  check.priorValue = change.previousValue;
  check.change = Number(change.change.toFixed(2));

  if (check.key === "cya" && change.absChange > 30 && !hasContext(context, ["stabilizer", "chlorineTablets", "shock", "freshWater"])) {
    applyAdjustment(check, {
      code: "UNLIKELY_HISTORY_JUMP",
      penalty: 0.24,
      severity: "Caution",
      status: "Suspicious",
      note: `Previous reliable CYA was ${change.previousValue} ppm; change is ${Math.round(change.change)} ppm.`
    });
  }

  if (check.key === "ph" && change.hours != null && change.hours < 24 && change.absChange > 0.4 && !hasContext(context, ["phReducer", "phIncreaser", "aeration", "alkalinityAdjustment"])) {
    applyAdjustment(check, {
      code: "UNLIKELY_HISTORY_JUMP",
      penalty: 0.18,
      severity: "Caution",
      status: "Suspicious",
      note: `Previous pH was ${change.previousValue}; change is ${change.change.toFixed(2)} in ${change.hours.toFixed(1)} hours.`
    });
  }
}

function evaluateChemistry(vals, check) {
  if (check.key !== "combinedCl") return;
  const cc = toNumber(check.measuredValue);
  if (cc != null && cc > 0.5) {
    applyAdjustment(check, {
      code: "CHEMISTRY_RELATIONSHIP_WARNING",
      penalty: cc > 1 ? 0.08 : 0.03,
      severity: cc > 1 ? "Warning" : "Caution",
      status: "Needs attention",
      note: `TC exceeds FC by ${cc.toFixed(2)} ppm.`
    });
  }
}

function evaluateExtremeGuards(vals, check) {
  if (check.key === "cya" && toNumber(vals?.cya) > 100 && check.adjustedScore < 0.78) {
    applyAdjustment(check, {
      code: "EXTREME_RECOMMENDATION_GUARD",
      penalty: 0.10,
      severity: "Warning",
      status: "Confirm before action",
      note: "Drain/refill guidance should wait for a high-confidence or confirmed CYA result."
    });
  }
  if (check.key === "ph" && (toNumber(vals?.ph) < 6.8 || toNumber(vals?.ph) > 8.2) && check.adjustedScore < 0.78) {
    applyAdjustment(check, {
      code: "EXTREME_RECOMMENDATION_GUARD",
      penalty: 0.08,
      severity: "Caution",
      status: "Confirm before action",
      note: "Large acid/base dose guidance should wait for a confident pH result."
    });
  }
}

function healthStatus(vals) {
  let score = 100;
  if (toNumber(vals.ph) < 7.2 || toNumber(vals.ph) > 7.8) score -= 12;
  if (toNumber(vals.freeCl) < 1 || toNumber(vals.freeCl) > 5) score -= 12;
  if (toNumber(vals.alk) < 80 || toNumber(vals.alk) > 120) score -= 10;
  if (toNumber(vals.cya) < 30 || toNumber(vals.cya) > 100) score -= 12;
  if (toNumber(vals.hardness) < 100 || toNumber(vals.hardness) > 350) score -= 6;
  return clamp(score, 0, 100);
}

export function runStripSanityCheck(vals, context = {}) {
  const history = Array.isArray(context.history) ? context.history : [];
  const recentActions = Array.isArray(context.recentActions) ? context.recentActions : [];
  const scanQuality = vals?.__scanQuality || null;
  const checks = [];
  const values = {
    ph: vals.ph,
    freeCl: vals.freeCl,
    totalCl: vals.totalCl,
    combinedCl: Math.max(0, (toNumber(vals.totalCl) || 0) - (toNumber(vals.freeCl) || 0)),
    alk: vals.alk,
    cya: vals.cya,
    hardness: vals.hardness,
    bromine: vals.bromine
  };

  Object.entries(values).forEach(([key, measuredValue]) => {
    if (measuredValue == null || Number.isNaN(Number(measuredValue))) return;
    const check = createCheck(vals, key, Number(measuredValue));
    evaluatePadEvidence(vals, key, check, scanQuality);
    evaluateHistory(vals, history, { recentActions }, check);
    evaluateChemistry(vals, check);
    evaluateExtremeGuards(vals, check);
    checks.push(finaliseCheck(check));
  });

  const suspicious = checks.filter(check => check.status !== "Plausible" || check.adjustedConfidence === "Low");
  const score = healthStatus(vals);
  const avgConfidence = checks.length
    ? checks.reduce((sum, check) => sum + check.adjustedScore, 0) / checks.length
    : 0.5;
  const scoreConfidence = confidenceLabel(avgConfidence);
  const reasonCodes = Array.from(new Set(checks.flatMap(check => check.reasonCodes)));
  const asksForContext = reasonCodes.includes("UNLIKELY_HISTORY_JUMP") && !recentActions.length;

  return {
    source: "strip",
    createdAt: new Date().toISOString(),
    poolHealthScore: Math.round(score),
    scoreConfidence,
    summary: suspicious.length
      ? `Review ${suspicious.length} item${suspicious.length === 1 ? "" : "s"} before dosing.`
      : "Readings look internally consistent.",
    checks,
    reasonCodes,
    asksForContext,
    contextQuestion: asksForContext
      ? {
          prompt: "Did you add or change anything since your last test?",
          options: Object.entries(CONTEXT_LABELS).map(([value, label]) => ({ value, label }))
        }
      : null
  };
}
