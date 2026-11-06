// Small math helpers: clamp, uniform and normal random.

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function randn() {   // standard normal (Box–Muller)
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const rand = (a, b) => a + Math.random() * (b - a);
