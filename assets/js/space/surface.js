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
  const words = String(text).split(/\s+/);
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

export function buildSite(R, biome, seed, info = {}) {
  const rand = rng(seed);
  const site = (BUILDERS[biome] || wilds)(R, rand, info);
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
