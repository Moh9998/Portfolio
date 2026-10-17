// Boots the solar system view on top of the classic page and keeps the two in sync.
const root = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const toggle = document.getElementById("view-toggle");

function webglAvailable() {
  try {
    const c = document.createElement("canvas");
    return !!(window.WebGL2RenderingContext && c.getContext("webgl2"));
  } catch (e) {
    return false;
  }
}

function readPrefs() {
  try { return localStorage.getItem("portfolio-view"); } catch (e) { return null; }
}
function savePrefs(v) {
  try { localStorage.setItem("portfolio-view", v); } catch (e) { /* private mode */ }
}

// Content model straight from the DOM: planets are <section class="planet">, continents are their <article>s
const planets = [...document.querySelectorAll(".planet")].map((el) => ({
  id: el.id,
  name: el.dataset.name,
  label: el.dataset.label,
  el,
  greeting: el.dataset.greeting,
  continents: [...el.querySelectorAll(".continent")].map((c) => ({ id: c.id, name: c.dataset.name, biome: c.dataset.biome || "wilds", el: c })),
}));
const byId = new Map(planets.map((p) => [p.id, p]));

function parseHash(hash) {
  const id = decodeURIComponent((hash || "").replace(/^#/, ""));
  if (byId.has(id)) return { planet: id, continent: -1 };
  for (const p of planets) {
    const i = p.continents.findIndex((c) => c.id === id);
    if (i >= 0) return { planet: p.id, continent: i };
  }
  return { planet: planets[0].id, continent: -1 };
}

let world = null;
let weather = null;
let state = { planet: null, continent: -1 };   // continent -1: in orbit
let pending = null;
let busy = false;

async function enterSpace() {
  root.classList.add("space", "booting");
  toggle.textContent = "Classic view";
  if (!world) {
    const { World, PLANET_LOOKS } = await import("./world.js");
    weather = await import("./weather.js");
    world = new World(document.getElementById("universe"), planets.map((p) => ({ id: p.id, continents: p.continents })), { reducedMotion });
    paintNav(PLANET_LOOKS);
    buildLabels(PLANET_LOOKS);
    bindPointer();
  }
  layout();
  world.start();
  requestAnimationFrame(tickLabels);
  const target = parseHash(location.hash);
  state = { planet: null, continent: -1 };
  root.classList.remove("booting");
  navigate(target.planet, target.continent, { first: !world.current });
}

function exitSpace() {
  root.classList.remove("space", "traveling", "booting", "landed", "descending");
  delete root.dataset.biome;
  if (weather) weather.setWeather(null);
  toggle.textContent = "Space view";
  if (world) world.stop();
  document.querySelectorAll(".is-active").forEach((el) => el.classList.remove("is-active"));
  const target = document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView();
}

// ---------- navigation ----------
// A visit has two levels: orbiting a planet (its greeting and stats), and landing on one of its continents.

async function navigate(planetId, index, { first = false } = {}) {
  if (busy) { pending = { planetId, index }; return; }
  busy = true;
  const p = byId.get(planetId);
  index = Math.min(index, p.continents.length - 1);
  try {
    if (state.planet !== planetId) {
      if (state.continent >= 0) await lift();
      root.classList.add("traveling");
      document.getElementById("warp-text").textContent = (first ? "Approaching " : "Warping to ") + p.name;
      showOrbit(planetId);
      await world.flyTo(planetId, { first });
      root.classList.remove("traveling");
      state = { planet: planetId, continent: -1 };
      showOrbit(planetId);
      greet(p);
    }
    if (index < 0) {
      if (state.continent >= 0) { await lift(); showOrbit(planetId); }
      else world.focusContinent(planetId, 0);
    } else if (index !== state.continent) {
      const c = p.continents[index];
      root.classList.add("descending");
      root.classList.remove("landed");
      document.getElementById("warp-text").textContent = (state.continent >= 0 ? "Flying over to " : "Descending to ") + c.name;
      weather.setWeather(null);
      await world.land(planetId, index, { biome: c.biome, boards: boardsFor(p, c) });
      state.continent = index;
      root.classList.remove("descending");
      showSite(planetId, index);
    }
  } finally {
    busy = false;
    if (pending) {
      const next = pending;
      pending = null;
      navigate(next.planetId, next.index);
    }
  }
}

async function lift() {
  root.classList.add("descending");
  root.classList.remove("landed");
  delete root.dataset.biome;
  weather.setWeather(null);
  document.getElementById("warp-text").textContent = "Taking off";
  await world.takeOff();
  state.continent = -1;
  root.classList.remove("descending");
}

// What the city billboards show: the section's own content, a live readout, and an ad for its owner
function boardsFor(p, c) {
  const clean = (t) => t.replace(/\s+/g, " ").trim();
  const items = [...c.el.querySelectorAll("li, .facts > div, p:not(.when):not(.form-note), h4")]
    .filter((n) => !n.closest(".site-head") && !n.querySelector("li"))
    .map((n) => (n.matches(".facts > div") ? clean(n.querySelector("dt").textContent) + ": " + clean(n.querySelector("dd").textContent) : clean(n.textContent)))
    .filter((t) => t && t.length < 140)
    .slice(0, 6);
  const h3 = clean(c.el.querySelector("h3")?.textContent || c.name);
  const when = clean(c.el.querySelector(".when")?.textContent || "");
  const w = window.Portfolio.conditions(p.el, c.biome);
  const t = window.Portfolio.siteTime(p.el, p.continents.indexOf(c));
  return [
    { kicker: h3, lines: [h3, ...items].slice(0, 6) },
    { kicker: "Live · " + c.name, lines: [when, "Local time " + t.text + " · " + w.temp + "\u00a0°C", ...items.slice().reverse()].filter(Boolean).slice(0, 5) },
    { kicker: "Mohammed Hussain", lines: ["Software Developer from Baghdad", p.greeting + " Welcome to " + p.name + ".", "Hire me: mohammed.halkfgi@gmail.com", "ASP.NET Core · SQL Server · React"] },
  ];
}

function markNav(planetId) {
  planets.forEach((q) => q.el.classList.toggle("is-active", q.id === planetId));
  document.querySelectorAll("#planet-list a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.planet === planetId)));
}

function showOrbit(planetId) {
  const p = byId.get(planetId);
  markNav(planetId);
  p.continents.forEach((c) => c.el.classList.remove("is-active"));
  root.classList.remove("landed");
  delete root.dataset.biome;
  document.getElementById("panel-controls").hidden = true;
  document.title = `${p.name} · Mohammed Hussain`;
  document.getElementById("content").scrollTop = 0;
  reveal(p.el.querySelector(".planet-brief"));
  layout();
}

function showSite(planetId, index) {
  const p = byId.get(planetId);
  const c = p.continents[index];
  markNav(planetId);
  p.continents.forEach((q, i) => q.el.classList.toggle("is-active", i === index));
  root.classList.add("landed");
  root.dataset.biome = c.biome;
  if (!reducedMotion) weather.setWeather(c.biome);
  document.getElementById("site-path").textContent = `${p.name} · ${c.name}`;
  document.getElementById("continent-count").textContent = `${index + 1} / ${p.continents.length}`;
  document.getElementById("panel-controls").hidden = false;
  document.title = `${c.name} · ${p.name} · Mohammed Hussain`;
  document.getElementById("content").scrollTop = 0;
  reveal(c.el);
  layout();
}

// Arrival greeting floats over the planet for a moment
let greetTimer = 0;
function greet(p) {
  const el = document.getElementById("greet");
  el.querySelector(".g1").textContent = p.greeting;
  el.querySelector(".g2").textContent = "Welcome to " + p.name;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(greetTimer);
  greetTimer = setTimeout(() => el.classList.remove("show"), reducedMotion ? 2500 : 3600);
}

// Items in a section arrive one after another; numbers count up
function reveal(el) {
  if (!el) return;
  el.querySelectorAll("h3, .hero-name, .hero-roles, p, li, .facts > div, .planet-stats > div, .profile img, .contact-form > *, .site-head > *").forEach((n, i) => {
    n.style.setProperty("--i", Math.min(i, 14));
    n.classList.remove("rv");
    void n.offsetWidth;
    n.classList.add("rv");
  });
  if (reducedMotion) return;
  el.querySelectorAll(".stats strong").forEach((s) => {
    const target = parseInt(s.dataset.value || s.textContent, 10);
    const suffix = s.dataset.suffix ?? s.textContent.replace(/^\d+/, "");
    s.dataset.value = target;
    s.dataset.suffix = suffix;
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min((now - t0) / 900, 1);
      s.textContent = Math.round(target * (1 - Math.pow(1 - k, 3))) + suffix;
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function go(planetId, index) {
  const id = index < 0 ? planetId : byId.get(planetId).continents[index].id;
  if (location.hash !== "#" + id) history.pushState(null, "", "#" + id);
  navigate(planetId, index);
}

function step(dir) {
  const p = byId.get(state.planet || planets[0].id);
  const n = p.continents.length;
  const from = state.continent < 0 ? (dir > 0 ? -1 : 0) : state.continent;
  go(p.id, (from + dir + n) % n);
}

function stepPlanet(dir) {
  const i = planets.findIndex((p) => p.id === state.planet);
  const next = planets[(i + dir + planets.length) % planets.length];
  go(next.id, -1);
}

// ---------- HUD ----------

function paintNav(looks) {
  document.querySelectorAll("#planet-list a").forEach((a) => a.style.setProperty("--planet-color", looks[a.dataset.planet].glow));
}

let continentLabels = new Map();
let hoverSite = -1;
let planetLabels = new Map();
function buildLabels(looks) {
  const layer = document.getElementById("labels");
  planets.forEach((p) => {
    const pl = document.createElement("button");
    pl.type = "button";
    pl.tabIndex = -1;
    pl.className = "label planet-label hidden";
    pl.textContent = p.name;
    pl.style.setProperty("--c", looks[p.id].glow);
    pl.addEventListener("click", () => go(p.id, -1));
    layer.appendChild(pl);
    planetLabels.set(p.id, pl);

    continentLabels.set(p.id, p.continents.map((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = "label hidden";
      b.textContent = c.name;
      b.style.setProperty("--c", looks[p.id].continents[i % looks[p.id].continents.length]);
      b.addEventListener("click", () => go(p.id, i));
      layer.appendChild(b);
      return b;
    }));
  });
}

function tickLabels() {
  if (!root.classList.contains("space")) return;
  const cont = world.continentScreen();
  continentLabels.forEach((labels, pid) => {
    labels.forEach((b, i) => {
      const s = cont && pid === world.current ? cont[i] : null;
      b.classList.toggle("hidden", !s || !s.visible);
      b.classList.toggle("active", !!s && i === hoverSite && pid === state.planet);
      if (s) b.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -50%)`;
    });
  });
  const ps = world.planetScreen();
  planetLabels.forEach((b, pid) => {
    const s = ps[pid];
    const show = s.visible && pid !== world.current && !world.travel;
    b.classList.toggle("hidden", !show);
    b.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
  });
  requestAnimationFrame(tickLabels);
}

// Fit the planet into whatever space the console leaves free
function layout() {
  if (!world || !root.classList.contains("space")) return;
  const w = window.innerWidth, h = window.innerHeight;
  // Offsets, not the bounding box: the console may be mid slide-in, and its transform would skew the measure
  const main = document.getElementById("content");
  const r = { left: main.offsetLeft, top: main.offsetTop };
  let free;
  if (w > 820 && h > 500) free = { x0: 0, x1: r.left, y0: 70, y1: h - 80 };
  else if (w > h) free = { x0: 0, x1: r.left, y0: 44, y1: h - 50 };
  else free = { x0: 0, x1: w, y0: 56, y1: r.top };
  const cx = (free.x0 + free.x1) / 2, cy = (free.y0 + free.y1) / 2;
  const size = Math.max(110, Math.min(free.x1 - free.x0, free.y1 - free.y0) * (w > 820 && h > 500 ? 0.74 : 0.86));
  world.setFrame(w / 2 - cx, h / 2 - cy, size);
  root.style.setProperty("--fx", cx + "px");
  root.style.setProperty("--fy", cy + "px");
  root.style.setProperty("--sheet-gap", (h - r.top) + "px");
  root.classList.toggle("tight", free.y1 - free.y0 < 150);
}

function bindPointer() {
  const canvas = document.getElementById("universe");
  let down = null;
  canvas.addEventListener("pointerdown", (e) => {
    down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (down) {
      const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
        down.moved = true;
        canvas.classList.add("dragging");
      }
      if (down.moved) world.dragPlanet(dx, dy);
      down.lx = e.clientX; down.ly = e.clientY;
      return;
    }
    const i = world.pickContinent(e.clientX, e.clientY);
    world.setHover(i);
    hoverSite = i;
    canvas.classList.toggle("hovering", i >= 0);
  });
  const end = (e) => {
    if (down && !down.moved) {
      const i = world.pickContinent(e.clientX, e.clientY);
      if (i >= 0) go(world.current, i);
    }
    down = null;
    canvas.classList.remove("dragging");
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", () => { down = null; canvas.classList.remove("dragging"); });
  canvas.addEventListener("pointerleave", () => world.setHover(-1));
}

// ---------- wiring ----------

// On-screen arrows mirror the keyboard: up/down change planet, left/right change continent
const steer = { up: () => stepPlanet(-1), down: () => stepPlanet(1), left: () => step(-1), right: () => step(1) };
document.querySelectorAll("#dpad [data-steer]").forEach((b) => {
  b.addEventListener("click", () => {
    steer[b.dataset.steer]();
    if (navigator.vibrate) navigator.vibrate(8);
  });
});

document.getElementById("prev-continent").addEventListener("click", () => step(-1));
document.getElementById("take-off").addEventListener("click", () => { if (state.planet) go(state.planet, -1); });
document.getElementById("next-continent").addEventListener("click", () => step(1));

// In space mode, in-page links become flights instead of scrolls
document.addEventListener("click", (e) => {
  if (!root.classList.contains("space")) return;
  const a = e.target.closest('a[href^="#"]');
  if (!a || a.classList.contains("skip-link")) return;
  const id = a.getAttribute("href").slice(1);
  const t = parseHash("#" + id);
  if (!byId.has(id) && !document.getElementById(id)?.classList.contains("continent")) return;
  e.preventDefault();
  go(t.planet, t.continent);
});

window.addEventListener("popstate", () => {
  if (!root.classList.contains("space")) return;
  const t = parseHash(location.hash);
  navigate(t.planet, t.continent);
});

window.addEventListener("keydown", (e) => {
  if (!root.classList.contains("space")) return;
  if (e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const pad = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" }[e.key];
  if (pad) {
    const b = document.querySelector(`#dpad [data-steer="${pad}"]`);
    b.classList.add("pressed");
    setTimeout(() => b.classList.remove("pressed"), 150);
  }
  if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  else if (e.key === "ArrowDown") { e.preventDefault(); stepPlanet(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); stepPlanet(-1); }
  else if (e.key === "Escape" && state.planet) go(state.planet, -1);
  else if (/^[1-9]$/.test(e.key) && planets[+e.key - 1]) go(planets[+e.key - 1].id, -1);
});

// While typing on a touch screen, give the form the whole screen
const isField = (el) => el && el.matches && el.matches("#content input, #content textarea");
document.addEventListener("focusin", (e) => {
  if (!root.classList.contains("space") || !isField(e.target) || !matchMedia("(pointer: coarse), (max-width: 820px)").matches) return;
  root.classList.add("kb");
  setTimeout(() => e.target.scrollIntoView({ block: "center" }), 300);
});
document.addEventListener("focusout", () => {
  setTimeout(() => { if (!isField(document.activeElement)) root.classList.remove("kb"); }, 100);
});

// Save battery: stop rendering while the tab is in the background
document.addEventListener("visibilitychange", () => {
  if (!world || !root.classList.contains("space")) return;
  if (document.hidden) world.stop();
  else { world.clock.getDelta(); world.start(); }
});

window.addEventListener("resize", layout);
if (window.ResizeObserver) new ResizeObserver(layout).observe(document.getElementById("content"));

toggle.addEventListener("click", () => {
  if (root.classList.contains("space")) { savePrefs("classic"); exitSpace(); }
  else { savePrefs("space"); enterSpace(); }
});

// Space view needs WebGL2; without it the classic page is the whole site.
if (webglAvailable()) {
  toggle.hidden = false;
  const pref = readPrefs();
  // Visitors who ask for reduced motion start on the classic page unless they chose space before
  if (pref === "space" || (!reducedMotion && pref !== "classic")) enterSpace().catch((err) => { console.error(err); exitSpace(); toggle.hidden = true; });
  else exitSpace();
}
