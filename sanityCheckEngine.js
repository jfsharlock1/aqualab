const PARAMS = {
  ph: { label: "pH", unit: "", confidenceKey: "__phConfidence", safetyImpact: 8 },
  freeCl: { label: "Free Chlorine", unit: "ppm", confidenceKey: "__freeClConfidence", safetyImpact: 10 },
  totalCl: { label: "Total Chlorine", unit: "ppm", confidenceKey: "__totalClConfidence", safetyImpact: 7 },
  combinedCl: { label: "Combined Chlorine", unit: "ppm", confidenceKey: null, safetyImpact: 7 },
  alk: { label: "Total Alkalinity", unit: "ppm", confidenceKey: "__alkConfidence", safetyImpact: 5 },
  cya: { label: "CYA", unit: "ppm", confidenceKey: "__cyaConfidence", safetyImpact: 9 },
  hardness: { label: "Total Hardness", unit: "ppm", confidenceKey: "__hardnessConfidence", safetyImpact: 4 },
  bromine: { label: "Bromine", unit: "ppm", confidenceKey: "__bromineConfidence", safetyImpact: 6 }
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

const APPEARANCE_ADJUSTMENTS = {
  crystalClear: 4,
  clear: 2,
  slightlyDull: -6,
  slightlyCloudy: -12,
  cloudy: -20,
  veryCloudy: -30,
  greenTint: -35,
  lightGreen: -45,
  darkGreen: -60,
  brownTea: -30
};

const APPEARANCE_LABELS = {
  crystalClear: "Crystal Clear",
  clear: "Clear",
  slightlyDull: "Slightly Dull",
  slightlyCloudy: "Slightly Cloudy",
  cloudy: "Cloudy",
  veryCloudy: "Very Cloudy",
  greenTint: "Green Tint",
  lightGreen: "Light Green",
  darkGreen: "Dark Green",
  brownTea: "Brown / Tea Colored"
};

const TROUBLED_APPEARANCES = new Set(["cloudy", "veryCloudy", "greenTint", "lightGreen", "darkGreen", "brownTea"]);
const CLEAR_APPEARANCES = new Set(["crystalClear", "clear"]);

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

function confidenceRisk(confidence) {
  return { Low: 2, Medium: 1, High: 0 }[confidence] ?? 1;
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

function valueRange(vals, key) {
  const legacy = ({
    ph: vals?.__phRange,
    freeCl: vals?.__freeClRange,
    totalCl: vals?.__totalClRange,
    bromine: vals?.__bromineRange,
    hardness: vals?.__hardnessRange,
    alk: vals?.__alkRange,
    cya: vals?.__cyaRange
  })[key] || null;
  const range = vals?.__padRanges?.[key] || legacy;
  if (!Array.isArray(range) || range.length < 2) return null;
  const a = toNumber(range[0]);
  const b = toNumber(range[1]);
  if (a == null || b == null) return null;
  return [Math.min(a, b), Math.max(a, b)];
}

function formatRangeNumber(value) {
  const n = toNumber(value);
  if (n == null) return `${value}`;
  return `${Number(n.toFixed(Math.abs(n) < 10 && !Number.isInteger(n) ? 1 : 0))}`;
}

function displayValue(vals, key, value) {
  const range = valueRange(vals, key);
  const unit = PARAMS[key]?.unit || "";
  const text = range ? `${formatRangeNumber(range[0])}–${formatRangeNumber(range[1])}` : formatRangeNumber(value);
  return unit ? `${text} ${unit}` : text;
}

function rangeState(vals, key, value, min, max) {
  const range = valueRange(vals, key) || [toNumber(value), toNumber(value)];
  const low = range[0];
  const high = range[1];
  if (low == null || high == null) return "unknown";
  if (high < min) return "low";
  if (low > max) return "high";
  if (low < min) return "slightlyLow";
  if (high > max) return "slightlyHigh";
  return "good";
}

function getPoolGallons(context = {}) {
  const direct = toNumber(context.gallons);
  if (direct != null && direct > 0) return direct;
  const profile = context.poolContext || context.profile || context.poolProfile || {};
  const nested = toNumber(profile.gallons || profile.poolGallons || profile.volumeGallons);
  return nested != null && nested > 0 ? nested : null;
}

function formatDoseAmount(amount, unit = "oz") {
  const n = toNumber(amount);
  if (n == null || n <= 0) return null;
  if (unit === "flOz") {
    if (n >= 128) {
      const gallons = n / 128;
      return `${Number(gallons.toFixed(gallons >= 10 ? 1 : 2))} gal`;
    }
    return `${Number(n.toFixed(n >= 10 ? 0 : 1))} fl oz`;
  }
  if (n >= 16) {
    const pounds = n / 16;
    return `${Number(pounds.toFixed(pounds >= 10 ? 1 : 2))} lb`;
  }
  return `${Number(n.toFixed(n >= 10 ? 0 : 1))} oz`;
}

function confidenceTone(score, high, medium, cautious, low) {
  const n = clamp(Number(score ?? 0.7), 0, 1);
  if (n > 0.85) return high;
  if (n >= 0.7) return medium;
  if (n >= 0.5) return cautious;
  return low;
}

function treatmentItem({ key, priority = "Medium", title, chemical, amountOz = null, amountUnit = "oz", amountText = null, reason, target, confidenceScore = 0.7, retest = "Retest in 4-24 hours", confidenceNote = "" }) {
  const confidence = confidenceLabel(confidenceScore);
  return {
    key,
    priority,
    title,
    chemical,
    amountOz: amountOz == null ? null : Number(Number(amountOz).toFixed(2)),
    amountText: amountText || (amountOz == null ? "Enter pool volume to calculate exact dosing." : formatDoseAmount(amountOz, amountUnit)),
    reason,
    target,
    confidence,
    confidenceScore: Number(clamp(confidenceScore, 0, 1).toFixed(2)),
    confidenceNote,
    retest
  };
}

function buildTreatmentRecommendations(vals, context = {}, history = []) {
  const treatments = [];
  const gallons = getPoolGallons(context);
  const factor10k = gallons ? gallons / 10000 : null;
  const recentActions = Array.isArray(context.recentActions) ? context.recentActions : [];
  const hasRecent = keys => recentActions.some(action => keys.includes(action));
  const push = item => treatments.push(treatmentItem(item));

  const ph = toNumber(vals.ph);
  const phConfidence = rawConfidenceScore(vals, "ph");
  const phState = rangeState(vals, "ph", ph, 7.2, 7.8);
  if (ph != null && phState === "low") {
    const correction = Math.min(0.4, Math.max(0, 7.2 - ph));
    const oz = factor10k ? (correction / 0.2) * 6 * factor10k : null;
    const recent = hasRecent(["phIncreaser", "phReducer", "alkalinityAdjustment"]);
    push({
      key: "phUp",
      priority: ph < 6.8 ? "High" : "Medium",
      title: "Raise pH",
      chemical: "pH increaser / soda ash",
      amountOz: oz,
      reason: "pH is below the target range.",
      target: "Raise pH toward 7.2-7.6",
      confidenceScore: phConfidence,
      confidenceNote: recent
        ? "A pH product was reported recently. Retest before another large pH correction."
        : confidenceTone(phConfidence, "", "", "Use a modest correction and retest.", "pH appears low, but scan quality is limited. Verify before a large pH adjustment."),
      retest: "Retest in 4-24 hours"
    });
  } else if (ph != null && phState === "slightlyLow") {
    push({
      key: "phReviewLow",
      priority: "Low",
      title: "pH is near the low end",
      chemical: "No large pH dose",
      amountOz: null,
      amountText: "Use only a modest correction if needed.",
      reason: `pH is reading as an approximate range (${displayValue(vals, "ph", ph)}).`,
      target: "Keep pH around 7.2-7.6",
      confidenceScore: phConfidence,
      confidenceNote: "Range overlaps the target. Avoid large exact-dose changes from this value alone.",
      retest: "Retest after circulation if you make a small correction"
    });
  } else if (ph != null && phState === "high") {
    const correction = Math.min(0.4, Math.max(0, ph - 7.6));
    const oz = factor10k ? (correction / 0.2) * 4 * factor10k : null;
    const recent = hasRecent(["phReducer", "phIncreaser", "alkalinityAdjustment"]);
    push({
      key: "phDown",
      priority: ph > 8.2 ? "High" : "Medium",
      title: "Lower pH",
      chemical: "pH reducer / dry acid",
      amountOz: oz,
      reason: "pH is above the target range.",
      target: "Lower pH toward 7.2-7.6",
      confidenceScore: phConfidence,
      confidenceNote: recent
        ? "A pH product was reported recently. Retest before another large pH correction."
        : confidenceTone(phConfidence, "", "", "Use a modest correction and retest.", "pH appears high, but scan quality is limited. Verify before a large pH adjustment."),
      retest: "Retest in 4-24 hours"
    });
  } else if (ph != null && phState === "slightlyHigh") {
    push({
      key: "phReviewHigh",
      priority: "Low",
      title: "pH is near the high end",
      chemical: "No large pH dose",
      amountOz: null,
      amountText: "Use only a modest correction if needed.",
      reason: `pH is reading as an approximate range (${displayValue(vals, "ph", ph)}).`,
      target: "Keep pH around 7.2-7.6",
      confidenceScore: phConfidence,
      confidenceNote: "Range overlaps the target. Avoid large exact-dose changes from this value alone.",
      retest: "Retest after circulation if you make a small correction"
    });
  }

  const freeCl = toNumber(vals.freeCl);
  const cya = toNumber(vals.cya);
  const fcConfidence = rawConfidenceScore(vals, "freeCl");
  const chlorineTarget = cya == null || cya <= 50 ? 3 : cya <= 80 ? 5 : 7;
  const cyaStateForChlorine = rangeState(vals, "cya", cya, 30, 80);
  if (cya != null && cyaStateForChlorine === "high") {
    treatments.push(treatmentItem({
      key: "highCyaNote",
      priority: "Medium",
      title: "Stabilizer is high",
      chemical: "No added stabilizer",
      amountOz: null,
      amountText: "No stabilizer dose recommended.",
      reason: "High CYA requires a higher free chlorine target.",
      target: `Target free chlorine: ${chlorineTarget} ppm`,
      confidenceScore: rawConfidenceScore(vals, "cya"),
      confidenceNote: "Consider partial drain/refill guidance if confirmed.",
      retest: "Confirm CYA before water replacement decisions"
    }));
  }
  const fcState = rangeState(vals, "freeCl", freeCl, 1, chlorineTarget);
  if (freeCl != null && (fcState === "low" || fcState === "slightlyLow")) {
    const ppmIncrease = Math.max(0, chlorineTarget - freeCl);
    const flOz = factor10k ? factor10k * (ppmIncrease / 10) * 128 : null;
    const recent = hasRecent(["liquidChlorine", "shock", "chlorineTablets"]);
    push({
      key: "liquidChlorine",
      priority: freeCl < 1 ? "High" : "Medium",
      title: fcState === "slightlyLow" ? "Free chlorine may be low" : "Raise free chlorine",
      chemical: "10% liquid chlorine",
      amountOz: flOz,
      amountUnit: "flOz",
      reason: fcState === "slightlyLow" ? `Free chlorine is reading as an approximate range (${displayValue(vals, "freeCl", freeCl)}).` : "Free chlorine is below the target for the current CYA level.",
      target: `Target free chlorine: ${chlorineTarget} ppm`,
      confidenceScore: fcConfidence,
      confidenceNote: recent
        ? "Chlorine or shock was reported recently. Retest before adding more unless water is cloudy or green."
        : confidenceTone(fcConfidence, "", "", "Small corrective dosing may still be appropriate; retest after circulation.", "Chlorine appears low, but scan quality is limited. Verify chlorine before a large sanitizer adjustment."),
      retest: "Retest after 30-60 minutes of circulation"
    });
  }

  const alk = toNumber(vals.alk);
  const alkConfidence = rawConfidenceScore(vals, "alk");
  const alkState = rangeState(vals, "alk", alk, 80, 120);
  if (alk != null && (alkState === "low" || alkState === "slightlyLow")) {
    const ppmIncrease = Math.max(0, 100 - alk);
    const oz = factor10k ? (ppmIncrease / 10) * 1.5 * 16 * factor10k : null;
    push({
      key: "alkUp",
      priority: "Medium",
      title: alkState === "slightlyLow" ? "Alkalinity is near the low end" : "Raise alkalinity",
      chemical: "Alkalinity increaser / baking soda",
      amountOz: oz,
      reason: alkState === "slightlyLow" ? `Total alkalinity is reading as an approximate range (${displayValue(vals, "alk", alk)}).` : "Total alkalinity is below the target range.",
      target: "Raise alkalinity toward 80-120 ppm",
      confidenceScore: alkConfidence,
      confidenceNote: confidenceTone(alkConfidence, "", "", "Use a gradual correction and retest.", "Alkalinity appears low, but scan quality is limited. Verify before a large adjustment."),
      retest: "Retest in 4-24 hours"
    });
  } else if (alk != null && rangeState(vals, "alk", alk, 80, 140) === "high") {
    push({
      key: "alkHigh",
      priority: "Medium",
      title: "Lower alkalinity gradually",
      chemical: "Acid plus aeration process",
      amountOz: null,
      amountText: "No single-dose correction recommended.",
      reason: "Total alkalinity is above the normal range.",
      target: "Lower alkalinity gradually; do not make one large correction.",
      confidenceScore: alkConfidence,
      confidenceNote: "Manage pH carefully and aerate between small acid additions.",
      retest: "Retest after each small adjustment cycle"
    });
  }

  const cyaConfidence = rawConfidenceScore(vals, "cya");
  const cyaState = rangeState(vals, "cya", cya, 30, 100);
  if (cya != null && cyaState === "low") {
    const recent = hasRecent(["stabilizer", "chlorineTablets"]);
    if (cyaConfidence < 0.6 || recent) {
      push({
        key: "cyaRetest",
        priority: "Medium",
        title: "Verify stabilizer",
        chemical: "No stabilizer dose yet",
        amountOz: null,
        amountText: "No stabilizer dose until verified.",
        reason: recent ? "Stabilizer or tablets were reported recently." : "CYA appears low, but scan quality is limited.",
        target: "Confirm CYA before adding stabilizer",
        confidenceScore: cyaConfidence,
        confidenceNote: "Verify before adjusting stabilizer.",
        retest: "Retest tomorrow or with a dedicated CYA test"
      });
    } else {
      const ppmIncrease = Math.max(0, 40 - cya);
      const oz = factor10k ? (ppmIncrease / 10) * 13 * factor10k : null;
      push({
        key: "cyaUp",
        priority: "Medium",
        title: "Raise stabilizer",
        chemical: "Cyanuric acid / stabilizer",
        amountOz: oz,
        reason: "CYA is below the target range for a standard chlorine pool.",
        target: "Raise CYA toward 30-50 ppm",
        confidenceScore: cyaConfidence,
        confidenceNote: "",
        retest: "Retest in 24-48 hours"
      });
    }
  } else if (cya != null && cyaState === "slightlyLow") {
    push({
      key: "cyaReview",
      priority: "Low",
      title: "Stabilizer is near normal",
      chemical: "No stabilizer dose",
      amountOz: null,
      amountText: "No stabilizer dose recommended from this range.",
      reason: `CYA is reading as an approximate range (${displayValue(vals, "cya", cya)}) that overlaps normal.`,
      target: "Keep CYA around 30-50 ppm",
      confidenceScore: cyaConfidence,
      confidenceNote: "Range overlaps the normal band. Do not add stabilizer from this scan alone.",
      retest: "Check again on your normal schedule"
    });
  } else if (cya != null && cyaState === "high") {
    push({
      key: "cyaHigh",
      priority: "High",
      title: "Reduce stabilizer level",
      chemical: "Partial drain/refill guidance",
      amountOz: null,
      amountText: "No chemical dose recommended.",
      reason: "CYA is high; adding more chemicals will not lower it.",
      target: "Bring CYA back toward 30-50 ppm",
      confidenceScore: cyaConfidence,
      confidenceNote: cyaConfidence < 0.6 ? "CYA scan quality is limited. Confirm before water replacement decisions." : "",
      retest: "Confirm CYA before drain/refill decisions"
    });
  }

  const hardness = toNumber(vals.hardness);
  const hardnessConfidence = rawConfidenceScore(vals, "hardness");
  const poolType = context.poolType || context.siteType || context.poolContext?.poolType || "";
  const surface = context.surfaceType || context.surfaceCondition || "";
  const calciumSupported = /plaster|concrete|gunite|quartz|pebble/i.test(surface);
  if (hardness != null && rangeState(vals, "hardness", hardness, 200, 400) === "low" && calciumSupported) {
    push({
      key: "hardnessUp",
      priority: "Low",
      title: "Review calcium hardness",
      chemical: "Calcium hardness increaser",
      amountOz: null,
      amountText: "Confirm surface type before dosing.",
      reason: "Hardness may be low for plaster/concrete surfaces.",
      target: "Plaster/concrete pools often target roughly 200-400 ppm",
      confidenceScore: hardnessConfidence,
      confidenceNote: "Surface type matters. Confirm pool surface before adding calcium.",
      retest: "Retest before adding calcium"
    });
  }

  return treatments;
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
    displayValue: displayValue(vals, key, measuredValue),
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
    notes: [],
    safetyImpact: param.safetyImpact
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

function buildMessage(check, context) {
  const valueText = check.displayValue || `${check.measuredValue}${check.unit ? ` ${check.unit}` : ""}`;
  const appearance = context?.waterAppearance;

  if (check.key === "freeCl" && check.reasonCodes.includes("CLOUDY_OR_GREEN_LOW_CHLORINE")) {
    if (check.adjustedConfidence === "Low") {
      return {
        message: "Water appearance and chlorine may be pointing in different directions.",
        action: "Verify chlorine before large sanitizer adjustments."
      };
    }
    return {
      message: "Cloudy or green water with low free chlorine needs attention.",
      action: "Begin corrective chlorination using product-label guidance for your pool volume."
    };
  }
  if (check.reasonCodes.includes("CLEAR_WATER_LOW_CONFIDENCE")) {
    return {
      message: `${check.parameter} is approximate, while the water appearance looks good.`,
      action: "Use the approximate result for small guidance and verify before large adjustments."
    };
  }
  if (check.reasonCodes.includes("WATER_APPEARANCE_DECLINING")) {
    return {
      message: "Water appearance appears to be declining compared with recent history.",
      action: "Retest and inspect circulation, filtration, sanitizer level, and debris load."
    };
  }
  if (check.key === "cya" && check.reasonCodes.includes("UNLIKELY_HISTORY_JUMP")) {
    return {
      message: `CYA changed faster than expected, and this scan does not strongly support ${valueText}.`,
      action: "Retest in indirect daylight or confirm with a turbidity CYA test before adding stabilizer or draining water."
    };
  }
  if (check.key === "ph" && check.reasonCodes.includes("UNLIKELY_HISTORY_JUMP")) {
    return {
      message: "pH moved unusually quickly compared with the previous test.",
      action: "Rescan or confirm with a fresh strip unless acid, soda ash, aeration, or alkalinity changes were made."
    };
  }
  if (check.key === "combinedCl" && check.reasonCodes.includes("CHEMISTRY_RELATIONSHIP_WARNING")) {
    return {
      message: "Combined chlorine is elevated, which can mean chloramines are present.",
      action: "Consider oxidation/shock guidance only if both chlorine pads look reliable; otherwise retest chlorine first."
    };
  }
  if (check.key === "bromine" && check.reasonCodes.includes("POSSIBLE_FALSE_BROMINE_MATCH")) {
    return {
      message: "Bromine is very high while free chlorine is low or normal, so this may be a false bromine color match.",
      action: "Confirm sanitizer with a fresh strip or a bromine-specific test before treating this as very high bromine."
    };
  }
  if (check.reasonCodes.includes("LOW_IMAGE_QUALITY")) {
    return {
      message: `${check.parameter} has reduced confidence because scan quality was low.`,
      action: "Move to indirect daylight, avoid glare, and rescan."
    };
  }
  if (check.reasonCodes.includes("LOW_SAMPLE_QUALITY")) {
    return {
      message: `${check.parameter} pad sample quality is low.`,
      action: "Reposition the marker near the center of the pad before large adjustments."
    };
  }
  if (check.reasonCodes.includes("AMBIGUOUS_ADJACENT_MATCH")) {
    return {
      message: `${check.parameter} is an approximate range (${valueText}).`,
      action: "Use the displayed range for guidance; avoid large exact-dose changes from this value alone."
    };
  }
  if (check.reasonCodes.includes("LOW_DELTA_E_SEPARATION")) {
    return {
      message: `${check.parameter} is close to a non-adjacent chart color, so the match is uncertain.`,
      action: "Verify with a retest before large adjustments."
    };
  }
  return {
    message: `${check.parameter} appears plausible at ${valueText}${appearance ? ` with ${APPEARANCE_LABELS[appearance] || appearance} water noted` : ""}.`,
    action: "Use normal pool-care judgment and retest after chemical changes."
  };
}

function finaliseCheck(check, context) {
  check.adjustedConfidence = confidenceLabel(check.adjustedScore);
  const content = buildMessage(check, context);
  check.message = content.message;
  check.recommendedAction = content.action;
  if (check.adjustedConfidence === "Low" && check.status === "Plausible") check.status = "Approximate";
  return check;
}

function evaluatePadEvidence(vals, key, check, scanQuality) {
  const debug = padDebug(vals, key);
  if (debug) {
    const best = toNumber(debug.bestDeltaE);
    const second = toNumber(debug.secondDeltaE);
    const variance = toNumber(debug.variance);
    if (debug.usableAmbiguous || debug.reasonCode === "AMBIGUOUS_ADJACENT_MATCH") {
      applyAdjustment(check, {
        code: "AMBIGUOUS_ADJACENT_MATCH",
        penalty: 0.04,
        severity: "Info",
        status: "Approximate range",
        note: `Best Delta-E ${best}; second-best Delta-E ${second}; gap ${debug.deltaEGap ?? Math.round((second - best) * 100) / 100}.`
      });
    } else if (debug.reasonCode === "LOW_SAMPLE_QUALITY" || debug.sampleQuality === "Low") {
      applyAdjustment(check, {
        code: "LOW_SAMPLE_QUALITY",
        penalty: 0.22,
        severity: "Caution",
        status: "Approximate",
        note: `Sample quality low; LAB variance ${debug.sampleLabVariance ?? "-"}; rejected ${debug.sampleRejectedPct ?? "-"}%.`
      });
    } else if (best != null && second != null && second - best < 2.2) {
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
  }
  const manualSelection = !!scanQuality?.details?.manualSelection;
  const colorConfidence = Number(scanQuality?.details?.colorConfidence ?? 1);
  if ((scanQuality?.score ?? 100) < 62 && (!manualSelection || colorConfidence < 0.55)) {
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
  const clearWater = !context?.waterAppearance || context.waterAppearance === "crystalClear";
  const quietContext = !hasContext(context, ["phReducer", "phIncreaser", "aeration", "alkalinityAdjustment", "stabilizer", "chlorineTablets", "shock", "freshWater"]);
  const jumpThresholds = {
    freeCl: 4,
    totalCl: 4,
    bromine: 6,
    alk: 60,
    hardness: 100,
    cya: 40
  };
  const largeJump = jumpThresholds[check.key] != null && change.hours != null && change.hours < 48 && change.absChange >= jumpThresholds[check.key];
  if (largeJump && clearWater && quietContext && !check.reasonCodes.includes("UNLIKELY_HISTORY_JUMP")) {
    applyAdjustment(check, {
      code: "UNLIKELY_HISTORY_JUMP",
      penalty: 0.16,
      severity: "Caution",
      status: "Suspicious",
      note: `Previous ${check.parameter} was ${change.previousValue}${check.unit ? ` ${check.unit}` : ""}; change is ${Math.round(change.change)}${check.unit ? ` ${check.unit}` : ""} in ${change.hours.toFixed(1)} hours.`
    });
  }

  if (check.key === "cya" && change.absChange > 30 && !check.reasonCodes.includes("UNLIKELY_HISTORY_JUMP") && !hasContext(context, ["stabilizer", "chlorineTablets", "shock", "freshWater"])) {
    applyAdjustment(check, {
      code: "UNLIKELY_HISTORY_JUMP",
      penalty: 0.24,
      severity: "Caution",
      status: "Suspicious",
      note: `Previous reliable CYA was ${change.previousValue} ppm; change is ${Math.round(change.change)} ppm.`
    });
  }

  if (check.key === "ph" && change.hours != null && change.hours < 24 && change.absChange > 0.4 && !check.reasonCodes.includes("UNLIKELY_HISTORY_JUMP") && !hasContext(context, ["phReducer", "phIncreaser", "aeration", "alkalinityAdjustment"])) {
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
  if (check.key === "combinedCl") {
    const cc = toNumber(check.measuredValue);
    if (cc == null || cc <= 0.5) return;
    applyAdjustment(check, {
      code: "CHEMISTRY_RELATIONSHIP_WARNING",
      penalty: cc > 1 ? 0.08 : 0.03,
      severity: cc > 1 ? "Warning" : "Caution",
      status: "Needs attention",
      note: `TC exceeds FC by ${cc.toFixed(2)} ppm.`
    });
    return;
  }

  if (check.key === "bromine") {
    const bromine = toNumber(vals?.bromine);
    const freeCl = toNumber(vals?.freeCl);
    if (bromine != null && bromine >= 10 && freeCl != null && freeCl <= 3) {
      applyAdjustment(check, {
        code: "POSSIBLE_FALSE_BROMINE_MATCH",
        penalty: bromine >= 20 ? 0.24 : 0.16,
        severity: "Caution",
        status: "Possible false bromine match",
        note: `Bromine ${bromine.toFixed(1)} ppm with free chlorine ${freeCl.toFixed(2)} ppm.`
      });
    }
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

function appearanceRank(value) {
  return {
    crystalClear: 0,
    clear: 1,
    slightlyDull: 2,
    slightlyCloudy: 3,
    cloudy: 4,
    veryCloudy: 5,
    greenTint: 6,
    lightGreen: 7,
    darkGreen: 8,
    brownTea: 6
  }[value] ?? null;
}

function latestAppearance(history) {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const value = history[i]?.waterAppearance || history[i]?.poolContext?.waterAppearance;
    if (value) return value;
  }
  return null;
}

function createAppearanceCheck(context, history) {
  const appearance = context?.waterAppearance;
  if (!appearance) return null;
  const check = createCheck({}, "freeCl", APPEARANCE_LABELS[appearance] || appearance);
  check.parameter = "Water Appearance";
  check.key = "waterAppearance";
  check.unit = "";
  check.rawScore = 0.9;
  check.adjustedScore = 0.9;
  check.rawConfidence = "High";
  check.adjustedConfidence = "High";
  check.safetyImpact = TROUBLED_APPEARANCES.has(appearance) ? 8 : 3;

  const previous = latestAppearance(history);
  const previousRank = appearanceRank(previous);
  const currentRank = appearanceRank(appearance);
  if (previousRank != null && currentRank != null && currentRank - previousRank >= 2) {
    applyAdjustment(check, {
      code: "WATER_APPEARANCE_DECLINING",
      penalty: 0.05,
      severity: "Caution",
      status: "Needs attention",
      note: `Previous appearance was ${APPEARANCE_LABELS[previous] || previous}.`
    });
  }

  if (TROUBLED_APPEARANCES.has(appearance)) {
    check.status = "Needs attention";
    check.severity = maxSeverity(check.severity, "Caution");
    if (!check.reasonCodes.includes("WATER_APPEARANCE_CONCERN")) check.reasonCodes.push("WATER_APPEARANCE_CONCERN");
  }

  return finaliseCheck(check, context);
}

function evaluateContext(vals, context, history, checks) {
  const appearance = context?.waterAppearance;
  if (!appearance) return;

  const freeCl = checks.find(check => check.key === "freeCl");
  if (freeCl && TROUBLED_APPEARANCES.has(appearance) && toNumber(vals.freeCl) != null && toNumber(vals.freeCl) < 1) {
    applyAdjustment(freeCl, {
      code: "CLOUDY_OR_GREEN_LOW_CHLORINE",
      penalty: freeCl.adjustedConfidence === "Low" ? 0.08 : 0,
      severity: freeCl.adjustedConfidence === "Low" ? "Caution" : "Warning",
      status: "Needs attention",
      note: `${APPEARANCE_LABELS[appearance] || appearance} water with free chlorine below 1 ppm.`
    });
  }

  if (CLEAR_APPEARANCES.has(appearance)) {
    checks.forEach(check => {
      if (check.adjustedScore < 0.52 && check.safetyImpact >= 7) {
        applyAdjustment(check, {
          code: "CLEAR_WATER_LOW_CONFIDENCE",
          penalty: 0,
          severity: "Caution",
          status: "Approximate",
          note: `${APPEARANCE_LABELS[appearance]} water lowers urgency, but does not make unsafe chemistry safe.`
        });
      }
    });
  }

  const appearanceCheck = createAppearanceCheck(context, history);
  if (appearanceCheck && (appearanceCheck.reasonCodes.length || TROUBLED_APPEARANCES.has(appearance))) checks.push(appearanceCheck);
}

function healthStatus(vals, context = {}) {
  let chemistryScore = 100;
  if (toNumber(vals.ph) < 7.2 || toNumber(vals.ph) > 7.8) chemistryScore -= 12;
  if (toNumber(vals.freeCl) < 1 || toNumber(vals.freeCl) > 5) chemistryScore -= 12;
  if (toNumber(vals.alk) < 80 || toNumber(vals.alk) > 120) chemistryScore -= 10;
  if (toNumber(vals.cya) < 30 || toNumber(vals.cya) > 100) chemistryScore -= 12;
  if (toNumber(vals.hardness) < 100 || toNumber(vals.hardness) > 350) chemistryScore -= 6;

  const appearance = context?.waterAppearance;
  const appearanceAdjustment = APPEARANCE_ADJUSTMENTS[appearance] || 0;
  const score = clamp(chemistryScore + appearanceAdjustment, 0, 100);

  return {
    score,
    chemistryScore,
    appearanceAdjustment,
    waterAppearanceLabel: APPEARANCE_LABELS[appearance] || "Not provided"
  };
}

function sortedFindings(checks) {
  return checks
    .filter(check => check.severity !== "Info" || check.adjustedConfidence === "Low" || check.reasonCodes.length)
    .sort((a, b) => {
      const severityDiff = severityRank(b.severity) - severityRank(a.severity);
      if (severityDiff) return severityDiff;
      const confidenceDiff = confidenceRisk(b.adjustedConfidence) - confidenceRisk(a.adjustedConfidence);
      if (confidenceDiff) return confidenceDiff;
      return (b.safetyImpact || 0) - (a.safetyImpact || 0);
    });
}

function groupedLowConfidenceFinding(checks) {
  const low = checks.filter(check => check.adjustedConfidence === "Low" && check.key !== "waterAppearance" && !check.reasonCodes.includes("AMBIGUOUS_ADJACENT_MATCH"));
  if (low.length < 3) return null;
  return {
    parameter: "Scan Confidence",
    key: "groupedLowConfidence",
    measuredValue: `${low.length} readings`,
    unit: "",
    rawConfidence: "Low",
    adjustedConfidence: "Low",
    rawScore: 0.4,
    adjustedScore: 0.4,
    status: "Retest recommended",
    severity: "Caution",
    reasonCodes: ["LOW_IMAGE_QUALITY"],
    message: "Several readings have reduced confidence due to scan conditions.",
    recommendedAction: "Use readings cautiously and verify before large adjustments.",
    notes: low.map(check => check.parameter),
    safetyImpact: 9
  };
}

function buildSummaryState(score, scoreConfidence, findings, scanQuality) {
  const manualSelection = !!scanQuality?.details?.manualSelection;
  const colorConfidence = Number(scanQuality?.details?.colorConfidence ?? 0);
  const geometryConfidence = Number(scanQuality?.details?.geometryConfidence ?? 0);
  const trueLowFindings = findings.filter(check => check.adjustedConfidence === "Low" && !check.reasonCodes?.includes("AMBIGUOUS_ADJACENT_MATCH"));
  if ((scanQuality?.score ?? 100) < 40 && (!manualSelection || colorConfidence < 0.55)) return "Unknown / Failed Scan";
  if (scoreConfidence === "Low" && !(manualSelection && geometryConfidence >= 0.99 && colorConfidence >= 0.75 && trueLowFindings.length === 0)) return "Retest Recommended / Low Confidence";
  const needsAttention = findings.some(check => severityRank(check.severity) >= severityRank("Warning")) || score < 80;
  if (needsAttention) return scoreConfidence === "High" ? "Needs Attention / High Confidence" : "Needs Attention / Medium Confidence";
  return scoreConfidence === "High" ? "Healthy / High Confidence" : "Healthy / Medium Confidence";
}

function summaryCopy(summaryState, score, context, scanQuality = null) {
  const appearance = APPEARANCE_LABELS[context?.waterAppearance] || "Not provided";
  const manualSelection = !!scanQuality?.details?.manualSelection;
  const colorConfidence = Number(scanQuality?.details?.colorConfidence ?? 0);
  const geometryConfidence = Number(scanQuality?.details?.geometryConfidence ?? 0);
  if (manualSelection && geometryConfidence >= 0.99 && colorConfidence >= 0.75 && summaryState !== "Unknown / Failed Scan" && summaryState !== "Retest Recommended / Low Confidence") {
    return {
      summary: "Manual scan complete. Some values are approximate.",
      nextAction: "Use displayed ranges cautiously and make only modest changes until verified.",
      retestTiming: "Normal schedule, or sooner if water appearance changes"
    };
  }
  if (summaryState === "Unknown / Failed Scan") {
    return {
      summary: "Scan quality was too low to make a reliable pool health call.",
      nextAction: "Rescan in indirect daylight with the strip flat on a neutral background.",
      retestTiming: "Now"
    };
  }
  if (summaryState === "Retest Recommended / Low Confidence") {
    return {
      summary: `Pool health is estimated at ${score}/100, but some readings should be verified.`,
      nextAction: "Use readings cautiously and verify before large adjustments.",
      retestTiming: "Now"
    };
  }
  if (summaryState.startsWith("Needs Attention")) {
    return {
      summary: `Pool health is ${score}/100 with ${appearance} water noted. One or more items need attention.`,
      nextAction: TROUBLED_APPEARANCES.has(context?.waterAppearance) ? "Address sanitizer and filtration after verifying any uncertain readings." : "Review the top findings before making adjustments.",
      retestTiming: "After treatment or within 24 hours"
    };
  }
  return {
    summary: `Pool health is ${score}/100 with ${appearance} water noted. The current results look balanced overall.`,
    nextAction: "Looks good. Monitor chlorine and retest on your normal schedule.",
    retestTiming: "Tonight or tomorrow morning"
  };
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
    evaluateHistory(vals, history, { ...context, recentActions }, check);
    evaluateChemistry(vals, check);
    evaluateExtremeGuards(vals, check);
    checks.push(check);
  });

  evaluateContext(vals, context, history, checks);
  checks.forEach(check => finaliseCheck(check, context));

  const baseFindings = sortedFindings(checks);
  const grouped = groupedLowConfidenceFinding(checks);
  const allFindings = grouped ? [grouped, ...baseFindings.filter(check => check.adjustedConfidence !== "Low")] : baseFindings;
  const topFindings = allFindings.slice(0, 3);
  const health = healthStatus(vals, context);
  const avgConfidence = checks.length
    ? checks.reduce((sum, check) => sum + check.adjustedScore, 0) / checks.length
    : 0.5;
  const manualSelection = !!scanQuality?.details?.manualSelection;
  const colorConfidence = Number(scanQuality?.details?.colorConfidence ?? 0);
  const geometryConfidence = Number(scanQuality?.details?.geometryConfidence ?? 0);
  const trueLowCount = checks.filter(check => check.adjustedConfidence === "Low" && !check.reasonCodes.includes("AMBIGUOUS_ADJACENT_MATCH")).length;
  const ambiguousCount = checks.filter(check => check.reasonCodes.includes("AMBIGUOUS_ADJACENT_MATCH")).length;
  let scoreConfidence = confidenceLabel(avgConfidence);
  if (manualSelection && geometryConfidence >= 0.99 && colorConfidence >= 0.75 && trueLowCount === 0 && scoreConfidence === "Low") scoreConfidence = ambiguousCount > 2 ? "Medium" : "High";
  const reasonCodes = Array.from(new Set(checks.flatMap(check => check.reasonCodes)));
  const asksForContext = reasonCodes.includes("UNLIKELY_HISTORY_JUMP") && !recentActions.length;
  const summaryState = buildSummaryState(Math.round(health.score), scoreConfidence, allFindings, scanQuality);
  const summary = summaryCopy(summaryState, Math.round(health.score), context, scanQuality);
  const treatments = buildTreatmentRecommendations(vals, { ...context, recentActions }, history);

  return {
    source: "strip",
    createdAt: new Date().toISOString(),
    poolHealthScore: Math.round(health.score),
    chemistryScore: Math.round(health.chemistryScore),
    appearanceAdjustment: health.appearanceAdjustment,
    scoreConfidence,
    scoreConfidencePercent: Math.round(clamp(avgConfidence, 0, 1) * 100),
    summaryState,
    summary: summary.summary,
    nextAction: summary.nextAction,
    retestTiming: summary.retestTiming,
    waterAppearance: context.waterAppearance || "",
    waterAppearanceLabel: health.waterAppearanceLabel,
    recentRain: context.recentRain || "",
    poolUsage: context.poolUsage || "",
    surfaceCondition: context.surfaceCondition || "",
    checks,
    topFindings,
    allFindings,
    treatments,
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
