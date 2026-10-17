// The solar system: sun, planets with continents, the ship and the camera choreography.
import * as THREE from "three";
import { planetShader, cloudShader, atmosphereShader, sunShader, nebulaShader, MAX_CONTINENTS } from "./shaders.js";
import { BIOME_KIND, BIOME_TINT, buildSite, disposeSite, tickBoards } from "./surface.js";

// Visual identity of each planet. Content (names, continents) comes from the DOM.
export const PLANET_LOOKS = {
  home: {
    radius: 11, orbit: 70, angle: 0.4, y: 4, seed: 1.3, tilt: 0.25,
    moons: 1, ocean: "#1b6ca8", deep: "#071c3d", glow: "#6ee7ff", atmosphere: "#7cc8ff", clouds: 0.0,
    continents: ["#5fbf6a", "#d9b56b", "#9bd16a"],
  },
  about: {
    radius: 9, orbit: 108, angle: 1.75, y: -6, seed: 4.7, tilt: -0.3,
    ocean: "#8a2f6b", deep: "#2a0626", glow: "#ffd1f0", atmosphere: "#ff9ad5", clouds: -0.1,
    continents: ["#f5c6a5", "#e6799f", "#c9a0ff"],
  },
  skills: {
    radius: 14, orbit: 150, angle: 3.15, y: 8, seed: 8.1, tilt: 0.15, ring: "#f6ad55",
    moons: 2, ocean: "#2a6b5f", deep: "#082320", glow: "#ffd27a", atmosphere: "#ffd59a", clouds: -0.15,
    continents: ["#d98a3d", "#58c4a8", "#4b7bd6", "#a8a35a", "#d1503f"],
  },
  resume: {
    radius: 12, orbit: 192, angle: 4.45, y: -3, seed: 2.9, tilt: -0.2,
    ocean: "#3b2a7a", deep: "#0d0726", glow: "#d9c2ff", atmosphere: "#b28cff", clouds: -0.05,
    continents: ["#e2d4a8", "#8fd3c7", "#f0a35e", "#c46ad6", "#6fb3e0", "#e0cf5f", "#a0c16a"],
  },
  contact: {
    radius: 10, orbit: 232, angle: 5.7, y: 5, seed: 6.6, tilt: 0.35, ring: "#9ad0ff",
    moons: 1, ocean: "#11507a", deep: "#03142a", glow: "#a8e6ff", atmosphere: "#63b3ed", clouds: 0.05,
    continents: ["#cfe8ff", "#7fe0b8", "#f2c46d"],
  },
};

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpM = new THREE.Matrix4();
const tmpM2 = new THREE.Matrix4();

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const SHIP_SCALE = 0.62;
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
    // Phones start at a lower resolution; adaptQuality() lowers it further if frames run slow
    this.maxDpr = Math.min(window.devicePixelRatio, window.innerWidth < 820 ? 1.5 : 2);
    this.dpr = this.maxDpr;
    this.renderer.setPixelRatio(this.dpr);
    this.frameAvg = 16;
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
    this.planetPx = 0;
    this.onArrive = null;
    this.site = null;        // continent the ship has landed on: { id, index, frame, props }
    this.surf = null;        // active dive / take-off

    this.pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), up: new THREE.Vector3(), north: new THREE.Vector3(), ship: new THREE.Vector3(), shipQuat: new THREE.Quaternion(), shipScale: SHIP_SCALE };
    this.diveFov = 0;
    this.buildBackdrop();
    this.buildSun();
    planetsData.forEach((p) => this.buildPlanet(p));
    this.buildShip();
    this.buildBelt();
    this.buildWarp();
    this.buildPulse();
    this.introT = reducedMotion ? 10 : 0;

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
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = Math.random() * 100;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
    this.starUniforms = { uTime: { value: 0 }, uScale: { value: this.dpr } };
    this.stars = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: this.starUniforms, transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: `attribute float phase; uniform float uTime; uniform float uScale; varying vec3 vC; varying float vA;
        void main(){ vC = color; vA = 0.55 + 0.45 * sin(uTime * (0.6 + fract(phase) * 2.2) + phase);
          gl_PointSize = (1.4 + fract(phase * 7.3) * 1.6) * uScale; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vC; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(vC, vA * smoothstep(0.5, 0.15, d)); }`,
    }));
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
    this.sunGlow = glow;
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
      // Continent colour: its landscape, tinted with the planet's own palette
      uColors: { value: pad(centers.map((_, i) => new THREE.Color(BIOME_TINT[data.continents[i].biome] || BIOME_TINT.wilds).lerp(new THREE.Color(look.continents[i % look.continents.length]), 0.3)), new THREE.Color()) },
      uKind: { value: pad(centers.map((_, i) => BIOME_KIND[data.continents[i].biome] || 0), 0) },
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

    const cloudUniforms = { uSunPos: { value: this.sunPos }, uSeed: { value: look.seed + 3 }, uTime: { value: 0 }, uDensity: { value: look.clouds }, uFade: { value: 1 } };
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

    // Moons
    const moons = [];
    for (let i = 0; i < (look.moons || 0); i++) {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(look.radius * (0.12 + i * 0.05), 2),
        new THREE.MeshStandardMaterial({ color: i ? 0xc9b8a6 : 0xb8c4d9, roughness: 0.9, flatShading: true })
      );
      const pivot = new THREE.Group();
      pivot.rotation.set(0.35 + i * 0.5, 0, 0.2 - i * 0.4);
      m.position.x = look.radius * (2.5 + i * 0.7);
      pivot.add(m);
      group.add(pivot);
      moons.push({ pivot, mesh: m, speed: 0.25 / (1 + i) });
    }

    body.quaternion.setFromEuler(new THREE.Euler(look.tilt, look.seed, 0));

    this.planets.set(data.id, {
      ...data, look, group, body, mesh, clouds, uniforms, cloudUniforms, centers,
      targetQuat: body.quaternion.clone(), free: false, spin: 0.02, moons, atmo,
    });
  }

  // A classic explorer starship: saucer on a neck, secondary hull, two warp nacelles
  buildShip() {
    const ship = new THREE.Group();
    const hull = new THREE.MeshStandardMaterial({ color: 0xe4e8f0, emissive: 0x464c58, metalness: 0.35, roughness: 0.45 });
    const panel = new THREE.MeshStandardMaterial({ color: 0xb9c0cf, emissive: 0x30353f, metalness: 0.4, roughness: 0.5 });
    const glow = (color, intensity = 1.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity });

    // Saucer section
    const profile = [[0, 0.16], [0.45, 0.15], [1.2, 0.08], [1.55, 0.01], [1.52, -0.05], [1.1, -0.1], [0.35, -0.14], [0, -0.15]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    const saucer = new THREE.Mesh(new THREE.LatheGeometry(profile, 56), hull);
    saucer.position.set(0, 0.55, 1.3);
    ship.add(saucer);
    const bridge = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 12), panel);
    bridge.scale.set(1, 0.45, 1);
    bridge.position.set(0, 0.72, 1.15);
    ship.add(bridge);
    const windows = new THREE.Mesh(new THREE.TorusGeometry(1.4, 0.014, 6, 72), glow(0xfff1c9, 0.9));
    windows.rotation.x = Math.PI / 2;
    windows.position.set(0, 0.57, 1.3);
    ship.add(windows);
    const impulse = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.06), glow(0xff5a3c, 1.6));
    impulse.position.set(0, 0.58, -0.2);
    ship.add(impulse);

    // Neck and secondary hull with its deflector dish
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.85, 0.5), hull);
    neck.position.set(0, 0.2, 0.2);
    neck.rotation.x = -0.45;
    ship.add(neck);
    const engineering = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.28, 2.4, 24), hull);
    engineering.rotation.x = Math.PI / 2;
    engineering.scale.z = 1.15;
    engineering.position.set(0, -0.2, -0.6);
    ship.add(engineering);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 12), glow(0xffa94d, 1.5));
    dish.scale.z = 0.35;
    dish.position.set(0, -0.2, 0.62);
    ship.add(dish);

    // Pylons and warp nacelles
    this.flames = [];
    [1, -1].forEach((s) => {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.07, 1.2, 0.34), panel);
      pylon.position.set(0.6 * s, 0.35, -1.25);
      pylon.rotation.z = -0.73 * s;
      ship.add(pylon);

      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.15, 2.6, 18), hull);
      nacelle.rotation.x = Math.PI / 2;
      nacelle.position.set(1.0 * s, 0.85, -1.3);
      ship.add(nacelle);
      const bussard = new THREE.Mesh(new THREE.SphereGeometry(0.17, 18, 12), glow(0xff3b2f, 1.8));
      bussard.scale.z = 1.25;
      bussard.position.set(1.0 * s, 0.85, 0.0);
      ship.add(bussard);
      const grille = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.09, 2.0), glow(0x5fc8ff, 1.6));
      grille.position.set((1.0 - 0.165) * s, 0.85, -1.35);
      ship.add(grille);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10), panel);
      cap.scale.z = 0.6;
      cap.position.set(1.0 * s, 0.85, -2.6);
      ship.add(cap);

      const flame = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture("rgba(220,250,255,1)", "rgba(60,180,255,0.6)"), blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.position.set(1.0 * s, 0.85, -2.75);
      ship.add(flame);
      this.flames.push(flame);
    });

    // Inner group so the ship can bank into turns without fighting lookAt
    const hullGroup = new THREE.Group();
    while (ship.children.length) hullGroup.add(ship.children[0]);
    ship.add(hullGroup);
    this.hull = hullGroup;
    this.bank = 0;
    this.prevTangent = new THREE.Vector3(0, 0, 1);

    ship.scale.setScalar(SHIP_SCALE);
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

  // Asteroid belt on the edge of the system, past Beacon
  buildBelt() {
    const n = window.innerWidth < 820 ? 260 : 520;
    const rocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshStandardMaterial({ color: 0x8a8070, roughness: 1, flatShading: true }),
      n
    );
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 270 + (Math.random() - 0.5) * 18;
      p.set(Math.cos(a) * r, (Math.random() - 0.5) * 4, Math.sin(a) * r);
      q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
      sc.set(1, 0.7 + Math.random() * 0.6, 0.8 + Math.random() * 0.4).multiplyScalar(0.25 + Math.random() ** 3 * 1.4);
      rocks.setMatrixAt(i, m.compose(p, q, sc));
    }
    this.belt = rocks;
    this.scene.add(rocks);
  }

  // Hyperspace streaks that ride with the camera during a jump
  buildWarp() {
    const n = 160;
    this.streaks = [];
    const pos = new Float32Array(n * 6);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = 12 + Math.random() * 40;
      this.streaks.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: -Math.random() * 260, v: 0.6 + Math.random() * 0.8 });
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.warpLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xa9e8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.warpLines.frustumCulled = false;
    this.camera.add(this.warpLines);
    this.scene.add(this.camera);
  }

  // Shockwave ring when the ship arrives at a planet
  buildPulse() {
    this.pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.96, 1, 96),
      new THREE.MeshBasicMaterial({ color: 0x9fe9ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    this.pulseT = 1;
    this.scene.add(this.pulse);
  }

  firePulse(id) {
    const p = this.planets.get(id);
    this.pulse.position.copy(p.group.position);
    this.pulse.material.color.set(p.look.glow);
    this.pulseR = p.look.radius;
    this.pulseT = 0;
    this.pulseFlat = false;
  }

  // Dust ring where the ship touches down
  fireTouchdown(pos, normal, r, color) {
    this.pulse.position.copy(pos);
    this.pulse.lookAt(tmpV.copy(pos).add(normal));
    this.pulse.material.color.set(color);
    this.pulseR = r;
    this.pulseT = 0;
    this.pulseFlat = true;
  }

  updateWarp(warp, dt) {
    const a = this.warpLines.geometry.attributes.position.array;
    const len = 2 + warp * 60;
    this.streaks.forEach((s, i) => {
      s.z += dt * s.v * (60 + warp * 900);
      if (s.z > 0) s.z -= 260;
      a.set([s.x, s.y, s.z, s.x, s.y, s.z - len * s.v], i * 6);
    });
    this.warpLines.geometry.attributes.position.needsUpdate = true;
    this.warpLines.material.opacity = Math.min(warp * 0.8, 0.5);
    this.warpLines.visible = warp > 0.01;
  }

  // Drop resolution while frames run slow, raise it back when there is headroom
  adaptQuality(raw) {
    this.frameAvg += (raw * 1000 - this.frameAvg) * 0.05;
    this.qualityT = (this.qualityT || 0) + raw;
    if (this.qualityT < 2) return;
    this.qualityT = 0;
    let next = this.dpr;
    if (this.frameAvg > 24 && this.dpr > 0.75) next = Math.max(0.75, this.dpr - 0.25);
    else if (this.frameAvg < 13 && this.dpr < this.maxDpr) next = Math.min(this.maxDpr, this.dpr + 0.25);
    if (next !== this.dpr) {
      this.dpr = next;
      this.renderer.setPixelRatio(next);
      this.renderer.setSize(this.width, this.height, false);
      this.starUniforms.uScale.value = next;
    }
  }

  // ---------- geometry helpers ----------

  // Where the camera sits when looking at a planet: sun-side, a little off-axis, slightly above
  viewPose(id, out = { pos: new THREE.Vector3(), look: new THREE.Vector3() }) {
    const p = this.planets.get(id);
    const c = p.group.position;
    const toSun = tmpV.copy(this.sunPos).sub(c).normalize();
    const side = tmpV2.crossVectors(toSun, UP).normalize();
    const dir = new THREE.Vector3().addScaledVector(toSun, 0.75).addScaledVector(side, 0.62).addScaledVector(UP, 0.28).normalize();
    // Distance that makes the planet span planetPx on screen (the free space beside the console)
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(25));
    const dist = this.planetPx ? (this.height * p.look.radius) / (tanHalf * this.planetPx) : p.look.radius * 3.6;
    out.pos.copy(c).addScaledVector(dir, Math.max(dist, p.look.radius * 2.2));
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
    if (this.site) { if (this.site.props) this.retire(this.site.props); this.site = null; this.surf = null; }
    this.camera.up.copy(UP);
    this.ship.scale.setScalar(SHIP_SCALE);
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

    this.prevTangent.copy(curve.getTangentAt(0)).normalize();
    const duration = this.reducedMotion ? 0 : Math.min(2.4 + dist * 0.008, first ? 5.2 : 4.6);
    this.travel = {
      to: id, prev, curve, t: 0, duration,
      camStart: this.camera.position.clone(), lookStart: this.camLook.clone(),
      end: this.viewPose(id),
    };
    return new Promise((resolve) => { this.travel.resolve = resolve; });
  }

  // ---------- landing ----------

  // A local frame on the planet surface at a continent: x east, y up, z north.
  // Built from the planet's target orientation so it stays put while the planet settles.
  siteFrame(p, index) {
    const q = p.targetQuat;
    const n = p.centers[index].clone().applyQuaternion(q);
    const north = UP.clone().addScaledVector(n, -UP.dot(n));
    if (north.lengthSq() < 1e-4) north.set(0, 0, 1).addScaledVector(n, -n.z);
    north.normalize();
    const east = new THREE.Vector3().crossVectors(n, north);
    const qi = q.clone().invert();
    const m = new THREE.Matrix4().makeBasis(east.applyQuaternion(qi), n.applyQuaternion(qi), north.applyQuaternion(qi));
    m.setPosition(p.centers[index].clone().multiplyScalar(p.look.radius));
    return m;
  }

  // Camera, look target and ship placement for a landed site, in world space for this frame
  sitePose(out) {
    const s = this.site, p = this.planets.get(s.id), R = p.look.radius;
    p.body.updateMatrixWorld();
    const m = tmpM.multiplyMatrices(p.body.matrixWorld, s.frame);
    const at = (x, y, z, v) => v.set(x * R, y * R, z * R).applyMatrix4(m);
    // Tall, narrow screens (phones) step the camera back and up so the whole site fits across
    const narrow = THREE.MathUtils.clamp((1.2 - this.width / this.height) / 0.75, 0, 1);
    at(0, 0.075 + 0.05 * narrow, -0.17 - 0.13 * narrow, out.pos);
    at(0, 0.02, 0.06, out.look);
    out.up.setFromMatrixColumn(m, 1).normalize();
    out.north.setFromMatrixColumn(m, 2).normalize();
    at(0, 0.006, 0, out.ship);
    out.shipQuat.setFromRotationMatrix(tmpM2.makeBasis(tmpV.setFromMatrixColumn(m, 0).normalize(), out.up, out.north));
    out.shipScale = R * 0.011;
    return out;
  }

  orbitPose(out) {
    const v = this.viewPose(this.current);
    out.pos.copy(v.pos);
    out.look.copy(v.look);
    out.up.copy(UP);
    this.shipParking(this.current, this.parkT, out.ship);
    const ahead = this.shipParking(this.current, this.parkT + 0.05, tmpV2);
    out.shipQuat.setFromRotationMatrix(tmpM2.lookAt(ahead, out.ship, UP));
    out.shipScale = SHIP_SCALE;
    return out;
  }

  // Dive from orbit (or hop from another site) and set the ship down on a continent
  land(id, index, info = {}) {
    const p = this.planets.get(id);
    if (!p || id !== this.current) return Promise.resolve();
    if (this.site && this.site.index === index && !this.surf) return Promise.resolve();
    this.focusContinent(id, index);
    const hop = !!this.site;
    const old = this.site;
    this.site = { id, index, frame: this.siteFrame(p, index), props: null, biome: info.biome };
    const props = buildSite(p.look.radius, info.biome, p.look.seed * 31 + index * 7.3, info);
    props.group.applyMatrix4(this.site.frame);
    props.group.userData.base = props.group.matrix.clone();
    props.grow = 0;
    p.body.add(props.group);
    this.site.props = props;
    if (old && old.props) this.retire(old.props);
    if (!hop) return this.startSurf("land", 0, 3.4);
    // Site to site: skim low over the surface along the great circle between them
    const n0 = new THREE.Vector3().setFromMatrixPosition(old.frame).normalize();
    const n1 = new THREE.Vector3().setFromMatrixPosition(this.site.frame).normalize();
    const angle = n0.angleTo(n1);
    const out = this.startSurf("hop", 0, Math.min(2.2 + angle * 1.8, 5.5));
    // Hold the starting pose in the planet's space too, so blending out of it never cuts through the ground
    p.body.updateMatrixWorld();
    const inv = tmpM.copy(p.body.matrixWorld).invert();
    const f = this.surf.from;
    f.localPos = f.pos.clone().applyMatrix4(inv);
    f.localLook = f.look.clone().applyMatrix4(inv);
    f.localShip = f.ship.clone().applyMatrix4(inv);
    Object.assign(this.surf, {
      n0, n1, angle,
      cruise: 0.02 + angle * 0.03,
      q0: new THREE.Quaternion().setFromRotationMatrix(old.frame),
      q1: new THREE.Quaternion().setFromRotationMatrix(this.site.frame),
    });
    return out;
  }

  // Ship and chase camera for a surface hop, in world space for this frame.
  // The path is built in the planet's own space, so the planet can turn underneath without disturbing it.
  hopPose(s, p, out) {
    const R = p.look.radius, e = easeInOut(s.t), Om = s.angle;
    const n = out.n || (out.n = new THREE.Vector3());
    const fwd = out.fwd || (out.fwd = new THREE.Vector3());
    if (Om > 1e-3) {
      const so = Math.sin(Om);
      n.copy(s.n0).multiplyScalar(Math.sin((1 - e) * Om) / so).addScaledVector(s.n1, Math.sin(e * Om) / so);
      fwd.copy(s.n0).multiplyScalar(-Math.cos((1 - e) * Om)).addScaledVector(s.n1, Math.cos(e * Om)).normalize();
    } else {
      n.copy(s.n1);
      fwd.set(0, 0, 1).applyQuaternion(s.q1);
    }
    // Heading: turn from the old pad's facing onto the route, then onto the new pad's facing
    const travel = tmpQ.setFromRotationMatrix(tmpM2.makeBasis(tmpV.crossVectors(n, fwd), n, fwd));
    const q = out.q || (out.q = new THREE.Quaternion());
    q.slerpQuaternions(s.q0, travel, smooth(0, 0.2, s.t)).slerp(s.q1, smooth(0.8, 1, s.t));

    // Climb to a low cruise and settle back onto the pad
    const alt = R * (0.006 + Math.sin(Math.PI * e) * s.cruise);
    const local = tmpV2.copy(n).multiplyScalar(R + alt);
    p.body.updateMatrixWorld();
    const m = p.body.matrixWorld;
    const at = (x, y, z, v) => v.set(x * R, y * R, z * R).applyQuaternion(q).add(local).applyMatrix4(m);
    at(0, 0, 0, out.ship);
    // Same step back as the landed camera on narrow screens, so touchdown doesn't jolt the view
    const narrow = THREE.MathUtils.clamp((1.2 - this.width / this.height) / 0.75, 0, 1);
    at(0, 0.069 + 0.05 * narrow, -0.17 - 0.13 * narrow, out.pos);
    at(0, 0.014, 0.06, out.look);
    const bodyQ = p.body.getWorldQuaternion(out.worldQ || (out.worldQ = new THREE.Quaternion()));
    out.shipQuat.copy(bodyQ).multiply(q);
    out.up.set(0, 1, 0).applyQuaternion(out.shipQuat);
    out.shipScale = R * 0.011;
    return out;
  }

  takeOff() {
    if (!this.site) return Promise.resolve();
    const props = this.site.props;
    const out = this.startSurf("orbit", 0, 2.2);
    this.surf.leaving = props;
    return out;
  }

  // Shrink a site's props into the ground and then free them
  retire(props) {
    if (props.retiring) return;
    props.retiring = true;
    (this.retired ||= []).push(props);
  }

  startSurf(kind, bump, duration) {
    if (this.surf && this.surf.resolve) this.surf.resolve();
    if (this.surf && this.surf.leaving) this.retire(this.surf.leaving);
    this.surf = {
      kind, bump, t: 0, duration: this.reducedMotion ? 0 : duration,
      from: {
        pos: this.camera.position.clone(), look: this.camLook.clone(), up: this.camera.up.clone(),
        ship: this.ship.position.clone(), shipQuat: this.ship.quaternion.clone(), shipScale: this.ship.scale.x,
      },
    };
    return new Promise((resolve) => { this.surf.resolve = resolve; });
  }

  // Interpolate between two points around the planet without cutting through it
  arcLerp(a, b, w, center, bump, out) {
    out.lerpVectors(a, b, w);
    const ra = a.distanceTo(center), rb = b.distanceTo(center);
    const r = ra + (rb - ra) * w + Math.sin(Math.PI * w) * bump;
    tmpV.copy(out).sub(center);
    if (tmpV.lengthSq() > 1e-6) out.copy(center).addScaledVector(tmpV.normalize(), r);
    return out;
  }

  updateSurface(raw, dt, T) {
    const p = this.planets.get(this.current);
    const s = this.surf;
    const pose = this.pose;
    if (s && s.kind === "hop") {
      s.t = s.duration > 0 ? Math.min(s.t + Math.min(raw, 0.25) / s.duration, 1) : 1;
      this.hopPose(s, p, pose);
      // Ease out of the resting sway, then ride behind the ship
      const w = smooth(0, 0.12, s.t);
      const m = p.body.matrixWorld;
      this.camera.position.lerpVectors(tmpV.copy(s.from.localPos).applyMatrix4(m), pose.pos, w);
      this.camLook.lerpVectors(tmpV.copy(s.from.localLook).applyMatrix4(m), pose.look, w);
      this.camera.up.lerpVectors(s.from.up, pose.up, w).normalize();
      this.ship.position.lerpVectors(tmpV.copy(s.from.localShip).applyMatrix4(m), pose.ship, w);
      this.ship.quaternion.slerpQuaternions(s.from.shipQuat, pose.shipQuat, w);
      this.ship.scale.setScalar(pose.shipScale);
      // Lean into the turns at both ends of the route
      this.bank += (Math.sin(Math.PI * smooth(0, 0.25, s.t)) * 0.35 - Math.sin(Math.PI * smooth(0.75, 1, s.t)) * 0.35 - this.bank) * (1 - Math.exp(-dt * 5));
      if (this.site && this.site.props) this.site.props.grow = smooth(0.7, 1, s.t);
      if (s.t >= 1) {
        this.surf = null;
        if (!this.reducedMotion) this.fireTouchdown(pose.ship, pose.up, p.look.radius * 0.022, "#ffe2b0");
        s.resolve();
      }
      if (this.site && this.site.boards) tickBoards(this.site.boards, T);
      return;
    }
    if (s) {
      s.t = s.duration > 0 ? Math.min(s.t + Math.min(raw, 0.25) / s.duration, 1) : 1;
      if (s.kind === "land") this.sitePose(pose); else this.orbitPose(pose);
      const c = p.group.position;
      // Camera dives first, the ship follows it down and settles
      const wc = easeInOut(Math.min(s.t / (s.kind === "land" ? 0.72 : 0.8), 1));
      const ws = s.kind === "land" ? easeOut(smooth(0.12, 1, s.t)) : easeInOut(s.t);
      this.arcLerp(s.from.pos, pose.pos, wc, c, s.bump, this.camera.position);
      this.camLook.lerpVectors(s.from.look, pose.look, wc);
      this.camera.up.lerpVectors(s.from.up, pose.up, wc).normalize();
      this.arcLerp(s.from.ship, pose.ship, ws, c, s.bump * 0.6, this.ship.position);
      this.ship.quaternion.slerpQuaternions(s.from.shipQuat, pose.shipQuat, ws);
      this.ship.scale.setScalar(THREE.MathUtils.lerp(s.from.shipScale, pose.shipScale, ws));
      this.diveFov = Math.sin(Math.PI * wc) * 10;
      if (this.site && this.site.props) this.site.props.grow = s.kind === "land" ? smooth(0.45, 0.95, s.t) : 1 - smooth(0, 0.5, s.t);
      if (s.t >= 1) {
        this.surf = null;
        this.diveFov = 0;
        if (s.kind === "land") {
          if (!this.reducedMotion) this.fireTouchdown(pose.ship, pose.up, p.look.radius * 0.022, "#ffe2b0");
        } else {
          if (s.leaving) this.retire(s.leaving);
          this.site = null;
          this.camera.up.copy(UP);
          this.ship.scale.setScalar(SHIP_SCALE);
        }
        s.resolve();
      }
    } else if (this.site) {
      // Landed: camera rests above the pad with a slow sway, ship hums on its landing struts
      this.sitePose(pose);
      if (!this.reducedMotion) pose.pos.addScaledVector(pose.up, Math.sin(T * 0.5) * p.look.radius * 0.003);
      this.camera.position.lerp(pose.pos, 1 - Math.exp(-dt * 6));
      this.camLook.copy(pose.look);
      this.camera.up.copy(pose.up);
      this.ship.position.copy(pose.ship).addScaledVector(pose.up, this.reducedMotion ? 0 : Math.sin(T * 2) * p.look.radius * 0.0006);
      this.ship.quaternion.copy(pose.shipQuat);
      this.ship.scale.setScalar(pose.shipScale);
    }
    this.bank += (0 - this.bank) * (1 - Math.exp(-dt * 4));
    if (this.site && this.site.boards) tickBoards(this.site.boards, T);
  }

  // Raise the current site's props out of the ground; sink retired ones
  updateProps(dt) {
    const grow = (props, k) => {
      const g = props.group;
      g.matrix.copy(g.userData.base).multiply(tmpM.makeScale(1, Math.max(k, 0.001), 1));
      g.matrix.decompose(g.position, g.quaternion, g.scale);
      g.visible = k > 0.002;
    };
    if (this.site && this.site.props) {
      const pr = this.site.props;
      pr.shown = this.reducedMotion ? pr.grow : (pr.shown ?? 0) + (pr.grow - (pr.shown ?? 0)) * (1 - Math.exp(-dt * 5));
      grow(pr, easeOut(pr.shown));
      this.site.boards = pr.boards;
      // Traffic, fireflies, aurora and the like keep moving (held still for reduced motion)
      if (pr.tick && pr.shown > 0.01) pr.tick(this.reducedMotion ? 0 : this.time);
    }
    if (this.retired) {
      this.retired = this.retired.filter((pr) => {
        pr.shown = (pr.shown ?? 1) - dt * 2;
        if (pr.shown <= 0) { disposeSite(pr); return false; }
        grow(pr, pr.shown);
        return true;
      });
    }
  }

  // ---------- interaction ----------

  setFrame(x, y, planetPx) { this.panelInset.x = x; this.panelInset.y = y; this.planetPx = planetPx; }

  pickContinent(clientX, clientY) {
    if (!this.current || this.travel || this.site) return -1;
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
    if (!this.current || this.travel || this.site) return;
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
        // Near the ground the planet must settle in step with the landing, even on slow frames
        const step = this.site ? Math.min(raw, 0.25) : dt;
        p.body.quaternion.slerp(p.targetQuat, 1 - Math.exp(-step * 2.6));
      } else if (p.id !== this.current && !this.reducedMotion) {
        p.body.rotateY(dt * p.spin);
      }
    });

    let warp = 0;
    if (this.travel) {
      const tr = this.travel;
      tr.t = tr.duration > 0 ? Math.min(tr.t + Math.min(raw, 0.25) / tr.duration, 1) : 1;
      const e = easeInOut(tr.t);
      // Arc-length sampling keeps the speed even along the whole route
      const shipPos = tr.curve.getPointAt(e);
      const tangent = tr.curve.getTangentAt(Math.min(e, 0.999)).normalize();
      this.ship.position.copy(shipPos);
      this.ship.lookAt(tmpV.copy(shipPos).add(tangent));
      const turn = tmpV2.crossVectors(this.prevTangent, tangent).y / Math.max(dt, 1e-3);
      this.bank += (THREE.MathUtils.clamp(-turn * 0.9, -0.9, 0.9) - this.bank) * (1 - Math.exp(-dt * 4));
      this.prevTangent.copy(tangent);

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
        if (!this.reducedMotion) this.firePulse(tr.to);
        tr.resolve();
        if (this.onArrive) this.onArrive(tr.to);
      }
    } else if (this.current && (this.site || this.surf)) {
      this.updateSurface(raw, dt, T);
    } else if (this.current) {
      // Idle: ship circles the planet, camera breathes slightly
      this.parkT = (this.parkT || 0) + (this.reducedMotion ? 0 : dt);
      const prev = this.ship.position.clone();
      this.shipParking(this.current, this.parkT, this.ship.position);
      if (!this.reducedMotion) this.ship.position.y += Math.sin(T * 1.7) * 0.12;
      if (this.parkT > 0) this.ship.lookAt(tmpV.copy(this.ship.position).multiplyScalar(2).sub(prev));
      this.bank += (-0.25 - this.bank) * (1 - Math.exp(-dt * 2));
      const pose = this.viewPose(this.current);
      const bob = this.reducedMotion ? 0 : Math.sin(T * 0.3) * 0.4;
      pose.pos.addScaledVector(UP, bob);
      this.camera.position.lerp(pose.pos, this.reducedMotion ? 1 : 1 - Math.exp(-dt * 4));
      this.camLook.copy(pose.look);
    } else {
      // Before the first flight: slow drift
      if (!this.reducedMotion) this.camera.position.applyAxisAngle(UP, dt * 0.02);
    }

    this.camera.lookAt(this.camLook);
    const wide = this.site ? THREE.MathUtils.clamp((1.2 - this.width / this.height) / 0.75, 0, 1) * 12 : 0;
    this.siteFov = (this.siteFov || 0) + (wide - (this.siteFov || 0)) * (this.reducedMotion ? 1 : 1 - Math.exp(-dt * 3));
    this.camera.fov = 50 + warp * 18 + this.diveFov + this.siteFov;
    this.updateProps(dt);
    // Clouds thin out as the camera drops through them
    if (this.current) {
      const p = this.planets.get(this.current);
      const d = this.camera.position.distanceTo(p.group.position) / p.look.radius;
      p.cloudUniforms.uFade.value = smooth(1.25, 1.9, d);
    }

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
    const thrust = this.travel ? 0.6 + warp * 1.6 : this.site && !this.surf ? 0.05 : 0.35;
    this.flames.forEach((f, i) => f.scale.setScalar(0.9 + thrust * 1.3 + Math.sin(T * 40 + i) * 0.08));
    this.dust.material.opacity = 0.15 + warp * 0.7;
    this.dust.position.copy(this.ship.position);

    this.hull.rotation.z = this.bank;
    this.starUniforms.uTime.value = T;
    if (!this.reducedMotion) {
      this.sunGlow.scale.setScalar(140 + Math.sin(T * 0.8) * 6 + Math.sin(T * 2.3) * 2);
      this.belt.rotation.y += dt * 0.006;
      this.planets.forEach((p) => p.moons.forEach((m) => { m.pivot.rotation.y += dt * m.speed; m.mesh.rotation.y += dt * 0.3; }));
    }
    // Planets drift into view one after another on first load
    if (this.introT < 10) {
      this.introT += dt;
      let i = 0;
      this.planets.forEach((p) => {
        const t = smooth(0.2 + i * 0.25, 1.4 + i * 0.25, this.introT);
        p.group.scale.setScalar(0.001 + t * 0.999);
        i++;
      });
    }
    if (this.pulseT < 1) {
      this.pulseT = Math.min(this.pulseT + dt / 1.4, 1);
      const e = 1 - Math.pow(1 - this.pulseT, 3);
      this.pulse.scale.setScalar(this.pulseR * (1.1 + e * 0.8));
      this.pulse.material.opacity = (1 - this.pulseT) * (this.pulseFlat ? 0.3 : 0.5);
      if (!this.pulseFlat) this.pulse.lookAt(this.camera.position);
    }
    this.updateWarp(warp, dt);
    this.adaptQuality(raw);

    this.trail.visible = !this.site || !!this.surf;
    this.updateTrail();
    this.renderer.render(this.scene, this.camera);
  }

  updateTrail() {
    const tail = tmpV.set(0, 0.6, -2.7).applyMatrix4(this.ship.matrixWorld);
    const a = this.trailPts;
    if (!this.trailInit) { for (let i = 0; i < this.trailLen; i++) a.set([tail.x, tail.y, tail.z], i * 3); this.trailInit = true; }
    a.copyWithin(3, 0, a.length - 3);
    a[0] = tail.x; a[1] = tail.y; a[2] = tail.z;
    this.trail.geometry.attributes.position.needsUpdate = true;
  }
}
