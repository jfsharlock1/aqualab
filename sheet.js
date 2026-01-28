// sheet.js - AquaLab import (Excel/CSV)
// Requires: xlsx.full.min.js loaded
// Requires: calibrate.html sets window.__aqualabImportApi before this runs

(function () {
  function $(id) { return document.getElementById(id); }

  function waitForReady() {
    const api = window.__aqualabImportApi;
    const hasXlsx = typeof window.XLSX !== "undefined";
    const input = $("importFile");
    const btnTemplate = $("importTemplate");

    if (!api || !hasXlsx || !input || !btnTemplate) {
      // Covers script order + slow CDN
      return setTimeout(waitForReady, 80);
    }

    wireUp(api);
  }

  function normalizeKey(k) {
    return String(k || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, "")
      .replace(/_/g, "");
  }

  function safeNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function parseWhen(v) {
    if (!v) return Date.now();

    // Excel can provide Date objects or numeric serials
    if (v instanceof Date) {
      const t = v.getTime();
      return Number.isFinite(t) ? t : Date.now();
    }

    if (typeof v === "number" && Number.isFinite(v)) {
      // Excel serial date: days since 1899-12-30
      const excelEpoch = new Date(Date.UTC(1899, 11, 30)).getTime();
      const t = excelEpoch + v * 24 * 60 * 60 * 1000;
      return Number.isFinite(t) ? t : Date.now();
    }

    const t = new Date(String(v)).getTime();
    return Number.isFinite(t) ? t : Date.now();
  }

  function clampTcFc(tc, fc) {
    if (tc == null && fc == null) return { tc: null, fc: null, corrected: false };
    const _fc = fc == null ? 0 : Math.max(0, fc);
    let _tc = tc == null ? _fc : Math.max(0, tc);
    let corrected = false;
    if (_tc < _fc) { _tc = _fc; corrected = true; }
    return { tc: _tc, fc: _fc, corrected };
  }

  function inferBromine(br, tc) {
    const b = safeNum(br);
    if (b != null) return Math.max(0, Number(b.toFixed(1)));
    const t = safeNum(tc);
    if (t == null) return 0;
    return Math.max(0, Number((t * 2.25).toFixed(1)));
  }

  function truthy(v) {
    const s = String(v ?? "").toLowerCase().trim();
    return s === "1" || s === "true" || s === "yes" || s === "y" || s === "corrected";
  }

  function rowToPoint(row) {
    const r = {};
    Object.keys(row || {}).forEach(k => { r[normalizeKey(k)] = row[k]; });

    const t = parseWhen(r.date || r.time || r.datetime || r.timestamp);
    const gallons = safeNum(r.gallons);

    const ph  = safeNum(r.ph);
    const alk = safeNum(r.alk);
    const cya = safeNum(r.cya);

    const fcIn = safeNum(r.freecl ?? r.fc);
    const tcIn = safeNum(r.totalcl ?? r.tc);

    // required minimum
    if (ph == null || alk == null || cya == null || fcIn == null || tcIn == null) return null;

    const clamp = clampTcFc(tcIn, fcIn);
    const hardness = safeNum(r.hardness) ?? 0;
    const bromine = inferBromine(r.bromine ?? r.br, clamp.tc);

    return {
      t,
      gallons: gallons != null ? Math.round(Math.max(0, gallons)) : null,
      ph: Number(ph.toFixed(2)),
      freeCl: Number(clamp.fc.toFixed(2)),
      totalCl: Number(clamp.tc.toFixed(2)),
      bromine: Number(bromine.toFixed(1)),
      hardness: Math.round(Math.max(0, hardness)),
      alk: Math.round(Math.max(0, alk)),
      cya: Math.round(Math.max(0, cya)),
      chlorineCorrected: truthy(r.corrected) || clamp.corrected
    };
  }

  function wireUp(api) {
    const input = $("importFile");
    const btnTemplate = $("importTemplate");

    function importRows(rows) {
      let added = 0;
      let skipped = 0;

      for (const row of rows) {
        const pt = rowToPoint(row);
        if (!pt) { skipped++; continue; }
        api.addHistoryPoint(pt);
        added++;
      }

      api.setImportStatus(
        added
          ? `✅ Import complete: ${added} row(s) added. Skipped ${skipped}. Go back to Scanner to see charts update.`
          : `⚠️ No valid rows found. Required columns: date, ph, freeCl, totalCl, alk, cya (others optional).`
      );

      api.refreshUI?.();
    }

    async function handleFile(file) {
      api.setImportStatus("Reading file…");

      const name = (file.name || "").toLowerCase();
      const isCsv = name.endsWith(".csv");

      const reader = new FileReader();

      reader.onload = (evt) => {
        try {
          const XLSX = window.XLSX;
          let rows = [];

          if (isCsv) {
            const text = String(evt.target.result || "");
            const wb = XLSX.read(text, { type: "string" });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          } else {
            const data = evt.target.result;
            const wb = XLSX.read(data, { type: "binary" });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
          }

          importRows(rows);
        } catch (err) {
          api.setImportStatus("❌ Failed to parse file. Try saving as CSV and re-uploading.");
        }
      };

      reader.onerror = () => api.setImportStatus("❌ Could not read file.");

      if (isCsv) reader.readAsText(file);
      else reader.readAsBinaryString(file);
    }

    input.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await handleFile(file);
      e.target.value = "";
    });

    btnTemplate.addEventListener("click", () => {
      try {
        const XLSX = window.XLSX;

        const rows = [{
          date: "2026-01-01 10:00",
          gallons: 15000,
          ph: 7.50,
          freeCl: 2.50,
          totalCl: 3.00,
          alk: 100,
          cya: 40,
          hardness: 250,
          bromine: "",
          corrected: ""
        }];

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "CalibrationData");
        XLSX.writeFile(wb, "aqualab-calibration-template.xlsx");

        api.setImportStatus("✅ Template downloaded: aqualab-calibration-template.xlsx");
      } catch {
        api.setImportStatus("❌ Template download failed (XLSX not available or browser blocked downloads).");
      }
    });

    api.setImportStatus("Ready to import: choose a CSV or XLSX file.");
  }

  waitForReady();
})();
