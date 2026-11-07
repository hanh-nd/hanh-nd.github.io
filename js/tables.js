// The table you play on: its physics (TABLES) and, on the park table, each point's wind.
import { PHYS, TABLES, TABLE_OF_VENUE } from './config.js';
import { wind } from './physics.js';
import { rand } from './util.js';

/* =====================================================================
   TABLES — a table only swaps a few PHYS numbers. Every flight, bounce and
   read (yours, the CPU's, the aim, the reach guard) runs through stepBall
   with the live PHYS and `wind`, so they all agree on the table at once.
   The numbers a table replaces are put back when it's left, so a tuned
   PHYS (the sim's `tune`) survives a change of table.
   ===================================================================== */
export const table = { key: 'arena', def: TABLES.arena };
let restore = {};

export function setTable(key) {
  const def = TABLES[key] || TABLES.arena;
  Object.assign(PHYS, restore);
  restore = {};
  for (const k of Object.keys(def.phys)) { restore[k] = PHYS[k]; PHYS[k] = def.phys[k]; }
  table.key = TABLES[key] ? key : 'arena'; table.def = def;
  calmWind();
}
export const setTableOfVenue = venue => setTable(TABLE_OF_VENUE[venue]);

export function calmWind() { wind.x = 0; wind.z = 0; }
/** A new point: the park table rolls its wind (often some, sometimes none); other tables stay calm.
 *  It holds for the whole point. Returns the wind. */
export function rollWind() {
  const w = table.def.wind;
  calmWind();
  if (w && Math.random() < w.chance) {
    const s = rand(w.min, w.max), a = rand(0, Math.PI * 2);
    wind.x = Math.cos(a) * s;
    wind.z = Math.sin(a) * s * w.along;
  }
  return wind;
}
