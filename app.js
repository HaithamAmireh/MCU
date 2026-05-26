/* ═══════════════════════════════════════════════════════════
   MCU ATLAS — app.js
   Pure static. All images and metadata come from data.js
   (populated by download_images.py). Zero API calls at runtime.
═══════════════════════════════════════════════════════════ */

/* ── STATE ──────────────────────────────────────────────── */
let DATA = null;
let watchedSet = new Set();
let gSim = null;

let state = {
  view: "grid",
  phase: "all",
  type: "all",
  search: "",
  activeTitle: null,
  activePath: null,
  connChars: [],
  connSearch: "",
  graphMin: 2,
};

const PHASE_ORDER = ["1", "2", "3", "4", "5", "6", "D", "S"];
const WATCH_KEY = "mcu_watched_v1";
const ga = () => document.getElementById("grid-area");

/* ═══════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════ */
function boot() {
  if (typeof MCU_DATA === "undefined") {
    showError("data.js not found — all files must be in the same folder.");
    return;
  }
  DATA = MCU_DATA;
  loadWatched();
  updateStats();
  renderAll();
  attachGlobalEvents();
}

/* ═══════════════════════════════════════════════════════════
   IMAGE HELPERS  (local paths only — no API calls)
═══════════════════════════════════════════════════════════ */
function posterSrc(t) {
  return t?.poster_local || null;
}
function backdropSrc(t) {
  return t?.backdrop_local || t?.poster_local || null;
}
function charImgSrc(c) {
  return c?.img_local || null;
}

function applyPostersToDOM() {
  document.querySelectorAll(".tcard[data-tid]").forEach((card) => {
    const t = titleById(card.dataset.tid);
    const src = posterSrc(t);
    const el = card.querySelector(".tcard-poster");
    if (src && el && !el.dataset.imgSet) {
      el.dataset.imgSet = "1";
      const img = new Image();
      img.onload = () => {
        el.style.backgroundImage = `url(${img.src})`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center top";
        const icon = el.querySelector(".tcard-icon");
        if (icon) icon.classList.add("icon-faded");
      };
      img.src = src;
    }
  });
}

function applyChipsToDOM() {
  document.querySelectorAll("[data-cid]").forEach((el) => {
    const c = charById(el.dataset.cid);
    const src = charImgSrc(c);
    const av = el.classList.contains("cavatar")
      ? el
      : el.querySelector(".cavatar,.conn-avatar");
    if (src && av && !av.dataset.imgSet) {
      av.dataset.imgSet = "1";
      const img = new Image();
      img.onload = () => {
        av.style.backgroundImage = `url(${img.src})`;
        av.style.backgroundSize = "cover";
        av.style.backgroundPosition = "center top";
        av.textContent = "";
      };
      img.src = src;
    }
  });
}

/* ═══════════════════════════════════════════════════════════
   METADATA  (read from data.js — set by download_images.py)
═══════════════════════════════════════════════════════════ */
function getMeta(tid) {
  const t = titleById(tid);
  return {
    rating: t?.rating ?? null,
    runtime: t?.runtime ?? null,
    director: t?.director ?? null,
  };
}

function formatRuntime(m) {
  if (!m) return null;
  const h = Math.floor(m / 60), min = m % 60;
  return h ? `${h}h ${min}m` : `${min}m`;
}

/* ═══════════════════════════════════════════════════════════
   WATCHED TRACKER
═══════════════════════════════════════════════════════════ */
function loadWatched() {
  try {
    const s = localStorage.getItem(WATCH_KEY);
    if (s) watchedSet = new Set(JSON.parse(s));
  } catch (e) {
    watchedSet = new Set();
  }
}

function saveWatched() {
  try {
    localStorage.setItem(WATCH_KEY, JSON.stringify([...watchedSet]));
  } catch (e) {}
}

function toggleWatched(tid, e) {
  if (e) {
    e.stopPropagation();
    e.preventDefault();
  }
  if (watchedSet.has(tid)) watchedSet.delete(tid);
  else watchedSet.add(tid);
  saveWatched();
  document.querySelectorAll(`.tcard[data-tid="${tid}"] .watched-btn`).forEach(
    (btn) => {
      btn.classList.toggle("on", watchedSet.has(tid));
    },
  );
  updateProgress();
  document.querySelectorAll(".phase-ring[data-phase]").forEach((ring) =>
    updatePhaseRing(ring, ring.dataset.phase)
  );
  if (state.view === "paths") {
    document.querySelectorAll(".path-title-row[data-tid]").forEach((row) =>
      row.classList.toggle("watched", watchedSet.has(row.dataset.tid))
    );
  }
}

function isWatched(tid) {
  return watchedSet.has(tid);
}

function getPhaseStats(pid) {
  const titles = DATA.titles.filter((t) => t.phase === pid);
  return {
    total: titles.length,
    watched: titles.filter((t) => watchedSet.has(t.id)).length,
  };
}

function updateProgress() {
  const total = DATA.titles.length, watched = watchedSet.size;
  const el = document.getElementById("progress-text");
  const bar = document.getElementById("progress-bar-fill");
  if (el) el.textContent = `${watched}/${total}`;
  if (bar) bar.style.width = `${Math.round(watched / total * 100)}%`;
}

function updatePhaseRing(el, pid) {
  const s = getPhaseStats(pid);
  const pct = s.total ? s.watched / s.total : 0;
  const r = 14, circ = 2 * Math.PI * r;
  const circle = el.querySelector(".ring-fill");
  if (circle) {
    circle.setAttribute(
      "stroke-dasharray",
      `${(pct * circ).toFixed(1)} ${circ.toFixed(1)}`,
    );
  }
  const label = el.querySelector(".ring-label");
  if (label) label.textContent = `${s.watched}/${s.total}`;
}

function resetProgress() {
  const btn = document.getElementById("reset-btn");
  if (!btn) return;
  if (btn.dataset.armed === "1") {
    watchedSet = new Set();
    localStorage.removeItem(WATCH_KEY);
    updateProgress();
    renderAll();
    btn.innerHTML = "&#x21BA; RESET";
    btn.classList.remove("armed");
    btn.dataset.armed = "0";
  } else {
    btn.textContent = "SURE? CLICK AGAIN";
    btn.classList.add("armed");
    btn.dataset.armed = "1";
    setTimeout(() => {
      if (btn.dataset.armed === "1") {
        btn.innerHTML = "&#x21BA; RESET";
        btn.classList.remove("armed");
        btn.dataset.armed = "0";
      }
    }, 3000);
  }
}

/* ═══════════════════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════════════════ */
const charById = (id) => DATA.characters.find((c) => c.id === id);
const titleById = (id) => DATA.titles.find((t) => t.id === id);
const phaseInfo = (id) => DATA.phases.find((p) => p.id === id);
const pathById = (id) => (DATA.paths || []).find((p) => p.id === id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function initials(name) {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(
    />/g,
    "&gt;",
  );
}

function hexToRgba(hex, a = 1) {
  const h = hex.replace("#", "");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${
    parseInt(h.slice(4, 6), 16)
  },${a})`;
}

function titlesForChar(cid) {
  return DATA.titles.filter((t) => (t.chars || []).includes(cid));
}

function filteredTitles() {
  let list = [...DATA.titles];
  if (state.phase !== "all") list = list.filter((t) => t.phase === state.phase);
  if (state.type !== "all") list = list.filter((t) => t.type === state.type);
  if (state.search) {
    const q = state.search.toLowerCase();
    list = list.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      t.synopsis?.toLowerCase().includes(q) ||
      (t.chars || []).some((cid) => {
        const c = charById(cid);
        return c &&
          (c.name.toLowerCase().includes(q) ||
            c.alias.toLowerCase().includes(q) ||
            c.actor?.toLowerCase().includes(q));
      })
    );
  }
  return list;
}

/* ═══════════════════════════════════════════════════════════
   STATS COMPUTATIONS
═══════════════════════════════════════════════════════════ */
function computeStats() {
  const charApps = {};
  DATA.characters.forEach((c) => {
    charApps[c.id] = titlesForChar(c.id).length;
  });
  const topChars = Object.entries(charApps).sort((a, b) => b[1] - a[1]).slice(
    0,
    15,
  );

  const titleCharCounts = DATA.titles
    .map((t) => ({ t, n: (t.chars || []).length }))
    .sort((a, b) => b.n - a.n).slice(0, 10);

  const phaseStats = PHASE_ORDER.map((pid) => {
    const titles = DATA.titles.filter((t) => t.phase === pid);
    const watched = titles.filter((t) => watchedSet.has(t.id)).length;
    return {
      pid,
      name: phaseInfo(pid)?.name ?? pid,
      total: titles.length,
      watched,
    };
  }).filter((p) => p.total > 0);

  let totalMins = 0;
  DATA.titles.forEach((t) => {
    if (t.runtime) totalMins += t.runtime;
  });

  const mostChars = DATA.titles.reduce((a, b) =>
    (b.chars || []).length > (a.chars || []).length ? b : a
  );
  const topEntry = topChars[0];
  const mostAppsChar = charById(topEntry?.[0]);

  return {
    topChars,
    titleCharCounts,
    phaseStats,
    totalMins,
    mostChars,
    mostAppsChar,
    mostAppsCount: topEntry?.[1],
  };
}

function computeGraphData(minShared = 2) {
  const charApps = {};
  DATA.titles.forEach((t) =>
    (t.chars || []).forEach((cid) => {
      charApps[cid] = (charApps[cid] || 0) + 1;
    })
  );
  const valid = new Set(
    Object.entries(charApps).filter(([, n]) => n >= 2).map(([id]) => id),
  );

  const pairCount = {};
  DATA.titles.forEach((t) => {
    const chars = (t.chars || []).filter((c) => valid.has(c));
    for (let i = 0; i < chars.length; i++) {
      for (let j = i + 1; j < chars.length; j++) {
        const key = [chars[i], chars[j]].sort().join("|");
        pairCount[key] = (pairCount[key] || 0) + 1;
      }
    }
  });

  const nodes = [...valid].map((id) => {
    const c = charById(id);
    return {
      id,
      name: c?.name ?? id,
      col: c?.col ?? "#555",
      r: 4 + Math.min(charApps[id] * 1.8, 18),
    };
  });

  const links = Object.entries(pairCount)
    .filter(([, n]) => n >= minShared)
    .map(([key, value]) => {
      const [source, target] = key.split("|");
      return { source, target, value };
    });

  return { nodes, links };
}

/* ═══════════════════════════════════════════════════════════
   HEADER STATS
═══════════════════════════════════════════════════════════ */
function updateStats() {
  document.getElementById("stat-titles").textContent = DATA.titles.length;
  document.getElementById("stat-chars").textContent = DATA.characters.length;
  updateProgress();
}

/* ═══════════════════════════════════════════════════════════
   FILTERS
═══════════════════════════════════════════════════════════ */
function renderFilters() {
  const phDiv = document.getElementById("phase-btns");
  const tyDiv = document.getElementById("type-btns");
  const viewDiv = document.getElementById("view-btns");

  const phases = [
    { id: "all", label: "ALL" },
    ...PHASE_ORDER.map((pid) => {
      const p = phaseInfo(pid);
      return p ? { id: pid, label: isNaN(pid) ? pid : `PH${pid}` } : null;
    }).filter(Boolean),
  ];

  phDiv.innerHTML = phases.map((p) =>
    `<button class="fbtn${
      state.phase === p.id ? " on" : ""
    }" data-phase="${p.id}">${p.label}</button>`
  ).join("");
  phDiv.querySelectorAll(".fbtn").forEach((b) =>
    b.addEventListener("click", () => {
      state.phase = b.dataset.phase;
      if (!["grid", "timeline"].includes(state.view)) {
        state.view = "grid";
        state.activePath = null;
      }
      renderAll();
    })
  );

  tyDiv.innerHTML = [{ id: "all", l: "ALL" }, { id: "movie", l: "MOVIES" }, {
    id: "series",
    l: "SERIES",
  }, { id: "special", l: "SPECIALS" }]
    .map((t) =>
      `<button class="tbtn${
        state.type === t.id ? " on" : ""
      }" data-type="${t.id}">${t.l}</button>`
    ).join("");
  tyDiv.querySelectorAll(".tbtn").forEach((b) =>
    b.addEventListener("click", () => {
      state.type = b.dataset.type;
      if (!["grid", "timeline"].includes(state.view)) {
        state.view = "grid";
        state.activePath = null;
      }
      renderAll();
    })
  );

  viewDiv.innerHTML = [
    { id: "grid", l: "\u229e GRID" },
    { id: "timeline", l: "\u2015 TIMELINE" },
    { id: "connections", l: "\u229b CONNECT" },
    { id: "paths", l: "\u25b6 PATHS" },
    { id: "stats", l: "\u2261 STATS" },
    { id: "graph", l: "\u2299 GRAPH" },
  ].map((v) =>
    `<button class="vbtn${
      state.view === v.id ? " on" : ""
    }" data-view="${v.id}">${v.l}</button>`
  ).join("");
  viewDiv.querySelectorAll(".vbtn").forEach((b) =>
    b.addEventListener("click", () => {
      stopGraph();
      const prev = state.view;
      state.view = b.dataset.view;
      state.activeTitle = null;
      state.activePath = null;
      document.getElementById("panel-outer").classList.remove("open");
      if (prev === "timeline") ga().style.overflowX = "";
      renderAll();
    })
  );
}

/* ═══════════════════════════════════════════════════════════
   RENDER ALL
═══════════════════════════════════════════════════════════ */
function renderAll() {
  renderFilters();
  ({
    grid: renderGrid,
    timeline: renderTimeline,
    connections: renderConnections,
    paths: renderPaths,
    stats: renderStats,
    graph: renderGraph,
  }[state.view] || renderGrid)();
}

/* ═══════════════════════════════════════════════════════════
   GRID VIEW
═══════════════════════════════════════════════════════════ */
function renderGrid() {
  ga().style.overflowX = "";
  stopGraph();
  const inner = document.getElementById("grid-inner");
  const list = filteredTitles();
  if (!list.length) {
    inner.innerHTML = `<div class="no-results">&#9889; NO TITLES MATCH</div>`;
    return;
  }

  const groups = {};
  list.forEach((t) => {
    if (!groups[t.phase]) groups[t.phase] = [];
    groups[t.phase].push(t);
  });

  inner.innerHTML = PHASE_ORDER.filter((pid) => groups[pid]).map((pid) => {
    const info = phaseInfo(pid), titles = groups[pid];
    const ps = getPhaseStats(pid), r = 14, circ = 2 * Math.PI * r;
    const pct = ps.total ? ps.watched / ps.total : 0;
    return `
      <section class="phase-sec">
        <div class="phase-hdr">
          <span class="ph-num${isNaN(pid) ? " text-ph" : ""}">${pid}</span>
          <span class="ph-name">${info?.name.toUpperCase() ?? ""}</span>
          <span class="ph-years">${info?.years ?? ""}</span>
          <div class="phase-ring" data-phase="${pid}">
            <svg width="36" height="36" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="${r}" fill="none" stroke="#1a1a1a" stroke-width="3"/>
              <circle class="ring-fill" cx="18" cy="18" r="${r}" fill="none" stroke="var(--red)"
                      stroke-width="3" stroke-linecap="round"
                      stroke-dasharray="${(pct * circ).toFixed(1)} ${
      circ.toFixed(1)
    }"
                      transform="rotate(-90 18 18)"/>
            </svg>
            <span class="ring-label">${ps.watched}/${ps.total}</span>
          </div>
        </div>
        <div class="ph-sub">${info?.sub.toUpperCase() ?? ""}</div>
        <div class="titles-grid">${
      titles.map((t, i) => cardHTML(t, i)).join("")
    }</div>
      </section>`;
  }).join("");

  inner.querySelectorAll(".tcard").forEach((c) =>
    c.addEventListener("click", () => openPanel(c.dataset.tid))
  );
  inner.querySelectorAll(".watched-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => toggleWatched(btn.dataset.tid, e))
  );
  applyPostersToDOM();
  setupKeyboardNav();
}

function cardHTML(t, idx = 0) {
  const active = state.activeTitle === t.id,
    watched = isWatched(t.id),
    src = posterSrc(t);
  const pStyle = src
    ? `background-image:url(${src});background-size:cover;background-position:center top;`
    : "";
  const m = getMeta(t.id);
  return `
    <article class="tcard${active ? " on" : ""}${
    watched ? " watched-card" : ""
  }" data-tid="${t.id}"
             style="animation-delay:${
    Math.min(idx * 30, 500)
  }ms" title="${t.title}" tabindex="0">
      <div class="tcard-poster" style="${pStyle}">
        <div class="tcard-poster-bg" style="background:linear-gradient(135deg,${
    hexToRgba(t.col, .55)
  },${hexToRgba(t.col, .08)})"></div>
        <span class="tcard-icon${src ? " icon-faded" : ""}">${t.icon}</span>
        <span class="tcard-type-badge badge-${t.type}">${t.type.toUpperCase()}</span>
        <button class="watched-btn${
    watched ? " on" : ""
  }" data-tid="${t.id}" title="${
    watched ? "Unwatch" : "Mark watched"
  }">&#10003;</button>
        ${m.rating ? `<span class="card-rating">${m.rating}&#9733;</span>` : ""}
      </div>
      <div class="tcard-body">
        <div class="tcard-title">${t.title}</div>
        <div class="tcard-meta">
          <span class="tcard-year">${t.year}</span>
          <span class="tcard-chars">${(t.chars || []).length} CHARS</span>
          ${
    m.runtime
      ? `<span class="tcard-runtime">${formatRuntime(m.runtime)}</span>`
      : ""
  }
        </div>
      </div>
    </article>`;
}

/* ═══════════════════════════════════════════════════════════
   TIMELINE VIEW
═══════════════════════════════════════════════════════════ */
function renderTimeline() {
  ga().style.overflowX = "auto";
  stopGraph();
  const inner = document.getElementById("grid-inner");
  let titles = [...DATA.titles].sort((a, b) =>
    (a.timeline_order ?? 999) - (b.timeline_order ?? 999)
  );
  if (state.type !== "all") {
    titles = titles.filter((t) => t.type === state.type);
  }
  if (state.search) {
    const q = state.search.toLowerCase();
    titles = titles.filter((t) =>
      t.title.toLowerCase().includes(q) || (t.chars || []).some((cid) => {
        const c = charById(cid);
        return c && c.name.toLowerCase().includes(q);
      })
    );
  }

  const byYear = {};
  titles.forEach((t) => {
    const y = t.timeline_year ?? "TVA";
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(t);
  });
  const numYears = Object.keys(byYear).filter((y) => y !== "TVA").sort((a, b) =>
    Number(a) - Number(b)
  );

  inner.innerHTML = `<div id="timeline-scroll"><div id="timeline-track">
    ${
    [...numYears, ...(byYear["TVA"] ? ["TVA"] : [])].map((year) => {
      const special = year === "TVA";
      return `<div class="tl-col${special ? " tl-col-special" : ""}">
        <div class="tl-year-label">${
        special ? "TVA &amp;<br>Multiverse" : year
      }</div>
        <div class="tl-tick"></div>
        <div class="tl-cards">${
        byYear[year].map((t) => {
          const src = posterSrc(t), watched = isWatched(t.id);
          const pStyle = src
            ? `background-image:url(${src});background-size:cover;background-position:center top;`
            : "";
          return `<article class="tcard${
            state.activeTitle === t.id ? " on" : ""
          }${
            watched ? " watched-card" : ""
          }" data-tid="${t.id}" title="${t.title}">
            <div class="tcard-poster" style="${pStyle}">
              <div class="tcard-poster-bg" style="background:linear-gradient(135deg,${
            hexToRgba(t.col, .55)
          },${hexToRgba(t.col, .08)})"></div>
              <span class="tcard-icon${
            src ? " icon-faded" : ""
          }">${t.icon}</span>
              <span class="tcard-type-badge badge-${t.type}">${t.type.toUpperCase()}</span>
              <button class="watched-btn${
            watched ? " on" : ""
          }" data-tid="${t.id}">&#10003;</button>
            </div>
            <div class="tcard-body">
              <div class="tcard-title">${t.title}</div>
              <div class="tcard-meta"><span class="tcard-year">${t.year}</span><span style="font-family:'Courier Prime',monospace;font-size:9px;color:var(--red)">P${t.phase}</span></div>
            </div>
          </article>`;
        }).join("")
      }</div>
      </div>`;
    }).join("")
  }
  </div></div>`;

  inner.querySelectorAll(".tcard").forEach((c) =>
    c.addEventListener("click", () => openPanel(c.dataset.tid))
  );
  inner.querySelectorAll(".watched-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => toggleWatched(btn.dataset.tid, e))
  );
  applyPostersToDOM();
  setupDragScroll(document.getElementById("timeline-scroll"));
}

function setupDragScroll(el) {
  if (!el) return;
  let down = false, startX = 0, sl = 0;
  el.addEventListener("mousedown", (e) => {
    down = true;
    startX = e.pageX - el.offsetLeft;
    sl = el.scrollLeft;
  });
  document.addEventListener("mouseup", () => {
    down = false;
  });
  el.addEventListener("mousemove", (e) => {
    if (!down) return;
    e.preventDefault();
    el.scrollLeft = sl - (e.pageX - el.offsetLeft - startX) * 1.4;
  });
}

/* ═══════════════════════════════════════════════════════════
   CONNECTIONS VIEW
═══════════════════════════════════════════════════════════ */
function renderConnections() {
  ga().style.overflowX = "";
  stopGraph();
  const inner = document.getElementById("grid-inner");
  const [cid1, cid2] = state.connChars;
  const c1 = cid1 ? charById(cid1) : null, c2 = cid2 ? charById(cid2) : null;
  const shared = (c1 && c2)
    ? DATA.titles.filter((t) =>
      (t.chars || []).includes(cid1) && (t.chars || []).includes(cid2)
    )
    : [];
  const solo = (!c2 && c1) ? c1 : (!c1 && c2) ? c2 : null;
  const soloTitles = solo ? titlesForChar(solo.id) : [];

  let topHTML = "";
  if (c1 && c2) {
    topHTML = `<div class="conn-results"><div class="conn-results-hdr">
      ${
      shared.length
        ? `<span class="conn-count">${shared.length} SHARED TITLE${
          shared.length !== 1 ? "S" : ""
        }</span>
          <span class="conn-char1-label">${c1.name.split(" ")[0]}</span>
          <span class="conn-char2-label">${c2.name.split(" ")[0]}</span>`
        : `<span class="conn-no-results">&#9889; ${
          c1.name.split(" ")[0].toUpperCase()
        } &amp; ${
          c2.name.split(" ")[0].toUpperCase()
        } NEVER SHARE THE SCREEN</span>`
    }
    </div><div class="titles-grid">${
      shared.map((t, i) => cardHTML(t, i)).join("")
    }</div></div>`;
  } else if (solo) {
    topHTML = `<div class="conn-results"><div class="conn-results-hdr">
      <span class="conn-single-label">${solo.name} &mdash; ${soloTitles.length} appearance${
      soloTitles.length !== 1 ? "s" : ""
    }</span>
      <span class="conn-hint">&#x2193; pick a second character below</span>
    </div><div class="titles-grid">${
      soloTitles.map((t, i) => cardHTML(t, i)).join("")
    }</div></div>`;
  }

  const q = (state.connSearch || "").toLowerCase();
  let chars = [...DATA.characters].sort((a, b) => a.name.localeCompare(b.name));
  if (q) {
    chars = chars.filter((c) =>
      c.name.toLowerCase().includes(q) || c.alias.toLowerCase().includes(q) ||
      c.actor?.toLowerCase().includes(q)
    );
  }
  const pickerLabel = !c1
    ? "PICK CHARACTER 1"
    : !c2
    ? "PICK CHARACTER 2"
    : "SWAP A CHARACTER";

  inner.innerHTML = `<div id="connections-view">
    <div class="conn-header">
      ${connSlotHTML(c1, 1)}
      <div class="conn-vs${c1 && c2 ? " active" : ""}"><span>${
    c1 && c2 ? "&#x2229;" : "VS"
  }</span>${c1 && c2 ? '<div class="conn-vs-sub">CROSSOVER</div>' : ""}</div>
      ${connSlotHTML(c2, 2)}
    </div>
    <div class="conn-body">
      ${topHTML}
      <div class="conn-picker">
        <div class="conn-picker-hdr">
          <span class="conn-picker-label">${pickerLabel}</span>
          <div class="conn-search-wrap"><input id="conn-search" type="text" placeholder="Search\u2026" value="${
    escHtml(state.connSearch || "")
  }"></div>
        </div>
        <div class="chars-grid" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px">
          ${chars.map((c) => connChipHTML(c, cid1, cid2)).join("")}
        </div>
      </div>
    </div>
  </div>`;

  inner.querySelectorAll(".conn-clear").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sl = parseInt(btn.dataset.slot);
      state.connChars = sl === 1
        ? state.connChars.filter((_, i) => i !== 0)
        : state.connChars.filter((_, i) => i !== 1);
      renderConnections();
    })
  );
  inner.querySelectorAll(".cchip[data-cid]").forEach((chip) =>
    chip.addEventListener("click", () => {
      const cid = chip.dataset.cid;
      if (state.connChars.includes(cid)) {
        state.connChars = state.connChars.filter((id) => id !== cid);
      } else if (state.connChars.length < 2) {
        state.connChars = [...state.connChars, cid];
      } else state.connChars = [state.connChars[0], cid];
      renderConnections();
    })
  );
  inner.querySelectorAll(".tcard[data-tid]").forEach((c) =>
    c.addEventListener("click", () => openPanel(c.dataset.tid))
  );
  inner.querySelectorAll(".watched-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => toggleWatched(btn.dataset.tid, e))
  );
  const cs = document.getElementById("conn-search");
  if (cs) {
    cs.addEventListener("input", (e) => {
      state.connSearch = e.target.value;
      renderConnections();
    });
  }
  applyPostersToDOM();
  applyChipsToDOM();
}

function connSlotHTML(c, n) {
  if (!c) {
    return `<div class="conn-slot conn-slot-empty"><div class="conn-slot-plus">+</div><div class="conn-slot-label">SELECT CHARACTER ${n}</div></div>`;
  }
  const src = charImgSrc(c),
    avStyle = src
      ? `background-image:url(${src});background-size:cover;background-position:center top;`
      : `background:linear-gradient(135deg,${c.col},${hexToRgba(c.col, .4)})`;
  return `<div class="conn-slot conn-slot-filled" data-cid="${c.id}">
    <div class="conn-avatar" style="${avStyle}">${
    src ? "" : initials(c.name)
  }</div>
    <div class="conn-char-name">${c.name}</div><div class="conn-char-alias">${c.alias}</div>
    <button class="conn-clear" data-slot="${n}">&#x2715;</button>
  </div>`;
}

function connChipHTML(c, sel1, sel2) {
  const selected = c.id === sel1 || c.id === sel2,
    slotNum = c.id === sel1 ? 1 : c.id === sel2 ? 2 : null;
  const src = charImgSrc(c),
    avStyle = src
      ? `background-image:url(${src});background-size:cover;background-position:center top;`
      : `background:linear-gradient(135deg,${c.col},${hexToRgba(c.col, .4)})`;
  return `<div class="cchip${
    selected ? " selected" : ""
  }" data-cid="${c.id}" title="${c.name}">
    <div class="cavatar" style="${avStyle}">${src ? "" : initials(c.name)}</div>
    <div class="cname">${c.name.split(" ")[0]}</div>
    <div class="calias">${c.alias.split("/")[0].trim()}</div>
    ${selected ? `<div class="conn-chip-badge">${slotNum}</div>` : ""}
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   PATHS VIEW
═══════════════════════════════════════════════════════════ */
function renderPaths() {
  ga().style.overflowX = "";
  stopGraph();
  const inner = document.getElementById("grid-inner");
  if (state.activePath) {
    renderPathDetail(state.activePath, inner);
    return;
  }

  inner.innerHTML = `
    <div class="paths-header">
      <h2 class="paths-title">CURATED WATCH PATHS</h2>
      <p class="paths-sub">15 hand-crafted journeys through the MCU. Pick a character arc, a saga, or a complete story.</p>
    </div>
    <div class="paths-grid">
      ${
    (DATA.paths || []).map((p, i) => {
      const titles = (p.titles || []).map((id) => titleById(id)).filter(
        Boolean,
      );
      const watchedCount = titles.filter((t) => watchedSet.has(t.id)).length;
      const pct = titles.length
        ? Math.round(watchedCount / titles.length * 100)
        : 0;
      return `<div class="path-card" data-pid="${p.id}" style="animation-delay:${
        Math.min(i * 40, 600)
      }ms" tabindex="0">
          <div class="path-card-accent" style="background:${p.col}"></div>
          <div class="path-card-icon">${p.icon}</div>
          <div class="path-card-body">
            <div class="path-card-name">${p.name}</div>
            <div class="path-card-desc">${p.description}</div>
            <div class="path-card-footer">
              <span class="path-card-count">${titles.length} titles</span>
              <div class="path-card-progress">
                <div class="path-prog-bar"><div class="path-prog-fill" style="width:${pct}%;background:${p.col}"></div></div>
                <span class="path-prog-text">${watchedCount}/${titles.length}</span>
              </div>
            </div>
          </div>
        </div>`;
    }).join("")
  }
    </div>`;

  inner.querySelectorAll(".path-card").forEach((card) =>
    card.addEventListener("click", () => {
      state.activePath = card.dataset.pid;
      renderPaths();
    })
  );
}

function renderPathDetail(pathId, inner) {
  const p = pathById(pathId);
  if (!p) {
    state.activePath = null;
    renderPaths();
    return;
  }
  const titles = (p.titles || []).map((id) => titleById(id)).filter(Boolean);
  const watchedCount = titles.filter((t) => watchedSet.has(t.id)).length;

  inner.innerHTML = `<div class="path-detail">
    <div class="path-detail-header" style="border-left:5px solid ${p.col}">
      <button class="path-back-btn" id="path-back">&#x2190; ALL PATHS</button>
      <div class="path-detail-icon">${p.icon}</div>
      <div class="path-detail-info">
        <div class="path-detail-name">${p.name}</div>
        <div class="path-detail-desc">${p.description}</div>
        <div class="path-detail-meta"><span>${titles.length} titles</span><span>${watchedCount}/${titles.length} watched</span></div>
      </div>
    </div>
    <div class="path-titles-list">
      ${
    titles.map((t, i) => {
      const watched = isWatched(t.id),
        src = posterSrc(t, "w185"),
        m = getMeta(t.id);
      const thumbStyle = src
        ? `background-image:url(${src});background-size:cover;background-position:center top;`
        : `background:${t.col};`;
      return `<div class="path-title-row${
        watched ? " watched" : ""
      }" data-tid="${t.id}">
          <div class="path-num" style="color:${p.col}">${i + 1}</div>
          <div class="path-thumb" style="${thumbStyle}">${
        src ? "" : t.icon
      }</div>
          <div class="path-title-info">
            <div class="path-title-name">${t.title}</div>
            <div class="path-title-meta">${t.year} &middot; ${t.type.toUpperCase()} &middot; Phase ${t.phase}${
        m.runtime ? ` &middot; ${formatRuntime(m.runtime)}` : ""
      }${m.rating ? ` &middot; ${m.rating}&#9733;` : ""}${
        m.director ? ` &middot; ${m.director}` : ""
      }</div>
          </div>
          <button class="path-watch-btn${
        watched ? " on" : ""
      }" data-tid="${t.id}">${
        watched ? "&#10003; WATCHED" : "&#9632; MARK WATCHED"
      }</button>
          <button class="path-open-btn" data-tid="${t.id}">&#x25B6;</button>
        </div>`;
    }).join("")
  }
    </div>
  </div>`;

  document.getElementById("path-back").addEventListener("click", () => {
    state.activePath = null;
    renderPaths();
  });
  inner.querySelectorAll(".path-watch-btn").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      toggleWatched(btn.dataset.tid, e);
      const row = btn.closest(".path-title-row");
      if (row) {
        row.classList.toggle("watched", isWatched(btn.dataset.tid));
        btn.classList.toggle("on", isWatched(btn.dataset.tid));
        btn.innerHTML = isWatched(btn.dataset.tid)
          ? "&#10003; WATCHED"
          : "&#9632; MARK WATCHED";
      }
    })
  );
  inner.querySelectorAll(".path-open-btn").forEach((btn) =>
    btn.addEventListener("click", () => openPanel(btn.dataset.tid))
  );
  inner.querySelectorAll(".path-title-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (!e.target.closest("button")) openPanel(row.dataset.tid);
    });
  });
  applyPostersToDOM();
}

/* ═══════════════════════════════════════════════════════════
   STATS VIEW
═══════════════════════════════════════════════════════════ */
function renderStats() {
  ga().style.overflowX = "";
  stopGraph();
  const inner = document.getElementById("grid-inner");
  const s = computeStats();
  const topMax = s.topChars[0]?.[1] || 1,
    topTitleMax = s.titleCharCounts[0]?.n || 1;
  const totalH = Math.floor(s.totalMins / 60), totalM = s.totalMins % 60;

  inner.innerHTML = `<div class="stats-view">
    <div class="stats-title">MCU BY THE NUMBERS</div>
    <div class="stats-overview">
      <div class="stat-card"><div class="stat-big">${DATA.titles.length}</div><div class="stat-label">TOTAL TITLES</div></div>
      <div class="stat-card"><div class="stat-big">${DATA.characters.length}</div><div class="stat-label">CHARACTERS</div></div>
      <div class="stat-card"><div class="stat-big">${watchedSet.size}</div><div class="stat-label">YOU'VE WATCHED</div></div>
      <div class="stat-card"><div class="stat-big">${
    s.totalMins ? `${totalH}h` : "-"
  }</div><div class="stat-label">TOTAL RUNTIME${
    s.totalMins ? `<br><small>${totalH}h ${totalM}m</small>` : ""
  }</div></div>
      <div class="stat-card"><div class="stat-big">${
    (DATA.paths || []).length
  }</div><div class="stat-label">WATCH PATHS</div></div>
      <div class="stat-card"><div class="stat-big">${
    Math.round(watchedSet.size / DATA.titles.length * 100)
  }%</div><div class="stat-label">COMPLETE</div></div>
    </div>
    <div class="stats-records">
      <div class="stats-record"><span class="rec-label">MOST APPEARANCES</span><span class="rec-value">${
    s.mostAppsChar?.name ?? "—"
  } &mdash; ${s.mostAppsCount ?? 0} titles</span></div>
      <div class="stats-record"><span class="rec-label">MOST CHARACTERS</span><span class="rec-value">${
    s.mostChars?.title ?? "—"
  } &mdash; ${(s.mostChars?.chars || []).length} cast</span></div>
      <div class="stats-record"><span class="rec-label">FIRST IN-UNIVERSE</span><span class="rec-value">Captain America: The First Avenger &mdash; 1943</span></div>
      <div class="stats-record"><span class="rec-label">TOTAL SAGAS</span><span class="rec-value">6 MCU Phases + Defenders Saga + Marvel Television</span></div>
    </div>
    <div class="stats-sections">
      <div class="stats-section">
        <div class="stats-section-title">TOP CHARACTERS BY APPEARANCES</div>
        ${
    s.topChars.map(([cid, n]) => {
      const c = charById(cid);
      return `<div class="stat-bar-row">
          <span class="sbar-label">${c?.name ?? cid}</span>
          <div class="sbar-track"><div class="sbar-fill" style="width:${
        Math.round(n / topMax * 100)
      }%;background:${c?.col ?? "var(--red)"}"></div></div>
          <span class="sbar-val">${n}</span></div>`;
    }).join("")
  }
      </div>
      <div class="stats-section">
        <div class="stats-section-title">MOST CHARACTERS ON SCREEN</div>
        ${
    s.titleCharCounts.map(({ t, n }) =>
      `<div class="stat-bar-row">
          <span class="sbar-label">${t.title}</span>
          <div class="sbar-track"><div class="sbar-fill" style="width:${
        Math.round(n / topTitleMax * 100)
      }%;background:${t.col}"></div></div>
          <span class="sbar-val">${n}</span></div>`
    ).join("")
  }
      </div>
      <div class="stats-section stats-section-full">
        <div class="stats-section-title">WATCHED BY PHASE</div>
        <div class="phase-progress-grid">
          ${
    s.phaseStats.map(({ pid, name, total, watched }) => {
      const pct = total ? Math.round(watched / total * 100) : 0;
      return `<div class="phase-stat-block">
            <div class="psb-header"><span class="psb-phase">${
        isNaN(pid) ? pid : `P${pid}`
      }</span><span class="psb-name">${name}</span><span class="psb-count">${watched}/${total}</span></div>
            <div class="psb-bar"><div class="psb-fill" style="width:${pct}%;background:var(--red)"></div></div>
          </div>`;
    }).join("")
  }
        </div>
      </div>
    </div>
  </div>`;
}

/* ═══════════════════════════════════════════════════════════
   GRAPH VIEW  (D3 — loaded from CDN, needs internet once)
═══════════════════════════════════════════════════════════ */
function renderGraph() {
  ga().style.overflowX = "";
  const inner = document.getElementById("grid-inner");
  inner.innerHTML = `<div id="graph-container">
    <div id="graph-controls">
      <input id="graph-search" type="text" placeholder="Highlight character\u2026" autocomplete="off">
      <label class="graph-label">Min shared titles:
        <input type="range" id="graph-min" min="1" max="8" value="${state.graphMin}">
        <span id="graph-min-val">${state.graphMin}</span>
      </label>
      <span id="graph-info" class="graph-info"></span>
    </div>
    <svg id="graph-svg"></svg>
    <div id="graph-tooltip"></div>
  </div>`;

  if (typeof d3 !== "undefined") drawGraph();
  else {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
    script.onload = () => drawGraph();
    script.onerror = () => {
      inner.innerHTML =
        `<div class="no-results" style="color:#555">D3.js failed to load &mdash; the graph view needs an internet connection for the D3 library.</div>`;
    };
    document.head.appendChild(script);
  }
  document.getElementById("graph-min")?.addEventListener("input", (e) => {
    state.graphMin = parseInt(e.target.value);
    document.getElementById("graph-min-val").textContent = state.graphMin;
    drawGraph();
  });
  document.getElementById("graph-search")?.addEventListener(
    "input",
    (e) => highlightGraphNode(e.target.value.toLowerCase().trim()),
  );
}

function drawGraph() {
  const container = document.getElementById("graph-container"),
    svg = document.getElementById("graph-svg");
  if (!container || !svg) return;
  stopGraph();
  const { nodes, links } = computeGraphData(state.graphMin);
  const info = document.getElementById("graph-info");
  if (info) {
    info.textContent =
      `${nodes.length} characters \u00b7 ${links.length} connections`;
  }
  const W = container.clientWidth || 900, H = window.innerHeight - 220;
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  const S = d3.select("#graph-svg");
  S.selectAll("*").remove();
  const g = S.append("g");
  S.call(
    d3.zoom().scaleExtent([0.2, 4]).on("zoom", (e) =>
      g.attr("transform", e.transform)),
  );
  const sim = d3.forceSimulation(nodes)
    .force(
      "link",
      d3.forceLink(links).id((d) => d.id).distance(70).strength(0.4),
    )
    .force("charge", d3.forceManyBody().strength(-220))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("collide", d3.forceCollide().radius((d) => d.r + 4));
  gSim = sim;
  const link = g.append("g").selectAll("line").data(links).join("line").attr(
    "stroke",
    "#2a2a2a",
  ).attr("stroke-width", (d) => Math.min(Math.sqrt(d.value) * 1.5, 6)).attr(
    "stroke-opacity",
    0.7,
  );
  const node = g.append("g").selectAll("g").data(nodes).join("g").attr(
    "cursor",
    "pointer",
  )
    .call(
      d3.drag()
        .on("start", (e, d) => {
          if (!e.active) sim.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on("drag", (e, d) => {
          d.fx = e.x;
          d.fy = e.y;
        })
        .on("end", (e, d) => {
          if (!e.active) sim.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        }),
    );
  node.append("circle").attr("r", (d) => d.r).attr("fill", (d) => d.col).attr(
    "stroke",
    "#000",
  ).attr("stroke-width", 1.5).attr("fill-opacity", 0.85);
  node.append("text").text((d) => d.name.split(" ")[0]).attr(
    "x",
    (d) => d.r + 3,
  ).attr("y", 4).attr("fill", "#ccc").attr("font-size", "9px").attr(
    "font-family",
    "Oswald,sans-serif",
  ).attr("pointer-events", "none");
  const tooltip = document.getElementById("graph-tooltip");
  node.on("mouseover", (e, d) => {
    d3.select(e.currentTarget).select("circle").attr("stroke", "#FFD700").attr(
      "stroke-width",
      2.5,
    );
    const connected = new Set(
      links.filter((l) => l.source.id === d.id || l.target.id === d.id).flatMap(
        (l) => [l.source.id, l.target.id]
      ),
    );
    link.attr(
      "stroke",
      (l) =>
        (l.source.id === d.id || l.target.id === d.id) ? "#FFD700" : "#1a1a1a",
    ).attr(
      "stroke-opacity",
      (l) => (l.source.id === d.id || l.target.id === d.id) ? 1 : 0.15,
    );
    node.attr(
      "opacity",
      (nd) => connected.has(nd.id) || nd.id === d.id ? 1 : 0.2,
    );
    if (tooltip) {
      tooltip.style.display = "block";
      tooltip.style.left = `${e.pageX + 12}px`;
      tooltip.style.top = `${e.pageY - 8}px`;
      tooltip.innerHTML = `<strong>${d.name}</strong><br>${
        titlesForChar(d.id).length
      } titles \u00b7 ${
        links.filter((l) => l.source.id === d.id || l.target.id === d.id).length
      } connections`;
    }
  })
    .on("mouseout", (e) => {
      d3.select(e.currentTarget).select("circle").attr("stroke", "#000").attr(
        "stroke-width",
        1.5,
      );
      link.attr("stroke", "#2a2a2a").attr("stroke-opacity", 0.7);
      node.attr("opacity", 1);
      if (tooltip) tooltip.style.display = "none";
    })
    .on("click", (e, d) => {
      e.stopPropagation();
      openCharModal(d.id);
    });
  sim.on("tick", () => {
    link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr(
      "x2",
      (d) => d.target.x,
    ).attr("y2", (d) => d.target.y);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });
}

function highlightGraphNode(q) {
  if (!document.getElementById("graph-svg")) return;
  if (!q) {
    d3.selectAll("#graph-svg g g").attr("opacity", 1);
    return;
  }
  d3.selectAll("#graph-svg g g").attr(
    "opacity",
    (d) => d.name?.toLowerCase().includes(q) ? 1 : 0.15,
  );
}

function stopGraph() {
  if (gSim) {
    gSim.stop();
    gSim = null;
  }
}

/* ═══════════════════════════════════════════════════════════
   SIDE PANEL
═══════════════════════════════════════════════════════════ */
function openPanel(tid) {
  if (state.activeTitle === tid) {
    closePanel();
    return;
  }
  state.activeTitle = tid;
  if (state.view === "grid") renderGrid();
  renderPanel(tid);
  document.getElementById("panel-outer").classList.add("open");
}

function closePanel() {
  state.activeTitle = null;
  document.getElementById("panel-outer").classList.remove("open");
  if (state.view === "grid") renderGrid();
}

function renderPanel(tid) {
  const t = titleById(tid);
  if (!t) return;
  const phInfo = phaseInfo(t.phase),
    chars = (t.chars || []).map((cid) => charById(cid)).filter(Boolean);
  const m = getMeta(t.id), backdrop = backdropSrc(t);
  const inYear = t.timeline_year ? `~${t.timeline_year}` : "TVA / Multiverse";
  const heroStyle = backdrop
    ? `background-image:url(${backdrop});background-size:cover;background-position:center center;`
    : `background:${t.col};`;

  document.getElementById("panel-content").innerHTML = `
    <div class="panel-hero" style="${heroStyle}">
      <div class="panel-hero-overlay" style="background:linear-gradient(to bottom,transparent 20%,rgba(0,0,0,.92) 100%)"></div>
      <button class="panel-close" id="panel-close-btn">&#x2715;</button>
      <div class="panel-hero-body">
        <div class="panel-ptype"><span class="pulse-dot"></span>${t.type.toUpperCase()} &middot; ${
    phInfo?.name.toUpperCase() ?? t.phase
  }</div>
        <div class="panel-ptitle">${t.title}</div>
        <div class="panel-pmeta">
          <span>${t.year}</span>
          ${m.runtime ? `<span>${formatRuntime(m.runtime)}</span>` : ""}
          ${m.rating ? `<span>${m.rating}&#9733;</span>` : ""}
          ${m.director ? `<span>Dir. ${m.director}</span>` : ""}
          <span>Set ${inYear}</span>
        </div>
        <button class="panel-watch-btn${
    isWatched(tid) ? " on" : ""
  }" id="panel-watch-btn" data-tid="${tid}">
          ${isWatched(tid) ? "&#10003; WATCHED" : "+ MARK WATCHED"}
        </button>
      </div>
    </div>
    <div class="panel-synopsis">${t.synopsis || "No synopsis available."}</div>
    <div class="psec">
      <div class="psec-title">Character Hub</div>
      <div class="chars-grid">
        ${
    chars.map((c) => {
      const src = charImgSrc(c);
      const avStyle = src
        ? `background-image:url(${src});background-size:cover;background-position:center top;`
        : `background:linear-gradient(135deg,${c.col},${hexToRgba(c.col, .4)})`;
      return `<div class="cchip" data-cid="${c.id}" title="${c.name}">
            <div class="cavatar" style="${avStyle}">${
        src ? "" : initials(c.name)
      }</div>
            <div class="cname">${c.name.split(" ")[0]}</div>
            <div class="calias">${c.alias.split("/")[0].trim()}</div>
          </div>`;
    }).join("") ||
    "<p style=\"font-family:'Courier Prime',monospace;font-size:11px;color:#444\">No characters logged.</p>"
  }
      </div>
    </div>`;

  document.getElementById("panel-close-btn").addEventListener(
    "click",
    closePanel,
  );
  document.getElementById("panel-watch-btn").addEventListener("click", (e) => {
    toggleWatched(tid, e);
    const btn = document.getElementById("panel-watch-btn");
    if (btn) {
      btn.classList.toggle("on", isWatched(tid));
      btn.innerHTML = isWatched(tid) ? "&#10003; WATCHED" : "+ MARK WATCHED";
    }
  });
  document.getElementById("panel-content").querySelectorAll(".cchip").forEach(
    (chip) =>
      chip.addEventListener("click", () => openCharModal(chip.dataset.cid))
  );
  applyChipsToDOM();
}

/* ═══════════════════════════════════════════════════════════
   CHARACTER MODAL
═══════════════════════════════════════════════════════════ */
function openCharModal(cid) {
  const c = charById(cid);
  if (!c) return;
  const apps = titlesForChar(cid),
    phases = new Set(apps.map((t) => t.phase)).size;
  const src = charImgSrc(c);
  const avStyle = src
    ? `background-image:url(${src});background-size:cover;background-position:center top;`
    : `background:linear-gradient(135deg,${c.col},${hexToRgba(c.col, .4)})`;

  document.getElementById("cmodal-box").innerHTML = `
    <div class="cmodal-hdr">
      <div class="cmodal-avatar" style="${avStyle}">${
    src ? "" : initials(c.name)
  }</div>
      <div class="cmodal-info">
        <div class="cmodal-name">${c.name}</div>
        <div class="cmodal-alias">${c.alias}</div>
        <div class="cmodal-actor">Portrayed by ${c.actor || "Unknown"}</div>
      </div>
      <button class="cmodal-close" id="cmodal-close-btn">&#x2715;</button>
    </div>
    <div class="cmodal-body">
      <div class="cmodal-section-title">MCU Appearances</div>
      <div class="cmodal-app-count">${apps.length} title${
    apps.length !== 1 ? "s" : ""
  } across ${phases} saga${phases !== 1 ? "s" : ""}</div>
      ${
    apps.map((t) => {
      const thumb = posterSrc(t), m = getMeta(t.id);
      return `<div class="app-row" data-tid="${t.id}">
          <div class="app-thumb${thumb ? "" : " app-thumb-fallback"}" style="${
        thumb
          ? `background-image:url(${thumb});background-size:cover;background-position:center top;`
          : ""
      }">${thumb ? "" : t.icon}</div>
          <div class="app-info">
            <div class="app-title">${t.title}</div>
            <div class="app-meta">${t.year} &middot; ${t.type.toUpperCase()} &middot; ${
        phaseInfo(t.phase)?.name ?? t.phase
      }${m.rating ? ` &middot; ${m.rating}&#9733;` : ""}</div>
          </div>
          <div class="app-phase">${
        isNaN(t.phase) ? t.phase : "Phase " + t.phase
      }</div>
        </div>`;
    }).join("") ||
    "<p style=\"font-family:'Courier Prime',monospace;font-size:11px;color:#444;padding:8px 0\">No appearances logged.</p>"
  }
    </div>`;

  document.getElementById("cmodal-close-btn").addEventListener(
    "click",
    closeCharModal,
  );
  document.getElementById("cmodal-box").querySelectorAll(".app-row").forEach(
    (row) =>
      row.addEventListener("click", () => {
        closeCharModal();
        setTimeout(() => openPanel(row.dataset.tid), 280);
      })
  );
  document.getElementById("cmodal").classList.add("open");
}

function closeCharModal() {
  document.getElementById("cmodal").classList.remove("open");
}

/* ═══════════════════════════════════════════════════════════
   SEARCH + KEYBOARD NAV
═══════════════════════════════════════════════════════════ */
let searchTimer = null;
function setupSearch() {
  const inp = document.getElementById("search-input"),
    clr = document.getElementById("search-clear");
  inp.addEventListener("input", () => {
    clearTimeout(searchTimer);
    const val = inp.value.trim();
    clr.classList.toggle("visible", val.length > 0);
    searchTimer = setTimeout(() => {
      state.search = val;
      if (val) {
        state.phase = "all";
        state.type = "all";
      }
      renderAll();
    }, 220);
  });
  clr.addEventListener("click", () => {
    inp.value = "";
    state.search = "";
    clr.classList.remove("visible");
    renderAll();
    inp.focus();
  });
}

function setupKeyboardNav() {
  const cards = [...document.querySelectorAll(".tcard[data-tid]")];
  cards.forEach((card, i) => {
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPanel(card.dataset.tid);
      }
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        cards[i + 1]?.focus();
      }
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        cards[i - 1]?.focus();
      }
    });
  });
}

/* ═══════════════════════════════════════════════════════════
   GLOBAL EVENTS
═══════════════════════════════════════════════════════════ */
function attachGlobalEvents() {
  setupSearch();
  document.getElementById("reset-btn")?.addEventListener(
    "click",
    resetProgress,
  );
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.getElementById("cmodal").classList.contains("open")) {
        closeCharModal();
      } else if (state.activeTitle) closePanel();
      else if (state.activePath) {
        state.activePath = null;
        renderPaths();
      }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "k") {
      e.preventDefault();
      document.getElementById("search-input").focus();
    }
  });
  document.getElementById("cmodal").addEventListener("click", (e) => {
    if (e.target === document.getElementById("cmodal")) closeCharModal();
  });
  const gridArea = ga(), sb = document.getElementById("scroll-top");
  gridArea.addEventListener(
    "scroll",
    () => sb.classList.toggle("vis", gridArea.scrollTop > 300),
  );
  sb.addEventListener(
    "click",
    () => gridArea.scrollTo({ top: 0, behavior: "smooth" }),
  );
}

/* ═══════════════════════════════════════════════════════════
   ERROR + INIT
═══════════════════════════════════════════════════════════ */
function showError(msg) {
  document.getElementById("error-msg").textContent = msg;
  document.getElementById("error-toast").classList.remove("hidden");
  document.getElementById("grid-inner").innerHTML = `
    <div class="no-results" style="color:#555;font-size:14px;max-width:460px;margin:0 auto;line-height:1.9">
      <div style="font-size:48px;margin-bottom:16px">&#x26A0;&#xFE0F;</div>
      <div style="font-family:'Bangers',cursive;font-size:28px;color:var(--red);margin-bottom:12px">DATA NOT FOUND</div>
      <div style="font-family:'Courier Prime',monospace;font-size:12px;color:#555">
        Make sure <code style="color:var(--gold)">data.js</code> and <code style="color:var(--gold)">styles.css</code>
        are in the same folder as <code style="color:var(--gold)">index.html</code>.
      </div>
    </div>`;
}

document.addEventListener("DOMContentLoaded", boot);
