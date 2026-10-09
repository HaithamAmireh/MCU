/* ═══════════════════════════════════════════════════════════
   MCU ATLAS — fx.js
   Motion layer: Kirby crackle, impact bursts, foil tilt,
   panel-drop reveals. Everything is skipped when motion is
   "reduced" and pauses when off-screen or the tab is hidden.
═══════════════════════════════════════════════════════════ */

const FX = (() => {
  const root = document.documentElement;
  const KEY = "mcu_motion";
  const prefersReduced = matchMedia("(prefers-reduced-motion: reduce)");
  const finePointer = matchMedia("(hover: hover) and (pointer: fine)");
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  const cssVar = (n) => getComputedStyle(root).getPropertyValue(n).trim();

  let mode;
  try { mode = localStorage.getItem(KEY); } catch (e) {}
  if (mode !== "full" && mode !== "reduced") mode = prefersReduced.matches ? "reduced" : "full";
  root.dataset.motion = mode;
  const on = () => mode === "full";

  function setMode(m) {
    mode = m;
    root.dataset.motion = m;
    try { localStorage.setItem(KEY, m); } catch (e) {}
    if (!on()) {
      stopHero();
      parts = [];
      document.querySelectorAll(".fx-pending").forEach((el) => el.classList.remove("fx-pending", "fx-in"));
    }
  }

  /* ── impact bursts (one shared full-screen canvas) ───── */
  let layer = null, lctx = null, parts = [], raf = 0;

  function sizeLayer() {
    layer.width = innerWidth * DPR;
    layer.height = innerHeight * DPR;
    lctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  function ensureLayer() {
    if (layer) return;
    layer = document.createElement("canvas");
    layer.className = "fx-layer";
    layer.setAttribute("aria-hidden", "true");
    document.body.appendChild(layer);
    lctx = layer.getContext("2d");
    sizeLayer();
    addEventListener("resize", sizeLayer);
  }

  function burst(x, y, { power = 1 } = {}) {
    if (!on()) return;
    ensureLayer();
    const red = cssVar("--red"), yellow = cssVar("--yellow"), ink = cssVar("--ink");
    const cols = [red, yellow, red, ink];
    const dots = Math.round(26 * power);
    for (let i = 0; i < dots; i++) {
      const a = rand(0, TAU), sp = rand(2.5, 8) * power;
      parts.push({
        k: "dot", x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2 * power,
        r: rand(1.5, 5) * Math.sqrt(power), c: cols[i % cols.length], life: 0, max: rand(38, 70),
      });
    }
    const lines = Math.round(12 * Math.sqrt(power));
    for (let i = 0; i < lines; i++) {
      parts.push({ k: "line", x, y, a: (i / lines) * TAU + rand(-0.12, 0.12), d0: 16 * power, life: 0, max: 18, c: ink });
    }
    parts.push({ k: "ring", x, y, life: 0, max: 24, R: 64 * power, c: yellow });
    if (!raf) raf = requestAnimationFrame(tickLayer);
  }

  function tickLayer() {
    lctx.clearRect(0, 0, innerWidth, innerHeight);
    parts = parts.filter((p) => {
      const t = ++p.life / p.max;
      if (t >= 1) return false;
      lctx.globalAlpha = 1 - t * t;
      if (p.k === "dot") {
        p.vx *= 0.93;
        p.vy = p.vy * 0.93 + 0.32;
        p.x += p.vx;
        p.y += p.vy;
        lctx.fillStyle = p.c;
        lctx.beginPath();
        lctx.arc(p.x, p.y, p.r * (1 - t * 0.4), 0, TAU);
        lctx.fill();
      } else if (p.k === "line") {
        const d = p.d0 + t * 46, len = 26 * (1 - t);
        lctx.strokeStyle = p.c;
        lctx.lineWidth = 3.5 * (1 - t);
        lctx.lineCap = "round";
        lctx.beginPath();
        lctx.moveTo(p.x + Math.cos(p.a) * d, p.y + Math.sin(p.a) * d);
        lctx.lineTo(p.x + Math.cos(p.a) * (d + len), p.y + Math.sin(p.a) * (d + len));
        lctx.stroke();
      } else {
        const e = 1 - Math.pow(1 - t, 3);
        lctx.strokeStyle = p.c;
        lctx.lineWidth = 5 * (1 - t);
        lctx.beginPath();
        lctx.arc(p.x, p.y, p.R * e, 0, TAU);
        lctx.stroke();
      }
      return true;
    });
    lctx.globalAlpha = 1;
    raf = parts.length ? requestAnimationFrame(tickLayer) : 0;
    if (!raf) lctx.clearRect(0, 0, innerWidth, innerHeight);
  }

  function burstAt(el, opts) {
    if (!el) return;
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, opts);
  }

  /* ── Kirby crackle in the Up next hero ───────────────── */
  let hero = null;
  const sprites = {};

  function glowSprite(color) {
    if (sprites[color]) return sprites[color];
    const s = document.createElement("canvas");
    s.width = s.height = 64;
    const g = s.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(0.25, color + "88");
    grad.addColorStop(1, color + "00");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return (sprites[color] = s);
  }

  function makeCluster(w, h, anywhere) {
    const dots = [];
    const n = Math.round(rand(6, 16));
    for (let i = 0; i < n; i++) {
      dots.push({ a: rand(0, TAU), d: rand(0.15, 1), s: rand(1.2, 7) * (i === 0 ? 1.5 : 1), sp: rand(-0.012, 0.012), ph: rand(0, TAU) });
    }
    const pick = Math.random();
    return {
      x: anywhere ? rand(0, w) : rand(w * 0.35, w),
      y: rand(0, h),
      vx: rand(-0.18, 0.18), vy: rand(-0.14, 0.1),
      R: rand(12, 44), dots,
      col: pick < 0.55 ? "#ffd23f" : pick < 0.85 ? "#ffffff" : "#ff5257",
      life: 0, max: rand(500, 1100), ph: rand(0, TAU),
    };
  }

  function sizeHero() {
    const r = hero.el.getBoundingClientRect();
    hero.w = r.width;
    hero.h = r.height;
    hero.c.width = r.width * DPR;
    hero.c.height = r.height * DPR;
    hero.ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }

  function mountHero(el) {
    stopHero();
    if (!on() || !el) return;
    const c = document.createElement("canvas");
    c.className = "fx-crackle";
    c.setAttribute("aria-hidden", "true");
    el.querySelector(".upnext-art").after(c);
    hero = { el, c, ctx: c.getContext("2d"), clusters: [], px: 0.7, py: 0.4, tx: 0.7, ty: 0.4, visible: true, t: 0, raf: 0 };
    sizeHero();
    const count = Math.max(12, Math.min(34, Math.round((hero.w * hero.h) / 15000)));
    for (let i = 0; i < count; i++) {
      const cl = makeCluster(hero.w, hero.h, true);
      cl.life = rand(0, cl.max * 0.8);
      hero.clusters.push(cl);
    }
    hero.onMove = (e) => {
      const r = el.getBoundingClientRect();
      hero.tx = (e.clientX - r.left) / r.width;
      hero.ty = (e.clientY - r.top) / r.height;
    };
    hero.onLeave = () => { hero.tx = 0.7; hero.ty = 0.4; };
    el.addEventListener("pointermove", hero.onMove);
    el.addEventListener("pointerleave", hero.onLeave);
    hero.ro = new ResizeObserver(() => hero && sizeHero());
    hero.ro.observe(el);
    hero.io = new IntersectionObserver(([en]) => {
      if (!hero) return;
      hero.visible = en.isIntersecting;
      if (hero.visible && !hero.raf) hero.raf = requestAnimationFrame(tickHero);
    });
    hero.io.observe(el);
    hero.raf = requestAnimationFrame(tickHero);
  }

  function tickHero() {
    if (!hero) return;
    hero.raf = 0;
    if (!hero.visible || document.hidden) return;
    const { ctx, w, h } = hero;
    hero.t++;
    hero.px += (hero.tx - hero.px) * 0.05;
    hero.py += (hero.ty - hero.py) * 0.05;
    hero.el.style.setProperty("--px", (hero.px - 0.5).toFixed(3));
    hero.el.style.setProperty("--py", (hero.py - 0.5).toFixed(3));
    const narrow = w < 700;
    const mx = hero.px * w, my = hero.py * h;

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = "lighter";
    hero.clusters.forEach((cl, i) => {
      cl.life++;
      if (cl.life > cl.max) hero.clusters[i] = makeCluster(w, h, false);
      // drift, with a gentle pull toward the pointer
      cl.vx += ((mx - cl.x) / w) * 0.004;
      cl.vy += ((my - cl.y) / h) * 0.004;
      cl.vx *= 0.995;
      cl.vy *= 0.995;
      cl.x += cl.vx;
      cl.y += cl.vy;
      if (cl.x < -40) cl.x = w + 40;
      if (cl.x > w + 40) cl.x = -40;
      if (cl.y < -40) cl.y = h + 40;
      if (cl.y > h + 40) cl.y = -40;

      const lt = cl.life / cl.max;
      const fade = smooth(0, 0.12, lt) * (1 - smooth(0.82, 1, lt));
      // keep the energy away from the copy (left on desktop, bottom on phones)
      const zone = narrow ? 1 - smooth(h * 0.38, h * 0.72, cl.y) * 0.85 : 0.18 + 0.82 * smooth(w * 0.3, w * 0.62, cl.x);
      const near = Math.max(0, 1 - Math.hypot(cl.x - mx, cl.y - my) / 220);
      const alpha = fade * zone * (0.55 + 0.45 * near);
      if (alpha < 0.02) return;

      const sprite = glowSprite(cl.col);
      for (const d of cl.dots) {
        d.a += d.sp * (1 + near * 2);
        const pulse = 0.45 + 0.55 * Math.abs(Math.sin(hero.t * 0.025 + d.ph));
        const x = cl.x + Math.cos(d.a) * cl.R * d.d;
        const y = cl.y + Math.sin(d.a) * cl.R * d.d;
        const s = d.s * (0.8 + near * 0.5);
        ctx.globalAlpha = alpha * pulse * 0.5;
        ctx.drawImage(sprite, x - s * 4, y - s * 4, s * 8, s * 8);
        ctx.globalAlpha = alpha * pulse;
        ctx.fillStyle = cl.col;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.6, 0, TAU);
        ctx.fill();
      }
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    hero.raf = requestAnimationFrame(tickHero);
  }

  function stopHero() {
    if (!hero) return;
    cancelAnimationFrame(hero.raf);
    hero.io.disconnect();
    hero.ro.disconnect();
    hero.el.removeEventListener("pointermove", hero.onMove);
    hero.el.removeEventListener("pointerleave", hero.onLeave);
    hero.c.remove();
    hero = null;
  }

  document.addEventListener("visibilitychange", () => {
    if (hero && !document.hidden && !hero.raf) hero.raf = requestAnimationFrame(tickHero);
  });

  /* ── foil tilt on cards ──────────────────────────────── */
  let tiltCard = null, tiltFrame = 0, tiltEvt = null;

  function resetTilt(card) {
    if (!card) return;
    ["--rx", "--ry", "--mx", "--my", "--holo"].forEach((p) => card.style.removeProperty(p));
  }
  document.addEventListener("pointermove", (e) => {
    if (!on() || !finePointer.matches) return;
    const card = e.target.closest?.(".card");
    if (card !== tiltCard) {
      resetTilt(tiltCard);
      tiltCard = card;
    }
    if (!card) return;
    tiltEvt = e;
    if (tiltFrame) return;
    tiltFrame = requestAnimationFrame(() => {
      tiltFrame = 0;
      const cover = tiltCard?.querySelector(".cover");
      if (!cover || !tiltEvt) return;
      const r = cover.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (tiltEvt.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (tiltEvt.clientY - r.top) / r.height));
      tiltCard.style.setProperty("--ry", `${((x - 0.5) * 14).toFixed(2)}deg`);
      tiltCard.style.setProperty("--rx", `${((0.5 - y) * 14).toFixed(2)}deg`);
      tiltCard.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      tiltCard.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
      tiltCard.style.setProperty("--holo", `${(x * 100).toFixed(1)}%`);
    });
  }, { passive: true });
  document.addEventListener("pointerleave", () => { resetTilt(tiltCard); tiltCard = null; });

  /* ── panel-drop reveals ──────────────────────────────── */
  const seen = new Set();
  let lastView = null, revealIO = null;
  const REVEAL = ".card, .row, .path-card, .phase-head, .figure, .bar-row, .person, .story-label, .slot, .section-title";

  function reveal(view, scope) {
    if (view !== lastView) {
      seen.clear();
      lastView = view;
    }
    if (!on()) return;
    revealIO?.disconnect();
    revealIO = new IntersectionObserver((entries) => {
      let i = 0;
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const el = en.target;
        const delay = Math.min(i++, 14) * 42;
        el.style.setProperty("--fx-d", `${delay}ms`);
        el.classList.add("fx-in");
        revealIO.unobserve(el);
        // children (stat bars) can run longer than the panel itself
        setTimeout(() => {
          el.classList.remove("fx-pending", "fx-in");
          el.style.removeProperty("--fx-d");
        }, delay + 1100);
      }
    }, { rootMargin: "0px 0px -4% 0px" });

    scope.querySelectorAll(REVEAL).forEach((el) => {
      const key = el.dataset.tid || el.dataset.path || el.dataset.pick || el.querySelector("[data-pick],[data-open],[data-char],[id]")?.outerHTML.slice(0, 80) || el.textContent.trim().slice(0, 60);
      const k = `${el.className.split(" ")[0]}:${key}`;
      if (seen.has(k)) return;
      seen.add(k);
      el.classList.add("fx-pending");
      revealIO.observe(el);
    });
  }

  /* ── live countdown ──────────────────────────────────── */
  function tickCountdowns() {
    document.querySelectorAll("[data-countdown]").forEach((el) => {
      const [y, m, d] = el.dataset.countdown.split("-").map(Number);
      let s = Math.max(0, Math.floor((new Date(y, m - 1, d) - Date.now()) / 1000));
      const parts = [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60];
      el.querySelectorAll("[data-unit]").forEach((u, i) => {
        const v = String(parts[i]).padStart(2, "0");
        if (u.textContent !== v) {
          u.textContent = v;
          if (on()) {
            u.classList.remove("flip");
            void u.offsetWidth;
            u.classList.add("flip");
          }
        }
      });
    });
  }
  setInterval(tickCountdowns, 1000);

  return { burst, burstAt, mountHero, stopHero, reveal, setMode, tickCountdowns, get mode() { return mode; }, on };
})();
