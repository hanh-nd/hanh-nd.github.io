// The knockout tournament: the bracket, simulated and watched matches, the hub.
import * as THREE from 'three';
import { clamp, rand } from './util.js';
import { AI_LEVELS, AI_STYLES, BRACKET_SEEDS, FINAL, JUTSU_AI, LEVEL_ORDER, ROSTER, ROUND_BEST_OF, ROUND_NAMES, TIERS, YOU, drawLevel } from './config.js';
import { setBoardText } from './render/table.js';
import { VENUE_OF_TIER, setAttendance } from './render/venues.js';
import { YOU_FLAG, match, setHome, setOpponent, startMatch } from './rules.js';
import { $, store } from './ui/hud.js';
import { enterMenuState, kitOpen, menuVenue, oppCard, setKitOpen, setUiMode, showEvent, showKit, showStartMenu, uiMode } from './ui/menus.js';
import { Sound } from './audio.js';

/* =====================================================================
   TOURNAMENT — 8-player knockout. You play your matches; the others are
   simulated from the players' levels and seeds — or you watch them played
   out CPU vs CPU, and that result counts. Progress is saved.
   ===================================================================== */
// v2: 16 players, real names (the old 8-player saves under 'pp3d.tour' are ignored).
export let tour = store.get('pp3d.tour2', null);
const saveTour = () => store.set('pp3d.tour2', tour);
export const playerMatch = () => tour.rounds[tour.round].find(m => m.a === YOU || m.b === YOU);
export const hex = c => '#' + new THREE.Color(c).getHexString();

export function newTournament(tierKey) {
  const tier = TIERS[tierKey];
  const bots = [...ROSTER].sort(() => Math.random() - 0.5).slice(0, BRACKET_SEEDS.length - 1)
    .map((b, i) => ({ ...b, short: b.short || b.name.split(' ').pop(), seed: i + 1, level: drawLevel(tier.pool) }));
  const you = { name: 'You', short: 'You', flag: YOU_FLAG, seed: 0, you: true };
  const entrants = BRACKET_SEEDS.map(seed => (seed === 0 ? you : bots[seed - 1]));
  const rounds = [Array.from({ length: entrants.length / 2 }, (_, i) => ({ a: 2 * i, b: 2 * i + 1, w: null }))];
  tour = { tier: tierKey, entrants, rounds, round: 0, done: false, champion: null, lostIn: null };
  saveTour();
}

/** Simulate a bot-vs-bot match: per-game odds from level and seed, plausible scores. */
function simulateMatch(m, bestOf) {
  const A = tour.entrants[m.a], B = tour.entrants[m.b];
  const strength = e => LEVEL_ORDER.indexOf(e.level) + (16 - e.seed) * 0.04;
  const pGame = 1 / (1 + Math.exp(-(strength(A) - strength(B)) * 1.1));
  const need = (bestOf + 1) / 2, g = [0, 0], detail = [];
  while (g[0] < need && g[1] < need) {
    const w = Math.random() < pGame ? 0 : 1;
    const lose = Math.random() < 0.15 ? 10 + Math.floor(rand(0, 3)) : Math.floor(rand(3, 10));
    const win = lose >= 10 ? lose + 2 : 11;
    g[w]++;
    detail.push(w === 0 ? `${win}-${lose}` : `${lose}-${win}`);
  }
  Object.assign(m, { w: g[0] > g[1] ? m.a : m.b, g, detail });
}

/** Is this an undecided bot-vs-bot match of the current round (one you can watch)? */
const watchable = (m, r) => !tour.done && r === tour.round && m.w == null && m.a !== YOU && m.b !== YOU;

/** Play out a round's remaining matches and draw the next round (or crown the champion). */
function completeRound(r) {
  for (const m of tour.rounds[r]) if (m.w == null) simulateMatch(m, ROUND_BEST_OF[r]);
  if (r === FINAL) { tour.champion = tour.rounds[r][0].w; return; }
  const ws = tour.rounds[r].map(m => m.w), next = [];
  for (let i = 0; i < ws.length; i += 2) next.push({ a: ws[i], b: ws[i + 1], w: null });
  tour.rounds[r + 1] = next;
}

/** Finish the current round (simulating what wasn't played or watched) and move on. */
function advanceRound() {
  completeRound(tour.round);
  if (tour.round === FINAL) tour.done = true;
  else tour.round++;
}

/** Your result. Knocked out, you can still watch the later rounds (or simulate them). */
export function tourRecordResult(won) {
  const m = playerMatch(), youA = m.a === YOU;
  const flip = sc => sc.split('-').reverse().join('-');
  Object.assign(m, {
    w: won ? YOU : youA ? m.b : m.a,
    g: youA ? [...match.games] : [match.games[1], match.games[0]],
    detail: match.gameScores.map(sc => (youA ? sc : flip(sc))),
  });
  if (!won) tour.lostIn = tour.round;
  advanceRound();
  if (won && tour.done) {
    const titles = store.get('pp3d.titles', {});
    titles[tour.tier] = (titles[tour.tier] || 0) + 1;
    store.set('pp3d.titles', titles);
  }
  saveTour();
}

/** A watched match counts like a played one (entrant a played the near end). */
export function tourRecordWatched(winner) {
  const { r, i } = match.watch, m = tour.rounds[r][i];
  Object.assign(m, { w: winner === 'player' ? m.a : m.b, g: [...match.games], detail: [...match.gameScores] });
  // Once you're out, nothing waits on your match: the round ends when its last match is decided.
  if (tour.lostIn != null && tour.rounds[r].every(x => x.w != null)) advanceRound();
  saveTour();
}

export function attrBars(e) {
  const st = AI_STYLES[e.style], lv = AI_LEVELS[e.level];
  const spin = lv.spin * (st.top * (1 - st.chop) + st.chopSpin * st.chop + st.side * 0.25) / 1.8;
  return [
    ['Power', (lv.power * st.power - 0.6) / 0.8],
    ['Spin', spin],
    ['Footwork', (lv.speed - 2.2) / 1.2 + (1 - st.reaction) * 0.8],
    ['Consistency', 1 - lv.mistakeRate * st.mistake * 8],
    ['Reaction', 1.15 - lv.reactionMs * st.reaction / 260],
    ['Smash', lv.smash * st.smash / 1.2],
    ['Jutsu', JUTSU_AI[e.level].use],
  ].map(([k, v]) => `<span>${k}</span><div class="bar"><i style="width:${Math.round(clamp(v, 0.08, 1) * 100)}%"></i></div>`).join('');
}

function matchBox(m, r, i) {
  if (!m) return '<div class="bm"><div class="bp"><span class="nm">TBD</span></div><div class="bp"><span class="nm">TBD</span></div></div>';
  const live = !tour.done && r === tour.round && (m.a === YOU || m.b === YOU);
  const title = m.detail ? ` title="${m.detail.join(', ')}"` : '';
  const row = (e, k) => {
    const ent = tour.entrants[e];
    const cls = ['bp', m.w === e ? 'win' : '', m.w != null && m.w !== e ? 'lost' : '', e === YOU ? 'you' : ''].join(' ');
    return `<div class="${cls}"><span>${ent.flag}</span><span class="nm">${ent.short}</span><span class="sc">${m.g ? m.g[k] : ''}</span></div>`;
  };
  const watch = watchable(m, r) ? `<button class="watch" data-r="${r}" data-i="${i}">▶ Watch</button>` : '';
  return `<div class="bm${live ? ' live' : ''}"${title}>${row(m.a, 0)}${row(m.b, 1)}${watch}</div>`;
}

export function showTourHub() {
  enterMenuState();
  menuVenue(VENUE_OF_TIER[tour.tier], TIERS[tour.tier].label);
  const tier = TIERS[tour.tier], titles = store.get('pp3d.titles', {});
  $('tour-tier').textContent = `${tier.label} · ${tier.fans.toLocaleString()} fans`;
  const out = tour.lostIn != null;
  $('tour-title').textContent = tour.done ? (tour.champion === YOU ? '🏆 Champion!' : 'Tournament over')
    : out ? `${ROUND_NAMES[tour.round]} · You're out` : `Next: ${ROUND_NAMES[tour.round]}`;
  $('tour-titles').textContent = titles[tour.tier] ? `Your ${tier.label} titles: 🏆×${titles[tour.tier]}` : '';
  $('bracket').innerHTML = ROUND_NAMES.map((name, r) => {
    let html = `<div class="bcol"><h4>${name}</h4><div class="bms">`;
    for (let i = 0; i < (tour.entrants.length / 2) >> r; i++) html += matchBox(tour.rounds[r] && tour.rounds[r][i], r, i);
    if (r === FINAL) {
      const c = tour.champion != null ? tour.entrants[tour.champion] : null;
      html += `<div class="champ">🏆<b>${c ? `${c.flag} ${c.short}` : '?'}</b>Champion</div>`;
    }
    return html + '</div></div>';
  }).join('');

  let next = '', actions = '';
  if (tour.done) {
    const champ = tour.entrants[tour.champion];
    next = tour.champion === YOU
      ? `<div class="result gold">🏆 <b>${tier.label}</b> champion!</div>`
      : `<div class="result">Out in the ${ROUND_NAMES[tour.lostIn]} · 🏆 ${champ.flag} <b>${champ.name}</b></div>`;
    actions = '<button class="btn" id="btn-tour-again">New Tournament</button>';
  } else if (out) {
    next = `<div class="result">Out in the ${ROUND_NAMES[tour.lostIn]} · ▶ watch or skip</div>`;
    actions = '<button class="btn" id="btn-tour-sim">Skip to the End</button>';
  } else {
    const m = playerMatch(), e = tour.entrants[m.a === YOU ? m.b : m.a];
    next = oppCard(e, `${ROUND_NAMES[tour.round]} · Seed ${e.seed} · Best of ${ROUND_BEST_OF[tour.round]}`);
    actions = `<button class="btn" id="btn-tour-play">Play ${ROUND_NAMES[tour.round]}</button>`;
  }
  $('tour-next').innerHTML = next;
  const playing = !tour.done && !out;
  if (playing) { setKitOpen(-1); showKit(); $('tour-kit').appendChild($('kit-box')); }
  else if ($('tour-kit').contains($('kit-box'))) $('ready-kit').appendChild($('kit-box'));
  $('tour-actions').innerHTML = actions + (tour.done ? '' : '<button class="btn alt" id="btn-tour-change">New Event</button>')
    + '<button class="btn alt" id="btn-tour-menu">Main Menu</button>';
  const play = $('btn-tour-play'), again = $('btn-tour-again'), sim = $('btn-tour-sim');
  if (play) play.addEventListener('click', playTourMatch);
  if (sim) sim.addEventListener('click', () => { while (!tour.done) advanceRound(); saveTour(); showTourHub(); });
  $('bracket').querySelectorAll('.watch').forEach(b => b.addEventListener('click', () => watchTourMatch(+b.dataset.r, +b.dataset.i)));
  if (again) again.addEventListener('click', () => { newTournament(tour.tier); showTourHub(); });
  $('btn-tour-menu').addEventListener('click', showStartMenu);
  if (!tour.done) $('btn-tour-change').addEventListener('click', () => { setUiMode('tour'); showEvent(); });
  setAttendance(tier.crowd[tour.round]);
  setBoardText(tier.label);
  $('menu-tour').classList.remove('hidden');
}

export function playTourMatch() {
  Sound.init();
  const m = playerMatch();
  match.mode = 'tour';
  match.watch = null;
  match.doubles = false;
  setHome(null);
  match.gamesToWin = (ROUND_BEST_OF[tour.round] + 1) / 2;
  setOpponent(tour.entrants[m.a === YOU ? m.b : m.a]);
  startMatch();
}

/** Watch a bot-vs-bot match: entrant a plays the near end, b the far end. */
export function watchTourMatch(r, i) {
  Sound.init();
  const m = tour.rounds[r][i];
  match.mode = 'tour';
  match.watch = { r, i };
  match.doubles = false;
  match.gamesToWin = (ROUND_BEST_OF[r] + 1) / 2;
  setHome(tour.entrants[m.a]);
  setOpponent(tour.entrants[m.b]);
  startMatch();
}
