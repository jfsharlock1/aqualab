import { createSensorService, getFriendlySensorError } from "./sensorService.js";
import { createSensorStorageService } from "./sensorStorageService.js";
import { createSensorAuthService } from "./sensorAuthService.js";
import {
  classifyWaterCondition,
  getDefaultTurbidityCalibration,
  normalizeTurbidityCalibration
} from "./waterQuality.js";
import { fetchOpenMeteoWeather } from "./weatherService.js";

const METHOD_KEY = "pt_sensor_method_v1";
const NETWORK_MODE_KEY = "pt_sensor_network_mode_v1";
const ENDPOINT_KEY = "pt_sensor_endpoint_v1";
const BLE_SERVICE_UUID_KEY = "aqualab_ble_service_uuid";
const BLE_CHARACTERISTIC_UUID_KEY = "aqualab_ble_characteristic_uuid";
const INCLUDE_WEATHER_KEY = "aqualab_include_weather_v1";
const DEFAULT_METHOD = "wifi";
const DEFAULT_ENDPOINT = "";
const AUTO_REFRESH_MS = 5000;

const els = {
  authGate: document.querySelector('[data-sa="authGate"]'),
  sensorContent: document.querySelector('[data-sa="sensorContent"]'),
  authStatus: document.querySelector('[data-sa="authStatus"]'),
  localLoginName: document.querySelector('[data-sa="localLoginName"]'),
  localLoginCode: document.querySelector('[data-sa="localLoginCode"]'),
  createLocalLogin: document.querySelector('[data-sa="createLocalLogin"]'),
  offlineLogin: document.querySelector('[data-sa="offlineLogin"]'),
  logoutSensor: document.querySelector('[data-sa="logoutSensor"]'),
  connectionTag: document.querySelector('[data-sa="connectionTag"]'),
  connectionMethod: document.querySelector('[data-sa="connectionMethod"]'),
  networkMode: document.querySelector('[data-sa="networkMode"]'),
  endpointField: document.querySelector('[data-sa="endpointField"]'),
  endpointUrl: document.querySelector('[data-sa="endpointUrl"]'),
  bleFields: document.querySelector('[data-sa="bleFields"]'),
  bleServiceUuid: document.querySelector('[data-sa="bleServiceUuid"]'),
  bleCharacteristicUuid: document.querySelector('[data-sa="bleCharacteristicUuid"]'),
  connectBluetooth: document.querySelector('[data-sa="connectBluetooth"]'),
  disconnectBluetooth: document.querySelector('[data-sa="disconnectBluetooth"]'),
  bleStatus: document.querySelector('[data-sa="bleStatus"]'),
  testConnection: document.querySelector('[data-sa="testConnection"]'),
  refreshReading: document.querySelector('[data-sa="refreshReading"]'),
  saveReading: document.querySelector('[data-sa="saveReading"]'),
  autoRefresh: document.querySelector('[data-sa="autoRefresh"]'),
  connectionStatus: document.querySelector('[data-sa="connectionStatus"]'),
  temperatureF: document.querySelector('[data-sa="temperatureF"]'),
  temperatureC: document.querySelector('[data-sa="temperatureC"]'),
  turbidityNtu: document.querySelector('[data-sa="turbidityNtu"]'),
  turbidityVoltage: document.querySelector('[data-sa="turbidityVoltage"]'),
  turbidityRaw: document.querySelector('[data-sa="turbidityRaw"]'),
  sensorSource: document.querySelector('[data-sa="sensorSource"]'),
  readingTimestamp: document.querySelector('[data-sa="readingTimestamp"]'),
  lastUpdate: document.querySelector('[data-sa="lastUpdate"]'),
  saveStatus: document.querySelector('[data-sa="saveStatus"]'),
  locationName: document.querySelector('[data-sa="locationName"]'),
  useDeviceLocation: document.querySelector('[data-sa="useDeviceLocation"]'),
  locationStatus: document.querySelector('[data-sa="locationStatus"]'),
  classificationBadge: document.querySelector('[data-sa="classificationBadge"]'),
  confidenceScore: document.querySelector('[data-sa="confidenceScore"]'),
  estimatedClarity: document.querySelector('[data-sa="estimatedClarity"]'),
  classificationExplanation: document.querySelector('[data-sa="classificationExplanation"]'),
  clearBaseline: document.querySelector('[data-sa="clearBaseline"]'),
  cloudyBaseline: document.querySelector('[data-sa="cloudyBaseline"]'),
  captureClearBaseline: document.querySelector('[data-sa="captureClearBaseline"]'),
  captureCloudyBaseline: document.querySelector('[data-sa="captureCloudyBaseline"]'),
  calibrationStatus: document.querySelector('[data-sa="calibrationStatus"]'),
  sensorBadge: document.querySelector('[data-sa="sensorBadge"]'),
  internetBadge: document.querySelector('[data-sa="internetBadge"]'),
  weatherBadge: document.querySelector('[data-sa="weatherBadge"]'),
  mapBadge: document.querySelector('[data-sa="mapBadge"]'),
  gpsBadge: document.querySelector('[data-sa="gpsBadge"]'),
  lastSuccessfulUpdate: document.querySelector('[data-sa="lastSuccessfulUpdate"]'),
  apiResponseTime: document.querySelector('[data-sa="apiResponseTime"]'),
  consecutiveFailures: document.querySelector('[data-sa="consecutiveFailures"]'),
  diagnosticWarnings: document.querySelector('[data-sa="diagnosticWarnings"]'),
  historyRange: document.querySelector('[data-sa="historyRange"]'),
  historyStatus: document.querySelector('[data-sa="historyStatus"]'),
  temperatureChart: document.querySelector('[data-sa="temperatureChart"]'),
  turbidityChart: document.querySelector('[data-sa="turbidityChart"]'),
  sessionName: document.querySelector('[data-sa="sessionName"]'),
  sessionNotes: document.querySelector('[data-sa="sessionNotes"]'),
  startSession: document.querySelector('[data-sa="startSession"]'),
  endSession: document.querySelector('[data-sa="endSession"]'),
  activeSessionIndicator: document.querySelector('[data-sa="activeSessionIndicator"]'),
  centerDeviceLocation: document.querySelector('[data-sa="centerDeviceLocation"]'),
  showAllMapped: document.querySelector('[data-sa="showAllMapped"]'),
  mapSessionFilter: document.querySelector('[data-sa="mapSessionFilter"]'),
  mapClassificationFilter: document.querySelector('[data-sa="mapClassificationFilter"]'),
  mapStatus: document.querySelector('[data-sa="mapStatus"]'),
  sensorMap: document.querySelector('[data-sa="sensorMap"]'),
  unmappedReadings: document.querySelector('[data-sa="unmappedReadings"]'),
  weatherSource: document.querySelector('[data-sa="weatherSource"]'),
  weatherUpdated: document.querySelector('[data-sa="weatherUpdated"]'),
  weatherTempF: document.querySelector('[data-sa="weatherTempF"]'),
  weatherTempC: document.querySelector('[data-sa="weatherTempC"]'),
  weatherHumidity: document.querySelector('[data-sa="weatherHumidity"]'),
  weatherPressure: document.querySelector('[data-sa="weatherPressure"]'),
  weatherWind: document.querySelector('[data-sa="weatherWind"]'),
  weatherCondition: document.querySelector('[data-sa="weatherCondition"]'),
  weatherUv: document.querySelector('[data-sa="weatherUv"]'),
  weatherRain: document.querySelector('[data-sa="weatherRain"]'),
  refreshWeather: document.querySelector('[data-sa="refreshWeather"]'),
  includeWeather: document.querySelector('[data-sa="includeWeather"]'),
  weatherStatus: document.querySelector('[data-sa="weatherStatus"]'),
  sensorTabs: Array.from(document.querySelectorAll('[data-sensor-tab]')),
  sensorSections: Array.from(document.querySelectorAll('[data-sensor-section]')),
  overviewConnection: document.querySelector('[data-sa="overviewConnection"]'),
  overviewEmpty: document.querySelector('[data-sa="overviewEmpty"]'),
  overviewTemp: document.querySelector('[data-sa="overviewTemp"]'),
  overviewTurbidity: document.querySelector('[data-sa="overviewTurbidity"]'),
  overviewRaw: document.querySelector('[data-sa="overviewRaw"]'),
  overviewSession: document.querySelector('[data-sa="overviewSession"]'),
  overviewLocation: document.querySelector('[data-sa="overviewLocation"]'),
  overviewLastUpdate: document.querySelector('[data-sa="overviewLastUpdate"]'),
  overviewSensorBadge: document.querySelector('[data-sa="overviewSensorBadge"]'),
  overviewGpsBadge: document.querySelector('[data-sa="overviewGpsBadge"]'),
  overviewInternetBadge: document.querySelector('[data-sa="overviewInternetBadge"]'),
  overviewWeatherBadge: document.querySelector('[data-sa="overviewWeatherBadge"]'),
  overviewRefreshReading: document.querySelector('[data-sa="overviewRefreshReading"]'),
  overviewSaveReading: document.querySelector('[data-sa="overviewSaveReading"]'),
  overviewStartSession: document.querySelector('[data-sa="overviewStartSession"]'),
  locationSourceDetail: document.querySelector('[data-sa="locationSourceDetail"]'),
  locationCoordsDetail: document.querySelector('[data-sa="locationCoordsDetail"]'),
  locationAccuracyDetail: document.querySelector('[data-sa="locationAccuracyDetail"]'),
  historySessionFilter: document.querySelector('[data-sa="historySessionFilter"]'),
  historyChartWrap: document.querySelector('[data-sa="historyChartWrap"]')
};

const sensorService = createSensorService();
const sensorStorage = createSensorStorageService();
const sensorAuth = createSensorAuthService();
let latestReading = null;
let latestConnectivity = {};
let autoRefreshTimer = null;
let sensorActionInFlight = false;
let currentLocation = {
  locationName: "",
  locationSource: "manual",
  gps: null
};
let turbidityCalibration = getDefaultTurbidityCalibration();
let latestClassification = null;
let sensorConnected = false;
let lastSuccessfulUpdate = null;
let lastResponseTimeMs = null;
let consecutiveReadFailures = 0;
let latestDiagnosticWarnings = ["No diagnostics yet."];
const historyCharts = {
  temperature: null,
  turbidity: null
};
let activeSession = null;
let sensorMap = null;
let sensorMapLayer = null;
let sensorTileLayer = null;
let mapFailed = false;
let latestWeather = null;
let weatherMode = "unavailable";
let bleConnected = false;

function loadText(key, fallback) {
  return sensorStorage.loadText(key, fallback);
}

function saveText(key, value) {
  sensorStorage.saveText(key, value);
}

function getSavedTurbidityCalibration() {
  return normalizeTurbidityCalibration(sensorStorage.getTurbidityCalibration(null));
}

function saveTurbidityCalibration() {
  sensorStorage.saveTurbidityCalibration(turbidityCalibration);
}

function renderTurbidityCalibration() {
  if (els.clearBaseline) els.clearBaseline.textContent = formatInteger(turbidityCalibration.clearRaw);
  if (els.cloudyBaseline) els.cloudyBaseline.textContent = formatInteger(turbidityCalibration.cloudyRaw);
  if (els.calibrationStatus) {
    els.calibrationStatus.textContent = turbidityCalibration.updatedAt
      ? `Calibration saved ${new Date(turbidityCalibration.updatedAt).toLocaleString()}.`
      : "Using prototype defaults: clear water around 2170-2190 raw, cloudy/milk water around 1890-2000 raw.";
  }
}

function getSavedLocation() {
  const saved = sensorStorage.getLocation(null);
  if (!saved || typeof saved !== "object") return { ...currentLocation };
  return {
    locationName: typeof saved.locationName === "string" ? saved.locationName : "",
    locationSource: saved.locationSource === "device-gps" ? "device-gps" : "manual",
    gps: saved.gps && typeof saved.gps === "object" ? saved.gps : null
  };
}

function getEmptyWeather(source = null) {
  return {
    airTemperatureF: null,
    airTemperatureC: null,
    humidityPercent: null,
    pressureMb: null,
    windSpeedMph: null,
    windDirection: null,
    condition: null,
    uvIndex: null,
    cloudCoverPercent: null,
    weatherTimestamp: null,
    weatherSource: source,
    windDirectionDegrees: null,
    weatherCode: null,
    precipitationNow: null,
    recentRainInches: null,
    precipitationProbability: null,
    forecastStorms: false,
    latitude: null,
    longitude: null
  };
}

function getCachedWeather() {
  const cached = sensorStorage.getWeatherCache();
  if (!cached || typeof cached !== "object") return null;
  return { ...getEmptyWeather(), ...cached };
}

function saveCachedWeather(weather) {
  sensorStorage.saveWeatherCache(weather);
}

function weatherModeFor(weather, explicitMode = "") {
  if (explicitMode) return explicitMode;
  if (!weather) return "unavailable";
  return String(weather.weatherSource || "").startsWith("Cached") ? "cached" : "live";
}

function formatCachedWeather(cached) {
  if (!cached) return null;
  const source = String(cached.weatherSource || "weather").replace(/^Cached\s+/i, "");
  return { ...cached, weatherSource: `Cached ${source}` };
}

function renderWeather(weather, statusMessage = "", mode = "") {
  latestWeather = weather || null;
  weatherMode = weatherModeFor(weather, mode);

  if (els.weatherTempF) els.weatherTempF.textContent = formatNumber(weather?.airTemperatureF, " F", 1);
  if (els.weatherTempC) els.weatherTempC.textContent = formatNumber(weather?.airTemperatureC, " C", 1);
  if (els.weatherHumidity) els.weatherHumidity.textContent = Number.isFinite(Number(weather?.humidityPercent)) ? `${Math.round(Number(weather.humidityPercent))}%` : "-";
  if (els.weatherPressure) els.weatherPressure.textContent = Number.isFinite(Number(weather?.pressureMb)) ? `${Number(weather.pressureMb).toFixed(1)} mb` : "-";
  if (els.weatherWind) els.weatherWind.textContent = Number.isFinite(Number(weather?.windSpeedMph)) ? `${Number(weather.windSpeedMph).toFixed(1)} mph ${weather?.windDirection || ""}`.trim() : "-";
  if (els.weatherCondition) els.weatherCondition.textContent = weather?.condition || "-";
  if (els.weatherUv) els.weatherUv.textContent = Number.isFinite(Number(weather?.uvIndex)) ? Number(weather.uvIndex).toFixed(1) : "-";
  if (els.weatherRain) els.weatherRain.textContent = Number.isFinite(Number(weather?.recentRainInches)) ? `${Number(weather.recentRainInches).toFixed(2)} in` : "-";
  if (els.weatherSource) {
    els.weatherSource.textContent = weather?.weatherSource || "Weather unavailable";
    els.weatherSource.classList.toggle("ok", weatherMode === "live");
    els.weatherSource.classList.toggle("warn", weatherMode === "cached");
    els.weatherSource.classList.toggle("bad", weatherMode === "unavailable");
  }
  if (els.weatherUpdated) {
    els.weatherUpdated.textContent = weather?.weatherTimestamp ? new Date(weather.weatherTimestamp).toLocaleString() : "Not refreshed";
    els.weatherUpdated.classList.toggle("ok", weatherMode === "live");
    els.weatherUpdated.classList.toggle("warn", weatherMode === "cached");
    els.weatherUpdated.classList.toggle("bad", weatherMode === "unavailable");
  }
  if (els.weatherStatus) {
    els.weatherStatus.textContent = statusMessage || (weather ? "Live weather is available for saved readings." : "Weather unavailable.");
    els.weatherStatus.classList.toggle("location-bad", weatherMode === "unavailable");
    els.weatherStatus.classList.toggle("location-ok", weatherMode === "live");
  }
  renderDiagnostics();
  renderOverview();
}

function loadInitialWeather() {
  const cached = getCachedWeather();
  if (cached) {
    renderWeather(formatCachedWeather(cached), "Cached weather is available.", "cached");
    return;
  }
  renderWeather(null, "Refresh weather after setting or enabling device location.", "unavailable");
}

async function refreshWeather() {
  if (navigator.onLine === false) {
    const cached = getCachedWeather();
    if (cached) {
      renderWeather(formatCachedWeather(cached), "Internet is offline. Showing cached weather.", "cached");
      return;
    }
    renderWeather(null, "Weather unavailable offline.", "unavailable");
    return;
  }

  if (!currentLocation.gps) {
    renderWeather(latestWeather, "Set or enable device location to retrieve local weather.", weatherMode);
    return;
  }

  if (els.refreshWeather) els.refreshWeather.disabled = true;
  try {
    const weather = await fetchOpenMeteoWeather({
      latitude: currentLocation.gps.latitude,
      longitude: currentLocation.gps.longitude,
      timeoutMs: 8000
    });
    saveCachedWeather(weather);
    renderWeather(weather, "Live Open-Meteo weather loaded for this location.", "live");
  } catch (error) {
    const cached = getCachedWeather();
    if (cached) {
      renderWeather(formatCachedWeather(cached), `${error?.message || "Weather refresh failed"}. Showing cached weather.`, "cached");
      return;
    }
    renderWeather(null, error?.message || "Weather refresh failed.", "unavailable");
  } finally {
    if (els.refreshWeather) els.refreshWeather.disabled = false;
  }
}

function getSavedSessions() {
  return sensorStorage.getSessions();
}

function getSessionName(sessionId) {
  if (!sessionId) return "No session";
  const session = getSavedSessions().find(item => item?.id === sessionId);
  return session?.name || "Unknown session";
}

function saveSessions(sessions) {
  sensorStorage.saveSessions(sessions);
}

function getActiveSession() {
  return getSavedSessions().find(session => session && session.endedAt == null) || null;
}

function setSensorSection(section = "overview") {
  const next = ["overview", "live", "field", "map", "history", "setup"].includes(section) ? section : "overview";
  els.sensorTabs.forEach(tab => {
    const isActive = tab.dataset.sensorTab === next;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  els.sensorSections.forEach(panel => {
    panel.hidden = panel.dataset.sensorSection !== next;
  });
  if (next === "map") window.setTimeout(() => sensorMap?.invalidateSize(), 80);
  if (next === "history") renderHistoryCharts();
}

function getSessionReadingCount(sessionId) {
  if (!sessionId) return 0;
  return getSavedSensorReadings().filter(reading => reading?.sessionId === sessionId).length;
}

function renderOverview() {
  const method = currentMethod();
  const methodLabel = method === "wifi" ? "Wi-Fi" : method === "ble" ? "Bluetooth LE" : "Mock Demo";
  const hasMockReading = method === "mock" && latestReading;

  if (els.overviewConnection) {
    els.overviewConnection.textContent = hasMockReading ? "Mock Demo" : sensorConnected ? `${methodLabel} online` : `${methodLabel} ready`;
    els.overviewConnection.classList.toggle("ok", !hasMockReading && sensorConnected);
    els.overviewConnection.classList.toggle("warn", hasMockReading || !sensorConnected);
    els.overviewConnection.classList.toggle("bad", false);
  }
  if (els.overviewEmpty) {
    els.overviewEmpty.textContent = latestReading
      ? `Latest reading source: ${latestReading.sensorSource || methodLabel}.`
      : "No live sensor reading yet. Refresh a reading or use Mock Demo to try the workflow.";
  }
  if (els.overviewTemp) els.overviewTemp.textContent = formatNumber(latestReading?.temperatureF, " F", 1);
  if (els.overviewTurbidity) els.overviewTurbidity.textContent = formatNumber(latestReading?.turbidityNtu, " estimated", 2);
  if (els.overviewRaw) els.overviewRaw.textContent = `Raw ${formatInteger(latestReading?.turbidityRaw)}`;
  if (els.overviewSession) {
    els.overviewSession.textContent = activeSession
      ? `${activeSession.name || "Untitled Session"} (${getSessionReadingCount(activeSession.id)} readings)`
      : "No active session";
  }
  if (els.overviewLocation) {
    els.overviewLocation.textContent = currentLocation.gps
      ? currentLocation.locationName || "Device GPS"
      : currentLocation.locationName || "Manual location";
  }
  if (els.overviewLastUpdate) {
    els.overviewLastUpdate.textContent = lastSuccessfulUpdate ? new Date(lastSuccessfulUpdate).toLocaleString() : "Never";
  }

  const internetOnline = navigator.onLine !== false;
  const gpsReady = Boolean(currentLocation.gps);
  setBadge(els.overviewSensorBadge, `Sensor: ${hasMockReading ? "mock" : sensorConnected ? "online" : "offline"}`, hasMockReading ? "warn" : sensorConnected ? "ok" : "bad");
  setBadge(els.overviewGpsBadge, `GPS: ${gpsReady ? "ready" : "manual"}`, gpsReady ? "ok" : "warn");
  setBadge(els.overviewInternetBadge, `Internet: ${internetOnline ? "online" : "offline"}`, internetOnline ? "ok" : "bad");
  setBadge(els.overviewWeatherBadge, `Weather: ${weatherMode === "unavailable" ? "unavailable" : weatherMode}`, weatherMode === "unavailable" ? "bad" : weatherMode === "cached" ? "warn" : "ok");
}

function renderActiveSession() {
  if (els.startSession) els.startSession.disabled = Boolean(activeSession);
  if (els.endSession) els.endSession.disabled = !activeSession;

  if (!els.activeSessionIndicator) return;

  if (!activeSession) {
    els.activeSessionIndicator.innerHTML = `
      <span class="tag warn">No active session</span>
      <p class="muted hint">Readings can still be saved without a session.</p>
    `;
    renderOverview();
    return;
  }

  const started = new Date(activeSession.startedAt).toLocaleString();
  els.activeSessionIndicator.innerHTML = `
    <span class="tag ok">Active session</span>
    <strong>${escapeHtml(activeSession.name || "Untitled Session")}</strong>
    <p class="muted hint">Started ${escapeHtml(started)} · ${getSessionReadingCount(activeSession.id)} saved readings</p>
    <p class="muted hint">${escapeHtml(activeSession.locationName || "Manual location")}</p>
  `;
  renderOverview();
}

function startSession() {
  if (activeSession) return;

  const location = getLocationForSave();
  const name = els.sessionName?.value?.trim() || "Sensor Session";
  const notes = els.sessionNotes?.value?.trim() || "";
  const session = {
    id: createId(),
    name,
    notes,
    startedAt: new Date().toISOString(),
    endedAt: null,
    locationName: location.locationName,
    locationSource: location.locationSource,
    gps: location.gps
  };

  const sessions = getSavedSessions();
  sessions.push(session);
  saveSessions(sessions);
  activeSession = session;
  renderActiveSession();
}

function endSession() {
  if (!activeSession) return;

  const sessions = getSavedSessions();
  const endedAt = new Date().toISOString();
  const updated = sessions.map(session =>
    session?.id === activeSession.id ? { ...session, endedAt } : session
  );

  saveSessions(updated);
  activeSession = null;
  renderActiveSession();
}

function saveLocation() {
  sensorStorage.saveLocation(currentLocation);
}

function updateLocationStatus(message, state = "warn") {
  if (!els.locationStatus) return;
  els.locationStatus.textContent = message;
  els.locationStatus.classList.toggle("location-ok", state === "ok");
  els.locationStatus.classList.toggle("location-bad", state === "bad");
}

function renderLocationStatus() {
  if (els.locationSourceDetail) els.locationSourceDetail.textContent = currentLocation.gps ? "Device GPS" : "Manual";
  if (els.locationCoordsDetail) {
    els.locationCoordsDetail.textContent = currentLocation.gps
      ? `${currentLocation.gps.latitude.toFixed(5)}, ${currentLocation.gps.longitude.toFixed(5)}`
      : "Unavailable";
  }
  if (els.locationAccuracyDetail) {
    els.locationAccuracyDetail.textContent = currentLocation.gps?.accuracyMeters != null
      ? `${Math.round(currentLocation.gps.accuracyMeters)} m`
      : "-";
  }
  if (currentLocation.gps) {
    const { latitude, longitude, accuracyMeters } = currentLocation.gps;
    updateLocationStatus(
      `Using this device GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)} (${Math.round(accuracyMeters || 0)} m accuracy).`,
      "ok"
    );
    renderOverview();
    return;
  }

  updateLocationStatus("Manual location is available. GPS is optional.", "warn");
  renderOverview();
}

function syncLocationName() {
  currentLocation.locationName = els.locationName?.value?.trim() || "";
  saveLocation();
}

function getLocationForSave() {
  syncLocationName();
  return {
    locationName: currentLocation.locationName,
    locationSource: currentLocation.gps ? "device-gps" : "manual",
    gps: currentLocation.gps ? { ...currentLocation.gps } : null
  };
}

function setStatus(message, state = "warn") {
  if (els.connectionStatus) els.connectionStatus.textContent = message || "";
  if (els.connectionTag) {
    const method = currentMethod();
    els.connectionTag.textContent = state === "ok"
      ? method === "mock" ? "Mock Demo" : method === "ble" ? "BLE connected" : "Connected"
      : state === "bad" ? "Needs attention" : method === "mock" ? "Mock Demo" : "Ready";
    els.connectionTag.classList.toggle("ok", state === "ok");
    els.connectionTag.classList.toggle("bad", state === "bad");
    els.connectionTag.classList.toggle("warn", state !== "ok" && state !== "bad");
  }
}

function setBusy(isBusy) {
  if (els.testConnection) els.testConnection.disabled = isBusy;
  if (els.refreshReading) els.refreshReading.disabled = isBusy;
  if (els.overviewRefreshReading) els.overviewRefreshReading.disabled = isBusy;
}

function setSaveEnabled(isEnabled) {
  if (els.saveReading) els.saveReading.disabled = !isEnabled;
  if (els.overviewSaveReading) els.overviewSaveReading.disabled = !isEnabled;
}

function setBleStatus(message, state = "warn") {
  if (!els.bleStatus) return;
  els.bleStatus.textContent = message;
  els.bleStatus.classList.toggle("location-ok", state === "ok");
  els.bleStatus.classList.toggle("location-bad", state === "bad");
}

function setBleConnected(isConnected) {
  bleConnected = Boolean(isConnected);
  if (els.connectBluetooth) els.connectBluetooth.disabled = bleConnected;
  if (els.disconnectBluetooth) els.disconnectBluetooth.disabled = !bleConnected;
  if (currentMethod() === "ble") {
    sensorConnected = bleConnected;
    latestConnectivity = currentConnectivity();
    renderDiagnostics();
  }
}

function setBadge(el, label, state) {
  if (!el) return;
  el.textContent = label;
  el.classList.toggle("ok", state === "ok");
  el.classList.toggle("warn", state === "warn");
  el.classList.toggle("bad", state === "bad");
}

function currentMethod() {
  return els.connectionMethod?.value || DEFAULT_METHOD;
}

function currentNetworkMode() {
  return els.networkMode?.value || "same-wifi";
}

function currentConfig() {
  return {
    endpointUrl: els.endpointUrl?.value || "",
    bleServiceUuid: els.bleServiceUuid?.value || "",
    bleCharacteristicUuid: els.bleCharacteristicUuid?.value || "",
    timeoutMs: 7000
  };
}

function currentMapMode() {
  if (!sensorMap) return "unavailable";
  return navigator.onLine === false ? "cached" : "online";
}

function currentConnectivity() {
  return {
    connectionMethod: currentMethod(),
    sensorConnected,
    internetOnline: navigator.onLine !== false,
    weatherMode,
    mapMode: currentMapMode()
  };
}

function applyMethodUI() {
  const method = currentMethod();
  const isWifi = method === "wifi";
  const isBle = method === "ble";
  if (els.endpointField) els.endpointField.style.display = isWifi ? "" : "none";
  if (els.bleFields) els.bleFields.style.display = isBle ? "" : "none";
  setStatus(
    isBle
      ? "Bluetooth LE is selected. Connect a sensor before reading."
      : isWifi
      ? "Wi-Fi is selected. Enter the ESP32 JSON endpoint."
      : "Mock Demo is selected. Readings are generated locally.",
    "warn"
  );
  renderDiagnostics();
}

function formatNumber(value, suffix = "", digits = 1) {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(digits)}${suffix}`;
}

function formatInteger(value) {
  if (!Number.isFinite(value)) return "-";
  return String(Math.round(value));
}

function renderReading(reading) {
  if (els.temperatureF) els.temperatureF.textContent = formatNumber(reading.temperatureF, " °F", 1);
  if (els.temperatureC) els.temperatureC.textContent = formatNumber(reading.temperatureC, " °C", 1);
  if (els.turbidityNtu) els.turbidityNtu.textContent = formatNumber(reading.turbidityNtu, " NTU", 2);
  if (els.turbidityVoltage) els.turbidityVoltage.textContent = formatNumber(reading.turbidityVoltage, " V", 2);
  if (els.turbidityRaw) els.turbidityRaw.textContent = formatInteger(reading.turbidityRaw);
  if (els.sensorSource) els.sensorSource.textContent = `${reading.sensorSource || "Unknown"} source`;

  if (els.readingTimestamp) {
    els.readingTimestamp.textContent = reading.sensorTimestamp
      ? `Sensor timestamp: ${new Date(reading.sensorTimestamp).toLocaleString()}`
      : "Sensor timestamp unavailable.";
  }

  if (els.lastUpdate) {
    els.lastUpdate.textContent = `Last update: ${new Date().toLocaleString()}`;
  }

  latestReading = reading;
  latestConnectivity = currentConnectivity();
  latestClassification = classifyWaterCondition(reading, turbidityCalibration);
  renderClassification(latestClassification);
  setSaveEnabled(true);
  renderOverview();
}

function getReadingWarnings(reading) {
  const warnings = [];
  const temperatureF = Number(reading?.temperatureF);
  const temperatureC = Number(reading?.temperatureC);
  const raw = Number(reading?.turbidityRaw);
  const voltage = Number(reading?.turbidityVoltage);
  const estimatedNtu = Number(reading?.turbidityNtu);

  if (!Number.isFinite(temperatureF) && !Number.isFinite(temperatureC)) {
    warnings.push("Missing water temperature.");
  }
  if (Number.isFinite(temperatureF) && (temperatureF < 32 || temperatureF > 140)) {
    warnings.push(`Impossible water temperature: ${temperatureF.toFixed(1)} F.`);
  }
  if (Number.isFinite(temperatureC) && (temperatureC < 0 || temperatureC > 60)) {
    warnings.push(`Impossible water temperature: ${temperatureC.toFixed(1)} C.`);
  }

  if (!Number.isFinite(raw)) {
    warnings.push("Missing turbidity raw value.");
  } else if (raw < 0 || raw > 4095) {
    warnings.push(`Impossible turbidity raw value: ${Math.round(raw)}.`);
  }

  if (!Number.isFinite(voltage)) {
    warnings.push("Missing turbidity voltage.");
  } else if (voltage < 0 || voltage > 5) {
    warnings.push(`Impossible turbidity voltage: ${voltage.toFixed(2)} V.`);
  }

  if (!Number.isFinite(estimatedNtu)) {
    warnings.push("Estimated clarity input is missing.");
  } else if (estimatedNtu < 0) {
    warnings.push("Estimated clarity value is below zero.");
  }

  if (!reading?.sensorTimestamp) {
    warnings.push("Missing sensor timestamp.");
  } else {
    const ageMs = Date.now() - new Date(reading.sensorTimestamp).getTime();
    if (Number.isFinite(ageMs) && ageMs > 2 * 60 * 1000) {
      warnings.push("Sensor timestamp is stale.");
    }
  }

  if (Array.isArray(reading?.warnings)) {
    warnings.push(...reading.warnings.map(warning => String(warning)));
  }

  return Array.from(new Set(warnings));
}

function renderDiagnostics() {
  const internetOnline = navigator.onLine !== false;
  const gpsReady = Boolean(currentLocation.gps);

  setBadge(els.sensorBadge, `Sensor: ${sensorConnected ? "online" : "offline"}`, sensorConnected ? "ok" : "bad");
  setBadge(els.internetBadge, `Internet: ${internetOnline ? "online" : "offline"}`, internetOnline ? "ok" : "bad");
  setBadge(
    els.weatherBadge,
    `Weather: ${weatherMode === "unavailable" ? "unavailable" : weatherMode}`,
    weatherMode === "unavailable" ? "bad" : weatherMode === "cached" ? "warn" : "ok"
  );
  setBadge(els.mapBadge, `Map: ${currentMapMode()}`, currentMapMode() === "unavailable" ? "bad" : currentMapMode() === "cached" ? "warn" : "ok");
  setBadge(els.gpsBadge, `GPS: ${gpsReady ? "ready" : "manual"}`, gpsReady ? "ok" : "warn");

  if (els.lastSuccessfulUpdate) {
    els.lastSuccessfulUpdate.textContent = lastSuccessfulUpdate
      ? new Date(lastSuccessfulUpdate).toLocaleString()
      : "Never";
  }
  if (els.apiResponseTime) {
    els.apiResponseTime.textContent = Number.isFinite(lastResponseTimeMs)
      ? `${Math.round(lastResponseTimeMs)} ms`
      : "-";
  }
  if (els.consecutiveFailures) {
    els.consecutiveFailures.textContent = String(consecutiveReadFailures);
  }
  if (els.diagnosticWarnings) {
    const warnings = latestDiagnosticWarnings.length ? latestDiagnosticWarnings : ["No diagnostics yet."];
    els.diagnosticWarnings.innerHTML = warnings.map(warning => `<li>${escapeHtml(warning)}</li>`).join("");
  }

  latestConnectivity = currentConnectivity();
  renderOverview();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderClassification(classification) {
  if (!classification) return;

  if (els.classificationBadge) {
    els.classificationBadge.textContent = classification.level;
    els.classificationBadge.classList.toggle("ok", classification.level === "Excellent" || classification.level === "Good");
    els.classificationBadge.classList.toggle("warn", classification.level === "Fair");
    els.classificationBadge.classList.toggle("bad", classification.level === "Poor");
  }

  if (els.confidenceScore) {
    els.confidenceScore.textContent = `Confidence: ${Math.round(classification.confidence * 100)}%`;
  }

  if (els.estimatedClarity) {
    els.estimatedClarity.textContent = `Estimated clarity: ${classification.clarity.label}`;
  }

  if (els.classificationExplanation) {
    els.classificationExplanation.textContent = classification.explanation;
  }
}

function updateSavedCount() {
  const count = getSavedSensorReadings().length;
  if (els.saveStatus) {
    els.saveStatus.textContent = count
      ? `${count} sensor reading${count === 1 ? "" : "s"} saved on this device.`
      : "No sensor readings saved yet.";
  }
  renderOverview();
}

function getHistoryCutoff(range) {
  const now = Date.now();
  if (range === "1h") return now - 60 * 60 * 1000;
  if (range === "24h") return now - 24 * 60 * 60 * 1000;
  if (range === "7d") return now - 7 * 24 * 60 * 60 * 1000;
  return null;
}

function getSavedSensorChartRows() {
  const list = getSavedSensorReadings();
  const cutoff = getHistoryCutoff(els.historyRange?.value || "24h");
  const sessionFilter = els.historySessionFilter?.value || "all";

  return list
    .map(reading => {
      const createdAtMs = new Date(reading?.createdAt || reading?.sensorData?.sensorTimestamp || "").getTime();
      if (!Number.isFinite(createdAtMs)) return null;
      if (cutoff && createdAtMs < cutoff) return null;
      if (sessionFilter !== "all") {
        if (sessionFilter === "none" && reading?.sessionId) return null;
        if (sessionFilter !== "none" && reading?.sessionId !== sessionFilter) return null;
      }

      const temperatureF = Number(reading?.sensorData?.temperatureF);
      const turbidityRaw = Number(reading?.sensorData?.turbidityRaw);
      const turbidityNtu = Number(reading?.sensorData?.turbidityNtu);

      return {
        t: createdAtMs,
        label: new Date(createdAtMs).toLocaleString(undefined, {
          month: "numeric",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit"
        }),
        temperatureF: Number.isFinite(temperatureF) ? temperatureF : null,
        turbidityRaw: Number.isFinite(turbidityRaw) ? turbidityRaw : null,
        turbidityNtu: Number.isFinite(turbidityNtu) ? turbidityNtu : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t);
}

function populateHistorySessionFilter() {
  if (!els.historySessionFilter) return;
  const current = els.historySessionFilter.value || "all";
  const readings = getSavedSensorReadings();
  const sessions = getSavedSessions();
  const sessionIds = Array.from(new Set(readings.map(reading => reading?.sessionId).filter(Boolean)));
  els.historySessionFilter.innerHTML = [
    `<option value="all">All sessions</option>`,
    `<option value="none">No session</option>`,
    ...sessionIds.map(sessionId => {
      const session = sessions.find(item => item?.id === sessionId);
      return `<option value="${escapeHtml(sessionId)}">${escapeHtml(session?.name || "Unknown session")}</option>`;
    })
  ].join("");
  els.historySessionFilter.value = [...sessionIds, "all", "none"].includes(current) ? current : "all";
}

function destroyHistoryChart(key) {
  if (!historyCharts[key]) return;
  historyCharts[key].destroy();
  historyCharts[key] = null;
}

function renderHistoryCharts() {
  populateHistorySessionFilter();
  if (typeof Chart === "undefined") {
    if (els.historyStatus) els.historyStatus.textContent = "Chart.js is unavailable. Saved readings are still stored.";
    return;
  }

  const rows = getSavedSensorChartRows();
  const tempRows = rows.filter(row => row.temperatureF != null);
  const turbidityRows = rows.filter(row => row.turbidityRaw != null || row.turbidityNtu != null);
  if (els.historyChartWrap) els.historyChartWrap.classList.toggle("is-empty", !rows.length);

  if (els.historyStatus) {
    if (!rows.length) {
      els.historyStatus.textContent = "No saved sensor readings in this range.";
    } else {
      els.historyStatus.textContent = `${rows.length} saved reading${rows.length === 1 ? "" : "s"} in this range.`;
    }
  }

  if (!rows.length) {
    destroyHistoryChart("temperature");
    destroyHistoryChart("turbidity");
    return;
  }

  upsertHistoryChart(
    "temperature",
    els.temperatureChart,
    tempRows.map(row => row.label),
    [
      {
        label: "Water Temperature (F)",
        data: tempRows.map(row => row.temperatureF),
        tension: 0.3,
        pointRadius: 2
      }
    ],
    "Temperature (F)"
  );

  upsertHistoryChart(
    "turbidity",
    els.turbidityChart,
    turbidityRows.map(row => row.label),
    [
      {
        label: "Turbidity Raw",
        data: turbidityRows.map(row => row.turbidityRaw),
        tension: 0.3,
        pointRadius: 2,
        yAxisID: "y"
      },
      {
        label: "Estimated Turbidity",
        data: turbidityRows.map(row => row.turbidityNtu),
        tension: 0.3,
        pointRadius: 2,
        borderDash: [6, 4],
        yAxisID: "y1"
      }
    ],
    "Raw",
    {
      y1: {
        type: "linear",
        position: "right",
        title: { display: true, text: "Estimated" },
        grid: { drawOnChartArea: false }
      }
    }
  );
}

function getSavedSensorReadings() {
  return sensorStorage.getSensorReadings();
}

function getReadingCreatedAt(reading) {
  const createdAt = reading?.createdAt || reading?.sensorData?.sensorTimestamp || "";
  const time = new Date(createdAt).getTime();
  return Number.isFinite(time) ? time : null;
}

function getReadingClassification(reading) {
  return reading?.classification?.level || null;
}

function readingMatchesMapFilters(reading) {
  const sessionFilter = els.mapSessionFilter?.value || "all";
  const classificationFilter = els.mapClassificationFilter?.value || "all";
  const classification = getReadingClassification(reading);

  if (sessionFilter !== "all") {
    if (sessionFilter === "none" && reading?.sessionId) return false;
    if (sessionFilter !== "none" && reading?.sessionId !== sessionFilter) return false;
  }

  if (classificationFilter !== "all") {
    if (classificationFilter === "unclassified" && classification) return false;
    if (classificationFilter !== "unclassified" && classification !== classificationFilter) return false;
  }

  return true;
}

function getReadingGps(reading) {
  const latitude = Number(reading?.gps?.latitude);
  const longitude = Number(reading?.gps?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}

function populateMapSessionFilter() {
  if (!els.mapSessionFilter) return;
  const current = els.mapSessionFilter.value || "all";
  const readings = getSavedSensorReadings();
  const sessions = getSavedSessions();
  const sessionIds = Array.from(new Set(readings.map(reading => reading?.sessionId).filter(Boolean)));

  els.mapSessionFilter.innerHTML = [
    `<option value="all">All sessions</option>`,
    `<option value="none">No session</option>`,
    ...sessionIds.map(sessionId => {
      const session = sessions.find(item => item?.id === sessionId);
      return `<option value="${escapeHtml(sessionId)}">${escapeHtml(session?.name || "Unknown session")}</option>`;
    })
  ].join("");

  els.mapSessionFilter.value = [...sessionIds, "all", "none"].includes(current) ? current : "all";
}

function initSensorMap() {
  if (sensorMap || mapFailed || !els.sensorMap) return Boolean(sensorMap);

  if (typeof L === "undefined") {
    mapFailed = true;
    setMapStatus("Map library is unavailable. Saved readings are still listed below.", "bad");
    return false;
  }

  try {
    sensorMap = L.map(els.sensorMap, {
      zoomControl: true,
      attributionControl: true
    }).setView([39.5, -98.35], 4);

    sensorTileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors"
    });

    sensorTileLayer.on("tileerror", () => {
      setMapStatus("Map tiles are unavailable right now. Reading markers and lists still work.", "warn");
    });

    sensorTileLayer.addTo(sensorMap);
    sensorMapLayer = L.layerGroup().addTo(sensorMap);
    return true;
  } catch (error) {
    mapFailed = true;
    setMapStatus("Map could not be started. Saved readings are still listed below.", "bad");
    return false;
  }
}

function renderMapView() {
  populateMapSessionFilter();

  const readings = getSavedSensorReadings()
    .filter(readingMatchesMapFilters)
    .sort((a, b) => (getReadingCreatedAt(a) || 0) - (getReadingCreatedAt(b) || 0));

  const mapped = readings.filter(reading => getReadingGps(reading));
  const unmapped = readings.filter(reading => !getReadingGps(reading));

  renderUnmappedReadings(unmapped);

  if (!initSensorMap()) {
    setMapStatus(
      mapped.length
        ? `${mapped.length} mapped reading${mapped.length === 1 ? "" : "s"} available, but the map is unavailable.`
        : "Map is unavailable. Saved readings are still listed below.",
      mapFailed ? "bad" : "warn"
    );
    return;
  }

  sensorMapLayer.clearLayers();
  const bounds = [];

  for (const reading of mapped) {
    const gps = getReadingGps(reading);
    const marker = L.marker([gps.latitude, gps.longitude]);
    marker.bindPopup(getReadingPopupHtml(reading));
    marker.addTo(sensorMapLayer);
    bounds.push([gps.latitude, gps.longitude]);
  }

  if (bounds.length) {
    sensorMap.fitBounds(bounds, { padding: [24, 24], maxZoom: 16 });
    setMapStatus(`${mapped.length} mapped reading${mapped.length === 1 ? "" : "s"} shown. ${unmapped.length} unmapped.`, "ok");
  } else {
    setMapStatus("No saved readings with GPS coordinates match these filters.", "warn");
  }
}

function getReadingPopupHtml(reading) {
  const data = reading?.sensorData || {};
  const createdAt = getReadingCreatedAt(reading);
  const classification = getReadingClassification(reading) || "Unclassified";
  const weather = reading?.weatherData?.condition || reading?.weatherData?.summary || "Unavailable";
  const location = reading?.locationName || "Unnamed location";
  const temp = Number.isFinite(Number(data.temperatureF)) ? `${Number(data.temperatureF).toFixed(1)} F` : "-";
  const turbidity = Number.isFinite(Number(data.turbidityRaw))
    ? `${Math.round(Number(data.turbidityRaw))} raw`
    : "-";

  return `
    <div class="map-popup">
      <strong>${escapeHtml(location)}</strong>
      <span>${createdAt ? escapeHtml(new Date(createdAt).toLocaleString()) : "Unknown time"}</span>
      <span>Water temp: ${escapeHtml(temp)}</span>
      <span>Turbidity: ${escapeHtml(turbidity)}</span>
      <span>Classification: ${escapeHtml(classification)}</span>
      <span>Weather: ${escapeHtml(weather)}</span>
    </div>
  `;
}

function renderUnmappedReadings(unmapped) {
  if (!els.unmappedReadings) return;
  if (!unmapped.length) {
    els.unmappedReadings.innerHTML = `<p class="muted hint">No unmapped readings match these filters.</p>`;
    return;
  }

  els.unmappedReadings.innerHTML = unmapped.slice().reverse().map(reading => {
    const createdAt = getReadingCreatedAt(reading);
    const data = reading?.sensorData || {};
    const classification = getReadingClassification(reading) || "Unclassified";
    const temp = Number.isFinite(Number(data.temperatureF)) ? `${Number(data.temperatureF).toFixed(1)} F` : "-";
    const turbidity = Number.isFinite(Number(data.turbidityRaw)) ? `${Math.round(Number(data.turbidityRaw))} raw` : "-";
    return `
      <div class="unmapped-reading">
        <strong>${escapeHtml(reading?.locationName || "Unnamed location")}</strong>
        <span>${createdAt ? escapeHtml(new Date(createdAt).toLocaleString()) : "Unknown time"}</span>
        <span>Temp ${escapeHtml(temp)} · Turbidity ${escapeHtml(turbidity)} · ${escapeHtml(classification)}</span>
      </div>
    `;
  }).join("");
}

function setMapStatus(message, state = "warn") {
  if (!els.mapStatus) return;
  els.mapStatus.textContent = message;
  els.mapStatus.classList.toggle("location-ok", state === "ok");
  els.mapStatus.classList.toggle("location-bad", state === "bad");
}

async function centerOnDeviceLocation() {
  if (!initSensorMap()) return;
  setMapStatus("Requesting this device location for map centering...", "warn");

  try {
    const position = await getDevicePosition();
    const latLng = [position.coords.latitude, position.coords.longitude];
    sensorMap.setView(latLng, 16);
    L.circleMarker(latLng, {
      radius: 8,
      color: "#0ea5e9",
      fillColor: "#38bdf8",
      fillOpacity: 0.4
    }).addTo(sensorMapLayer).bindPopup("Current device location");
    setMapStatus("Centered on this device location.", "ok");
  } catch (error) {
    setMapStatus(getFriendlyGeolocationError(error), "bad");
  }
}

function showAllMappedReadings() {
  if (!initSensorMap()) return;
  renderMapView();
}

function handleNetworkChange() {
  if (navigator.onLine === false) {
    const cached = getCachedWeather();
    if (cached) {
      renderWeather(
        formatCachedWeather(cached),
        "Internet is offline. Showing cached weather.",
        "cached"
      );
    } else {
      renderWeather(null, "Weather unavailable offline.");
    }
    return;
  }

  renderDiagnostics();
}

function upsertHistoryChart(key, canvas, labels, datasets, yLabel, extraScales = {}) {
  if (!canvas?.getContext) return;

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: { title: { display: true, text: yLabel } },
      x: { ticks: { maxRotation: 0, minRotation: 0 } },
      ...extraScales
    },
    plugins: {
      legend: { display: datasets.length > 1 }
    }
  };

  if (!historyCharts[key]) {
    historyCharts[key] = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels, datasets },
      options
    });
    return;
  }

  const chart = historyCharts[key];
  chart.data.labels = labels;
  chart.data.datasets = datasets;
  chart.options = options;
  chart.update();
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `sensor-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveCurrentReading() {
  if (!latestReading) {
    if (els.saveStatus) els.saveStatus.textContent = "Refresh a sensor reading before saving.";
    return;
  }

  const location = getLocationForSave();
  const saved = {
    id: createId(),
    sessionId: activeSession?.id || null,
    locationName: location.locationName,
    locationSource: location.locationSource,
    gps: location.gps,
    sensorData: {
      temperatureC: latestReading.temperatureC,
      temperatureF: latestReading.temperatureF,
      turbidityRaw: latestReading.turbidityRaw,
      turbidityVoltage: latestReading.turbidityVoltage,
      turbidityNtu: latestReading.turbidityNtu,
      sensorTimestamp: latestReading.sensorTimestamp,
      sensorSource: latestReading.sensorSource,
      warnings: Array.isArray(latestReading.warnings) ? latestReading.warnings : []
    },
    weatherData: els.includeWeather?.checked && latestWeather ? { ...latestWeather } : null,
    classification: latestClassification ? { ...latestClassification } : null,
    connectivity: { ...latestConnectivity },
    notes: "",
    createdAt: new Date().toISOString()
  };

  const savedWithSync = sensorStorage.saveSensorReading(saved);
  updateSavedCount();
  renderHistoryCharts();
  renderMapView();
  renderActiveSession();
  renderOverview();
  if (els.saveStatus) {
    els.saveStatus.textContent = `Saved reading at ${new Date(savedWithSync.createdAt).toLocaleString()} (${savedWithSync.syncStatus}).`;
  }
}

function captureTurbidityBaseline(kind) {
  if (!latestReading || !Number.isFinite(Number(latestReading.turbidityRaw))) {
    if (els.calibrationStatus) {
      els.calibrationStatus.textContent = "Refresh a reading with a raw turbidity value before capturing a baseline.";
    }
    return;
  }

  const raw = Number(latestReading.turbidityRaw);
  turbidityCalibration = {
    ...turbidityCalibration,
    [kind === "clear" ? "clearRaw" : "cloudyRaw"]: raw,
    updatedAt: new Date().toISOString()
  };

  saveTurbidityCalibration();
  renderTurbidityCalibration();

  if (latestReading) {
    latestClassification = classifyWaterCondition(latestReading, turbidityCalibration);
    renderClassification(latestClassification);
  }
}

function getFriendlyGeolocationError(error) {
  if (error?.code === 1) {
    return "Location permission was denied. You can still save readings with the manual location name.";
  }
  if (error?.code === 2) {
    return "This device could not determine its location. Manual location is still available.";
  }
  if (error?.code === 3) {
    return "Location lookup timed out. You can try again or use manual location only.";
  }
  return "This browser could not get device location. Manual location is still available.";
}

function getDevicePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      maximumAge: 60 * 1000,
      timeout: 10000
    });
  });
}

async function useDeviceLocation() {
  syncLocationName();

  if (!navigator.geolocation) {
    updateLocationStatus("This browser does not support device location. Manual location is still available.", "bad");
    return;
  }

  if (els.useDeviceLocation) els.useDeviceLocation.disabled = true;
  updateLocationStatus("Requesting this device location...", "warn");

  try {
    const position = await getDevicePosition();
    currentLocation = {
      locationName: currentLocation.locationName,
      locationSource: "device-gps",
      gps: {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        altitude: Number.isFinite(position.coords.altitude) ? position.coords.altitude : null,
        accuracyMeters: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
        gpsTimestamp: new Date(position.timestamp || Date.now()).toISOString()
      }
    };
    saveLocation();
    renderLocationStatus();
    renderDiagnostics();
  } catch (error) {
    currentLocation = {
      locationName: currentLocation.locationName,
      locationSource: "manual",
      gps: null
    };
    saveLocation();
    updateLocationStatus(getFriendlyGeolocationError(error), "bad");
    renderDiagnostics();
  } finally {
    if (els.useDeviceLocation) els.useDeviceLocation.disabled = false;
  }
}

async function runSensorAction(action) {
  if (sensorActionInFlight) return;

  const method = currentMethod();
  const config = currentConfig();

  saveText(METHOD_KEY, method);
  saveText(ENDPOINT_KEY, config.endpointUrl);

  sensorActionInFlight = true;
  setBusy(true);
  setStatus(action === "test" ? "Testing connection..." : "Refreshing reading...", "warn");
  const startedAt = performance.now();

  try {
    if (action === "test") {
      const result = await sensorService.test(method, config);
      lastResponseTimeMs = performance.now() - startedAt;
      consecutiveReadFailures = 0;
      sensorConnected = true;
      lastSuccessfulUpdate = Date.now();
      renderReading(result.reading);
      latestDiagnosticWarnings = getReadingWarnings(result.reading);
      renderDiagnostics();
      setStatus(result.message, result.reading.warnings.length ? "warn" : "ok");
      return;
    }

    const reading = await sensorService.read(method, config);
    lastResponseTimeMs = performance.now() - startedAt;
    consecutiveReadFailures = 0;
    sensorConnected = true;
    lastSuccessfulUpdate = Date.now();
    renderReading(reading);
    latestDiagnosticWarnings = getReadingWarnings(reading);
    renderDiagnostics();
    setStatus(
      reading.warnings.length
        ? `Reading loaded with warnings: ${reading.warnings.join("; ")}.`
        : "Reading refreshed.",
      reading.warnings.length ? "warn" : "ok"
    );
  } catch (error) {
    lastResponseTimeMs = performance.now() - startedAt;
    consecutiveReadFailures += 1;
    sensorConnected = false;
    latestDiagnosticWarnings = [getFriendlySensorError(error)];
    renderDiagnostics();
    setStatus(getFriendlySensorError(error), "bad");
  } finally {
    sensorActionInFlight = false;
    setBusy(false);
  }
}

async function connectBluetoothSensor() {
  saveText(METHOD_KEY, "ble");
  if (els.connectionMethod) els.connectionMethod.value = "ble";
  saveText(BLE_SERVICE_UUID_KEY, els.bleServiceUuid?.value || "");
  saveText(BLE_CHARACTERISTIC_UUID_KEY, els.bleCharacteristicUuid?.value || "");
  applyMethodUI();

  if (!navigator.bluetooth) {
    setBleStatus("Bluetooth is not supported in this browser. Use Chrome or Edge on Windows/Android, or use Wi-Fi mode.", "bad");
    setBleConnected(false);
    return;
  }

  try {
    setBleStatus("Opening Bluetooth device picker...", "warn");
    const result = await sensorService.connect("ble", currentConfig());
    setBleConnected(true);
    setBleStatus(result.message || "Bluetooth sensor connected.", "ok");
    setStatus("Bluetooth sensor connected.", "ok");
  } catch (error) {
    setBleConnected(false);
    setBleStatus(getFriendlySensorError(error), "bad");
    setStatus(getFriendlySensorError(error), "bad");
  }
}

async function disconnectBluetoothSensor() {
  try {
    const result = await sensorService.disconnect("ble", currentConfig());
    setBleConnected(false);
    setBleStatus(result.message || "Bluetooth sensor disconnected.", "warn");
    setStatus("Bluetooth sensor disconnected.", "warn");
  } catch (error) {
    setBleStatus(getFriendlySensorError(error), "bad");
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  runSensorAction("refresh");
  autoRefreshTimer = window.setInterval(() => {
    runSensorAction("refresh");
  }, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (!autoRefreshTimer) return;
  window.clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
}

function applyAutoRefresh() {
  if (els.autoRefresh?.checked) {
    startAutoRefresh();
  } else {
    stopAutoRefresh();
  }
}

function renderAuthState(message = "") {
  const session = sensorAuth.getSession();
  const hasProfile = sensorAuth.hasLocalProfile();

  if (els.sensorContent) els.sensorContent.hidden = !session;
  if (els.authGate) els.authGate.hidden = Boolean(session);
  if (els.logoutSensor) els.logoutSensor.hidden = !session;
  if (els.offlineLogin) els.offlineLogin.disabled = !hasProfile;
  if (els.createLocalLogin) els.createLocalLogin.hidden = hasProfile;
  if (els.localLoginName) els.localLoginName.hidden = hasProfile;
  const nameField = els.localLoginName?.closest(".field");
  if (nameField) nameField.hidden = hasProfile;

  if (!els.authStatus) return;

  if (session) {
    els.authStatus.textContent = `Sensor Array signed in locally as ${session.displayName}.`;
    els.authStatus.classList.remove("bad", "warn");
    els.authStatus.classList.add("ok");
    return;
  }

  els.authStatus.textContent = message || (hasProfile
    ? "Sensor Array requires login. Cloud auth is not connected, so use the configured local/offline login."
    : "Sensor Array requires login. Cloud auth is not connected, so create a local/offline login for this device.");
  els.authStatus.classList.toggle("bad", Boolean(message));
  els.authStatus.classList.toggle("warn", !message);
  els.authStatus.classList.remove("ok");
}

async function createLocalLogin() {
  const result = await sensorAuth.createLocalProfile({
    displayName: els.localLoginName?.value || "",
    accessCode: els.localLoginCode?.value || ""
  });
  if (!result.ok) {
    renderAuthState(result.message);
    return;
  }
  renderAuthState(result.message);
  window.location.reload();
}

async function loginOffline() {
  const result = await sensorAuth.loginLocal(els.localLoginCode?.value || "");
  if (!result.ok) {
    renderAuthState(result.message);
    return;
  }
  renderAuthState(result.message);
  window.location.reload();
}

function logoutSensorArray() {
  stopAutoRefresh();
  sensorAuth.logout();
  renderAuthState("Signed out of Sensor Array.");
}

function initAuthGate() {
  renderAuthState();
  els.createLocalLogin?.addEventListener("click", createLocalLogin);
  els.offlineLogin?.addEventListener("click", loginOffline);
  els.logoutSensor?.addEventListener("click", logoutSensorArray);
  els.localLoginCode?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      if (sensorAuth.hasLocalProfile()) {
        loginOffline();
      } else {
        createLocalLogin();
      }
    }
  });
  return sensorAuth.isAuthenticated();
}

function init() {
  if (!initAuthGate()) return;

  const savedMethod = loadText(METHOD_KEY, DEFAULT_METHOD);
  const method = ["wifi", "mock", "ble"].includes(savedMethod) ? savedMethod : DEFAULT_METHOD;
  const savedNetworkMode = loadText(NETWORK_MODE_KEY, "same-wifi");
  currentLocation = getSavedLocation();
  turbidityCalibration = getSavedTurbidityCalibration();
  if (els.connectionMethod) els.connectionMethod.value = method;
  if (els.networkMode) {
    els.networkMode.value = ["same-wifi", "esp32-hotspot", "phone-hotspot"].includes(savedNetworkMode)
      ? savedNetworkMode
      : "same-wifi";
  }
  if (els.endpointUrl) els.endpointUrl.value = loadText(ENDPOINT_KEY, DEFAULT_ENDPOINT);
  if (els.bleServiceUuid) els.bleServiceUuid.value = loadText(BLE_SERVICE_UUID_KEY, "");
  if (els.bleCharacteristicUuid) els.bleCharacteristicUuid.value = loadText(BLE_CHARACTERISTIC_UUID_KEY, "");
  if (els.autoRefresh) els.autoRefresh.checked = false;
  if (els.includeWeather) els.includeWeather.checked = loadText(INCLUDE_WEATHER_KEY, "0") === "1";
  if (els.locationName) els.locationName.value = currentLocation.locationName;

  applyMethodUI();
  setBleConnected(false);
  if (!navigator.bluetooth) {
    setBleStatus("Bluetooth is not supported in this browser. Use Chrome or Edge on Windows/Android, or use Wi-Fi mode.", "bad");
  }
  updateSavedCount();
  setSaveEnabled(false);
  renderLocationStatus();
  renderTurbidityCalibration();
  renderDiagnostics();
  renderHistoryCharts();
  activeSession = getActiveSession();
  renderActiveSession();
  loadInitialWeather();
  renderMapView();
  setSensorSection((location.hash || "").replace("#", "") || "overview");
  renderOverview();

  els.connectionMethod?.addEventListener("change", () => {
    saveText(METHOD_KEY, currentMethod());
    applyMethodUI();
    if (currentMethod() === "ble" && !navigator.bluetooth) {
      setBleStatus("Bluetooth is not supported in this browser. Use Chrome or Edge on Windows/Android, or use Wi-Fi mode.", "bad");
    }
  });

  els.networkMode?.addEventListener("change", () => {
    saveText(NETWORK_MODE_KEY, currentNetworkMode());
    renderDiagnostics();
  });

  els.endpointUrl?.addEventListener("input", () => {
    saveText(ENDPOINT_KEY, els.endpointUrl.value || "");
  });

  els.bleServiceUuid?.addEventListener("input", () => {
    saveText(BLE_SERVICE_UUID_KEY, els.bleServiceUuid.value || "");
  });

  els.bleCharacteristicUuid?.addEventListener("input", () => {
    saveText(BLE_CHARACTERISTIC_UUID_KEY, els.bleCharacteristicUuid.value || "");
  });

  els.testConnection?.addEventListener("click", () => runSensorAction("test"));
  els.refreshReading?.addEventListener("click", () => runSensorAction("refresh"));
  els.overviewRefreshReading?.addEventListener("click", () => runSensorAction("refresh"));
  els.connectBluetooth?.addEventListener("click", connectBluetoothSensor);
  els.disconnectBluetooth?.addEventListener("click", disconnectBluetoothSensor);
  els.saveReading?.addEventListener("click", saveCurrentReading);
  els.overviewSaveReading?.addEventListener("click", saveCurrentReading);
  els.overviewStartSession?.addEventListener("click", () => { setSensorSection("field"); startSession(); });
  els.autoRefresh?.addEventListener("change", applyAutoRefresh);
  els.locationName?.addEventListener("input", syncLocationName);
  els.useDeviceLocation?.addEventListener("click", useDeviceLocation);
  els.captureClearBaseline?.addEventListener("click", () => captureTurbidityBaseline("clear"));
  els.captureCloudyBaseline?.addEventListener("click", () => captureTurbidityBaseline("cloudy"));
  els.historyRange?.addEventListener("change", renderHistoryCharts);
  els.historySessionFilter?.addEventListener("change", renderHistoryCharts);
  els.startSession?.addEventListener("click", startSession);
  els.endSession?.addEventListener("click", endSession);
  els.centerDeviceLocation?.addEventListener("click", centerOnDeviceLocation);
  els.showAllMapped?.addEventListener("click", showAllMappedReadings);
  els.mapSessionFilter?.addEventListener("change", renderMapView);
  els.mapClassificationFilter?.addEventListener("change", renderMapView);
  els.refreshWeather?.addEventListener("click", refreshWeather);
  els.includeWeather?.addEventListener("change", () => {
    saveText(INCLUDE_WEATHER_KEY, els.includeWeather.checked ? "1" : "0");
  });
  window.addEventListener("online", handleNetworkChange);
  window.addEventListener("offline", handleNetworkChange);
  els.sensorTabs.forEach(tab => tab.addEventListener("click", () => setSensorSection(tab.dataset.sensorTab)));
  window.addEventListener("pagehide", stopAutoRefresh);
}

init();
