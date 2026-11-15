// Tracers, impact sparks and explosions. Everything is pooled geometry
// that fades and is removed; nothing is allocated in the hot loop beyond the
// first frames. main.js and bots.js push effects in, step() ages them out.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export function createParticles(scene) {
  const tracers = [];
  const sparks = [];
  const blasts = [];
  const tracerMaterial = new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 });
  const sparkGeometry = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const sparkMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent) });

  function tracer(from, to) {
    const geometry = new THREE.BufferGeometry().setFromPoints([from, to]);
    const line = new THREE.Line(geometry, tracerMaterial.clone());
    scene.add(line);
    tracers.push({ line, life: 0.07 });
  }

  function impact(point, normal) {
    for (let i = 0; i < 6; i += 1) {
      const spark = new THREE.Mesh(sparkGeometry, sparkMaterial);
      spark.position.copy(point).addScaledVector(normal, 0.03);
      scene.add(spark);
      sparks.push({
        mesh: spark,
        life: 0.25 + Math.random() * 0.15,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3 + normal.x * 2, Math.random() * 2.5 + 0.5, (Math.random() - 0.5) * 3 + normal.z * 2),
      });
    }
  }

  function explosion(point) {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(1, 18, 12),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.85, depthWrite: false }),
    );
    sphere.position.copy(point);
    sphere.position.y = Math.max(0.6, point.y);
    scene.add(sphere);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.accent), 60, 18, 1.6);
    light.position.copy(sphere.position);
    scene.add(light);
    blasts.push({ mesh: sphere, light, life: 0.5, radius: 6.5 });
    impact(point, new THREE.Vector3(0, 1, 0));
  }

  function step(dt) {
    for (let i = tracers.length - 1; i >= 0; i -= 1) {
      const tracerEntry = tracers[i];
      tracerEntry.life -= dt;
      tracerEntry.line.material.opacity = Math.max(0, tracerEntry.life / 0.07) * 0.9;
      if (tracerEntry.life <= 0) {
        scene.remove(tracerEntry.line);
        tracerEntry.line.geometry.dispose();
        tracerEntry.line.material.dispose();
        tracers.splice(i, 1);
      }
    }
    for (let i = sparks.length - 1; i >= 0; i -= 1) {
      const spark = sparks[i];
      spark.life -= dt;
      spark.velocity.y -= 9 * dt;
      spark.mesh.position.addScaledVector(spark.velocity, dt);
      if (spark.life <= 0) {
        scene.remove(spark.mesh);
        sparks.splice(i, 1);
      }
    }
    for (let i = blasts.length - 1; i >= 0; i -= 1) {
      const blast = blasts[i];
      blast.life -= dt;
      const progress = 1 - blast.life / 0.5;
      const scale = 0.4 + progress * blast.radius;
      blast.mesh.scale.setScalar(scale);
      blast.mesh.material.opacity = Math.max(0, 0.85 * (1 - progress));
      blast.light.intensity = Math.max(0, 60 * (1 - progress));
      if (blast.life <= 0) {
        scene.remove(blast.mesh);
        scene.remove(blast.light);
        blasts.splice(i, 1);
      }
    }
  }

  return { tracer, impact, explosion, step };
}
