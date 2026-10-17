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

  // Continent tabs under each planet heading
  document.querySelectorAll(".planet").forEach((planet) => {
    const nav = document.createElement("nav");
    nav.className = "continent-tabs";
    nav.setAttribute("aria-label", planet.dataset.name + " continents");
    const list = document.createElement("ol");
    planet.querySelectorAll(".continent").forEach((c) => {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = "#" + c.id;
      a.dataset.continent = c.id;
      a.textContent = c.dataset.name;
      li.appendChild(a);
      list.appendChild(li);
    });
    nav.appendChild(list);
    planet.querySelector(".planet-head").appendChild(nav);
  });

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
