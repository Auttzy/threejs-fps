// The match: phases, money, the buy menu and the charge. One object owns the
// score, the round clock and the economy, and tells main.js and the HUD what
// changed through events. First to five rounds takes the match, at most
// nine rounds; a round ends on elimination, on the charge exploding, on a
// defuse, or on the clock running out (defenders hold).
import { WEAPONS, GRENADE_PRICE } from './weapons.js';

const ROUNDS_TO_WIN = 5;
const MAX_ROUNDS = 9;
const ROUND_SECONDS = 100;
const BUY_SECONDS = 12;
const FUSE_SECONDS = 35;
const KILL_REWARD = 300;
const WIN_REWARD = 3250;
const LOSS_REWARD = 1900;
const PLANT_REWARD = 300;

export function createMatch(events) {
  const match = {
    phase: 'lobby',
    round: 0,
    score: { strikers: 0, jackals: 0 },
    phaseTime: 0,
    money: 800,
    owned: new Set(['p9']),
    grenadesOwned: 0,
    bomb: { state: 'carried', carrier: 'player', site: null, plantedAt: 0 },
    feed: [],
  };

  function setPhase(phase, seconds) {
    match.phase = phase;
    match.phaseTime = seconds;
    events.onPhase(phase, match.round, match.score);
  }

  function startMatch() {
    match.round = 0;
    match.score = { strikers: 0, jackals: 0 };
    match.money = 800;
    match.owned = new Set(['p9']);
    match.grenadesOwned = 0;
    match.bomb = { state: 'carried', carrier: 'player', site: null, plantedAt: 0 };
    match.feed = [];
    startRound();
  }

  function startRound() {
    match.round += 1;
    match.bomb = { state: 'carried', carrier: 'player', site: null, plantedAt: 0 };
    events.onRoundStart(match.round);
    setPhase('buy', BUY_SECONDS);
  }

  function endRound(winner, reason) {
    if (match.phase === 'roundEnd' || match.phase === 'matchEnd') return;
    match.score[winner] += 1;
    match.money += winner === 'strikers' ? WIN_REWARD : LOSS_REWARD;
    events.onRoundEnd(winner, reason, match.score, match.round);
    if (match.score[winner] >= ROUNDS_TO_WIN || match.round >= MAX_ROUNDS) {
      const matchWinner = match.score.strikers > match.score.jackals ? 'strikers' : 'jackals';
      setPhase('matchEnd', 0);
      events.onMatchEnd(matchWinner, match.score);
    } else {
      setPhase('roundEnd', 4);
    }
  }

  function awardKill(killer) {
    if (killer === 'player') {
      match.money += KILL_REWARD;
      events.onMoney(match.money);
    }
  }

  function plant(site, time) {
    match.bomb = { state: 'planted', carrier: null, site, plantedAt: time };
    match.money += PLANT_REWARD;
    events.onMoney(match.money);
    events.onPlanted(site);
  }

  function defuse() {
    match.bomb = { state: 'defused', carrier: null, site: null, plantedAt: 0 };
    events.onDefused();
  }

  function explode() {
    match.bomb = { state: 'exploded', carrier: null, site: null, plantedAt: 0 };
    events.onExploded();
  }

  function dropBomb() {
    if (match.bomb.state !== 'carried') return;
    match.bomb = { state: 'dropped', carrier: null, site: null, plantedAt: 0 };
    events.onBombDropped();
  }

  function buy(id) {
    const def = WEAPONS[id];
    if (!def) return false;
    if (match.phase !== 'buy') return false;
    if (match.owned.has(id)) return false;
    if (match.money < def.price) return false;
    match.money -= def.price;
    match.owned.add(id);
    events.onMoney(match.money);
    events.onBought(def);
    return true;
  }

  function spend(amount) {
    if (match.money < amount) return false;
    match.money -= amount;
    events.onMoney(match.money);
    return true;
  }

  function buyGrenade() {
    if (match.phase !== 'buy') return false;
    if (match.grenadesOwned >= 2) return false;
    if (match.money < GRENADE_PRICE) return false;
    match.money -= GRENADE_PRICE;
    match.grenadesOwned += 1;
    events.onMoney(match.money);
    return true;
  }

  function step(dt, time, alive) {
    if (match.phase === 'buy' || match.phase === 'live') {
      match.phaseTime -= dt;
      if (match.phase === 'buy' && match.phaseTime <= 0) {
        setPhase('live', ROUND_SECONDS);
        events.onLive();
      } else if (match.phase === 'live') {
        if (match.bomb.state === 'planted' && time - match.bomb.plantedAt >= FUSE_SECONDS) {
          explode();
          endRound('strikers', 'charge');
          return;
        }
        if (match.phaseTime <= 0) {
          endRound('jackals', 'time');
          return;
        }
        if (alive.strikers === 0) {
          endRound('jackals', 'elimination');
          return;
        }
        if (alive.jackals === 0) {
          endRound('strikers', 'elimination');
          return;
        }
      }
    } else if (match.phase === 'roundEnd') {
      match.phaseTime -= dt;
      if (match.phaseTime <= 0) startRound();
    }
  }

  return {
    match,
    startMatch,
    startRound,
    endRound,
    awardKill,
    plant,
    defuse,
    explode,
    dropBomb,
    buy,
    buyGrenade,
    spend,
    step,
    fuseLeft(time) {
      if (match.bomb.state !== 'planted') return 0;
      return Math.max(0, FUSE_SECONDS - (time - match.bomb.plantedAt));
    },
    addFeed(text) {
      match.feed.unshift({ text, at: performance.now() });
      if (match.feed.length > 5) match.feed.pop();
      events.onFeed(match.feed);
    },
  };
}

export { ROUNDS_TO_WIN, MAX_ROUNDS, ROUND_SECONDS, BUY_SECONDS, FUSE_SECONDS, KILL_REWARD, WIN_REWARD, LOSS_REWARD, PLANT_REWARD };
