// The bots: six agents with bodies, names and a job. Each bot walks the
// waypoint graph toward its objective, holds angles, and fights when it
// sees an enemy: a reaction delay, bursts of hitscan fire with spread, and
// strafing while it shoots. Attackers carry the charge to a site and plant
// it; defenders rotate to a planted charge and defuse it. main.js owns the
// raycaster: bots ask it for line of sight and for shot resolution, and this
// module owns bot health, falling over, and the plant and defuse channels.
import * as THREE from 'three';
import { createBody } from './player.js';
import { PALETTE } from './palette.js';

const BOT_DEFS = [
  { name: 'Rook', team: 'strikers', site: 'A' },
  { name: 'Vex', team: 'strikers', site: 'B' },
  { name: 'Ash', team: 'jackals', site: 'A' },
  { name: 'Brick', team: 'jackals', site: 'B' },
  { name: 'Cinder', team: 'jackals', site: 'A' },
  { name: 'Dagger', team: 'jackals', site: 'B' },
];
const BOT_DAMAGE = 24;
const BOT_HEAD_MUL = 2.5;
const BOT_FIRE_GAP = 0.16;
const THINK_EVERY = 0.12;
const PLANT_SECONDS = 3;
const DEFUSE_SECONDS = 5;

function nameSprite(name, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(8,8,10,0.6)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = colour;
  ctx.fillRect(0, 56, 256, 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, 128, 30);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.5, 0.38, 1);
  return sprite;
}

export function createBots(scene, world, events) {
  const bots = [];
  const hitMeshes = [];
  const teamMaterial = {
    strikers: new THREE.MeshStandardMaterial({ color: new THREE.Color('#1d5c55'), roughness: 0.7, metalness: 0.1 }),
    jackals: new THREE.MeshStandardMaterial({ color: new THREE.Color('#6e2a12'), roughness: 0.7, metalness: 0.1 }),
  };
  const darkMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#22242a'), roughness: 0.8 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a37e'), roughness: 0.7 });
  const torsoGeometry = new THREE.BoxGeometry(0.52, 0.78, 0.3);
  const headGeometry = new THREE.SphereGeometry(0.16, 14, 10);
  const legGeometry = new THREE.BoxGeometry(0.2, 0.72, 0.22);
  const gunGeometry = new THREE.BoxGeometry(0.08, 0.1, 0.62);

  for (let defIndex = 0; defIndex < BOT_DEFS.length; defIndex += 1) {
    const def = BOT_DEFS[defIndex];
    const group = new THREE.Group();
    const torso = new THREE.Mesh(torsoGeometry, teamMaterial[def.team]);
    torso.position.y = 1.08;
    torso.userData.part = 'torso';
    const head = new THREE.Mesh(headGeometry, skinMaterial);
    head.position.y = 1.62;
    head.userData.part = 'head';
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.34), new THREE.MeshStandardMaterial({ color: new THREE.Color(def.team === 'strikers' ? PALETTE.team : PALETTE.enemy) }));
    band.position.y = 1.68;
    const legL = new THREE.Mesh(legGeometry, darkMaterial);
    legL.position.set(-0.14, 0.36, 0);
    legL.userData.part = 'legs';
    const legR = new THREE.Mesh(legGeometry, darkMaterial);
    legR.position.set(0.14, 0.36, 0);
    legR.userData.part = 'legs';
    const gun = new THREE.Mesh(gunGeometry, darkMaterial);
    gun.position.set(0.22, 1.18, -0.28);
    const sprite = nameSprite(def.name, def.team === 'strikers' ? PALETTE.team : PALETTE.enemy);
    sprite.position.y = 2.05;
    group.add(torso, head, band, legL, legR, gun, sprite);
    group.traverse((mesh) => {
      if (mesh.isMesh) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    scene.add(group);
    const bot = {
      ...def,
      defIndex,
      body: createBody(world.colliders, 0, 0, 0),
      group,
      sprite,
      torso,
      head,
      health: 100,
      armor: 0,
      alive: true,
      carryingBomb: false,
      route: [],
      routeIndex: 0,
      holdUntil: 0,
      thinkAt: Math.random() * THINK_EVERY,
      target: null,
      targetLostAt: 0,
      reactionAt: 0,
      burstLeft: 0,
      burstAt: 0,
      burstPauseUntil: 0,
      strafeDir: 1,
      strafeUntil: 0,
      channel: null,
      channelAt: 0,
      fall: 0,
      lastDamageAt: -10,
      lastDamageFrom: null,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    legL.userData.bot = bot;
    legR.userData.bot = bot;
    hitMeshes.push(torso, head, legL, legR);
    bots.push(bot);
  }

  function eyeOf(bot) {
    const p = bot.body.state.position;
    return new THREE.Vector3(p.x, p.y + bot.body.state.eye, p.z);
  }

  function chestOf(agent) {
    const p = agent.position ?? agent.body.state.position;
    return new THREE.Vector3(p.x, p.y + 1.2, p.z);
  }

  function faceToward(bot, x, z, dt, rate = 6) {
    const desired = Math.atan2(-(x - bot.body.state.position.x), -(z - bot.body.state.position.z));
    let diff = desired - bot.body.state.yaw;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    bot.body.state.yaw += diff * Math.min(1, dt * rate);
  }

  function setRoute(bot, toId) {
    const from = world.nearestNode(bot.body.state.position.x, bot.body.state.position.z);
    bot.route = world.route(from.id, toId);
    bot.routeIndex = 0;
  }

  // Walk the bot's current route one node at a time. Returns the wish
  // direction and the node being walked toward, or null when the route is
  // finished. Shared by objective movement and combat approach.
  function walkRoute(bot) {
    while (bot.route.length > 0 && bot.routeIndex < bot.route.length) {
      const node = bot.route[bot.routeIndex];
      const dx = node.x - bot.body.state.position.x;
      const dz = node.z - bot.body.state.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.7) {
        bot.routeIndex += 1;
        continue;
      }
      return { node, x: dx / dist, z: dz / dist };
    }
    return null;
  }

  function think(bot, time, player, others, canFight) {
    if (!bot.alive) return;
    if (bot.target && !bot.target.alive) {
      bot.target = null;
      bot.burstLeft = 0;
    }
    // Visible enemies: the player and every living bot of the other team.
    // Bots only fight once the round is live.
    let best = null;
    let bestScore = Infinity;
    const eye = eyeOf(bot);
    const candidates = [];
    if (canFight) {
      if (player.alive) candidates.push({ kind: 'player', agent: player, pos: player.body.state.position });
      for (const other of others) {
        if (other.alive && other.team !== bot.team) candidates.push({ kind: 'bot', agent: other, pos: other.body.state.position });
      }
    }
    for (const candidate of candidates) {
      const dx = candidate.pos.x - bot.body.state.position.x;
      const dz = candidate.pos.z - bot.body.state.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 46) continue;
      const angle = Math.abs(((Math.atan2(-dx, -dz) - bot.body.state.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const seenRecently = candidate.agent === bot.lastDamageFrom && time - bot.lastDamageAt < 1.2;
      if (angle > 1.1 && dist > 7 && !seenRecently) continue;
      if (!events.los(eye, chestOf(candidate.agent))) continue;
      const score = dist + (candidate.kind === 'player' ? 0 : 2);
      if (score < bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best) {
      if (bot.target !== best.agent) {
        bot.target = best.agent;
        bot.reactionAt = time + 0.3 + Math.random() * 0.3;
        bot.burstLeft = 0;
      }
      bot.targetLostAt = time + 1.5;
      return;
    }
    if (bot.target && time > bot.targetLostAt) {
      bot.target = null;
      bot.burstLeft = 0;
    }
    if (bot.target) return;

    // No enemy in sight: work the objective.
    const bomb = events.bomb();
    if (bot.team === 'strikers') {
      if (bomb.state === 'dropped' && bomb.dropPos) {
        const d = Math.hypot(bomb.dropPos.x - bot.body.state.position.x, bomb.dropPos.z - bot.body.state.position.z);
        if (d < 1.4) {
          events.onBombPickup(bot);
        } else if (bot.route.length === 0 || bot.routeIndex >= bot.route.length) {
          setRoute(bot, world.nearestNode(bomb.dropPos.x, bomb.dropPos.z).id);
        }
      } else if (bot.carryingBomb) {
        const site = world.sites[bot.site];
        const d = Math.hypot(site.x - bot.body.state.position.x, site.z - bot.body.state.position.z);
        if (d < 2.2 && bomb.state === 'carried' && canFight) {
          bot.channel = 'plant';
          bot.channelAt = time;
        } else if (!bot.channel) {
          if (bot.route.length === 0 || bot.routeIndex >= bot.route.length) setRoute(bot, bot.site === 'A' ? 'aSite' : 'bSite');
        }
      } else if (bomb.state === 'planted') {
        if (bot.route.length === 0 || bot.routeIndex >= bot.route.length) setRoute(bot, bomb.site === 'A' ? 'aSite' : 'bSite');
      } else if (bot.route.length === 0 || bot.routeIndex >= bot.route.length) {
        if (time > bot.holdUntil) {
          const dest = bot.site === 'A' ? 'aSite' : 'bSite';
          setRoute(bot, dest);
          bot.holdUntil = time + 8 + Math.random() * 6;
        }
      }
    } else {
      if (bomb.state === 'planted') {
        const site = world.sites[bomb.site];
        const d = Math.hypot(site.x - bot.body.state.position.x, site.z - bot.body.state.position.z);
        if (d < 2.2 && canFight) {
          bot.channel = 'defuse';
          bot.channelAt = time;
        } else if (!bot.channel) {
          if (bot.route.length === 0 || bot.routeIndex >= bot.route.length) setRoute(bot, bomb.site === 'A' ? 'aSite' : 'bSite');
        }
      } else if (bot.route.length === 0 || bot.routeIndex >= bot.route.length) {
        if (time > bot.holdUntil) {
          const holds = bot.site === 'A' ? ['aSite', 'defA', 'midNorth'] : ['bSite', 'defB', 'midNorth'];
          const dest = holds[Math.floor(Math.random() * holds.length)];
          setRoute(bot, dest);
          bot.holdUntil = time + 7 + Math.random() * 6;
        }
      }
    }
  }

  function stepBot(bot, dt, time, player, canFight) {
    if (!bot.alive) {
      // The mesh follows the body even when dead (bodies are repositioned
      // for staged shots); only the fall angle animates.
      bot.group.position.x = bot.body.state.position.x;
      bot.group.position.z = bot.body.state.position.z;
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.group.rotation.x = -bot.fall * 1.45;
        bot.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    bot.thinkAt -= dt;
    if (bot.thinkAt <= 0) {
      bot.thinkAt = THINK_EVERY;
      think(bot, time, player, bots, canFight);
    }

    let wishX = 0;
    let wishZ = 0;
    let crouch = false;

    if (bot.channel) {
      // Planting or defusing: stand still. Damage interrupts the channel.
      const needed = bot.channel === 'plant' ? PLANT_SECONDS : DEFUSE_SECONDS;
      const progress = (time - bot.channelAt) / needed;
      events.onChannel(bot, bot.channel, Math.min(1, progress));
      if (progress >= 1) {
        const done = bot.channel;
        bot.channel = null;
        if (done === 'plant') events.onPlanted(bot);
        else events.onDefused(bot);
      }
    } else if (bot.target) {
      const targetPos = bot.target.body.state.position;
      faceToward(bot, targetPos.x, targetPos.z, dt, 8);
      const dist = Math.hypot(targetPos.x - bot.body.state.position.x, targetPos.z - bot.body.state.position.z);
      if (dist > 14) {
        // Approach through the waypoint graph: a straight line to the target
        // runs into walls and blocks and the bot piles up on them; the graph
        // routes around. Re-paths when the target moves on.
        if (bot.route.length === 0 || bot.routeIndex >= bot.route.length) {
          setRoute(bot, world.nearestNode(targetPos.x, targetPos.z).id);
        }
        const w = walkRoute(bot);
        if (w) {
          wishX = w.x;
          wishZ = w.z;
        } else {
          // Already at the target's node: creep straight at it.
          const sin = Math.sin(bot.body.state.yaw);
          const cos = Math.cos(bot.body.state.yaw);
          wishX = -sin;
          wishZ = -cos;
        }
      } else {
        // Strafe while shooting at close range.
        if (time > bot.strafeUntil) {
          bot.strafeDir = Math.random() < 0.5 ? -1 : 1;
          bot.strafeUntil = time + 0.7 + Math.random() * 0.8;
        }
        const sin = Math.sin(bot.body.state.yaw);
        const cos = Math.cos(bot.body.state.yaw);
        wishX = cos * bot.strafeDir * 0.5;
        wishZ = -sin * bot.strafeDir * 0.5;
      }
      if (time >= bot.reactionAt && time >= bot.burstPauseUntil) {
        if (bot.burstLeft <= 0) {
          bot.burstLeft = 3 + Math.floor(Math.random() * 3);
          bot.burstAt = time;
        }
        if (time >= bot.burstAt) {
          bot.burstAt = time + BOT_FIRE_GAP;
          bot.burstLeft -= 1;
          const eye = eyeOf(bot);
          const aim = chestOf(bot.target);
          const spread = 0.016 + dist * 0.0006 + (bot.target.body?.state ? Math.hypot(bot.target.body.state.velocity.x, bot.target.body.state.velocity.z) * 0.0012 : 0);
          const dir = new THREE.Vector3(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z).normalize();
          dir.x += (Math.random() * 2 - 1) * spread;
          dir.y += (Math.random() * 2 - 1) * spread;
          dir.z += (Math.random() * 2 - 1) * spread;
          dir.normalize();
          events.onBotShot(bot, eye, dir, BOT_DAMAGE, BOT_HEAD_MUL);
          if (bot.burstLeft <= 0) bot.burstPauseUntil = time + 0.5 + Math.random() * 0.5;
        }
      }
    } else if (bot.route.length > 0 && bot.routeIndex < bot.route.length) {
      const w = walkRoute(bot);
      if (w) {
        wishX = w.x;
        wishZ = w.z;
        faceToward(bot, w.node.x, w.node.z, dt, 4);
      }
    } else {
      // Holding: slow scan, left and right.
      bot.body.state.yaw += Math.sin(time * 0.5 + bot.name.length) * dt * 0.25;
    }

    bot.body.step(dt, wishX, wishZ, crouch, false);
    bot.group.position.copy(bot.body.state.position);
    bot.group.rotation.y = bot.body.state.yaw;
  }

  function damage(bot, amount, part, from, time) {
    if (!bot.alive) return { killed: false, headshot: false };
    bot.channel = null;
    bot.lastDamageAt = time;
    bot.lastDamageFrom = from;
    let remaining = amount;
    if (bot.armor > 0) {
      const absorbed = Math.min(bot.armor, remaining * 0.5);
      bot.armor -= absorbed;
      remaining -= absorbed;
    }
    bot.health -= remaining;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.fall = 0;
      bot.sprite.visible = false;
      events.onBotKilled(bot);
      return { killed: true, headshot: part === 'head' };
    }
    return { killed: false, headshot: part === 'head' };
  }

  function reset(round) {
    for (const bot of bots) {
      const spawns = bot.team === 'strikers' ? world.spawns.strikers : world.spawns.jackals;
      const spawn = spawns[bot.defIndex % spawns.length];
      bot.body.state.position.set(spawn[0], 0, spawn[1]);
      bot.body.state.velocity.set(0, 0, 0);
      bot.body.state.yaw = bot.team === 'strikers' ? Math.PI : 0;
      bot.body.state.pitch = 0;
      bot.health = 100;
      bot.armor = round > 1 ? 50 : 0;
      bot.alive = true;
      bot.carryingBomb = false;
      bot.route = [];
      bot.routeIndex = 0;
      bot.holdUntil = 0;
      bot.target = null;
      bot.channel = null;
      bot.fall = 0;
      bot.group.rotation.set(0, bot.body.state.yaw, 0);
      bot.group.position.copy(bot.body.state.position);
      bot.sprite.visible = true;
    }
  }

  return {
    bots,
    hitMeshes,
    step(dt, time, player, canFight = true) {
      for (const bot of bots) stepBot(bot, dt, time, player, canFight);
    },
    damage,
    reset,
    eyeOf,
    aliveCount(team) {
      return bots.filter((bot) => bot.team === team && bot.alive).length;
    },
    carrier() {
      return bots.find((bot) => bot.carryingBomb) ?? null;
    },
    setCarrier(bot) {
      for (const other of bots) other.carryingBomb = false;
      if (bot) bot.carryingBomb = true;
    },
  };
}
