// scanner.js (EasyTest-only)
// Reverted UX: Preview + Crop shows BELOW the camera box (not overlaid)
// Features:
// - EasyTest 7-in-1 swatches
// - Upload/Take Photo -> Preview crop -> Use Crop -> Analyze (iOS reliable orientation handling)
// - Live camera capture (optional) + ROI crop attempt
// - White balance supported
// - Multiple camera selection + remembers device
// - Stabilization: pH/Alk/CYA range + snap
// - Hash-based caching: same image -> same result
// - Pad LAB/Delta-E diagnostics logged (for calibration + judge explanations)
// - “Clear Scan Cache (debug)” button support
// - Chlorine “inferred CC” when TC/FC corrected
// - Low-confidence scan gate (requires 7/7 pads)

import { runStripSanityCheck } from "./sanityCheckEngine.js";

// ================================================================
// 1) EasyTest configuration
// ================================================================

const EASYTEST_SWATCHES = {
  hardness: [
    { value: 0, rgb: [111, 146, 36] },
    { value: 25, rgb: [130, 113, 34] },
    { value: 50, rgb: [145, 96, 30] },
    { value: 120, rgb: [154, 69, 5] },
    { value: 250, rgb: [191, 53, 2] },
    { value: 425, rgb: [212, 58, 1] }
  ],
  totalCl: [
    { value: 0, rgb: [253, 247, 74] },
    { value: 0.5, rgb: [235, 245, 73] },
    { value: 1, rgb: [206, 239, 78] },
    { value: 3, rgb: [166, 230, 80] },
    { value: 5, rgb: [92, 223, 88] },
    { value: 10, rgb: [101, 216, 155] },
    { value: 20, rgb: [59, 217, 132] }
  ],
  freeCl: [
    { value: 0, rgb: [250, 250, 250] },
    { value: 0.5, rgb: [239, 222, 237] },
    { value: 1, rgb: [233, 223, 231] },
    { value: 3, rgb: [236, 175, 227] },
    { value: 5, rgb: [226, 128, 213] },
    { value: 10, rgb: [200, 58, 188] },
    { value: 20, rgb: [177, 61, 167] }
  ],
  bromine: [
    { value: 0, rgb: [248, 232, 236] },
    { value: 1, rgb: [237, 228, 229] },
    { value: 2, rgb: [249, 212, 218] },
    { value: 6, rgb: [250, 183, 204] },
    { value: 10, rgb: [254, 115, 171] },
    { value: 20, rgb: [252, 96, 170] },
    { value: 40, rgb: [247, 90, 157] }
  ],
  alk: [
    { value: 0, rgb: [254, 242, 94] },
    { value: 40, rgb: [217, 240, 75] },
    { value: 80, rgb: [159, 222, 114] },
    { value: 120, rgb: [57, 204, 155] },
    { value: 180, rgb: [25, 196, 193] },
    { value: 240, rgb: [0, 179, 203] },
    { value: 360, rgb: [1, 154, 221] }
  ],
  cya: [
    { value: 0, rgb: [204, 189, 152] },
    { value: 40, rgb: [244, 212, 137] }, // chart says 30-50 -> use 40
    { value: 100, rgb: [231, 158, 95] },
    { value: 150, rgb: [231, 128, 109] },
    { value: 240, rgb: [214, 144, 180] }
  ],
  ph: [
    { value: 6.0, rgb: [253, 216, 3] },
    { value: 6.4, rgb: [254, 204, 1] },
    { value: 6.8, rgb: [254, 176, 1] },
    { value: 7.2, rgb: [254, 167, 0] },
    { value: 7.6, rgb: [254, 146, 1] },
    { value: 8.2, rgb: [255, 69, 12] },
    { value: 9.0, rgb: [253, 3, 98] }
  ]
};

const EASYTEST_CFG = {
  name: "EasyTest 7-in-1",
  pads: [
    { key: "hardness", label: "Total Hardness", index: 0, swatches: EASYTEST_SWATCHES.hardness },
    { key: "freeCl", label: "Free Chlorine", index: 1, swatches: EASYTEST_SWATCHES.freeCl },
    { key: "bromine", label: "Bromine", index: 2, swatches: EASYTEST_SWATCHES.bromine },
    { key: "totalCl", label: "Total Chlorine", index: 3, swatches: EASYTEST_SWATCHES.totalCl },
    { key: "cya", label: "Cyanuric Acid", index: 4, swatches: EASYTEST_SWATCHES.cya },
    { key: "alk", label: "Total Alkalinity", index: 5, swatches: EASYTEST_SWATCHES.alk },
    { key: "ph", label: "pH", index: 6, swatches: EASYTEST_SWATCHES.ph }
  ]
};

// Pads needing extra stabilization
const PAD_STABILITY = {
  alk: { snap: 40, ambiguousRatio: 0.72, enableRange: true },
  cya: { snap: 20, ambiguousRatio: 0.75, enableRange: true },
  ph: { snap: 0.2, ambiguousRatio: 0.78, enableRange: true }
};

// ================================================================
// 2) Helpers
// ================================================================

function formatWeightOz(oz) {
  if (!isFinite(oz) || oz <= 0) return null;
  if (oz < 16) return `${oz.toFixed(1)} oz`;
  const lbs = oz / 16;
  if (lbs < 10) return `${lbs.toFixed(1)} lb`;
  return `${Math.round(lbs)} lb`;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function clamp255(value) {
  return Math.max(0, Math.min(255, Number(value) || 0));
}

function rgbToArray(rgb) {
  return [
    clamp255(Array.isArray(rgb) ? rgb[0] : rgb?.r),
    clamp255(Array.isArray(rgb) ? rgb[1] : rgb?.g),
    clamp255(Array.isArray(rgb) ? rgb[2] : rgb?.b)
  ];
}

function normalizeRgbObject(rgb, neutral = null) {
  const arr = rgbToArray(rgb);
  if (!neutral) return { r: arr[0], g: arr[1], b: arr[2] };

  const n = rgbToArray(neutral);
  const avg = (n[0] + n[1] + n[2]) / 3 || 1;
  return {
    r: clamp255(arr[0] * avg / Math.max(1, n[0])),
    g: clamp255(arr[1] * avg / Math.max(1, n[1])),
    b: clamp255(arr[2] * avg / Math.max(1, n[2]))
  };
}

function srgbChannelToLinear(value) {
  const v = clamp01(value / 255);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function rgbToLab(rgb) {
  const [r8, g8, b8] = rgbToArray(rgb);
  const r = srgbChannelToLinear(r8);
  const g = srgbChannelToLinear(g8);
  const b = srgbChannelToLinear(b8);

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750) / 1.00000;
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;
  const f = value => value > 0.008856 ? Math.cbrt(value) : (7.787 * value) + (16 / 116);

  const fx = f(x);
  const fy = f(y);
  const fz = f(z);

  return {
    l: (116 * fy) - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz)
  };
}

function deltaE76(lab1, lab2) {
  const dl = lab1.l - lab2.l;
  const da = lab1.a - lab2.a;
  const db = lab1.b - lab2.b;
  return Math.sqrt(dl * dl + da * da + db * db);
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

function rad2deg(rad) {
  return rad * (180 / Math.PI);
}

function deltaE2000(lab1, lab2) {
  if (!lab1 || !lab2) return Infinity;

  const L1 = lab1.l, a1 = lab1.a, b1 = lab1.b;
  const L2 = lab2.l, a2 = lab2.a, b2 = lab2.b;
  const kL = 1, kC = 1, kH = 1;
  const c1 = Math.sqrt(a1 * a1 + b1 * b1);
  const c2 = Math.sqrt(a2 * a2 + b2 * b2);
  const cBar = (c1 + c2) / 2;
  const cBar7 = Math.pow(cBar, 7);
  const g = 0.5 * (1 - Math.sqrt(cBar7 / (cBar7 + Math.pow(25, 7))));
  const a1p = (1 + g) * a1;
  const a2p = (1 + g) * a2;
  const c1p = Math.sqrt(a1p * a1p + b1 * b1);
  const c2p = Math.sqrt(a2p * a2p + b2 * b2);
  const h1p = c1p === 0 ? 0 : (rad2deg(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = c2p === 0 ? 0 : (rad2deg(Math.atan2(b2, a2p)) + 360) % 360;
  const dLp = L2 - L1;
  const dCp = c2p - c1p;
  let dhp = h2p - h1p;
  if (c1p * c2p === 0) dhp = 0;
  else if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin(deg2rad(dhp / 2));
  const LpBar = (L1 + L2) / 2;
  const CpBar = (c1p + c2p) / 2;
  let hpBar = h1p + h2p;
  if (c1p * c2p === 0) hpBar = h1p + h2p;
  else if (Math.abs(h1p - h2p) > 180) hpBar = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  else hpBar = (h1p + h2p) / 2;
  const t =
    1 -
    0.17 * Math.cos(deg2rad(hpBar - 30)) +
    0.24 * Math.cos(deg2rad(2 * hpBar)) +
    0.32 * Math.cos(deg2rad(3 * hpBar + 6)) -
    0.20 * Math.cos(deg2rad(4 * hpBar - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hpBar - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(CpBar, 7) / (Math.pow(CpBar, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(LpBar - 50, 2)) / Math.sqrt(20 + Math.pow(LpBar - 50, 2));
  const Sc = 1 + 0.045 * CpBar;
  const Sh = 1 + 0.015 * CpBar * t;
  const Rt = -Math.sin(deg2rad(2 * dTheta)) * Rc;
  const l = dLp / (kL * Sl);
  const c = dCp / (kC * Sc);
  const h = dHp / (kH * Sh);
  return Math.sqrt(l * l + c * c + h * h + Rt * c * h);
}

function swatchLab(swatch, neutral = null) {
  const normalized = normalizeRgbObject(swatch.rgb, neutral);
  return rgbToLab(normalized);
}

function chooseNearestTwoSwatchesLab(rgb, swatches, neutral = null) {
  if (!rgb || !swatches || !swatches.length) return null;

  const normalizedRgb = normalizeRgbObject(rgb, neutral);
  const measuredLab = rgbToLab(normalizedRgb);
  const ranked = swatches
    .map(swatch => {
      const lab = swatchLab(swatch, neutral);
      return {
        swatch,
        lab,
        deltaE: deltaE2000(measuredLab, lab),
        deltaE76: deltaE76(measuredLab, lab)
      };
    })
    .sort((a, b) => a.deltaE - b.deltaE);

  return {
    measuredRgb: normalizedRgb,
    measuredLab,
    best: ranked[0]?.swatch || null,
    bestLab: ranked[0]?.lab || null,
    bestD: ranked[0]?.deltaE ?? Infinity,
    second: ranked[1]?.swatch || null,
    secondLab: ranked[1]?.lab || null,
    secondD: ranked[1]?.deltaE ?? Infinity,
    distances: ranked.map(item => ({
      value: item.swatch.value,
      deltaE: item.deltaE,
      deltaE76: item.deltaE76
    }))
  };
}

function rgbToChemistryFallback(avgRgb) {
  const { r, g, b } = avgRgb;
  const ph = Math.min(9.0, Math.max(6.0, 6.0 + (r - b) / 40));
  const freeCl = Math.min(10, Math.max(0, (g - 80) / 25));
  const totalCl = Math.min(20, Math.max(freeCl, freeCl + 0.5));
  const bromine = Math.min(40, Math.max(0, totalCl * 2.25));
  const brightness = (r + g + b) / 3;
  const hardness = Math.min(425, Math.max(0, (brightness - 60) * 3));
  const alk = Math.min(360, Math.max(0, (r + g + b) / 4));
  const cya = Math.min(240, Math.max(0, (b - 60) * 2));
  return {
    ph: Number(ph.toFixed(2)),
    freeCl: Number(freeCl.toFixed(2)),
    totalCl: Number(totalCl.toFixed(2)),
    bromine: Number(bromine.toFixed(1)),
    hardness: Math.round(hardness),
    alk: Math.round(alk),
    cya: Math.round(cya)
  };
}

function loadJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || ""); } catch { return fallback; }
}
function saveJson(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ================================================================
// 3) Main entry
// ================================================================

export function initPoolTestScanner(root) {
  const els = {
    video: root.querySelector('[data-pt="video"]'),
    canvas: root.querySelector('[data-pt="canvas"]'),
    scanView: root.querySelector('[data-pt="scanView"]'),
    scanFrame: root.querySelector('[data-pt="scanView"] .scan-frame'),
    status: root.querySelector('[data-pt="status"]'),
    scanQuality: root.querySelector('[data-pt="scanQuality"]'),
    scanDebug: root.querySelector('[data-pt="scanDebug"]'),
    sanitySummary: root.querySelector('[data-pt="sanitySummary"]'),
    sanityContext: root.querySelector('[data-pt="sanityContext"]'),
    sanityDetails: root.querySelector('[data-pt="sanityDetails"]'),
    poolContextPanel: root.querySelector('[data-pt="poolContextPanel"]'),
    waterAppearance: root.querySelector('[data-pt="waterAppearance"]'),
    recentRain: root.querySelector('[data-pt="recentRain"]'),
    poolUsage: root.querySelector('[data-pt="poolUsage"]'),
    surfaceCondition: root.querySelector('[data-pt="surfaceCondition"]'),
    historyLog: root.querySelector('[data-pt="historyLog"]'),

    btnStart: root.querySelector('[data-pt="btnStart"]'),
    btnCapture: root.querySelector('[data-pt="btnCapture"]'),
    btnWB: root.querySelector('[data-pt="btnWB"]'),

    fileInput: root.querySelector('[data-pt="fileInput"]'),
    btnTakePhoto: root.querySelector('[data-pt="btnTakePhoto"]'),
    btnChoosePhoto: root.querySelector('[data-pt="btnChoosePhoto"]'),
    takeInput: root.querySelector('[data-pt="takeInput"]'),

    liveControls: root.querySelector('[data-pt="liveControls"]'),
    cameraRow: root.querySelector('[data-pt="cameraRow"]'),
    cameraSelect: root.querySelector('[data-pt="cameraSelect"]'),

    poolToggle: root.querySelector('[data-pt="poolToggle"]'),
    poolToggleGlobal: document.querySelector('[data-pt="poolToggleGlobal"]'),

    shape: root.querySelector('[data-pt="shape"]'),
    rectFields: root.querySelector('[data-pt="rectFields"]'),
    roundFields: root.querySelector('[data-pt="roundFields"]'),
    ovalFields: root.querySelector('[data-pt="ovalFields"]'),
    rectLen: root.querySelector('[data-pt="rectLen"]'),
    rectWid: root.querySelector('[data-pt="rectWid"]'),
    roundDia: root.querySelector('[data-pt="roundDia"]'),
    ovalLen: root.querySelector('[data-pt="ovalLen"]'),
    ovalWid: root.querySelector('[data-pt="ovalWid"]'),
    depthShallow: root.querySelector('[data-pt="depthShallow"]'),
    depthDeep: root.querySelector('[data-pt="depthDeep"]'),
    gallonsManual: root.querySelector('[data-pt="gallonsManual"]'),
    btnCalcGallons: root.querySelector('[data-pt="btnCalcGallons"]'),
    gallonsDisplay: root.querySelector('[data-pt="gallonsDisplay"]'),

    barPh: root.querySelector('[data-pt="barPh"]'),
    barFCl: root.querySelector('[data-pt="barFCl"]'),
    barTCl: root.querySelector('[data-pt="barTCl"]'),
    barBr: root.querySelector('[data-pt="barBr"]'),
    barHard: root.querySelector('[data-pt="barHard"]'),
    barAlk: root.querySelector('[data-pt="barAlk"]'),
    barCya: root.querySelector('[data-pt="barCya"]'),

    tagPh: root.querySelector('[data-pt="tagPh"]'),
    tagFCl: root.querySelector('[data-pt="tagFCl"]'),
    tagTCl: root.querySelector('[data-pt="tagTCl"]'),
    tagBr: root.querySelector('[data-pt="tagBr"]'),
    tagHard: root.querySelector('[data-pt="tagHard"]'),
    tagAlk: root.querySelector('[data-pt="tagAlk"]'),
    tagCya: root.querySelector('[data-pt="tagCya"]'),

    recs: root.querySelector('[data-pt="recs"]'),

    chartPh: root.querySelector('[data-pt="chartPh"]'),
    chartFCl: root.querySelector('[data-pt="chartFCl"]'),
    chartAlk: root.querySelector('[data-pt="chartAlk"]'),
    chartCya: root.querySelector('[data-pt="chartCya"]'),

    btnRecalc: root.querySelector('[data-pt="btnRecalc"]'),
    btnClearData: root.querySelector('[data-pt="btnClearData"]'),
    btnClearCache: root.querySelector('[data-pt="btnClearCache"]'),
    btnExportDataset: root.querySelector('[data-pt="btnExportDataset"]'),

    // Preview (below camera box)
    previewWrap: root.querySelector('[data-pt="previewWrap"]'),
    previewStage: root.querySelector('[data-pt="previewStage"]'),
    previewCanvas: root.querySelector('[data-pt="previewCanvas"]'),
    cropBox: root.querySelector('[data-pt="cropBox"]'),
    cropHandle: root.querySelector('[data-pt="cropHandle"]'),
    btnAutoCrop: root.querySelector('[data-pt="btnAutoCrop"]'),
    btnUseCrop: root.querySelector('[data-pt="btnUseCrop"]'),
    btnManualPads: root.querySelector('[data-pt="btnManualPads"]'),
    btnResetManualPads: root.querySelector('[data-pt="btnResetManualPads"]'),
    btnUseManualPads: root.querySelector('[data-pt="btnUseManualPads"]'),
    manualPadLayer: root.querySelector('[data-pt="manualPadLayer"]'),
    btnCancelCrop: root.querySelector('[data-pt="btnCancelCrop"]')
  };

  const setStatus = msg => { if (els.status) els.status.textContent = msg || ""; };
  const escapeHtml = value => String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // ================================================================
  // 4) Calibration + White balance
  // ================================================================

  const CAL_KEY = "pt_calibration_v1";
  function loadCalibration() {
    try { return JSON.parse(localStorage.getItem(CAL_KEY) || "null"); } catch { return null; }
  }

  let whiteBalance = { r: 1, g: 1, b: 1 };
  let calOffsets = { ph: 0, alk: 0, cya: 0, hardness: 0 };
  let latestScanDebug = null;

  function clampNumber(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeWhiteBalance(wb) {
    const r = Number(wb?.r);
    const g = Number(wb?.g);
    const b = Number(wb?.b);
    if (![r, g, b].every(v => Number.isFinite(v) && v > 0)) return { r: 1, g: 1, b: 1 };
    return {
      r: clampNumber(r, 0.45, 2.25),
      g: clampNumber(g, 0.45, 2.25),
      b: clampNumber(b, 0.45, 2.25)
    };
  }

  (function applySavedCalibration() {
    const cal = loadCalibration();
    if (cal?.whiteBalance) whiteBalance = normalizeWhiteBalance(cal.whiteBalance);
    if (cal?.offsets) {
      calOffsets = {
        ph: Number(cal.offsets.ph || 0),
        alk: Number(cal.offsets.alk || 0),
        cya: Number(cal.offsets.cya || 0),
        hardness: Number(cal.offsets.hardness || 0)
      };
    }
  })();

  function calibrationFingerprint() {
    const wb = normalizeWhiteBalance(whiteBalance);
    const offsets = {
      ph: Number(calOffsets.ph || 0),
      alk: Number(calOffsets.alk || 0),
      cya: Number(calOffsets.cya || 0),
      hardness: Number(calOffsets.hardness || 0)
    };
    return [
      wb.r.toFixed(3), wb.g.toFixed(3), wb.b.toFixed(3),
      offsets.ph.toFixed(2), offsets.alk, offsets.cya, offsets.hardness
    ].join(":");
  }

  // ================================================================
  // 5) UI mode (hide live controls on phones)
  // ================================================================

  function applyScannerMode() {
    const isSmall = window.matchMedia("(max-width: 900px)").matches;
    if (els.liveControls) els.liveControls.style.display = isSmall ? "none" : "";
    if (els.cameraRow) els.cameraRow.style.display = isSmall ? "none" : "";
  }
  window.addEventListener("resize", applyScannerMode);

  // ================================================================
  // 6) Cache + fingerprints
  // ================================================================

  const RESULT_CACHE_KEY = "pt_result_cache_v1";
  const RESULT_CACHE_MAX = 60;

  const FP_KEY = "pt_pad_fingerprints_v1";
  const FP_MAX = 120;

  function hashCanvas(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
    const img = ctx.getImageData(0, 0, w, h).data;

    let hash = 2166136261; // FNV-1a
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        hash ^= img[i];     hash = Math.imul(hash, 16777619);
        hash ^= img[i + 1]; hash = Math.imul(hash, 16777619);
        hash ^= img[i + 2]; hash = Math.imul(hash, 16777619);
      }
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function cacheGet(hash) {
    const cache = loadJson(RESULT_CACHE_KEY, {});
    return cache?.[hash] || null;
  }

  function cachePut(hash, vals) {
    const cache = loadJson(RESULT_CACHE_KEY, {});
    cache[hash] = { t: Date.now(), vals };
    const keys = Object.keys(cache);
    if (keys.length > RESULT_CACHE_MAX) {
      keys.sort((a, b) => (cache[a].t || 0) - (cache[b].t || 0));
      for (let i = 0; i < keys.length - RESULT_CACHE_MAX; i++) delete cache[keys[i]];
    }
    saveJson(RESULT_CACHE_KEY, cache);
  }

  function recordFingerprint(hash, padColors, avgRgb, vals = null) {
    const arr = loadJson(FP_KEY, []);
    const pads = {};
    Object.keys(padColors || {}).forEach(k => {
      if (k === "__avg") return;
      const p = padColors[k];
      if (!p) return;
      pads[k] = {
        r: Math.round(p.r || 0),
        g: Math.round(p.g || 0),
        b: Math.round(p.b || 0),
        v: Number((p.__var ?? 0).toFixed(2))
      };
    });

    arr.push({
      t: Date.now(),
      id: hash || null,
      avg: {
        r: Math.round(avgRgb?.r || 0),
        g: Math.round(avgRgb?.g || 0),
        b: Math.round(avgRgb?.b || 0)
      },
      quality: vals?.__scanQuality || null,
      pads,
      labDebug: vals?.__padDebug || null
    });

    if (arr.length > FP_MAX) arr.splice(0, arr.length - FP_MAX);
    saveJson(FP_KEY, arr);
  }

  function clearScanCache() {
    try {
      localStorage.removeItem(RESULT_CACHE_KEY);
      localStorage.removeItem(FP_KEY);
    } catch {}
    setStatus("Scan cache cleared (results + fingerprints).");
  }

  function exportCalibrationDataset() {
    const fingerprints = loadJson(FP_KEY, []);
    const history = loadJson("pt_history_v2", []);
    const calibration = loadCalibration();
    const payload = {
      exportedAt: new Date().toISOString(),
      app: "AquaLab",
      format: "aqualab-calibration-dataset-v1",
      note: "Fingerprints are sampled pad RGB medians. Pair these with known test-kit readings when building calibration data.",
      calibration,
      history,
      fingerprints
    };

    if (!fingerprints.length && !history.length) {
      setStatus("No scan fingerprints or history to export yet.");
      return;
    }

    try {
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `aqualab-calibration-dataset-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`Exported ${fingerprints.length} scan fingerprint(s) and ${history.length} history reading(s).`);
    } catch {
      setStatus("Could not export the calibration dataset from this browser.");
    }
  }

  // ================================================================
  // 7) Camera selection + live camera
  // ================================================================

  let stream = null;
  const CAM_KEY = "pt_selected_camera_v1";

  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices || !els.cameraSelect) return;

    let devices = [];
    try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { return; }

    const cams = devices.filter(d => d.kind === "videoinput");
    const saved = (() => { try { return localStorage.getItem(CAM_KEY) || ""; } catch { return ""; } })();

    els.cameraSelect.innerHTML = `<option value="">Default camera</option>`;

    cams.forEach((cam, idx) => {
      const opt = document.createElement("option");
      opt.value = cam.deviceId;
      const label = (cam.label && cam.label.trim()) ? cam.label : `Camera ${idx + 1}`;
      opt.textContent = label;
      if (saved && saved === cam.deviceId) opt.selected = true;
      els.cameraSelect.appendChild(opt);
    });
  }

  function getSelectedCameraId() {
    if (!els.cameraSelect) return "";
    return els.cameraSelect.value || "";
  }

  function saveSelectedCameraId(deviceId) {
    try { localStorage.setItem(CAM_KEY, deviceId || ""); } catch {}
  }

  function stopCamera() {
    try { stream?.getTracks?.().forEach(t => t.stop()); } catch {}
    stream = null;
  }

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Live camera not supported. Use Upload/Take Photo.");
      return;
    }

    if (isIOS && location.protocol !== "https:" && location.hostname !== "localhost") {
      setStatus("On iPhone/iPad, live camera usually requires HTTPS. Use Upload/Take Photo for best reliability.");
      return;
    }

    stopCamera();

    const deviceId = getSelectedCameraId();
    const constraints = {
      audio: false,
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" } }
    };

    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      els.video.srcObject = stream;
      await els.video.play();

      els.btnCapture && (els.btnCapture.disabled = false);
      els.btnWB && (els.btnWB.disabled = false);

      await listCameras();
      setStatus("Live camera ready. Line the strip up inside the dashed box.");
    } catch {
      setStatus("Couldn’t start live camera. Use Upload/Take Photo instead.");
    }
  }

  // Simple ROI crop attempt (camera mode only)
  function cropToStripROI() {
    if (!els.canvas) return;
    const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
    const W = els.canvas.width, H = els.canvas.height;

    const targetW = 220;
    const s = Math.min(1, targetW / W);
    const w = Math.max(60, Math.round(W * s));
    const h = Math.max(60, Math.round(H * s));

    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const octx = off.getContext("2d", { willReadFrequently: true });
    octx.drawImage(els.canvas, 0, 0, W, H, 0, 0, w, h);

    const img = octx.getImageData(0, 0, w, h);
    const d = img.data;

    let minX = w, minY = h, maxX = 0, maxY = 0;
    let hits = 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = d[i], g = d[i + 1], b = d[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const v = mx;
        const sat = mx === 0 ? 0 : (mx - mn) / mx;

        if (v >= 190 && sat <= 0.25) {
          hits++;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    const hitFrac = hits / (w * h);
    if (hits < 300 || hitFrac < 0.004) return;

    const padX = Math.round((maxX - minX) * 0.35) + 10;
    const padY = Math.round((maxY - minY) * 0.10) + 10;

    minX = Math.max(0, minX - padX);
    maxX = Math.min(w - 1, maxX + padX);
    minY = Math.max(0, minY - padY);
    maxY = Math.min(h - 1, maxY + padY);

    const scaleUp = 1 / s;
    const rx = Math.round(minX * scaleUp);
    const ry = Math.round(minY * scaleUp);
    const rw = Math.round((maxX - minX + 1) * scaleUp);
    const rh = Math.round((maxY - minY + 1) * scaleUp);

    const cx = Math.max(0, Math.min(W - 1, rx));
    const cy = Math.max(0, Math.min(H - 1, ry));
    const cw = Math.max(20, Math.min(rw, W - cx));
    const ch = Math.max(20, Math.min(rh, H - cy));

    try {
      const src = ctx.getImageData(cx, cy, cw, ch);
      els.canvas.width = cw;
      els.canvas.height = ch;
      els.canvas.getContext("2d", { willReadFrequently: true }).putImageData(src, 0, 0);
    } catch {}
  }

  function drawFromVideo() {
    const w = els.video.videoWidth || 1280;
    const h = els.video.videoHeight || 720;
    els.canvas.width = w;
    els.canvas.height = h;
    const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(els.video, 0, 0, w, h);
    cropToStripROI();
    return els.canvas.getContext("2d", { willReadFrequently: true });
  }

  // ================================================================
  // 8) Preview + manual crop (BELOW camera box)
  // ================================================================

  let previewImg = null;   // Image()
  let previewFit = null;   // {scale, dx, dy, iw, ih, cw, ch}
  let manualPadMode = false;
  let manualPadMarkers = [];

  function showPreview(img) {
    previewImg = img;
    if (!els.previewWrap || !els.previewCanvas || !els.previewStage || !els.cropBox) return;

    els.previewWrap.style.display = "block";

    resetManualPadSelection(false);

    // Default crop box (tall/skinny)
    els.cropBox.style.left = "30%";
    els.cropBox.style.top = "8%";
    els.cropBox.style.width = "40%";
    els.cropBox.style.height = "84%";

    requestAnimationFrame(() => {
      drawPreviewCanvas();
      try { els.previewWrap.scrollIntoView({ behavior: "smooth", block: "start" }); } catch {}
    });

    setStatus("Adjust the crop box around the strip, then click Use Crop.");
  }

  function hidePreview() {
    if (els.previewWrap) els.previewWrap.style.display = "none";
    previewImg = null;
    previewFit = null;
    resetManualPadSelection(false);
  }

  function drawPreviewCanvas() {
    const c = els.previewCanvas;
    const stage = els.previewStage;
    if (!c || !stage || !previewImg) return;

    const rect = stage.getBoundingClientRect();
    const cw = Math.max(10, Math.round(rect.width));
    const ch = Math.max(10, Math.round(rect.height));
    c.width = cw;
    c.height = ch;

    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, cw, ch);

    const iw = previewImg.naturalWidth || previewImg.width;
    const ih = previewImg.naturalHeight || previewImg.height;

    const scale = Math.min(cw / iw, ch / ih);
    const dw = Math.round(iw * scale);
    const dh = Math.round(ih * scale);
    const dx = Math.round((cw - dw) / 2);
    const dy = Math.round((ch - dh) / 2);

    ctx.drawImage(previewImg, 0, 0, iw, ih, dx, dy, dw, dh);
    previewFit = { scale, dx, dy, iw, ih, cw, ch };
  }

  function previewPointToImagePixels(clientX, clientY) {
    if (!previewFit || !els.previewStage) return null;
    const rect = els.previewStage.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { scale, dx, dy, iw, ih } = previewFit;
    const imgX = (x - dx) / scale;
    const imgY = (y - dy) / scale;
    if (imgX < 0 || imgY < 0 || imgX > iw || imgY > ih) return null;
    return { imageX: imgX, imageY: imgY, stageX: x, stageY: y };
  }

  function setManualPadButtons() {
    const active = manualPadMode;
    if (els.btnResetManualPads) els.btnResetManualPads.hidden = !active;
    if (els.btnUseManualPads) {
      els.btnUseManualPads.hidden = !active;
      els.btnUseManualPads.disabled = manualPadMarkers.length !== EASYTEST_CFG.pads.length;
    }
    if (els.btnManualPads) els.btnManualPads.textContent = active ? "Manual Pads On" : "Manual Pads";
    if (els.cropBox) els.cropBox.style.display = active ? "none" : "";
    if (els.manualPadLayer) els.manualPadLayer.hidden = !active;
  }

  function resetManualPadSelection(keepMode = manualPadMode) {
    manualPadMarkers = [];
    manualPadMode = !!keepMode;
    if (els.manualPadLayer) els.manualPadLayer.innerHTML = "";
    setManualPadButtons();
  }

  function renderManualPadMarkers() {
    if (!els.manualPadLayer || !previewFit) return;
    els.manualPadLayer.innerHTML = manualPadMarkers.map((marker, index) => {
      const pad = EASYTEST_CFG.pads[index];
      const left = marker.stageX;
      const top = marker.stageY;
      return `<button type="button" class="manual-pad-marker" style="left:${left}px; top:${top}px" aria-label="${escapeHtml(pad?.label || `Pad ${index + 1}`)}"><span>${index + 1}</span></button>`;
    }).join("");
    setManualPadButtons();
  }

  function nextManualPadLabel() {
    const pad = EASYTEST_CFG.pads[manualPadMarkers.length];
    return pad ? `${pad.label} (${manualPadMarkers.length + 1}/7)` : "all pads";
  }

  function toggleManualPadMode() {
    if (!previewImg) return;
    manualPadMode = !manualPadMode;
    if (manualPadMode) {
      manualPadMarkers = [];
      setStatus(`Manual pad mode: tap ${nextManualPadLabel()}, then continue top-to-bottom.`);
    } else {
      manualPadMarkers = [];
      setStatus("Manual pad mode off. Adjust the crop box or re-enable manual pads.");
    }
    renderManualPadMarkers();
    setManualPadButtons();
  }

  function addManualPadMarker(ev) {
    if (!manualPadMode || !previewImg || manualPadMarkers.length >= EASYTEST_CFG.pads.length) return;
    const point = previewPointToImagePixels(ev.clientX, ev.clientY);
    if (!point) {
      setStatus("Tap directly on the photo area for manual pad selection.");
      return;
    }
    manualPadMarkers.push(point);
    renderManualPadMarkers();
    setStatus(manualPadMarkers.length === EASYTEST_CFG.pads.length
      ? "Manual pad markers complete. Click Use Manual Pads."
      : `Tap ${nextManualPadLabel()}.`);
  }
  function getCropRectInImagePixels() {
    if (!previewFit || !els.cropBox || !els.previewStage) return null;

    const stageRect = els.previewStage.getBoundingClientRect();
    const boxRect = els.cropBox.getBoundingClientRect();

    const bx = boxRect.left - stageRect.left;
    const by = boxRect.top - stageRect.top;
    const bw = boxRect.width;
    const bh = boxRect.height;

    const { scale, dx, dy, iw, ih } = previewFit;

    // clamp crop to drawn image area
    const imgX1 = dx, imgY1 = dy;
    const imgX2 = dx + iw * scale;
    const imgY2 = dy + ih * scale;

    const x1 = Math.max(imgX1, bx);
    const y1 = Math.max(imgY1, by);
    const x2 = Math.min(imgX2, bx + bw);
    const y2 = Math.min(imgY2, by + bh);

    const sw = (x2 - x1) / scale;
    const sh = (y2 - y1) / scale;
    if (sw < 10 || sh < 10) return null;

    const sx = (x1 - dx) / scale;
    const sy = (y1 - dy) / scale;

    return {
      sx: Math.max(0, Math.round(sx)),
      sy: Math.max(0, Math.round(sy)),
      sw: Math.min(iw, Math.round(sw)),
      sh: Math.min(ih, Math.round(sh))
    };
  }

  function medianFromSorted(vals) {
    const a = vals.slice().sort((p, q) => p - q);
    return a[Math.floor(a.length / 2)] ?? 0;
  }

  function sampleManualPadRegion(ctx, marker) {
    const size = 15;
    const half = Math.floor(size / 2);
    const cx = Math.round(marker.imageX);
    const cy = Math.round(marker.imageY);
    const sx = clampNumber(cx - half, 0, Math.max(0, ctx.canvas.width - size));
    const sy = clampNumber(cy - half, 0, Math.max(0, ctx.canvas.height - size));
    const sw = Math.min(size, ctx.canvas.width - sx);
    const sh = Math.min(size, ctx.canvas.height - sy);
    const imgData = ctx.getImageData(sx, sy, sw, sh).data;
    const rs = [], gs = [], bs = [];
    const points = [];

    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const idx = (y * sw + x) * 4;
        const r = imgData[idx];
        const g = imgData[idx + 1];
        const b = imgData[idx + 2];
        rs.push(r / whiteBalance.r);
        gs.push(g / whiteBalance.g);
        bs.push(b / whiteBalance.b);
        points.push({ x: sx + x, y: sy + y, r, g, b });
      }
    }

    const mr = medianFromSorted(rs);
    const mg = medianFromSorted(gs);
    const mb = medianFromSorted(bs);
    const vr = medianFromSorted(rs.map(v => Math.abs(v - mr)));
    const vg = medianFromSorted(gs.map(v => Math.abs(v - mg)));
    const vb = medianFromSorted(bs.map(v => Math.abs(v - mb)));

    return {
      r: mr,
      g: mg,
      b: mb,
      __var: (vr + vg + vb) / 3,
      __manualSample: {
        x: sx,
        y: sy,
        w: sw,
        h: sh,
        centerX: cx,
        centerY: cy,
        points
      }
    };
  }

  function buildManualSamplingOverlay(ctx, padColors) {
    const diagnostics = {
      detectedSegments: EASYTEST_CFG.pads.map(pad => {
        const sample = padColors[pad.key]?.__manualSample;
        return sample ? { start: sample.y, end: sample.y + sample.h, x1: sample.x, x2: sample.x + sample.w } : null;
      }).filter(Boolean),
      detectedPadCenters: EASYTEST_CFG.pads.map(pad => {
        const sample = padColors[pad.key]?.__manualSample;
        return sample ? { x: sample.centerX, y: sample.centerY } : null;
      }).filter(Boolean),
      sampledPixels: Object.fromEntries(EASYTEST_CFG.pads.map(pad => [pad.key, padColors[pad.key]?.__manualSample?.points || []]))
    };
    return buildSamplingDebugOverlay(ctx, diagnostics);
  }

  function analyzeFromManualPads() {
    if (!previewImg || manualPadMarkers.length !== EASYTEST_CFG.pads.length) {
      setStatus("Select all 7 manual pad markers first.");
      return null;
    }

    const iw = previewImg.naturalWidth || previewImg.width;
    const ih = previewImg.naturalHeight || previewImg.height;
    const off = document.createElement("canvas");
    off.width = iw;
    off.height = ih;
    const ctx = off.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(previewImg, 0, 0, iw, ih);

    const padColors = {};
    EASYTEST_CFG.pads.forEach((pad, index) => {
      padColors[pad.key] = sampleManualPadRegion(ctx, manualPadMarkers[index]);
    });

    const avgRgb = averageRgbList(Object.values(padColors)) || { r: 0, g: 0, b: 0 };
    padColors.__avg = avgRgb;
    Object.defineProperty(padColors, "__samplingDiagnostics", {
      enumerable: false,
      value: {
        detectionMethod: "manual-markers",
        manualSelection: true,
        detectedPadCenters: manualPadMarkers.map(marker => ({ x: Math.round(marker.imageX), y: Math.round(marker.imageY) })),
        padSpacingConsistency: null,
        sampledPixels: Object.fromEntries(EASYTEST_CFG.pads.map(pad => [pad.key, padColors[pad.key]?.__manualSample?.points || []])),
        overlayDataUrl: buildManualSamplingOverlay(ctx, padColors)
      }
    });

    const neutralReference = sampleNeutralReference(ctx);
    const scanQuality = evaluateScanQuality(ctx, padColors, avgRgb, neutralReference, null);
    if ((scanQuality.details.whiteBalanceSpread || 0) > 0.55) {
      scanQuality.score = Math.min(100, scanQuality.score + 18);
      scanQuality.warnings = scanQuality.warnings.filter(warning => !/White balance looks unstable/i.test(warning));
      scanQuality.label = scanQuality.score >= 82 ? "High" : scanQuality.score >= 62 ? "Medium" : "Low";
    }
    scanQuality.details.manualSelection = true;
    scanQuality.details.frameCount = 1;
    scanQuality.details.detectedPadCenters = padColors.__samplingDiagnostics.detectedPadCenters;
    scanQuality.details.samplingOverlayDataUrl = padColors.__samplingDiagnostics.overlayDataUrl;
    scanQuality.details.manualSampleRegion = "15x15 median RGB centered on each marker";
    scanQuality.warnings = scanQuality.warnings.filter(warning => !/Pad spacing|strip angle|Strip is strongly tilted|Could not determine strip angle/i.test(warning));

    const vals = rgbToChemistryEasyTest(padColors, scanQuality, neutralReference);
    vals.__manualPadSelection = true;
    vals.__scanQuality.details.manualSelection = true;
    vals.__scanQuality.details.samplingOverlayDataUrl = padColors.__samplingDiagnostics.overlayDataUrl;
    vals.__scanQuality.details.detectedPadCenters = padColors.__samplingDiagnostics.detectedPadCenters;
    lastVals = vals;
    const sanity = runSanityCheck(vals);

    renderBars(vals);
    renderSanityCheck(sanity);
    renderRecs(vals);
    renderScanDiagnostics(vals);
    setStatus(`Manual pad scan | 15x15 median samples | quality ${scanQuality.score}/100`);
    hidePreview();
    return vals;
  }
  function analyzeFromPreviewCrop() {
    const r = getCropRectInImagePixels();
    if (!r || !previewImg) {
      setStatus("Crop box is not over the image (or too small).");
      return null;
    }

    const maxW = 1600;
    const s = Math.min(1, maxW / r.sw);

    els.canvas.width = Math.round(r.sw * s);
    els.canvas.height = Math.round(r.sh * s);

    const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(previewImg, r.sx, r.sy, r.sw, r.sh, 0, 0, els.canvas.width, els.canvas.height);

    hidePreview();
    return analyze(ctx);
  }

  // Crop box drag + resize (pointer-friendly)
  (function wireCropBox() {
    if (!els.cropBox || !els.cropHandle || !els.previewStage) return;

    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    let mode = null; // "drag" | "resize"
    let start = null;
    let captureEl = null;

    function pctFromPx(x, y, w, h) {
      const stage = els.previewStage.getBoundingClientRect();
      return {
        left: (x / stage.width) * 100,
        top: (y / stage.height) * 100,
        width: (w / stage.width) * 100,
        height: (h / stage.height) * 100
      };
    }

    function boxPx() {
      const stage = els.previewStage.getBoundingClientRect();
      const box = els.cropBox.getBoundingClientRect();
      return {
        x: box.left - stage.left,
        y: box.top - stage.top,
        w: box.width,
        h: box.height,
        sw: stage.width,
        sh: stage.height
      };
    }

    function down(ev, which) {
      ev.preventDefault();
      ev.stopPropagation();
      mode = which;
      captureEl = ev.currentTarget;

      const b = boxPx();
      start = {
        pid: ev.pointerId,
        px: ev.clientX,
        py: ev.clientY,
        x: b.x, y: b.y, w: b.w, h: b.h, sw: b.sw, sh: b.sh
      };

      try { captureEl?.setPointerCapture?.(ev.pointerId); } catch {}
    }

    function move(ev) {
      if (!mode || !start) return;
      ev.preventDefault();

      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;

      let x = start.x, y = start.y, w = start.w, h = start.h;

      if (mode === "drag") {
        x = clamp(start.x + dx, 0, start.sw - start.w);
        y = clamp(start.y + dy, 0, start.sh - start.h);
      } else {
        const minW = 40, minH = 80;
        w = clamp(start.w + dx, minW, start.sw - start.x);
        h = clamp(start.h + dy, minH, start.sh - start.y);
      }

      const p = pctFromPx(x, y, w, h);
      els.cropBox.style.left = `${p.left}%`;
      els.cropBox.style.top = `${p.top}%`;
      els.cropBox.style.width = `${p.width}%`;
      els.cropBox.style.height = `${p.height}%`;
    }

    function up(ev) {
      if (!mode) return;
      mode = null;
      start = null;

      try {
        if (captureEl?.hasPointerCapture?.(ev.pointerId)) {
          captureEl.releasePointerCapture(ev.pointerId);
        }
      } catch {} finally {
        captureEl = null;
      }
    }

    els.cropBox.addEventListener("pointerdown", (ev) => {
      if (ev.target === els.cropHandle) return;
      down(ev, "drag");
    });

    els.cropHandle.addEventListener("pointerdown", (ev) => down(ev, "resize"));

    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  })();

  window.addEventListener("resize", () => {
    if (!previewImg) return;
    drawPreviewCanvas();
  });

  // ================================================================
  // 9) Sampling
  // ================================================================

  function sampleStripe(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const roi = {
      x: Math.round(w * 0.2),
      y: Math.round(h * 0.45),
      w: Math.round(w * 0.6),
      h: Math.round(h * 0.1)
    };
    const data = ctx.getImageData(roi.x, roi.y, roi.w, roi.h).data;

    let r = 0, g = 0, b = 0, c = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i] / whiteBalance.r;
      g += data[i + 1] / whiteBalance.g;
      b += data[i + 2] / whiteBalance.b;
      c++;
    }
    return { r: r / c, g: g / c, b: b / c };
  }

  function sampleNeutralReference(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const img = ctx.getImageData(0, 0, w, h).data;
    const samples = [];
    const edge = Math.max(8, Math.floor(Math.min(w, h) * 0.08));
    const step = Math.max(2, Math.floor(Math.min(w, h) / 80));

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const onEdge = x < edge || y < edge || x > w - edge || y > h - edge;
        if (!onEdge) continue;
        const i = (y * w + x) * 4;
        const r = img[i] / whiteBalance.r;
        const g = img[i + 1] / whiteBalance.g;
        const b = img[i + 2] / whiteBalance.b;
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (mx > 110 && mx < 252 && sat < 0.18) samples.push([r, g, b]);
      }
    }

    if (samples.length < 20) return null;
    const median = index => {
      const vals = samples.map(s => s[index]).sort((a, b) => a - b);
      return vals[Math.floor(vals.length / 2)];
    };
    return { r: median(0), g: median(1), b: median(2), sampleCount: samples.length };
  }

  function luminance(rgb) {
    return 0.2126 * (rgb?.r || 0) + 0.7152 * (rgb?.g || 0) + 0.0722 * (rgb?.b || 0);
  }

  function saturationOf(rgb) {
    const r = Number(rgb?.r || 0);
    const g = Number(rgb?.g || 0);
    const b = Number(rgb?.b || 0);
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    return mx === 0 ? 0 : (mx - mn) / mx;
  }

  function evaluateScanQuality(ctx, padColors, avgRgb, neutralReference, correctionDiagnostics = null) {
    const warnings = [];
    const details = {};
    let score = 100;

    const avgLuma = luminance(avgRgb);
    details.exposure = avgLuma;
    if (avgLuma < 70) {
      score -= 28;
      warnings.push("Lighting quality is too low. Move to indirect daylight and rescan.");
    } else if (avgLuma > 225) {
      score -= 22;
      warnings.push("Image is overexposed. Avoid glare and retake the photo.");
    }

    if (correctionDiagnostics) {
      details.detectedAngle = correctionDiagnostics.detectedAngle;
      details.correctedAngle = correctionDiagnostics.correctedAngle;
      details.angleFromVertical = correctionDiagnostics.angleFromVertical;
      details.rotationCorrected = !!correctionDiagnostics.rotationCorrected;
      details.perspectiveCorrected = !!correctionDiagnostics.perspectiveCorrected;
      details.stripDetectionConfidence = correctionDiagnostics.stripDetectionConfidence;
      details.correctionConfidence = correctionDiagnostics.correctionConfidence;
      details.detectedStripBounds = correctionDiagnostics.detectedStripBounds;
      details.detectedPadCenters = correctionDiagnostics.detectedPadCenters || [];
      details.padSpacingConsistency = correctionDiagnostics.padSpacingConsistency;
      details.padSpacingVariance = correctionDiagnostics.padSpacingVariance;
      details.perspectiveSkewEstimate = correctionDiagnostics.perspectiveSkewEstimate;
      details.perspectiveCorrectionAvailable = !!correctionDiagnostics.perspectiveCorrectionAvailable;
      details.correctedFrameCount = correctionDiagnostics.correctedFrameCount || 0;

      if (correctionDiagnostics.rotationCorrected) {
        warnings.push("Strip was auto-leveled.");
      }
      if ((correctionDiagnostics.correctionConfidence ?? 1) < 0.34) {
        score -= 14;
        warnings.push("Strip angle was difficult to detect. Try placing the strip straighter in the frame.");
      }
      if (correctionDiagnostics.angleFromVertical == null) {
        score -= 12;
        warnings.push("Could not determine strip angle clearly. Crop tightly around the strip and rescan.");
      }
      if (Math.abs(correctionDiagnostics.angleFromVertical || 0) > 18 && !correctionDiagnostics.rotationCorrected) {
        score -= 10;
        warnings.push("Strip is strongly tilted. Place it straighter in the frame for better pad sampling.");
      }
      if ((correctionDiagnostics.padSpacingConsistency ?? 1) < 0.72) {
        score -= 12;
        warnings.push("Pad spacing looks inconsistent after correction. Retake the photo straight-on if results look odd.");
      }
    }
    const wbSpread = Math.max(whiteBalance.r, whiteBalance.g, whiteBalance.b) - Math.min(whiteBalance.r, whiteBalance.g, whiteBalance.b);
    details.whiteBalanceSpread = wbSpread;
    if (wbSpread > 0.55) {
      score -= 18;
      warnings.push("White balance looks unstable. Set white balance on the strip backing or use neutral daylight.");
    }

    if (!neutralReference) {
      score -= 12;
      warnings.push("Could not find enough neutral strip/background pixels for reference normalization.");
    } else {
      const neutralSat = saturationOf(neutralReference);
      details.neutralSaturation = neutralSat;
      if (neutralSat > 0.12) {
        score -= 12;
        warnings.push("Background or strip backing has color contamination. Use a neutral white/gray background.");
      }
    }

    const pads = Object.values(padColors || {}).filter(p => p && typeof p === "object" && Number.isFinite(p.r));
    const variances = pads.map(p => Number(p.__var || 0));
    const avgVariance = variances.length ? variances.reduce((sum, v) => sum + v, 0) / variances.length : 999;
    details.averagePadVariance = avgVariance;
    if (avgVariance > 18) {
      score -= 18;
      warnings.push("Pad colors vary too much inside the crop. Avoid shadows/reflections and keep the strip flat.");
    }

    const saturations = pads.map(saturationOf);
    const avgSat = saturations.length ? saturations.reduce((sum, v) => sum + v, 0) / saturations.length : 0;
    details.averagePadSaturation = avgSat;
    if (avgSat < 0.08) {
      score -= 12;
      warnings.push("Pad colors have low contrast. Improve lighting and crop tightly around the strip.");
    }

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let glarePixels = 0;
    let shadowPixels = 0;
    let checked = 0;
    const step = Math.max(2, Math.floor(Math.min(w, h) / 80));
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const p = { r: data[i], g: data[i + 1], b: data[i + 2] };
        const luma = luminance(p);
        const sat = saturationOf(p);
        if (luma > 242 && sat < 0.08) glarePixels++;
        if (luma < 35) shadowPixels++;
        checked++;
      }
    }
    details.glareRatio = checked ? glarePixels / checked : 0;
    details.shadowRatio = checked ? shadowPixels / checked : 0;
    if (details.glareRatio > 0.04) {
      score -= 16;
      warnings.push("Glare/reflections detected. Tilt away from direct light and rescan.");
    }
    if (details.shadowRatio > 0.05) {
      score -= 16;
      warnings.push("Strong shadows detected. Use even indirect daylight.");
    }

    const finalScore = Math.max(0, Math.min(100, Math.round(score)));
    return {
      score: finalScore,
      label: finalScore >= 82 ? "High" : finalScore >= 62 ? "Medium" : "Low",
      warnings: Array.from(new Set(warnings)),
      details
    };
  }

  function normalizeAngle180(deg) {
    let a = deg;
    while (a <= -90) a += 180;
    while (a > 90) a -= 180;
    return a;
  }

  function detectStripOrientation(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    if (!w || !h) return null;

    const data = ctx.getImageData(0, 0, w, h).data;
    const step = Math.max(2, Math.floor(Math.min(w, h) / 120));
    const points = [];
    let minX = w, minY = h, maxX = 0, maxY = 0;

    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const r = data[i] / whiteBalance.r;
        const g = data[i + 1] / whiteBalance.g;
        const b = data[i + 2] / whiteBalance.b;
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        if (mx > 38 && mx < 248 && sat > 0.075) {
          points.push([x, y]);
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }

    if (points.length < 45) {
      return {
        detectedAngle: null,
        angleFromVertical: null,
        stripDetectionConfidence: 0,
        correctionConfidence: 0,
        detectedStripBounds: null,
        warning: "Strip angle was difficult to detect. Try placing the strip straighter in the frame."
      };
    }

    const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    let xx = 0, yy = 0, xy = 0;
    points.forEach(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      xx += dx * dx;
      yy += dy * dy;
      xy += dx * dy;
    });
    xx /= points.length;
    yy /= points.length;
    xy /= points.length;

    const angleRad = 0.5 * Math.atan2(2 * xy, xx - yy);
    const angleDeg = angleRad * 180 / Math.PI;
    const trace = xx + yy;
    const disc = Math.sqrt(Math.max(0, ((xx - yy) * (xx - yy)) + 4 * xy * xy));
    const lambda1 = (trace + disc) / 2;
    const lambda2 = (trace - disc) / 2;
    const elongation = lambda2 > 0 ? lambda1 / lambda2 : 99;
    const angleFromVertical = normalizeAngle180(angleDeg - 90);
    const coloredRatio = points.length / Math.max(1, Math.ceil(w / step) * Math.ceil(h / step));
    const bounds = {
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.round(maxX - minX),
      h: Math.round(maxY - minY),
      centerX: Math.round(cx),
      centerY: Math.round(cy)
    };

    const confidence = clamp01(
      0.18 +
      clamp01((points.length - 45) / 240) * 0.28 +
      clamp01((elongation - 1.8) / 5.2) * 0.38 +
      clamp01(coloredRatio / 0.18) * 0.16
    );

    return {
      detectedAngle: Number(angleDeg.toFixed(2)),
      angleFromVertical: Number(angleFromVertical.toFixed(2)),
      stripDetectionConfidence: Number(confidence.toFixed(2)),
      correctionConfidence: Number(confidence.toFixed(2)),
      detectedStripBounds: bounds,
      pointCount: points.length,
      coloredRatio: Number(coloredRatio.toFixed(3)),
      elongation: Number(elongation.toFixed(2)),
      perspectiveSkewEstimate: null,
      perspectiveCorrected: false,
      perspectiveCorrectionAvailable: false
    };
  }

  function rotateCanvasContext(ctx, degrees) {
    const src = ctx.canvas;
    const radians = degrees * Math.PI / 180;
    const sin = Math.abs(Math.sin(radians));
    const cos = Math.abs(Math.cos(radians));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.ceil(src.width * cos + src.height * sin));
    out.height = Math.max(1, Math.ceil(src.width * sin + src.height * cos));
    const outCtx = out.getContext("2d", { willReadFrequently: true });
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, out.width, out.height);
    outCtx.translate(out.width / 2, out.height / 2);
    outCtx.rotate(radians);
    outCtx.drawImage(src, -src.width / 2, -src.height / 2);
    return outCtx;
  }

  function autoLevelFrameContext(ctx) {
    const orientation = detectStripOrientation(ctx);
    const diagnostics = {
      detectedAngle: orientation?.detectedAngle ?? null,
      correctedAngle: orientation?.angleFromVertical != null ? 0 : null,
      angleFromVertical: orientation?.angleFromVertical ?? null,
      rotationCorrected: false,
      perspectiveCorrected: false,
      stripDetectionConfidence: orientation?.stripDetectionConfidence ?? 0,
      correctionConfidence: orientation?.correctionConfidence ?? 0,
      detectedStripBounds: orientation?.detectedStripBounds || null,
      detectedPadCenters: [],
      padSpacingConsistency: null,
      perspectiveSkewEstimate: orientation?.perspectiveSkewEstimate ?? null,
      perspectiveCorrectionAvailable: false,
      warning: orientation?.warning || ""
    };

    if (!orientation || orientation.angleFromVertical == null) {
      return { ctx, diagnostics };
    }

    const correctionDegrees = -orientation.angleFromVertical;
    if (Math.abs(correctionDegrees) > 2 && orientation.correctionConfidence >= 0.34) {
      try {
        const correctedCtx = rotateCanvasContext(ctx, correctionDegrees);
        const correctedOrientation = detectStripOrientation(correctedCtx);
        diagnostics.rotationCorrected = true;
        diagnostics.correctedAngle = correctedOrientation?.angleFromVertical ?? 0;
        diagnostics.correctedCanvas = {
          width: correctedCtx.canvas.width,
          height: correctedCtx.canvas.height
        };
        diagnostics.correctionConfidence = Number(Math.min(
          orientation.correctionConfidence,
          correctedOrientation?.correctionConfidence ?? orientation.correctionConfidence
        ).toFixed(2));
        return { ctx: correctedCtx, diagnostics };
      } catch {
        diagnostics.warning = "Strip auto-leveling failed. Try placing the strip straighter in the frame.";
        return { ctx, diagnostics };
      }
    }

    if (Math.abs(correctionDegrees) > 2) {
      diagnostics.warning = "Strip angle was difficult to detect. Try placing the strip straighter in the frame.";
    }
    return { ctx, diagnostics };
  }
  function medianNumber(vals) {
    const a = vals.filter(Number.isFinite).slice().sort((p, q) => p - q);
    return a.length ? a[Math.floor(a.length / 2)] : null;
  }

  function buildSamplingDebugOverlay(ctx, diagnostics) {
    if (!ctx?.canvas || !diagnostics) return null;
    const src = ctx.canvas;
    const maxW = 520;
    const scale = Math.min(1, maxW / Math.max(1, src.width));
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(src.width * scale));
    out.height = Math.max(1, Math.round(src.height * scale));
    const octx = out.getContext("2d");
    octx.drawImage(src, 0, 0, out.width, out.height);

    octx.lineWidth = Math.max(1, 2 * scale);
    octx.font = `${Math.max(10, Math.round(14 * scale))}px system-ui, sans-serif`;
    octx.textBaseline = "top";

    const palette = ["#38bdf8", "#f472b6", "#fb7185", "#84cc16", "#facc15", "#2dd4bf", "#fb923c"];
    (diagnostics.detectedSegments || []).forEach((seg, index) => {
      const color = palette[index % palette.length];
      const x = (seg.x1 ?? 0) * scale;
      const y = (seg.start ?? 0) * scale;
      const w = Math.max(1, ((seg.x2 ?? seg.x1 ?? 0) - (seg.x1 ?? 0)) * scale);
      const h = Math.max(1, ((seg.end ?? seg.start ?? 0) - (seg.start ?? 0)) * scale);
      octx.strokeStyle = color;
      octx.strokeRect(x, y, w, h);
      octx.fillStyle = color;
      octx.fillText(String(index + 1), x + 3, y + 3);
    });

    Object.entries(diagnostics.sampledPixels || {}).forEach(([key, points], index) => {
      const color = palette[index % palette.length];
      octx.fillStyle = color;
      (points || []).forEach(point => {
        const x = Math.round(point.x * scale);
        const y = Math.round(point.y * scale);
        octx.fillRect(x - 1, y - 1, 3, 3);
      });
      const center = diagnostics.detectedPadCenters?.[index];
      if (center) {
        octx.strokeStyle = color;
        octx.beginPath();
        octx.arc(center.x * scale, center.y * scale, Math.max(4, 8 * scale), 0, Math.PI * 2);
        octx.stroke();
        octx.fillText(key, center.x * scale + 8, center.y * scale - 8);
      }
    });

    try { return out.toDataURL("image/png"); } catch { return null; }
  }

  // Robust pad sampling: find plausible pad-width color blobs, then sample only their inner pixels.
  function samplePadsEasyTest(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const img = ctx.getImageData(0, 0, w, h).data;

    function getPixel(x, y) {
      const xx = clampNumber(Math.round(x), 0, w - 1);
      const yy = clampNumber(Math.round(y), 0, h - 1);
      const i = (yy * w + xx) * 4;
      const r = img[i], g = img[i + 1], b = img[i + 2];
      const v = Math.max(r, g, b);
      const sat = v === 0 ? 0 : (v - Math.min(r, g, b)) / v;
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      return { r, g, b, v, sat, luma };
    }

    function estimatePaperLab() {
      const samples = [];
      const step = Math.max(3, Math.floor(Math.min(w, h) / 95));
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const p = getPixel(x, y);
          if (p.v > 120 && p.v < 252 && p.sat < 0.16) {
            samples.push({ r: p.r, g: p.g, b: p.b, luma: p.luma });
          }
        }
      }
      if (samples.length < 25) return null;
      samples.sort((a, b) => b.luma - a.luma);
      const bright = samples.slice(0, Math.max(25, Math.floor(samples.length * 0.35)));
      return rgbToLab({
        r: medianNumber(bright.map(p => p.r)),
        g: medianNumber(bright.map(p => p.g)),
        b: medianNumber(bright.map(p => p.b))
      });
    }

    const paperLab = estimatePaperLab();

    function candidateEvidence(p) {
      const lab = rgbToLab({ r: p.r, g: p.g, b: p.b });
      const paperDeltaE = paperLab ? deltaE2000(lab, paperLab) : 0;
      return { lab, paperDeltaE };
    }

    function isCandidatePixel(p) {
      if (p.v < 42 || p.v > 248) return false;
      const evidence = candidateEvidence(p);
      if (paperLab && evidence.paperDeltaE < 7.5) return false;
      if (evidence.paperDeltaE >= 10) return true;
      if (p.sat > 0.18) return true;
      return p.sat > 0.115 && p.luma < 210;
    }

    const xStep = Math.max(1, Math.floor(w / 260));
    const yStep = Math.max(1, Math.floor(h / 900));
    const minRunW = Math.max(10, Math.floor(w * 0.025));
    const maxRunW = Math.max(minRunW + 4, Math.floor(w * 0.18));
    const minSegH = Math.max(10, Math.floor(h * 0.012));
    const maxSegH = Math.max(minSegH + 8, Math.floor(h * 0.12));
    const rows = [];

    for (let y = 0; y < h; y += yStep) {
      const runs = [];
      let inRun = false;
      let startX = 0;
      let satSum = 0;
      let count = 0;

      for (let x = 0; x < w; x += xStep) {
        const p = getPixel(x, y);
        const candidate = isCandidatePixel(p);
        if (candidate && !inRun) {
          inRun = true;
          startX = x;
          satSum = 0;
          count = 0;
        }
        if (candidate && inRun) {
          satSum += p.sat;
          count++;
        }
        if ((!candidate || x + xStep >= w) && inRun) {
          const endX = candidate && x + xStep >= w ? x : x - xStep;
          const runW = endX - startX + xStep;
          if (runW >= minRunW && runW <= maxRunW) {
            runs.push({ x1: startX, x2: endX, width: runW, centerX: (startX + endX) / 2, score: runW * (count ? satSum / count : 0) });
          }
          inRun = false;
        }
      }

      if (!runs.length) continue;
      runs.sort((a, b) => {
        const centerA = Math.abs(a.centerX - w * 0.5) / w;
        const centerB = Math.abs(b.centerX - w * 0.5) / w;
        return (b.score - centerB * 8) - (a.score - centerA * 8);
      });
      rows.push({ y, ...runs[0] });
    }

    const segments = [];
    let active = null;
    const maxGap = yStep * 3;
    rows.forEach(row => {
      if (!active || row.y - active.lastY > maxGap || Math.abs(row.centerX - active.centerXs[active.centerXs.length - 1]) > maxRunW) {
        if (active) segments.push(active);
        active = { start: row.y, end: row.y, lastY: row.y, centerXs: [row.centerX], widths: [row.width], x1s: [row.x1], x2s: [row.x2], rowCount: 1 };
      } else {
        active.end = row.y;
        active.lastY = row.y;
        active.centerXs.push(row.centerX);
        active.widths.push(row.width);
        active.x1s.push(row.x1);
        active.x2s.push(row.x2);
        active.rowCount++;
      }
    });
    if (active) segments.push(active);

    const plausible = segments
      .map(seg => ({
        start: seg.start,
        end: seg.end,
        height: seg.end - seg.start + yStep,
        centerX: medianNumber(seg.centerXs),
        width: medianNumber(seg.widths),
        x1: medianNumber(seg.x1s),
        x2: medianNumber(seg.x2s),
        rowCount: seg.rowCount
      }))
      .filter(seg => seg.height >= minSegH && seg.height <= maxSegH && seg.width >= minRunW && seg.width <= maxRunW)
      .sort((a, b) => a.start - b.start);

    if (plausible.length < 7) {
      const empty = {};
      Object.defineProperty(empty, "__samplingDiagnostics", {
        enumerable: false,
        value: {
          detectionMethod: "row-runs",
          detectedPadCenters: [],
          padSpacingConsistency: 0,
          padSpacingVariance: null,
          detectedSegments: plausible,
          sampledPixels: {},
          paperLab,
          samplingWarning: `Only found ${plausible.length}/7 plausible pad blobs. The crop may include too much background or the pad colors may be washed out.`
        }
      });
      return empty;
    }

    const top7 = plausible.slice(0, 7);
    const padCenters = top7.map(seg => ({ x: Math.round(seg.centerX), y: Math.round((seg.start + seg.end) / 2) }));
    const spacings = [];
    for (let i = 1; i < padCenters.length; i++) spacings.push(padCenters[i].y - padCenters[i - 1].y);
    const avgSpacing = spacings.length ? spacings.reduce((sum, v) => sum + v, 0) / spacings.length : 0;
    const spacingVariance = spacings.length && avgSpacing
      ? spacings.reduce((sum, v) => sum + Math.abs(v - avgSpacing), 0) / (spacings.length * avgSpacing)
      : null;

    const padColors = {};
    const sampledPixels = {};

    function median(vals) {
      const a = vals.slice().sort((p, q) => p - q);
      return a[Math.floor(a.length / 2)];
    }
    function mad(vals, m) {
      const a = vals.map(v => Math.abs(v - m)).sort((p, q) => p - q);
      return a[Math.floor(a.length / 2)];
    }

    for (let i = 0; i < 7; i++) {
      const seg = top7[i];
      const centerX = Math.round(seg.centerX);
      const centerY = Math.round((seg.start + seg.end) / 2);
      const sampleW = Math.max(8, Math.floor(seg.width * 0.42));
      const sampleH = Math.max(8, Math.floor(seg.height * 0.42));
      const x1 = clampNumber(centerX - Math.floor(sampleW / 2), 0, w - 1);
      const y1 = clampNumber(centerY - Math.floor(sampleH / 2), 0, h - 1);
      const x2 = clampNumber(centerX + Math.floor(sampleW / 2), 0, w - 1);
      const y2 = clampNumber(centerY + Math.floor(sampleH / 2), 0, h - 1);

      const samples = [];
      const points = [];
      const gx = 9, gy = 9;

      for (let yy = 0; yy < gy; yy++) {
        const py = Math.round(y1 + (yy + 0.5) * ((y2 - y1) / gy));
        for (let xx = 0; xx < gx; xx++) {
          const px = Math.round(x1 + (xx + 0.5) * ((x2 - x1) / gx));
          const p = getPixel(px, py);
          const rr = p.r / whiteBalance.r;
          const gg = p.g / whiteBalance.g;
          const bb = p.b / whiteBalance.b;
          samples.push([rr, gg, bb]);
          points.push({ x: px, y: py, r: Math.round(p.r), g: Math.round(p.g), b: Math.round(p.b) });
        }
      }

      const rs = samples.map(sv => sv[0]);
      const gs = samples.map(sv => sv[1]);
      const bs = samples.map(sv => sv[2]);

      const mr = median(rs), mg = median(gs), mb = median(bs);
      const vr = mad(rs, mr), vg = mad(gs, mg), vb = mad(bs, mb);

      const key = EASYTEST_CFG.pads[i].key;
      sampledPixels[key] = points;
      padColors[key] = { r: mr, g: mg, b: mb, __var: (vr + vg + vb) / 3 };
    }

    const diagnostics = {
      detectionMethod: "row-runs",
      detectedPadCenters: padCenters,
      padSpacingConsistency: spacingVariance == null ? null : Number(Math.max(0, 1 - spacingVariance).toFixed(2)),
      padSpacingVariance: spacingVariance == null ? null : Number(spacingVariance.toFixed(3)),
      detectedSegments: top7.map(seg => ({
        start: Math.round(seg.start),
        end: Math.round(seg.end),
        x1: Math.round(seg.x1),
        x2: Math.round(seg.x2),
        width: Math.round(seg.width),
        height: Math.round(seg.height)
      })),
      sampledPixels,
      paperLab
    };
    diagnostics.overlayDataUrl = buildSamplingDebugOverlay(ctx, diagnostics);

    Object.defineProperty(padColors, "__samplingDiagnostics", {
      enumerable: false,
      value: diagnostics
    });

    return padColors;
  }
  function setWBAt(x, y) {
    const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
    const size = 21;
    const half = Math.floor(size / 2);
    const sx = clampNumber(x - half, 0, Math.max(0, els.canvas.width - size));
    const sy = clampNumber(y - half, 0, Math.max(0, els.canvas.height - size));
    const imgData = ctx.getImageData(Math.round(sx), Math.round(sy), Math.min(size, els.canvas.width), Math.min(size, els.canvas.height));
    const data = imgData.data;
    const rs = [], gs = [], bs = [];

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (mx < 80 || sat > 0.22) continue;
      rs.push(r); gs.push(g); bs.push(b);
    }

    if (rs.length < 24) {
      setStatus("White balance needs a bright white/gray strip-body area. Avoid pads, shadows, and glare.");
      return;
    }

    const median = vals => vals.slice().sort((a, b) => a - b)[Math.floor(vals.length / 2)];
    const r = median(rs), g = median(gs), b = median(bs);
    const avg = (r + g + b) / 3 || 1;
    whiteBalance = normalizeWhiteBalance({ r: r / avg, g: g / avg, b: b / avg });
    setStatus("White balance set. Capture or upload an EasyTest strip.");
  }

  // ================================================================
  // 10) RGB -> chemistry (with stabilization + offsets)
  // ================================================================

  let lastVals = null;
  let lastSanityCheck = null;
  const CHEM_CONTEXT_KEY = "pt_sanity_context_v1";
  const POOL_CONTEXT_KEY = "pt_pool_context_v1";
  const POOL_CONTEXT_LABELS = {
    waterAppearance: {
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
    },
    recentRain: { none: "None", light: "Light", moderate: "Moderate", heavy: "Heavy" },
    poolUsage: { none: "None", light: "Light", moderate: "Moderate", heavy: "Heavy" },
    surfaceCondition: { normal: "Normal", pollen: "Pollen Present", debris: "Debris Present", foam: "Foam Present", oily: "Oily Surface" }
  };

  function loadSanityContext() {
    const saved = loadJson(CHEM_CONTEXT_KEY, null);
    return {
      recentActions: Array.isArray(saved?.recentActions) ? saved.recentActions : [],
      updatedAt: saved?.updatedAt || null
    };
  }

  function saveSanityContext(recentActions) {
    const context = {
      recentActions: Array.isArray(recentActions) ? recentActions : [],
      updatedAt: new Date().toISOString()
    };
    saveJson(CHEM_CONTEXT_KEY, context);
    return context;
  }

  function loadPoolContext() {
    const saved = loadJson(POOL_CONTEXT_KEY, null) || {};
    return {
      waterAppearance: saved.waterAppearance || "crystalClear",
      recentRain: saved.recentRain || "none",
      poolUsage: saved.poolUsage || "none",
      surfaceCondition: saved.surfaceCondition || "normal"
    };
  }

  function savePoolContext(context) {
    const next = {
      waterAppearance: context.waterAppearance || "crystalClear",
      recentRain: context.recentRain || "none",
      poolUsage: context.poolUsage || "none",
      surfaceCondition: context.surfaceCondition || "normal",
      updatedAt: new Date().toISOString()
    };
    saveJson(POOL_CONTEXT_KEY, next);
    return next;
  }

  function getPoolContextFromInputs() {
    return savePoolContext({
      waterAppearance: els.waterAppearance?.value || loadPoolContext().waterAppearance,
      recentRain: els.recentRain?.value || loadPoolContext().recentRain,
      poolUsage: els.poolUsage?.value || loadPoolContext().poolUsage,
      surfaceCondition: els.surfaceCondition?.value || loadPoolContext().surfaceCondition
    });
  }

  function applyPoolContextInputs(context = loadPoolContext()) {
    if (els.waterAppearance) els.waterAppearance.value = context.waterAppearance;
    if (els.recentRain) els.recentRain.value = context.recentRain;
    if (els.poolUsage) els.poolUsage.value = context.poolUsage;
    if (els.surfaceCondition) els.surfaceCondition.value = context.surfaceCondition;
  }

  function poolContextLabel(group, value) {
    return POOL_CONTEXT_LABELS[group]?.[value] || value || "Not provided";
  }

  function confidenceLabel(score) {
    if (score >= 0.78) return "High";
    if (score >= 0.52) return "Medium";
    return "Low";
  }

  function rgbToChemistryEasyTest(padColors, scanQuality, neutralReference) {
    if (!padColors || !Object.keys(padColors).length) {
      return rgbToChemistryFallback({ r: 150, g: 150, b: 150 });
    }

    const padByKey = {};
    EASYTEST_CFG.pads.forEach(p => (padByKey[p.key] = p));

    const result = {
      __scanQuality: scanQuality || { score: 0, label: "Low", warnings: ["No scan quality data available."] },
      __padDebug: {},
      __warnings: []
    };

    function valueFromPad(key, fallback) {
      const rgb = padColors[key];
      const pad = padByKey[key];
      if (rgb && pad && pad.swatches && pad.swatches.length) {
        const pick = chooseNearestTwoSwatchesLab(rgb, pad.swatches, neutralReference);
        if (!pick?.best) return { value: fallback(), bestD: Infinity, secondValue: null, secondD: Infinity, variance: 999, confidence: 0, confidenceLabel: "Low" };

        const separation = Math.max(0, pick.secondD - pick.bestD);
        const distanceScore = clamp01(1 - pick.bestD / 18);
        const separationScore = clamp01(separation / 8);
        const qualityScore = clamp01((scanQuality?.score ?? 0) / 100);
        const varianceScore = 1 / (1 + (rgb.__var || 0) / 14);
        const confidence = clamp01(distanceScore * 0.45 + separationScore * 0.30 + qualityScore * 0.15 + varianceScore * 0.10);
        const debug = {
          key,
          label: pad.label,
          measuredRgb: {
            r: Math.round(rgb.r || 0),
            g: Math.round(rgb.g || 0),
            b: Math.round(rgb.b || 0)
          },
          normalizedRgb: {
            r: Math.round(pick.measuredRgb.r || 0),
            g: Math.round(pick.measuredRgb.g || 0),
            b: Math.round(pick.measuredRgb.b || 0)
          },
          measuredLab: {
            l: Number(pick.measuredLab.l.toFixed(1)),
            a: Number(pick.measuredLab.a.toFixed(1)),
            b: Number(pick.measuredLab.b.toFixed(1))
          },
          bestValue: pick.best.value,
          bestDeltaE: Number(pick.bestD.toFixed(2)),
          secondValue: pick.second ? pick.second.value : null,
          secondDeltaE: Number((pick.secondD || Infinity).toFixed(2)),
          confidence: Number(confidence.toFixed(2)),
          confidenceLabel: confidenceLabel(confidence),
          variance: Number((rgb.__var || 0).toFixed(2)),
          distances: pick.distances.map(item => ({
            value: item.value,
            deltaE: Number(item.deltaE.toFixed(2)),
            deltaE76: Number(item.deltaE76.toFixed(2))
          }))
        };
        result.__padDebug[key] = debug;
        return {
          value: pick.best.value,
          bestD: pick.bestD,
          secondValue: pick.second ? pick.second.value : null,
          secondD: pick.secondD,
          variance: rgb.__var ?? 0,
          separation,
          confidence,
          confidenceLabel: debug.confidenceLabel
        };
      }
      return { value: fallback(), bestD: Infinity, secondValue: null, secondD: Infinity, variance: 999 };
    }

    function stabilizedValue(key, pick, lastValue) {
      const cfg = PAD_STABILITY[key];
      if (!cfg) return { value: pick.value, range: null, confidence: pick.confidence ?? 1 };

      const ambiguous = (
        pick.secondValue != null &&
        ((pick.secondD - pick.bestD) < 2.2 || (pick.confidence ?? 0) < 0.58)
      ) || (pick.variance > 10);

      let value = pick.value;
      let range = null;

      if (cfg.enableRange && ambiguous && pick.secondValue != null) {
        const a = Math.min(pick.value, pick.secondValue);
        const b = Math.max(pick.value, pick.secondValue);
        range = [a, b];
        value = (key === "ph") ? Number(((a + b) / 2).toFixed(2)) : Math.round((a + b) / 2);
      }

      if (typeof lastValue === "number" && isFinite(lastValue)) {
        if (Math.abs(value - lastValue) <= cfg.snap) value = lastValue;
      }

      const dScore = 1 / (1 + pick.bestD / 12);
      const vScore = 1 / (1 + (pick.variance || 0) / 12);
      const confidence = Math.max(0, Math.min(1, Math.min(pick.confidence ?? 1, dScore * vScore)));

      return { value, range, confidence };
    }

    // pH (stabilized)
    const phPick = valueFromPad("ph", () => 7.4);
    const phStab = stabilizedValue("ph", phPick, lastVals?.ph);
    result.ph = phStab.value;
    if (phStab.range) result.__phRange = phStab.range;
    result.__phConfidence = phStab.confidence;

    // Chlorine
    const fcPick = valueFromPad("freeCl", () => 2.0);
    result.freeCl = fcPick.value;
    result.__freeClConfidence = fcPick.confidence ?? 0;

    const tcPick = valueFromPad("totalCl", () => Math.max(result.freeCl, result.freeCl + 0.5));
    result.totalCl = tcPick.value;
    result.__totalClConfidence = tcPick.confidence ?? 0;

    // Sanity correction: TC >= FC
    let chlorineCorrected = false;
    if (result.totalCl < result.freeCl) {
      const tmp = result.totalCl;
      result.totalCl = result.freeCl;
      result.freeCl = tmp;
      chlorineCorrected = true;
    }
    if (result.totalCl < result.freeCl) {
      result.totalCl = result.freeCl;
      chlorineCorrected = true;
    }
    result.__chlorineCorrected = chlorineCorrected;

    // Bromine
    const brPick = valueFromPad("bromine", () => null);
    const bromFromPad = brPick.value;
    result.bromine = bromFromPad != null ? bromFromPad : (result.totalCl * 2.25);
    result.__bromineConfidence = brPick.confidence ?? 0;

    // Hardness
    const hardPick = valueFromPad("hardness", () => 250);
    result.hardness = hardPick.value;
    result.__hardnessConfidence = hardPick.confidence ?? 0;

    // Alkalinity (stabilized)
    const alkPick = valueFromPad("alk", () => 100);
    const alkStab = stabilizedValue("alk", alkPick, lastVals?.alk);
    result.alk = alkStab.value;
    if (alkStab.range) result.__alkRange = alkStab.range;
    result.__alkConfidence = alkStab.confidence;

    // CYA (stabilized)
    const cyaPick = valueFromPad("cya", () => 40);
    const cyaStab = stabilizedValue("cya", cyaPick, lastVals?.cya);
    result.cya = cyaStab.value;
    if (cyaStab.range) result.__cyaRange = cyaStab.range;
    result.__cyaConfidence = cyaStab.confidence;

    Object.entries(result.__padDebug).forEach(([key, debug]) => {
      if (debug.confidenceLabel === "Low") {
        result.__warnings.push(`${debug.label} result has low confidence. Rescan under improved lighting.`);
      }
    });
    if (scanQuality?.warnings?.length) result.__warnings.push(...scanQuality.warnings);

    // Apply calibration offsets
    result.ph = Number((result.ph + (calOffsets.ph || 0)).toFixed(2));
    result.alk = Math.round(result.alk + (calOffsets.alk || 0));
    result.cya = Math.round(result.cya + (calOffsets.cya || 0));
    result.hardness = Math.round(result.hardness + (calOffsets.hardness || 0));

    // Final formatting
    result.ph = Number(result.ph.toFixed(2));
    result.freeCl = Number(result.freeCl.toFixed(2));
    result.totalCl = Number(result.totalCl.toFixed(2));
    result.bromine = Number(result.bromine.toFixed(1));
    result.hardness = Math.round(result.hardness);
    result.alk = Math.round(result.alk);
    result.cya = Math.round(result.cya);

    return result;
  }

  // ================================================================
  // 11) Bars + recommendations
  // ================================================================

  const pct = (v, min, max) => Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));

  function tag(el, state, text) {
    if (!el) return;
    let cls = "tag ";
    if (state === "ok") cls += "ok";
    else if (state === "bad") cls += "bad";
    else cls += "warn";
    el.className = cls;
    el.textContent = text;
  }

  function renderBars(vals) {
    els.barPh && (els.barPh.style.width = pct(vals.ph, 6.0, 9.0) + "%");
    els.barFCl && (els.barFCl.style.width = pct(vals.freeCl, 0, 10) + "%");
    els.barTCl && (els.barTCl.style.width = pct(vals.totalCl, 0, 20) + "%");
    els.barBr && (els.barBr.style.width = pct(vals.bromine, 0, 40) + "%");
    els.barHard && (els.barHard.style.width = pct(vals.hardness, 0, 425) + "%");
    els.barAlk && (els.barAlk.style.width = pct(vals.alk, 0, 360) + "%");
    els.barCya && (els.barCya.style.width = pct(vals.cya, 0, 240) + "%");

    const phText = Array.isArray(vals.__phRange) ? `${vals.__phRange[0]}–${vals.__phRange[1]}` : `${vals.ph}`;
    if (vals.ph < 7.2) tag(els.tagPh, "warn", `Low (${phText})`);
    else if (vals.ph > 7.8) tag(els.tagPh, "warn", `High (${phText})`);
    else tag(els.tagPh, "ok", `Good (${phText})`);

    if (vals.freeCl < 1) tag(els.tagFCl, "warn", `Low (${vals.freeCl} ppm)`);
    else if (vals.freeCl > 3) tag(els.tagFCl, "warn", `High (${vals.freeCl} ppm)`);
    else tag(els.tagFCl, "ok", `Good (${vals.freeCl} ppm)`);

    tag(els.tagTCl, "ok", `${vals.totalCl} ppm`);

    if (vals.bromine < 2) tag(els.tagBr, "warn", `Low (${vals.bromine} ppm)`);
    else if (vals.bromine > 6) tag(els.tagBr, "warn", `High (${vals.bromine} ppm)`);
    else tag(els.tagBr, "ok", `Good (${vals.bromine} ppm)`);

    if (vals.hardness < 150) tag(els.tagHard, "warn", `Low (${vals.hardness} ppm)`);
    else if (vals.hardness > 300) tag(els.tagHard, "warn", `High (${vals.hardness} ppm)`);
    else tag(els.tagHard, "ok", `Good (${vals.hardness} ppm)`);

    const alkText = Array.isArray(vals.__alkRange) ? `${vals.__alkRange[0]}–${vals.__alkRange[1]} ppm` : `${vals.alk} ppm`;
    if (vals.alk < 80) tag(els.tagAlk, "warn", `Low (${alkText})`);
    else if (vals.alk > 120) tag(els.tagAlk, "warn", `High (${alkText})`);
    else tag(els.tagAlk, "ok", `Good (${alkText})`);

    const cyaText = Array.isArray(vals.__cyaRange) ? `${vals.__cyaRange[0]}–${vals.__cyaRange[1]} ppm` : `${vals.cya} ppm`;
    if (vals.cya < 30) tag(els.tagCya, "warn", `Low (${cyaText})`);
    else if (vals.cya > 100) tag(els.tagCya, "warn", `High (${cyaText})`);
    else tag(els.tagCya, "ok", `Good (${cyaText})`);
  }

  function renderScanDiagnostics(vals) {
    latestScanDebug = vals || null;
    const quality = vals?.__scanQuality || null;

    if (els.scanQuality) {
      if (!quality) {
        els.scanQuality.className = "tag warn";
        els.scanQuality.textContent = "Scan quality: not evaluated";
      } else {
        const state = quality.score >= 82 ? "ok" : quality.score >= 62 ? "warn" : "bad";
        els.scanQuality.className = `tag ${state}`;
        els.scanQuality.textContent = `Scan quality: ${quality.label} (${quality.score}/100)`;
      }
    }

    if (!els.scanDebug) return;
    if (!vals?.__padDebug) {
      els.scanDebug.innerHTML = `<p class="muted hint">Run a scan to see LAB/Delta-E diagnostics.</p>`;
      return;
    }

    const warningItems = Array.from(new Set([...(vals.__warnings || []), ...(quality?.warnings || [])]));
    const correctionDetails = quality?.details || {};
    const correctionBlock = `
      <div class="scan-debug-correction">
        <span class="muted hint">Original angle: ${correctionDetails.angleFromVertical == null ? "-" : `${Number(correctionDetails.angleFromVertical).toFixed(1)}° from vertical`}</span>
        <span class="muted hint">Corrected angle: ${correctionDetails.correctedAngle == null ? "-" : `${Number(correctionDetails.correctedAngle).toFixed(1)}°`}</span>
        <span class="muted hint">Rotation corrected: ${correctionDetails.rotationCorrected ? "yes" : "no"}</span>
        <span class="muted hint">Perspective corrected: ${correctionDetails.perspectiveCorrected ? "yes" : "no"}</span>
        <span class="muted hint">Strip detection: ${Math.round(Number(correctionDetails.stripDetectionConfidence || 0) * 100)}%</span>
        <span class="muted hint">Correction confidence: ${Math.round(Number(correctionDetails.correctionConfidence || 0) * 100)}%</span>
        <span class="muted hint">Pad spacing: ${correctionDetails.padSpacingConsistency == null ? "-" : `${Math.round(Number(correctionDetails.padSpacingConsistency) * 100)}%`}</span>
        <span class="muted hint">Bounds: ${correctionDetails.detectedStripBounds ? escapeHtml(`${correctionDetails.detectedStripBounds.x},${correctionDetails.detectedStripBounds.y} ${correctionDetails.detectedStripBounds.w}x${correctionDetails.detectedStripBounds.h}`) : "-"}</span>
        <span class="muted hint">Pad centers: ${Array.isArray(correctionDetails.detectedPadCenters) && correctionDetails.detectedPadCenters.length ? escapeHtml(correctionDetails.detectedPadCenters.map(p => `(${p.x},${p.y})`).join(" ")) : "-"}</span>
        <span class="muted hint">Paper LAB: ${correctionDetails.samplingPaperLab ? escapeHtml(`${Number(correctionDetails.samplingPaperLab.l).toFixed(1)}, ${Number(correctionDetails.samplingPaperLab.a).toFixed(1)}, ${Number(correctionDetails.samplingPaperLab.b).toFixed(1)}`) : "-"}</span>
      </div>
      ${correctionDetails.samplingOverlayDataUrl ? `<figure class="sampling-overlay"><figcaption>Sampled pixels overlay</figcaption><img src="${escapeHtml(correctionDetails.samplingOverlayDataUrl)}" alt="Overlay showing detected pad boxes and sampled pixels"></figure>` : ""}
    `;
    const padRows = EASYTEST_CFG.pads.map(pad => vals.__padDebug[pad.key]).filter(Boolean).map(debug => {
      const distances = debug.distances
        .map(item => `${escapeHtml(item.value)}: ${item.deltaE}`)
        .join(", ");
      return `
        <tr>
          <td>${escapeHtml(debug.label)}</td>
          <td>
            <span class="scan-color-chip" style="background:rgb(${debug.measuredRgb.r},${debug.measuredRgb.g},${debug.measuredRgb.b})"></span>
            <span class="scan-color-chip" style="background:rgb(${debug.normalizedRgb.r},${debug.normalizedRgb.g},${debug.normalizedRgb.b})"></span>
          </td>
          <td>${escapeHtml(debug.measuredRgb.r)}, ${escapeHtml(debug.measuredRgb.g)}, ${escapeHtml(debug.measuredRgb.b)}</td>
          <td>${escapeHtml(debug.measuredLab.l)}, ${escapeHtml(debug.measuredLab.a)}, ${escapeHtml(debug.measuredLab.b)}</td>
          <td>${escapeHtml(debug.bestValue)} (${escapeHtml(debug.bestDeltaE)})</td>
          <td>${escapeHtml(debug.secondValue ?? "-")} (${escapeHtml(debug.secondDeltaE ?? "-")})</td>
          <td>${escapeHtml(debug.confidenceLabel)} (${Math.round(debug.confidence * 100)}%)</td>
          <td>${escapeHtml(distances)}</td>
        </tr>
      `;
    }).join("");

    els.scanDebug.innerHTML = `
      <div class="scan-debug-summary">
        <span class="tag ${quality?.score >= 82 ? "ok" : quality?.score >= 62 ? "warn" : "bad"}">${escapeHtml(quality?.label || "Low")} quality</span>
        <span class="muted hint">Exposure: ${Number(quality?.details?.exposure || 0).toFixed(1)}</span>
        <span class="muted hint">Pad variance: ${Number(quality?.details?.averagePadVariance || 0).toFixed(1)}</span>
      </div>
      ${correctionBlock}
      ${warningItems.length ? `<ul class="scan-debug-warnings">${warningItems.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      <div class="scan-debug-table-wrap">
        <table class="scan-debug-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>Preview</th>
              <th>RGB</th>
              <th>LAB</th>
              <th>Best Delta-E</th>
              <th>Second</th>
              <th>Confidence</th>
              <th>All distances</th>
            </tr>
          </thead>
          <tbody>${padRows}</tbody>
        </table>
      </div>
    `;
  }

  function runSanityCheck(vals) {
    if (!vals) return null;
    const poolContext = getPoolContextFromInputs();
    lastSanityCheck = runStripSanityCheck(vals, {
      history: loadHistory(),
      recentActions: loadSanityContext().recentActions,
      poolContext: { gallons: poolGallons },
      ...poolContext
    });
    vals.__poolContext = poolContext;
    vals.__sanityCheck = lastSanityCheck;
    return lastSanityCheck;
  }

  function severityClass(severity) {
    if (severity === "Critical" || severity === "Warning") return "bad";
    if (severity === "Caution") return "warn";
    return "ok";
  }

  function renderSanityCheck(sanity) {
    if (!els.sanitySummary && !els.sanityDetails && !els.sanityContext) return;

    if (!sanity) {
      if (els.sanitySummary) {
        els.sanitySummary.innerHTML = `<p class="muted hint">Run a scan to see AquaLab's smart review.</p>`;
      }
      if (els.sanityDetails) {
        els.sanityDetails.innerHTML = `<p class="muted hint">Engineer Mode will show rule triggers after a scan.</p>`;
      }
      if (els.sanityContext) els.sanityContext.hidden = true;
      if (els.poolContextPanel) els.poolContextPanel.hidden = true;
      return;
    }

    if (els.poolContextPanel) els.poolContextPanel.hidden = false;
    const context = lastVals?.__poolContext || loadPoolContext();
    const scoreClass = sanity.scoreConfidence === "High" ? "ok" : sanity.scoreConfidence === "Medium" ? "warn" : "bad";
    const findings = sanity.topFindings || [];

    if (els.sanitySummary) {
      els.sanitySummary.innerHTML = `
        <article class="smart-review-hero ${scoreClass}">
          <div>
            <span class="section-eyebrow">${escapeHtml(sanity.summaryState || "Pool Health Analysis")}</span>
            <h3>Pool Health: ${escapeHtml(sanity.poolHealthScore)} / 100</h3>
          </div>
          <div class="smart-review-meta">
            <span class="tag ${scoreClass}">Confidence: ${escapeHtml(sanity.scoreConfidence)}</span>
            <span class="tag">Water Appearance: ${escapeHtml(sanity.waterAppearanceLabel || poolContextLabel("waterAppearance", context.waterAppearance))}</span>
          </div>
          <p>${escapeHtml(sanity.summary)}</p>
          <p><strong>Next Action:</strong> ${escapeHtml(sanity.nextAction || "Review findings before dosing.")}</p>
          <small class="muted">Retest timing: ${escapeHtml(sanity.retestTiming || "Use normal retest timing.")}</small>
        </article>
        ${findings.length ? `<div class="sanity-cards top-findings">${findings.map(check => `
          <article class="sanity-card ${severityClass(check.severity)}">
            <strong>${escapeHtml(check.parameter)}: ${escapeHtml(check.status)}</strong>
            <p>${escapeHtml(check.message)}</p>
            <small>${escapeHtml(check.recommendedAction)}</small>
          </article>
        `).join("")}</div>` : `<p class="muted hint">No suspicious chemistry jumps or low-confidence dosing guards were triggered.</p>`}
        ${(sanity.allFindings || []).length > findings.length ? `<details class="smart-review-details"><summary>View Details</summary><div class="sanity-cards">${(sanity.allFindings || []).slice(3).map(check => `
          <article class="sanity-card ${severityClass(check.severity)}">
            <strong>${escapeHtml(check.parameter)}: ${escapeHtml(check.status)}</strong>
            <p>${escapeHtml(check.message)}</p>
            <small>${escapeHtml(check.recommendedAction)}</small>
          </article>
        `).join("")}</div></details>` : ""}
      `;
    }

    if (els.sanityContext) {
      if (!sanity.contextQuestion) {
        els.sanityContext.hidden = true;
      } else {
        const selected = new Set(loadSanityContext().recentActions);
        els.sanityContext.hidden = false;
        els.sanityContext.innerHTML = `
          <strong>${escapeHtml(sanity.contextQuestion.prompt)}</strong>
          <div class="sanity-context-options">
            ${sanity.contextQuestion.options.map(option => `
              <label>
                <input type="checkbox" data-pt-sanity-action="${escapeHtml(option.value)}" ${selected.has(option.value) ? "checked" : ""}>
                <span>${escapeHtml(option.label)}</span>
              </label>
            `).join("")}
          </div>
          <button type="button" class="btn-ghost" data-pt="sanityApplyContext">Update smart review</button>
        `;
      }
    }

    if (els.sanityDetails) {
      els.sanityDetails.innerHTML = `
        <div class="scan-debug-summary">
          <span class="tag ${scoreClass}">Summary: ${escapeHtml(sanity.summaryState)}</span>
          <span class="muted hint">Chemistry score: ${escapeHtml(sanity.chemistryScore ?? "-")}</span>
          <span class="muted hint">Appearance adjustment: ${escapeHtml(sanity.appearanceAdjustment ?? 0)}</span>
        </div>
        <div class="scan-debug-table-wrap">
          <table class="scan-debug-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Raw</th>
                <th>Adjusted</th>
                <th>Status</th>
                <th>Reason codes</th>
                <th>Prior comparison</th>
              </tr>
            </thead>
            <tbody>
              ${sanity.checks.map(check => `
                <tr>
                  <td>${escapeHtml(check.parameter)}</td>
                  <td>${escapeHtml(check.measuredValue)} ${escapeHtml(check.unit)} / ${escapeHtml(check.rawConfidence)}</td>
                  <td>${escapeHtml(check.adjustedConfidence)}</td>
                  <td>${escapeHtml(check.status)} (${escapeHtml(check.severity)})</td>
                  <td>${escapeHtml(check.reasonCodes.join(", ") || "HIGH_CONFIDENCE_CONFIRMED")}</td>
                  <td>${check.priorValue == null ? "-" : `${escapeHtml(check.priorValue)} -> ${escapeHtml(check.measuredValue)} (${escapeHtml(check.change)})`}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    }
  }
  function rerunSanityWithContext() {
    if (!lastVals) return;
    const checked = Array.from(root.querySelectorAll("[data-pt-sanity-action]:checked")).map(input => input.getAttribute("data-pt-sanity-action"));
    const finalActions = checked.includes("none") ? ["none"] : checked.filter(value => value !== "none");
    saveSanityContext(finalActions);
    renderSanityCheck(runSanityCheck(lastVals));
    renderRecs(lastVals);
  }

  function updatePoolContextReview() {
    const context = getPoolContextFromInputs();
    applyPoolContextInputs(context);
    if (!lastVals) return;
    renderSanityCheck(runSanityCheck(lastVals));
    renderRecs(lastVals);
  }

  let poolGallons = null;
  let poolCollapsed = false;

  function chemistrySanityWarnings(vals) {
    const warnings = [];
    const history = (() => {
      try { return loadHistory(); } catch { return []; }
    })();
    const previous = history.length ? history[history.length - 1] : null;
    if (previous && Number.isFinite(Number(previous.cya)) && Number.isFinite(Number(vals.cya))) {
      const jump = Math.abs(Number(vals.cya) - Number(previous.cya));
      if (jump >= 70 && (vals.__cyaConfidence ?? 1) < 0.65) {
        warnings.push("CYA result has low confidence and differs sharply from the previous scan. Rescan under improved lighting.");
      }
    }
    if ((vals.__phConfidence ?? 1) < 0.55 && (vals.ph <= 6.4 || vals.ph >= 8.2)) {
      warnings.push("pH result is extreme with low confidence. Confirm with a fresh strip or rescan in indirect daylight.");
    }
    if ((vals.__freeClConfidence ?? 1) < 0.55 && (vals.__totalClConfidence ?? 1) < 0.55) {
      warnings.push("Chlorine pads have low confidence. Confirm under better light before dosing.");
    }
    return warnings;
  }

  function renderRecs(vals) {
    if (!els.recs) return;
    const recs = [];
    const sanity = vals.__sanityCheck || lastSanityCheck || runSanityCheck(vals);
    const sanityMessages = (sanity?.checks || [])
      .filter(check => check.severity !== "Info" || check.adjustedConfidence === "Low")
      .map(check => `${check.message} ${check.recommendedAction}`);
    const warnings = Array.from(new Set([...(vals.__warnings || []), ...chemistrySanityWarnings(vals), ...sanityMessages]));

    warnings.forEach(warning => recs.push(`Scan warning: ${warning}`));

    if (!poolGallons) {
      recs.push("Enter your pool size above (or manual gallons) so the app can calculate real chemical amounts.");
      els.recs.innerHTML = recs.map(x => `<li>${x}</li>`).join("");
      return;
    }

    const factor10k = poolGallons / 10000;
    recs.push(`Estimated pool volume: about ${poolGallons.toLocaleString()} gallons (~${factor10k.toFixed(2)} × 10,000 gal).`);

    const targets = { ph: 7.5, freeCl: 2.5, hardness: 250, alk: 100, cya: 40 };
    const checkFor = key => sanity?.checks?.find(check => check.key === key);
    const highConfidence = key => (checkFor(key)?.adjustedConfidence || "Low") === "High";

    if (vals.ph < 7.2) {
      const deltaPh = Math.max(0, targets.ph - vals.ph);
      const ozSodaAsh = (deltaPh / 0.2) * 6 * factor10k;
      const dose = formatWeightOz(ozSodaAsh);
      recs.push(`pH is low (${vals.ph}). Target is ~${targets.ph}. ${dose && highConfidence("ph") ? `Add about ${dose} of pH increaser (soda ash), split into smaller doses with circulation.` : `Confirm pH with a fresh strip before making a large pH adjustment.`}`);
    } else if (vals.ph > 7.8) {
      const deltaPh = Math.max(0, vals.ph - targets.ph);
      const ozAcid = (deltaPh / 0.2) * 12 * factor10k;
      const dose = formatWeightOz(ozAcid);
      recs.push(`pH is high (${vals.ph}). Target is ~${targets.ph}. ${dose && highConfidence("ph") ? `Add about ${dose} of pH reducer (muriatic acid ~31%) in divided doses.` : `Confirm pH with a fresh strip before making a large acid adjustment.`}`);
    } else recs.push(`pH is in the recommended range (${vals.ph}).`);

    if (vals.freeCl < 1) {
      const deltaCl = Math.max(0, targets.freeCl - vals.freeCl);
      const ozCl = deltaCl * 10.7 * factor10k;
      const dose = formatWeightOz(ozCl);
      recs.push(`Free chlorine is low (${vals.freeCl} ppm). Target is about ${targets.freeCl} ppm. ${dose ? `Add about ${dose} of 12% liquid chlorine, then circulate and retest after 30–60 minutes.` : `Add liquid chlorine per the dosing chart on your product label.`}`);
    } else if (vals.freeCl > 3) {
      recs.push(`Free chlorine is high (${vals.freeCl} ppm). Keep the pump running and avoid adding more chlorine so it can drift down.`);
    } else recs.push(`Free chlorine is in a normal range (${vals.freeCl} ppm).`);

    if (vals.alk < 80) {
      const deltaAlk = Math.max(0, targets.alk - vals.alk);
      const lbsBicarb = (deltaAlk / 10) * 1.5 * factor10k;
      const ozBicarb = lbsBicarb * 16;
      const dose = formatWeightOz(ozBicarb);
      recs.push(`Total alkalinity is low (${vals.alk} ppm). Target is ~${targets.alk} ppm. ${dose ? `Add about ${dose} of alkalinity increaser (baking soda) in portions with the pump running.` : `Use an alkalinity increaser according to the package chart for your pool gallons.`}`);
    } else if (vals.alk > 120) recs.push(`Total alkalinity is high (${vals.alk} ppm). Usually lowered gradually with pH reducer and/or partial water replacement.`);
    else recs.push(`Total alkalinity is in range (${vals.alk} ppm).`);

    if (vals.cya < 30) {
      const deltaCya = Math.max(0, targets.cya - vals.cya);
      const ozCya = (deltaCya / 10) * 13 * factor10k;
      const dose = formatWeightOz(ozCya);
      recs.push(`Cyanuric acid is low (${vals.cya} ppm). Target ~${targets.cya} ppm. ${dose && highConfidence("cya") ? `Add about ${dose} of stabilizer (per-label directions), then retest in 1–2 days.` : `Retest or confirm CYA before adding stabilizer.`}`);
    } else if (vals.cya > 100) {
      recs.push(`Cyanuric acid is high (${vals.cya} ppm). ${highConfidence("cya") ? `Partial drain/refill is usually how you lower it safely.` : `Retest or confirm with a dedicated CYA test before considering drain/refill.`}`);
    }
    else recs.push(`Cyanuric acid is in a normal range (${vals.cya} ppm).`);

    if (vals.hardness < 150) recs.push(`Total hardness is low (${vals.hardness} ppm). Some pools may need calcium hardness increaser.`);
    else if (vals.hardness > 300) recs.push(`Total hardness is high (${vals.hardness} ppm). High hardness increases scale risk.`);
    else recs.push(`Total hardness is in a typical range (${vals.hardness} ppm).`);

    recs.push("These amounts are rough rules of thumb per 10,000 gallons. Always follow product labels and retest between adjustments.");
    els.recs.innerHTML = recs.map(x => `<li>${x}</li>`).join("");
  }

  // ================================================================
  // 12) Analyze (cache -> sample -> compute -> render -> save)
  // ================================================================

  function averageRgbList(items) {
    const list = items.filter(Boolean);
    if (!list.length) return null;
    return {
      r: list.reduce((sum, item) => sum + item.r, 0) / list.length,
      g: list.reduce((sum, item) => sum + item.g, 0) / list.length,
      b: list.reduce((sum, item) => sum + item.b, 0) / list.length
    };
  }

  function averageFrameSamples(frameContexts) {
    const frames = frameContexts.length ? frameContexts : [];
    const sampled = frames.map(frameCtx => {
      const leveled = autoLevelFrameContext(frameCtx);
      const padColors = samplePadsEasyTest(leveled.ctx);
      const samplingDiagnostics = padColors.__samplingDiagnostics || null;
      return {
        ctx: leveled.ctx,
        originalCtx: frameCtx,
        padColors,
        avgRgb: sampleStripe(leveled.ctx),
        neutral: sampleNeutralReference(leveled.ctx),
        correction: {
          ...leveled.diagnostics,
          detectedPadCenters: samplingDiagnostics?.detectedPadCenters || [],
          padSpacingConsistency: samplingDiagnostics?.padSpacingConsistency ?? null,
          padSpacingVariance: samplingDiagnostics?.padSpacingVariance ?? null,
          detectedSegments: samplingDiagnostics?.detectedSegments || [],
          sampledPixels: samplingDiagnostics?.sampledPixels || {},
          samplingPaperLab: samplingDiagnostics?.paperLab || null,
          samplingOverlayDataUrl: samplingDiagnostics?.overlayDataUrl || null,
          samplingWarning: samplingDiagnostics?.samplingWarning || ""
        }
      };
    });
    const complete = sampled.filter(frame => Object.keys(frame.padColors || {}).filter(k => k !== "__avg").length === 7);
    const source = complete.length ? complete : sampled;
    const padColors = {};

    EASYTEST_CFG.pads.forEach(pad => {
      const colors = source.map(frame => frame.padColors?.[pad.key]).filter(Boolean);
      if (!colors.length) return;
      const avg = averageRgbList(colors);
      const frameVariance = colors.reduce((sum, color) => {
        return sum + Math.abs(color.r - avg.r) + Math.abs(color.g - avg.g) + Math.abs(color.b - avg.b);
      }, 0) / (colors.length * 3);
      const internalVariance = colors.reduce((sum, color) => sum + Number(color.__var || 0), 0) / colors.length;
      padColors[pad.key] = {
        ...avg,
        __var: internalVariance + frameVariance,
        __frameVariance: frameVariance,
        __frameCount: colors.length
      };
    });

    const correctionSource = source[source.length - 1]?.correction || sampled[sampled.length - 1]?.correction || null;
    const rotationCount = source.filter(frame => frame.correction?.rotationCorrected).length;
    const lowCorrectionConfidence = source.some(frame => (frame.correction?.correctionConfidence ?? 1) < 0.34);

    return {
      ctx: source[source.length - 1]?.ctx || frames[frames.length - 1],
      padColors,
      avgRgb: averageRgbList(source.map(frame => frame.avgRgb)) || { r: 0, g: 0, b: 0 },
      neutralReference: averageRgbList(source.map(frame => frame.neutral).filter(Boolean)),
      frameCount: source.length,
      correctionDiagnostics: correctionSource ? {
        ...correctionSource,
        rotationCorrected: rotationCount > 0,
        correctedFrameCount: rotationCount,
        lowCorrectionConfidence
      } : null
    };
  }

  function cloneCanvasContext() {
    const off = document.createElement("canvas");
    off.width = els.canvas.width;
    off.height = els.canvas.height;
    const offCtx = off.getContext("2d", { willReadFrequently: true });
    offCtx.drawImage(els.canvas, 0, 0);
    return offCtx;
  }

  const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

  async function analyzeLiveMultiFrame() {
    const frames = [];
    for (let i = 0; i < 5; i++) {
      drawFromVideo();
      frames.push(cloneCanvasContext());
      if (i < 4) await wait(90);
    }
    return analyze(frames[frames.length - 1], frames);
  }

  function analyze(ctx, frameContexts = null) {
    let imgHash = null;
    try { imgHash = hashCanvas(ctx); } catch { imgHash = null; }
    const cacheKey = imgHash ? `${imgHash}:${calibrationFingerprint()}` : null;

    if (cacheKey) {
      const hit = cacheGet(cacheKey);
      if (hit?.vals) {
        lastVals = hit.vals;
        const sanity = runSanityCheck(hit.vals);
        renderBars(hit.vals);
        renderSanityCheck(sanity);
        renderRecs(hit.vals);
        renderScanDiagnostics(hit.vals);
        setStatus(`EasyTest scan (cached) | id=${imgHash}`);
        els.canvas && (els.canvas.hidden = true);
        return hit.vals;
      }
    }

    const frameSample = averageFrameSamples(frameContexts?.length ? frameContexts : [ctx]);
    const padColors = frameSample.padColors;
    const avgRgb = frameSample.avgRgb;
    padColors.__avg = avgRgb;

    const padCount = Object.keys(padColors).filter(k => k !== "__avg").length;
    if (padCount < 7) {
      lastVals = null;
      renderScanDiagnostics(null);
      setStatus(`Low confidence: only detected ${padCount}/7 pads. Retake photo (bright light, straight-on, avoid glare, include all pads).`);
      els.canvas && (els.canvas.hidden = true);
      return null;
    }

    const neutralReference = frameSample.neutralReference;
    const scanQuality = evaluateScanQuality(frameSample.ctx || ctx, padColors, avgRgb, neutralReference, frameSample.correctionDiagnostics);
    scanQuality.details.frameCount = frameSample.frameCount || 1;
    scanQuality.correction = frameSample.correctionDiagnostics || null;
    const vals = rgbToChemistryEasyTest(padColors, scanQuality, neutralReference);
    lastVals = vals;
    const sanity = runSanityCheck(vals);

    renderBars(vals);
    renderSanityCheck(sanity);
    renderRecs(vals);
    renderScanDiagnostics(vals);
    let statusPrefix = scanQuality.score < 55
      ? "Low scan quality. Move to indirect daylight and rescan."
      : "EasyTest scan";
    if (scanQuality.correction?.rotationCorrected && scanQuality.score >= 55) statusPrefix = "EasyTest scan | Strip was auto-leveled.";
    else if ((scanQuality.correction?.correctionConfidence ?? 1) < 0.34) statusPrefix = "Low correction confidence. Try placing the strip straighter in the frame.";
    setStatus(`${statusPrefix} | Avg RGB ≈ (${avgRgb.r | 0}, ${avgRgb.g | 0}, ${avgRgb.b | 0}) | quality ${scanQuality.score}/100${imgHash ? ` | id=${imgHash}` : ""}`);

    els.canvas && (els.canvas.hidden = true);

    if (cacheKey) cachePut(cacheKey, vals);
    recordFingerprint(imgHash, padColors, avgRgb, vals);
    return vals;
  }

  // ================================================================
  // 13) Pool setup persistence
  // ================================================================

  const HISTORY_KEY = "pt_history_v2";
  const POOL_SETUP_KEY = "pt_pool_setup_v1";
  const MAX_HISTORY = 365;

  const historyCharts = { ph: null, chlorine: null, alk: null, cya: null };

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch { return []; }
  }
  function saveHistory(arr) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch {}
  }

  function recordReading(vals) {
    const history = loadHistory();
    history.push({
      t: Date.now(),
      gallons: poolGallons,
      ph: vals.ph,
      freeCl: vals.freeCl,
      totalCl: vals.totalCl,
      bromine: vals.bromine,
      hardness: vals.hardness,
      alk: vals.alk,
      cya: vals.cya,
      chlorineCorrected: !!vals.__chlorineCorrected,
      scanQuality: vals.__scanQuality || null,
      confidence: {
        ph: vals.__phConfidence ?? null,
        freeCl: vals.__freeClConfidence ?? null,
        totalCl: vals.__totalClConfidence ?? null,
        alk: vals.__alkConfidence ?? null,
        cya: vals.__cyaConfidence ?? null,
        hardness: vals.__hardnessConfidence ?? null
      },
      waterAppearance: vals.__poolContext?.waterAppearance || loadPoolContext().waterAppearance,
      recentRain: vals.__poolContext?.recentRain || loadPoolContext().recentRain,
      poolUsage: vals.__poolContext?.poolUsage || loadPoolContext().poolUsage,
      surfaceCondition: vals.__poolContext?.surfaceCondition || loadPoolContext().surfaceCondition,
      timestamp: new Date().toISOString(),
      sanityCheck: vals.__sanityCheck || null
    });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    saveHistory(history);
    renderHistoryCharts(history);
  }

  function renderHistoryLog(historyOpt) {
    if (!els.historyLog) return;
    const history = historyOpt || loadHistory();
    if (!history.length) {
      els.historyLog.innerHTML = `<p class="muted hint">No saved readings yet.</p>`;
      return;
    }
    const recent = history.slice(-5).reverse();
    els.historyLog.innerHTML = `
      <h3>Recent Saved Context</h3>
      <div class="history-log-list">
        ${recent.map(item => `
          <article class="history-log-item">
            <strong>${escapeHtml(new Date(item.t || Date.now()).toLocaleString())}</strong>
            <span>${escapeHtml(poolContextLabel("waterAppearance", item.waterAppearance))}</span>
            <span>Rain: ${escapeHtml(poolContextLabel("recentRain", item.recentRain))}</span>
            <span>Usage: ${escapeHtml(poolContextLabel("poolUsage", item.poolUsage))}</span>
            <span>Surface: ${escapeHtml(poolContextLabel("surfaceCondition", item.surfaceCondition))}</span>
          </article>
        `).join("")}
      </div>
    `;
  }
  function renderHistoryCharts(historyOpt) {
    if (typeof Chart === "undefined") return;
    const history = historyOpt || loadHistory();
    if (!history.length) return;

    const labels = history.map(h => new Date(h.t).toLocaleString(undefined, {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
    }));

    const series = {
      ph: history.map(h => h.ph),
      freeCl: history.map(h => h.freeCl),
      totalCl: history.map(h => Math.max(h.totalCl, h.freeCl)),
      alk: history.map(h => h.alk),
      cya: history.map(h => h.cya)
    };

    function upsertChart(key, yLabel, canvas, datasets, optionsOverride) {
      if (!canvas || !canvas.getContext) return;

      const baseOptions = {
        responsive: true,
        scales: {
          y: { title: { display: true, text: yLabel } },
          x: { ticks: { maxRotation: 0, minRotation: 0 } }
        },
        plugins: { legend: { display: datasets.length > 1 } }
      };

      const mergedOptions = Object.assign({}, baseOptions, optionsOverride || {});
      if (optionsOverride?.plugins) mergedOptions.plugins = Object.assign({}, baseOptions.plugins || {}, optionsOverride.plugins);
      if (optionsOverride?.scales) mergedOptions.scales = Object.assign({}, baseOptions.scales || {}, optionsOverride.scales);

      if (!historyCharts[key]) {
        historyCharts[key] = new Chart(canvas.getContext("2d"), {
          type: "line",
          data: { labels, datasets },
          options: mergedOptions
        });
      } else {
        const c = historyCharts[key];
        c.data.labels = labels;
        c.data.datasets = datasets;
        c.options = mergedOptions;
        c.update();
      }
    }

    upsertChart("ph", "pH", els.chartPh, [
      { label: "pH", data: series.ph, tension: 0.3, pointRadius: 2 }
    ], { plugins: { legend: { display: false } }, scales: { y: { suggestedMin: 6, suggestedMax: 9 } } });

    upsertChart("chlorine", "ppm", els.chartFCl, [
      { label: "Free Chlorine", data: series.freeCl, tension: 0.3, pointRadius: 2 },
      { label: "Total Chlorine", data: series.totalCl, tension: 0.3, pointRadius: 2, borderDash: [6, 4] }
    ], {
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            footer: (tooltipItems) => {
              const i = tooltipItems?.[0]?.dataIndex;
              if (i == null) return "";
              const fc = Number(series.freeCl[i]);
              const tc = Number(series.totalCl[i]);
              if (!isFinite(fc) || !isFinite(tc)) return "";
              const corrected = !!history?.[i]?.chlorineCorrected;
              if (corrected) return "Combined Chlorine: inferred (TC/FC corrected)";
              const cc = Math.max(0, tc - fc);
              return `Combined Chlorine: ${cc.toFixed(2)} ppm`;
            }
          }
        }
      },
      scales: { y: { suggestedMin: 0, suggestedMax: 20 } }
    });

    upsertChart("alk", "ppm", els.chartAlk, [
      { label: "Total Alkalinity (ppm)", data: series.alk, tension: 0.3, pointRadius: 2 }
    ], { plugins: { legend: { display: false } }, scales: { y: { suggestedMin: 0, suggestedMax: 360 } } });

    upsertChart("cya", "ppm", els.chartCya, [
      { label: "Cyanuric Acid (ppm)", data: series.cya, tension: 0.3, pointRadius: 2 }
    ], { plugins: { legend: { display: false } }, scales: { y: { suggestedMin: 0, suggestedMax: 240 } } });
  }

  const getNum = el => el ? parseFloat(el.value || "0") : 0;

  function updateShapeVisibility() {
    if (!els.shape) return;
    const shape = els.shape.value;
    els.rectFields && (els.rectFields.style.display = shape === "rect" ? "" : "none");
    els.roundFields && (els.roundFields.style.display = shape === "round" ? "" : "none");
    els.ovalFields && (els.ovalFields.style.display = shape === "oval" ? "" : "none");
  }

  function applyPoolCollapsed() {
    root && root.classList.toggle("pooltest--pool-hidden", poolCollapsed);
    if (els.poolToggle) els.poolToggle.textContent = poolCollapsed ? "Show" : "Hide";
  }

  function savePoolSetup() {
    const conf = {
      shape: els.shape?.value || "rect",
      rectLen: getNum(els.rectLen),
      rectWid: getNum(els.rectWid),
      roundDia: getNum(els.roundDia),
      ovalLen: getNum(els.ovalLen),
      ovalWid: getNum(els.ovalWid),
      depthShallow: getNum(els.depthShallow),
      depthDeep: getNum(els.depthDeep),
      gallonsManual: getNum(els.gallonsManual),
      gallons: poolGallons || 0,
      collapsed: !!poolCollapsed
    };
    try { localStorage.setItem(POOL_SETUP_KEY, JSON.stringify(conf)); } catch {}
  }

  function loadPoolSetup() {
    let raw = null;
    try { raw = localStorage.getItem(POOL_SETUP_KEY); } catch {}
    if (!raw) {
      updateShapeVisibility();
      applyPoolCollapsed();
      els.gallonsDisplay && (els.gallonsDisplay.textContent = "Pool volume: – (enter shape/size or manual gallons)");
      return;
    }

    try {
      const conf = JSON.parse(raw);
      if (conf.shape && els.shape) els.shape.value = conf.shape;
      if (els.rectLen && conf.rectLen != null) els.rectLen.value = conf.rectLen;
      if (els.rectWid && conf.rectWid != null) els.rectWid.value = conf.rectWid;
      if (els.roundDia && conf.roundDia != null) els.roundDia.value = conf.roundDia;
      if (els.ovalLen && conf.ovalLen != null) els.ovalLen.value = conf.ovalLen;
      if (els.ovalWid && conf.ovalWid != null) els.ovalWid.value = conf.ovalWid;
      if (els.depthShallow && conf.depthShallow != null) els.depthShallow.value = conf.depthShallow;
      if (els.depthDeep && conf.depthDeep != null) els.depthDeep.value = conf.depthDeep;
      if (els.gallonsManual && conf.gallonsManual != null) els.gallonsManual.value = conf.gallonsManual;
      poolGallons = conf.gallons > 0 ? Math.round(conf.gallons) : null;
      poolCollapsed = !!conf.collapsed;
    } catch {}

    updateShapeVisibility();
    applyPoolCollapsed();

    els.gallonsDisplay && (els.gallonsDisplay.textContent = poolGallons
      ? `Pool volume: about ${poolGallons.toLocaleString()} gallons`
      : "Pool volume: – (enter shape/size or manual gallons)");
  }

  function calcGallons() {
    let gallons = 0;
    const manual = parseFloat(els.gallonsManual?.value || "0");

    if (manual > 0) {
      gallons = manual;
    } else {
      const shape = els.shape?.value || "rect";
      const shallow = parseFloat(els.depthShallow?.value || "0");
      const deep = parseFloat(els.depthDeep?.value || els.depthShallow?.value || "0");
      const avgDepth = (shallow && deep) ? (shallow + deep) / 2 : shallow || deep || 0;

      if (shape === "rect") {
        const L = parseFloat(els.rectLen?.value || "0");
        const W = parseFloat(els.rectWid?.value || "0");
        if (L > 0 && W > 0 && avgDepth > 0) gallons = L * W * avgDepth * 7.48;
      } else if (shape === "round") {
        const D = parseFloat(els.roundDia?.value || "0");
        if (D > 0 && avgDepth > 0) gallons = D * D * avgDepth * 5.9;
      } else if (shape === "oval") {
        const L = parseFloat(els.ovalLen?.value || "0");
        const W = parseFloat(els.ovalWid?.value || "0");
        if (L > 0 && W > 0 && avgDepth > 0) gallons = L * W * avgDepth * 5.9;
      }
    }

    poolGallons = gallons > 0 ? Math.round(gallons) : null;

    els.gallonsDisplay && (els.gallonsDisplay.textContent = poolGallons
      ? `Pool volume: about ${poolGallons.toLocaleString()} gallons`
      : "Pool volume: – (enter shape/size or manual gallons)");

    savePoolSetup();
    lastVals && renderRecs(lastVals);
  }

  function clearLocalData() {
    try {
      localStorage.removeItem(HISTORY_KEY);
      localStorage.removeItem(POOL_SETUP_KEY);
    } catch {}

    poolGallons = null;
    poolCollapsed = false;
    lastVals = null;

    els.gallonsDisplay && (els.gallonsDisplay.textContent = "Pool volume: – (enter shape/size or manual gallons)");
    els.recs && (els.recs.innerHTML = "<li>Local data cleared. Enter pool setup and scan a new strip.</li>");
    try {
      Object.keys(historyCharts).forEach(k => {
        historyCharts[k]?.destroy?.();
        historyCharts[k] = null;
      });
    } catch {}

    try {
      if (els.shape) els.shape.value = "rect";
      [els.rectLen, els.rectWid, els.roundDia, els.ovalLen, els.ovalWid, els.depthShallow, els.depthDeep, els.gallonsManual]
        .forEach(el => el && (el.value = ""));
      updateShapeVisibility();
      applyPoolCollapsed();
    } catch {}
  }

  // ================================================================
  // 14) iOS reliable "Take Photo" pipeline
  // ================================================================

  async function loadFileToImageIOSReliable(file) {
    let bmp = null;
    try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch { bmp = await createImageBitmap(file); }

    const tmp = document.createElement("canvas");
    tmp.width = bmp.width;
    tmp.height = bmp.height;
    tmp.getContext("2d").drawImage(bmp, 0, 0);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = tmp.toDataURL("image/jpeg", 0.95);
    });
  }

  // ================================================================
  // 15) Events
  // ================================================================

  els.btnStart?.addEventListener("click", startCamera);
  els.btnCapture?.addEventListener("click", async () => {
    setStatus("Capturing 5 frames for a steadier reading...");
    const vals = await analyzeLiveMultiFrame();
    if (vals) recordReading(vals);
  });

  // Phone-first buttons
  els.btnTakePhoto?.addEventListener("click", () => els.takeInput?.click());
  els.btnChoosePhoto?.addEventListener("click", () => els.fileInput?.click());

  els.btnClearCache?.addEventListener("click", clearScanCache);
  els.btnExportDataset?.addEventListener("click", exportCalibrationDataset);

  els.cameraSelect?.addEventListener("change", () => {
    const id = getSelectedCameraId();
    saveSelectedCameraId(id);
    if (stream) startCamera();
  });

  async function handlePickedFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;

    try {
      setStatus("Loading photo…");
      const img = await loadFileToImageIOSReliable(f);
      showPreview(img);
    } catch {
      setStatus("Couldn’t load that photo. On iPhone: Settings → Camera → Formats → Most Compatible (JPEG). Then try again.");
    } finally {
      e.target.value = ""; // allow same file twice
    }
  }

  els.fileInput?.addEventListener("change", handlePickedFile);
  els.takeInput?.addEventListener("change", handlePickedFile);

  els.btnUseCrop?.addEventListener("click", () => {
    const vals = analyzeFromPreviewCrop();
    if (vals) recordReading(vals);
  });

  els.btnManualPads?.addEventListener("click", toggleManualPadMode);
  els.btnResetManualPads?.addEventListener("click", () => {
    resetManualPadSelection(true);
    setStatus(`Manual pad mode: tap ${nextManualPadLabel()}, then continue top-to-bottom.`);
  });
  els.btnUseManualPads?.addEventListener("click", () => {
    const vals = analyzeFromManualPads();
    if (vals) recordReading(vals);
  });
  els.previewStage?.addEventListener("click", (ev) => {
    if (!manualPadMode) return;
    ev.preventDefault();
    ev.stopPropagation();
    addManualPadMarker(ev);
  });

  els.btnCancelCrop?.addEventListener("click", () => {
    hidePreview();
    setStatus("Canceled preview. Upload another image or use the camera.");
  });

  els.btnAutoCrop?.addEventListener("click", () => {
    if (!els.cropBox) return;
    els.cropBox.style.left = "32%";
    els.cropBox.style.top = "6%";
    els.cropBox.style.width = "36%";
    els.cropBox.style.height = "88%";
    setStatus("Auto-crop box set. Fine-tune if needed, then click Use Crop.");
  });

  els.btnWB?.addEventListener("click", () => {
    setStatus("Tap on a white/gray area to set white balance.");
    if (stream) drawFromVideo();
    els.canvas.hidden = false;

    const handler = ev => {
      const rect = els.canvas.getBoundingClientRect();
      const x = Math.round((ev.clientX - rect.left) * (els.canvas.width / rect.width));
      const y = Math.round((ev.clientY - rect.top) * (els.canvas.height / rect.height));
      setWBAt(x, y);
      setStatus("White balance set. Capture or upload an EasyTest strip.");
      els.canvas.removeEventListener("click", handler);
      els.canvas.hidden = true;
    };

    els.canvas.addEventListener("click", handler);
  });

  els.shape?.addEventListener("change", () => { updateShapeVisibility(); savePoolSetup(); });
  [els.rectLen, els.rectWid, els.roundDia, els.ovalLen, els.ovalWid, els.depthShallow, els.depthDeep, els.gallonsManual]
    .forEach(el => el?.addEventListener("input", savePoolSetup));

  els.btnCalcGallons?.addEventListener("click", calcGallons);

  els.poolToggle?.addEventListener("click", () => { poolCollapsed = !poolCollapsed; applyPoolCollapsed(); savePoolSetup(); });
  els.poolToggleGlobal?.addEventListener("click", () => { poolCollapsed = !poolCollapsed; applyPoolCollapsed(); savePoolSetup(); });

  els.btnRecalc?.addEventListener("click", () => { if (lastVals) renderRecs(lastVals); });
  [els.waterAppearance, els.recentRain, els.poolUsage, els.surfaceCondition].forEach(input => {
    input?.addEventListener("change", updatePoolContextReview);
  });
  root.addEventListener("click", (event) => {
    if (event.target?.matches?.('[data-pt="sanityApplyContext"]')) {
      rerunSanityWithContext();
    }
  });
  els.btnClearData?.addEventListener("click", clearLocalData);

  // ================================================================
  // 16) Init
  // ================================================================

  loadPoolSetup();
  applyPoolContextInputs();
  renderHistoryCharts();
  renderHistoryLog();
  listCameras();
  applyScannerMode();

  if (isIOS) {
    els.btnStart && (els.btnStart.textContent = "Live Camera (beta)");
    setStatus("Ready. iPhone/iPad: use Take Photo / Choose Photo for the most reliable scan. Then crop and scan.");
  } else {
    setStatus("Ready. Upload a photo to crop, or enable camera.");
  }

  window.addEventListener("pagehide", stopCamera);
}
