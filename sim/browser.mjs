// Headless Chromium for the sims: playwright-core (npm install in sim/), its own browser if it has
// one, else the installed Google Chrome (or CHROME=/path/to/chrome).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');

export async function launch() {
  if (process.env.CHROME) return pw.chromium.launch({ headless: true, executablePath: process.env.CHROME });
  try { return await pw.chromium.launch({ headless: true }); }
  catch (e) { return pw.chromium.launch({ headless: true, channel: 'chrome' }); }
}
export const gameUrl = () => process.env.SIM_URL || 'http://localhost:8765/index.html';
