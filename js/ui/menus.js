// Menu screens and overlays: home, rival pick, ready, pause, settings, end of match.
import { rand } from '../util.js';
import { AI_LEVELS, AI_STYLES, COLORS, COMBO_NAMES, DRILLS, FINAL, GAME, JUTSU, JUTSU_ANGLE, JUTSU_POOL, JUTSU_TIP, LEVEL_BLURB, LEVEL_ORDER, ROSTER, ROUND_NAMES, SIGNATURES, SIGNATURE_OF, SLOTS, SLOT_COST, SLOT_LABEL, STYLE_KIT, STYLE_ORDER, TIERS, TIER_ORDER, YOU } from '../config.js';
import { isDesktop } from '../render/scene.js';
import { setBoardText } from '../render/table.js';
import { VENUE_OF_TIER, drawBanners, drawScreens, setAttendance, setVenue } from '../render/venues.js';
import { setTableOfVenue } from '../tables.js';
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

/* ---------- Menus: Home (mode) → Ready (VS) → match; Tournament: Event → hub ----------
   Every answer is remembered (pp3d.setup), so Ready opens with last time's choices filled in:
   tap who you face (the rival, your ally, a CPU) to change them in a sheet, or just Start.
   A returning player can also tap Play again on Home (pp3d.last) and skip Ready. */
/** Your setup per mode. opp: a roster name, or 'random' (rolled each time you reach Ready). */
export const quick = { level: 'easy', opp: 'random', venue: 'arena' };
export const practice = { level: 'easy', opp: 'random', refill: true, cpuJutsu: true, venue: 'arena' };
export const duo = { level: 'easy', opps: null, ally: 'Sun Yingsha', venue: 'arena' };   // opps: the two you face (roster names), rolled on the Ready screen · ally: your partner (a roster name)
export let selTier = 'pro', uiMode = 'quick';
let rival = null;   // the roster entry you face in 1v1 / Practice (shown on Ready)
export const rosterBy = name => ROSTER.find(e => e.name === name) || null;
/** A roster player or, in Practice, a drill partner (DRILLS). */
const partnerBy = (name, mode) => rosterBy(name) || (mode === 'practice' && DRILLS.find(e => e.name === name)) || null;
const sigOf = e => (SIGNATURE_OF[e.name] ? SIGNATURES[SIGNATURE_OF[e.name]] : null);
const setupOf = mode => (mode === 'practice' ? practice : quick);
const MODE_LABEL = { practice: 'Practice', quick: '1v1', duo: '2v2', tour: 'Tournament' };
const saveSetup = () => store.set('pp3d.setup', { quick, practice, duo: { level: duo.level, ally: duo.ally, venue: duo.venue }, tier: selTier });
/** Where a 1v1, 2v2 or Practice is played: the venue brings its table (TABLES). Practice starts on
 *  the standard table, so it plays like a quick match until you pick another (to learn the wind,
 *  say). The tournament's venue comes with its event. */
export const VENUE_PICKS = ['arena', 'park', 'gym', 'stadium'];
const VENUE_PICK = { arena: ['Arena', 'Standard'], park: ['Park', 'Wind'], gym: ['Club', 'Low, skids'], stadium: ['Pro', 'Sits up'] };
const pickedVenue = mode => (mode === 'duo' ? duo : setupOf(mode)).venue;

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
  if (Array.isArray(saved)) setYourKit(SLOTS.map((slot, i) => (JUTSU_POOL[slot].includes(saved[i]) ? saved[i] : yourKit[i])));   // (a jutsu no longer in its pool: the default)
  kitOpen = -1;
  showKit();
  buildSeg('speeds', Object.keys(GAME.speeds), k => `${GAME.speeds[k].label}<small>${Math.round(GAME.speeds[k].scale * 100)}%</small>`,
    match.speedKey, k => { match.speedKey = k; store.set('pp3d.speed', k); });
}

/** The menu screens (one shows at a time) and Back: an open sheet closes; Ready → Home; Event → hub or Home. */
const SCREENS = ['menu-start', 'menu-ready', 'menu-event'];
export let screen = 'menu-start';
function showScreen(id) {
  hideAllMenus();
  screen = id;
  $(id).classList.remove('hidden');
  $(id).querySelector('.card').scrollTop = 0;
}
export function back() {
  if (sheetOpen()) return closeSheet();
  if (screen === 'menu-event' && tour && !tour.done) return showTourHub();
  showHome();
}
document.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', back));

/** Play again on Home: the last 1v1 / 2v2 / Practice you started, in one tap (skips Ready). */
function lastSetup() {
  const l = store.get('pp3d.last', null);
  if (!l || !['practice', 'quick', 'duo'].includes(l.mode) || !LEVEL_ORDER.includes(l.level)) return null;
  const e = l.mode === 'duo' ? null : partnerBy(l.opp, l.mode);
  if (l.mode !== 'duo' && !e) return null;
  const a = l.mode === 'duo' && rosterBy(duo.ally);
  return { ...l, e, text: [MODE_LABEL[l.mode], e ? `${e.flag} ${e.short}` : a ? `with ${a.flag} ${a.short}` : 'vs 2 CPUs', AI_LEVELS[l.level].label].join(' · ') };
}
const rememberLast = (mode, e, level) => store.set('pp3d.last', { mode, opp: e ? e.name : null, level });

function showHome() {
  duo.opps = null;
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
  showReady();
}));

/** The Playbook (Help): each combo (COMBO) as a recipe — shot 1, shot 2 (in the words of the
 *  Strokes list), what it does to the CPU's next ball, and the styles weak to it (AI_STYLES.weak).
 *  Then the one thing to avoid: the same shot 3× (COMBO.read). */
const PLAYBOOK = [
  { id: 'drawDrive', steps: [['Short', 'let go over the table: it lands near the net'], ['Deep drive', 'swipe ↑ to their end line']], then: 'Caught at the net: it reacts late and moves slowly' },
  { id: 'runAround', steps: [['Wide', 'to one side'], ['Wide', 'to the other side']], then: 'It has to run: more errors, weaker return' },
  { id: 'changeUp', steps: [['Slow', 'let go, or pull ↓'], ['Fast', 'swipe ↑ (or fast first, then slow)']], then: 'Its timing breaks: more errors' },
  { id: 'setKill', steps: [['Sidespin', 'flick ↔'], ['Smash', 'flick ↑ fast if it floats one back up']], then: 'Your safest smash' },
];
function playbookRow(c) {
  const weak = STYLE_ORDER.filter(st => AI_STYLES[st].weak && AI_STYLES[st].weak[c.id]).map(st => AI_STYLES[st].label).join(' · ');
  const step = ([what, how], i) => `<div class="pb-step"><i>${i + 1}</i><b>${what}</b><small>${how}</small></div>`;
  return `<div class="pb"><div class="pb-head"><b>${COMBO_NAMES[c.id]}</b>${weak ? `<em>best vs ${weak}</em>` : ''}</div>
    <div class="pb-steps">${step(c.steps[0], 0)}<span class="pb-arr" aria-hidden="true">→</span>${step(c.steps[1], 1)}</div>
    <p class="pb-then">${c.then}</p></div>`;
}
const playbookHtml = () => '<p class="pb-intro">Two of your shots in a row, in the same rally. No button: play them and the CPU\'s next ball gets worse. A smash or a jutsu in between starts over.</p>'
  + PLAYBOOK.map(playbookRow).join('')
  + '<div class="pb pb-avoid"><div class="pb-head"><b>Avoid</b></div><p class="pb-then">The same shot to the same spot 3× in a row: it reads you and gets there early.</p></div>';

/** A player's card: flag, name, style, signature (and its counter), top jutsu, level, and
 *  (the tournament's) attribute bars. */
export function oppCard(e, eyebrow, bars = true, mate = false) {   // mate: your 2v2 partner (what it does, not how to beat it; no jutsu: you spend the team's seals)
  const st = AI_STYLES[e.style], sg = sigOf(e);
  return `<div class="opp" style="--opp:${hex(e.color)}"><div class="opp-flag">${e.flag}</div><div style="min-width:0">
    <div class="eyebrow">${eyebrow}</div>
    <div class="opp-name">${e.name} <i>“${e.nick}”</i></div>
    <span class="chip style">${st.label}</span>${sg ? `<span class="chip sig">★ ${sg.name}</span>` : ''}${mate ? '' : `<span class="chip">${JUTSU[STYLE_KIT[e.style][2]].name}</span>`}<span class="chip">${AI_LEVELS[e.level].label}</span>
    ${mate ? `<p>${st.blurb}</p>` : st.drill ? `<p>${st.blurb}</p><p><b>Tip:</b> ${st.tip}</p>` : `<p><b>Weak to:</b> ${st.weakTo} · <b>Punishes:</b> ${st.punishes}</p>${sg ? `<p><b>★ ${sg.name}:</b> ${sg.counter.toLowerCase()}.</p>` : ''}`}
    ${bars ? `<div class="attrs">${attrBars(e)}</div>` : ''}</div></div>`;
}

/** A sheet over Ready: the roster, one tap picks and closes it (tap outside, ✕,
 *  Back or Esc closes it without a change). */
let sheetPick = null;
export const sheetOpen = () => !$('sheet').classList.contains('hidden');
function openSheet(title, html, onPick) {
  $('sheet-title').textContent = title;
  $('sheet-body').innerHTML = html;
  sheetPick = onPick;
  $('sheet').classList.remove('hidden');
  $('sheet').querySelector('.sheet-panel').scrollTop = 0;
  ($('sheet-body').querySelector('.sel') || $('sheet-close')).focus({ preventScroll: true });
}
export function closeSheet() {
  $('sheet').classList.add('hidden');
  sheetPick = null;
}
$('sheet').addEventListener('click', e => {
  if (e.target === $('sheet') || e.target.closest('#sheet-close')) return closeSheet();
  const b = e.target.closest('[data-key]'), pick = sheetPick;
  if (!b || !pick) return;
  closeSheet();
  pick(b.dataset.key);
  renderReady();
});

/** The roster by style (★ = a signature shot): `sel` highlighted, Random first if `random`, and
 *  `taken` (name → who) tagged: in 2v2, taking a player already on the table swaps them. */
function openRoster(title, sel, onPick, { random = false, taken = {}, drills = false } = {}) {
  const tile = (key, inner, cls = '', color = '') => `<button class="rtile${cls}${sel === key ? ' sel' : ''}" data-key="${key}"${color ? ` style="--tc:${color}"` : ''}>${inner}</button>`;
  const drillRow = drills ? `<div class="rgroup"><div class="row-label"><span>Drills</span><em>Practise one side of your game</em></div><div class="rgrid">`
    + DRILLS.map(e => tile(e.name, `<span class="fl">${e.flag}</span><span class="nm">${e.short}</span><span class="drill">${AI_STYLES[e.style].drill === 'attack' ? 'you attack' : 'you defend'}</span>`, '', hex(e.color))).join('')
    + '</div></div>' : '';
  openSheet(title, (random ? tile('random', '<span class="nm">🎲 Random rival</span>', ' rand') : '') + drillRow
    + STYLE_ORDER.map(st => `<div class="rgroup"><div class="row-label"><span>${AI_STYLES[st].label}</span><em>${AI_STYLES[st].tag}</em></div><div class="rgrid">`
      + ROSTER.filter(e => e.style === st).map(e => tile(e.name,
        `<span class="fl">${e.flag}</span><span class="nm">${e.short}</span>${sigOf(e) ? '<span class="star" title="Signature shot">★</span>' : ''}`
        + (taken[e.name] ? `<span class="taken">${taken[e.name]}</span>` : ''), '', hex(e.color))).join('')
      + '</div></div>').join('')
    + `<p class="roster-note">★ has a signature shot${Object.keys(taken).length ? ' · picking someone already in swaps them' : ''}</p>`, onPick);
}
const openRival = () => {
  const s = setupOf(uiMode);
  openRoster(uiMode === 'practice' ? 'Choose your partner' : 'Choose your rival', s.opp, key => { s.opp = key; saveSetup(); rollRival(); }, { random: true, drills: uiMode === 'practice' });
};
/** 2v2: slot 0 is your ally, 1 and 2 the CPUs. */
const duoSlots = () => [duo.ally, ...duo.opps];
const SLOT_TAG = ['Ally', 'CPU 1', 'CPU 2'];
function openDuoSlot(i) {
  const names = duoSlots(), taken = {};
  names.forEach((n, j) => { if (j !== i) taken[n] = SLOT_TAG[j]; });
  openRoster(i ? `Opponent ${i}` : 'Your ally', names[i], key => {
    const j = names.indexOf(key);
    if (j >= 0 && j !== i) names[j] = names[i];   // already on the table: swap
    names[i] = key;
    [duo.ally, duo.opps[0], duo.opps[1]] = names;
    saveSetup();
  }, { taken });
}
/** 1v1 / Practice from the end of a match: Ready with the roster open. */
export function showRivalPicker() {
  showReady();
  openRival();
}

const rollRival = () => {
  const s = setupOf(uiMode);
  rival = (s.opp !== 'random' && partnerBy(s.opp, uiMode)) || ROSTER[Math.floor(Math.random() * ROSTER.length)];   // (Random: never a drill)
};
/** Two roster players for the CPU side: not your ally, and of different styles. */
function rollOpps() {
  const pool = ROSTER.filter(e => e.name !== duo.ally).sort(() => Math.random() - 0.5);
  const b = pool.find(e => e.style !== pool[0].style) || pool[1];
  return [pool[0].name, b.name];
}

/** Ready (VS): you vs them (tap them to change), the level, your jutsu (tap to swap), the mode's
 *  few options, Start. */
function showReady(roll = true) {
  const mode = uiMode;
  menuVenue(pickedVenue(mode), BOARD_OF_MODE[mode]);
  if (roll && mode !== 'duo') rollRival();
  if (mode === 'duo' && !duo.opps) duo.opps = rollOpps();
  $('ready-mode').textContent = MODE_LABEL[mode];
  renderReady();
  $('ready-extra').innerHTML = mode !== 'practice' ? '' : `<div class="set-sec" style="margin:14px 0 4px">
    <div class="set-row"><span>Seals refill every point</span><button class="btn alt" data-pr="refill" aria-pressed="${practice.refill}">${practice.refill ? 'On' : 'Off'}</button></div>
    <div class="set-row" style="margin-top:8px"><span>CPU uses jutsu</span><button class="btn alt" data-pr="cpuJutsu" aria-pressed="${practice.cpuJutsu}">${practice.cpuJutsu ? 'On' : 'Off'}</button></div></div>`;
  $('ready-rules').textContent = mode === 'practice' ? 'No score limit · no rank change · leave from the pause menu'
    : mode === 'duo' ? 'Best of 3 · first to 11 · partners take turns, serve diagonal' : 'Best of 3 · first to 11, win by 2';
  $('btn-go').textContent = mode === 'practice' ? 'Start Practice' : 'Start Match';
  kitOpen = -1;
  showKit();
  $('ready-kit').appendChild($('kit-box'));
  showScreen('menu-ready');
}
/** The part of Ready a choice changes: the VS banner and the cards (both tap to change who's in), the level. */
function renderReady() {
  const d = uiMode === 'duo', s = d ? duo : setupOf(uiMode), caret = '<span class="caret" aria-hidden="true">▾</span>';
  const side = (cls, c, small, big) => `<div class="vs-side ${cls}" style="--c:${c}"><small>${small}</small><b>${big}</b></div>`;
  const pickSide = (cls, c, act, label, small, big) => `<button class="vs-side ${cls} pick" style="--c:${c}" data-act="${act}" aria-label="${label}"><small>${small}</small><b>${big} ${caret}</b></button>`;
  const who = uiMode === 'practice' ? 'partner' : 'rival';
  const [al, o1, o2] = d ? duoSlots().map(rosterBy) : [];
  $('ready-vs').innerHTML = (d ? pickSide('you', hex(COLORS.player), 'ally', 'Change your ally', `Ego #${rankNow()}`, `You + ${al.short}`)
    : side('you', hex(COLORS.player), `Ego #${rankNow()}`, 'YOU'))
    + '<div class="vs-mark">VS</div>'
    + (d ? side('them', hex(o1.color), AI_LEVELS[duo.level].label, `${o1.short} & ${o2.short}`)
      : pickSide('them', hex(rival.color), 'rival', `Change ${who}`, AI_LEVELS[s.level].label, `${rival.flag} ${rival.short}`));
  /** Who you face (or play with): their card, tap it to change them. */
  const pickCard = (act, label, card, i = '') => `<div class="opp-pick" role="button" tabindex="0" data-act="${act}"${i !== '' ? ` data-i="${i}"` : ''} aria-label="${label}">`
    + card + '<span class="opp-change">Change ▾</span></div>';
  $('ready-them').innerHTML = (d
    ? pickCard('ally', 'Change your ally', oppCard({ ...al, level: duo.level }, 'Your ally', false, true))
      + `<div class="row-label row-flex"><span>Opponents</span><button class="reroll" data-act="reroll">🎲 Re-roll</button></div>`
      + [o1, o2].map((e, i) => pickCard('cpu', `Change opponent ${i + 1}`, oppCard({ ...e, level: duo.level }, `Opponent ${i + 1}`, false), i + 1)).join('')
    : pickCard('rival', `Change ${who}`, oppCard({ ...rival, level: s.level }, s.opp === 'random' ? 'Random rival' : uiMode === 'practice' ? 'Practice partner' : 'Your rival', false)))
    + '<div class="row-label">Level</div><div class="seg" id="ready-levels"></div>'
    + '<div class="row-label">Table</div><div class="seg" id="ready-venues"></div>';
  buildSeg('ready-levels', LEVEL_ORDER, k => `${AI_LEVELS[k].label}<small>${LEVEL_BLURB[k]}</small>`, s.level, k => { s.level = k; saveSetup(); renderReady(); });
  buildSeg('ready-venues', VENUE_PICKS, k => `${VENUE_PICK[k][0]}<small>${VENUE_PICK[k][1]}</small>`, s.venue, k => { s.venue = k; saveSetup(); menuVenue(k, BOARD_OF_MODE[uiMode]); });
}
function readyAct(b) {
  const act = b.dataset.act;
  if (act === 'rival') return openRival();
  if (act === 'ally') return openDuoSlot(0);
  if (act === 'cpu') return openDuoSlot(+b.dataset.i);
  if (act === 'reroll') { duo.opps = rollOpps(); renderReady(); }
}
for (const id of ['ready-vs', 'ready-them']) {
  $(id).addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) readyAct(b); });
  $(id).addEventListener('keydown', e => {
    const b = e.target.closest('[role=button][data-act]');
    if (b && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); readyAct(b); }
  });
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

/** Tournament: choose an event (a run in progress skips this: its tile opens the hub): three
 *  tiles like Home's, each with its levels (TIERS.pool), crowd and your titles there. */
const TIER_KANJI = { club: '町', pro: '旅', world: '世' };
$('tiers').addEventListener('click', e => {
  const b = e.target.closest('[data-tier]');
  if (!b) return;
  selTier = b.dataset.tier;
  saveSetup();
  menuVenue(VENUE_OF_TIER[selTier], TIERS[selTier].label);
  for (const x of $('tiers').children) { x.classList.toggle('sel', x === b); x.setAttribute('aria-pressed', String(x === b)); }
});
export function showEvent() {
  const titles = store.get('pp3d.titles', {}), live = tour && !tour.done;
  $('tiers').innerHTML = TIER_ORDER.map(k => { const t = TIERS[k], lv = Object.keys(t.pool).map(l => AI_LEVELS[l].label);
    return `<button class="mode tier${k === selTier ? ' sel' : ''}" data-tier="${k}" aria-pressed="${k === selTier}"><span class="mode-k" aria-hidden="true">${TIER_KANJI[k]}</span>`
      + `${titles[k] ? `<span class="tier-won" title="Titles won">🏆${titles[k] > 1 ? ` ×${titles[k]}` : ''}</span>` : ''}`
      + `<b>${t.label}</b><small>${t.blurb}</small><small class="tier-meta">${lv[0]}${lv.length > 1 ? `–${lv[lv.length - 1]}` : ''}<br>${t.fans.toLocaleString()} fans</small></button>`; }).join('');
  menuVenue(VENUE_OF_TIER[selTier], TIERS[selTier].label);
  $('tour-saved').classList.toggle('hidden', !live);
  if (live) $('tour-saved').innerHTML = `Entering a new one ends your <b>${TIERS[tour.tier].label}</b> run.`;
  $('btn-tour-new').textContent = live ? 'Start a New Tournament' : 'Enter Tournament';
  showScreen('menu-event');
}

/** The venue behind a menu screen (its big screens show the title). */
export function menuVenue(key, board = 'Open') { setVenue(key); setTableOfVenue(key); setBoardText(board); drawScreens(); }
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
  match.venue = quick.venue;
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
  if (!rival) rival = partnerBy(practice.opp, 'practice') || ROSTER[0];
  match.mode = 'practice';
  match.venue = practice.venue;
  match.watch = null;
  match.doubles = false;
  setHome(null);
  match.gamesToWin = Infinity;
  setOpponent({ ...rival, level: practice.level });
  rememberLast('practice', rival, practice.level);
  startMatch();
}

/** 2v2: you + your ally vs two roster players, all at the chosen level. The far side's name is the pair. */
export function startDuo() {
  Sound.init();
  match.mode = 'duo';
  match.venue = duo.venue;
  match.watch = null;
  match.doubles = true;
  setHome(null);
  match.gamesToWin = 2;
  if (!duo.opps) duo.opps = rollOpps();
  const [a, o1, o2] = duoSlots().map(rosterBy);
  setOpponent({ ...o1, level: duo.level });   // (ai.name stays o1's own: it carries the signature)
  Object.assign(opp, { name: `${o1.short} & ${o2.short}`, short: `${o1.short} & ${o2.short}`, flag: '' });
  Object.assign(ai2, { level: duo.level, style: o2.style, name: o2.name, short: o2.short });
  Object.assign(ally, { level: duo.level, style: a.style, name: a.name, short: a.short });
  ai2Racket.setColor(o2.color);
  allyRacket.setColor(a.color);
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
  if (id === 'menu-help') $('help-combos').innerHTML = playbookHtml();
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
  const who = `${opp.flag} ${opp.short}`.trim();
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
  const s = match.stats, lvl = LEVEL_ORDER.indexOf(match.levelKey), o = opp.short, won = winner === 'player';
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
    $('end-title').textContent = won ? '🏆 You win!' : `${opp.flag} ${opp.short} win${match.doubles ? '' : 's'}`.trim();
    $('end-sub').textContent = `vs ${`${opp.flag} ${opp.short}`.trim()} · ${games} · ${detail}`;
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
