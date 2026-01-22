// scanner.js (EasyTest-only)
// Features:
// - EasyTest 7-in-1 swatches
// - Upload/Take Photo -> Preview crop -> Use Crop -> Analyze (iOS reliable orientation handling)
// - Live camera capture (optional) + ROI crop attempt
// - White balance supported
// - Multiple camera selection + remembers device
// - ✅ Stabilization: pH/Alk/CYA range + snap
// - ✅ Hash-based caching: same image -> same result
// - ✅ Pad RGB fingerprints logged (for calibration + judge explanations)
// - ✅ “Clear Scan Cache (debug)” button support
// - ✅ Chlorine “inferred CC” when TC/FC corrected
// - ✅ Low-confidence scan gate (requires 7/7 pads)

// --- EasyTest configuration ---------------------------------------

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
  layout: {
    orientation: "vertical",
    colFrac: 0.5,
    padHeightFrac: 0.055,
    firstPadFrac: 0.14,
    padSpacingFrac: 0.095
  },
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

// Pads that need extra stabilization (borderline handling)
const PAD_STABILITY = {
  alk: { snap: 40, ambiguousRatio: 0.72, enableRange: true },
  cya: { snap: 20, ambiguousRatio: 0.75, enableRange: true },
  ph: { snap: 0.2, ambiguousRatio: 0.78, enableRange: true }
};

// --- helpers -----------------------------------------------------

function formatWeightOz(oz) {
  if (!isFinite(oz) || oz <= 0) return null;
  if (oz < 16) return `${oz.toFixed(1)} oz`;
  const lbs = oz / 16;
  if (lbs < 10) return `${lbs.toFixed(1)} lb`;
  return `${Math.round(lbs)} lb`;
}

function rgbDistance2(a, rgb) {
  const dr = a.r - rgb[0];
  const dg = a.g - rgb[1];
  const db = a.b - rgb[2];
  return dr * dr + dg * dg + db * db;
}

function chooseNearestTwoSwatches(rgb, swatches) {
  if (!rgb || !swatches || !swatches.length) return null;

  let best = swatches[0];
  let bestD = rgbDistance2(rgb, best.rgb);

  let second = null;
  let secondD = Infinity;

  for (let i = 1; i < swatches.length; i++) {
    const d = rgbDistance2(rgb, swatches[i].rgb);
    if (d < bestD) {
      second = best; secondD = bestD;
      best = swatches[i]; bestD = d;
    } else if (d < secondD) {
      second = swatches[i]; secondD = d;
    }
  }
  return { best, bestD, second, secondD };
}

// fallback if pad sampling fails
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

// --- main --------------------------------------------------------

export function initPoolTestScanner(root) {
  const els = {
    video: root.querySelector('[data-pt="video"]'),
    canvas: root.querySelector('[data-pt="canvas"]'),
    scanView: root.querySelector('[data-pt="scanView"]'),
    scanFrame: root.querySelector('[data-pt="scanView"] .scan-frame'),
    status: root.querySelector('[data-pt="status"]'),

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

    previewWrap: root.querySelector('[data-pt="previewWrap"]'),
    previewStage: root.querySelector('[data-pt="previewStage"]'),
    previewCanvas: root.querySelector('[data-pt="previewCanvas"]'),
    cropBox: root.querySelector('[data-pt="cropBox"]'),
    cropHandle: root.querySelector('[data-pt="cropHandle"]'),
    btnAutoCrop: root.querySelector('[data-pt="btnAutoCrop"]'),
    btnUseCrop: root.querySelector('[data-pt="btnUseCrop"]'),
    btnCancelCrop: root.querySelector('[data-pt="btnCancelCrop"]')
  };

  // --- mount preview UI inside the scan box (so upload replaces camera view) ---
(function mountPreviewIntoScanView() {
  if (!els.scanView || !els.previewWrap) return;

  els.scanView.style.position = "relative";

  // Move previewWrap into scanView (so it overlays the scan box)
  if (els.previewWrap.parentElement !== els.scanView) {
    els.scanView.appendChild(els.previewWrap);
  }

  // Turn previewWrap into an overlay
  els.previewWrap.style.display = "none";
  els.previewWrap.style.marginTop = "0";
  els.previewWrap.style.position = "absolute";
  els.previewWrap.style.zIndex = "20";
  els.previewWrap.style.inset = "0";
  els.previewWrap.style.padding = "10px";
  els.previewWrap.style.boxSizing = "border-box";
  els.previewWrap.style.overflow = "hidden";


  // Preview stage should fit inside the scan box
  if (els.previewStage) {
    els.previewStage.style.maxWidth = "100%";
    els.previewStage.style.margin = "8px auto 0";
  }
})();
// --- preview overlay back button ---
(function addPreviewBackButton() {
  if (!els.previewWrap) return;

  // Prevent duplicate buttons if init runs more than once (hot reload / SPA remount)
  if (els.previewWrap.querySelector('[data-pt="previewBack"]')) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-ghost";
  btn.textContent = "Back";
  btn.setAttribute("aria-label", "Back to camera");
  btn.dataset.pt = "previewBack";

  btn.style.position = "absolute";
  btn.style.top = "10px";
  btn.style.right = "10px";
  btn.style.zIndex = "50";

  btn.addEventListener("click", () => {
    hidePreview();
    setStatus("Back to camera. Upload another image or enable camera.");
  });

  els.previewWrap.appendChild(btn);
})();



  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  let stream = null;

  // Calibration (shared with calibrate.html)
  const CAL_KEY = "pt_calibration_v1";
  function loadCalibration() {
    try { return JSON.parse(localStorage.getItem(CAL_KEY) || "null"); } catch { return null; }
  }

  let whiteBalance = { r: 1, g: 1, b: 1 };
  let calOffsets = { ph: 0, alk: 0, cya: 0, hardness: 0 };

  (function applySavedCalibration() {
    const cal = loadCalibration();
    if (cal?.whiteBalance) whiteBalance = cal.whiteBalance;
    if (cal?.offsets) {
      calOffsets = {
        ph: Number(cal.offsets.ph || 0),
        alk: Number(cal.offsets.alk || 0),
        cya: Number(cal.offsets.cya || 0),
        hardness: Number(cal.offsets.hardness || 0)
      };
    }
  })();

  // UI mode (phones vs tablet/desktop)
  function applyScannerMode() {
    const isSmall = window.matchMedia("(max-width: 900px)").matches;
    if (els.liveControls) els.liveControls.style.display = isSmall ? "none" : "";
    if (els.cameraRow) els.cameraRow.style.display = isSmall ? "none" : "";
  }
  window.addEventListener("resize", applyScannerMode);

  let poolGallons = null;
  let poolCollapsed = false;
  let lastVals = null;

  const HISTORY_KEY = "pt_history_v2";
  const POOL_SETUP_KEY = "pt_pool_setup_v1";
  const CAM_KEY = "pt_selected_camera_v1";
  const MAX_HISTORY = 365;

  // Charts
  const historyCharts = { ph: null, chlorine: null, alk: null, cya: null };

  const setStatus = msg => { if (els.status) els.status.textContent = msg || ""; };

  // ---------- Hash cache + RGB fingerprints ----------
  const RESULT_CACHE_KEY = "pt_result_cache_v1";
  const RESULT_CACHE_MAX = 60;

  const FP_KEY = "pt_pad_fingerprints_v1";
  const FP_MAX = 120;

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || ""); } catch { return fallback; }
  }
  function saveJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { }
  }

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

  function recordFingerprint(hash, padColors, avgRgb) {
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
      pads
    });

    if (arr.length > FP_MAX) arr.splice(0, arr.length - FP_MAX);
    saveJson(FP_KEY, arr);
  }
  // --- camera selection -------------------------------------------

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
    try { localStorage.setItem(CAM_KEY, deviceId || ""); } catch { }
  }

  // --- history ----------------------------------------------------

  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch { return []; }
  }

  function saveHistory(arr) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(arr)); } catch { }
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
      chlorineCorrected: !!vals.__chlorineCorrected
    });
    if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
    saveHistory(history);
    renderHistoryCharts(history);
  }

  function renderHistoryCharts(historyOpt) {
    if (typeof Chart === "undefined") return;
    const history = historyOpt || loadHistory();

    if (!history.length) {
      Object.keys(historyCharts).forEach(k => {
        if (historyCharts[k]) { historyCharts[k].destroy(); historyCharts[k] = null; }
      });
      return;
    }

    const labels = history.map(h => new Date(h.t).toLocaleString(undefined, {
      month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"
    }));

    const series = {
      ph: history.map(h => h.ph),
      freeCl: history.map(h => h.freeCl),
      // Defensive clamp so old bad points never show impossible TC<FC
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
    ], {
      plugins: { legend: { display: false } },
      scales: { y: { suggestedMin: 6, suggestedMax: 9 } }
    });

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
    ], {
      plugins: { legend: { display: false } },
      scales: { y: { suggestedMin: 0, suggestedMax: 360 } }
    });

    upsertChart("cya", "ppm", els.chartCya, [
      { label: "Cyanuric Acid (ppm)", data: series.cya, tension: 0.3, pointRadius: 2 }
    ], {
      plugins: { legend: { display: false } },
      scales: { y: { suggestedMin: 0, suggestedMax: 240 } }
    });
  }

  // --- camera -----------------------------------------------------

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

  function stopCamera() {
    try { stream?.getTracks?.().forEach(t => t.stop()); } catch { }
    stream = null;
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

        // "white-ish" strip body
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
    } catch { }
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

  // --- preview + manual crop (uploads) ----------------------------

  let previewImg = null;   // Image()
  let previewFit = null;   // {scale, dx, dy, iw, ih, cw, ch}

function showPreview(img) {
  previewImg = img;
  if (!els.previewWrap || !els.previewCanvas || !els.previewStage || !els.cropBox) return;

  // Hide live view *without collapsing layout*
  if (els.video) els.video.style.visibility = "hidden";
  if (els.scanFrame) els.scanFrame.style.visibility = "hidden";

  // Show preview overlay
  els.previewWrap.style.display = "block";   // don't use ""
  els.previewWrap.style.zIndex = "20";       // ensure it's above video/frame

  layoutPreviewOverlay();
  drawPreviewCanvas();

  // default crop
  els.cropBox.style.left = "30%";
  els.cropBox.style.top = "8%";
  els.cropBox.style.width = "40%";
  els.cropBox.style.height = "84%";

  setStatus("Adjust the crop box around the strip, then click Use Crop.");
}

function hidePreview() {
  if (els.previewWrap) els.previewWrap.style.display = "none";
  previewImg = null;
  previewFit = null;

  // Restore live view
  if (els.video) els.video.style.visibility = "";
  if (els.scanFrame) els.scanFrame.style.visibility = "";
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

  function layoutPreviewOverlay() {
  if (!els.previewWrap || !els.previewStage) return;

  // These are just layout estimates so the stage fits without scrolling.
  const headerApprox = 56; // buttons row
  const tipApprox = 22;    // tip line
  const pad = 20;          // overlay padding

  const h = els.scanView?.getBoundingClientRect?.().height || 520;
  const stageH = Math.max(160, Math.floor(h - headerApprox - tipApprox - pad));

  els.previewStage.style.height = `${stageH}px`;
  els.previewStage.style.aspectRatio = "3 / 4";
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

  function analyzeFromPreviewCrop() {
    const r = getCropRectInImagePixels();
    if (!r || !previewImg) {
      setStatus("Crop box is not over the image (or too small).");
      return;
    }

    const maxW = 1600;
    const s = Math.min(1, maxW / r.sw);

    els.canvas.width = Math.round(r.sw * s);
    els.canvas.height = Math.round(r.sh * s);

    const ctx = els.canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(previewImg, r.sx, r.sy, r.sw, r.sh, 0, 0, els.canvas.width, els.canvas.height);

    hidePreview();
    analyze(ctx);
  }

  // Crop box drag + resize
// scanner.js
// Replace ONLY the existing "(function wireCropBox() { ... })();" block with this one.

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
    captureEl = ev.currentTarget; // ✅ capture on the element that received pointerdown

    const b = boxPx();
    start = {
      pid: ev.pointerId,
      px: ev.clientX,
      py: ev.clientY,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      sw: b.sw,
      sh: b.sh
    };

    try {
      captureEl?.setPointerCapture?.(ev.pointerId);
    } catch {
      // Some browsers can be picky; if capture fails, dragging still works via window listeners.
    }
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
    } catch {
      // ignore
    } finally {
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
  layoutPreviewOverlay();
  drawPreviewCanvas();
});

  // --- sampling ---------------------------------------------------

  function sampleStripe(ctx) {
    const w = els.canvas.width;
    const h = els.canvas.height;
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

  // Robust pad sampling: grid + median + variability
  function samplePadsEasyTest(ctx) {
    const w = els.canvas.width;
    const h = els.canvas.height;

    // Scan down the center line and find "colored" segments
    const x = Math.floor(w * 0.5);
    const img = ctx.getImageData(0, 0, w, h).data;

    function getPixel(y) {
      const i = (y * w + x) * 4;
      const r = img[i], g = img[i + 1], b = img[i + 2];
      const v = Math.max(r, g, b);
      const sat = v === 0 ? 0 : (v - Math.min(r, g, b)) / v;
      return { r, g, b, v, sat };
    }

    // "colored-ish": not super bright white, and has some saturation
    const colored = [];
    for (let y = 0; y < h; y++) {
      const p = getPixel(y);
      colored[y] = (p.v < 245 && p.sat > 0.08);
    }

    // collect segments
    const segments = [];
    let inSeg = false, start = 0;
    for (let y = 0; y < h; y++) {
      if (colored[y] && !inSeg) { inSeg = true; start = y; }
      if (!colored[y] && inSeg) {
        const end = y - 1;
        inSeg = false;
        if (end - start > 25) segments.push([start, end]);
      }
    }
    if (inSeg) segments.push([start, h - 1]);

    // keep the 7 biggest, sorted top->bottom
    segments.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
    const top7 = segments.slice(0, 7).sort((a, b) => a[0] - b[0]);

    if (top7.length !== 7) return {};

    const padColors = {};
    const padW = Math.max(20, Math.floor(w * 0.34));
    const x1 = Math.max(0, x - Math.floor(padW / 2));
    const x2 = Math.min(w, x1 + padW);

    function median(vals) {
      const a = vals.slice().sort((p, q) => p - q);
      return a[Math.floor(a.length / 2)];
    }
    function mad(vals, m) {
      const a = vals.map(v => Math.abs(v - m)).sort((p, q) => p - q);
      return a[Math.floor(a.length / 2)];
    }

    for (let i = 0; i < 7; i++) {
      const [s, e] = top7[i];
      const y1 = Math.max(0, s + 6);
      const y2 = Math.min(h, e - 6);
      if (y2 <= y1) continue;

      const imgData = ctx.getImageData(x1, y1, x2 - x1, y2 - y1);
      const data = imgData.data;
      const W = imgData.width;
      const H = imgData.height;

      const samples = [];
      const gx = 9, gy = 9;

      for (let yy = 0; yy < gy; yy++) {
        const py = Math.floor((yy + 0.5) * (H / gy));
        for (let xx = 0; xx < gx; xx++) {
          const px = Math.floor((xx + 0.5) * (W / gx));
          const idx = (py * W + px) * 4;

          const rr = data[idx] / whiteBalance.r;
          const gg = data[idx + 1] / whiteBalance.g;
          const bb = data[idx + 2] / whiteBalance.b;

          samples.push([rr, gg, bb]);
        }
      }

      const rs = samples.map(sv => sv[0]);
      const gs = samples.map(sv => sv[1]);
      const bs = samples.map(sv => sv[2]);

      const mr = median(rs), mg = median(gs), mb = median(bs);
      const vr = mad(rs, mr), vg = mad(gs, mg), vb = mad(bs, mb);

      const key = EASYTEST_CFG.pads[i].key; // top->bottom mapping
      padColors[key] = { r: mr, g: mg, b: mb, __var: (vr + vg + vb) / 3 };
    }

    return padColors;
  }

  function setWBAt(x, y) {
    const d = els.canvas.getContext("2d", { willReadFrequently: true }).getImageData(x, y, 1, 1).data;
    const avg = (d[0] + d[1] + d[2]) / 3 || 1;
    whiteBalance = { r: d[0] / avg, g: d[1] / avg, b: d[2] / avg };
    setStatus("White balance set. Capture or upload an EasyTest strip.");
  }

  function rgbToChemistryEasyTest(padColors) {
    if (!padColors || !Object.keys(padColors).length) {
      return rgbToChemistryFallback({ r: 150, g: 150, b: 150 });
    }

    const padByKey = {};
    EASYTEST_CFG.pads.forEach(p => (padByKey[p.key] = p));

    const result = {};

    function valueFromPad(key, fallback) {
      const rgb = padColors[key];
      const pad = padByKey[key];
      if (rgb && pad && pad.swatches && pad.swatches.length) {
        const pick = chooseNearestTwoSwatches(rgb, pad.swatches);
        if (!pick) return { value: fallback(), bestD: Infinity, secondValue: null, secondD: Infinity, variance: 999 };
        return {
          value: pick.best.value,
          bestD: pick.bestD,
          secondValue: pick.second ? pick.second.value : null,
          secondD: pick.secondD,
          variance: rgb.__var ?? 0
        };
      }
      return { value: fallback(), bestD: Infinity, secondValue: null, secondD: Infinity, variance: 999 };
    }

    function stabilizedValue(key, pick, lastValue) {
      const cfg = PAD_STABILITY[key];
      if (!cfg) return { value: pick.value, range: null, confidence: 1 };

      const ratio = (pick.secondD && pick.secondD < Infinity) ? (pick.bestD / pick.secondD) : 0;
      const ambiguous = (pick.secondValue != null && ratio > cfg.ambiguousRatio) || (pick.variance > 10);

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

      const dScore = 1 / (1 + Math.sqrt(pick.bestD) / 35);
      const vScore = 1 / (1 + (pick.variance || 0) / 12);
      const confidence = Math.max(0, Math.min(1, dScore * vScore));

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

    const tcPick = valueFromPad("totalCl", () => Math.max(result.freeCl, result.freeCl + 0.5));
    result.totalCl = tcPick.value;

    // --- Chlorine sanity correction (science fair safe) ---
    let chlorineCorrected = false;

    // If TC < FC, attempt a swap (adjacent-pad misassignment)
    if (result.totalCl < result.freeCl) {
      const tmp = result.totalCl;
      result.totalCl = result.freeCl;
      result.freeCl = tmp;
      chlorineCorrected = true;
    }

    // Enforce chemistry reality (TC >= FC)
    if (result.totalCl < result.freeCl) {
      result.totalCl = result.freeCl;
      chlorineCorrected = true;
    }

    result.__chlorineCorrected = chlorineCorrected;

    const brPick = valueFromPad("bromine", () => null);
    const bromFromPad = brPick.value;
    result.bromine = bromFromPad != null ? bromFromPad : (result.totalCl * 2.25);

    // Hardness (offset-capable)
    const hardPick = valueFromPad("hardness", () => 250);
    result.hardness = hardPick.value;

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

    // Apply calibration offsets (device-specific)
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
  // --- bars + tips ------------------------------------------------

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

    // Total chlorine tag
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

  function renderRecs(vals) {
    if (!els.recs) return;
    const recs = [];

    if (!poolGallons) {
      recs.push("Enter your pool size above (or manual gallons) so the app can calculate real chemical amounts.");
      els.recs.innerHTML = recs.map(x => `<li>${x}</li>`).join("");
      return;
    }

    const factor10k = poolGallons / 10000;
    recs.push(`Estimated pool volume: about ${poolGallons.toLocaleString()} gallons (~${factor10k.toFixed(2)} × 10,000 gal).`);

    const targets = { ph: 7.5, freeCl: 2.5, hardness: 250, alk: 100, cya: 40 };

    if (vals.ph < 7.2) {
      const deltaPh = Math.max(0, targets.ph - vals.ph);
      const ozSodaAsh = (deltaPh / 0.2) * 6 * factor10k;
      const dose = formatWeightOz(ozSodaAsh);
      recs.push(`pH is low (${vals.ph}). Target is ~${targets.ph}. ${dose ? `Add about ${dose} of pH increaser (soda ash), split into smaller doses with circulation.` : `Use a pH increaser per the product label for your pool volume.`}`);
    } else if (vals.ph > 7.8) {
      const deltaPh = Math.max(0, vals.ph - targets.ph);
      const ozAcid = (deltaPh / 0.2) * 12 * factor10k;
      const dose = formatWeightOz(ozAcid);
      recs.push(`pH is high (${vals.ph}). Target is ~${targets.ph}. ${dose ? `Add about ${dose} of pH reducer (muriatic acid ~31%) in divided doses.` : `Use a pH reducer according to the product label for your pool volume.`}`);
    } else recs.push(`pH is in the recommended range (${vals.ph}).`);

    if (vals.freeCl < 1) {
      const deltaCl = Math.max(0, targets.freeCl - vals.freeCl);
      const ozCl = deltaCl * 10.7 * factor10k;
      const dose = formatWeightOz(ozCl);
      recs.push(`Free chlorine is low (${vals.freeCl} ppm). Target is about ${targets.freeCl} ppm. ${dose ? `Add about ${dose} of 12% liquid chlorine, then circulate and retest after 30–60 minutes.` : `Add liquid chlorine per the dosing chart on your product label.`}`);
    } else if (vals.freeCl > 3) {
      recs.push(`Free chlorine is high (${vals.freeCl} ppm). Usually you just keep the pump running and avoid adding more chlorine so it can drift down.`);
    } else recs.push(`Free chlorine is in a normal range (${vals.freeCl} ppm).`);

    if (vals.alk < 80) {
      const deltaAlk = Math.max(0, targets.alk - vals.alk);
      const lbsBicarb = (deltaAlk / 10) * 1.5 * factor10k;
      const ozBicarb = lbsBicarb * 16;
      const dose = formatWeightOz(ozBicarb);
      recs.push(`Total alkalinity is low (${vals.alk} ppm). Target is ~${targets.alk} ppm. ${dose ? `Add about ${dose} of alkalinity increaser (baking soda) in portions with the pump running.` : `Use an alkalinity increaser according to the package chart for your pool gallons.`}`);
    } else if (vals.alk > 120) recs.push(`Total alkalinity is high (${vals.alk} ppm). Usually you lower alkalinity gradually using pH reducer and/or partial water replacement.`);
    else recs.push(`Total alkalinity is in range (${vals.alk} ppm).`);

    if (vals.cya < 30) {
      const deltaCya = Math.max(0, targets.cya - vals.cya);
      const ozCya = (deltaCya / 10) * 13 * factor10k;
      const dose = formatWeightOz(ozCya);
      recs.push(`Cyanuric acid is low (${vals.cya} ppm). Target ~${targets.cya} ppm. ${dose ? `Add about ${dose} of stabilizer (per-label directions), then retest in 1–2 days.` : `Use a stabilizer product and follow its dosing chart.`}`);
    } else if (vals.cya > 100) recs.push(`Cyanuric acid is high (${vals.cya} ppm). Partial drain/refill is usually how you lower it safely.`);
    else recs.push(`Cyanuric acid is in a normal range (${vals.cya} ppm).`);

    if (vals.hardness < 150) recs.push(`Total hardness is low (${vals.hardness} ppm). Some pools may need calcium hardness increaser.`);
    else if (vals.hardness > 300) recs.push(`Total hardness is high (${vals.hardness} ppm). High hardness increases scale risk.`);
    else recs.push(`Total hardness is in a typical range (${vals.hardness} ppm).`);

    recs.push("These amounts are rough rules of thumb per 10,000 gallons. Always follow product labels and retest between adjustments.");
    els.recs.innerHTML = recs.map(x => `<li>${x}</li>`).join("");
  }

  function analyze(ctx) {
    // Hash pixels AFTER crop/scale (so identical cropped content matches)
    let imgHash = null;
    try { imgHash = hashCanvas(ctx); } catch { imgHash = null; }

    // 1) Cache: same image => identical output
    if (imgHash) {
      const hit = cacheGet(imgHash);
      if (hit?.vals) {
        lastVals = hit.vals;
        renderBars(hit.vals);
        renderRecs(hit.vals);
        setStatus(`EasyTest scan (cached) | id=${imgHash}`);
        recordReading(hit.vals);
        els.canvas && (els.canvas.hidden = true);
        return;
      }
    }

    // 2) Fresh compute
    const padColors = samplePadsEasyTest(ctx);
    const avgRgb = sampleStripe(ctx);
    padColors.__avg = avgRgb;

    const padCount = Object.keys(padColors).filter(k => k !== "__avg").length;

    // Science-fair safe: require all 7 pads detected, or ask for retake
    if (padCount < 7) {
      setStatus(`Low confidence: only detected ${padCount}/7 pads. Retake photo (bright light, straight-on, avoid glare, include all pads).`);
      els.canvas && (els.canvas.hidden = true);
      return;
    }

    const vals = rgbToChemistryEasyTest(padColors);
    lastVals = vals;

    renderBars(vals);
    renderRecs(vals);
    setStatus(`EasyTest scan | Avg RGB ≈ (${avgRgb.r | 0}, ${avgRgb.g | 0}, ${avgRgb.b | 0})${imgHash ? ` | id=${imgHash}` : ""}`);

    recordReading(vals);
    els.canvas && (els.canvas.hidden = true);

    // 3) Save caches
    if (imgHash) cachePut(imgHash, vals);
    recordFingerprint(imgHash, padColors, avgRgb);
  }

  // --- pool setup + persistence ----------------------------------

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
    try { localStorage.setItem(POOL_SETUP_KEY, JSON.stringify(conf)); } catch { }
  }

  function loadPoolSetup() {
    let raw = null;
    try { raw = localStorage.getItem(POOL_SETUP_KEY); } catch { }
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
    } catch { }

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
    } catch { }

    poolGallons = null;
    poolCollapsed = false;
    lastVals = null;

    els.gallonsDisplay && (els.gallonsDisplay.textContent = "Pool volume: – (enter shape/size or manual gallons)");
    els.recs && (els.recs.innerHTML = "<li>Local data cleared. Enter pool setup and scan a new strip.</li>");
    renderHistoryCharts([]);

    try {
      if (els.shape) els.shape.value = "rect";
      [els.rectLen, els.rectWid, els.roundDia, els.ovalLen, els.ovalWid, els.depthShallow, els.depthDeep, els.gallonsManual]
        .forEach(el => el && (el.value = ""));
      updateShapeVisibility();
      applyPoolCollapsed();
    } catch { }
  }

  function clearScanCache() {
    try {
      localStorage.removeItem(RESULT_CACHE_KEY);
      localStorage.removeItem(FP_KEY);
    } catch { }
    setStatus("Scan cache cleared (results + fingerprints).");
  }

  // --- iOS reliable "Take Photo" pipeline -------------------------

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

  // --- events -----------------------------------------------------

  els.btnStart?.addEventListener("click", startCamera);
  els.btnCapture?.addEventListener("click", () => analyze(drawFromVideo()));

  // Phone-first buttons
  els.btnTakePhoto?.addEventListener("click", () => els.takeInput?.click());
  els.btnChoosePhoto?.addEventListener("click", () => els.fileInput?.click());

  els.btnClearCache?.addEventListener("click", clearScanCache);

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

  els.btnUseCrop?.addEventListener("click", analyzeFromPreviewCrop);

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
  els.btnClearData?.addEventListener("click", clearLocalData);

  // --- init -------------------------------------------------------

  loadPoolSetup();
  renderHistoryCharts();
  listCameras();
  applyScannerMode();

  if (isIOS) {
    els.btnStart && (els.btnStart.textContent = "Live Camera (beta)");
    setStatus("Ready. iPhone/iPad: use Upload/Take Photo for the most reliable scan. Then crop and scan.");
  } else {
    setStatus("Ready. Upload a photo to crop, or enable camera.");
  }

  window.addEventListener("pagehide", stopCamera);
}
