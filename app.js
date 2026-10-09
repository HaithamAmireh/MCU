/* ═══════════════════════════════════════════════════════════
   MCU ATLAS — app.js
   Static, no build. Data and image paths come from data.js,
   which scripts/sync.py keeps current with TMDB.
═══════════════════════════════════════════════════════════ */

const WATCH_KEY = "mcu_watched_v1";
const PREFS_KEY = "mcu_prefs_v2";
const THEME_KEY = "mcu_theme";
const LOG_KEY = "mcu_watch_log_v1";
const SYNC_KEY = "mcu_sync_code";
const PHASE_ORDER = ["1", "2", "3", "4", "5", "6", "D", "S"];
const NEW_DAYS = 45;

const VIEWS = [
  { id: "library", label: "Library" },
  { id: "story", label: "Story order" },
  { id: "crossovers", label: "Crossovers" },
  { id: "paths", label: "Watch paths" },
  { id: "stats", label: "Stats" },
  { id: "network", label: "Network" },
];
const TYPES = [
  { id: "all", label: "Everything" },
  { id: "movie", label: "Movies" },
  { id: "series", label: "Series" },
  { id: "special", label: "Specials" },
];

let D = null;
let watched = new Set();
let byTitle = new Map();
let byChar = new Map();
let releaseRank = new Map();
let releaseList = [];
let storyList = [];
let sim = null;
let lastOpener = null;
let toastTimer = null;
let lastUpNext = null;
let watchLog = {}; // id -> [watched 0|1, changed-at ms]; lets two devices merge per title
let installPrompt = null;
let lastHash = null;
let closingCharFromRoute = false;

const state = {
  view: "library",
  phase: "all",
  type: "all",
  hideWatched: false,
  order: "release",
  search: "",
  activeTitle: null,
  activePath: null,
  cross: [],
  crossQuery: "",
  netMin: 2,
  activeChar: null,
  prep: null,
  region: null,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/* ═══════════════════════════════════════════════════════════
   STORAGE
═══════════════════════════════════════════════════════════ */
function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch (e) {
    return fallback;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}
function savePrefs() {
  const { view, phase, type, hideWatched, order, region } = state;
  write(PREFS_KEY, { view, phase, type, hideWatched, order, region });
}
function persistWatched() {
  write(WATCH_KEY, [...watched]);
  write(LOG_KEY, watchLog);
}
function saveWatched() {
  persistWatched();
  scheduleSync();
}
function markWatched(id, on, ts = Date.now()) {
  on ? watched.add(id) : watched.delete(id);
  watchLog[id] = [on ? 1 : 0, ts];
}
function replaceWatched(ids) {
  const now = Date.now(), next = new Set(ids);
  for (const t of D.titles) if (next.has(t.id) !== watched.has(t.id)) markWatched(t.id, next.has(t.id), now);
}

/* ═══════════════════════════════════════════════════════════
   DATES + FORMATTING
═══════════════════════════════════════════════════════════ */
const TODAY = (() => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
})();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function releaseDate(t) {
  const r = t.release_date;
  if (!r) return null;
  const [y, m, d] = r.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function hasExactDate(t) {
  return /^\d{4}-\d{2}-\d{2}$/.test(t.release_date || "");
}
function isReleased(t) {
  const d = releaseDate(t);
  if (!d) return t.year <= TODAY.getFullYear() - 1;
  return d <= TODAY;
}
function daysUntil(t) {
  const d = releaseDate(t);
  return d ? Math.round((d - TODAY) / 86400000) : null;
}
function isNew(t) {
  const n = daysUntil(t);
  return n !== null && n <= 0 && n > -NEW_DAYS;
}
function fmtDate(t, withYear = true) {
  const d = releaseDate(t);
  if (!d) return String(t.year);
  if (!hasExactDate(t)) return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}${withYear ? `, ${d.getFullYear()}` : ""}`;
}
function fmtCountdown(t) {
  const n = daysUntil(t);
  if (n === null) return "Date to be announced";
  if (!hasExactDate(t)) return `Expected ${fmtDate(t)}`;
  if (n === 0) return "Out today";
  if (n === 1) return "Out tomorrow";
  if (n < 60) return `In ${n} days`;
  const months = Math.round(n / 30.4);
  return `In about ${months} months`;
}
function fmtMinutes(m) {
  if (!m) return "";
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h${r ? ` ${r}m` : ""}` : `${r}m`;
}
function lengthLabel(t) {
  if (t.type === "series") return t.episodes ? `${t.episodes} episodes` : "";
  return fmtMinutes(t.runtime);
}
function totalMinutes(t) {
  if (t.type === "series") return (t.runtime || 0) * (t.episodes || 0);
  return t.runtime || 0;
}
const TYPE_LABEL = { movie: "Movie", series: "Series", special: "Special" };

/* ═══════════════════════════════════════════════════════════
   DATA HELPERS
═══════════════════════════════════════════════════════════ */
const title = (id) => byTitle.get(id);
const char = (id) => byChar.get(id);
const phase = (id) => D.phases.find((p) => p.id === id);
const path = (id) => (D.paths || []).find((p) => p.id === id);
const appearances = (cid) => releaseList.filter((t) => (t.chars || []).includes(cid));
const isWatched = (id) => watched.has(id);

function index() {
  byTitle = new Map(D.titles.map((t) => [t.id, t]));
  byChar = new Map(D.characters.map((c) => [c.id, c]));
  releaseList = [...D.titles].sort((a, b) =>
    (a.release_date || `${a.year}`).localeCompare(b.release_date || `${b.year}`) || a.title.localeCompare(b.title)
  );
  releaseList.forEach((t, i) => releaseRank.set(t.id, i + 1));
  const placed = D.titles.filter((t) => t.timeline_order != null).sort((a, b) => a.timeline_order - b.timeline_order);
  const outside = releaseList.filter((t) => t.timeline_order == null);
  storyList = [...placed, ...outside];
  // ids that no longer exist (e.g. Blade) shouldn't count toward progress
  watched = new Set([...watched].filter((id) => byTitle.has(id)));
}

function matchesSearch(t, q) {
  if (!q) return true;
  if (t.title.toLowerCase().includes(q) || (t.synopsis || "").toLowerCase().includes(q)) return true;
  if ((t.director || "").toLowerCase().includes(q)) return true;
  return (t.chars || []).some((cid) => {
    const c = char(cid);
    return c && [c.name, c.alias, c.actor].some((s) => (s || "").toLowerCase().includes(q));
  });
}

function filtered(list) {
  const q = state.search.toLowerCase();
  return list.filter((t) =>
    (q || state.phase === "all" || t.phase === state.phase) &&
    (q || state.type === "all" || t.type === state.type) &&
    (!state.hideWatched || !isWatched(t.id)) &&
    matchesSearch(t, q)
  );
}

function upNext(order) {
  const list = order === "story" ? storyList : releaseList;
  const i = list.findIndex((t) => isReleased(t) && !isWatched(t.id));
  return i === -1 ? null : { t: list[i], pos: i + 1, of: list.length };
}

/* ═══════════════════════════════════════════════════════════
   SHARED FRAGMENTS
═══════════════════════════════════════════════════════════ */
function coverHTML(t) {
  return t.poster_local
    ? `<img src="${esc(t.poster_local)}" alt="" loading="lazy" decoding="async">`
    : `<div class="cover-fallback halftone display">${esc(t.title)}</div>`;
}

function avatarHTML(c) {
  if (c.img_local) return `<img src="${esc(c.img_local)}" alt="" loading="lazy" decoding="async">`;
  const initials = c.name.split(" ").slice(0, 2).map((w) => w[0]).join("");
  return `<span class="avatar-fallback halftone" aria-hidden="true">${esc(initials)}</span>`;
}

function cardHTML(t) {
  const w = isWatched(t.id), released = isReleased(t);
  const cls = ["card", w && "is-watched", !released && "is-upcoming", state.activeTitle === t.id && "is-active"]
    .filter(Boolean).join(" ");
  const when = !released
    ? `<span class="hot">${esc(fmtDate(t, false))}${hasExactDate(t) ? `, ${releaseDate(t).getFullYear()}` : ""}</span>`
    : `<span>${t.year}</span>`;
  return `<article class="${cls}" data-tid="${t.id}">
    <button class="card-open" type="button" data-open="${t.id}">
      <div class="cover">${coverHTML(t)}<span class="stamp" aria-hidden="true">Watched</span></div>
      <div class="card-text">
        <span class="card-title">${esc(t.title)}</span>
        <span class="meta"><span class="num">#${releaseRank.get(t.id)}</span>${when}<span>${TYPE_LABEL[t.type] || ""}</span>${
    isNew(t) ? `<span class="hot">New</span>` : ""
  }</span>
      </div>
    </button>
    ${
    released
      ? `<button class="card-check" type="button" data-check="${t.id}" aria-pressed="${w}" aria-label="${
        w ? "Unmark" : "Mark"
      } ${esc(t.title)} as watched">&#10003;</button>`
      : ""
  }
  </article>`;
}

function checkBtnHTML(t) {
  if (!isReleased(t)) return `<span class="meta hot">${esc(fmtCountdown(t))}</span>`;
  const w = isWatched(t.id);
  return `<button class="check-btn" type="button" data-check="${t.id}" aria-pressed="${w}" aria-label="${
    w ? "Unmark" : "Mark"
  } ${esc(t.title)} as watched">&#10003;<span class="label">${w ? "Watched" : "Watch"}</span></button>`;
}

function rowHTML(t, num, note = "") {
  const w = isWatched(t.id);
  const bits = [
    phase(t.phase)?.name,
    isReleased(t) ? String(t.year) : fmtDate(t),
    lengthLabel(t),
  ].filter(Boolean);
  return `<div class="row${w ? " is-watched" : ""}${num ? " has-num" : ""}" data-tid="${t.id}">
    ${num ? `<span class="row-num" aria-hidden="true">${num}</span>` : ""}
    <button class="row-open" type="button" data-open="${t.id}">
      ${t.poster_local ? `<img class="row-thumb" src="${esc(t.poster_local)}" alt="" loading="lazy">` : `<span class="row-thumb halftone"></span>`}
      <span><span class="row-title">${esc(t.title)}</span><span class="meta">${bits.map((b) => `<span>${esc(b)}</span>`).join("")}</span>${
    note ? `<span class="row-note">${esc(note)}</span>` : ""
  }</span>
    </button>
    ${checkBtnHTML(t)}
  </div>`;
}

function emptyHTML(head, body) {
  return `<div class="empty"><h2 class="display">${esc(head)}</h2><p>${esc(body)}</p></div>`;
}

/* ═══════════════════════════════════════════════════════════
   CHROME: tabs, toolbar, progress
═══════════════════════════════════════════════════════════ */
function renderTabs() {
  const tabs = $("#tabs");
  if (!tabs.children.length) {
    tabs.innerHTML = VIEWS.map((v) => `<button class="tab" role="tab" type="button" data-view="${v.id}">${v.label}</button>`).join("") +
      `<span class="tab-ink" aria-hidden="true"></span>`;
  }
  let active = null;
  $$(".tab", tabs).forEach((b) => {
    const on = b.dataset.view === state.view;
    b.setAttribute("aria-selected", String(on));
    if (on) active = b;
  });
  const ink = $(".tab-ink", tabs);
  if (active) {
    ink.style.transform = `translateX(${active.offsetLeft + 10}px)`;
    ink.style.width = `${active.offsetWidth - 20}px`;
    const left = active.offsetLeft - tabs.scrollLeft, right = left + active.offsetWidth;
    if (left < 0 || right > tabs.clientWidth) tabs.scrollTo({ left: active.offsetLeft - 16, behavior: "smooth" });
  }
}

function renderToolbar() {
  const bar = $("#toolbar");
  const show = ["library", "story"].includes(state.view);
  bar.hidden = !show;
  if (!show) return;
  const phases = [{ id: "all", label: "All phases" }, ...PHASE_ORDER.map((id) => ({ id, label: phase(id)?.name }))];
  bar.innerHTML = `
    <div class="chips" role="group" aria-label="Phase">${
    phases.map((p) => `<button class="chip" type="button" data-phase="${p.id}" aria-pressed="${state.phase === p.id}">${esc(p.label)}</button>`).join("")
  }</div>
    <div class="chips" role="group" aria-label="Type">${
    TYPES.map((t) => `<button class="chip" type="button" data-type="${t.id}" aria-pressed="${state.type === t.id}">${t.label}</button>`).join("")
  }</div>
    <label class="toggle"><input type="checkbox" id="hide-watched" ${state.hideWatched ? "checked" : ""}> Hide watched</label>`;
}

function renderProgress() {
  const released = D.titles.filter(isReleased);
  const n = released.filter((t) => isWatched(t.id)).length;
  $("#progress-count").innerHTML = `<b>${n}</b> <span>of ${released.length} watched</span>`;
  $("#progress-fill").style.width = `${released.length ? (n / released.length) * 100 : 0}%`;
}

/* ═══════════════════════════════════════════════════════════
   VIEWS
═══════════════════════════════════════════════════════════ */
function render() {
  renderTabs();
  renderToolbar();
  renderProgress();
  if (state.view !== "network") stopSim();
  ({ library: renderLibrary, story: renderStory, crossovers: renderCrossovers, paths: renderPaths, stats: renderStats, network: renderNetwork }[
    state.view
  ] || renderLibrary)();
  if (state.view !== "library") FX.stopHero();
  FX.reveal(state.view + (state.prep || state.activePath || ""), $("#main"));
}

/* ── library ── */
function renderLibrary() {
  const main = $("#main");
  const list = filtered(releaseList);
  const plain = !state.search && state.phase === "all" && state.type === "all";
  let html = plain ? spotlightHTML() : "";

  if (state.search) {
    html += `<h1 class="section-title display" style="margin-bottom:24px">${list.length} result${list.length === 1 ? "" : "s"} for “${esc(state.search)}”</h1>`;
  }
  if (!list.length) {
    main.innerHTML = html + emptyHTML(
      state.hideWatched ? "All caught up here" : "Nothing matches",
      state.hideWatched ? "Every title in this filter is watched. Turn off Hide watched to see them." : "Try a character, an actor, or a shorter title.",
    );
    return;
  }

  for (const pid of PHASE_ORDER) {
    const items = list.filter((t) => t.phase === pid);
    if (!items.length) continue;
    const info = phase(pid);
    const all = D.titles.filter((t) => t.phase === pid).sort((a, b) => releaseRank.get(a.id) - releaseRank.get(b.id));
    const done = all.filter((t) => isWatched(t.id)).length;
    html += `<section class="phase" aria-labelledby="ph-${pid}">
      <div class="phase-head" data-phase-head="${pid}">
        <div>
          <h2 class="phase-name display" id="ph-${pid}">${esc(info.name)}${
      phaseComplete(pid) ? ` <span class="seal" title="Every released title watched"><span>Complete!</span></span>` : ""
    }</h2>
          <p class="phase-sub">${esc(info.sub)}, ${esc(info.years)}</p>
        </div>
        <div class="phase-progress">
          <p class="phase-count">${done} <span>of ${all.length} watched</span></p>
          <div class="segbar" aria-hidden="true">${
      all.map((t) => `<i class="${isWatched(t.id) ? "on" : isReleased(t) ? "" : "soon"}" title="${esc(t.title)}"></i>`).join("")
    }</div>
        </div>
      </div>
      <div class="grid">${items.map(cardHTML).join("")}</div>
    </section>`;
  }
  main.innerHTML = html;
  FX.tickCountdowns();
  const hero = $(".upnext", main);
  if (hero) {
    if (lastUpNext && hero.dataset.tid !== lastUpNext) hero.classList.add("is-swapping");
    lastUpNext = hero.dataset.tid;
    FX.mountHero(hero);
  } else FX.stopHero();
}

function phaseComplete(pid) {
  const out = D.titles.filter((t) => t.phase === pid && isReleased(t));
  return out.length > 0 && out.every((t) => isWatched(t.id));
}

function spotlightHTML() {
  const next = upNext(state.order);
  const coming = releaseList.filter((t) => !isReleased(t)).slice(0, 5);
  const orderLabel = state.order === "story" ? "story order" : "release order";
  const orderSwitch = `<div class="order-switch"><div class="seg" role="group" aria-label="Up next order">
      <button type="button" data-order="release" aria-pressed="${state.order === "release"}">Release</button>
      <button type="button" data-order="story" aria-pressed="${state.order === "story"}">Story</button>
    </div></div>`;

  let hero;
  if (next) {
    const t = next.t;
    const art = t.backdrop_local || t.poster_local;
    const meta = [String(t.year), TYPE_LABEL[t.type], lengthLabel(t), phase(t.phase)?.name].filter(Boolean);
    hero = `<article class="upnext" aria-labelledby="upnext-title" data-tid="${t.id}">
      <div class="upnext-art">${art ? `<img src="${esc(art)}" alt="">` : ""}</div>
      ${orderSwitch}
      <div class="upnext-body">
        <span class="caption">Up next: #${next.pos} of ${next.of} in ${orderLabel}</span>
        <h2 class="upnext-title display" id="upnext-title">${esc(t.title)}</h2>
        <p class="upnext-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</p>
        <p class="upnext-syn">${esc(t.synopsis)}</p>
        <div class="upnext-actions">
          <button class="btn btn-primary" type="button" data-check="${t.id}" aria-pressed="false">Mark watched</button>
          <button class="btn" type="button" data-open="${t.id}">Details</button>
          ${t.trailer ? `<button class="btn" type="button" data-trailer="${t.id}">&#9654; Trailer</button>` : ""}
        </div>
      </div>
    </article>`;
  } else {
    const soon = coming[0];
    hero = `<article class="upnext" aria-labelledby="upnext-title">
      <div class="upnext-art">${soon?.backdrop_local ? `<img src="${esc(soon.backdrop_local)}" alt="">` : ""}</div>
      <div class="upnext-body">
        <span class="caption">Everything released so far is watched</span>
        <h2 class="upnext-title display" id="upnext-title">You're caught up</h2>
        ${soon ? `<p class="upnext-syn">Next out: ${esc(soon.title)}, ${esc(fmtDate(soon))}.</p>` : ""}
      </div>
    </article>`;
  }

  const comingHTML = coming.length
    ? `<aside class="coming" aria-labelledby="coming-h">
        <div class="coming-head"><h2 class="display" id="coming-h">Coming up</h2>${countdownHTML(coming.find(hasExactDate))}</div>
        <ul class="coming-list">${
      coming.map((t) => {
        const d = releaseDate(t);
        return `<li class="coming-item"><button type="button" data-open="${t.id}">
            <span class="date-block" aria-hidden="true"><span class="m">${d ? MONTHS[d.getMonth()] : "TBA"}</span><span class="d">${
          hasExactDate(t) ? d.getDate() : "TBA"
        }</span></span>
            <span><span class="coming-title">${esc(t.title)}</span><br><span class="coming-when"><strong>${esc(fmtCountdown(t))}</strong>${
          hasExactDate(t) ? `, ${esc(fmtDate(t))}` : ""
        }</span></span>
          </button></li>`;
      }).join("")
    }</ul>
        ${prepTargets()[0] ? `<button class="coming-foot" type="button" data-prep="${prepTargets()[0].id}">Catch-up plan for ${esc(prepTargets()[0].title)} <span aria-hidden="true">&rarr;</span></button>` : ""}
      </aside>`
    : "";

  return `<div class="spotlight">${hero}${comingHTML}</div>`;
}

function countdownHTML(t) {
  if (!t) return "";
  const units = ["days", "hrs", "min", "sec"];
  return `<div class="countdown" data-countdown="${t.release_date}" role="timer" aria-label="Countdown to ${esc(t.title)}">
      <p class="countdown-label">${esc(t.title)} drops in</p>
      <div class="countdown-units">${units.map((u) => `<span class="cd-unit"><b class="display" data-unit>00</b><small>${u}</small></span>`).join("")}</div>
    </div>`;
}

/* ── story order ── */
function renderStory() {
  const main = $("#main");
  const list = filtered(storyList);
  if (!list.length) {
    main.innerHTML = emptyHTML("Nothing matches", "Clear the search or pick another phase.");
    return;
  }
  const groups = [];
  for (const t of list) {
    const key = t.timeline_order == null ? "outside" : t.timeline_label || String(t.timeline_year);
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push((g = { key, items: [] }));
    g.items.push(t);
  }
  main.innerHTML = `
    <h1 class="section-title display">Story order</h1>
    <p class="lede">Every title placed by when it happens in-universe, not when it came out.</p>
    <div class="story" style="margin-top:32px">${
    groups.map((g) => {
      const outside = g.key === "outside";
      const done = g.items.filter((t) => isWatched(t.id)).length;
      return `<section class="story-year">
          <h2 class="story-label display${g.key.length > 6 ? " is-long" : ""}">${outside ? "Elsewhere" : esc(g.key)}<small>${
        outside ? "Multiverse, the TVA and alternate realities. " : ""
      }${done} of ${g.items.length} watched</small></h2>
          <div class="rows">${g.items.map((t) => rowHTML(t)).join("")}</div>
        </section>`;
    }).join("")
  }</div>`;
}

/* ── crossovers ── */
function renderCrossovers() {
  const main = $("#main");
  const [a, b] = state.cross.map(char);
  const slot = (c, n) =>
    c
      ? `<div class="slot">${avatarHTML(c)}<div><p class="slot-name">${esc(c.name)}</p><p class="slot-alias">${esc(c.alias)}</p></div>
          <button class="icon-btn" type="button" data-unpick="${c.id}" aria-label="Remove ${esc(c.name)}">&times;</button></div>`
      : `<div class="slot is-empty">Pick character ${n} below</div>`;

  let result = "";
  if (a && b) {
    const shared = releaseList.filter((t) => t.chars?.includes(a.id) && t.chars?.includes(b.id));
    result = `<section class="cross-result">
      <h2 class="display">${shared.length ? `${shared.length} title${shared.length === 1 ? "" : "s"} together` : "Never on screen together"}</h2>
      ${shared.length ? `<div class="grid">${shared.map(cardHTML).join("")}</div>` : `<p class="lede">${esc(a.name)} and ${esc(b.name)} haven't shared a title yet.</p>`}
    </section>`;
  } else if (a || b) {
    const c = a || b, apps = appearances(c.id);
    result = `<section class="cross-result"><h2 class="display">${esc(c.name)}: ${apps.length} title${apps.length === 1 ? "" : "s"}</h2>
      <div class="grid">${apps.map(cardHTML).join("")}</div></section>`;
  }

  const q = state.crossQuery.toLowerCase();
  const counts = new Map(D.characters.map((c) => [c.id, appearances(c.id).length]));
  const people = D.characters
    .filter((c) => !q || [c.name, c.alias, c.actor].some((s) => (s || "").toLowerCase().includes(q)))
    .sort((x, y) => counts.get(y.id) - counts.get(x.id) || x.name.localeCompare(y.name));

  main.innerHTML = `
    <h1 class="section-title display">Crossovers</h1>
    <p class="lede">Pick two characters to see every title they share.</p>
    <div class="cross-slots">${slot(a, 1)}<span class="vs display" aria-hidden="true">vs</span>${slot(b, 2)}</div>
    ${result}
    <section>
      <div class="picker-head">
        <h2 class="display">Characters</h2>
        <label class="visually-hidden" for="cross-q">Filter characters</label>
        <input id="cross-q" type="search" placeholder="Filter by name or actor" value="${esc(state.crossQuery)}" autocomplete="off">
      </div>
      <div class="people">${
    people.map((c) => `<button class="person" type="button" data-pick="${c.id}" aria-pressed="${state.cross.includes(c.id)}">
          ${avatarHTML(c)}<span class="person-name">${esc(c.name)}</span><span class="person-alias">${esc(c.alias)}</span></button>`).join("") ||
    `<p class="lede">No characters match “${esc(state.crossQuery)}”.</p>`
  }</div>
    </section>`;
}

/* ── paths ── */
function renderPaths() {
  const main = $("#main");
  if (state.prep) return renderPrep(title(state.prep));
  if (state.activePath) return renderPathDetail(path(state.activePath));
  const targets = prepTargets();
  main.innerHTML = `
    ${
    targets.length
      ? `<h1 class="section-title display">Get ready</h1>
    <p class="lede">Catch-up plans for what's coming, built from who's in it.</p>
    <div class="prep-grid">${targets.map(prepCardHTML).join("")}</div>`
      : ""
  }
    <h1 class="section-title display" style="margin-top:${targets.length ? "72px" : "0"}">Watch paths</h1>
    <p class="lede">Shorter routes through the saga: one hero's arc, one corner of the universe, or just the essentials.</p>
    <div class="path-grid">${
    D.paths.map((p) => {
      const ts = p.titles.map(title).filter(Boolean);
      const done = ts.filter((t) => isWatched(t.id)).length;
      return `<button class="path-card" type="button" data-path="${p.id}">
          <span class="path-strip" aria-hidden="true">${ts.slice(0, 6).map((t) => t.poster_local ? `<img src="${esc(t.poster_local)}" alt="" loading="lazy">` : "").join("")}</span>
          <span><span class="path-name display">${esc(p.name)}</span><br><span class="path-desc">${esc(p.description)}</span></span>
          <span class="path-foot"><span>${ts.length} titles, ${done} watched</span><span class="minibar"><i style="width:${ts.length ? (done / ts.length) * 100 : 0}%"></i></span></span>
        </button>`;
    }).join("")
  }</div>`;
}

function renderPathDetail(p) {
  if (!p) {
    state.activePath = null;
    return renderPaths();
  }
  const ts = p.titles.map(title).filter(Boolean);
  const done = ts.filter((t) => isWatched(t.id)).length;
  const mins = ts.reduce((s, t) => s + totalMinutes(t), 0);
  $("#main").innerHTML = `
    <button class="btn back" type="button" data-path-back>&larr; All paths</button>
    <div class="path-detail-head">
      <h1 class="section-title display">${esc(p.name)}</h1>
      <p class="lede">${esc(p.description)}</p>
      <p class="meta" style="font-size:15px"><span class="num">${done} of ${ts.length} watched</span><span>About ${Math.round(mins / 60)} hours in total</span></p>
    </div>
    <div class="rows plain">${ts.map((t, i) => rowHTML(t, i + 1)).join("")}</div>`;
}

/* ── stats ── */
function renderStats() {
  const released = D.titles.filter(isReleased);
  const done = released.filter((t) => isWatched(t.id));
  const minsAll = released.reduce((s, t) => s + totalMinutes(t), 0);
  const minsDone = done.reduce((s, t) => s + totalMinutes(t), 0);
  const pct = released.length ? Math.round((done.length / released.length) * 100) : 0;

  const topChars = D.characters.map((c) => ({ c, n: appearances(c.id).length }))
    .sort((a, b) => b.n - a.n).slice(0, 12);
  const crowded = [...D.titles].sort((a, b) => (b.chars?.length || 0) - (a.chars?.length || 0)).slice(0, 10);
  const maxC = topChars[0]?.n || 1, maxT = crowded[0]?.chars?.length || 1;

  $("#main").innerHTML = `
    <div class="stats-head"><h1 class="section-title display">Stats</h1>
      <button class="btn btn-primary" type="button" id="share-stats-btn">Share my progress</button></div>
    <div class="figures">
      <div class="figure"><b class="display">${pct}%</b><span>of released titles watched</span></div>
      <div class="figure"><b class="display">${Math.round(minsDone / 60)}h</b><span>watched so far</span></div>
      <div class="figure"><b class="display">${Math.round((minsAll - minsDone) / 60)}h</b><span>left to watch</span></div>
      <div class="figure"><b class="display">${released.length}</b><span>titles out now, ${D.titles.length - released.length} coming</span></div>
    </div>
    <div class="stat-cols">
      <section><h2 class="display">Most appearances</h2><div class="bars">${
    topChars.map(({ c, n }) => `<div class="bar-row"><button type="button" data-char="${c.id}">${esc(c.name)}</button>
          <span class="bar" style="width:${(n / maxC) * 100}%"></span><span class="val">${n}</span></div>`).join("")
  }</div></section>
      <section><h2 class="display">Biggest casts</h2><div class="bars">${
    crowded.map((t) => `<div class="bar-row"><button type="button" data-open="${t.id}">${esc(t.title)}</button>
          <span class="bar" style="width:${((t.chars?.length || 0) / maxT) * 100}%"></span><span class="val">${t.chars?.length || 0}</span></div>`).join("")
  }</div></section>
      <section><h2 class="display">By phase</h2><div class="bars">${
    PHASE_ORDER.map((pid) => {
      const ts = D.titles.filter((t) => t.phase === pid && isReleased(t));
      const w = ts.filter((t) => isWatched(t.id)).length;
      return `<div class="bar-row"><button type="button" data-goto-phase="${pid}">${esc(phase(pid).name)}</button>
            <span class="bar red" style="width:${ts.length ? (w / ts.length) * 100 : 0}%"></span><span class="val">${w}/${ts.length}</span></div>`;
    }).join("")
  }</div></section>
    </div>`;
}

/* ── network (D3, loaded on demand) ── */
function renderNetwork() {
  $("#main").innerHTML = `
    <h1 class="section-title display">Network</h1>
    <p class="lede">Characters linked by the titles they share. Drag to rearrange, scroll to zoom, click a name for their filmography.</p>
    <div class="net-tools">
      <label class="visually-hidden" for="net-q">Highlight a character</label>
      <input type="text" id="net-q" placeholder="Highlight a character" autocomplete="off">
      <label>Shared titles <input type="range" id="net-min" min="1" max="8" value="${state.netMin}"> <output id="net-min-val">${state.netMin}+</output></label>
      <span class="net-info" id="net-info"></span>
    </div>
    <div class="net-stage" id="net-stage"><svg id="net-svg" role="img" aria-label="Character network graph"></svg><div class="net-tip" id="net-tip"></div></div>`;
  if (window.d3) return drawNetwork();
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js";
  s.onload = drawNetwork;
  s.onerror = () => {
    $("#net-stage").innerHTML = emptyHTML("Couldn't load the graph", "The network view needs an internet connection the first time.");
  };
  document.head.appendChild(s);
}

function drawNetwork() {
  const stage = $("#net-stage"), svgEl = $("#net-svg");
  if (!stage || !svgEl) return;
  stopSim();
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue("--ink").trim(), rule = css.getPropertyValue("--rule-soft").trim();
  const red = css.getPropertyValue("--red").trim(), panel = css.getPropertyValue("--panel").trim();

  const apps = new Map();
  D.titles.forEach((t) => (t.chars || []).forEach((c) => apps.set(c, (apps.get(c) || 0) + 1)));
  const keep = new Set([...apps].filter(([, n]) => n >= 2).map(([id]) => id));
  const pairs = new Map();
  D.titles.forEach((t) => {
    const cs = (t.chars || []).filter((c) => keep.has(c));
    for (let i = 0; i < cs.length; i++) {
      for (let j = i + 1; j < cs.length; j++) {
        const k = [cs[i], cs[j]].sort().join("|");
        pairs.set(k, (pairs.get(k) || 0) + 1);
      }
    }
  });
  const links = [...pairs].filter(([, n]) => n >= state.netMin).map(([k, value]) => {
    const [source, target] = k.split("|");
    return { source, target, value };
  });
  const linked = new Set(links.flatMap((l) => [l.source, l.target]));
  const nodes = [...keep].filter((id) => linked.has(id)).map((id) => ({
    id, name: char(id)?.name || id, col: char(id)?.col || ink, r: 4 + Math.min(apps.get(id) * 1.4, 18),
  }));
  $("#net-info").textContent = `${nodes.length} characters, ${links.length} links`;

  const W = stage.clientWidth, H = stage.clientHeight;
  const svg = d3.select(svgEl).attr("viewBox", [0, 0, W, H]);
  svg.selectAll("*").remove();
  const g = svg.append("g");
  svg.call(d3.zoom().scaleExtent([0.25, 4]).on("zoom", (e) => g.attr("transform", e.transform)));

  sim = d3.forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d) => d.id).distance(70).strength(0.35))
    .force("charge", d3.forceManyBody().strength(-200))
    .force("center", d3.forceCenter(W / 2, H / 2))
    .force("collide", d3.forceCollide().radius((d) => d.r + 4));

  const link = g.append("g").selectAll("line").data(links).join("line")
    .attr("stroke", rule).attr("stroke-width", (d) => Math.min(Math.sqrt(d.value) * 1.4, 6));
  const node = g.append("g").selectAll("g").data(nodes).join("g").attr("cursor", "pointer")
    .call(d3.drag()
      .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
      .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
  node.append("circle").attr("r", (d) => d.r).attr("fill", (d) => d.col).attr("stroke", ink).attr("stroke-width", 2);
  node.append("text").text((d) => d.name.split(" ")[0]).attr("x", (d) => d.r + 4).attr("y", 4)
    .attr("fill", ink).attr("font-size", 11).attr("font-weight", 600).attr("font-family", "Archivo, sans-serif")
    .attr("paint-order", "stroke").attr("stroke", panel).attr("stroke-width", 3).attr("pointer-events", "none");

  const tip = $("#net-tip");
  node.on("mouseenter", (e, d) => {
    const near = new Set([d.id]);
    links.forEach((l) => { if (l.source.id === d.id) near.add(l.target.id); if (l.target.id === d.id) near.add(l.source.id); });
    node.attr("opacity", (n) => (near.has(n.id) ? 1 : 0.15));
    link.attr("stroke", (l) => (l.source.id === d.id || l.target.id === d.id ? red : rule))
      .attr("stroke-opacity", (l) => (l.source.id === d.id || l.target.id === d.id ? 1 : 0.25));
    const box = stage.getBoundingClientRect();
    tip.style.display = "block";
    tip.style.left = `${e.clientX - box.left + 14}px`;
    tip.style.top = `${e.clientY - box.top + 10}px`;
    tip.innerHTML = `<strong>${esc(d.name)}</strong><br>${appearances(d.id).length} titles, ${near.size - 1} connections`;
  }).on("mouseleave", () => {
    node.attr("opacity", 1);
    link.attr("stroke", rule).attr("stroke-opacity", 1);
    tip.style.display = "none";
  }).on("click", (e, d) => openChar(d.id));

  sim.on("tick", () => {
    link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y).attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
    node.attr("transform", (d) => `translate(${d.x},${d.y})`);
  });

  $("#net-q").oninput = (e) => {
    const q = e.target.value.toLowerCase().trim();
    node.attr("opacity", (d) => (!q || d.name.toLowerCase().includes(q) ? 1 : 0.12));
  };
  $("#net-min").oninput = (e) => {
    state.netMin = Number(e.target.value);
    $("#net-min-val").textContent = `${state.netMin}+`;
    drawNetwork();
  };
}

function stopSim() {
  if (sim) sim.stop();
  sim = null;
}

/* ═══════════════════════════════════════════════════════════
   DRAWER (title detail)
═══════════════════════════════════════════════════════════ */
function openDrawer(id, opener, { replace = false } = {}) {
  if (!title(id)) return;
  const wasOpen = $("#drawer").classList.contains("is-open");
  showDrawer(id, opener);
  syncUrl(wasOpen || replace ? "replace" : "push", true);
}

function closeDrawer() {
  if (!state.activeTitle) return;
  if (history.state?.overlay && !state.activeChar) return history.back();
  hideDrawer();
  syncUrl("replace");
}

function showDrawer(id, opener) {
  const t = title(id);
  if (!t) return;
  if (!$("#drawer").classList.contains("is-open")) lastOpener = opener || document.activeElement;
  state.activeTitle = id;
  renderDrawer();
  $("#drawer").classList.add("is-open");
  $("#scrim").classList.add("is-open");
  document.body.style.overflow = "hidden";
  $("#drawer").scrollTop = 0;
  $("#drawer").focus({ preventScroll: true });
  $$(".card.is-active").forEach((c) => c.classList.remove("is-active"));
  $$(`.card[data-tid="${id}"]`).forEach((c) => c.classList.add("is-active"));
}

function hideDrawer() {
  state.activeTitle = null;
  $("#drawer").classList.remove("is-open");
  $("#scrim").classList.remove("is-open");
  document.body.style.overflow = "";
  $$(".card.is-active").forEach((c) => c.classList.remove("is-active"));
  if (lastOpener && document.contains(lastOpener)) lastOpener.focus({ preventScroll: true });
}

function renderDrawer() {
  const t = title(state.activeTitle);
  if (!t) return;
  const rank = releaseRank.get(t.id);
  const prev = releaseList[rank - 2], next = releaseList[rank];
  const released = isReleased(t), w = isWatched(t.id);
  const people = (t.chars || []).map(char).filter(Boolean);
  const inPaths = D.paths.filter((p) => p.titles.includes(t.id));
  const setIn = t.timeline_label || (t.timeline_year != null ? String(t.timeline_year) : "Outside the main timeline");
  const facts = [
    [released ? "Released" : "Release date", fmtDate(t)],
    [t.type === "series" ? "Episodes" : "Runtime", t.type === "series" ? (t.episodes ? `${t.episodes}${t.runtime ? ` × ~${t.runtime}m` : ""}` : "") : fmtMinutes(t.runtime)],
    ["TMDB rating", t.rating ? `${t.rating} / 10` : ""],
    [t.tmdb_type === "tv" ? "Created by" : "Directed by", t.director],
    ["Set in", setIn],
    ["Release order", `#${rank} of ${releaseList.length}`],
  ].filter(([, v]) => v);

  $("#drawer").innerHTML = `
    <div class="drawer-hero">
      ${t.backdrop_local || t.poster_local ? `<img src="${esc(t.backdrop_local || t.poster_local)}" alt="">` : ""}
      <div class="drawer-nav">
        <button class="icon-btn" type="button" data-open="${prev?.id || ""}" ${prev ? "" : "disabled"} aria-label="Previous in release order${prev ? `: ${esc(prev.title)}` : ""}">&larr;</button>
        <button class="icon-btn" type="button" data-open="${next?.id || ""}" ${next ? "" : "disabled"} aria-label="Next in release order${next ? `: ${esc(next.title)}` : ""}">&rarr;</button>
      </div>
      <button class="icon-btn" type="button" data-close aria-label="Close">&times;</button>
    </div>
    <div class="drawer-body">
      <div>
        <p class="drawer-kicker">${esc(phase(t.phase)?.name)}, ${esc(TYPE_LABEL[t.type])}${isNew(t) ? ", new this month" : ""}</p>
        <h2 class="drawer-title display" id="drawer-title">${esc(t.title)}</h2>
      </div>
      <div class="drawer-actions">${
    released
      ? `<button class="btn btn-primary" type="button" data-check="${t.id}" aria-pressed="${w}">${w ? "&#10003; Watched" : "Mark watched"}</button>`
      : `<span class="caption">${esc(fmtCountdown(t))}</span>`
  }${t.trailer ? `<button class="btn" type="button" data-trailer="${t.id}">&#9654; Trailer</button>` : ""}${
    prepTargets().includes(t) ? `<button class="btn" type="button" data-prep="${t.id}">Catch-up plan</button>` : ""
  }</div>
      ${t.synopsis ? `<p class="narration">${esc(t.synopsis)}</p>` : ""}
      ${released || t.watch ? watchHTML(t) : ""}
      <dl class="facts">${facts.map(([k, v]) => `<div class="fact"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
      ${
    people.length
      ? `<section><h3 class="display">Characters</h3><div class="people">${
        people.map((c) => `<button class="person" type="button" data-char="${c.id}">${avatarHTML(c)}<span class="person-name">${esc(c.name)}</span><span class="person-alias">${esc(c.alias)}</span></button>`).join("")
      }</div></section>`
      : ""
  }
      ${
    inPaths.length
      ? `<section><h3 class="display">In these watch paths</h3><div class="tag-list">${
        inPaths.map((p) => `<button class="chip" type="button" data-path="${p.id}">${esc(p.name)}</button>`).join("")
      }</div></section>`
      : ""
  }
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   CHARACTER DIALOG
═══════════════════════════════════════════════════════════ */
function openChar(cid) {
  if (!char(cid)) return;
  const wasOpen = $("#char-dialog").open;
  showChar(cid);
  syncUrl(wasOpen ? "replace" : "push", true);
}

function showChar(cid) {
  const c = char(cid);
  if (!c) return;
  const apps = appearances(cid);
  const done = apps.filter((t) => isWatched(t.id)).length;
  const dlg = $("#char-dialog");
  state.activeChar = cid;
  dlg.innerHTML = `
    <div class="char-head">
      ${avatarHTML(c)}
      <div><h2 class="char-name display" id="char-name">${esc(c.name)}</h2><p class="char-sub">${esc(c.alias)}<br>Played by ${esc(c.actor || "unknown")}</p></div>
      <button class="icon-btn" type="button" data-close-char aria-label="Close">&times;</button>
    </div>
    <div class="char-body">
      <p class="meta" style="font-size:15px"><span class="num">${apps.length} title${apps.length === 1 ? "" : "s"}</span><span>${done} watched</span></p>
      ${apps.map((t) => rowHTML(t)).join("") || `<p class="lede">No appearances logged yet.</p>`}
    </div>`;
  if (!dlg.open) dlg.showModal();
}

/* ═══════════════════════════════════════════════════════════
   WATCHED
═══════════════════════════════════════════════════════════ */
function setWatched(id, on, { announce = true, from = null } = {}) {
  const t = title(id);
  if (!t || !isReleased(t)) return;
  const wasComplete = phaseComplete(t.phase);
  const origin = from?.getBoundingClientRect();
  markWatched(id, on);
  saveWatched();
  const focusSel = document.activeElement?.matches?.("[data-check]")
    ? `[data-check="${id}"]${document.activeElement.classList.contains("btn") ? ".btn" : ""}`
    : null;
  render();
  if (state.activeTitle) renderDrawer();
  if ($("#char-dialog").open && state.activeChar) showChar(state.activeChar);
  if (focusSel) ($(`#drawer ${focusSel}`) || $(`#main ${focusSel}`) || $(focusSel))?.focus({ preventScroll: true });
  let msg = `${on ? "Marked" : "Unmarked"} ${t.title}`;
  if (on) {
    $$(`.card[data-tid="${id}"]`).forEach((c) => c.classList.add("just-stamped"));
    const big = !wasComplete && phaseComplete(t.phase);
    if (origin) FX.burst(origin.left + origin.width / 2, origin.top + origin.height / 2, { power: big ? 2.6 : 1 });
    if (big) {
      msg = `${phase(t.phase).name} complete!`;
      $(`[data-phase-head="${t.phase}"] .seal`)?.classList.add("just-sealed");
    }
  }
  if (announce) toast(msg, () => setWatched(id, !on, { announce: false }));
}

function toast(msg, undo) {
  const el = $("#toast");
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button type="button">Undo</button>` : ""}`;
  el.hidden = false;
  if (undo) el.querySelector("button").onclick = () => { el.hidden = true; undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4500);
}

/* ═══════════════════════════════════════════════════════════
   MENU: theme, export / import, reset
═══════════════════════════════════════════════════════════ */
function applyTheme(mode) {
  if (mode === "system") {
    delete document.documentElement.dataset.theme;
    try { localStorage.removeItem(THEME_KEY); } catch (e) {}
  } else {
    document.documentElement.dataset.theme = mode;
    write(THEME_KEY, mode);
  }
  $$("#theme-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === mode)));
  if (state.view === "network" && window.d3) drawNetwork();
}

function currentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === "light" || t === "dark" ? t : "system";
}

function setMenu(open) {
  $("#menu-pop").hidden = !open;
  $("#menu-btn").setAttribute("aria-expanded", String(open));
  const reset = $("#reset-btn");
  reset.classList.remove("is-armed");
  reset.textContent = "Reset progress";
}

function exportProgress() {
  const blob = new Blob([JSON.stringify({ app: "mcu-atlas", exported: new Date().toISOString(), watched: [...watched] }, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mcu-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function importProgress(file) {
  file.text().then((txt) => {
    const data = JSON.parse(txt);
    const ids = (Array.isArray(data) ? data : data.watched || []).filter((id) => byTitle.has(id));
    if (!ids.length) throw new Error("no ids");
    replaceWatched(ids);
    saveWatched();
    render();
    toast(`Imported ${ids.length} watched titles`);
  }).catch(() => toast("That file isn't an MCU Atlas progress export"));
}

/* ═══════════════════════════════════════════════════════════
   EVENTS
═══════════════════════════════════════════════════════════ */
function go(view) {
  if (state.activeTitle) hideDrawer();
  state.view = view;
  state.activePath = null;
  state.prep = null;
  savePrefs();
  syncUrl("push");
  render();
  window.scrollTo({ top: 0 });
}

function onClick(e) {
  const el = e.target.closest("button, a, [data-close]");
  if (!el) {
    if (!e.target.closest(".menu")) setMenu(false);
    return;
  }
  const d = el.dataset;

  if (!el.closest(".menu")) setMenu(false);
  if (d.check) return setWatched(d.check, !isWatched(d.check), { from: el });
  if (d.open) {
    if ($("#char-dialog").open) {
      // swap the character entry in history for the title instead of stacking
      closingCharFromRoute = true;
      $("#char-dialog").close();
      state.activeChar = null;
      return openDrawer(d.open, el, { replace: true });
    }
    return openDrawer(d.open, el);
  }
  if (d.trailer) {
    if (state.activeTitle !== d.trailer) openDrawer(d.trailer, el);
    return playTrailer(title(d.trailer));
  }
  if (d.prep) {
    hideDrawer();
    state.view = "paths";
    state.prep = d.prep;
    state.activePath = null;
    syncUrl("push");
    render();
    return window.scrollTo({ top: 0 });
  }
  if ("prepBack" in d) { state.prep = null; syncUrl("push"); return render(); }
  if (d.syncAction) return syncAction(d.syncAction, el);
  if ("close" in d) return closeDrawer();
  if ("closeChar" in d) return $("#char-dialog").close();
  if ("closeDialog" in d) return el.closest("dialog")?.close();
  if (d.char) return openChar(d.char);
  if (d.view) return go(d.view);
  if (d.phase) { state.phase = d.phase; savePrefs(); return render(); }
  if (d.type) { state.type = d.type; savePrefs(); return render(); }
  if (d.order) { state.order = d.order; savePrefs(); return render(); }
  if (d.gotoPhase) { state.phase = d.gotoPhase; state.type = "all"; return go("library"); }
  if (d.path) {
    hideDrawer();
    state.view = "paths";
    state.activePath = d.path;
    state.prep = null;
    syncUrl("push");
    render();
    return window.scrollTo({ top: 0 });
  }
  if ("pathBack" in d) { state.activePath = null; syncUrl("push"); return render(); }
  if (d.pick) {
    const id = d.pick;
    if (state.cross.includes(id)) state.cross = state.cross.filter((x) => x !== id);
    else state.cross = state.cross.length < 2 ? [...state.cross, id] : [state.cross[0], id];
    renderCrossovers();
    $(`[data-pick="${id}"]`)?.focus({ preventScroll: true });
    if (state.cross.length === 2) $(".cross-slots").scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (d.unpick) { state.cross = state.cross.filter((x) => x !== d.unpick); return renderCrossovers(); }
  if (d.themeSet) return applyTheme(d.themeSet);
  if (d.motionSet) {
    FX.setMode(d.motionSet);
    $$("#motion-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.motionSet === FX.mode)));
    return render();
  }

  switch (el.id) {
    case "brand":
      e.preventDefault();
      state.search = "";
      $("#search-input").value = "";
      $("#search").classList.remove("has-value");
      state.phase = "all";
      state.type = "all";
      return go("library");
    case "menu-btn":
      return setMenu($("#menu-pop").hidden);
    case "export-btn":
      return exportProgress();
    case "share-btn":
    case "share-stats-btn":
      setMenu(false);
      return openShare();
    case "install-btn":
      setMenu(false);
      if (installPrompt) installPrompt.prompt();
      return;
    case "sync-btn":
      setMenu(false);
      return openSyncDialog();
    case "import-btn":
      return $("#import-file").click();
    case "reset-btn":
      if (el.classList.contains("is-armed")) {
        replaceWatched([]);
        saveWatched();
        setMenu(false);
        render();
        return toast("Progress reset");
      }
      el.classList.add("is-armed");
      el.textContent = "Click again to erase everything";
      return;
    case "search-clear":
      $("#search-input").value = "";
      $("#search").classList.remove("has-value");
      state.search = "";
      render();
      return $("#search-input").focus();
  }
}

function bind() {
  document.addEventListener("click", onClick);
  $("#scrim").addEventListener("click", closeDrawer);
  $$("dialog").forEach((dlg) =>
    dlg.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) e.currentTarget.close();
    })
  );
  $("#char-dialog").addEventListener("close", () => {
    const fromRoute = closingCharFromRoute;
    closingCharFromRoute = false;
    if (fromRoute || !state.activeChar) return;
    state.activeChar = null;
    if (history.state?.overlay) history.back();
    else syncUrl("replace");
  });
  window.addEventListener("popstate", applyRoute);
  window.addEventListener("hashchange", () => location.hash !== lastHash && applyRoute());
  document.addEventListener("change", (e) => {
    if (e.target.matches("[data-region]")) {
      state.region = e.target.value;
      savePrefs();
      renderDrawer();
      $("#drawer [data-region]")?.focus();
    }
  });
  $("#import-file").addEventListener("change", (e) => {
    if (e.target.files[0]) importProgress(e.target.files[0]);
    e.target.value = "";
    setMenu(false);
  });

  let timer;
  $("#search-input").addEventListener("input", (e) => {
    const v = e.target.value.trim();
    $("#search").classList.toggle("has-value", v.length > 0);
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = v;
      if (!["library", "story"].includes(state.view)) state.view = "library";
      render();
    }, 160);
  });

  document.addEventListener("input", (e) => {
    if (e.target.id === "cross-q") {
      state.crossQuery = e.target.value;
      const pos = e.target.selectionStart;
      renderCrossovers();
      const q = $("#cross-q");
      q.focus();
      q.setSelectionRange(pos, pos);
    }
  });
  document.addEventListener("change", (e) => {
    if (e.target.id === "hide-watched") {
      state.hideWatched = e.target.checked;
      savePrefs();
      render();
      $("#hide-watched")?.focus();
    }
  });

  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
    if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
      e.preventDefault();
      $("#search-input").focus();
      $("#search-input").select();
      return;
    }
    if (e.key === "Escape") {
      if (!$("#menu-pop").hidden) return setMenu(false);
      if ($("#char-dialog").open) return; // native dialog handles it
      if (state.activeTitle) return closeDrawer();
      if (typing && e.target.id === "search-input" && e.target.value) {
        e.target.value = "";
        state.search = "";
        $("#search").classList.remove("has-value");
        return render();
      }
    }
    if (state.activeTitle && (e.key === "ArrowLeft" || e.key === "ArrowRight") && !typing) {
      const rank = releaseRank.get(state.activeTitle);
      const t = releaseList[e.key === "ArrowLeft" ? rank - 2 : rank];
      if (t) openDrawer(t.id);
    }
    // keep Tab inside the open drawer
    if (e.key === "Tab" && state.activeTitle) {
      const f = $$("#drawer button:not([disabled]), #drawer [href]");
      if (!f.length) return;
      if (e.shiftKey && (document.activeElement === f[0] || document.activeElement === $("#drawer"))) {
        e.preventDefault();
        f.at(-1).focus();
      } else if (!e.shiftKey && document.activeElement === f.at(-1)) {
        e.preventDefault();
        f[0].focus();
      }
    }
  });

  let rz;
  window.addEventListener("resize", () => {
    if (state.view !== "network" || !window.d3) return;
    clearTimeout(rz);
    rz = setTimeout(drawNetwork, 250);
  });
}


/* ═══════════════════════════════════════════════════════════
   ROUTING  #/view[/id]?title=..&char=..
   Overlays (drawer, character) push a history entry so the
   back button closes them; everything else is shareable.
═══════════════════════════════════════════════════════════ */
function hashFor() {
  let p = `/${state.view}`;
  if (state.view === "paths" && state.prep) p = `/prep/${state.prep}`;
  else if (state.view === "paths" && state.activePath) p += `/${state.activePath}`;
  const q = new URLSearchParams();
  if (state.activeTitle) q.set("title", state.activeTitle);
  if (state.activeChar) q.set("char", state.activeChar);
  const qs = q.toString();
  return `#${p}${qs ? `?${qs}` : ""}`;
}

function syncUrl(mode = "replace", overlay = false) {
  const h = hashFor();
  if (mode === "push" && location.hash !== h) history.pushState({ overlay }, "", h);
  else if (location.hash !== h) history.replaceState(history.state, "", h);
  lastHash = h;
}

function applyRoute() {
  const raw = location.hash.replace(/^#\/?/, "");
  const [p, qs] = raw.split("?");
  const [a, b] = p.split("/").filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(qs || "");
  lastHash = location.hash;

  if (a === "sync" && b) {
    history.replaceState(null, "", hashFor());
    lastHash = location.hash;
    return openSyncDialog(b);
  }
  if (a === "title" && title(b)) {
    history.replaceState(null, "", `#/library?title=${encodeURIComponent(b)}`);
    return applyRoute();
  }
  state.prep = null;
  state.activePath = null;
  if (a === "prep" && title(b)) {
    state.view = "paths";
    state.prep = b;
  } else if (a === "paths") {
    state.view = "paths";
    state.activePath = path(b) ? b : null;
  } else if (VIEWS.some((v) => v.id === a)) state.view = a;
  savePrefs();
  render();

  const tid = q.get("title"), cid = q.get("char");
  if (tid && title(tid)) showDrawer(tid);
  else if (state.activeTitle) hideDrawer();
  if (cid && char(cid)) showChar(cid);
  else if ($("#char-dialog").open) {
    closingCharFromRoute = true;
    state.activeChar = null;
    $("#char-dialog").close();
  }
}

/* ═══════════════════════════════════════════════════════════
   CATCH-UP PLANS  (for big upcoming releases)
═══════════════════════════════════════════════════════════ */
function prepTargets() {
  return releaseList.filter((t) => !isReleased(t) && (t.chars || []).length >= 3);
}

function prepPlan(target) {
  const want = new Set(target.chars);
  const pool = releaseList.filter((t) => isReleased(t));
  const latest = new Map();
  for (const t of pool) for (const c of t.chars || []) if (want.has(c)) latest.set(c, t.id);
  const lastSeen = new Map();
  for (const [c, id] of latest) lastSeen.set(id, [...(lastSeen.get(id) || []), c]);
  const need = Math.max(2, Math.ceil(want.size * 0.15));
  return pool
    .map((t) => ({ t, shared: (t.chars || []).filter((c) => want.has(c)), last: lastSeen.get(t.id) || [] }))
    .filter((x) => x.shared.length >= need || x.last.length);
}

function names(ids, max = 3) {
  const n = ids.map((id) => char(id)?.name.split(" ")[0]).filter(Boolean);
  return n.length > max ? `${n.slice(0, max).join(", ")} and ${n.length - max} more` : n.join(n.length === 2 ? " and " : ", ");
}

function prepStats(target) {
  const plan = prepPlan(target);
  const left = plan.filter((x) => !isWatched(x.t.id));
  const mins = left.reduce((s, x) => s + totalMinutes(x.t), 0);
  const days = Math.max(1, daysUntil(target) ?? 30);
  return { plan, left, hours: mins / 60, days, perWeek: (mins / 60) / Math.max(1, days / 7) };
}

function paceLabel({ hours, days, perWeek }) {
  if (!hours) return "You're ready";
  if (days <= 7) return `${(hours / days).toFixed(1)}h a day`;
  return `${perWeek < 1 ? perWeek.toFixed(1) : Math.round(perWeek)}h a week`;
}

function prepCardHTML(t) {
  const s = prepStats(t);
  const art = t.backdrop_local || t.poster_local;
  return `<button class="prep-card" type="button" data-prep="${t.id}">
    ${art ? `<img src="${esc(art)}" alt="" loading="lazy">` : ""}
    <span class="prep-card-body">
      <span class="caption">${esc(fmtCountdown(t))}</span>
      <span class="prep-card-title display">Before ${esc(t.title)}</span>
      <span class="prep-card-meta">${s.left.length ? `${s.left.length} of ${s.plan.length} left, about ${Math.ceil(s.hours)}h. ${esc(paceLabel(s))} gets you there.` : `All ${s.plan.length} watched. You're ready.`}</span>
    </span>
  </button>`;
}

function renderPrep(target) {
  if (!target) {
    state.prep = null;
    return renderPaths();
  }
  const s = prepStats(target);
  const done = s.plan.length - s.left.length;
  $("#main").innerHTML = `
    <button class="btn back" type="button" data-prep-back>&larr; All paths</button>
    <div class="path-detail-head">
      <h1 class="section-title display">Before ${esc(target.title)}</h1>
      <p class="lede">Every title that shares a good chunk of its cast, plus the most recent appearance of each character, so nobody shows up as a stranger.</p>
    </div>
    <div class="figures">
      <div class="figure"><b class="display">${s.days}</b><span>days until ${esc(fmtDate(target))}</span></div>
      <div class="figure"><b class="display">${done}/${s.plan.length}</b><span>titles watched</span></div>
      <div class="figure"><b class="display">${Math.ceil(s.hours)}h</b><span>left to watch</span></div>
      <div class="figure"><b class="display">${esc(paceLabel(s).replace(" a ", "/"))}</b><span>${s.hours ? "to be ready in time" : "Everything on the list is watched"}</span></div>
    </div>
    <div class="rows plain">${
    s.plan.map((x, i) => {
      const bits = [];
      if (x.last.length) bits.push(`Last seen here: ${names(x.last, 4)}`);
      else bits.push(`Features ${names(x.shared)}`);
      return rowHTML(x.t, i + 1, bits.join(". "));
    }).join("")
  }
      <div class="row finish has-num"><span class="row-num" aria-hidden="true">&#9733;</span>
        <button class="row-open" type="button" data-open="${target.id}">
          ${target.poster_local ? `<img class="row-thumb" src="${esc(target.poster_local)}" alt="" loading="lazy">` : `<span class="row-thumb halftone"></span>`}
          <span><span class="row-title">${esc(target.title)}</span><span class="meta"><span class="hot">${esc(fmtDate(target))}</span></span></span>
        </button>
        <span class="meta hot">${esc(fmtCountdown(target))}</span>
      </div>
    </div>`;
}

/* ═══════════════════════════════════════════════════════════
   WHERE TO WATCH + TRAILERS
═══════════════════════════════════════════════════════════ */
const regionNames = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { return { of: (c) => c }; }
})();

function regionList() {
  return [...new Set(D.titles.flatMap((t) => Object.keys(t.watch || {})))].sort((a, b) => regionNames.of(a).localeCompare(regionNames.of(b)));
}

function defaultRegion() {
  const rs = regionList();
  for (const l of navigator.languages || [navigator.language || ""]) {
    const r = (l.split("-")[1] || "").toUpperCase();
    if (rs.includes(r)) return r;
  }
  return rs.includes("US") ? "US" : rs[0];
}

function watchHTML(t) {
  const region = state.region;
  const ids = t.watch?.[region] || [];
  const link = `https://www.themoviedb.org/${t.tmdb_type}/${t.tmdb_id}/watch?locale=${region}`;
  return `<section class="watch">
    <div class="watch-head">
      <h3 class="display">Where to watch</h3>
      <label class="region"><span class="visually-hidden">Region</span>
        <select data-region>${regionList().map((r) => `<option value="${r}" ${r === region ? "selected" : ""}>${esc(regionNames.of(r))}</option>`).join("")}</select>
      </label>
    </div>
    ${
    ids.length
      ? `<div class="providers">${
        ids.map((id) => {
          const p = D.providers?.[id];
          if (!p) return "";
          return `<a class="provider" href="${link}" target="_blank" rel="noopener">${
            p.logo_local ? `<img src="${esc(p.logo_local)}" alt="" loading="lazy">` : ""
          }<span>${esc(p.name)}</span></a>`;
        }).join("")
      }</div>`
      : `<p class="lede">Not on a streaming subscription in ${esc(regionNames.of(region))} right now.</p>`
  }
    <a class="watch-more" href="${link}" target="_blank" rel="noopener">Rent, buy and other options on TMDB</a>
  </section>`;
}

function playTrailer(t) {
  const hero = $("#drawer .drawer-hero");
  if (!t?.trailer || !hero) return;
  hero.querySelector("img")?.remove();
  hero.querySelector("iframe")?.remove();
  hero.insertAdjacentHTML("afterbegin",
    `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.trailer)}?autoplay=1&rel=0&modestbranding=1" title="${esc(t.title)} trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`);
  hero.classList.add("is-playing");
  $("#drawer").scrollTop = 0;
}

/* ═══════════════════════════════════════════════════════════
   SHARE CARD  (1080x1350 canvas, same-origin images only)
═══════════════════════════════════════════════════════════ */
function loadImg(src) {
  return new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(null);
    i.src = src;
  });
}

async function makeShareCard() {
  await document.fonts?.ready;
  const W = 1080, H = 1350, TAU = Math.PI * 2;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const x = c.getContext("2d");
  const ink = "#15171c", ink2 = "#474b54", red = "#d42a30", yellow = "#ffd23f", paper = "#f3f4f1";
  const font = (size, weight, stretch) => {
    x.font = `${weight} ${size}px Archivo, "Arial Narrow", sans-serif`;
    if ("fontStretch" in x) x.fontStretch = stretch ? "ultra-condensed" : "normal";
  };
  const box = (bx, by, bw, bh, fill, shadow = 8) => {
    x.fillStyle = ink;
    x.fillRect(bx + shadow, by + shadow, bw, bh);
    x.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
    x.fillStyle = fill;
    x.fillRect(bx, by, bw, bh);
  };

  x.fillStyle = paper;
  x.fillRect(0, 0, W, H);
  // halftone wash from the top-right corner
  x.fillStyle = "rgba(21,23,28,0.13)";
  for (let yy = 0, row = 0; yy < H; yy += 16, row++) {
    for (let xx = row % 2 ? 8 : 0; xx < W; xx += 16) {
      const r = 6 * (1 - Math.hypot(W - xx, yy) / 900);
      if (r > 0.4) { x.beginPath(); x.arc(xx, yy, r, 0, TAU); x.fill(); }
    }
  }

  // masthead
  font(64, 860, true);
  const mw = x.measureText("MCU").width + 36, aw = x.measureText("Atlas").width + 36;
  box(60, 60, mw + aw, 88, "#fff", 6);
  x.fillStyle = red;
  x.fillRect(60, 60, mw, 88);
  x.fillStyle = ink;
  x.fillRect(60 + mw, 60, 4, 88);
  x.fillStyle = "#fff";
  x.fillText("MCU", 78, 128);
  x.fillStyle = ink;
  x.fillText("Atlas", 60 + mw + 18, 128);

  const released = D.titles.filter(isReleased);
  const done = released.filter((t) => isWatched(t.id));
  const pct = released.length ? Math.round((done.length / released.length) * 100) : 0;
  const hours = Math.round(done.reduce((s, t) => s + totalMinutes(t), 0) / 60);

  let big = 300;
  font(big, 900, true);
  while (x.measureText(`${pct}%`).width > 500 && big > 120) font((big -= 10), 900, true);
  x.fillStyle = ink;
  x.fillText(`${pct}%`, 52, 470);
  font(52, 800, false);
  x.fillText("of the MCU watched", 64, 540);
  font(36, 600, false);
  x.fillStyle = ink2;
  x.fillText(`${done.length} of ${released.length} titles, ${hours} hours in`, 64, 592);

  // recently watched posters, dealt like a pile of panels
  const recent = [...done].sort((a, b) => (watchLog[b.id]?.[1] || 0) - (watchLog[a.id]?.[1] || 0) || releaseRank.get(b.id) - releaseRank.get(a.id)).slice(0, 5);
  const imgs = await Promise.all(recent.map((t) => (t.poster_local ? loadImg(t.poster_local) : null)));
  const pw = 170, ph = 255;
  imgs.forEach((img, i) => {
    const px = 600 + i * 78, py = 230 + (i % 2) * 40;
    x.save();
    x.translate(px + pw / 2, py + ph / 2);
    x.rotate(((i - 2) * 4 * Math.PI) / 180);
    x.fillStyle = ink;
    x.fillRect(-pw / 2 + 8, -ph / 2 + 8, pw, ph);
    x.fillRect(-pw / 2 - 5, -ph / 2 - 5, pw + 10, ph + 10);
    if (img) x.drawImage(img, -pw / 2, -ph / 2, pw, ph);
    x.restore();
  });

  // phases
  let y = 700;
  font(64, 860, true);
  x.fillStyle = ink;
  x.fillText("By phase", 64, y);
  x.fillRect(64, y + 18, W - 128, 5);
  y += 80;
  for (const pid of PHASE_ORDER) {
    const ts = D.titles.filter((t) => t.phase === pid && isReleased(t));
    const w = ts.filter((t) => isWatched(t.id)).length;
    font(34, 700, false);
    x.fillStyle = ink;
    x.fillText(phase(pid).name, 64, y);
    const bx = 470, bw = 400;
    x.fillRect(bx - 3, y - 27, bw + 6, 30);
    x.fillStyle = "#fff";
    x.fillRect(bx, y - 24, bw, 24);
    x.fillStyle = red;
    x.fillRect(bx, y - 24, ts.length ? (bw * w) / ts.length : 0, 24);
    font(34, 800, false);
    x.fillStyle = ink;
    x.textAlign = "right";
    x.fillText(`${w}/${ts.length}`, W - 64, y);
    x.textAlign = "left";
    if (ts.length && w === ts.length) {
      // little starburst for a finished phase
      x.save();
      x.translate(430, y - 12);
      x.beginPath();
      for (let k = 0; k < 20; k++) {
        const r = k % 2 ? 9 : 20, a = (k / 20) * TAU;
        x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.closePath();
      x.fillStyle = yellow;
      x.fill();
      x.lineWidth = 3;
      x.strokeStyle = ink;
      x.stroke();
      x.restore();
    }
    y += 56;
  }

  // up next caption
  const next = upNext(state.order);
  const cap = next ? `Up next: ${next.t.title}` : "All caught up";
  font(40, 800, false);
  const cw = Math.min(W - 128, x.measureText(cap).width + 48);
  box(64, H - 150, cw, 72, yellow, 6);
  x.fillStyle = ink;
  x.fillText(cap, 88, H - 100, cw - 48);
  font(26, 600, false);
  x.fillStyle = ink2;
  x.textAlign = "right";
  x.fillText(new Date().toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" }), W - 64, H - 100);
  x.textAlign = "left";
  return c;
}

async function openShare() {
  const dlg = $("#share-dialog");
  dlg.innerHTML = `<div class="sheet-head"><h2 class="display">Share your progress</h2><button class="icon-btn" type="button" data-close-dialog aria-label="Close">&times;</button></div>
    <div class="sheet-body"><div class="share-preview halftone" aria-busy="true"></div></div>`;
  dlg.showModal();
  const canvas = await makeShareCard();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  const url = URL.createObjectURL(blob);
  const file = new File([blob], "mcu-progress.png", { type: "image/png" });
  const canShare = navigator.canShare?.({ files: [file] });
  dlg.querySelector(".sheet-body").innerHTML = `
    <img class="share-preview" src="${url}" alt="Your MCU progress card">
    <div class="drawer-actions">
      ${canShare ? `<button class="btn btn-primary" type="button" id="share-native">Share</button>` : ""}
      <a class="btn ${canShare ? "" : "btn-primary"}" href="${url}" download="mcu-progress.png">Download image</a>
    </div>`;
  $("#share-native")?.addEventListener("click", () => navigator.share({ files: [file], title: "My MCU progress" }).catch(() => {}));
  dlg.addEventListener("close", () => setTimeout(() => URL.revokeObjectURL(url), 1000), { once: true });
}

/* ═══════════════════════════════════════════════════════════
   CROSS-DEVICE SYNC
   A private code identifies your progress on the sync server
   (server/sync_server.py). Each title carries a timestamp and
   the newest change wins, so devices merge instead of clobber.
═══════════════════════════════════════════════════════════ */
const SYNC = { code: null, status: "off", last: 0, timer: 0, busy: false, again: false };
const SYNC_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function newSyncCode() {
  let bits = 0, val = 0, out = "";
  for (const b of crypto.getRandomValues(new Uint8Array(15))) {
    val = (val << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += SYNC_ALPHABET[(val >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}
const cleanCode = (s) => (s || "").toUpperCase().replace(/[^A-Z2-7]/g, "");
const prettyCode = (c) => c.match(/.{1,4}/g).join("-");
const validCode = (c) => /^[A-Z2-7]{24}$/.test(c);

function scheduleSync() {
  if (!SYNC.code) return;
  clearTimeout(SYNC.timer);
  SYNC.timer = setTimeout(syncNow, 1200);
}

async function syncNow() {
  if (!SYNC.code) return;
  if (SYNC.busy) return void (SYNC.again = true);
  SYNC.busy = true;
  setSyncStatus("syncing");
  try {
    const res = await fetch(`api/sync/${SYNC.code}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: watchLog }),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    applyRemote((await res.json()).items || {});
    SYNC.last = Date.now();
    setSyncStatus("ok");
  } catch (e) {
    setSyncStatus("error");
  } finally {
    SYNC.busy = false;
    if (SYNC.again) {
      SYNC.again = false;
      scheduleSync();
    }
  }
}

function applyRemote(items) {
  let changed = false;
  for (const [id, v] of Object.entries(items)) {
    if (!byTitle.has(id) || !Array.isArray(v)) continue;
    const [w, ts] = v, cur = watchLog[id];
    if (!cur || ts > cur[1] || (ts === cur[1] && w > cur[0])) {
      watchLog[id] = [w ? 1 : 0, ts];
      changed = changed || !!w !== watched.has(id);
    }
  }
  watched = new Set(Object.entries(watchLog).filter(([, v]) => v[0]).map(([k]) => k));
  persistWatched();
  if (changed) {
    render();
    if (state.activeTitle) renderDrawer();
  }
}

function setSyncStatus(s) {
  SYNC.status = s;
  const el = $("#sync-status");
  if (el) {
    el.textContent = {
      off: "Off on this device",
      syncing: "Syncing...",
      ok: "Synced just now",
      error: "Can't reach the sync server",
    }[s];
    el.dataset.state = s;
  }
  if ($("#sync-dialog").open) renderSyncDialog();
}

function initSync() {
  const code = read(SYNC_KEY, null);
  SYNC.code = validCode(code) ? code : null;
  setSyncStatus(SYNC.code ? "syncing" : "off");
  if (!SYNC.code) return;
  syncNow();
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncNow());
  setInterval(() => document.visibilityState === "visible" && syncNow(), 120000);
}

function openSyncDialog(joinCode) {
  const dlg = $("#sync-dialog");
  dlg.dataset.join = joinCode ? cleanCode(joinCode) : "";
  renderSyncDialog();
  if (!dlg.open) dlg.showModal();
}

function renderSyncDialog() {
  const dlg = $("#sync-dialog");
  const join = dlg.dataset.join;
  const link = SYNC.code ? `${location.origin}${location.pathname}#/sync/${SYNC.code}` : "";
  const err = SYNC.status === "error"
    ? `<p class="sync-err">Can't reach the sync server. Your progress is still saved on this device and will sync when the server is back.</p>`
    : "";
  let body;
  if (join && join !== SYNC.code) {
    body = `<p>Join sync code <strong class="code">${esc(prettyCode(join))}</strong>? Progress on this device merges with it, nothing is lost.</p>
      <div class="drawer-actions"><button class="btn btn-primary" type="button" data-sync-action="join-link">Join</button>
      <button class="btn" type="button" data-close-dialog>Not now</button></div>`;
  } else if (SYNC.code) {
    body = `<p>This device syncs with the code below. Open the link on your other devices, or type the code there.</p>
      <p class="code-big display">${prettyCode(SYNC.code).split("-").join("-<wbr>")}</p>
      <p class="meta" style="font-size:14px"><span id="sync-status-2">${esc({ ok: "Synced", syncing: "Syncing...", error: "Offline", off: "" }[SYNC.status])}${
      SYNC.last ? `, last at ${new Date(SYNC.last).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""
    }</span></p>
      ${err}
      <div class="drawer-actions">
        <button class="btn btn-primary" type="button" data-sync-action="copy" data-link="${esc(link)}">Copy link</button>
        <button class="btn" type="button" data-sync-action="now">Sync now</button>
        <button class="btn" type="button" data-sync-action="off">Turn off here</button>
      </div>
      <p class="menu-note">Anyone with the code can see and change this progress, so share it only with your own devices.</p>`;
  } else {
    body = `<p>Keep your watched list the same on your phone, laptop and anything else. No account: you get a private code, and every device with it stays in step.</p>
      <div class="drawer-actions"><button class="btn btn-primary" type="button" data-sync-action="create">Create a sync code</button></div>
      <form class="join-form" data-join-form>
        <label for="join-code">Already have a code?</label>
        <div><input id="join-code" autocomplete="off" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"><button class="btn" type="submit">Join</button></div>
      </form>`;
  }
  dlg.innerHTML = `<div class="sheet-head"><h2 class="display">Sync across devices</h2><button class="icon-btn" type="button" data-close-dialog aria-label="Close">&times;</button></div>
    <div class="sheet-body">${body}</div>`;
  dlg.querySelector("[data-join-form]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const code = cleanCode($("#join-code").value);
    if (!validCode(code)) return toast("That code should be 24 letters and numbers");
    enableSync(code);
  });
}

function enableSync(code) {
  SYNC.code = code;
  write(SYNC_KEY, code);
  $("#sync-dialog").dataset.join = "";
  if (!SYNC.started) {
    SYNC.started = true;
    document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncNow());
  }
  syncNow().then(() => toast(SYNC.status === "ok" ? "Sync is on" : "Sync code saved; the server isn't reachable yet"));
  renderSyncDialog();
}

function syncAction(action, el) {
  if (action === "create") return enableSync(newSyncCode());
  if (action === "join-link") return enableSync($("#sync-dialog").dataset.join);
  if (action === "now") return syncNow();
  if (action === "copy") {
    navigator.clipboard?.writeText(el.dataset.link).then(() => toast("Link copied. Open it on your other device."), () => toast(el.dataset.link));
    return;
  }
  if (action === "off") {
    SYNC.code = null;
    try { localStorage.removeItem(SYNC_KEY); } catch (e) {}
    setSyncStatus("off");
    renderSyncDialog();
    toast("Sync turned off on this device");
  }
}

/* ═══════════════════════════════════════════════════════════
   INSTALLABLE APP (service worker + install prompt)
═══════════════════════════════════════════════════════════ */
function initPWA() {
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("#install-btn").hidden = false;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    $("#install-btn").hidden = true;
    toast("Installed. MCU Atlas is on your home screen.");
  });
  if (!standalone && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    $("#install-hint").hidden = false;
  }
}

/* ═══════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════ */
function boot() {
  if (typeof MCU_DATA === "undefined") {
    $("#main").innerHTML = emptyHTML("Data didn't load", "data.js must sit next to index.html.");
    return;
  }
  D = MCU_DATA;
  watched = new Set(read(WATCH_KEY, []));
  watchLog = read(LOG_KEY, null) || Object.fromEntries([...watched].map((id) => [id, [1, 0]]));
  watched = new Set(Object.entries(watchLog).filter(([, v]) => v[0]).map(([k]) => k));
  index();
  const prefs = read(PREFS_KEY, {});
  for (const k of ["view", "phase", "type", "hideWatched", "order", "region"]) if (prefs[k] !== undefined) state[k] = prefs[k];
  if (!state.region || !regionList().includes(state.region)) state.region = defaultRegion();
  if (!VIEWS.some((v) => v.id === state.view)) state.view = "library";
  if (state.phase !== "all" && !phase(state.phase)) state.phase = "all";

  if (D.synced_at) {
    const [y, m, d] = D.synced_at.split("-").map(Number);
    $("#synced-note").textContent = `Release data last synced with TMDB on ${MONTHS[m - 1]} ${d}, ${y}.`;
  }
  $$("#theme-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.themeSet === currentTheme())));
  $$("#motion-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.motionSet === FX.mode)));
  window.addEventListener("resize", () => renderTabs());
  document.fonts?.ready.then(() => renderTabs());
  bind();
  if (location.hash.length > 2) applyRoute();
  else {
    syncUrl("replace");
    render();
  }
  initSync();
  initPWA();
}

document.addEventListener("DOMContentLoaded", boot);
