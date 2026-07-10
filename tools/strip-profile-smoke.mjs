import { runStripSanityCheck } from "../sanityCheckEngine.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const easyTestVals = {
  __supportedTests: ["hardness", "freeCl", "bromine", "totalCl", "combinedCl", "cya", "alk", "ph"],
  ph: 7.4,
  freeCl: 2,
  totalCl: 3,
  bromine: 6,
  alk: 100,
  cya: 40,
  hardness: 250,
  __scanQuality: { score: 90, details: { manualSelection: true, colorConfidence: 0.9, geometryConfidence: 1 } }
};

const hthVals = {
  __supportedTests: ["hardness", "freeCl", "bromine", "ph", "alk", "cya"],
  ph: 7.4,
  freeCl: 2,
  bromine: 4.5,
  alk: 100,
  cya: 40,
  hardness: 250,
  __scanQuality: { score: 90, details: { manualSelection: true, colorConfidence: 0.9, geometryConfidence: 1 } }
};

const easy = runStripSanityCheck(easyTestVals, { history: [], waterAppearance: "crystalClear" });
const hth = runStripSanityCheck(hthVals, { history: [], waterAppearance: "crystalClear" });

const easyKeys = new Set(easy.checks.map(check => check.key));
const hthKeys = new Set(hth.checks.map(check => check.key));

assert(easyKeys.has("totalCl"), "EasyTest should keep Total Chlorine checks.");
assert(easyKeys.has("combinedCl"), "EasyTest should keep Combined Chlorine checks.");
assert(!hthKeys.has("totalCl"), "HTH profile must not emit Total Chlorine checks.");
assert(!hthKeys.has("combinedCl"), "HTH profile must not emit Combined Chlorine checks.");
assert(hthKeys.has("freeCl") && hthKeys.has("bromine"), "HTH profile should keep FAC/Bromine checks.");

console.log("strip profile smoke checks passed");
