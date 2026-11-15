// The DOM HUD: crosshair, hit marker, health and armour, ammo, money, the
// round timer and score, the kill feed, the buy menu, the minimap and the
// overlays. It never touches the simulation; main.js pushes numbers in and
// reads the play callback out. The minimap is a top-down canvas drawn from
// the world's colliders, so the map the player sees is the map they play.
import { WEAPONS, GRENADE_PRICE } from './weapons.js';

const BUY_ITEMS = [
  { key: 'Digit1', id: 'vk9', label: 'VK-9 SMG' },
  { key: 'Digit2', id: 'ar77', label: 'AR-77 rifle' },
  { key: 'Digit3', id: 'lw50', label: 'LW-50 marksman' },
  { key: 'Digit4', id: 'grenade', label: 'Frag grenade' },
  { key: 'Digit5', id: 'vest', label: 'Kevlar vest' },
];

const OVERLAY_COPY = {
  start: {
    title: 'IRONLINE',
    copy: 'Foundry Row: three STRIKERS against four JACKALS. Carry the charge to site A or B, plant it, and hold the fuse — or wipe their team out. First to five rounds takes the match.',
    action: 'Click to play',
  },
  paused: {
    title: 'IRONLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  round: {
    title: 'Round over',
    copy: '',
    action: 'Next round',
  },
  end: {
    title: 'Match over',
    copy: '',
    action: 'Play again',
  },
};

export function createHud(world) {
  const el = (id) => document.getElementById(id);
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayCopy = el('overlay-copy');
  const playButton = el('play');
  const crosshair = el('crosshair');
  const hitmarker = el('hitmarker');
  const vignette = el('vignette');
  const healthNum = el('health-num');
  const healthFill = el('health-fill');
  const armorNum = el('armor-num');
  const armorFill = el('armor-fill');
  const ammoMag = el('ammo-mag');
  const ammoReserve = el('ammo-reserve');
  const weaponName = el('weapon-name');
  const grenadeCount = el('grenade-count');
  const moneyValue = el('money-value');
  const timerValue = el('timer-value');
  const scoreStrikers = el('score-strikers');
  const scoreJackals = el('score-jackals');
  const roundNum = el('round-num');
  const aliveStrikers = el('alive-strikers');
  const aliveJackals = el('alive-jackals');
  const feedList = el('feed');
  const bombStatus = el('bomb-status');
  const channelWrap = el('channel');
  const channelLabel = el('channel-label');
  const channelFill = el('channel-fill');
  const buyPanel = el('buy');
  const buyItems = el('buy-items');
  const buyMoney = el('buy-money');
  const banner = el('banner');
  const bannerTitle = el('banner-title');
  const bannerSub = el('banner-sub');
  const minimap = el('minimap');
  const mapCtx = minimap.getContext('2d');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastMag = -1;
  let lastReserve = -1;
  let lastMoney = -1;
  let lastTimer = -1;
  let lastScore = '';

  // Build the buy menu rows once; refreshBuy updates their states.
  const buyRows = {};
  for (const item of BUY_ITEMS) {
    const row = document.createElement('div');
    row.className = 'buy-row';
    const price = item.id === 'grenade' ? GRENADE_PRICE : item.id === 'vest' ? 650 : WEAPONS[item.id].price;
    row.innerHTML = `<span class="buy-key">${item.key.replace('Digit', '')}</span><span class="buy-name">${item.label}</span><span class="buy-price">$${price}</span>`;
    buyItems.appendChild(row);
    buyRows[item.id] = row;
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    setHealth(health, armor) {
      healthNum.textContent = String(Math.max(0, Math.ceil(health)));
      healthFill.style.width = `${Math.max(0, health)}%`;
      armorNum.textContent = String(Math.max(0, Math.ceil(armor)));
      armorFill.style.width = `${Math.max(0, Math.min(100, armor))}%`;
    },
    setAmmo(mag, reserve, weapon, grenades) {
      if (mag === lastMag && reserve === lastReserve) return;
      lastMag = mag;
      lastReserve = reserve;
      ammoMag.textContent = String(mag);
      ammoReserve.textContent = `/ ${reserve}`;
      weaponName.textContent = weapon;
      grenadeCount.textContent = `◉ ${grenades}`;
      el('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(money) {
      if (money === lastMoney) return;
      lastMoney = money;
      moneyValue.textContent = `$${money}`;
      buyMoney.textContent = `$${money}`;
    },
    setTimer(seconds, phase) {
      const text = formatTime(seconds);
      if (text === lastTimer) return;
      lastTimer = text;
      timerValue.textContent = text;
      timerValue.classList.toggle('urgent', phase === 'live' && seconds <= 15);
    },
    setScore(strikers, jackals, round) {
      const text = `${strikers}-${jackals}-${round}`;
      if (text === lastScore) return;
      lastScore = text;
      scoreStrikers.textContent = String(strikers);
      scoreJackals.textContent = String(jackals);
      roundNum.textContent = `ROUND ${round}`;
    },
    setAlive(strikers, jackals) {
      aliveStrikers.textContent = '●'.repeat(Math.max(0, strikers));
      aliveJackals.textContent = '●'.repeat(Math.max(0, jackals));
    },
    setBomb(text) {
      bombStatus.textContent = text;
    },
    setSpread(gapPx) {
      crosshair.style.setProperty('--gap', `${gapPx.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    damageFlash() {
      vignette.classList.add('on');
      setTimeout(() => vignette.classList.remove('on'), 180);
    },
    setFeed(feed) {
      feedList.innerHTML = feed.map((entry) => `<div>${entry.text}</div>`).join('');
    },
    setChannel(label, progress) {
      if (progress === null) {
        channelWrap.hidden = true;
        return;
      }
      channelWrap.hidden = false;
      channelLabel.textContent = label;
      channelFill.style.width = `${Math.round(progress * 100)}%`;
    },
    showBuy(owned, money, grenades) {
      for (const item of BUY_ITEMS) {
        const row = buyRows[item.id];
        const price = item.id === 'grenade' ? GRENADE_PRICE : item.id === 'vest' ? 650 : WEAPONS[item.id].price;
        const has = item.id === 'grenade' ? grenades >= 2 : owned.has(item.id);
        row.classList.toggle('owned', has);
        row.classList.toggle('poor', !has && money < price);
      }
      buyMoney.textContent = `$${money}`;
      buyPanel.hidden = false;
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    showBanner(title, sub, holdMs = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    hideBanner() {
      banner.hidden = true;
      clearTimeout(bannerTimer);
    },
    showOverlay(mode, detail = '') {
      const text = OVERLAY_COPY[mode];
      overlayTitle.textContent = text.title;
      overlayCopy.textContent = detail || text.copy;
      playButton.textContent = text.action;
      overlay.hidden = false;
      playButton.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playButton.addEventListener('click', handler);
    },
    drawMinimap(playerPos, playerYaw, bots, bombPos, seenEnemies) {
      const scale = 4.2;
      const ox = 84;
      const oy = 67;
      mapCtx.clearRect(0, 0, 168, 134);
      mapCtx.fillStyle = 'rgba(10,12,16,0.72)';
      mapCtx.fillRect(0, 0, 168, 134);
      // Walls and crates, top-down.
      mapCtx.fillStyle = '#5a636f';
      for (const collider of world.colliders) {
        const x = ox + collider.min.x * scale;
        const z = oy + collider.min.z * scale;
        const w = (collider.max.x - collider.min.x) * scale;
        const h = (collider.max.z - collider.min.z) * scale;
        if (w < 1 || h < 1) continue;
        mapCtx.fillRect(x, z, Math.max(1, w), Math.max(1, h));
      }
      // Sites.
      for (const [letter, site] of Object.entries(world.sites)) {
        mapCtx.strokeStyle = letter === 'A' ? '#f2a33c' : '#35c4b5';
        mapCtx.lineWidth = 1.5;
        mapCtx.beginPath();
        mapCtx.arc(ox + site.x * scale, oy + site.z * scale, site.r * scale, 0, Math.PI * 2);
        mapCtx.stroke();
        mapCtx.fillStyle = '#ece7db';
        mapCtx.font = 'bold 10px system-ui, sans-serif';
        mapCtx.textAlign = 'center';
        mapCtx.textBaseline = 'middle';
        mapCtx.fillText(letter, ox + site.x * scale, oy + site.z * scale);
      }
      // The charge.
      if (bombPos) {
        mapCtx.fillStyle = '#f2a33c';
        mapCtx.save();
        mapCtx.translate(ox + bombPos.x * scale, oy + bombPos.z * scale);
        mapCtx.rotate(Math.PI / 4);
        mapCtx.fillRect(-3, -3, 6, 6);
        mapCtx.restore();
      }
      // Bots: teammates teal, enemies red only while recently seen.
      for (const bot of bots) {
        if (!bot.alive) continue;
        const x = ox + bot.body.state.position.x * scale;
        const z = oy + bot.body.state.position.z * scale;
        if (bot.team === 'strikers') {
          mapCtx.fillStyle = '#35c4b5';
        } else {
          if (!seenEnemies.has(bot)) continue;
          mapCtx.fillStyle = '#e4572e';
        }
        mapCtx.beginPath();
        mapCtx.arc(x, z, 3, 0, Math.PI * 2);
        mapCtx.fill();
      }
      // The player: a teal wedge pointing where they look.
      const px = ox + playerPos.x * scale;
      const pz = oy + playerPos.z * scale;
      mapCtx.fillStyle = '#ffffff';
      mapCtx.save();
      mapCtx.translate(px, pz);
      mapCtx.rotate(-playerYaw);
      mapCtx.beginPath();
      mapCtx.moveTo(0, -6);
      mapCtx.lineTo(4, 5);
      mapCtx.lineTo(-4, 5);
      mapCtx.closePath();
      mapCtx.fill();
      mapCtx.restore();
    },
  };
}
