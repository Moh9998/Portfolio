// Weather drawn over the landed view: snow and aurora, rain, blowing sand, pollen, city glints.
const canvas = document.getElementById("weather");
const g = canvas.getContext("2d");
let biome = null, parts = [], raf = 0, last = 0, W = 0, H = 0, dpr = 1;

const SPEC = {
  arctic: { n: 150, make: () => ({ x: rnd(W), y: rnd(H), r: 0.6 + rnd(2.2), vy: 18 + rnd(30), vx: -8 + rnd(16), ph: rnd(6) }) },
  rainforest: { n: 170, make: () => ({ x: rnd(W * 1.2), y: rnd(H), l: 10 + rnd(16), vy: 520 + rnd(260), a: 0.15 + rnd(0.3) }) },
  desert: { n: 130, make: () => ({ x: rnd(W), y: H * 0.35 + rnd(H * 0.65), l: 6 + rnd(22), vx: 160 + rnd(220), a: 0.1 + rnd(0.35) }) },
  wilds: { n: 46, make: () => ({ x: rnd(W), y: H * 0.3 + rnd(H * 0.7), r: 1 + rnd(1.8), vx: -10 + rnd(20), vy: -6 - rnd(10), ph: rnd(6) }) },
  city: { n: 40, make: () => ({ x: rnd(W), y: rnd(H), r: 0.8 + rnd(1.6), vy: -10 - rnd(20), ph: rnd(6), c: Math.random() < 0.5 ? "255,79,216" : "79,227,255" }) },
};

function rnd(n) { return Math.random() * n; }

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const t = now / 1000;
  g.clearRect(0, 0, W, H);

  if (biome === "arctic") {
    // Aurora ribbons across the top of the sky
    for (let k = 0; k < 2; k++) {
      g.beginPath();
      for (let x = 0; x <= W; x += 16) {
        const y = H * (0.12 + k * 0.07) + Math.sin(x * 0.006 + t * (0.4 + k * 0.2) + k) * 26 + Math.sin(x * 0.017 - t * 0.7) * 10;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.lineWidth = 40 - k * 14;
      g.strokeStyle = k ? "rgba(160,110,255,0.10)" : "rgba(90,255,190,0.12)";
      g.shadowColor = k ? "#a06eff" : "#5affbe";
      g.shadowBlur = 30;
      g.stroke();
    }
    g.shadowBlur = 0;
  }

  parts.forEach((p) => {
    switch (biome) {
      case "arctic":
        p.y += p.vy * dt; p.x += (p.vx + Math.sin(t + p.ph) * 12) * dt;
        if (p.y > H) { p.y = -4; p.x = rnd(W); }
        g.fillStyle = "rgba(240,248,255,0.8)";
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
        break;
      case "rainforest":
        p.y += p.vy * dt; p.x -= p.vy * 0.12 * dt;
        if (p.y > H) { p.y = -p.l; p.x = rnd(W * 1.2); }
        g.strokeStyle = `rgba(190,230,255,${p.a})`;
        g.lineWidth = 1;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + p.l * 0.12, p.y - p.l); g.stroke();
        break;
      case "desert":
        p.x += p.vx * dt; p.y += Math.sin(t * 2 + p.x * 0.01) * 6 * dt;
        if (p.x > W + 30) { p.x = -30; p.y = H * 0.35 + rnd(H * 0.65); }
        g.strokeStyle = `rgba(240,200,140,${p.a})`;
        g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.l, p.y + 1); g.stroke();
        break;
      case "wilds":
        p.x += (p.vx + Math.sin(t * 0.7 + p.ph) * 8) * dt; p.y += p.vy * dt;
        if (p.y < H * 0.2) { p.y = H + 4; p.x = rnd(W); }
        g.fillStyle = `rgba(230,255,150,${0.35 + 0.35 * Math.sin(t * 2 + p.ph)})`;
        g.shadowColor = "#e6ff96"; g.shadowBlur = 8;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
        g.shadowBlur = 0;
        break;
      case "city":
        p.y += p.vy * dt;
        if (p.y < -4) { p.y = H + 4; p.x = rnd(W); }
        g.fillStyle = `rgba(${p.c},${0.25 + 0.25 * Math.sin(t * 3 + p.ph)})`;
        g.beginPath(); g.arc(p.x, p.y, p.r, 0, 7); g.fill();
        break;
    }
  });
  raf = requestAnimationFrame(draw);
}

export function setWeather(next) {
  if (next === biome) return;
  cancelAnimationFrame(raf);
  biome = next;
  if (!biome || !SPEC[biome]) { biome = null; g.clearRect(0, 0, W, H); return; }
  resize();
  const spec = SPEC[biome];
  const count = Math.round(spec.n * Math.min(1, (W * H) / (1440 * 900) + 0.35));
  parts = Array.from({ length: count }, spec.make);
  last = performance.now();
  raf = requestAnimationFrame(draw);
}

window.addEventListener("resize", () => { if (biome) resize(); });
