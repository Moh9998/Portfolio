// The solar system: sun, planets with continents, the ship and the camera choreography.
import * as THREE from "three";
import { planetShader, cloudShader, atmosphereShader, sunShader, nebulaShader, MAX_CONTINENTS } from "./shaders.js";

// Visual identity of each planet. Content (names, continents) comes from the DOM.
export const PLANET_LOOKS = {
  home: {
    radius: 11, orbit: 70, angle: 0.4, y: 4, seed: 1.3, tilt: 0.25,
    ocean: "#1b6ca8", deep: "#071c3d", glow: "#6ee7ff", atmosphere: "#7cc8ff", clouds: 0.0,
    continents: ["#5fbf6a", "#d9b56b", "#9bd16a"],
  },
  about: {
    radius: 9, orbit: 108, angle: 1.75, y: -6, seed: 4.7, tilt: -0.3,
    ocean: "#8a2f6b", deep: "#2a0626", glow: "#ffd1f0", atmosphere: "#ff9ad5", clouds: -0.1,
    continents: ["#f5c6a5", "#e6799f", "#c9a0ff"],
  },
  skills: {
    radius: 14, orbit: 150, angle: 3.15, y: 8, seed: 8.1, tilt: 0.15, ring: "#f6ad55",
    ocean: "#2a6b5f", deep: "#082320", glow: "#ffd27a", atmosphere: "#ffd59a", clouds: -0.15,
    continents: ["#d98a3d", "#58c4a8", "#4b7bd6", "#a8a35a", "#d1503f"],
  },
  resume: {
    radius: 12, orbit: 192, angle: 4.45, y: -3, seed: 2.9, tilt: -0.2,
    ocean: "#3b2a7a", deep: "#0d0726", glow: "#d9c2ff", atmosphere: "#b28cff", clouds: -0.05,
    continents: ["#e2d4a8", "#8fd3c7", "#f0a35e", "#c46ad6", "#6fb3e0", "#e0cf5f", "#a0c16a"],
  },
  contact: {
    radius: 10, orbit: 232, angle: 5.7, y: 5, seed: 6.6, tilt: 0.35, ring: "#9ad0ff",
    ocean: "#11507a", deep: "#03142a", glow: "#a8e6ff", atmosphere: "#63b3ed", clouds: 0.05,
    continents: ["#cfe8ff", "#7fe0b8", "#f2c46d"],
  },
};

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// Spread n points evenly over a sphere, then turn the whole set by a seeded rotation
function continentCenters(n, seed) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    pts.push(new THREE.Vector3(Math.cos(th) * r, y * 0.85, Math.sin(th) * r).normalize());
  }
  const rot = new THREE.Quaternion().setFromEuler(new THREE.Euler(seed * 1.7, seed * 2.3, seed * 0.9));
  return pts.map((p) => p.applyQuaternion(rot));
}

function glowTexture(inner, outer) {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.25, outer);
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class World {
  constructor(canvas, planetsData, { reducedMotion }) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 6000);
    this.clock = new THREE.Clock();
    this.time = 0;

    this.sunPos = new THREE.Vector3(0, 0, 0);
    this.planets = new Map();
    this.current = null;     // planet id the ship is at
    this.travel = null;      // active flight
    this.viewOffset = { x: 0, y: 0, tx: 0, ty: 0 };
    this.panelInset = { x: 0, y: 0 };
    this.onArrive = null;

    this.buildBackdrop();
    this.buildSun();
    planetsData.forEach((p) => this.buildPlanet(p));
    this.buildShip();

    // Opening shot: wide view of the system, ship coming in from deep space
    this.ship.position.set(-80, 70, 360);
    this.camera.position.set(0, 220, 520);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camera.lookAt(this.camLook);

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  // ---------- construction ----------

  buildBackdrop() {
    const neb = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 48, 32),
      new THREE.ShaderMaterial({ ...nebulaShader, side: THREE.BackSide, depthWrite: false })
    );
    this.scene.add(neb);

    const count = 5000;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      tmpV.randomDirection().multiplyScalar(1400 + Math.random() * 1200);
      pos.set([tmpV.x, tmpV.y, tmpV.z], i * 3);
      c.setHSL(0.55 + Math.random() * 0.2 - (Math.random() < 0.2 ? 0.5 : 0), 0.6, 0.75 + Math.random() * 0.25);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    this.scene.add(this.stars);

    // Dust that streaks past during warp
    const dust = 600;
    const dpos = new Float32Array(dust * 3);
    for (let i = 0; i < dust; i++) dpos.set([(Math.random() - 0.5) * 600, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 600], i * 3);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.6, color: 0x9fd8ff, transparent: true, opacity: 0.5, depthWrite: false }));
    this.scene.add(this.dust);

    this.scene.add(new THREE.AmbientLight(0x8090c0, 0.35));
  }

  buildSun() {
    this.sunUniforms = { uTime: { value: 0 } };
    const sun = new THREE.Mesh(new THREE.SphereGeometry(16, 64, 48), new THREE.ShaderMaterial({ ...sunShader, uniforms: this.sunUniforms }));
    this.scene.add(sun);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(255,230,170,1)", "rgba(255,140,40,0.35)"), blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(140);
    this.scene.add(glow);
    const light = new THREE.PointLight(0xfff1dd, 3, 0, 0);
    this.scene.add(light);
  }

  buildPlanet(data) {
    const look = PLANET_LOOKS[data.id];
    const n = Math.min(data.continents.length, MAX_CONTINENTS);
    const centers = continentCenters(n, look.seed);
    const radius = Math.acos(1 - 0.7 / Math.max(n, 2));

    const group = new THREE.Group();
    group.position.set(Math.cos(look.angle) * look.orbit, look.y, Math.sin(look.angle) * look.orbit);
    this.scene.add(group);

    // The spinning body; its quaternion is what we steer to show a continent
    const body = new THREE.Group();
    group.add(body);

    const pad = (arr, fill) => { const out = arr.slice(); while (out.length < MAX_CONTINENTS) out.push(fill); return out; };
    const uniforms = {
      uCenters: { value: pad(centers, new THREE.Vector3(0, 1, 0)) },
      uRadii: { value: pad(centers.map(() => radius), 0) },
      uColors: { value: pad(centers.map((_, i) => new THREE.Color(look.continents[i % look.continents.length])), new THREE.Color()) },
      uCount: { value: n },
      uActive: { value: -1 },
      uHover: { value: -1 },
      uOcean: { value: new THREE.Color(look.ocean) },
      uOceanDeep: { value: new THREE.Color(look.deep) },
      uGlow: { value: new THREE.Color(look.glow) },
      uSunPos: { value: this.sunPos },
      uSeed: { value: look.seed },
      uTime: { value: 0 },
    };
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(look.radius, 128, 96), new THREE.ShaderMaterial({ ...planetShader, uniforms }));
    body.add(mesh);

    const cloudUniforms = { uSunPos: { value: this.sunPos }, uSeed: { value: look.seed + 3 }, uTime: { value: 0 }, uDensity: { value: look.clouds } };
    const clouds = new THREE.Mesh(
      new THREE.SphereGeometry(look.radius * 1.025, 96, 64),
      new THREE.ShaderMaterial({ ...cloudShader, uniforms: cloudUniforms, transparent: true, depthWrite: false })
    );
    body.add(clouds);

    const atmo = new THREE.Mesh(
      new THREE.SphereGeometry(look.radius * 1.12, 64, 48),
      new THREE.ShaderMaterial({ ...atmosphereShader, uniforms: { uColor: { value: new THREE.Color(look.atmosphere) }, uSunPos: { value: this.sunPos } }, transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false })
    );
    group.add(atmo);

    if (look.ring) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(look.radius * 1.45, look.radius * 2.2, 128, 1),
        new THREE.MeshBasicMaterial({ color: look.ring, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })
      );
      ring.rotation.x = Math.PI / 2 + look.tilt;
      ring.rotation.y = look.tilt * 0.5;
      group.add(ring);
    }

    // Faint orbit line
    const orbitPts = [];
    for (let i = 0; i <= 256; i++) {
      const a = (i / 256) * Math.PI * 2;
      orbitPts.push(new THREE.Vector3(Math.cos(a) * look.orbit, look.y * Math.cos(a - look.angle), Math.sin(a) * look.orbit));
    }
    const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(orbitPts), new THREE.LineBasicMaterial({ color: look.glow, transparent: true, opacity: 0.12 }));
    this.scene.add(orbit);

    body.quaternion.setFromEuler(new THREE.Euler(look.tilt, look.seed, 0));

    this.planets.set(data.id, {
      ...data, look, group, body, mesh, clouds, uniforms, cloudUniforms, centers,
      targetQuat: body.quaternion.clone(), free: false, spin: 0.02,
    });
  }

  buildShip() {
    const ship = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0xdfe6f5, metalness: 0.6, roughness: 0.35 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x2a3350, metalness: 0.5, roughness: 0.5 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x6ee7ff, emissive: 0x2bb7d6, emissiveIntensity: 0.8 });

    const body = new THREE.Mesh(new THREE.ConeGeometry(0.55, 2.6, 16), hull);
    body.rotation.x = Math.PI / 2; // nose along +Z
    ship.add(body);
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 0.8, 16), dark);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = -1.6;
    ship.add(tail);
    const cockpit = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), accent);
    cockpit.scale.set(1, 0.7, 1.6);
    cockpit.position.set(0, 0.32, 0.1);
    ship.add(cockpit);
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, 0.6); wingShape.lineTo(1.9, -0.9); wingShape.lineTo(1.9, -1.3); wingShape.lineTo(0, -1.0);
    const wingGeo = new THREE.ExtrudeGeometry(wingShape, { depth: 0.08, bevelEnabled: false });
    [1, -1].forEach((s) => {
      const w = new THREE.Mesh(wingGeo, hull);
      w.rotation.x = -Math.PI / 2;
      w.scale.x = s;
      w.position.set(0, -0.04, -0.5);
      ship.add(w);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.7), accent);
      tip.position.set(1.9 * s, 0.05, -1.55);
      ship.add(tip);
    });
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.8), dark);
    fin.position.set(0, 0.45, -1.4);
    ship.add(fin);

    this.flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(220,250,255,1)", "rgba(60,180,255,0.6)"), blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flame.position.z = -2.2;
    this.flame.scale.setScalar(1.6);
    ship.add(this.flame);

    ship.scale.setScalar(0.9);
    this.scene.add(ship);
    this.ship = ship;

    // Trail
    this.trailLen = 90;
    this.trailPts = new Float32Array(this.trailLen * 3);
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(this.trailPts, 3));
    const alphas = new Float32Array(this.trailLen);
    for (let i = 0; i < this.trailLen; i++) alphas[i] = 1 - i / this.trailLen;
    tg.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
    this.trail = new THREE.Line(tg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: "attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "varying float vA; void main(){ gl_FragColor = vec4(0.45,0.85,1.0, vA*vA*0.8); }",
    }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
    this.trailInit = false;
  }

  // ---------- geometry helpers ----------

  // Where the camera sits when looking at a planet: sun-side, a little off-axis, slightly above
  viewPose(id, out = { pos: new THREE.Vector3(), look: new THREE.Vector3() }) {
    const p = this.planets.get(id);
    const c = p.group.position;
    const toSun = tmpV.copy(this.sunPos).sub(c).normalize();
    const side = tmpV2.crossVectors(toSun, UP).normalize();
    const dir = new THREE.Vector3().addScaledVector(toSun, 0.75).addScaledVector(side, 0.62).addScaledVector(UP, 0.28).normalize();
    // Portrait screens need more distance to fit the planet's width
    const fit = Math.max(1, 0.8 / this.camera.aspect);
    out.pos.copy(c).addScaledVector(dir, p.look.radius * 3.6 * fit);
    out.look.copy(c);
    return out;
  }

  shipParking(id, t, out = new THREE.Vector3()) {
    const p = this.planets.get(id);
    const r = p.look.radius * 1.75;
    const a = t * 0.25;
    out.set(Math.cos(a) * r, Math.sin(a * 1.3) * r * 0.25 + r * 0.25, Math.sin(a) * r).add(p.group.position);
    return out;
  }

  // Rotation that brings a continent to face the camera with the planet's north kept up
  focusQuat(p, index) {
    const camDir = tmpV.copy(this.viewPose(p.id).pos).sub(p.group.position).normalize();
    const q1 = new THREE.Quaternion().setFromUnitVectors(p.centers[index], camDir);
    const north = new THREE.Vector3(0, 1, 0).applyQuaternion(q1);
    const a = north.clone().addScaledVector(camDir, -north.dot(camDir));
    const b = UP.clone().addScaledVector(camDir, -UP.dot(camDir));
    if (a.lengthSq() > 1e-4 && b.lengthSq() > 1e-4) {
      a.normalize(); b.normalize();
      const ang = Math.atan2(tmpV2.crossVectors(a, b).dot(camDir), a.dot(b));
      q1.premultiply(tmpQ.setFromAxisAngle(camDir, ang));
    }
    return q1;
  }

  // ---------- navigation ----------

  focusContinent(id, index) {
    const p = this.planets.get(id);
    if (!p) return;
    p.uniforms.uActive.value = index;
    p.targetQuat.copy(this.focusQuat(p, index));
    p.free = false;
    if (this.reducedMotion) p.body.quaternion.copy(p.targetQuat);
  }

  flyTo(id, { first = false } = {}) {
    if (id === this.current && !this.travel) return Promise.resolve();
    const to = this.planets.get(id);
    const startShip = this.ship.position.clone();
    const endShip = this.shipParking(id, 0);
    const dist = startShip.distanceTo(endShip);

    const fromCenter = this.current ? this.planets.get(this.current).group.position : startShip.clone().multiplyScalar(1.2);
    const outDir = startShip.clone().sub(fromCenter).normalize();
    const inDir = endShip.clone().sub(to.group.position).normalize();
    const lift = UP.clone().multiplyScalar(dist * 0.18);
    const curve = new THREE.CubicBezierCurve3(
      startShip,
      startShip.clone().addScaledVector(outDir, dist * 0.3).add(lift),
      endShip.clone().addScaledVector(inDir, dist * 0.35).add(lift),
      endShip
    );

    // Leaving the planet: let it keep rotating freely
    if (this.current) this.planets.get(this.current).uniforms.uActive.value = -1;
    const prev = this.current;
    this.current = null;

    const duration = this.reducedMotion ? 0 : Math.min(2.4 + dist * 0.008, first ? 5.2 : 4.6);
    this.travel = {
      to: id, prev, curve, t: 0, duration,
      camStart: this.camera.position.clone(), lookStart: this.camLook.clone(),
      end: this.viewPose(id),
    };
    return new Promise((resolve) => { this.travel.resolve = resolve; });
  }

  // ---------- interaction ----------

  setPanelInset(x, y) { this.panelInset.x = x; this.panelInset.y = y; }

  pickContinent(clientX, clientY) {
    if (!this.current || this.travel) return -1;
    const p = this.planets.get(this.current);
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = ray.intersectObject(p.mesh, false)[0];
    if (!hit) return -1;
    const local = p.body.worldToLocal(hit.point.clone()).normalize();
    let best = -1, bestD = -2;
    p.centers.forEach((c, i) => { const d = local.dot(c); if (d > bestD) { bestD = d; best = i; } });
    return best;
  }

  setHover(index) {
    if (!this.current) return;
    this.planets.get(this.current).uniforms.uHover.value = index;
  }

  dragPlanet(dx, dy) {
    if (!this.current || this.travel) return;
    const p = this.planets.get(this.current);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const q = new THREE.Quaternion().setFromAxisAngle(up, dx * 0.006).multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * 0.006));
    p.body.quaternion.premultiply(q);
    p.targetQuat.copy(p.body.quaternion);
    p.free = true;
  }

  // Screen positions for labels; returns [{x, y, visible}] per continent of the current planet
  continentScreen() {
    if (!this.current) return null;
    const p = this.planets.get(this.current);
    const camPos = this.camera.position;
    return p.centers.map((c) => {
      const world = c.clone().applyQuaternion(p.body.quaternion).multiplyScalar(p.look.radius * 1.03).add(p.group.position);
      const normal = world.clone().sub(p.group.position).normalize();
      const facing = normal.dot(tmpV.copy(camPos).sub(world).normalize());
      const s = world.project(this.camera);
      return { x: (s.x * 0.5 + 0.5) * this.width, y: (-s.y * 0.5 + 0.5) * this.height, visible: facing > 0.25 && s.z < 1 };
    });
  }

  planetScreen() {
    const out = {};
    this.planets.forEach((p, id) => {
      const s = p.group.position.clone().project(this.camera);
      const d = p.group.position.distanceTo(this.camera.position);
      out[id] = { x: (s.x * 0.5 + 0.5) * this.width, y: (-s.y * 0.5 + 0.5) * this.height - 14, visible: s.z < 1 && Math.abs(s.x) < 1.1 && Math.abs(s.y) < 1.1 && d > p.look.radius * 6 };
    });
    return out;
  }

  // ---------- loop ----------

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height, false);
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
  }

  start() { this.renderer.setAnimationLoop(() => this.frame()); }
  stop() { this.renderer.setAnimationLoop(null); }

  frame() {
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    this.time += dt;
    const T = this.time;
    this.sunUniforms.uTime.value = T;

    this.planets.forEach((p) => {
      p.uniforms.uTime.value = T;
      p.cloudUniforms.uTime.value = T;
      p.clouds.rotation.y += dt * 0.01;
      if (p.id === this.current && !p.free) {
        p.body.quaternion.slerp(p.targetQuat, 1 - Math.exp(-dt * 3.2));
      } else if (p.id !== this.current && !this.reducedMotion) {
        p.body.rotateY(dt * p.spin);
      }
    });

    let warp = 0;
    if (this.travel) {
      const tr = this.travel;
      tr.t = tr.duration > 0 ? Math.min(tr.t + Math.min(raw, 0.25) / tr.duration, 1) : 1;
      const e = easeInOut(tr.t);
      const shipPos = tr.curve.getPoint(e);
      const tangent = tr.curve.getTangent(Math.min(e, 0.999)).normalize();
      this.ship.position.copy(shipPos);
      this.ship.lookAt(tmpV.copy(shipPos).add(tangent));

      const chasePos = shipPos.clone().addScaledVector(tangent, -15).addScaledVector(UP, 4.5);
      const chaseLook = shipPos.clone().addScaledVector(tangent, 12);
      const w1 = smooth(0, 0.22, tr.t);
      const w2 = smooth(0.7, 1, tr.t);
      this.camera.position.lerpVectors(tr.camStart, chasePos, w1).lerp(tr.end.pos, w2);
      this.camLook.lerpVectors(tr.lookStart, chaseLook, w1).lerp(tr.end.look, w2);
      warp = Math.sin(Math.PI * tr.t) * (1 - w2);

      if (tr.t >= 1) {
        this.current = tr.to;
        this.travel = null;
        this.camera.position.copy(tr.end.pos);
        this.camLook.copy(tr.end.look);
        this.parkT = 0;
        tr.resolve();
        if (this.onArrive) this.onArrive(tr.to);
      }
    } else if (this.current) {
      // Idle: ship circles the planet, camera breathes slightly
      this.parkT = (this.parkT || 0) + (this.reducedMotion ? 0 : dt);
      const prev = this.ship.position.clone();
      this.shipParking(this.current, this.parkT, this.ship.position);
      if (this.parkT > 0) this.ship.lookAt(tmpV.copy(this.ship.position).multiplyScalar(2).sub(prev));
      const pose = this.viewPose(this.current);
      const bob = this.reducedMotion ? 0 : Math.sin(T * 0.3) * 0.4;
      this.camera.position.copy(pose.pos).addScaledVector(UP, bob);
      this.camLook.copy(pose.look);
    } else {
      // Before the first flight: slow drift
      if (!this.reducedMotion) this.camera.position.applyAxisAngle(UP, dt * 0.02);
    }

    this.camera.lookAt(this.camLook);
    this.camera.fov = 50 + warp * 18;

    // Shift the projection so the planet sits beside the console, not under it
    const settle = this.current ? 1 : 0;
    this.viewOffset.tx = this.panelInset.x * settle;
    this.viewOffset.ty = this.panelInset.y * settle;
    const k = this.reducedMotion ? 1 : 1 - Math.exp(-dt * 3);
    this.viewOffset.x += (this.viewOffset.tx - this.viewOffset.x) * k;
    this.viewOffset.y += (this.viewOffset.ty - this.viewOffset.y) * k;
    this.camera.setViewOffset(this.width, this.height, this.viewOffset.x, this.viewOffset.y, this.width, this.height);
    this.camera.updateProjectionMatrix();

    // Engine flame + dust react to speed
    const thrust = this.travel ? 0.6 + warp * 1.6 : 0.35;
    this.flame.scale.setScalar(1.2 + thrust * 1.6 + Math.sin(T * 40) * 0.1);
    this.dust.material.opacity = 0.15 + warp * 0.7;
    this.dust.position.copy(this.ship.position);

    this.updateTrail();
    this.renderer.render(this.scene, this.camera);
  }

  updateTrail() {
    const tail = tmpV.set(0, 0, -2.2).applyMatrix4(this.ship.matrixWorld);
    const a = this.trailPts;
    if (!this.trailInit) { for (let i = 0; i < this.trailLen; i++) a.set([tail.x, tail.y, tail.z], i * 3); this.trailInit = true; }
    a.copyWithin(3, 0, a.length - 3);
    a[0] = tail.x; a[1] = tail.y; a[2] = tail.z;
    this.trail.geometry.attributes.position.needsUpdate = true;
  }
}
