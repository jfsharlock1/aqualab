export function createMockTransport() {
  async function read() {
    await delay(250);

    const drift = Math.sin(Date.now() / 30000);
    const temperatureC = 24.6 + drift * 0.4;
    const temperatureF = temperatureC * 9 / 5 + 32;
    const turbidityVoltage = 2.67 + drift * 0.05;
    const turbidityNtu = 1.8 + Math.abs(drift) * 0.25;

    return {
      temperatureC: Number(temperatureC.toFixed(1)),
      temperatureF: Number(temperatureF.toFixed(1)),
      turbidityRaw: Math.round(2185 + drift * 35),
      turbidityVoltage: Number(turbidityVoltage.toFixed(2)),
      turbidityNtu: Number(turbidityNtu.toFixed(2)),
      timestamp: new Date().toISOString()
    };
  }

  return { read };
}

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}
