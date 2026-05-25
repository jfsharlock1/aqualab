import { createWifiTransport } from "./wifiTransport.js";
import { createMockTransport } from "./mockTransport.js";
import { createBluetoothTransport } from "./bluetoothTransport.js";

const NUMERIC_FIELDS = [
  "temperatureC",
  "temperatureF",
  "turbidityRaw",
  "turbidityVoltage",
  "turbidityNtu"
];

const SOURCE_LABELS = {
  wifi: "WiFi",
  mock: "Mock",
  ble: "BLE",
  bluetooth: "BLE"
};

export function createSensorService(options = {}) {
  const transports = {
    wifi: createWifiTransport(options),
    mock: createMockTransport(options),
    ble: createBluetoothTransport(options),
    bluetooth: createBluetoothTransport(options)
  };

  async function read(method, config = {}) {
    const key = transports[method] ? method : "wifi";
    const raw = await transports[key].read(config);
    return normalizeReading(raw, SOURCE_LABELS[key] || "WiFi");
  }

  async function test(method, config = {}) {
    const reading = await read(method, config);
    return {
      ok: true,
      reading,
      message: reading.warnings.length
        ? `Connected, but ${reading.warnings.join("; ")}.`
        : "Connection test succeeded."
    };
  }

  async function connect(method, config = {}) {
    const key = transports[method] ? method : "wifi";
    if (!transports[key].connect) {
      return { ok: true, message: "No connection step is required." };
    }
    return transports[key].connect(config);
  }

  async function disconnect(method, config = {}) {
    const key = transports[method] ? method : "wifi";
    if (!transports[key].disconnect) {
      return { ok: true, message: "No connection is open." };
    }
    return transports[key].disconnect(config);
  }

  return { read, test, connect, disconnect };
}

export function normalizeReading(raw, source) {
  const warnings = [];
  const reading = {
    temperatureC: null,
    temperatureF: null,
    turbidityRaw: null,
    turbidityVoltage: null,
    turbidityNtu: null,
    sensorTimestamp: null,
    sensorSource: source === "Mock" ? "Mock" : source === "BLE" ? "BLE" : "WiFi",
    warnings
  };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("response was not an object");
    return reading;
  }

  for (const field of NUMERIC_FIELDS) {
    const value = Number(raw[field]);
    if (Number.isFinite(value)) {
      reading[field] = value;
    } else if (!(field in raw)) {
      warnings.push(`missing ${field}`);
    } else {
      warnings.push(`invalid ${field}`);
    }
  }

  const timestamp = raw.timestamp || raw.sensorTimestamp;
  if (typeof timestamp === "string" && timestamp.trim()) {
    const parsed = new Date(timestamp);
    if (Number.isFinite(parsed.getTime())) {
      reading.sensorTimestamp = parsed.toISOString();
    } else {
      warnings.push("invalid timestamp");
    }
  } else if ("timestamp" in raw || "sensorTimestamp" in raw) {
    warnings.push("invalid timestamp");
  } else {
    warnings.push("missing timestamp");
  }

  return reading;
}

export function getFriendlySensorError(error) {
  switch (error?.code) {
    case "offline":
      return "This device appears to be offline. Check Wi-Fi, then try again.";
    case "timeout":
      return "Connection timed out. Check the ESP32 address and that it is powered on.";
    case "invalid-json":
      return "The endpoint responded, but it was not valid JSON.";
    case "http-error":
      return `The endpoint returned HTTP ${error.status || "error"}.`;
    case "missing-endpoint":
      return "Enter an ESP32 endpoint URL first.";
    case "bluetooth-unsupported":
      return "Bluetooth is not supported in this browser. Use Chrome or Edge on Windows/Android, or use Wi-Fi mode.";
    case "bluetooth-not-connected":
      return "Connect a Bluetooth sensor before refreshing BLE readings.";
    case "missing-ble-service":
      return "Enter a BLE service UUID to read data from the connected sensor.";
    case "missing-ble-characteristic":
      return "Enter a BLE characteristic UUID for the sensor reading data.";
    case "bluetooth-invalid-json":
      return "The Bluetooth sensor responded, but the reading was not valid JSON.";
    case "unsupported":
      return "Bluetooth transport is reserved for a future phase.";
    default:
      return error?.message || "Could not read from the sensor endpoint.";
  }
}
