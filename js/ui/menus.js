// Menu screens and overlays: home, rival pick, ready, pause, settings, end of match.
import { rand } from '../util.js';
import { AI_LEVELS, AI_STYLES, COLORS, FINAL, GAME, JUTSU, JUTSU_ANGLE, JUTSU_POOL, JUTSU_TIP, LEVEL_BLURB, LEVEL_ORDER, ROSTER, ROUND_NAMES, SIGNATURES, SIGNATURE_OF, SLOTS, SLOT_COST, SLOT_LABEL, STYLE_KIT, STYLE_ORDER, TIERS, TIER_ORDER, YOU } from '../config.js';
import { isDesktop } from '../render/scene.js';
import { setBoardText } from '../render/table.js';
import { VENUE_OF_TIER, drawBanners, drawScreens, setAttendance, setVenue, venueFor } from '../render/venues.js';
import { ai2Racket, aiRacket, allyRacket, player } from '../render/racket.js';
import { marker, setBall } from '../render/ball.js';
import { input, touchSens } from '../input.js';
import { TLOG } from '../log.js';
import { ai2, ally } from '../ai.js';
import { autoJutsu, egoGrade, kitJutsu, rankNow, resetJutsu, setYourKit, yourKit } from '../jutsu.js';
import { WATCH_SPEEDS, home, isPlaying, match, opp, rally, setHome, setOpponent, setWatchSpeed, startMatch, watchSpeed } from '../rules.js';
import { $, hideAllMenus, showMessage, store } from './hud.js';
import { attrBars, hex, playerMatch, showTourHub, tour } from '../tournament.js';
import { Sound } from '../audio.js';

/* ---------- Menus: Home (mode) → Rival → Ready (VS) → match; Tournament: Event → hub ----------
   One question per screen, and every answer is remembered (pp3d.setup), so a returning player
   taps Play again on Home (pp3d.last) or goes straight through with last time's choices. */
/** Your setup per mode. opp: a roster name, or 'random' (rolled each time you reach Ready). */
export const quick = { level: 'easy', opp: 'random' };
export const practice = { level: 'easy', opp: 'random', refill: true, cpuJutsu: true };
export const duo = { level: 'easy', styles: null };   // styles: the two CPUs, rolled on the Ready screen
export let selTier = 'pro', uiMode = 'quick';
let rival = null;   // the roster entry you face in 1v1 / Practice (shown on Ready)
export const rosterBy = name => ROSTER.find(e => e.name === name) || null;
const sigOf = e => (SIGNATURE_OF[e.name] ? SIGNATURES[SIGNATURE_OF[e.name]] : null);
const setupOf = mode => (mode === 'practice' ? practice : quick);
const MODE_LABEL = { practice: 'Practice', quick: '1v1', duo: '2v2', tour: 'Tournament' };
const saveSetup = () => store.set('pp3d.setup', { quick, practice, duo: { level: duo.level }, tier: selTier });

/** A row of choice buttons (one selected). */
function buildChoices(wrapId, keys, render, isSel, onPick) {
  const wrap = $(wrapId);
  wrap.innerHTML = '';
  for (const key of keys) {
    const b = document.createElement('button');
    b.className = 'level-btn' + (isSel(key) ? ' sel' : '');
    b.dataset.key = key;
    b.innerHTML = render(key);
    b.addEventListener('click', () => {
      onPick(key);
      wrap.querySelectorAll('.level-btn').forEach(x => x.classList.toggle('sel', x === b));
    });
    wrap.appendChild(b);
  }
}
/** A segmented toggle (one selected); rebuilding it replaces its handler. */
function buildSeg(wrapId, keys, render, sel, onPick) {
  const wrap = $(wrapId);
  wrap.innerHTML = keys.map(k => `<button data-key="${k}"${k === sel ? ' class="sel"' : ''}>${render(k)}</button>`).join('');
  wrap.onclick = e => {
    const b = e.target.closest('button[data-key]');
    if (!b) return;
    onPick(b.dataset.key);
    wrap.querySelectorAll('button').forEach(x => x.classList.toggle('sel', x === b));
  };
}
/** Your jutsu picker: your 3 jutsu as one row of chips; tap one to open its swaps (the other jutsu
 *  of its cost, with what each does), tap a swap to take it. */
export let kitOpen = -1;
export function showKit() {
  const chips = yourKit.map((id, i) => `<button class="level-btn${kitOpen === i ? ' sel' : ''}" data-slot="${i}">`
    + `<b>${JUTSU[id].name}</b><small>${'●'.repeat(SLOT_COST[SLOTS[i]])}</small><i class="kit-angle">${JUTSU_ANGLE[JUTSU[id].angle].label}</i></button>`).join('');
  const open = kitOpen >= 0 ? yourKit[kitOpen] : null;
  const swaps = open ? `<div class="kit-swap">${JUTSU_POOL[SLOTS[kitOpen]].filter(id => id !== open).map(id =>
    `<button class="level-btn" data-slot="${kitOpen}" data-id="${id}"><i class="kit-angle">${JUTSU_ANGLE[JUTSU[id].angle].label}</i><b>${JUTSU[id].name}</b><small>${JUTSU_TIP[id]}</small></button>`).join('')}</div>` : '';
  const tip = open && `<p class="kit-tip"><b>${JUTSU[open].name}</b> · ${JUTSU_ANGLE[JUTSU[open].angle].label}, ${JUTSU_ANGLE[JUTSU[open].angle].blurb}: ${JUTSU_TIP[open]}</p>`;
  $('kit').innerHTML = `<div class="kit-chips">${chips}</div>` + (tip || '') + swaps;
}
$('kit').addEventListener('click', e => {
  const b = e.target.closest('button[data-slot]');
  if (!b) return;
  const i = +b.dataset.slot;
  if (b.dataset.id) { yourKit[i] = b.dataset.id; store.set('pp3d.kit', yourKit); kitOpen = -1; }
  else kitOpen = kitOpen === i ? -1 : i;
  showKit();
});
export function buildMenus() {
  const saved = store.get('pp3d.kit', null);
  if (Array.isArray(saved) && SLOTS.every((slot, i) => JUTSU_POOL[slot].includes(saved[i]))) setYourKit([...saved]);
  kitOpen = -1;
  showKit();
  buildSeg('speeds', Object.keys(GAME.speeds), k => `${GAME.speeds[k].label}<small>${Math.round(GAME.speeds[k].scale * 100)}%</small>`,
    match.speedKey, k => { match.speedKey = k; store.set('pp3d.speed', k); });
}

/** The menu screens (one shows at a time) and Back: Ready → Rival → Home; Event → hub or Home. */
const SCREENS = ['menu-start', 'menu-pick', 'menu-ready', 'menu-event'];
export let screen = 'menu-start';
function showScreen(id) {
  hideAllMenus();
  screen = id;
  $(id).classList.remove('hidden');
  $(id).querySelector('.card').scrollTop = 0;
}
export function back() {
  if (screen === 'menu-ready' && uiMode !== 'duo') return showPick();
  if (screen === 'menu-event' && tour && !tour.done) return showTourHub();
  showHome();
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));

/** Play again on Home: the last 1v1 / 2v2 / Practice you started, in one tap (skips Ready). */
function lastSetup() {
  const l = store.get('pp3d.last', null);
  if (!l || !['practice', 'quick', 'duo'].includes(l.mode) || !LEVEL_ORDER.includes(l.level)) return null;
  const e = l.mode === 'duo' ? null : rosterBy(l.opp);
  if (l.mode !== 'duo' && !e) return null;
  return { ...l, e, text: [MODE_LABEL[l.mode], e ? `${e.flag} ${e.short}` : 'vs 2 CPUs', AI_LEVELS[l.level].label].join(' · ') };
}
const rememberLast = (mode, e, level) => store.set('pp3d.last', { mode, opp: e ? e.name : null, level });

function showHome() {
  duo.styles = null;
  menuVenue('arena');
  drawBanners();
  $('rank-badge').textContent = `EGO RANK #${rankNow()}`;
  const last = lastSetup();
  $('btn-again-last').classList.toggle('hidden', !last);
  if (last) $('again-txt').textContent = last.text;
  const live = tour && !tour.done;
  let t = '16 players · knockout';
  if (live && tour.lostIn != null) t = `You're out · watch the ${ROUND_NAMES[tour.round]}`;
  else if (live) { const m = playerMatch(), e = tour.entrants[m.a === YOU ? m.b : m.a]; t = `Continue · ${ROUND_NAMES[tour.round]} vs ${e.flag} ${e.short}`; }
  $('tour-tile').textContent = t;
  showScreen('menu-start');
}
$('btn-again-last').addEventListener('click', () => {
  const l = lastSetup();
  if (!l) return;
  uiMode = l.mode;
  if (l.mode === 'duo') { duo.level = l.level; return startDuo(); }
  setupOf(l.mode).level = l.level;
  rival = l.e;
  if (l.mode === 'practice') startPractice(); else startQuick();
});
document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
  uiMode = b.dataset.mode;
  if (uiMode === 'tour') return tour && !tour.done ? showTourHub() : showEvent();
  if (uiMode === 'duo') return showReady();
  showPick();
}));

/** Rival: the roster by style (★ = a signature shot), Random, and the level. Tap a player to
 *  pick them; tap them again (or Next) to go on. */
export function showPick() {
  const s = setupOf(uiMode);
  menuVenue(venueFor(uiMode), BOARD_OF_MODE[uiMode]);
  $('pick-mode').textContent = MODE_LABEL[uiMode];
  const tile = (key, inner, cls = '', color = '') => `<button class="rtile${cls}${s.opp === key ? ' sel' : ''}" data-opp="${key}"${color ? ` style="--tc:${color}"` : ''}>${inner}</button>`;
  $('roster').innerHTML = tile('random', '<span class="nm">Random rival</span>', ' rand')
    + STYLE_ORDER.map(st => `<div class="rgroup"><div class="row-label"><span>${AI_STYLES[st].label}</span><em>${AI_STYLES[st].tag}</em></div><div class="rgrid">`
      + ROSTER.filter(e => e.style === st).map(e => tile(e.name,
        `<span class="fl">${e.flag}</span><span class="nm">${e.short}</span>${sigOf(e) ? '<span class="star" title="Signature shot">★</span>' : ''}`, '', hex(e.color))).join('')
      + '</div></div>').join('')
    + '<p class="roster-note">★ has a signature shot</p>';
  buildSeg('pick-levels', LEVEL_ORDER, k => `${AI_LEVELS[k].label}<small>${LEVEL_BLURB[k]}</small>`, s.level, k => { s.level = k; saveSetup(); });
  syncPickNext();
  showScreen('menu-pick');
}
function syncPickNext() {
  const e = rosterBy(setupOf(uiMode).opp);
  $('btn-pick-next').textContent = e ? `Next · ${e.flag} ${e.short}` : 'Next · Random';
}
$('roster').addEventListener('click', ev => {
  const b = ev.target.closest('[data-opp]'), s = setupOf(uiMode);
  if (!b) return;
  if (s.opp === b.dataset.opp) return showReady();
  s.opp = b.dataset.opp;
  saveSetup();
  $('roster').querySelectorAll('.rtile').forEach(x => x.classList.toggle('sel', x === b));
  syncPickNext();
});
$('btn-pick-next').addEventListener('click', () => showReady());

/** A player's card: flag, name, style, signature (and its counter), top jutsu, level, and
 *  (the tournament's) attribute bars. */
/** The Playbook (Help): each combo (COMBO) with a mini diagram of their half of the table, seen from
 *  your end (net at the bottom): where your two strokes land, 1 then 2. */
const PLAYBOOK = [
  { name: 'Draw & Drive', how: 'Short, then a deep drive', why: 'It stepped in: caught at the table', pts: [[0.1, 0.3, '1'], [-0.5, 1.15, '2']] },
  { name: 'Run Around', how: 'Wide, then the other wide', why: 'It drifted back: stretched, it errs', pts: [[-0.6, 0.9, '1'], [0.6, 0.95, '2']] },
  { name: 'Change Up', how: 'Soft ↔ fast (block, push, brush ↔ drive)', why: 'Its timing breaks', pts: [[-0.1, 0.75, 's'], [0.35, 1.15, 'F']] },
  { name: 'Set & Kill', how: 'Sidespin, then smash the pop-up', why: 'The spin floats it up: a safe smash', pts: [[0.45, 0.9, '↺'], [-0.35, 1.05, '★']] },
  { name: 'Careful', how: 'Same stroke, same place, 3×', why: 'It reads you and gets there early', pts: [[0.4, 1.0, '3×']] },
];
function playbookRow(c) {
  const X = x => 32 + x / 0.76 * 26, Y = d => 44 - d / 1.37 * 38;
  const dots = c.pts.map(([x, d, t], i) => `<circle cx="${X(x)}" cy="${Y(d)}" r="6" fill="${i ? '#ffd23f' : '#6fe3ff'}"/><text x="${X(x)}" y="${Y(d) + 3}" font-size="8" font-weight="800" text-anchor="middle" fill="#111">${t}</text>`).join('');
  const line = c.pts.length > 1 ? `<path d="M${X(c.pts[0][0])} ${Y(c.pts[0][1])} L${X(c.pts[1][0])} ${Y(c.pts[1][1])}" stroke="rgba(255,255,255,.45)" stroke-dasharray="2 2"/>` : '';
  return `<div><svg width="64" height="48" viewBox="0 0 64 48" aria-hidden="true"><rect x="6" y="6" width="52" height="38" rx="2" fill="#1d4f91" stroke="#fff" stroke-width="1"/><line x1="32" y1="6" x2="32" y2="44" stroke="#fff" stroke-width=".5"/><line x1="3" y1="44" x2="61" y2="44" stroke="#ddd" stroke-width="2"/>${line}${dots}</svg>
    <span><b>${c.name}</b> · ${c.how}<br><small>${c.why}</small></span></div>`;
}

export function oppCard(e, eyebrow, bars = true) {
  const st = AI_STYLES[e.style], sg = sigOf(e);
  return `<div class="opp" style="--opp:${hex(e.color)}"><div class="opp-flag">${e.flag}</div><div style="min-width:0">
    <div class="eyebrow">${eyebrow}</div>
    <div class="opp-name">${e.name} <i>“${e.nick}”</i></div>
    <span class="chip style">${st.label}</span>${sg ? `<span class="chip sig">★ ${sg.name}</span>` : ''}<span class="chip">${JUTSU[STYLE_KIT[e.style][2]].name}</span><span class="chip">${AI_LEVELS[e.level].label}</span>
    <p><b>Weak to:</b> ${st.weakTo} · <b>Punishes:</b> ${st.punishes}</p>${sg ? `<p><b>★ ${sg.name}:</b> ${sg.counter.toLowerCase()}.</p>` : ''}
    ${bars ? `<div class="attrs">${attrBars(e)}</div>` : ''}</div></div>`;
}

/** Ready (VS): you vs them, your jutsu (tap to swap), the mode's few options, Start. */
function showReady(roll = true) {
  const mode = uiMode, d = mode === 'duo', s = d ? duo : setupOf(mode);
  menuVenue(venueFor(mode), BOARD_OF_MODE[mode]);
  if (roll && !d) rival = (s.opp !== 'random' && rosterBy(s.opp)) || ROSTER[Math.floor(Math.random() * ROSTER.length)];
  if (d && !duo.styles) duo.styles = [...STYLE_ORDER].sort(() => Math.random() - 0.5).slice(0, 2);
  $('ready-mode').textContent = MODE_LABEL[mode];
  const side = (cls, c, small, big) => `<div class="vs-side ${cls}" style="--c:${c}"><small>${small}</small><b>${big}</b></div>`;
  $('ready-vs').innerHTML = side('you', hex(COLORS.player), `Ego #${rankNow()}`, d ? 'You + Ally' : 'YOU')
    + '<div class="vs-mark">VS</div>'
    + (d ? side('them', hex(COLORS.ai), AI_LEVELS[duo.level].label, 'CPU ×2')
      : side('them', hex(rival.color), AI_LEVELS[s.level].label, `${rival.flag} ${rival.short}`));
  if (d) {
    $('ready-them').innerHTML = `<div class="row-label">Opponents</div><div class="duo-team">${duo.styles.map(st =>
      `<span class="chip style">CPU · ${AI_STYLES[st].label}</span>`).join('')}<button class="btn alt reroll" id="btn-reroll">Re-roll</button></div>
      <div class="row-label">Level</div><div class="seg" id="duo-levels" style="margin-bottom:14px"></div>`;
    buildSeg('duo-levels', LEVEL_ORDER, k => `${AI_LEVELS[k].label}<small>${LEVEL_BLURB[k]}</small>`, duo.level, k => { duo.level = k; saveSetup(); showReady(false); });
    $('btn-reroll').addEventListener('click', () => { duo.styles = null; showReady(false); });
  } else {
    $('ready-them').innerHTML = oppCard({ ...rival, level: s.level }, s.opp === 'random' ? 'Random rival' : mode === 'practice' ? 'Practice partner' : 'Your rival', false);
  }
  $('ready-extra').innerHTML = mode !== 'practice' ? '' : `<div class="set-sec" style="margin:14px 0 4px">
    <div class="set-row"><span>Seals refill every point</span><button class="btn alt" data-pr="refill" aria-pressed="${practice.refill}">${practice.refill ? 'On' : 'Off'}</button></div>
    <div class="set-row" style="margin-top:8px"><span>CPU uses jutsu</span><button class="btn alt" data-pr="cpuJutsu" aria-pressed="${practice.cpuJutsu}">${practice.cpuJutsu ? 'On' : 'Off'}</button></div></div>`;
  $('ready-rules').textContent = mode === 'practice' ? 'No score limit · no rank change · leave from the pause menu'
    : d ? 'Best of 3 · first to 11 · partners take turns, serve diagonal' : 'Best of 3 · first to 11, win by 2';
  $('btn-go').textContent = mode === 'practice' ? 'Start Practice' : 'Start Match';
  kitOpen = -1;
  showKit();
  $('ready-kit').appendChild($('kit-box'));
  showScreen('menu-ready');
}
$('ready-extra').addEventListener('click', e => {
  const b = e.target.closest('[data-pr]');
  if (!b) return;
  practice[b.dataset.pr] = !practice[b.dataset.pr];
  saveSetup();
  b.textContent = practice[b.dataset.pr] ? 'On' : 'Off';
  b.setAttribute('aria-pressed', String(practice[b.dataset.pr]));
});
$('btn-go').addEventListener('click', () => (uiMode === 'practice' ? startPractice() : uiMode === 'duo' ? startDuo() : startQuick()));

/** Tournament: choose an event (a run in progress skips this: its tile opens the hub). */
export function showEvent() {
  const titles = store.get('pp3d.titles', {}), live = tour && !tour.done;
  buildChoices('tiers', TIER_ORDER, k => `<b>${TIERS[k].label}</b><small>${TIERS[k].blurb} · ${TIERS[k].fans.toLocaleString()} fans${titles[k] ? ` · ${titles[k]} title${titles[k] > 1 ? 's' : ''}` : ''}</small>`,
    k => k === selTier, k => { selTier = k; saveSetup(); menuVenue(VENUE_OF_TIER[k], TIERS[k].label); });
  menuVenue(VENUE_OF_TIER[selTier], TIERS[selTier].label);
  $('tour-saved').classList.toggle('hidden', !live);
  if (live) $('tour-saved').innerHTML = `Entering a new one ends your <b>${TIERS[tour.tier].label}</b> run.`;
  $('btn-tour-new').textContent = live ? 'Start a New Tournament' : 'Enter Tournament';
  showScreen('menu-event');
}

/** The venue behind a menu screen (its big screens show the title). */
export function menuVenue(key, board = 'Open') { setVenue(key); setBoardText(board); drawScreens(); }
const BOARD_OF_MODE = { practice: 'Practice', duo: 'Doubles' };

/** Back to the attract mode (ball bouncing, camera orbiting) behind a menu. */
export function enterMenuState() {
  hideAllMenus();
  match.state = 'menu';
  match.paused = false;
  rally.live = false;
  marker.visible = false;
  match.doubles = false;
  allyRacket.mesh.visible = ai2Racket.mesh.visible = false;
  for (const r of [player, aiRacket]) r.setGhost(false);
  resetJutsu();
  $('topbar').classList.add('hidden');
  setBall({ x: 0, y: 1.3, z: 0.5 });
}
export function showStartMenu() {
  enterMenuState();
  buildMenus();
  setAttendance(0.35);
  setBoardText('Open');
  showHome();
}

/** 1v1 vs a roster player (rival) at your level. */
export function startQuick() {
  Sound.init();
  if (!rival) rival = rosterBy(quick.opp) || ROSTER[0];
  match.mode = 'quick';
  match.watch = null;
  match.doubles = false;
  setHome(null);
  match.gamesToWin = 2;
  setOpponent({ ...rival, level: quick.level });
  rememberLast('quick', rival, quick.level);
  startMatch();
}
/** Practice: a 1v1 that never ends (games roll on; no rank, no grade). Your seals can refill
 *  every point (practice.refill) and the CPU's jutsu can be turned off (practice.cpuJutsu). */
function startPractice() {
  Sound.init();
  if (!rival) rival = rosterBy(practice.opp) || ROSTER[0];
  match.mode = 'practice';
  match.watch = null;
  match.doubles = false;
  setHome(null);
  match.gamesToWin = Infinity;
  setOpponent({ ...rival, level: practice.level });
  rememberLast('practice', rival, practice.level);
  startMatch();
}

/** 2v2: you + a CPU ally (all-rounder) vs two CPUs of the chosen level with different styles. */
export function startDuo() {
  Sound.init();
  match.mode = 'duo';
  match.watch = null;
  match.doubles = true;
  setHome(null);
  match.gamesToWin = 2;
  const [s1, s2] = duo.styles || [...STYLE_ORDER].sort(() => Math.random() - 0.5);
  setOpponent({ name: 'CPU', short: 'CPU', color: COLORS.ai, level: duo.level, style: s1 });
  Object.assign(ai2, { level: duo.level, style: s2, name: '' });
  Object.assign(ally, { level: duo.level, style: 'allround', name: '' });
  ai2Racket.setColor(COLORS.ai2);
  rememberLast('duo', null, duo.level);
  startMatch();
}

/** HUD overlays — How to play (?) and Settings (⚙): the game waits while one is open. They also
 *  open from Home (nothing to pause there). */
const OVERLAYS = ['menu-help', 'menu-settings'];
export const openOverlay = () => OVERLAYS.find(id => !$(id).classList.contains('hidden'));
let overlayPaused = false;
export function showOverlay(id) {
  const inMenu = match.state === 'menu';
  if (openOverlay() || (!inMenu && (!isPlaying() || !$('menu-pause').classList.contains('hidden')))) return;
  if (id === 'menu-help') $('help-combos').innerHTML = PLAYBOOK.map(playbookRow).join('');
  if (id === 'menu-help') $('help-kit').innerHTML = SLOTS.map((slot, i) => `<div><kbd>${SLOT_LABEL[slot]} ${'●'.repeat(SLOT_COST[slot])}</kbd><span class="j">${JUTSU[inMenu ? yourKit[i] : kitJutsu('player', slot)].name}</span></div>`).join('')
    + `<div><kbd>${isDesktop ? 'Keys 1–3' : 'Tap the list'}</kbd><span>Pick a smaller one</span></div>`;
  if (!inMenu) {
    overlayPaused = !match.paused;
    match.paused = true;
    input.charging = false;
  }
  $(id).classList.remove('hidden');
}
export function hideOverlay() {
  const id = openOverlay();
  if (id) $(id).classList.add('hidden');
  if (overlayPaused) match.paused = false;
  overlayPaused = false;
}
export function syncSettings() {
  $('btn-auto').textContent = autoJutsu ? 'On' : 'Off';
  $('btn-auto').setAttribute('aria-pressed', String(autoJutsu));
  $('btn-mute').textContent = Sound.muted ? 'Off' : 'On';
  $('btn-mute').setAttribute('aria-pressed', String(!Sound.muted));
  $('sens').value = touchSens.value;
  $('sens-val').textContent = touchSens.mult.toFixed(2).replace(/0$/, '') + '×';
}

export function togglePause() {
  if (!isPlaying()) return;
  if (openOverlay()) return hideOverlay();
  match.paused = !match.paused;
  input.charging = false;
  const who = match.doubles ? 'CPU ×2' : `${opp.flag} ${opp.short}`.trim();
  $('pause-info').textContent = `${match.watch ? `${home.short} vs ` : 'vs '}${who} · Game ${match.games[0] + match.games[1] + 1} · ${match.points[0]}–${match.points[1]}`;
  $('btn-quit').textContent = match.mode === 'tour' ? 'Leave Match' : match.mode === 'practice' ? 'End Practice' : 'Main Menu';
  $('menu-pause').classList.toggle('hidden', !match.paused);
  syncPauseButton();
  syncLogTools();
}
/** The play log's tools (?log): what you're trying this match, and Share / Copy / Clear. */
const LOG_TRY = [['normal', 'Just playing'], ['smash', 'Smashing'], ['block', 'Blocking'], ['chop', 'Chopping'], ['spin', 'Spin'], ['mixed', 'Mixing it up']];
function syncLogTools() {
  for (const el of document.querySelectorAll('.tlog-tools')) {
    el.classList.toggle('hidden', !TLOG.on);
    if (!TLOG.on) continue;
    const n = TLOG.count(), kb = Math.round(TLOG.json().length / 1024);
    el.innerHTML = `<p class="sub">Play log · ${n} point${n === 1 ? '' : 's'} · ${kb} KB</p>
      <p class="sub">I'm trying: <select data-log="try">${LOG_TRY.map(([k, t]) => `<option value="${k}"${k === TLOG.trying ? ' selected' : ''}>${t}</option>`).join('')}</select></p>
      <button class="btn" data-log="share">Share log</button><button class="btn alt" data-log="copy">Copy</button><button class="btn alt" data-log="clear">Clear</button>`;
  }
}
async function logAction(what, btn) {
  const text = TLOG.json(), name = `pingpong-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  const say = t => { btn.textContent = t; setTimeout(syncLogTools, 1600); };
  try {
    if (what === 'share') {
      const file = new File([text], name, { type: 'application/json' }), txt = new File([text], name.replace('.json', '.txt'), { type: 'text/plain' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title: 'Ping pong log' });
      else if (navigator.canShare && navigator.canShare({ files: [txt] })) await navigator.share({ files: [txt], title: 'Ping pong log' });
      else {   // no share sheet (desktop): download it
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
      say('Shared ✓');
    } else if (what === 'copy') {
      await navigator.clipboard.writeText(text);
      say('Copied ✓');
    } else if (what === 'clear') {
      if (btn.dataset.sure) { TLOG.clear(); say('Cleared'); } else { btn.dataset.sure = 1; btn.textContent = 'Sure? Tap again'; }
    }
  } catch (e) { if (e && e.name !== 'AbortError') say('Failed: ' + (e && e.message || e)); }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-log]'); if (b && b.tagName === 'BUTTON') logAction(b.dataset.log, b); });
document.addEventListener('change', e => { const t = e.target.closest('[data-log="try"]'); if (t) TLOG.setTrying(t.value); });
export function syncFastForward() { $('btn-ff').textContent = `${watchSpeed}×`; }
export function cycleFastForward() {
  setWatchSpeed(WATCH_SPEEDS[(WATCH_SPEEDS.indexOf(watchSpeed) + 1) % WATCH_SPEEDS.length]);
  store.set('pp3d.watchSpeed', watchSpeed);
  syncFastForward();
  showMessage(watchSpeed === 1 ? 'Normal speed' : `⏩ ${watchSpeed}× speed`, '', 'neutral', 0.8, 3);
}
/** The pause button shows ▶ while paused (it resumes), ❚❚ while playing. */
export function syncPauseButton() {
  $('icon-pause').style.display = match.paused ? 'none' : '';
  $('icon-play').style.display = match.paused ? '' : 'none';
  $('btn-pause').setAttribute('aria-label', match.paused ? 'Resume' : 'Pause');
}

export function showEndMenu(winner) {
  syncLogTools();
  const s = match.stats, lvl = LEVEL_ORDER.indexOf(match.levelKey), o = match.doubles ? 'CPU' : opp.short, won = winner === 'player';
  const games = `${match.games[0]} – ${match.games[1]}`, detail = match.gameScores.join(', ');
  const tourMode = match.mode === 'tour';
  if (match.watch) {
    const w = won ? home : opp;
    $('end-title').textContent = `${w.flag} ${w.short} wins`;
    $('end-sub').textContent = `${ROUND_NAMES[match.watch.r]} · ${detail}`;
    $('end-stats').innerHTML = [
      ['Points', `${s.pointsWon[0]} – ${s.pointsWon[1]}`],
      ['Longest rally', s.longestRally],
      ['Fastest', `${Math.round(s.fastest)} km/h`],
    ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  } else if (tourMode) {
    const r = tour.round, round = ROUND_NAMES[tour.lostIn ?? (tour.done ? FINAL : r - 1)], tier = TIERS[tour.tier];
    if (won && tour.done) {
      $('end-title').textContent = `🏆 ${tier.label} Champion!`;
      confetti();
    } else if (won) {
      $('end-title').textContent = `✅ ${round} won`;
    } else {
      $('end-title').textContent = `Out in the ${round}`;
    }
    $('end-sub').textContent = `vs ${opp.flag} ${opp.short} · ${detail}`;
  } else {
    $('end-title').textContent = won ? '🏆 You win!' : match.doubles ? 'CPUs win' : `${opp.flag} ${opp.short} wins`;
    $('end-sub').textContent = `${match.doubles ? '' : `vs ${opp.flag} ${opp.short} · `}${games} · ${detail}`;
    if (won && match.levelKey === 'hard') confetti();
  }
  // Ego grade and rank (your matches only).
  const grade = $('end-grade'), rank = $('end-rank'), mv = match.rankMove;
  grade.classList.toggle('hidden', !!match.watch);
  rank.classList.toggle('hidden', !mv);
  if (!match.watch) { const g = egoGrade(won); grade.textContent = g; grade.className = `grade ${g}`; }
  if (mv) {
    const d = mv.before - mv.after;
    rank.textContent = `EGO RANK #${mv.after}${d > 0 ? `  ▲${d}` : d < 0 ? `  ▼${-d}` : ''}`;
  }
  const rows = [
    ['Points', `${s.pointsWon[0]} – ${s.pointsWon[1]}`],
    ['Winners / errors', `${s.winners} / ${s.errors}`],
    ['Jutsu · counters', `${s.jutsu} · ${s.counters}`],
    ['Smashes · spin errors forced', `${s.smashes} · ${s.spinWins}`],
    ['Longest rally', s.longestRally],
    ['Fastest', `${Math.round(s.fastest)} km/h`],
  ];
  if (!match.watch) $('end-stats').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  $('btn-continue').classList.toggle('hidden', !tourMode);
  $('btn-again').classList.toggle('hidden', tourMode);
  const next = $('btn-next');
  next.classList.toggle('hidden', tourMode);
  $('btn-rival').classList.toggle('hidden', match.mode !== 'quick');
  next.disabled = lvl >= LEVEL_ORDER.length - 1;
  next.textContent = next.disabled ? 'Max Level' : `Next: ${AI_LEVELS[LEVEL_ORDER[lvl + 1]].label}`;
  $('topbar').classList.add('hidden');
  $('menu-end').classList.remove('hidden');
}

function confetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('confetti'), colors = ['#ffd23f', '#ff4d5e', '#57e389', '#3d8bff', '#ffffff'];
  for (let i = 0; i < 140; i++) {
    const c = document.createElement('i');
    c.style.left = rand(0, 100) + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.setProperty('--dx', rand(-20, 20) + 'vw');
    c.style.setProperty('--r', rand(-720, 720) + 'deg');
    c.style.animationDuration = rand(2.5, 5) + 's';
    c.style.animationDelay = rand(0, 1.2) + 's';
    box.appendChild(c);
  }
  setTimeout(() => { box.innerHTML = ''; }, 7000);
}

// Setters for the bindings other modules assign (an imported binding is read-only).
export function setSelTier(v) { return (selTier = v); }
export function setUiMode(v) { return (uiMode = v); }
export function setKitOpen(v) { return (kitOpen = v); }
