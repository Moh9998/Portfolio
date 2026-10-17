// Content behaviours shared by the classic page and the solar system view.
(function () {
  "use strict";

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Age that stays correct every year
  document.querySelectorAll("[data-age-from]").forEach((el) => {
    const born = new Date(el.dataset.ageFrom + "T00:00:00");
    const now = new Date();
    let age = now.getFullYear() - born.getFullYear();
    const m = now.getMonth() - born.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < born.getDate())) age--;
    el.textContent = String(age);
  });

  // ---------- Planet briefs and continent clocks ----------
  // Each planet keeps its own day length; continents sit in evenly spread time zones.
  const BIOMES = {
    city: { name: "City", temp: 3, humidity: 41, wind: 12, sky: "Neon haze" },
    desert: { name: "Desert", temp: 19, humidity: 8, wind: 34, sky: "Dust on the wind" },
    arctic: { name: "Frozen arctic", temp: -36, humidity: 72, wind: 48, sky: "Snowfall" },
    rainforest: { name: "Rainforest", temp: 7, humidity: 94, wind: 6, sky: "Warm rain" },
    wilds: { name: "Wilds", temp: 0, humidity: 55, wind: 18, sky: "Clear skies" },
  };
  const ICONS = {
    city: '<path d="M2 15V7h4v8M6 15V3h5v12M11 15V8h3v7M1 15h14" />',
    desert: '<path d="M1 13c3-3 5-3 8 0s4 2 6 0M3 9c2-2 4-2 6 0" /><circle cx="12" cy="4" r="2" />',
    arctic: '<path d="M8 1v14M2 4.5l12 7M14 4.5l-12 7M6 2l2 2 2-2M6 14l2-2 2 2" />',
    rainforest: '<path d="M8 15V8M8 8C4 8 3 5 5 3c1-1 2-1 3 0 1-1 2-1 3 0 2 2 1 5-3 5zM8 11l-3-2M8 10l3-2" />',
    wilds: '<path d="M1 14l5-8 3 4 2-3 4 7zM5 4l1-2 1 2" />',
  };
  const icon = (b) => '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[b] || ICONS.wilds) + "</svg>";
  const EPOCH = Date.UTC(2020, 0, 1);

  function siteTime(planet, index) {
    const day = parseFloat(planet.dataset.day) || 24;
    const count = planet.querySelectorAll(".continent").length || 1;
    const seed = [...planet.id].reduce((a, c) => a + c.charCodeAt(0), 0) % 97;
    const h = (((Date.now() - EPOCH) / 3600000 + seed + (index / count) * day) % day + day) % day;
    const frac = h / day;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60), ss = Math.floor(((h - hh) * 60 - mm) * 60);
    const pad = (n) => String(n).padStart(2, "0");
    return { text: pad(hh) + ":" + pad(mm), seconds: pad(ss), day: frac > 0.22 && frac < 0.78 };
  }

  function conditions(planet, biome) {
    const b = BIOMES[biome] || BIOMES.wilds;
    return { ...b, temp: Math.round((parseFloat(planet.dataset.temp) || 0) + b.temp) };
  }

  const stat = (label, value) => "<div><dt>" + label + "</dt><dd>" + value + "</dd></div>";

  document.querySelectorAll(".planet").forEach((planet) => {
    const d = planet.dataset;
    const brief = document.createElement("div");
    brief.className = "planet-brief";
    const sites = [...planet.querySelectorAll(".continent")].map((c, i) => {
      const b = c.dataset.biome || "wilds";
      return '<li><a href="#' + c.id + '" data-continent="' + c.id + '" data-biome="' + b + '">' +
        '<span class="site-icon">' + icon(b) + "</span>" +
        '<span class="site-name">' + c.dataset.name + "</span>" +
        '<span class="site-biome">' + BIOMES[b].name + "</span>" +
        '<span class="site-time" data-clock="' + i + '"></span></a></li>';
    }).join("");
    brief.innerHTML =
      '<p class="greeting">' + d.greeting + " <span>Welcome to " + d.name + ".</span></p>" +
      '<dl class="planet-stats">' +
        stat("Surface", d.temp + " °C") +
        stat("Pressure", d.pressure + " atm") +
        stat("Gravity", d.gravity + " g") +
        stat("From star", d.distance + " AU") +
        stat("Day", d.day + " h") +
      "</dl>" +
      '<p class="sites-title">Landing sites <span>local time</span></p>' +
      '<ol class="sites">' + sites + "</ol>";
    planet.querySelector(".planet-head").after(brief);

    // Field readout at the top of every continent: landscape, local time, weather
    planet.querySelectorAll(".continent").forEach((c, i) => {
      const b = c.dataset.biome || "wilds";
      const w = conditions(planet, b);
      const head = document.createElement("div");
      head.className = "site-head";
      head.innerHTML =
        '<span class="site-badge">' + icon(b) + w.name + "</span>" +
        '<span class="site-read"><b data-clock="' + i + '"></b> local</span>' +
        '<span class="site-read">' + w.temp + " °C</span>" +
        '<span class="site-read">' + w.humidity + "% humidity</span>" +
        '<span class="site-read">' + w.wind + " km/h wind</span>" +
        '<span class="site-read">' + w.sky + "</span>";
      c.prepend(head);
    });
  });

  function tickClocks() {
    document.querySelectorAll(".planet").forEach((planet) => {
      planet.querySelectorAll("[data-clock]").forEach((el) => {
        const t = siteTime(planet, +el.dataset.clock);
        el.textContent = t.text;
        el.classList.toggle("night", !t.day);
        el.title = t.day ? "Daytime" : "Night";
      });
    });
  }
  tickClocks();
  setInterval(tickClocks, 5000);

  window.Portfolio = { siteTime, conditions, BIOMES };

  // Typewriter for the roles line
  const typed = document.querySelector(".typed");
  if (typed && !reduceMotion) {
    const roles = typed.dataset.roles.split("|");
    let i = 0, len = roles[0].length, deleting = true;
    const tick = () => {
      if (deleting) {
        len--;
        if (len <= 0) { deleting = false; i = (i + 1) % roles.length; }
      } else {
        len++;
        if (len >= roles[i].length) { deleting = true; typed.textContent = roles[i]; return setTimeout(tick, 1800); }
      }
      typed.textContent = roles[i].slice(0, Math.max(len, 0)) || "\u00a0";
      setTimeout(tick, deleting ? 45 : 85);
      return undefined;
    };
    setTimeout(tick, 2200);
  }

  // GitHub Pages cannot run PHP, so the form hands the message to the visitor's mail app
  const form = document.getElementById("contact-form");
  if (form) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const d = new FormData(form);
      const body = d.get("message") + "\n\n" + d.get("name") + " <" + d.get("email") + ">";
      window.location.href = "mailto:mohammed.halkfgi@gmail.com?subject=" +
        encodeURIComponent(d.get("subject")) + "&body=" + encodeURIComponent(body);
    });
  }
})();
