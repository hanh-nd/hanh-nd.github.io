// Start-up wiring: saved settings and every button.
import { clamp } from '../util.js';
import { DRILLS, GAME, LEVEL_ORDER, ROSTER, TIER_ORDER } from '../config.js';
import { touchSens } from '../input.js';
import { armJutsu, autoJutsu, setAutoJutsu, syncChakra } from '../jutsu.js';
import { WATCH_SPEEDS, match, setWatchSpeed, startMatch, watchSpeed } from '../rules.js';
import { $, store } from './hud.js';
import { VENUE_PICKS, buildMenus, cycleFastForward, duo, hideOverlay, practice, quick, rosterBy, selTier, setSelTier, setUiMode, showOverlay, showRivalPicker, showStartMenu, startDuo, startQuick, syncSettings, togglePause, uiMode } from './menus.js';
import { newTournament, showTourHub } from '../tournament.js';
import { Sound } from '../audio.js';

// The menu choices saved last time (before the menus are built).
{
  const s = store.get('pp3d.setup', null);
  if (s && typeof s === 'object') {
    for (const [o, k] of [[quick, 'quick'], [practice, 'practice'], [duo, 'duo']]) {
      const v = s[k];
      if (!v || typeof v !== 'object') continue;
      if (LEVEL_ORDER.includes(v.level)) o.level = v.level;
      if (o === duo) { const a = rosterBy(v.ally) || ROSTER.find(e => e.style === v.ally); if (a) duo.ally = a.name; }   // (saved before 2v2 had names: a style)
      if ('opp' in o && (v.opp === 'random' || rosterBy(v.opp) || (o === practice && DRILLS.some(e => e.name === v.opp)))) o.opp = v.opp;
      if (VENUE_PICKS.includes(v.venue)) o.venue = v.venue;
      if (o === practice) { practice.refill = v.refill !== false; practice.cpuJutsu = v.cpuJutsu !== false; }
    }
    if (TIER_ORDER.includes(s.tier)) setSelTier(s.tier);
  }
  const sp = store.get('pp3d.speed', null);
  if (GAME.speeds[sp]) match.speedKey = sp;
}

buildMenus();
// Browsers start audio only after a user gesture: the first click anywhere (even a menu tab) starts it.
// iOS counts only the end of a touch (touchend / pointerup / click) as a gesture that can start
// audio, not the press itself — listen to all of them.
for (const ev of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(ev, () => Sound.init(), true);
// Back on the tab: try to resume straight away (works on most browsers; on iOS the next tap does it).
document.addEventListener('visibilitychange', () => { if (!document.hidden) Sound.init(); });
// Tapping your scorebug row (name or chakra bar) arms too.
for (const el of document.querySelectorAll('.sb-row.you > span')) el.addEventListener('pointerdown', e => { e.stopPropagation(); armJutsu(); });
$('jutsu-menu').addEventListener('pointerdown', e => { const t = e.target.closest('[data-tier]'); if (t) { e.stopPropagation(); armJutsu(+t.dataset.tier); } });
$('btn-tour-new').addEventListener('click', () => { Sound.init(); newTournament(selTier); showTourHub(); });
$('home-settings').addEventListener('click', () => { syncSettings(); showOverlay('menu-settings'); });
$('home-help').addEventListener('click', () => showOverlay('menu-help'));
$('btn-resume').addEventListener('click', togglePause);
$('btn-pause').addEventListener('click', e => { e.stopPropagation(); togglePause(); });
$('btn-help').addEventListener('click', e => { e.stopPropagation(); showOverlay('menu-help'); });
$('btn-settings').addEventListener('click', e => { e.stopPropagation(); syncSettings(); showOverlay('menu-settings'); });
$('btn-ff').addEventListener('click', e => { e.stopPropagation(); cycleFastForward(); });
setWatchSpeed(WATCH_SPEEDS.includes(store.get('pp3d.watchSpeed')) ? store.get('pp3d.watchSpeed') : watchSpeed);
$('btn-mute').addEventListener('click', e => { e.stopPropagation(); Sound.init(); Sound.toggleMute(); syncSettings(); });
{ const v = store.get('pp3d.touchSens'); if (Number.isFinite(v)) touchSens.value = clamp(v, 0, 100); }
$('sens').addEventListener('input', e => { touchSens.value = +e.target.value; store.set('pp3d.touchSens', touchSens.value); syncSettings(); });
setAutoJutsu(!!store.get('pp3d.autoJutsu', false));
$('btn-auto').addEventListener('click', e => { e.stopPropagation(); setAutoJutsu(!autoJutsu); store.set('pp3d.autoJutsu', autoJutsu); syncSettings(); syncChakra(); });
$('btn-help-close').addEventListener('click', hideOverlay);
$('btn-settings-close').addEventListener('click', hideOverlay);
$('btn-restart').addEventListener('click', () => startMatch());
$('btn-quit').addEventListener('click', () => (match.mode === 'tour' ? showTourHub() : showStartMenu()));
$('btn-again').addEventListener('click', () => startMatch());
$('btn-next').addEventListener('click', () => {
  const pick = match.doubles ? duo : quick, i = LEVEL_ORDER.indexOf(pick.level);
  pick.level = LEVEL_ORDER[Math.min(i + 1, LEVEL_ORDER.length - 1)];
  if (match.doubles) startDuo(); else startQuick();
});
$('btn-continue').addEventListener('click', showTourHub);
$('btn-menu').addEventListener('click', showStartMenu);
$('btn-rival').addEventListener('click', () => { showStartMenu(); setUiMode('quick'); showRivalPicker(); });
