/* welcome.js — first-visit-only onboarding moment.
 *
 * Shows a 4-scene tour on the visitor's first homepage load, explaining
 * what the site is (not a flashcard app), how to read it (daily reading),
 * how to search, and how to wander (families). Dismissal is persisted in
 * localStorage so it never appears again on the same device.
 *
 * Persistence:
 *   localStorage['shuwo.welcomed.v1'] = '<ISO>'   (set on dismiss)
 *
 * Force-show for testing: append ?welcome=1 to the URL.
 * Reset for testing: localStorage.removeItem('shuwo.welcomed.v1').
 *
 * No external deps. Vanilla DOM. Brand-native styling.
 */

(function () {
  "use strict";

  const STORAGE_KEY = "shuwo.welcomed.v1";

  function hasBeenWelcomed() {
    try { return !!localStorage.getItem(STORAGE_KEY); } catch (_) { return false; }
  }
  function markWelcomed() {
    try { localStorage.setItem(STORAGE_KEY, new Date().toISOString()); } catch (_) {}
  }

  function isForced() {
    try { return new URLSearchParams(location.search).get("welcome") === "1"; }
    catch (_) { return false; }
  }

  // Respect reduced-motion preference — drops transitions for those users.
  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Four scenes. Copy is intentionally tight — one short line each.
  // CN glyph is decorative; aria-hidden so screen readers get the English.
  const SCENES = [
    {
      glyph: "迎",
      eyebrow: "歡迎 huānyíng",
      title: "Welcome to the nook.",
      body: "Not a flashcard app. A small reading library where each page tries to be worth slowing down for.",
      cta: "Show me around",
    },
    {
      glyph: "日",
      eyebrow: "今日 jīnrì",
      title: "Start your day with one passage.",
      body: "A short Chinese reading every morning, chosen for you. Audio, pinyin, translation, all in one place.",
      cta: "Next",
    },
    {
      glyph: "搜",
      eyebrow: "搜索 sōusuǒ",
      title: "Search a character, a word, an idea.",
      body: "Type 心, dao, or confucius. Press / from anywhere on the page to jump straight into the search bar.",
      cta: "Next",
    },
    {
      glyph: "探",
      eyebrow: "探索 tànsuǒ",
      title: "Wander when you want to.",
      body: "Browse by language, topic, or curated collection. Every page links to its neighbors so you can follow your curiosity.",
      cta: "Open the nook",
    },
  ];

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === "class") node.className = attrs[k];
      else if (k === "html") node.innerHTML = attrs[k];
      else if (k.startsWith("aria-") || k === "role" || k === "id" || k === "type" || k === "tabindex")
        node.setAttribute(k, attrs[k]);
      else node[k] = attrs[k];
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(c => {
        if (c == null) return;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  function injectStyles() {
    if (document.getElementById("welcome-styles")) return;
    const style = document.createElement("style");
    style.id = "welcome-styles";
    style.textContent = `
.welcome-backdrop {
  position: fixed; inset: 0;
  background: radial-gradient(ellipse at center, rgba(28,18,8,0.55) 0%, rgba(28,18,8,0.78) 70%);
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  z-index: 9000;
  display: flex; align-items: center; justify-content: center;
  padding: 1.25rem;
  opacity: 0;
  transition: opacity 0.45s ease;
}
.welcome-backdrop.is-open { opacity: 1; }
.welcome-card {
  position: relative;
  width: min(520px, 100%);
  max-height: calc(100vh - 2.5rem);
  background: var(--papyrus, #f2e8d5);
  color: var(--ink, #14110a);
  border: 1px solid var(--rule, #c8bda0);
  border-radius: var(--radius-lg, 8px);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.18) inset,
    0 28px 60px rgba(28,18,8,0.45),
    0 2px 6px rgba(28,18,8,0.25);
  padding: 2.4rem 2.2rem 1.6rem;
  display: flex; flex-direction: column;
  overflow: hidden;
  transform: translateY(8px);
  transition: transform 0.55s cubic-bezier(0.2, 0.7, 0.2, 1);
}
.welcome-backdrop.is-open .welcome-card { transform: translateY(0); }
@media (prefers-reduced-motion: reduce) {
  .welcome-backdrop, .welcome-card { transition: none; }
}
.welcome-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, var(--red, #8b1a1a), var(--ochre-2, #c07830), var(--red, #8b1a1a));
  opacity: 0.55;
}
.welcome-glyph {
  font-family: var(--font-cn-display, 'Noto Serif SC', serif);
  font-size: 4.2rem;
  font-weight: 600;
  color: var(--red, #8b1a1a);
  line-height: 1;
  text-align: center;
  margin-bottom: 0.6rem;
  text-shadow: 1px 1px 0 rgba(139,26,26,0.12);
  letter-spacing: 0.04em;
  user-select: none;
}
.welcome-eyebrow {
  font-family: var(--font-mono, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--ochre, #a06428);
  text-align: center;
  margin-bottom: 0.85rem;
}
.welcome-eyebrow .cn {
  font-family: var(--font-cn, 'Noto Serif SC', serif);
  font-size: 0.82rem;
  letter-spacing: 0.05em;
  text-transform: none;
  margin-right: 0.35rem;
  color: var(--red, #8b1a1a);
  font-weight: 600;
}
.welcome-title {
  font-family: 'EB Garamond', Georgia, serif;
  font-size: 1.65rem;
  font-weight: 600;
  color: var(--ink, #14110a);
  text-align: center;
  line-height: 1.25;
  margin: 0 0 0.7rem;
  letter-spacing: -0.005em;
}
.welcome-body {
  font-family: 'EB Garamond', Georgia, serif;
  font-size: 1.02rem;
  font-style: italic;
  color: var(--ink-4, #3d2e18);
  text-align: center;
  line-height: 1.55;
  margin: 0 auto 1.6rem;
  max-width: 38ch;
}
.welcome-actions {
  display: flex; align-items: center; justify-content: space-between;
  gap: 0.75rem;
  margin-top: auto;
}
.welcome-dots {
  display: flex; gap: 0.4rem; align-items: center;
}
.welcome-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--papyrus-4, #d4c9a8);
  border: 1px solid var(--rule, #c8bda0);
  transition: background 0.3s ease, transform 0.3s ease, border-color 0.3s;
  padding: 0;
}
.welcome-dot.is-active {
  background: var(--red, #8b1a1a);
  border-color: var(--red, #8b1a1a);
  transform: scale(1.15);
}
.welcome-dot.is-past {
  background: var(--ochre, #a06428);
  border-color: var(--ochre, #a06428);
}
.welcome-cta {
  appearance: none;
  font-family: 'EB Garamond', Georgia, serif;
  font-size: 1rem;
  font-weight: 600;
  color: var(--papyrus, #f2e8d5);
  background: var(--red, #8b1a1a);
  border: 1px solid var(--red, #8b1a1a);
  padding: 0.6rem 1.4rem;
  border-radius: 999px;
  cursor: pointer;
  letter-spacing: 0.01em;
  transition: background 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease;
  box-shadow: 0 1px 0 rgba(255,255,255,0.12) inset, 0 2px 8px rgba(139,26,26,0.25);
}
.welcome-cta:hover {
  background: var(--red-2, #a82020);
  transform: translateY(-1px);
}
.welcome-cta:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(160,100,40,0.4), 0 2px 8px rgba(139,26,26,0.25);
}
.welcome-skip {
  position: absolute;
  top: 0.7rem; right: 0.9rem;
  appearance: none;
  background: transparent;
  border: none;
  font-family: var(--font-ui, system-ui), sans-serif;
  font-size: 0.78rem;
  color: var(--ink-5, #5a4428);
  cursor: pointer;
  padding: 0.35rem 0.5rem;
  border-radius: 4px;
  transition: color 0.15s, background 0.15s;
  letter-spacing: 0.02em;
}
.welcome-skip:hover { color: var(--ink-2, #221808); background: var(--papyrus-3, #e0d4b8); }
.welcome-skip:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px rgba(160,100,40,0.35);
}
.welcome-scene {
  display: flex; flex-direction: column;
  opacity: 1;
  transition: opacity 0.32s ease;
}
.welcome-scene.is-leaving { opacity: 0; }

/* Mobile */
@media (max-width: 480px) {
  .welcome-card { padding: 2rem 1.4rem 1.3rem; }
  .welcome-glyph { font-size: 3.4rem; }
  .welcome-title { font-size: 1.35rem; }
  .welcome-body { font-size: 0.96rem; }
  .welcome-cta { padding: 0.55rem 1.15rem; font-size: 0.95rem; }
}

/* Dark mode */
html[data-theme="dark"] .welcome-card {
  background: #1a1408;
  color: #e8dcc4;
  border-color: #3d2e18;
  box-shadow: 0 28px 60px rgba(0,0,0,0.65), 0 2px 6px rgba(0,0,0,0.45);
}
html[data-theme="dark"] .welcome-title { color: #efe4cc; }
html[data-theme="dark"] .welcome-body { color: #c8b890; }
html[data-theme="dark"] .welcome-skip { color: #a89770; }
html[data-theme="dark"] .welcome-skip:hover { color: #efe4cc; background: rgba(255,255,255,0.06); }
html[data-theme="dark"] .welcome-dot { background: #3d2e18; border-color: #5a4428; }
`;
    document.head.appendChild(style);
  }

  function show() {
    injectStyles();

    const backdrop = el("div", {
      class: "welcome-backdrop",
      role: "dialog",
      "aria-modal": "true",
      "aria-labelledby": "welcome-title",
      "aria-describedby": "welcome-body",
    });

    const card = el("div", { class: "welcome-card" });

    const skip = el("button", { class: "welcome-skip", type: "button", "aria-label": "Skip welcome" }, "Skip");

    const sceneWrap = el("div", { class: "welcome-scene", id: "welcome-scene-wrap" });

    const dotsWrap = el("div", { class: "welcome-dots", role: "tablist", "aria-label": "Onboarding progress" });
    SCENES.forEach((_, i) => {
      const dot = el("button", {
        class: "welcome-dot",
        type: "button",
        "aria-label": `Step ${i + 1} of ${SCENES.length}`,
      });
      dot._idx = i;
      dotsWrap.appendChild(dot);
    });

    const cta = el("button", { class: "welcome-cta", type: "button" });

    const actions = el("div", { class: "welcome-actions" }, [dotsWrap, cta]);

    card.appendChild(skip);
    card.appendChild(sceneWrap);
    card.appendChild(actions);
    backdrop.appendChild(card);

    let current = 0;
    let isAnimating = false;

    function renderScene() {
      const s = SCENES[current];
      sceneWrap.innerHTML = "";
      sceneWrap.appendChild(el("div", { class: "welcome-glyph", "aria-hidden": "true" }, s.glyph));
      sceneWrap.appendChild(el("div", { class: "welcome-eyebrow", html: `<span class="cn">${s.eyebrow.split(" ")[0]}</span>${s.eyebrow.split(" ").slice(1).join(" ")}` }));
      sceneWrap.appendChild(el("h2", { class: "welcome-title", id: "welcome-title" }, s.title));
      sceneWrap.appendChild(el("p", { class: "welcome-body", id: "welcome-body" }, s.body));
      cta.textContent = s.cta;
      Array.from(dotsWrap.children).forEach((d, i) => {
        d.classList.toggle("is-active", i === current);
        d.classList.toggle("is-past", i < current);
      });
    }

    function gotoScene(idx) {
      if (isAnimating || idx === current) return;
      if (idx >= SCENES.length) { close(); return; }
      if (prefersReducedMotion) {
        current = idx;
        renderScene();
        return;
      }
      isAnimating = true;
      sceneWrap.classList.add("is-leaving");
      setTimeout(() => {
        current = idx;
        renderScene();
        sceneWrap.classList.remove("is-leaving");
        isAnimating = false;
      }, 320);
    }

    function close() {
      markWelcomed();
      backdrop.classList.remove("is-open");
      setTimeout(() => {
        document.removeEventListener("keydown", onKey);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        document.documentElement.style.overflow = "";
        if (lastFocus && typeof lastFocus.focus === "function") {
          try { lastFocus.focus(); } catch (_) {}
        }
      }, prefersReducedMotion ? 0 : 450);
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        if (document.activeElement !== cta && document.activeElement !== skip) {
          e.preventDefault(); gotoScene(current + 1);
        }
      }
      else if (e.key === "ArrowLeft") { e.preventDefault(); gotoScene(Math.max(0, current - 1)); }
    }

    cta.addEventListener("click", () => gotoScene(current + 1));
    skip.addEventListener("click", close);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    dotsWrap.addEventListener("click", (e) => {
      const dot = e.target.closest(".welcome-dot");
      if (dot && typeof dot._idx === "number") gotoScene(dot._idx);
    });

    const lastFocus = document.activeElement;
    document.body.appendChild(backdrop);
    document.documentElement.style.overflow = "hidden";

    renderScene();
    requestAnimationFrame(() => backdrop.classList.add("is-open"));

    // Focus the CTA so Enter advances immediately.
    setTimeout(() => { try { cta.focus(); } catch (_) {} }, prefersReducedMotion ? 10 : 380);

    document.addEventListener("keydown", onKey);
  }

  function boot() {
    if (!isForced() && hasBeenWelcomed()) return;
    // Skip for headless automation (Playwright/Selenium) unless explicitly
    // forced via ?welcome=1 — keeps e2e tests deterministic and snappy.
    if (!isForced() && navigator.webdriver) return;
    // Defer to next idle frame so it doesn't compete with first paint.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => setTimeout(show, 400));
    } else {
      setTimeout(show, 400);
    }
  }

  boot();
})();
