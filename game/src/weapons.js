// The arsenal: four hitscan guns and a frag grenade. A weapon owns its
// numbers, its view model and its magazine; main.js owns the ray and the
// damage. Spread grows with speed and with sustained fire, so stopping to
// aim pays; the marksman punishes moving hardest.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  p9: { id: 'p9', name: 'P9 sidearm', price: 0, damage: 26, headMul: 2.5, mag: 15, reserve: 60, fireGap: 0.15, reload: 1.4, auto: false, spreadStill: 0.004, spreadMove: 0.02, spreadBloom: 0.004, kick: 0.006, range: 60, barrel: 0.22 },
  vk9: { id: 'vk9', name: 'VK-9 SMG', price: 1500, damage: 22, headMul: 2.5, mag: 28, reserve: 112, fireGap: 0.075, reload: 1.9, auto: true, spreadStill: 0.006, spreadMove: 0.03, spreadBloom: 0.003, kick: 0.005, range: 55, barrel: 0.34 },
  ar77: { id: 'ar77', name: 'AR-77 rifle', price: 2700, damage: 34, headMul: 2.5, mag: 30, reserve: 90, fireGap: 0.1, reload: 2.1, auto: true, spreadStill: 0.0025, spreadMove: 0.028, spreadBloom: 0.0035, kick: 0.009, range: 80, barrel: 0.44 },
  lw50: { id: 'lw50', name: 'LW-50 marksman', price: 4750, damage: 82, headMul: 2.4, mag: 5, reserve: 20, fireGap: 0.95, reload: 2.8, auto: false, spreadStill: 0.0008, spreadMove: 0.05, spreadBloom: 0.02, kick: 0.02, range: 90, barrel: 0.62 },
};

const GRENADE_PRICE = 300;
const GRENADE_MAX = 2;
const GRENADE_FUSE = 1.4;
const GRENADE_RADIUS = 6.5;
const GRENADE_DAMAGE = 120;

export function createArsenal(camera, events) {
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });

  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = new THREE.Group();
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.3 + def.barrel * 0.3), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, def.barrel), grip);
    barrel.position.set(0, 0.025, -0.2 - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.08, 0.22), grip);
    stock.position.set(0, -0.02, 0.28);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.06), accentMat);
    sight.position.set(0, 0.08, -0.05);
    model.add(receiver, barrel, stock, sight);
    model.position.set(0.24, -0.2, -0.42);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  // Muzzle flash: a starburst drawn on canvas, so it reads as a flash and
  // not as a rotated square.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 128;
  flashCanvas.height = 128;
  const flashCtx = flashCanvas.getContext('2d');
  const glow = flashCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
  glow.addColorStop(0, 'rgba(255,240,200,1)');
  glow.addColorStop(0.35, 'rgba(242,163,60,0.9)');
  glow.addColorStop(1, 'rgba(242,163,60,0)');
  flashCtx.fillStyle = glow;
  flashCtx.fillRect(0, 0, 128, 128);
  flashCtx.fillStyle = 'rgba(255,220,150,0.95)';
  for (let i = 0; i < 4; i += 1) {
    flashCtx.save();
    flashCtx.translate(64, 64);
    flashCtx.rotate((i * Math.PI) / 2);
    flashCtx.beginPath();
    flashCtx.moveTo(-7, 0);
    flashCtx.lineTo(0, -58);
    flashCtx.lineTo(7, 0);
    flashCtx.closePath();
    flashCtx.fill();
    flashCtx.restore();
  }
  const flashTexture = new THREE.CanvasTexture(flashCanvas);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ map: flashTexture, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.18, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const state = {
    current: 'p9',
    mag: WEAPONS.p9.mag,
    reserve: WEAPONS.p9.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    grenades: 0,
    throwCooldown: 0,
  };
  const grenades = [];
  let activeModel = models.p9;
  activeModel.visible = true;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.throwCooldown = Math.max(0, state.throwCooldown - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    activeModel.position.z = -0.42 + state.kick;
    activeModel.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.current];
      activeModel.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  function stepGrenades(dt, onExplode) {
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.fuse -= dt;
      grenade.velocity.y -= 14 * dt;
      grenade.position.addScaledVector(grenade.velocity, dt);
      if (grenade.position.y < 0.12) {
        grenade.position.y = 0.12;
        grenade.velocity.multiplyScalar(0.45);
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.3;
      }
      grenade.mesh.position.copy(grenade.position);
      grenade.mesh.rotation.x += dt * 7;
      grenade.mesh.rotation.z += dt * 5;
      if (grenade.fuse <= 0) {
        grenades.splice(i, 1);
        grenade.mesh.parent?.remove(grenade.mesh);
        onExplode(grenade.position.clone());
      }
    }
  }

  return {
    state,
    def() {
      return WEAPONS[state.current];
    },
    grenades,
    step,
    stepGrenades,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      const def = WEAPONS[state.current];
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055;
      state.bloom = Math.min(0.05, state.bloom + def.spreadBloom);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.current];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return false;
      state.reloadLeft = def.reload;
      events.onReload();
      return true;
    },
    spread(speed) {
      const def = WEAPONS[state.current];
      return def.spreadStill + Math.min(1, speed / 5.2) * def.spreadMove + state.bloom;
    },
    equip(id) {
      if (!WEAPONS[id] || id === state.current) return false;
      activeModel.visible = false;
      state.current = id;
      activeModel = models[id];
      activeModel.visible = true;
      state.mag = WEAPONS[id].mag;
      state.reserve = WEAPONS[id].reserve;
      state.cooldown = 0.25;
      state.reloadLeft = 0;
      return true;
    },
    buyGrenade() {
      if (state.grenades >= GRENADE_MAX) return false;
      state.grenades += 1;
      return true;
    },
    throwGrenade(origin, direction) {
      if (state.grenades <= 0 || state.throwCooldown > 0) return null;
      state.grenades -= 1;
      state.throwCooldown = 0.8;
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 10, 8),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.enemy), roughness: 0.5, metalness: 0.4 }),
      );
      mesh.position.copy(origin);
      camera.parent.add(mesh);
      const grenade = {
        position: origin.clone(),
        velocity: direction.clone().multiplyScalar(11).add(new THREE.Vector3(0, 3.4, 0)),
        fuse: GRENADE_FUSE,
        mesh,
      };
      grenades.push(grenade);
      events.onThrow();
      return grenade;
    },
    refillPistol() {
      this.equip('p9');
      state.mag = WEAPONS.p9.mag;
      state.reserve = WEAPONS.p9.reserve;
      state.grenades = 0;
    },
  };
}

export { GRENADE_PRICE, GRENADE_MAX, GRENADE_RADIUS, GRENADE_DAMAGE };
