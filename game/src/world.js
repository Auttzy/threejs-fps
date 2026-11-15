// Foundry Row: an original industrial yard, 40 x 32 m, built from boxes. The
// STRIKERS spawn south, the JACKALS north. Site A (Furnace) sits west, site B
// (Crane) east, joined by three lanes — west, mid and east — with a wall row
// across each half so every lane is a choice with a sightline. Every box is
// a collider for bodies and a surface a bullet stops on. The waypoint graph
// is what the bots walk: nodes at spawns, lane mouths and sites, edges
// between neighbours, routes by breadth-first search.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const BOUNDS = { x: 20, z: 16 };

function groundTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#454b54';
  ctx.fillRect(0, 0, 1024, 1024);
  // Concrete speckle.
  for (let i = 0; i < 9000; i += 1) {
    const shade = 58 + Math.floor(Math.random() * 42);
    ctx.fillStyle = `rgb(${shade},${shade + 4},${shade + 10})`;
    ctx.fillRect(Math.random() * 1024, Math.random() * 1024, 2, 2);
  }
  // Expansion-joint grid, one cell every 4 m.
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= 10; i += 1) {
    ctx.beginPath(); ctx.moveTo(i * 102, 0); ctx.lineTo(i * 102, 1024); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * 128); ctx.lineTo(1024, i * 128); ctx.stroke();
  }
  // Hazard chevrons around the two sites: A at (-14,-8), B at (14,-8).
  for (const siteX of [-14, 14]) {
    const cx = ((siteX + 20) / 40) * 1024;
    const cy = ((-8 + 16) / 32) * 1024;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.PI / 4);
    for (let i = -6; i < 6; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#c9932b' : '#1d1d1d';
      ctx.fillRect(i * 22, -150, 22, 300);
    }
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function letterSprite(letter, colour) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10,10,12,0.55)';
  ctx.beginPath();
  ctx.arc(128, 128, 118, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(128, 128, 108, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = colour;
  ctx.font = 'bold 150px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 128, 136);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(2.4, 2.4, 1);
  return sprite;
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' || name === 'ink' ? 0.55 : 0.92,
      metalness: 0.04,
    });
  }
  const glowOrange = new THREE.MeshStandardMaterial({ color: new THREE.Color('#7a3c10'), emissive: new THREE.Color('#ff7a1a'), emissiveIntensity: 1.6, roughness: 0.6 });
  const glowTeal = new THREE.MeshStandardMaterial({ color: new THREE.Color('#0d3f3a'), emissive: new THREE.Color(PALETTE.team), emissiveIntensity: 0.9, roughness: 0.6 });

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material] ?? material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground, with the painted yard texture.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(BOUNDS.x * 2 + 0.8, BOUNDS.z * 2 + 0.8),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: 0.95, metalness: 0.02 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);
  colliders.push(new THREE.Box3(new THREE.Vector3(-BOUNDS.x - 0.4, -0.4, -BOUNDS.z - 0.4), new THREE.Vector3(BOUNDS.x + 0.4, 0, BOUNDS.z + 0.4)));

  // Perimeter: 4.5 m walls.
  box(40.8, 4.5, 0.4, 0, 2.25, -16.2, 'wall');
  box(40.8, 4.5, 0.4, 0, 2.25, 16.2, 'wall');
  box(0.4, 4.5, 32.8, -20.2, 2.25, 0, 'wall');
  box(0.4, 4.5, 32.8, 20.2, 2.25, 0, 'wall');

  // South wall row (z = 2): three lane mouths at x = -13, 0 and 13 (3 m wide).
  box(5.5, 3.4, 0.5, -17.25, 1.7, 2, 'wall');
  box(5.5, 3.4, 0.5, 17.25, 1.7, 2, 'wall');
  box(10, 3.4, 0.5, -6.5, 1.7, 2, 'wall');
  box(10, 3.4, 0.5, 6.5, 1.7, 2, 'wall');
  // North wall row (z = -4): mouths at x = -13 (A), 0 (mid) and 13 (B).
  box(5.5, 3.4, 0.5, -17.25, 1.7, -4, 'wall');
  box(5.5, 3.4, 0.5, 17.25, 1.7, -4, 'wall');
  box(10, 3.4, 0.5, -6.5, 1.7, -4, 'wall');
  box(10, 3.4, 0.5, 6.5, 1.7, -4, 'wall');

  // Site A pocket: walls west and north of the furnace, two entries.
  box(0.5, 3.2, 8, -18, 1.6, -8, 'wall');
  box(6, 3.2, 0.5, -15, 1.6, -12, 'wall');
  // Site B pocket, mirrored.
  box(0.5, 3.2, 8, 18, 1.6, -8, 'wall');
  box(6, 3.2, 0.5, 15, 1.6, -12, 'wall');

  // The furnace at A: a glowing foundry block with a chimney.
  const furnace = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.6, 2.2), glowOrange);
  furnace.position.set(-16.4, 1.3, -8);
  furnace.castShadow = true;
  group.add(furnace);
  colliders.push(new THREE.Box3().setFromObject(furnace));
  shootables.push(furnace);
  const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.65, 4.5, 10), materials.hairline);
  chimney.position.set(-16.4, 4.4, -8);
  chimney.castShadow = true;
  group.add(chimney);
  colliders.push(new THREE.Box3().setFromObject(chimney));

  // The crane at B: two legs, a top beam, a hanging hook block.
  box(0.7, 5.2, 0.7, 12.4, 2.6, -10.6, 'accent');
  box(0.7, 5.2, 0.7, 15.6, 2.6, -10.6, 'accent');
  box(4.2, 0.6, 0.9, 14, 5.4, -10.6, 'accent');
  box(0.9, 1.1, 0.9, 14, 4.2, -10.6, 'hairline');

  // Mid machine block and pipes (2 m, small enough to walk around).
  box(2.0, 1.0, 2.0, 0, 0.5, -1, 'hairline');
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 2.0, 10), materials.accent);
  pipe.rotation.z = Math.PI / 2;
  pipe.position.set(0, 1.25, -1);
  pipe.castShadow = true;
  group.add(pipe);
  colliders.push(new THREE.Box3().setFromObject(pipe));

  // Crates: 1.1 m crouch cover, 2.2 m tall stacks, long containers.
  // Kept clear of the waypoint graph (see the map check in /tmp).
  const crates = [
    [-8, 0.55, 7, 1.1, 1.1, 1.1], [8, 0.55, 7, 1.1, 1.1, 1.1],
    [-8, 0.55, -2.5, 1.1, 1.1, 1.1], [8, 0.55, -2.5, 1.1, 1.1, 1.1],
    [-3, 0.55, 6, 2.2, 1.1, 1.1], [3, 0.55, 6, 2.2, 1.1, 1.1],
    [-10.5, 0.45, -9.5, 1.6, 0.9, 1.6], [10.5, 0.45, -9.5, 1.6, 0.9, 1.6],
    [-17, 1.2, 2, 2.4, 2.4, 2.4], [17, 1.2, 2, 2.4, 2.4, 2.4],
  ];
  for (const [x, y, z, w, h, d] of crates) box(w, h, d, x, y, z, 'surface');

  // Barrels: cylinders, collided as boxes.
  const barrelGeometry = new THREE.CylinderGeometry(0.42, 0.42, 1.15, 12);
  for (const [x, z] of [[-2.5, 9.5], [2.5, 9.5], [-13, -11], [13, -11], [-6, -7], [6, -7]]) {
    const barrel = new THREE.Mesh(barrelGeometry, materials.accent);
    barrel.position.set(x, 0.58, z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    group.add(barrel);
    colliders.push(new THREE.Box3().setFromObject(barrel));
    shootables.push(barrel);
  }

  // Site markers: a glowing ring on the floor and a floating letter.
  function siteMarker(x, z, letter, colour) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 3.1, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(colour), transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.03, z);
    group.add(ring);
    const sprite = letterSprite(letter, colour);
    sprite.position.set(x, 3.4, z);
    group.add(sprite);
  }
  siteMarker(-14, -8, 'A', PALETTE.accent);
  siteMarker(14, -8, 'B', PALETTE.team);

  // Distant skyline silhouettes outside the walls, for the dusk read.
  for (const [x, z, h] of [[-30, -20, 9], [-14, -26, 13], [4, -24, 8], [22, -22, 11], [30, 4, 9], [-28, 10, 7]]) {
    const tower = new THREE.Mesh(new THREE.BoxGeometry(6, h, 6), materials.surface);
    tower.position.set(x, h / 2 - 0.5, z);
    group.add(tower);
  }

  // Light: a low amber sun from the south-east, a cool sky fill, warm site glows.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8fa3c7'), new THREE.Color('#2a2620'), 1.25);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb066'), 3.2);
  sun.position.set(18, 22, 18);
  sun.target.position.set(0, 0, -2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -26;
  sun.shadow.camera.right = 26;
  sun.shadow.camera.top = 26;
  sun.shadow.camera.bottom = -26;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const furnaceLight = new THREE.PointLight(new THREE.Color('#ff7a1a'), 26, 16, 1.8);
  furnaceLight.position.set(-14, 2.4, -8);
  scene.add(furnaceLight);
  const craneLight = new THREE.PointLight(new THREE.Color(PALETTE.team), 14, 14, 1.8);
  craneLight.position.set(14, 3.2, -8);
  scene.add(craneLight);

  // Waypoint graph: [id, x, z, neighbours...].
  const nodeDefs = [
    ['atkSpawn', 0, 13, ['atkWest', 'atkMid', 'atkEast']],
    ['atkWest', -13, 11, ['atkSpawn', 'west1', 'west2']],
    ['atkMid', 0, 10, ['atkSpawn', 'mid1']],
    ['atkEast', 13, 11, ['atkSpawn', 'east1', 'east2']],
    ['west1', -13, 5, ['atkWest', 'west2']],
    ['west2', -13, -1, ['west1', 'aApproach', 'westMid']],
    ['aApproach', -13, -3, ['west2', 'aSite']],
    ['aSite', -13, -8, ['aApproach']],
    ['mid1', 0, 5, ['atkMid', 'midGate']],
    ['midGate', 0, 2, ['mid1', 'mid2', 'mid2w']],
    ['mid2', 4, -1, ['midGate', 'midGateN', 'eastMid']],
    ['mid2w', -4, -1, ['midGate', 'midGateN', 'westMid']],
    ['midGateN', 0, -4, ['mid2', 'mid2w', 'midNorth']],
    ['midNorth', 0, -6, ['midGateN', 'defA', 'defB']],
    ['east1', 13, 5, ['atkEast', 'east2']],
    ['east2', 13, -1, ['east1', 'bApproach', 'eastMid']],
    ['bApproach', 13, -3, ['east2', 'bSite']],
    ['bSite', 13, -8, ['bApproach']],
    ['westMid', -6, 0.5, ['west2', 'mid2w']],
    ['eastMid', 6, 0.5, ['east2', 'mid2']],
    ['defSpawn', 0, -13, ['defA', 'defB']],
    ['defA', -8, -9, ['midNorth', 'defSpawn']],
    ['defB', 8, -9, ['midNorth', 'defSpawn']],
  ];
  const nodes = new Map();
  for (const [id, x, z, neighbours] of nodeDefs) nodes.set(id, { id, x, z, neighbours });

  function nearestNode(x, z) {
    let best = null;
    let bestDist = Infinity;
    for (const node of nodes.values()) {
      const d = (node.x - x) ** 2 + (node.z - z) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = node;
      }
    }
    return best;
  }

  // Breadth-first route from one node id to another, as a list of {x, z}.
  function route(fromId, toId) {
    if (fromId === toId) return [nodes.get(toId)];
    const cameFrom = new Map([[fromId, null]]);
    const queue = [fromId];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === toId) break;
      for (const next of nodes.get(current).neighbours) {
        if (!cameFrom.has(next)) {
          cameFrom.set(next, current);
          queue.push(next);
        }
      }
    }
    if (!cameFrom.has(toId)) return [nodes.get(toId)];
    const path = [];
    let cursor = toId;
    while (cursor !== null) {
      path.unshift(nodes.get(cursor));
      cursor = cameFrom.get(cursor);
    }
    return path;
  }

  return {
    colliders,
    shootables,
    group,
    bounds: BOUNDS,
    sites: {
      A: { x: -14, z: -8, r: 3.6 },
      B: { x: 14, z: -8, r: 3.6 },
    },
    spawns: {
      strikers: [[-2, 13.5], [0, 14.2], [2, 13.5]],
      jackals: [[-2, -13.5], [0, -14.2], [2, -13.5], [-5, -12.5]],
    },
    nodes,
    nearestNode,
    route,
  };
}
