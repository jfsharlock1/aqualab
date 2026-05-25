const DEFAULT_TIMEOUT_MS = 7000;

export function createWifiTransport() {
  async function read(config = {}) {
    const endpointUrl = String(config.endpointUrl || "").trim();

    if (!endpointUrl) {
      throw sensorError("missing-endpoint", "Missing ESP32 endpoint URL.");
    }

    if (navigator.onLine === false) {
      throw sensorError("offline", "Device is offline.");
    }

    const controller = new AbortController();
    const timeoutMs = Number(config.timeoutMs) || DEFAULT_TIMEOUT_MS;
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(endpointUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw sensorError("timeout", "Sensor request timed out.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }

    if (!response.ok) {
      const error = sensorError("http-error", `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    try {
      return await response.json();
    } catch {
      throw sensorError("invalid-json", "Invalid JSON response.");
    }
  }

  return { read };
}

function sensorError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
