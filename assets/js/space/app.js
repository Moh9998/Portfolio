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
  continents: [...el.querySelectorAll(".continent")].map((c) => ({ id: c.id, name: c.dataset.name, el: c })),
}));
const byId = new Map(planets.map((p) => [p.id, p]));

function parseHash(hash) {
  const id = decodeURIComponent((hash || "").replace(/^#/, ""));
  if (byId.has(id)) return { planet: id, continent: 0 };
  for (const p of planets) {
    const i = p.continents.findIndex((c) => c.id === id);
    if (i >= 0) return { planet: p.id, continent: i };
  }
  return { planet: planets[0].id, continent: 0 };
}

let world = null;
let state = { planet: null, continent: 0 };
let pending = null;
let flying = false;

async function enterSpace() {
  root.classList.add("space", "booting");
  toggle.textContent = "Classic view";
  if (!world) {
    const { World, PLANET_LOOKS } = await import("./world.js");
    world = new World(document.getElementById("universe"), planets.map((p) => ({ id: p.id, continents: p.continents })), { reducedMotion });
    paintNav(PLANET_LOOKS);
    buildLabels(PLANET_LOOKS);
    bindPointer();
  }
  layout();
  world.start();
  requestAnimationFrame(tickLabels);
  const target = parseHash(location.hash);
  state = { planet: null, continent: 0 };
  root.classList.remove("booting");
  navigate(target.planet, target.continent, { first: !world.current });
}

function exitSpace() {
  root.classList.remove("space", "traveling", "booting");
  toggle.textContent = "Space view";
  if (world) world.stop();
  document.querySelectorAll(".is-active").forEach((el) => el.classList.remove("is-active"));
  const target = document.getElementById(location.hash.slice(1));
  if (target) target.scrollIntoView();
}

// ---------- navigation ----------

async function navigate(planetId, index, { first = false } = {}) {
  if (flying) { pending = { planetId, index }; return; }
  const p = byId.get(planetId);
  index = Math.max(0, Math.min(index, p.continents.length - 1));

  if (state.planet !== planetId) {
    flying = true;
    root.classList.add("traveling");
    document.getElementById("warp-text").textContent = (first ? "Approaching " : "Warping to ") + p.name;
    showPlanet(planetId, index);
    await world.flyTo(planetId, { first });
    root.classList.remove("traveling");
    flying = false;
    state.planet = planetId;
    if (pending) {
      const next = pending;
      pending = null;
      if (next.planetId !== planetId) return navigate(next.planetId, next.index);
      index = next.index;
    }
  }
  state.continent = index;
  world.focusContinent(planetId, index);
  showPlanet(planetId, index);
  return undefined;
}

function showPlanet(planetId, index) {
  const p = byId.get(planetId);
  planets.forEach((q) => q.el.classList.toggle("is-active", q === p));
  p.continents.forEach((c, i) => c.el.classList.toggle("is-active", i === index));
  document.querySelectorAll("#planet-list a").forEach((a) => a.setAttribute("aria-current", String(a.dataset.planet === planetId)));
  p.el.querySelectorAll(".continent-tabs a").forEach((a, i) => a.setAttribute("aria-current", String(i === index)));
  document.getElementById("continent-count").textContent = `${index + 1} / ${p.continents.length} · ${p.continents[index].name}`;
  document.getElementById("panel-controls").hidden = false;
  document.title = `${p.continents[index].name} · ${p.name} · Mohammed Hussain`;
  document.getElementById("content").scrollTop = 0;
}

function go(planetId, index) {
  const id = byId.get(planetId).continents[index].id;
  if (location.hash !== "#" + id) history.pushState(null, "", "#" + id);
  navigate(planetId, index);
}

function step(dir) {
  const p = byId.get(state.planet || planets[0].id);
  const n = p.continents.length;
  go(p.id, (state.continent + dir + n) % n);
}

function stepPlanet(dir) {
  const i = planets.findIndex((p) => p.id === state.planet);
  const next = planets[(i + dir + planets.length) % planets.length];
  go(next.id, 0);
}

// ---------- HUD ----------

function paintNav(looks) {
  document.querySelectorAll("#planet-list a").forEach((a) => a.style.setProperty("--planet-color", looks[a.dataset.planet].glow));
}

let continentLabels = new Map();
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
    pl.addEventListener("click", () => go(p.id, 0));
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
      b.classList.toggle("active", !!s && i === state.continent && pid === state.planet);
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

function layout() {
  if (!world) return;
  // Mirrors the console geometry in space.css (side panel on desktop, bottom sheet on phones)
  const w = window.innerWidth, h = window.innerHeight;
  if (w > 820) world.setPanelInset((Math.min(420, w - 48) + 24) / 2, 0);
  else world.setPanelInset(0, (h * 0.46 + 74) / 2 - 20);
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

document.getElementById("prev-continent").addEventListener("click", () => step(-1));
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
  if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
  else if (e.key === "ArrowDown") { e.preventDefault(); stepPlanet(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); stepPlanet(-1); }
  else if (/^[1-9]$/.test(e.key) && planets[+e.key - 1]) go(planets[+e.key - 1].id, 0);
});

window.addEventListener("resize", layout);

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
