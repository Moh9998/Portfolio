// What the ship finds on the ground: buildings and billboards in cities, trees, ice, mesas and rocks elsewhere.
// Everything is built in a local "site frame": x = east, y = up, z = north (away from the landing camera),
// with the origin at the landing point and R the planet radius.
import * as THREE from "three";

export const BIOME_KIND = { wilds: 0, city: 1, desert: 2, arctic: 3, rainforest: 4 };
export const BIOME_TINT = { wilds: "#7f9c4c", city: "#8d93a3", desert: "#d9b46c", arctic: "#e2ecf7", rainforest: "#2f7f3c" };

const Y = new THREE.Vector3(0, 1, 0);

function rng(seed) {
  let a = Math.floor(seed * 1e6) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scatter points over the ground in front of the camera, following the planet's curve
function scatter(rand, R, count, { near = 0.03, far = 0.32, avoid = [] } = {}) {
  const out = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 20) {
    const z = R * (near + Math.pow(rand(), 0.8) * (far - near));
    const x = (rand() * 2 - 1) * (R * 0.06 + z * 0.9);
    if (Math.abs(x) < R * 0.045 && z < R * 0.07) continue; // keep the landing pad clear
    if (avoid.some((a) => Math.abs(x - a.x) < a.w && z < a.z)) continue;
    const y = -(x * x + z * z) / (2 * R);
    const up = new THREE.Vector3(x / R, 1, z / R).normalize();
    out.push({ x, y, z, up, yaw: rand() * Math.PI * 2 });
  }
  return out;
}

function instanced(geometry, material, items, place) {
  const mesh = new THREE.InstancedMesh(geometry, material, items.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), yawQ = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const color = new THREE.Color();
  items.forEach((it, i) => {
    const r = place(it, i, s, color);
    q.setFromUnitVectors(Y, it.up).multiply(yawQ.setFromAxisAngle(Y, it.yaw));
    p.set(it.x, it.y, it.z).addScaledVector(it.up, r.lift);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    if (r.color) mesh.setColorAt(i, color);
  });
  return mesh;
}

function windowTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) {
    for (let x = 4; x < 60; x += 8) {
      const r = Math.random();
      if (r < 0.45) continue;
      g.fillStyle = r > 0.93 ? "#7fe8ff" : r > 0.7 ? "#ffd89a" : "#c9a46a";
      g.globalAlpha = 0.5 + Math.random() * 0.5;
      g.fillRect(x, y, 4, 5);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- billboards ----------

const BOARD_COLORS = ["#ff4fd8", "#4fe3ff", "#ffb84f"];

function wrap(g, text, maxW, maxLines) {
  const words = String(text).split(/[ \t\n]+/); // keeps non-breaking spaces together
  const lines = [];
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…"; }
  return lines;
}

function drawBoard(b) {
  const g = b.ctx, W = b.canvas.width, H = b.canvas.height;
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a0618");
  bg.addColorStop(1, "#160b2c");
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  g.strokeStyle = b.color;
  g.lineWidth = 6;
  g.shadowColor = b.color;
  g.shadowBlur = 18;
  g.strokeRect(8, 8, W - 16, H - 16);
  g.shadowBlur = 0;

  g.fillStyle = b.color;
  g.font = "600 20px 'JetBrains Mono', monospace";
  g.fillText(String(b.kicker).toUpperCase().slice(0, 40), 28, 44);

  const text = b.lines[b.i % b.lines.length];
  let size = 46;
  let lines;
  do {
    g.font = `700 ${size}px 'Space Grotesk', system-ui, sans-serif`;
    lines = wrap(g, text, W - 56, 3);
    size -= 4;
  } while (lines.length * (size + 8) > H - 120 && size > 24);
  g.fillStyle = "#ffffff";
  g.shadowColor = b.color;
  g.shadowBlur = 10;
  lines.forEach((l, i) => g.fillText(l, 28, 100 + i * (size + 10)));
  g.shadowBlur = 0;

  // Page dots
  b.lines.forEach((_, i) => {
    g.fillStyle = i === b.i % b.lines.length ? b.color : "rgba(255,255,255,0.25)";
    g.fillRect(28 + i * 18, H - 34, 10, 6);
  });
  // Scanlines
  g.fillStyle = "rgba(0,0,0,0.18)";
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
  b.texture.needsUpdate = true;
}

function billboard(R, spec, i, rand) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const b = { canvas, ctx: canvas.getContext("2d"), texture, color: BOARD_COLORS[i % 3], kicker: spec.kicker, lines: spec.lines.length ? spec.lines : [spec.kicker], i: 0, next: 2.5 + i * 0.9 };

  const group = new THREE.Group();
  const w = R * spec.w, h = w / 2;
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w * 1.06, h * 1.1, R * 0.002), new THREE.MeshStandardMaterial({ color: 0x15161d, metalness: 0.6, roughness: 0.4 }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.position.z = R * 0.0011;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.0012, R * 0.0016, R * spec.pole, 6), new THREE.MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.7, roughness: 0.5 }));
  pole.position.y = -R * spec.pole / 2 - h / 2;
  group.add(frame, screen, pole);

  const z = R * spec.z, x = R * spec.x;
  group.position.set(x, -(x * x + z * z) / (2 * R) + R * spec.pole + h / 2, z);
  // Face the landing camera, which sits south of the pad
  group.rotation.y = Math.atan2(-x, -R * 0.17 - z) + (rand() - 0.5) * 0.1;
  b.screen = screen;
  drawBoard(b);
  return { group, board: b };
}

export function tickBoards(boards, t) {
  boards.forEach((b) => {
    if (t < b.next) return;
    b.i++;
    b.next = t + 3.2;
    drawBoard(b);
  });
}

// ---------- landscapes ----------

function city(R, rand, info) {
  const g = new THREE.Group();
  const specs = [
    { x: -0.055, z: 0.085, w: 0.075, pole: 0.022 },
    { x: 0.06, z: 0.11, w: 0.075, pole: 0.03 },
    { x: 0.0, z: 0.2, w: 0.12, pole: 0.08 },
  ];
  const boards = (info.boards || []).slice(0, 3).map((spec, i) => {
    const b = billboard(R, { ...spec, ...specs[i] }, i, rand);
    g.add(b.group);
    return b.board;
  });
  const avoid = specs.map((s) => ({ x: R * s.x, w: R * (s.w * 0.75 + 0.01), z: R * (s.z + 0.015) }));

  const towers = scatter(rand, R, 120, { near: 0.04, far: 0.34, avoid });
  const mat = new THREE.MeshStandardMaterial({ color: 0x3a4152, metalness: 0.5, roughness: 0.55, emissive: 0xffffff, emissiveMap: windowTexture(), emissiveIntensity: 0.85 });
  g.add(instanced(new THREE.BoxGeometry(1, 1, 1), mat, towers, (t, i, s, c) => {
    const core = 1 - Math.min(Math.hypot(t.x, t.z - R * 0.16) / (R * 0.28), 1);
    const h = R * (0.012 + Math.pow(rand(), 2) * 0.05 + core * 0.04);
    const w = R * (0.007 + rand() * 0.011);
    s.set(w, h, w * (0.7 + rand() * 0.6));
    t.h = h;
    c.setHSL(0.6 + rand() * 0.08, 0.15, 0.55 + rand() * 0.3);
    return { lift: h / 2, color: true };
  }));
  g.userData.towers = towers;
  // Rooftop beacons
  const tops = towers.filter(() => rand() < 0.25);
  g.add(instanced(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff3355 }), tops, (t, i, s) => {
    s.setScalar(R * 0.0012);
    return { lift: t.h + R * 0.001 };
  }));
  return { group: g, boards };
}

function rainforest(R, rand) {
  const g = new THREE.Group();
  const trees = scatter(rand, R, 170, { near: 0.025, far: 0.33 });
  const sizes = trees.map(() => ({ h: R * (0.012 + rand() * 0.022 + (rand() < 0.1 ? 0.02 : 0)), r: R * (0.005 + rand() * 0.007) }));
  g.add(instanced(new THREE.CylinderGeometry(0.25, 0.4, 1, 5), new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 }), trees, (t, i, s) => {
    s.set(sizes[i].r * 0.5, sizes[i].h, sizes[i].r * 0.5);
    return { lift: sizes[i].h / 2 };
  }));
  g.add(instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees, (t, i, s, c) => {
    s.set(sizes[i].r * 1.2, sizes[i].r * 0.8, sizes[i].r * 1.2);
    c.setHSL(0.26 + rand() * 0.12, 0.6, 0.09 + rand() * 0.1);
    return { lift: sizes[i].h, color: true };
  }));
  return { group: g, boards: [] };
}

function arctic(R, rand) {
  const g = new THREE.Group();
  const spikes = scatter(rand, R, 80, { near: 0.03, far: 0.34 });
  g.add(instanced(new THREE.ConeGeometry(1, 1, 5), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x1c3a5c, roughness: 0.15, metalness: 0.1, flatShading: true }), spikes, (t, i, s, c) => {
    const h = R * (0.008 + Math.pow(rand(), 2) * 0.045);
    s.set(h * (0.18 + rand() * 0.2), h, h * (0.18 + rand() * 0.2));
    c.setHSL(0.55 + rand() * 0.05, 0.5, 0.75 + rand() * 0.2);
    return { lift: h / 2, color: true };
  }));
  const mounds = scatter(rand, R, 40, { near: 0.02, far: 0.3 });
  g.add(instanced(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshStandardMaterial({ color: 0xf4f8ff, roughness: 0.8 }), mounds, (t, i, s) => {
    const r = R * (0.006 + rand() * 0.014);
    s.set(r, r * 0.3, r * (0.8 + rand() * 0.6));
    return { lift: 0 };
  }));
  return { group: g, boards: [] };
}

function desert(R, rand) {
  const g = new THREE.Group();
  const mesas = scatter(rand, R, 16, { near: 0.08, far: 0.34 });
  g.add(instanced(new THREE.CylinderGeometry(0.75, 1, 1, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), mesas, (t, i, s, c) => {
    const w = R * (0.014 + rand() * 0.03), h = R * (0.008 + rand() * 0.028);
    s.set(w, h, w * (0.6 + rand() * 0.8));
    c.setHSL(0.06 + rand() * 0.03, 0.55, 0.42 + rand() * 0.12);
    return { lift: h / 2, color: true };
  }));
  const rocks = scatter(rand, R, 40, { near: 0.02, far: 0.28 });
  g.add(instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 1, flatShading: true }), rocks, (t, i, s) => {
    const r = R * (0.0015 + rand() * 0.004);
    s.set(r, r * 0.7, r);
    return { lift: r * 0.3 };
  }));
  // A few tall cactus-like spires
  const spires = scatter(rand, R, 12, { near: 0.03, far: 0.2 });
  g.add(instanced(new THREE.CylinderGeometry(0.5, 0.6, 1, 6), new THREE.MeshStandardMaterial({ color: 0x5f7d3a, roughness: 0.9 }), spires, (t, i, s) => {
    const h = R * (0.006 + rand() * 0.008);
    s.set(R * 0.0016, h, R * 0.0016);
    return { lift: h / 2 };
  }));
  return { group: g, boards: [] };
}

function wilds(R, rand) {
  const g = new THREE.Group();
  const pines = scatter(rand, R, 90, { near: 0.03, far: 0.34 });
  const hs = pines.map(() => R * (0.01 + rand() * 0.022));
  g.add(instanced(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), pines, (t, i, s, c) => {
    s.set(hs[i] * 0.32, hs[i], hs[i] * 0.32);
    c.setHSL(0.3 + rand() * 0.06, 0.45, 0.2 + rand() * 0.1);
    return { lift: hs[i] * 0.6, color: true };
  }));
  g.add(instanced(new THREE.CylinderGeometry(0.2, 0.3, 1, 5), new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 }), pines, (t, i, s) => {
    s.set(hs[i] * 0.12, hs[i] * 0.2, hs[i] * 0.12);
    return { lift: hs[i] * 0.1 };
  }));
  const rocks = scatter(rand, R, 30, { near: 0.02, far: 0.3 });
  g.add(instanced(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x8c8f94, roughness: 1, flatShading: true }), rocks, (t, i, s) => {
    const r = R * (0.002 + rand() * 0.006);
    s.set(r, r * 0.6, r * 0.9);
    return { lift: r * 0.2 };
  }));
  return { group: g, boards: [] };
}

const BUILDERS = { city, rainforest, arctic, desert, wilds };

// ---------- details: the landing pad, plus a second layer of life for each landscape ----------
// Each adds meshes to the site group and may return a tick(t) that animates them.

const glow = (color, extra = {}) => new THREE.MeshBasicMaterial({ color, toneMapped: false, ...extra });
const groundAt = (R, x, z) => -(x * x + z * z) / (2 * R);
const spot = (R, x, z, yaw = 0) => ({ x, y: groundAt(R, x, z), z, up: new THREE.Vector3(x / R, 1, z / R).normalize(), yaw });
const dummy = new THREE.Object3D();

// Lay a flat shape (a lake) on the curved ground at x, z
function layFlat(mesh, R, x, z, sx = 1) {
  const up = new THREE.Vector3(x / R, 1, z / R).normalize();
  mesh.quaternion.setFromUnitVectors(Y, up).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  mesh.scale.set(sx, 1, 1);
  mesh.position.set(x, groundAt(R, x, z), z).addScaledVector(up, R * 0.0008);
  return mesh;
}

function landingPad(R, biome, g) {
  const tint = { city: 0x4fe3ff, desert: 0xffb84f, arctic: 0xbfe6ff, rainforest: 0x6fe39a, wilds: 0xd8d37a }[biome] || 0x6ee7ff;
  const pad = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.03, R * 0.032, R * 0.0016, 40), new THREE.MeshStandardMaterial({ color: 0x2a2f3c, metalness: 0.7, roughness: 0.45 }));
  base.position.y = R * 0.0008;
  const ring = new THREE.Mesh(new THREE.RingGeometry(R * 0.022, R * 0.025, 48), glow(tint, { side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = R * 0.0017;
  // An "H" style landing mark: two bars and a crossbar
  const markMat = glow(0xffffff, { transparent: true, opacity: 0.55 });
  [[-0.007, 0, 0.002, 0.016], [0.007, 0, 0.002, 0.016], [0, 0, 0.014, 0.002]].forEach(([x, z, w, d]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(R * w, R * d), markMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(R * x, R * 0.0017, R * z);
    pad.add(m);
  });
  const n = 12;
  const lights = new THREE.InstancedMesh(new THREE.SphereGeometry(R * 0.0011, 8, 6), glow(0xffffff), n);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    dummy.position.set(Math.cos(a) * R * 0.0285, R * 0.002, Math.sin(a) * R * 0.0285);
    dummy.updateMatrix();
    lights.setMatrixAt(i, dummy.matrix);
    lights.setColorAt(i, new THREE.Color(tint));
  }
  pad.add(base, ring, lights);
  g.add(pad);
  const c = new THREE.Color(), on = new THREE.Color(tint), off = new THREE.Color(tint).multiplyScalar(0.15);
  // Lights chase around the rim
  return (t) => {
    for (let i = 0; i < n; i++) {
      const k = Math.max(0, Math.cos((i / n) * Math.PI * 2 - t * 3));
      lights.setColorAt(i, c.lerpColors(off, on, Math.pow(k, 4)));
    }
    lights.instanceColor.needsUpdate = true;
  };
}

function cityDetails(R, rand, g) {
  const towers = (g.userData.towers || []).slice().sort((a, b) => b.h - a.h);
  // Antenna masts with blinking aircraft lights on the tallest towers
  const masts = towers.slice(0, 10);
  const mastH = masts.map(() => R * (0.008 + rand() * 0.012));
  g.add(instanced(new THREE.CylinderGeometry(0.15, 0.4, 1, 5), new THREE.MeshStandardMaterial({ color: 0x9aa3b5, metalness: 0.8, roughness: 0.3 }), masts, (t, i, s) => {
    s.set(R * 0.0012, mastH[i], R * 0.0012);
    return { lift: t.h + mastH[i] / 2 };
  }));
  const blinkMat = glow(0xff2a44, { transparent: true });
  g.add(instanced(new THREE.SphereGeometry(1, 8, 6), blinkMat, masts, (t, i, s) => {
    s.setScalar(R * 0.0016);
    return { lift: t.h + mastH[i] };
  }));

  // A holographic ring turning around the tallest tower
  const top = towers[0];
  let holo = null;
  if (top) {
    holo = new THREE.Mesh(new THREE.TorusGeometry(R * 0.018, R * 0.0009, 6, 48), glow(0x4fe3ff, { transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    holo.position.set(top.x, top.y + top.h * 0.75, top.z);
    g.add(holo);
  }

  // Street lamps glowing between the towers
  const lamps = scatter(rand, R, 160, { near: 0.035, far: 0.3 });
  g.add(instanced(new THREE.SphereGeometry(1, 6, 4), glow(0xffc77a), lamps, (t, i, s) => {
    s.setScalar(R * (0.0007 + rand() * 0.0005));
    return { lift: R * 0.002 };
  }));

  // Flying traffic on elliptical skyways above the city
  const cars = Array.from({ length: 26 }, (_, i) => ({
    r: R * (0.07 + rand() * 0.17), h: R * (0.035 + rand() * 0.06), speed: (0.08 + rand() * 0.12) * (i % 2 ? 1 : -1), phase: rand() * Math.PI * 2,
  }));
  const traffic = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), glow(0xffffff), cars.length);
  const palette = [new THREE.Color(0x4fe3ff), new THREE.Color(0xffb84f), new THREE.Color(0xff4fd8), new THREE.Color(0xffffff)];
  cars.forEach((_, i) => traffic.setColorAt(i, palette[i % palette.length]));
  g.add(traffic);
  const cz = R * 0.17;
  return (t) => {
    const blink = Math.sin(t * 4) > 0.3 ? 1 : 0.15;
    blinkMat.opacity = blink;
    if (holo) { holo.rotation.set(Math.PI / 2 + Math.sin(t * 0.7) * 0.25, t * 0.8, 0); }
    cars.forEach((c, i) => {
      const a = c.phase + t * c.speed;
      const x = Math.cos(a) * c.r, z = cz + Math.sin(a) * c.r * 0.6;
      dummy.position.set(x, c.h + groundAt(R, x, z), z);
      dummy.rotation.set(0, -Math.atan2(Math.cos(a) * 0.6 * Math.sign(c.speed), -Math.sin(a) * Math.sign(c.speed)), 0);
      dummy.scale.set(R * 0.008, R * 0.0018, R * 0.003);
      dummy.updateMatrix();
      traffic.setMatrixAt(i, dummy.matrix);
    });
    traffic.instanceMatrix.needsUpdate = true;
  };
}

function rainforestDetails(R, rand, g) {
  // Dense undergrowth
  const bushes = scatter(rand, R, 240, { near: 0.03, far: 0.3 });
  g.add(instanced(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), bushes, (t, i, s, c) => {
    const r = R * (0.002 + rand() * 0.004);
    s.set(r * 1.3, r * 0.8, r * 1.3);
    c.setHSL(0.28 + rand() * 0.1, 0.55, 0.1 + rand() * 0.12);
    return { lift: r * 0.3, color: true };
  }));
  // Giant emergent trees, tall trunks with layered crowns
  const giants = scatter(rand, R, 9, { near: 0.08, far: 0.3 });
  const gh = giants.map(() => R * (0.05 + rand() * 0.03));
  g.add(instanced(new THREE.CylinderGeometry(0.2, 0.35, 1, 7), new THREE.MeshStandardMaterial({ color: 0x5a4230, roughness: 1 }), giants, (t, i, s) => {
    s.set(R * 0.006, gh[i], R * 0.006);
    return { lift: gh[i] / 2 };
  }));
  [1, 0.82].forEach((level, k) => {
    g.add(instanced(new THREE.SphereGeometry(1, 10, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), giants, (t, i, s, c) => {
      const w = R * (0.02 - k * 0.006);
      s.set(w, w * 0.35, w);
      c.setHSL(0.3, 0.55, 0.14 + k * 0.05);
      return { lift: gh[i] * level, color: true };
    }));
  });
  // Bright jungle flowers
  const flowers = scatter(rand, R, 90, { near: 0.025, far: 0.22 });
  const flowerCols = [0xff4fa3, 0xffa94f, 0xfff06a, 0xc06aff];
  g.add(instanced(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x220011, roughness: 0.6 }), flowers, (t, i, s, c) => {
    s.setScalar(R * (0.0012 + rand() * 0.0012));
    c.set(flowerCols[i % flowerCols.length]);
    return { lift: R * 0.003, color: true };
  }));
  // Fireflies drifting over the canopy
  const n = 140, base = new Float32Array(n * 3), pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const z = R * (0.03 + rand() * 0.25), x = (rand() * 2 - 1) * (R * 0.04 + z * 0.8);
    base.set([x, groundAt(R, x, z) + R * (0.006 + rand() * 0.035), z], i * 3);
  }
  pos.set(base);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xd8ff6a, size: R * 0.0035, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  g.add(new THREE.Points(geo, mat));
  return (t) => {
    for (let i = 0; i < n; i++) {
      pos[i * 3] = base[i * 3] + Math.sin(t * 0.7 + i) * R * 0.003;
      pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 1.1 + i * 1.7) * R * 0.002;
      pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.6 + i * 0.5) * R * 0.003;
    }
    geo.attributes.position.needsUpdate = true;
    mat.opacity = 0.6 + Math.sin(t * 2.3) * 0.3;
  };
}

function aurora(R, x, z, w, hue) {
  const geo = new THREE.PlaneGeometry(R * w, R * 0.12, 64, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uK: { value: 9 / R }, uAmp: { value: R * 0.025 }, uHue: { value: hue } },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime, uK, uAmp;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(p.x * uK + uTime * 0.5) * uAmp;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uHue;
      varying vec2 vUv;
      void main() {
        float band = 0.5 + 0.5 * sin(vUv.x * 46.0 + uTime * 1.2 + sin(vUv.x * 7.0 - uTime * 0.4) * 3.0);
        float edge = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        float a = smoothstep(0.0, 0.3, vUv.y) * pow(1.0 - vUv.y, 1.5) * (0.3 + 0.7 * band) * edge;
        vec3 low = mix(vec3(0.15, 1.0, 0.55), vec3(0.3, 0.8, 1.0), uHue);
        vec3 col = mix(low, vec3(0.65, 0.35, 1.0), smoothstep(0.35, 1.0, vUv.y));
        gl_FragColor = vec4(col * a * 0.9, a);
      }`,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(R * x, groundAt(R, R * x, R * z) + R * 0.13, R * z);
  return m;
}

function arcticDetails(R, rand, g) {
  // Snow-laden pines
  const pines = scatter(rand, R, 45, { near: 0.05, far: 0.32 });
  const ph = pines.map(() => R * (0.012 + rand() * 0.016));
  g.add(instanced(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), pines, (t, i, s, c) => {
    s.set(ph[i] * 0.3, ph[i], ph[i] * 0.3);
    c.setHSL(0.45, 0.25, 0.3 + rand() * 0.15);
    return { lift: ph[i] * 0.55, color: true };
  }));
  g.add(instanced(new THREE.ConeGeometry(1, 1, 7), new THREE.MeshStandardMaterial({ color: 0xf6fbff, roughness: 0.6 }), pines, (t, i, s) => {
    s.set(ph[i] * 0.18, ph[i] * 0.45, ph[i] * 0.18);
    return { lift: ph[i] * 0.85 };
  }));
  // Glowing ice crystal clusters
  const crystals = scatter(rand, R, 36, { near: 0.03, far: 0.26 });
  g.add(instanced(new THREE.OctahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0xbfe9ff, emissive: 0x2a8fd0, emissiveIntensity: 0.9, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.9 }), crystals, (t, i, s) => {
    const h = R * (0.003 + rand() * 0.008);
    s.set(h * 0.35, h, h * 0.35);
    return { lift: h * 0.6 };
  }));
  // A frozen lake off to one side
  const lake = new THREE.Mesh(new THREE.CircleGeometry(R * 0.04, 40), new THREE.MeshStandardMaterial({ color: 0xa9d8f5, roughness: 0.08, metalness: 0.35 }));
  g.add(layFlat(lake, R, -R * 0.11, R * 0.13, 1.6));
  // Aurora curtains across the sky
  const curtains = [aurora(R, -0.05, 0.36, 0.55, 0), aurora(R, 0.12, 0.42, 0.45, 0.6)];
  curtains[1].rotation.y = -0.35;
  curtains[0].rotation.y = 0.2;
  g.add(...curtains);
  return (t) => curtains.forEach((m) => { m.material.uniforms.uTime.value = t; });
}

function desertDetails(R, rand, g) {
  // Rolling dunes
  const dunes = scatter(rand, R, 22, { near: 0.06, far: 0.34 });
  g.add(instanced(new THREE.SphereGeometry(1, 16, 8), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), dunes, (t, i, s, c) => {
    const w = R * (0.02 + rand() * 0.04);
    s.set(w, w * 0.18, w * (0.4 + rand() * 0.4));
    c.setHSL(0.09 + rand() * 0.02, 0.55, 0.55 + rand() * 0.1);
    return { lift: -w * 0.04, color: true };
  }));
  // A pyramid on the horizon and a ring of ruined columns nearer by
  const pyramid = new THREE.Mesh(new THREE.ConeGeometry(R * 0.05, R * 0.045, 4), new THREE.MeshStandardMaterial({ color: 0xd8b070, roughness: 0.95, flatShading: true }));
  const px = -R * 0.02, pz = R * 0.31;
  pyramid.position.set(px, groundAt(R, px, pz) + R * 0.0225, pz);
  pyramid.rotation.y = Math.PI / 4 + 0.3;
  g.add(pyramid);
  const cols = [];
  const rx = -R * 0.09, rz = R * 0.13;
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    cols.push({ ...spot(R, rx + Math.cos(a) * R * 0.025, rz + Math.sin(a) * R * 0.018), h: R * (rand() < 0.35 ? 0.004 + rand() * 0.004 : 0.012 + rand() * 0.004) });
  }
  g.add(instanced(new THREE.CylinderGeometry(1, 1.1, 1, 10), new THREE.MeshStandardMaterial({ color: 0xe9d6b0, roughness: 0.9 }), cols, (t, i, s) => {
    s.set(R * 0.0016, t.h, R * 0.0016);
    return { lift: t.h / 2 };
  }));
  // Saguaro cacti with arms
  const cacti = scatter(rand, R, 14, { near: 0.03, far: 0.22 });
  const cactusMat = new THREE.MeshStandardMaterial({ color: 0x4f7d3a, roughness: 0.85 });
  const ch = cacti.map(() => R * (0.008 + rand() * 0.008));
  g.add(instanced(new THREE.CapsuleGeometry(1, 1, 3, 8), cactusMat, cacti, (t, i, s) => {
    s.set(R * 0.0013, ch[i] / 2, R * 0.0013);
    return { lift: ch[i] / 2 };
  }));
  const arms = [];
  cacti.forEach((c, i) => [-1, 1].forEach((side) => {
    if (rand() < 0.3) return;
    const a = spot(R, c.x + side * R * 0.0028, c.z);
    arms.push({ ...a, h: ch[i] * (0.3 + rand() * 0.25), lift: ch[i] * (0.4 + rand() * 0.2) });
  }));
  g.add(instanced(new THREE.CapsuleGeometry(1, 1, 3, 8), cactusMat, arms, (t, i, s) => {
    s.set(R * 0.001, t.h / 2, R * 0.001);
    return { lift: t.lift + t.h / 2 };
  }));
  // A dust devil wandering across the sand
  const devil = new THREE.Mesh(new THREE.ConeGeometry(R * 0.012, R * 0.05, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0xe8c48a, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }));
  devil.rotation.x = Math.PI;
  g.add(devil);
  return (t) => {
    const x = R * (0.06 + Math.sin(t * 0.13) * 0.08), z = R * (0.2 + Math.sin(t * 0.09) * 0.04);
    devil.position.set(x, groundAt(R, x, z) + R * 0.025, z);
    devil.rotation.y = t * 4;
    devil.material.opacity = 0.16 + Math.sin(t * 1.7) * 0.06;
  };
}

function wildsDetails(R, rand, g) {
  // A lake with a reflective surface
  const lx = -R * 0.09, lz = R * 0.12;
  const lake = new THREE.Mesh(new THREE.CircleGeometry(R * 0.035, 40), new THREE.MeshStandardMaterial({ color: 0x2f6f9a, roughness: 0.05, metalness: 0.5 }));
  g.add(layFlat(lake, R, lx, lz, 1.5));
  // Broadleaf trees with round crowns
  const trees = scatter(rand, R, 30, { near: 0.05, far: 0.3, avoid: [{ x: lx, w: R * 0.06, z: lz + R * 0.04 }] });
  const th = trees.map(() => R * (0.008 + rand() * 0.01));
  g.add(instanced(new THREE.CylinderGeometry(0.2, 0.3, 1, 5), new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 1 }), trees, (t, i, s) => {
    s.set(R * 0.004, th[i], R * 0.004);
    return { lift: th[i] / 2 };
  }));
  g.add(instanced(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), trees, (t, i, s, c) => {
    const r = th[i] * 0.55;
    s.setScalar(r);
    c.setHSL(0.2 + rand() * 0.1, 0.5, 0.22 + rand() * 0.12);
    return { lift: th[i] + r * 0.4, color: true };
  }));
  // Grass tufts and wildflowers
  const grass = scatter(rand, R, 320, { near: 0.025, far: 0.25, avoid: [{ x: lx, w: R * 0.055, z: lz + R * 0.03 }] });
  g.add(instanced(new THREE.ConeGeometry(1, 1, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true }), grass, (t, i, s, c) => {
    const h = R * (0.002 + rand() * 0.003);
    s.set(h * 0.4, h, h * 0.4);
    c.setHSL(0.22 + rand() * 0.08, 0.5, 0.25 + rand() * 0.15);
    return { lift: h / 2, color: true };
  }));
  const flowers = scatter(rand, R, 70, { near: 0.025, far: 0.18 });
  const flowerCols = [0xfff06a, 0xffffff, 0xc06aff, 0xff7a7a];
  g.add(instanced(new THREE.SphereGeometry(1, 6, 4), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }), flowers, (t, i, s, c) => {
    s.setScalar(R * 0.001);
    c.set(flowerCols[i % flowerCols.length]);
    return { lift: R * 0.0025, color: true };
  }));
  // A campfire beside the pad
  const fx = R * 0.045, fz = R * 0.03, fy = groundAt(R, fx, fz);
  const logs = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.0012, R * 0.0012, R * 0.007, 6), new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 }));
  logs.rotation.z = Math.PI / 2;
  logs.position.set(fx, fy + R * 0.0012, fz);
  const logs2 = logs.clone();
  logs2.rotation.set(0, Math.PI / 2, Math.PI / 2);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(R * 0.0025, R * 0.008, 8), glow(0xff8a2a, { transparent: true, opacity: 0.9 }));
  const core = new THREE.Mesh(new THREE.ConeGeometry(R * 0.0014, R * 0.005, 8), glow(0xffe08a));
  flame.position.set(fx, fy + R * 0.005, fz);
  core.position.set(fx, fy + R * 0.0038, fz);
  g.add(logs, logs2, flame, core);
  // Birds circling over the trees
  const birds = Array.from({ length: 9 }, () => ({ r: R * (0.04 + rand() * 0.05), h: R * (0.05 + rand() * 0.03), speed: 0.25 + rand() * 0.2, phase: rand() * Math.PI * 2 }));
  const flock = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 3), glow(0x1a1d24), birds.length);
  g.add(flock);
  const bx = -R * 0.04, bz = R * 0.2;
  return (t) => {
    flame.scale.set(1, 0.85 + Math.sin(t * 13) * 0.12 + Math.sin(t * 7.3) * 0.08, 1);
    core.scale.set(1, 0.9 + Math.sin(t * 11 + 1) * 0.1, 1);
    birds.forEach((b, i) => {
      const a = b.phase + t * b.speed;
      const x = bx + Math.cos(a) * b.r, z = bz + Math.sin(a) * b.r * 0.7;
      dummy.position.set(x, b.h + groundAt(R, x, z) + Math.sin(t * 2 + i) * R * 0.002, z);
      dummy.rotation.set(Math.PI / 2, 0, -a);
      const flap = 0.6 + Math.abs(Math.sin(t * 9 + i)) * 0.6;
      dummy.scale.set(R * 0.0028 * flap, R * 0.0035, R * 0.0006);
      dummy.updateMatrix();
      flock.setMatrixAt(i, dummy.matrix);
    });
    flock.instanceMatrix.needsUpdate = true;
  };
}

const DETAILS = { city: cityDetails, rainforest: rainforestDetails, arctic: arcticDetails, desert: desertDetails, wilds: wildsDetails };

export function buildSite(R, biome, seed, info = {}) {
  const rand = rng(seed);
  const site = (BUILDERS[biome] || wilds)(R, rand, info);
  const ticks = [landingPad(R, biome, site.group), (DETAILS[biome] || wildsDetails)(R, rand, site.group)].filter(Boolean);
  site.tick = (t) => ticks.forEach((f) => f(t));
  site.group.traverse((o) => { o.frustumCulled = false; });
  return site;
}

export function disposeSite(site) {
  if (!site) return;
  site.group.removeFromParent();
  site.group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      if (o.material.emissiveMap) o.material.emissiveMap.dispose();
      o.material.dispose();
    }
  });
}
