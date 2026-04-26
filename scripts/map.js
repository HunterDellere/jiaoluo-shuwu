/* map.js — Interactive China map: layer toggles, pin rendering, tooltips */
(function () {
  'use strict';

  const BASE = (() => {
    const s = document.querySelector('script[data-map-base]');
    return s ? s.dataset.mapBase : '../../';
  })();

  const SVG_W = 800;
  const SVG_H = 700;

  // Mercator projection parameters — must match build/scripts/gen-map-svg.mjs
  // exactly so pins land where they belong on the rendered geodata.
  const PROJ = {
    centerLon: 103,
    centerLat: 36,
    scale:     820,
    tx:        368,   // translate x (W * 0.46)
    ty:        350,   // translate y (H * 0.50)
  };

  // Forward Mercator: (lon, lat) → (x, y) in SVG-viewBox coordinates.
  function projectLonLat(lon, lat) {
    const lambda = (lon - PROJ.centerLon) * Math.PI / 180;
    const phi    = lat * Math.PI / 180;
    const phi0   = PROJ.centerLat * Math.PI / 180;
    // Standard spherical Mercator with center-at-phi0 vertical offset
    const mercY  = Math.log(Math.tan(Math.PI / 4 + phi  / 2));
    const mercY0 = Math.log(Math.tan(Math.PI / 4 + phi0 / 2));
    const x = PROJ.tx + PROJ.scale * lambda;
    const y = PROJ.ty - PROJ.scale * (mercY - mercY0);
    return [x, y];
  }

  /* ── State ─────────────────────────────────────────────── */
  let entries = {};          // slug → entry object
  let annotations = [];     // from map-annotations.json
  let activeLayers = new Set(['modern']);
  let activeDynasty = null;  // for dynasty extent highlight
  let tooltip = null;
  let svgEl = null;
  let svgRect = null;

  /* ── Boot ───────────────────────────────────────────────── */
  async function init() {
    svgEl = document.getElementById('china-map-svg');
    if (!svgEl) return;

    // Load data in parallel
    const [entryData, annoData] = await Promise.all([
      fetch(BASE + 'data/entries.json').then(r => r.json()).catch(() => []),
      fetch(BASE + 'data/map-annotations.json').then(r => r.json()).catch(() => ({ annotations: [], layers: [] }))
    ]);

    // Index entries by slug
    entryData.forEach(e => {
      if (e.path) {
        // strip pages/ prefix and .html suffix to get slug
        const slug = e.path.replace(/^pages\//, '').replace(/\.html$/, '');
        entries[slug] = e;
      }
    });

    annotations = annoData.annotations || [];

    buildTooltip();
    renderPins();
    wireLayerToggles();
    wireDynastySelector();
    applyLayers();
    wireMapInteractions();
    wireResizeObserver();

    svgEl.setAttribute('aria-label', 'Interactive map of China — click a marker to open the linked entry');
  }

  /* ── Tooltip DOM ────────────────────────────────────────── */
  function buildTooltip() {
    tooltip = document.createElement('div');
    tooltip.className = 'map-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.setAttribute('aria-live', 'polite');
    tooltip.hidden = true;
    document.getElementById('map-container').appendChild(tooltip);
  }

  function showTooltip(anno, pinEl) {
    const entry = entries[anno.entry] || {};
    const title = entry.title || (anno.label_cn + ' · ' + anno.label_en);
    const desc = entry.desc || '';
    const cat = entry.category || anno.category || '';

    tooltip.innerHTML = `
      <span class="map-tt-cn">${anno.label_cn}</span>
      <span class="map-tt-py">${anno.label_py}</span>
      <span class="map-tt-title">${title.replace(/^[^·]+·\s*/, '')}</span>
      ${desc ? `<span class="map-tt-desc">${desc}</span>` : ''}
      ${cat ? `<span class="map-tt-cat" data-category="${cat}">${cat}</span>` : ''}
      <span class="map-tt-cta">View entry →</span>
    `;
    tooltip.dataset.category = cat;
    tooltip.hidden = false;
    positionTooltip(pinEl);
  }

  function hideTooltip() {
    tooltip.hidden = true;
  }

  function positionTooltip(pinEl) {
    const container = document.getElementById('map-container');
    const cr = container.getBoundingClientRect();
    const pr = pinEl.getBoundingClientRect();

    const left = pr.left - cr.left + pr.width / 2;
    const top = pr.top - cr.top;

    tooltip.style.left = Math.min(left, cr.width - 180) + 'px';
    tooltip.style.top = (top - 8) + 'px';
    tooltip.style.transform = 'translate(-50%, -100%)';
  }

  /* ── Pin rendering ──────────────────────────────────────── */
  const ICONS = {
    city:           'M0,-8 L5,0 L8,6 L0,10 L-8,6 L-5,0 Z',  // diamond
    region:         null,   // circle
    island:         null,   // circle
    river:          'M-6,0 Q0,-8 6,0 Q0,8 -6,0 Z',           // oval
    'dynasty-capital': 'M0,-9 L2,-3 L9,-3 L3,1 L5,8 L0,4 L-5,8 L-3,1 L-9,-3 L-2,-3 Z', // star
    'dialect-zone': null,   // circle
    cultural:       'M0,-7 L7,7 L-7,7 Z',                    // triangle
  };

  const CATEGORY_COLORS = {
    geography: '#2a5c6b',
    history:   '#6b4420',
    culture:   '#8e4a6e',
    religion:  '#5c3d7a',
    default:   '#8b1a1a',
  };

  function pinColor(anno) {
    return CATEGORY_COLORS[anno.category] || CATEGORY_COLORS.default;
  }

  function renderPins() {
    // Clear all pin groups
    ['sites','dynasties','rivers','dialects','modern'].forEach(layer => {
      const g = document.getElementById('map-pins-' + layer);
      if (g) g.innerHTML = '';
    });

    annotations.forEach(anno => {
      // Prefer projected lon/lat; fall back to legacy x/y percent for any
      // annotation that hasn't been migrated yet.
      let cx, cy;
      if (typeof anno.lon === 'number' && typeof anno.lat === 'number') {
        [cx, cy] = projectLonLat(anno.lon, anno.lat);
      } else {
        cx = (anno.x / 100) * SVG_W;
        cy = (anno.y / 100) * SVG_H;
      }
      const color = pinColor(anno);
      const icon = ICONS[anno.type] || null;

      // Build the pin group
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      g.setAttribute('class', 'map-pin map-pin--' + (anno.type || 'default'));
      g.setAttribute('data-annotation-id', anno.id);
      g.setAttribute('data-entry', anno.entry);
      g.setAttribute('tabindex', '0');
      g.setAttribute('role', 'button');
      g.setAttribute('aria-label', anno.label_cn + ' ' + anno.label_en);
      g.setAttribute('transform', `translate(${cx},${cy})`);

      // Outer glow ring (visual only — no hit-testing so hover doesn't flicker
      // when the cursor crosses ring↔body boundaries).
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      ring.setAttribute('r', '10');
      ring.setAttribute('fill', color);
      ring.setAttribute('opacity', '0.12');
      ring.setAttribute('class', 'pin-ring');
      ring.setAttribute('pointer-events', 'none');
      g.appendChild(ring);

      // Body shape (visual only — see above)
      if (icon) {
        const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        shape.setAttribute('d', icon);
        shape.setAttribute('fill', color);
        shape.setAttribute('stroke', '#f2e8d5');
        shape.setAttribute('stroke-width', '0.8');
        shape.setAttribute('class', 'pin-body');
        shape.setAttribute('pointer-events', 'none');
        g.appendChild(shape);
      } else {
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', '5');
        circle.setAttribute('fill', color);
        circle.setAttribute('stroke', '#f2e8d5');
        circle.setAttribute('stroke-width', '1');
        circle.setAttribute('class', 'pin-body');
        circle.setAttribute('pointer-events', 'none');
        g.appendChild(circle);
      }

      // Single transparent hit-target sized to cover the ring — pointer events
      // hit only this rect, so hover state is stable across the pin's interior.
      const hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      hit.setAttribute('r', '12');
      hit.setAttribute('fill', 'transparent');
      hit.setAttribute('class', 'pin-hit');
      g.appendChild(hit);

      // Title for SVG accessibility
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = anno.label_cn + ' · ' + anno.label_en;
      g.appendChild(title);

      // Append to the correct layer group(s)
      anno.layers.forEach(layerId => {
        const layerGroup = document.getElementById('map-pins-' + layerId);
        if (layerGroup) layerGroup.appendChild(layerId === anno.layers[0] ? g : g.cloneNode(true));
      });
    });
  }

  /* ── Layer toggle wiring ────────────────────────────────── */
  function wireLayerToggles() {
    document.querySelectorAll('.map-layer-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const layer = btn.dataset.layer;
        if (activeLayers.has(layer)) {
          activeLayers.delete(layer);
          btn.classList.remove('active');
          btn.setAttribute('aria-pressed', 'false');
        } else {
          activeLayers.add(layer);
          btn.classList.add('active');
          btn.setAttribute('aria-pressed', 'true');
        }
        applyLayers();
      });
    });
  }

  function applyLayers() {
    // Toggle SVG layer groups
    svgEl.querySelectorAll('.map-layer').forEach(g => {
      const layer = g.dataset.layer;
      g.style.display = activeLayers.has(layer) ? '' : 'none';
    });
    // Also toggle JS-rendered pin groups
    ['sites','dynasties','rivers','dialects','modern'].forEach(layer => {
      const g = document.getElementById('map-pins-' + layer);
      if (g) g.style.display = activeLayers.has(layer) ? '' : 'none';
    });
  }

  /* ── Dynasty selector ───────────────────────────────────── */
  function wireDynastySelector() {
    document.querySelectorAll('.dynasty-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.dynasty;
        if (activeDynasty === d) {
          // toggle off
          activeDynasty = null;
          btn.classList.remove('active');
        } else {
          activeDynasty = d;
          document.querySelectorAll('.dynasty-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        }
        applyDynastyHighlight();
      });
    });
  }

  function applyDynastyHighlight() {
    svgEl.querySelectorAll('.dynasty-extent').forEach(el => {
      const d = el.dataset.dynasty;
      el.style.opacity = (activeDynasty === d) ? '1' : '0';
      el.style.transition = 'opacity 0.35s ease';
    });
  }

  /* ── Interaction: hover/click on pins ──────────────────── */
  function wireMapInteractions() {
    let activePinId = null;

    svgEl.addEventListener('pointerover', e => {
      const pin = e.target.closest('.map-pin');
      if (!pin) return;
      const id = pin.dataset.annotationId;
      // Only re-show / re-position when crossing onto a *different* pin.
      // Without this guard, sub-element pointerovers cause repeated calls
      // that re-flow the tooltip and read as glitchy flicker.
      if (id === activePinId) return;
      const anno = annotations.find(a => a.id === id);
      if (!anno) return;
      activePinId = id;
      showTooltip(anno, pin);
    });

    svgEl.addEventListener('pointerout', e => {
      const pin = e.target.closest('.map-pin');
      if (!pin) return;
      // Only hide when leaving the pin's hit area entirely — `relatedTarget`
      // null means cursor left the document/svg; otherwise it must not be
      // inside the same pin.
      const next = e.relatedTarget;
      if (next && pin.contains(next)) return;
      const nextPin = next && next.closest && next.closest('.map-pin');
      if (nextPin && nextPin.dataset.annotationId === pin.dataset.annotationId) return;
      activePinId = null;
      hideTooltip();
    });

    svgEl.addEventListener('click', e => {
      const pin = e.target.closest('.map-pin');
      if (!pin) return;
      const entry = pin.dataset.entry;
      if (entry) {
        window.location.href = BASE + 'pages/' + entry + '.html';
      }
    });

    svgEl.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const pin = e.target.closest('.map-pin');
      if (!pin) return;
      e.preventDefault();
      const id = pin.dataset.annotationId;
      const anno = annotations.find(a => a.id === id);
      if (anno) showTooltip(anno, pin);
      const entry = pin.dataset.entry;
      if (entry && e.key === 'Enter') {
        window.location.href = BASE + 'pages/' + entry + '.html';
      }
    });

    // Tooltip itself: keep visible on hover
    tooltip.addEventListener('pointerenter', () => { tooltip.hidden = false; });
    tooltip.addEventListener('pointerleave', hideTooltip);
    tooltip.addEventListener('click', () => {
      const visiblePins = svgEl.querySelectorAll('.map-pin:hover, .map-pin:focus');
      if (visiblePins.length) {
        const entry = visiblePins[0].dataset.entry;
        if (entry) window.location.href = BASE + 'pages/' + entry + '.html';
      }
    });
  }

  /* ── Resize: re-cache SVG rect ──────────────────────────── */
  function wireResizeObserver() {
    if (!window.ResizeObserver) return;
    new ResizeObserver(() => { svgRect = null; }).observe(document.getElementById('map-container'));
  }

  /* ── Mobile: layer dropdown ─────────────────────────────── */
  function initMobileToggle() {
    const toggle = document.getElementById('map-layers-toggle');
    const panel = document.getElementById('map-layers-panel');
    if (!toggle || !panel) return;
    toggle.addEventListener('click', () => {
      const open = panel.hidden;
      panel.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
    });
  }

  /* ── Run ────────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { init(); initMobileToggle(); });
  } else {
    init();
    initMobileToggle();
  }
})();
