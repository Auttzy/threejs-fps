// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate. main.js owns the raycaster, the player's health, the round
// wiring and the grenade blasts; the modules own their own state.
// ?shot=start|play|buy|end with &seed=N sets up a deterministic frame for a
// capture, renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal, WEAPONS, GRENADE_RADIUS, GRENADE_DAMAGE } from './weapons.js';
import { createBots } from './bots.js';
import { createMatch } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createParticles } from './particles.js';

const FIXED_STEP = 1 / 60;
const VEST_PRICE = 650;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

window.addEventListener('error', (event) => {
  document.title = `ERR: ${event.message}`;
});

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const particles = createParticles(scene);
const hud = createHud(world);
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world.colliders);
const raycaster = new THREE.Raycaster();
raycaster.far = 95;
const direction = new THREE.Vector3();
const tempVec = new THREE.Vector3();

const playerState = { alive: true, health: 100, armor: 0 };
let elapsed = 0;
let frozen = false;
let started = false;
let accumulator = 0;
let lastTime = performance.now();
let diedLastRound = false;
let plantProgress = 0;
let seenAt = new Map();
let seenSweepAt = 0;
let stepSoundAt = 0;

const arsenal = createArsenal(camera, {
  onReload() { audio.reload(); },
  onThrow() { audio.step(); },
});

// The match, wired to the HUD and the bots.
const matchApi = createMatch({
  onPhase(phase) {
    if (phase === 'buy') {
      hud.showBuy(matchApi.match.owned, matchApi.match.money, arsenal.state.grenades);
      hud.setBomb(matchApi.match.bomb.state === 'carried' ? 'Charge with you' : 'Charge dropped — recover it');
    } else if (phase === 'live') {
      hud.hideBuy();
    }
  },
  onRoundStart(round) {
    resetRound();
    hud.setScore(matchApi.match.score.strikers, matchApi.match.score.jackals, round);
    hud.setBomb('Charge with you');
  },
  onLive() {
    hud.showBanner(`ROUND ${matchApi.match.round}`, 'Plant the charge at A or B — or wipe the JACKALS out', 2200);
  },
  onRoundEnd(winner, reason, score) {
    const won = winner === 'strikers';
    hud.showBanner(won ? 'ROUND WON' : 'ROUND LOST', reasonText(reason, won), 3000);
    if (won) audio.roundWin();
    else audio.roundLose();
    hud.setScore(score.strikers, score.jackals, matchApi.match.round);
    hud.hideBuy();
    if (!playerState.alive) diedLastRound = true;
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMatchEnd(winner, score) {
    const won = winner === 'strikers';
    hud.showOverlay('end', won
      ? `STRIKERS take Foundry Row ${score.strikers}–${score.jackals}. The yard is yours.`
      : `JACKALS take Foundry Row ${score.jackals}–${score.strikers}. Run it back.`);
    if (document.pointerLockElement) document.exitPointerLock();
  },
  onMoney(money) {
    hud.setMoney(money);
  },
  onFeed(feed) {
    hud.setFeed(feed);
  },
  onBought(def) {
    audio.buy();
    matchApi.addFeed(`<b>You</b> bought ${def.name}`);
  },
  onPlanted(site) {
    audio.plantDone();
    hud.setBomb(`Charge planted at ${site} — hold the site`);
    matchApi.addFeed(`<b>You</b> planted the charge at ${site}`);
  },
  onDefused() {
    hud.setBomb('Charge defused');
    matchApi.addFeed(`<b>JACKALS</b> defused the charge`);
  },
  onExploded() {
    hud.setBomb('Charge detonated');
  },
  onBombDropped() {
    hud.setBomb('Charge dropped — recover it');
  },
});

const bots = createBots(scene, world, {
  los(from, to) {
    direction.copy(to).sub(from);
    const distance = direction.length();
    if (distance < 0.01) return true;
    direction.normalize();
    raycaster.set(from, direction);
    raycaster.far = distance - 0.4;
    return raycaster.intersectObjects(world.shootables, false).length === 0;
  },
  bomb() {
    return { ...matchApi.match.bomb, dropPos: bombDropPos };
  },
  onBotShot(bot, origin, dir, damage, headMul) {
    audio.enemyShot(origin.distanceTo(player.state.position));
    resolveShot(origin, dir, 90, bot, damage, headMul);
  },
  onChannel(bot, kind, progress) {
    if (kind === 'plant') hud.setChannel(`${bot.name} planting…`, progress);
    else hud.setChannel(`${bot.name} defusing…`, progress);
  },
  onPlanted(bot) {
    matchApi.plant(bot.site, elapsed);
    hud.setChannel(null, null);
  },
  onDefused() {
    matchApi.defuse();
    hud.setChannel(null, null);
    matchApi.endRound('jackals', 'defuse');
  },
  onBombPickup(bot) {
    bots.setCarrier(bot);
    matchApi.match.bomb = { state: 'carried', carrier: bot.name, site: null, plantedAt: 0 };
    bombDropPos = null;
    hud.setBomb(`Charge with ${bot.name}`);
    matchApi.addFeed(`<b>${bot.name}</b> picked up the charge`);
  },
  onBotKilled() {
    // damageBot already reports the kill in the feed.
  },
});

let bombDropPos = null;
const shootables = world.shootables.concat(bots.hitMeshes);

function reasonText(reason, won) {
  if (reason === 'elimination') return won ? 'Every JACKAL is down.' : 'Your team was wiped out.';
  if (reason === 'charge') return 'The charge went off. Foundry Row is rubble.';
  if (reason === 'defuse') return 'The JACKALS cut the fuse.';
  return 'The clock ran out and the JACKALS held.';
}

function resetRound() {
  bots.reset(matchApi.match.round);
  const spawn = world.spawns.strikers[1];
  player.state.position.set(spawn[0], 0, spawn[1]);
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = Math.PI;
  player.state.pitch = 0;
  playerState.alive = true;
  playerState.health = 100;
  playerState.armor = 0;
  bombDropPos = null;
  if (diedLastRound) {
    diedLastRound = false;
    matchApi.match.owned = new Set(['p9']);
    matchApi.match.grenadesOwned = 0;
    arsenal.refillPistol();
  } else {
    arsenal.state.grenades = matchApi.match.grenadesOwned;
  }
  plantProgress = 0;
  hud.setHealth(100, 0);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name, arsenal.state.grenades);
  hud.setAlive(3, 4);
}

// Analytic ray test against the player's body: a vertical cylinder for the
// torso and a sphere for the head. No invisible meshes, no ambiguity.
function rayHitsPlayer(origin, dir, range) {
  const p = player.state.position;
  const ox = origin.x - p.x;
  const oz = origin.z - p.z;
  const dx = dir.x;
  const dz = dir.z;
  const a = dx * dx + dz * dz;
  let best = null;
  if (a > 1e-8) {
    const b = 2 * (ox * dx + oz * dz);
    const c = ox * ox + oz * oz - 0.34 * 0.34;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t > 0 && t < range) {
        const y = origin.y + dir.y * t;
        if (y >= p.y && y <= p.y + player.state.height) best = { t, part: 'torso' };
      }
    }
  }
  const cx = origin.x - p.x;
  const cy = origin.y - (p.y + 1.53);
  const cz = origin.z - p.z;
  const b2 = 2 * (cx * dir.x + cy * dir.y + cz * dir.z);
  const c2 = cx * cx + cy * cy + cz * cz - 0.16 * 0.16;
  const disc2 = b2 * b2 - 4 * c2;
  if (disc2 >= 0) {
    const t = (-b2 - Math.sqrt(disc2)) / 2;
    if (t > 0 && t < range && (!best || t < best.t)) best = { t, part: 'head' };
  }
  return best;
}

function resolveShot(origin, dir, range, shooter, damage, headMul) {
  scene.updateMatrixWorld(true);
  raycaster.set(origin, dir);
  raycaster.far = range;
  const hits = raycaster.intersectObjects(shootables, false);
  const hit = hits.length > 0 ? hits[0] : null;
  let playerHit = null;
  if (shooter !== 'player' && playerState.alive) {
    const found = rayHitsPlayer(origin, dir, range);
    if (found) playerHit = { distance: found.t, part: found.part, point: origin.clone().addScaledVector(dir, found.t) };
  }
  const muzzle = origin.clone();
  if (hit && (!playerHit || hit.distance < playerHit.distance)) {
    const point = hit.point.clone();
    particles.tracer(muzzle, point);
    if (hit.object.userData.bot && hit.object.userData.bot !== shooter) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part ?? 'torso';
      const amount = damage * (part === 'head' ? headMul : part === 'legs' ? 0.8 : 1);
      damageBot(bot, amount, part, shooter);
      hud.setAlive((playerState.alive ? 1 : 0) + bots.aliveCount('strikers'), bots.aliveCount('jackals'));
    } else {
      particles.impact(point, hit.face?.normal ?? new THREE.Vector3(0, 1, 0));
    }
    return { kind: 'world', point };
  }
  if (playerHit) {
    particles.tracer(muzzle, playerHit.point);
    damagePlayer(damage * (playerHit.part === 'head' ? headMul : 1), playerHit.part, shooter);
    return { kind: 'player', point: playerHit.point, part: playerHit.part };
  }
  particles.tracer(muzzle, origin.clone().addScaledVector(dir, range));
  return { kind: 'none' };
}

function damagePlayer(amount, part, from) {
  if (!playerState.alive) return;
  let remaining = amount;
  if (playerState.armor > 0) {
    const absorbed = Math.min(playerState.armor, remaining * 0.5);
    playerState.armor -= absorbed;
    remaining -= absorbed;
  }
  playerState.health -= remaining;
  hud.damageFlash();
  audio.hurt();
  hud.setHealth(playerState.health, playerState.armor);
  if (playerState.health <= 0) {
    playerState.health = 0;
    playerState.alive = false;
    hud.setAlive(0 + bots.aliveCount('strikers'), bots.aliveCount('jackals'));
    matchApi.addFeed(`<b>${from?.name ?? 'JACKALS'}</b> dropped you`);
    if (matchApi.match.bomb.state === 'carried' && matchApi.match.bomb.carrier === 'player') {
      bombDropPos = player.state.position.clone();
      matchApi.dropBomb();
      const carrier = bots.bots.filter((bot) => bot.team === 'strikers' && bot.alive)
        .sort((a, b) => a.body.state.position.distanceTo(bombDropPos) - b.body.state.position.distanceTo(bombDropPos))[0];
      if (carrier) {
        bots.setCarrier(carrier);
        matchApi.addFeed(`<b>${carrier.name}</b> picked up the charge`);
      }
    }
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function damageBot(bot, amount, part, killer) {
  const result = bots.damage(bot, amount, part, killer, elapsed);
  if (result.killed) {
    matchApi.awardKill(killer === 'player' ? 'player' : null);
    matchApi.addFeed(`<b>${killer === 'player' ? 'You' : killer?.name ?? '?'}</b> ▸ <b>${bot.name}</b>${result.headshot ? ' (headshot)' : ''}`);
    if (bot.carryingBomb) {
      bombDropPos = bot.body.state.position.clone();
      bots.setCarrier(null);
      matchApi.dropBomb();
    }
  }
  return result;
}

function playerShoot() {
  const def = arsenal.def();
  if (!arsenal.takeRound()) {
    audio.dry();
    arsenal.reload();
    return;
  }
  camera.getWorldDirection(direction);
  const spread = arsenal.spread(player.groundSpeed());
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  const origin = camera.position.clone();
  // The renderer normally refreshes world matrices each frame, but in shot
  // mode there is no render loop between moves and shots, so refresh them
  // here before the raycast (cheap: a few hundred objects, only on shots).
  scene.updateMatrixWorld(true);
  raycaster.set(origin, direction);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(shootables, false);
  const muzzle = origin.clone().addScaledVector(direction, 0.6);
  if (hits.length > 0) {
    const hit = hits[0];
    const point = hit.point.clone();
    particles.tracer(muzzle, point);
    if (hit.object.userData.bot) {
      const bot = hit.object.userData.bot;
      const part = hit.object.userData.part ?? 'torso';
      const amount = def.damage * (part === 'head' ? def.headMul : part === 'legs' ? 0.8 : 1);
      const result = damageBot(bot, amount, part, 'player');
      audio.hit(result.headshot);
      if (result.killed) audio.kill();
      hud.hitMarker(result.killed, shot ? 4000 : 90);
      hud.setAlive((playerState.alive ? 1 : 0) + bots.aliveCount('strikers'), bots.aliveCount('jackals'));
    } else {
      particles.impact(point, hit.face?.normal ?? new THREE.Vector3(0, 1, 0));
    }
  } else {
    particles.tracer(muzzle, origin.clone().addScaledVector(direction, def.range));
  }
  arsenal.pullTrigger();
  player.recoil(def.kick + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(def.id);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, def.name, arsenal.state.grenades);
}

function explodeAt(point) {
  particles.explosion(point);
  audio.explosion();
  const targets = [];
  if (playerState.alive) targets.push({ kind: 'player', pos: player.state.position });
  for (const bot of bots.bots) if (bot.alive) targets.push({ kind: 'bot', bot, pos: bot.body.state.position });
  for (const target of targets) {
    const dist = Math.hypot(target.pos.x - point.x, target.pos.z - point.z);
    if (dist > GRENADE_RADIUS) continue;
    const chest = new THREE.Vector3(target.pos.x, target.pos.y + 1.2, target.pos.z);
    if (dist > 2 && !botsLos(point, chest)) continue;
    const amount = GRENADE_DAMAGE * (1 - dist / GRENADE_RADIUS) + 15;
    if (target.kind === 'player') damagePlayer(amount, 'torso', null);
    else damageBot(target.bot, amount, 'torso', 'player');
  }
  hud.setAlive((playerState.alive ? 1 : 0) + bots.aliveCount('strikers'), bots.aliveCount('jackals'));
}

function botsLos(from, to) {
  direction.copy(to).sub(from);
  const distance = direction.length();
  if (distance < 0.01) return true;
  direction.normalize();
  raycaster.set(from, direction);
  raycaster.far = distance - 0.4;
  return raycaster.intersectObjects(world.shootables, false).length === 0;
}

function syncCamera() {
  const eye = playerState.alive ? player.state.eye : 0.4;
  camera.position.set(player.state.position.x, player.state.position.y + eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const dx = point.x - player.state.position.x;
  const dy = point.y - (player.state.position.y + player.state.eye);
  const dz = point.z - player.state.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function step(dt) {
  elapsed += dt;
  const phase = matchApi.match.phase;
  const inBuy = phase === 'buy';
  const live = phase === 'live';

  // Look and movement.
  const look = input.takeLook();
  if (playerState.alive) player.look(look.x, look.y);
  if (playerState.alive && !frozen) player.step(dt, input.state.keys);

  // Footsteps.
  if (playerState.alive && player.groundSpeed() > 2 && elapsed - stepSoundAt > 0.42) {
    stepSoundAt = elapsed;
    audio.step();
  }

  // Shooting.
  if (live && playerState.alive && input.state.firing && arsenal.ready()) playerShoot();
  if (input.wasPressed('KeyR') && playerState.alive) arsenal.reload();
  if (input.wasPressed('KeyG') && live && playerState.alive) {
    camera.getWorldDirection(direction);
    const origin = camera.position.clone().addScaledVector(direction, 0.4);
    arsenal.throwGrenade(origin, direction);
    hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name, arsenal.state.grenades);
  }

  // Buy keys and weapon switching.
  if (inBuy) {
    if (input.wasPressed('Digit1') && matchApi.buy('vk9')) arsenal.equip('vk9');
    if (input.wasPressed('Digit2') && matchApi.buy('ar77')) arsenal.equip('ar77');
    if (input.wasPressed('Digit3') && matchApi.buy('lw50')) arsenal.equip('lw50');
    if (input.wasPressed('Digit4') && matchApi.buyGrenade()) arsenal.buyGrenade();
    if (input.wasPressed('Digit5') && matchApi.spend(VEST_PRICE)) {
      playerState.armor = 100;
      hud.setHealth(playerState.health, 100);
      audio.buy();
    }
    if (input.wasPressed('KeyB')) {
      if (document.getElementById('buy').hidden) hud.showBuy(matchApi.match.owned, matchApi.match.money, arsenal.state.grenades);
      else hud.hideBuy();
    }
    hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name, arsenal.state.grenades);
  } else if (live) {
    if (input.wasPressed('Digit1') && matchApi.match.owned.has('p9')) arsenal.equip('p9');
    if (input.wasPressed('Digit2') && matchApi.match.owned.has('vk9')) arsenal.equip('vk9');
    if (input.wasPressed('Digit3') && matchApi.match.owned.has('ar77')) arsenal.equip('ar77');
    if (input.wasPressed('Digit4') && matchApi.match.owned.has('lw50')) arsenal.equip('lw50');
  }

  // Planting: hold E inside a site while carrying the charge.
  if (live && playerState.alive && matchApi.match.bomb.state === 'carried' && matchApi.match.bomb.carrier === 'player') {
    let inSite = null;
    for (const [letter, site] of Object.entries(world.sites)) {
      if (Math.hypot(site.x - player.state.position.x, site.z - player.state.position.z) < site.r) inSite = letter;
    }
    if (inSite && input.state.keys.has('KeyE')) {
      plantProgress += dt / 3;
      hud.setChannel(`Planting the charge at ${inSite}…`, Math.min(1, plantProgress));
      if (plantProgress >= 1) {
        matchApi.plant(inSite, elapsed);
        plantProgress = 0;
        hud.setChannel(null, null);
      }
    } else {
      if (plantProgress > 0) hud.setChannel(null, null);
      plantProgress = 0;
    }
  } else if (plantProgress > 0) {
    plantProgress = 0;
    hud.setChannel(null, null);
  }

  // Bomb pickup: a living STRIKER walking over the dropped charge takes it.
  if (matchApi.match.bomb.state === 'dropped' && bombDropPos) {
    if (playerState.alive && player.state.position.distanceTo(bombDropPos) < 1.4) {
      matchApi.match.bomb = { state: 'carried', carrier: 'player', site: null, plantedAt: 0 };
      bombDropPos = null;
      hud.setBomb('Charge with you');
      matchApi.addFeed('<b>You</b> picked up the charge');
    } else {
      for (const bot of bots.bots) {
        if (bot.team === 'strikers' && bot.alive && bot.body.state.position.distanceTo(bombDropPos) < 1.4) {
          bots.setCarrier(bot);
          matchApi.match.bomb = { state: 'carried', carrier: bot.name, site: null, plantedAt: 0 };
          bombDropPos = null;
          hud.setBomb(`Charge with ${bot.name}`);
          matchApi.addFeed(`<b>${bot.name}</b> picked up the charge`);
          break;
        }
      }
    }
  }

  arsenal.step(dt);
  arsenal.stepGrenades(dt, explodeAt);
  particles.step(dt);
  bots.step(dt, elapsed, { alive: playerState.alive, body: player, state: player.state }, phase === 'live');
  matchApi.step(dt, elapsed, {
    strikers: (playerState.alive ? 1 : 0) + bots.aliveCount('strikers'),
    jackals: bots.aliveCount('jackals'),
  });

  // HUD: timer, crosshair spread, minimap, recently-seen enemies.
  hud.setTimer(matchApi.match.phaseTime, matchApi.match.phase);
  hud.setSpread(4 + arsenal.spread(player.groundSpeed()) * 900);
  if (elapsed - seenSweepAt > 0.25) {
    seenSweepAt = elapsed;
    seenAt.clear();
    for (const bot of bots.bots) {
      if (bot.team !== 'jackals' || !bot.alive || !playerState.alive) continue;
      const eye = camera.position;
      const chest = new THREE.Vector3(bot.body.state.position.x, bot.body.state.position.y + 1.2, bot.body.state.position.z);
      const dist = eye.distanceTo(chest);
      if (dist < 42 && botsLos(eye, chest)) seenAt.set(bot, elapsed);
    }
  }
  const bombPos = matchApi.match.bomb.state === 'planted'
    ? new THREE.Vector3(world.sites[matchApi.match.bomb.site].x, 0, world.sites[matchApi.match.bomb.site].z)
    : bombDropPos;
  hud.drawMinimap(player.state.position, player.state.yaw, bots.bots, bombPos, seenAt);
  if (matchApi.match.bomb.state === 'planted') {
    hud.setBomb(`Charge planted at ${matchApi.match.bomb.site} — ${Math.ceil(matchApi.fuseLeft(elapsed))}s`);
  }
  input.endFrame();
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    step(dt);
    syncCamera();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name, 0);
hud.setMoney(800);
hud.setHealth(100, 0);
hud.onPlay(() => {
  if (shot) return;
  audio.ensure();
  if (matchApi.match.phase === 'lobby') {
    matchApi.startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else if (matchApi.match.phase === 'matchEnd') {
    matchApi.startMatch();
    hud.hideOverlay();
    input.requestLock();
  } else {
    hud.hideOverlay();
    input.requestLock();
  }
});

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
  } else if (matchApi.match.phase !== 'matchEnd' && started) {
    hud.showOverlay('paused');
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function runShot(name) {
  hud.hideOverlay();
  matchApi.startMatch();
  if (name === 'start') {
    player.state.position.set(0, 0, 13.5);
    player.state.yaw = Math.PI;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -8));
    hud.showOverlay('start');
  } else if (name === 'buy') {
    player.state.position.set(-1, 0, 13);
    player.state.yaw = Math.PI - 0.3;
    settle(20);
    aimAt(new THREE.Vector3(0, 1.5, -4));
    hud.showBuy(matchApi.match.owned, matchApi.match.money, 0);
  } else if (name === 'play') {
    matchApi.match.phase = 'live';
    matchApi.match.phaseTime = 87;
    hud.hideBuy();
    player.state.position.set(1.5, 0, 6);
    const enemy = bots.bots.find((bot) => bot.name === 'Ash');
    const enemy2 = bots.bots.find((bot) => bot.name === 'Brick');
    enemy.body.state.position.set(-2, 0, -2);
    enemy.body.state.yaw = 0;
    enemy2.body.state.position.set(-0.5, 0, -4);
    enemy2.body.state.yaw = 0.2;
    // Freeze Brick in the mid lane so the final frame shows him centre.
    enemy2.holdUntil = 9999;
    enemy2.route = [];
    settle(10);
    // Re-aim before every shot: the bots keep walking between settles.
    for (let round = 0; round < 3; round += 1) {
      aimAt(new THREE.Vector3(enemy.body.state.position.x, round === 0 ? 1.62 : 1.2, enemy.body.state.position.z));
      playerShoot();
      settle(2);
    }
    settle(4);
    aimAt(new THREE.Vector3(enemy2.body.state.position.x, 1.2, enemy2.body.state.position.z));
    playerShoot();
    settle(2);
  } else {
    // end: the round just won at site A, JACKALS down around the furnace.
    matchApi.match.phase = 'live';
    matchApi.match.phaseTime = 64;
    for (const bot of bots.bots) {
      if (bot.team === 'jackals') {
        const spots = [[-13, -4.5], [-12, -5.5], [-14, -5], [-12.5, -4]];
        const spot = spots[bots.bots.filter((b) => b.team === 'jackals').indexOf(bot)];
        bot.body.state.position.set(spot[0], 0, spot[1]);
        bots.damage(bot, 500, 'torso', 'player', elapsed);
      }
    }
    matchApi.endRound('strikers', 'elimination');
    hud.setAlive(3, 0);
    player.state.position.set(-13, 0, 0);
    settle(30);
    aimAt(new THREE.Vector3(-13.5, 1.0, -8));
    hud.showBanner('ROUND WON', 'Site A cleared — STRIKERS take the round', 60000);
  }
  hud.setScore(matchApi.match.score.strikers, matchApi.match.score.jackals, matchApi.match.round);
  hud.setAmmo(arsenal.state.mag, arsenal.state.reserve, arsenal.def().name, arsenal.state.grenades);
  hud.setMoney(matchApi.match.money);
  paintTwiceThenReady();
}

syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
