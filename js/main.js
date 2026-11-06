// Entry: loads every module in order (each one also imports what it uses), then wires the console/sim hook and starts.
import './util.js';
import './config.js';
import './physics.js';
import './render/scene.js';
import './render/table.js';
import './render/venues.js';
import './render/racket.js';
import './render/ball.js';
import './input.js';
import './log.js';
import './strokes.js';
import './combo.js';
import './ai.js';
import './serve.js';
import './jutsu.js';
import './rules.js';
import './ui/hud.js';
import './ui/menus.js';
import './tournament.js';
import './ui/controls.js';
import './audio.js';
import './loop.js';
import { ADAPT, AIM, REACH, COMBO, AI_COMMON, AI_LEVELS, AI_STYLES, ARM, BLOCK, CHAKRA, CHOP, JUTSU, JUTSU_AI, JUTSU_POOL, PLAYER_CFG, ROSTER, SAMEHADA, SIGNATURES, SMART, SMART_J, SMASH, SMASH_D, SPIN, SPIN_D, STYLE_KIT, VOID } from './config.js';
import { predictIntercept, simulate } from './physics.js';
import { camera } from './render/scene.js';
import { ai2Racket, aiBody, aiRacket, allyRacket, player, playerBody } from './render/racket.js';
import { ball, decoys } from './render/ball.js';
import { input, releaseCharge, startCharge, swing, touchSens } from './input.js';
import { DEBUG, TLOG } from './log.js';
import { playerHit } from './strokes.js';
import { ai, ai2, ally, nearAI, youServe, yourTurn } from './ai.js';
import { beginToss, playerServe } from './serve.js';
import { armJutsu, armed, chakra, flow, sealsOf, setYourKit, yourKit } from './jutsu.js';
import { canHit, endMatch, match, rally, setHome, setOpponent, setWatchSpeed, startMatch, watchSpeed } from './rules.js';
import { scout, updateHUD } from './ui/hud.js';
import { showStartMenu, startDuo, startQuick, togglePause } from './ui/menus.js';
import { newTournament, playTourMatch, showTourHub, tour, watchTourMatch } from './tournament.js';
import { Sound } from './audio.js';
import { fixedUpdate, frame, simTime } from './loop.js';

// Debug/console hook (handy for tuning; not used by the game itself).
window.PingPong = { debug: DEBUG, swing, camera, match, rally, ball, player, aiRacket, input, AI_LEVELS, predictIntercept, startMatch, playerServe, PLAYER_CFG,
  chakra, flow, armJutsu, get armed() { return armed; }, setWatchSpeed: n => { setWatchSpeed(n); }, ally, ai2, allyRacket, ai2Racket, startDuo, startQuick, startCharge, releaseCharge, JUTSU, JUTSU_AI, JUTSU_POOL, CHAKRA, decoys,
  playerBody, aiBody, togglePause, updateHUD, endMatch, showTourHub, Sound, ai, nearAI, scout, watchTourMatch, newTournament, playTourMatch,
  get tour() { return tour; }, get simTime() { return simTime; },
  // Headless balance runs (a script steps the game and drives input.target like a finger).
  test: { TLOG, AIM, ARM, REACH, COMBO, touchSens, PLAYER_CFG, SPIN, SMASH, fixedUpdate, simulate, playerHit, beginToss, setOpponent, setHome, ROSTER, ADAPT, AI_COMMON, AI_STYLES, AI_LEVELS, SIGNATURES, SMASH_D, yourTurn, youServe, canHit, chakra,
    JUTSU, JUTSU_AI, STYLE_KIT, SAMEHADA, SMART, SMART_J, VOID, BLOCK, CHOP, SPIN_D, sealsOf, get kit() { return yourKit; }, setKit: k => { setYourKit([...k]); } } };

showStartMenu();
requestAnimationFrame(frame);
