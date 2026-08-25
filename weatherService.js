const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const DEFAULT_TIMEOUT_MS = 8000;
const MS_PER_HOUR = 60 * 60 * 1000;

function finiteNumber(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function round(value, digits = 1) {
  const number = finiteNumber(value);
  if (number == null) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}

function fahrenheitToCelsius(value) {
  const number = finiteNumber(value);
  return number == null ? null : round((number - 32) * 5 / 9, 1);
}

export function weatherCodeToLabel(code) {
  const value = Number(code);
  if (value === 0) return "Clear";
  if (value === 1) return "Mostly clear";
  if (value === 2) return "Partly cloudy";
  if (value === 3) return "Overcast";
  if (value === 45 || value === 48) return "Fog";
  if ([51, 53, 55, 56, 57].includes(value)) return "Drizzle";
  if ([61, 63, 66, 80, 81].includes(value)) return "Rain";
  if ([65, 67, 82].includes(value)) return "Heavy rain";
  if ([95, 96, 99].includes(value)) return "Thunderstorms";
  if ([71, 73, 75, 77, 85, 86].includes(value)) return "Snow";
  return "Weather unavailable";
}

export function degreesToCardinal(degrees) {
  const value = finiteNumber(degrees);
  if (value == null) return null;
  const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return directions[Math.round((((value % 360) + 360) % 360) / 22.5) % 16];
}

export function classifyRecentRain(recentRainInches) {
  const rain = finiteNumber(recentRainInches, 0);
  if (rain >= 1.25) return "heavy";
  if (rain >= 0.45) return "moderate";
  if (rain >= 0.05) return "light";
  return "none";
}

function assertCoordinates(latitude, longitude) {
  const lat = finiteNumber(latitude);
  const lon = finiteNumber(longitude);
  if (lat == null || lon == null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error("Valid latitude and longitude are required for weather.");
  }
  return { latitude: lat, longitude: lon };
}

export function buildOpenMeteoUrl(latitude, longitude) {
  const coords = assertCoordinates(latitude, longitude);
  const params = new URLSearchParams({
    latitude: String(coords.latitude),
    longitude: String(coords.longitude),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "precipitation",
      "weather_code",
      "cloud_cover",
      "pressure_msl",
      "wind_speed_10m",
      "wind_direction_10m"
    ].join(","),
    hourly: [
      "precipitation",
      "precipitation_probability",
      "weather_code",
      "uv_index"
    ].join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    past_days: "1",
    forecast_days: "2",
    timezone: "auto"
  });
  return `${OPEN_METEO_URL}?${params.toString()}`;
}

function parseHourlyTime(value) {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isFinite(time)) return time;
  const fallback = new Date(`${value}:00`).getTime();
  return Number.isFinite(fallback) ? fallback : null;
}

function getHourlyEntries(hourly = {}) {
  const times = Array.isArray(hourly.time) ? hourly.time : [];
  return times.map((time, index) => ({
    time,
    timeMs: parseHourlyTime(time),
    precipitation: finiteNumber(hourly.precipitation?.[index], 0),
    precipitationProbability: finiteNumber(hourly.precipitation_probability?.[index], null),
    weatherCode: finiteNumber(hourly.weather_code?.[index], null),
    uvIndex: finiteNumber(hourly.uv_index?.[index], null)
  })).filter(entry => Number.isFinite(entry.timeMs));
}

function nearestHourly(entries, targetMs) {
  if (!entries.length || !Number.isFinite(targetMs)) return null;
  return entries.reduce((best, entry) => {
    if (!best) return entry;
    return Math.abs(entry.timeMs - targetMs) < Math.abs(best.timeMs - targetMs) ? entry : best;
  }, null);
}

function sumPrecipitation(entries, fromMs, toMs) {
  return entries
    .filter(entry => entry.timeMs >= fromMs && entry.timeMs <= toMs)
    .reduce((sum, entry) => sum + (finiteNumber(entry.precipitation, 0) || 0), 0);
}

function maxProbability(entries, fromMs, toMs) {
  const values = entries
    .filter(entry => entry.timeMs >= fromMs && entry.timeMs <= toMs)
    .map(entry => finiteNumber(entry.precipitationProbability))
    .filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function hasForecastStorms(entries, fromMs, toMs) {
  return entries.some(entry => {
    if (entry.timeMs < fromMs || entry.timeMs > toMs) return false;
    const code = Number(entry.weatherCode);
    const probability = finiteNumber(entry.precipitationProbability, 0);
    const precipitation = finiteNumber(entry.precipitation, 0);
    return [95, 96, 99].includes(code) || probability >= 60 || precipitation >= 0.2;
  });
}

function validateOpenMeteoPayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Open-Meteo returned an empty weather response.");
  if (!payload.current || typeof payload.current !== "object") throw new Error("Open-Meteo response is missing current weather.");
  if (!Array.isArray(payload.hourly?.time)) throw new Error("Open-Meteo response is missing hourly weather.");
}

export function normalizeOpenMeteoWeather(payload, requestedLatitude, requestedLongitude) {
  validateOpenMeteoPayload(payload);
  const current = payload.current;
  const entries = getHourlyEntries(payload.hourly);
  const nowMs = parseHourlyTime(current.time) || Date.now();
  const nearest = nearestHourly(entries, nowMs);
  const recentRainInches = round(sumPrecipitation(entries, nowMs - 24 * MS_PER_HOUR, nowMs), 2);
  const precipitationProbability = maxProbability(entries, nowMs, nowMs + 24 * MS_PER_HOUR);
  const forecastStorms = hasForecastStorms(entries, nowMs, nowMs + 24 * MS_PER_HOUR);
  const windDirectionDegrees = finiteNumber(current.wind_direction_10m);
  const airTemperatureF = round(current.temperature_2m, 1);

  return {
    airTemperatureF,
    airTemperatureC: fahrenheitToCelsius(airTemperatureF),
    humidityPercent: finiteNumber(current.relative_humidity_2m),
    pressureMb: round(current.pressure_msl, 1),
    windSpeedMph: round(current.wind_speed_10m, 1),
    windDirection: degreesToCardinal(windDirectionDegrees),
    windDirectionDegrees,
    condition: weatherCodeToLabel(current.weather_code),
    weatherCode: finiteNumber(current.weather_code),
    uvIndex: nearest?.uvIndex == null ? null : round(nearest.uvIndex, 1),
    cloudCoverPercent: finiteNumber(current.cloud_cover),
    precipitationNow: round(current.precipitation, 2),
    recentRainInches,
    precipitationProbability,
    forecastStorms,
    weatherTimestamp: current.time ? new Date(current.time).toISOString() : new Date().toISOString(),
    weatherSource: "Open-Meteo",
    latitude: round(payload.latitude ?? requestedLatitude, 5),
    longitude: round(payload.longitude ?? requestedLongitude, 5)
  };
}

async function fetchWithTimeout(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`Open-Meteo weather request failed (${response.status}).`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("Open-Meteo weather request timed out.");
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

export async function fetchOpenMeteoWeather({ latitude, longitude, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const coords = assertCoordinates(latitude, longitude);
  const url = buildOpenMeteoUrl(coords.latitude, coords.longitude);
  const payload = await fetchWithTimeout(url, timeoutMs);
  return normalizeOpenMeteoWeather(payload, coords.latitude, coords.longitude);
}

export function summarizeWeather(weather) {
  if (!weather) return "Weather unavailable. Confirm recent conditions manually.";
  const parts = [];
  if (Number.isFinite(Number(weather.airTemperatureF))) parts.push(`${Number(weather.airTemperatureF).toFixed(0)} F`);
  if (Number.isFinite(Number(weather.uvIndex))) parts.push(`UV ${Number(weather.uvIndex).toFixed(0)}`);
  if (Number.isFinite(Number(weather.recentRainInches))) parts.push(`${Number(weather.recentRainInches).toFixed(2)} in rain last 24 hr`);
  if (Number.isFinite(Number(weather.windSpeedMph))) {
    parts.push(`${weather.windDirection || "Wind"} wind ${Number(weather.windSpeedMph).toFixed(0)} mph`);
  }
  if (weather.forecastStorms) parts.push("storms possible later");
  return parts.length ? parts.join(" · ") : "Weather unavailable. Confirm recent conditions manually.";
}