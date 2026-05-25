const STORAGE_KEYS = {
  readings: "aqualab_sensor_readings",
  sessions: "aqualab_sensor_sessions",
  location: "aqualab_sensor_location",
  turbidityCalibration: "aqualab_turbidity_calibration",
  weatherCache: "aqualab_sensor_weather_cache"
};

export const FUTURE_CLOUD_TABLES = [
  "users",
  "sessions",
  "sensor_readings",
  "saved_locations",
  "device_settings"
];

function loadText(key, fallback = "") {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function saveText(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function loadJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function normalizeSyncMetadata(reading) {
  const now = new Date().toISOString();
  return {
    ...reading,
    syncStatus: ["local-only", "pending-sync", "synced", "sync-failed"].includes(reading?.syncStatus)
      ? reading.syncStatus
      : "local-only",
    cloudId: reading?.cloudId ?? null,
    lastSyncedAt: reading?.lastSyncedAt ?? null,
    updatedAt: reading?.updatedAt || reading?.createdAt || now
  };
}

function normalizeReadingList(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(normalizeSyncMetadata) : [];
}

export function createSensorStorageService() {
  function getSensorReadings() {
    const raw = loadJson(STORAGE_KEYS.readings, []);
    const normalized = normalizeReadingList(raw);
    if (Array.isArray(raw) && JSON.stringify(raw) !== JSON.stringify(normalized)) {
      saveJson(STORAGE_KEYS.readings, normalized);
    }
    return normalized;
  }

  function saveSensorReadings(readings) {
    return saveJson(STORAGE_KEYS.readings, normalizeReadingList(readings));
  }

  function saveSensorReading(reading) {
    const next = normalizeSyncMetadata({
      ...reading,
      updatedAt: new Date().toISOString()
    });
    const readings = getSensorReadings();
    readings.push(next);
    saveSensorReadings(readings);
    return next;
  }

  function getSessions() {
    const sessions = loadJson(STORAGE_KEYS.sessions, []);
    return Array.isArray(sessions) ? sessions : [];
  }

  function saveSessions(sessions) {
    return saveJson(STORAGE_KEYS.sessions, Array.isArray(sessions) ? sessions : []);
  }

  function getLocation(fallback) {
    return loadJson(STORAGE_KEYS.location, fallback);
  }

  function saveLocation(location) {
    return saveJson(STORAGE_KEYS.location, location);
  }

  function getTurbidityCalibration(fallback = null) {
    return loadJson(STORAGE_KEYS.turbidityCalibration, fallback);
  }

  function saveTurbidityCalibration(calibration) {
    return saveJson(STORAGE_KEYS.turbidityCalibration, calibration);
  }

  function getWeatherCache() {
    return loadJson(STORAGE_KEYS.weatherCache, null);
  }

  function saveWeatherCache(weather) {
    return saveJson(STORAGE_KEYS.weatherCache, weather);
  }

  return {
    keys: { ...STORAGE_KEYS },
    futureCloudTables: [...FUTURE_CLOUD_TABLES],
    loadText,
    saveText,
    loadJson,
    saveJson,
    getSensorReadings,
    saveSensorReadings,
    saveSensorReading,
    getSessions,
    saveSessions,
    getLocation,
    saveLocation,
    getTurbidityCalibration,
    saveTurbidityCalibration,
    getWeatherCache,
    saveWeatherCache
  };
}
