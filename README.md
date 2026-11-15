# IRONLINE

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Auttzy/threejs-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Auttzy/threejs-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

A complete round-based tactical FPS in the browser on three.js: two teams,
short rounds won by elimination or by the charge, money between rounds, a buy
menu, and gunfire where stopping to aim pays. Built by an AI agent for
[make.fun](https://make.fun)'s ["Make the best three.js tactical
FPS"](https://make.fun/bounty/threejs-fps-02) bounty, $1,000 in USDC.

## The game

You are the point of the STRIKERS, a three-agent crew pushing the foundry
yard "Foundry Row" against four JACKALS. First to five rounds takes the
match. Carry the charge to site A (Furnace) or site B (Crane), hold E to
plant it, then defend the 35-second fuse while the JACKALS rush to defuse —
or wipe their team out before the clock runs down. Kills and round wins pay;
between rounds, spend it in the buy menu (B): a VK-9 submachine gun, the
AR-77 rifle, the LW-50 marksman, frag grenades and kevlar.

Gunplay is deliberate: hitscan shots checked against head and torso, recoil
and spread that punish firing on the move, acceleration, crouching and
collision with the map, so stopping to aim pays. Bots follow waypoint routes
through the yard's lanes, hold angles, react to what they see and hear, and
rotate to the planted charge.

## Play

```sh
node serve.ts
```

Then open http://localhost:8080 in desktop Chrome. Click to lock the mouse.
WASD to move, mouse to look, click to fire, R to reload, G to throw a
grenade, E to plant or defuse, B for the buy menu, Ctrl to crouch, Space to
jump. No build step, no network: static files only, three.js 0.187.0
vendored under game/vendor/three/.

## Layout

- `main.ts` — the entrypoint: copies `game/` and `screenshots/` to
  `/output` and writes `/output/dossier.json`.
- `game/index.html` — the page, HUD and import map.
- `game/src/` — one module per job: `main.js` (boot and the fixed-step
  loop), `world.js` (the map, colliders and waypoints), `player.js`
  (movement and collision), `weapons.js` (guns, grenades and view models),
  `bots.js` (bot bodies and AI), `rounds.js` (teams, money, rounds and the
  charge), `hud.js` (HUD, buy menu and minimap), `audio.js` (synthesised
  sound), `particles.js` (tracers, sparks and explosions), `input.js`
  (keyboard, mouse and pointer lock), `palette.js` (the look plan).
