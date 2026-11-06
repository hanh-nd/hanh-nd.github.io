// Scoreboard, messages, scouting notes.
import { GAME, SIGNATURES } from '../config.js';
import { drawScreens } from '../render/venues.js';
import { currentCharge, input } from '../input.js';
import { ai, youServe, yourTurn } from '../ai.js';
import { idx, isPlaying, match, nameOf, other } from '../rules.js';
import { Sound } from '../audio.js';

/* =====================================================================
   UI — HUD, messages, menus
   ===================================================================== */
export const $ = id => document.getElementById(id);
export let msgTimer = 0, msgPriority = 0;

/** Center message. A message showing can't be replaced by a less important one (priority:
 *  1 = info, edge balls · 2 = smashes, signature call-outs · 3 = points, games, the match). */
export function showMessage(main, sub = '', tone = 'neutral', duration = 1.4, priority = 1) {
  if (msgTimer > 0 && priority < msgPriority) return;
  msgPriority = priority;
  const el = $('msg');
  $('msg-main').textContent = main;
  $('msg-sub').textContent = sub;
  el.className = '';
  void el.offsetWidth;   // restart the pop animation
  el.className = 'show ' + tone;
  msgTimer = duration;
}

/** Set a scorebug number; a changed value gets a short "bump" so the eye catches it. */
function setScore(id, value) {
  const el = $(id), text = String(value);
  if (el.textContent === text) return;
  el.textContent = text;
  el.classList.remove('bump');
  void el.offsetWidth;   // restart the animation
  el.classList.add('bump');
}

/** DEUCE / GAME POINT / MATCH POINT, as broadcast graphics show them; null otherwise. */
export function pointSituation() {
  const n = GAME.pointsToWin, [p, a] = match.points;
  if (p >= n - 1 && a >= n - 1 && p === a) return { text: 'DEUCE', cls: 'deuce' };
  for (const who of ['player', 'ai']) {
    const mine = match.points[idx(who)], theirs = match.points[idx(other(who))];
    if (mine >= n - 1 && mine > theirs) {
      const matchPoint = match.games[idx(who)] === match.gamesToWin - 1;
      return { text: `${matchPoint ? 'MATCH' : 'GAME'} POINT · ${nameOf(who).toUpperCase()}`, cls: who };
    }
  }
  return null;
}

export function updateHUD() {
  drawScreens();
  setScore('score-p', match.points[0]);
  setScore('score-a', match.points[1]);
  setScore('games-p', match.games[0]);
  setScore('games-a', match.games[1]);
  $('serve-p').classList.toggle('on', match.server === 'player');
  $('serve-a').classList.toggle('on', match.server === 'ai');
  const situation = isPlaying() ? pointSituation() : null, tag = $('tag-point');
  tag.classList.toggle('hidden', !situation);
  if (situation) { tag.textContent = situation.text; tag.className = 'tag ' + situation.cls; }
  const rallyTag = $('tag-rally');
  rallyTag.classList.toggle('hidden', match.rallyCount < 4);
  rallyTag.textContent = `RALLY ${match.rallyCount}`;
  // 2v2: whose ball it is on your side.
  const turnTag = $('tag-turn'), showTurn = match.doubles && isPlaying();
  turnTag.classList.toggle('hidden', !showTurn);
  if (showTurn) {
    const mine = match.state === 'serve' || match.state === 'toss' ? (match.server === 'player' ? match.serverIdx : match.receiverIdx) === 0 : yourTurn();
    turnTag.textContent = mine ? '▶ YOU' : '▶ ALLY';
    turnTag.className = 'tag' + (mine ? ' player' : '');
  }
  const serving = match.state === 'serve' && youServe();
  $('power-wrap').classList.toggle('hidden', !serving);
  $('hint').classList.toggle('hidden', !serving);
  $('hint').innerHTML = `<b>Serve:</b> hold · release · swipe${match.doubles ? ' · diagonal' : ''}`;
}

/** Per-frame HUD bit: the serve power bar. */
export function updateLiveHUD() {
  $('power-fill').style.width = (input.charging ? currentCharge() * 100 : 0) + '%';
}

export function hideAllMenus() {
  for (const id of ['menu-start', 'menu-pick', 'menu-ready', 'menu-event', 'menu-pause', 'menu-end', 'menu-tour', 'menu-help', 'menu-settings']) $(id).classList.add('hidden');
}

/** localStorage, failing quietly (private windows, blocked storage). */
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not saved */ } },
};
/** Scouting knowledge, recorded silently in the browser (not shown in the UI; lost quietly if
 *  storage is blocked): per style, the
 *  patterns you've seen (patterns are per style, so watching or playing any player of a style
 *  counts); per player, their signature — seen yet, and how often you've returned it. */
const SCOUT_KEY = 'pp3d.scout';
export const scout = (() => {
  const v = store.get(SCOUT_KEY, null);
  return v && typeof v === 'object' && v.styles && v.players ? v : { styles: {}, players: {} };
})();
const saveScout = () => store.set(SCOUT_KEY, scout);
const styleCard = st => (scout.styles[st] ||= { seen: [] });
const playerCard = name => (scout.players[name] ||= { seenSignature: false, beatSignature: 0 });

/** c just played the key shot of a pattern: count it, and scout it the first time. */
export function scoutPattern(c, def) {
  match.stats.patterns[def.id] = (match.stats.patterns[def.id] || 0) + 1;
  const card = styleCard(c.style);
  if (card.seen.includes(def.id)) return;
  card.seen.push(def.id);
  saveScout();
}
/** c just played its signature: a chime and its name (with the counter the first time in a match);
 *  scout it the first time ever. */
export function scoutSignature(c, id) {
  const sg = SIGNATURES[id], card = playerCard(sg.owner), first = !card.seenSignature;
  if (c === ai) match.stats.sigSeen++;
  if (first) { card.seenSignature = true; saveScout(); }
  Sound.signature();
  if (c.sigShown) return showMessage(`★ ${sg.name}`, '', 'warn', 0.8, 2);   // later in the match: just the name
  c.sigShown = true;
  showMessage(`★ ${sg.name}`, sg.counter, 'warn', 2.2, 2);
}
/** You returned a signature shot. */
export function beatSignature(c, id) {
  const sg = SIGNATURES[id], card = playerCard(sg.owner);
  card.beatSignature++;
  saveScout();
  match.stats.sigBeaten++;
}

// Setters for the bindings other modules assign (an imported binding is read-only).
export function setMsgTimer(v) { return (msgTimer = v); }
