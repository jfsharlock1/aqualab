let bleDevice = null;
let bleServer = null;
let bleCharacteristic = null;

export function createBluetoothTransport() {
  async function connect(config = {}) {
    ensureBluetoothSupport();

    const serviceUuid = cleanUuid(config.bleServiceUuid);
    const characteristicUuid = cleanUuid(config.bleCharacteristicUuid);
    const filters = serviceUuid
      ? [{ services: [serviceUuid] }, { namePrefix: "AquaLab" }]
      : [{ namePrefix: "AquaLab" }];
    const optionalServices = serviceUuid ? [serviceUuid] : [];

    bleDevice = await navigator.bluetooth.requestDevice({
      filters,
      optionalServices
    });

    bleDevice.addEventListener("gattserverdisconnected", () => {
      bleServer = null;
      bleCharacteristic = null;
    });

    bleServer = await bleDevice.gatt.connect();

    if (serviceUuid && characteristicUuid) {
      const service = await bleServer.getPrimaryService(serviceUuid);
      bleCharacteristic = await service.getCharacteristic(characteristicUuid);
    } else {
      bleCharacteristic = null;
    }

    return {
      ok: true,
      deviceName: bleDevice.name || "AquaLab BLE sensor",
      message: `Connected to ${bleDevice.name || "AquaLab BLE sensor"}.`
    };
  }

  async function disconnect() {
    try {
      if (bleDevice?.gatt?.connected) bleDevice.gatt.disconnect();
    } finally {
      bleDevice = null;
      bleServer = null;
      bleCharacteristic = null;
    }

    return { ok: true, message: "Bluetooth sensor disconnected." };
  }

  async function read(config = {}) {
    ensureBluetoothSupport();

    if (!bleServer?.connected) {
      throw sensorError("bluetooth-not-connected", "Bluetooth sensor is not connected.");
    }

    if (!bleCharacteristic) {
      const serviceUuid = cleanUuid(config.bleServiceUuid);
      const characteristicUuid = cleanUuid(config.bleCharacteristicUuid);
      if (!serviceUuid) throw sensorError("missing-ble-service", "Missing BLE service UUID.");
      if (!characteristicUuid) throw sensorError("missing-ble-characteristic", "Missing BLE characteristic UUID.");

      const service = await bleServer.getPrimaryService(serviceUuid);
      bleCharacteristic = await service.getCharacteristic(characteristicUuid);
    }

    const dataView = await bleCharacteristic.readValue();
    return parseBleReading(dataView);
  }

  return { connect, disconnect, read };
}

function ensureBluetoothSupport() {
  if (!navigator.bluetooth) {
    throw sensorError(
      "bluetooth-unsupported",
      "Bluetooth is not supported in this browser. Use Chrome or Edge on Windows/Android, or use Wi-Fi mode."
    );
  }
}

function parseBleReading(dataView) {
  const text = new TextDecoder().decode(dataView).trim();
  if (!text) {
    throw sensorError("bluetooth-invalid-json", "Empty BLE reading.");
  }

  try {
    const payload = JSON.parse(text);
    return {
      temperatureC: payload.temperatureC ?? null,
      temperatureF: payload.temperatureF ?? null,
      turbidityRaw: payload.turbidityRaw ?? null,
      turbidityVoltage: payload.turbidityVoltage ?? null,
      turbidityNtu: payload.turbidityNtu ?? null,
      sensorTimestamp: payload.sensorTimestamp || payload.timestamp || new Date().toISOString()
    };
  } catch {
    throw sensorError("bluetooth-invalid-json", "Invalid BLE JSON reading.");
  }
}

function cleanUuid(value) {
  return String(value || "").trim();
}

function sensorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
