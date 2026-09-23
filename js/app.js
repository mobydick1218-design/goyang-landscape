/* =========================================================
   지도 · 패널 · 검색
   화면 흐름: 전체(자원 점) → 자원 선택(사진·설명·경계) → 세부 조사결과(조망점·요소) → 요소 선택
   ========================================================= */
(function () {
  const C = window.CONFIG;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CLS_ORDER = ['VP', 'LE', 'BE', 'ETC'];
  const TYPE_LABEL = { resource: '경관자원' };

  document.title = C.title; $('#siteTitle').textContent = C.title;

  /* ---------- 지도 ---------- */
  const MOBILE = window.innerWidth <= 760;
  const map = L.map('map', { zoomControl: false, attributionControl: false, doubleClickZoom: true });
  if (!MOBILE) L.control.zoom({ position: 'bottomleft' }).addTo(map);   // 휴대폰은 두 손가락 확대
  L.control.attribution({ position: MOBILE ? 'topright' : 'bottomright', prefix: '<a href="https://leafletjs.com" target="_blank">Leaflet</a>' }).addTo(map);
  map.createPane('boundary'); map.getPane('boundary').style.zIndex = 350;

  const base = {};
  Object.entries(C.basemaps).forEach(([k, b]) => {
    const g = L.layerGroup([L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom, subdomains: 'abcd' })]);
    if (b.labels) g.addLayer(L.tileLayer(b.labels, { maxZoom: b.maxZoom, subdomains: 'abcd', pane: 'overlayPane' }));
    base[k] = g;
  });
  base.normal.addTo(map);
  document.querySelectorAll('.basemap button').forEach(btn => btn.onclick = () => {
    Object.values(base).forEach(l => map.removeLayer(l));
    base[btn.dataset.base].addTo(map);
    document.querySelectorAll('.basemap button').forEach(b => b.classList.toggle('on', b === btn));
    document.body.classList.toggle('sat', btn.dataset.base === 'satellite');
  });

  /* ---------- 상태 ---------- */
  const S = {
    resources: [], current: null, detailOn: false, selected: null,
    visible: { VP: true, LE: true, BE: true, ETC: true },
    resMarkers: new Map(), boundaryLayer: null, featLayers: new Map(), featGroup: L.featureGroup().addTo(map),
    highlight: null
  };

  /* ---------- 자원 점 ---------- */
  function resIcon(r, active) {
    return L.divIcon({
      className: '', iconSize: null, iconAnchor: [9, 9],
      html: `<div class="res-pin${active ? ' active' : ''}"><span class="dot"></span><span class="lbl">${esc(r.name)}</span></div>`
    });
  }
  function drawResources() {
    S.resources.forEach(r => {
      const m = L.marker(r.latlng, { icon: resIcon(r), riseOnHover: true, keyboard: true, title: r.name })
        .on('click', () => selectResource(r)).addTo(map);
      S.resMarkers.set(r.uid, m);
    });
  }
  function refreshResMarkers() {
    S.resources.forEach(r => {
      const m = S.resMarkers.get(r.uid);
      const active = S.current === r;
      m.setIcon(resIcon(r, active));
      const el = m.getElement();
      if (el) el.style.opacity = S.current && !active ? 0.55 : 1;
      // 세부 조사결과를 보는 중에는 해당 자원 점을 숨겨서 요소를 가리지 않게
      if (active && S.detailOn) map.removeLayer(m); else if (!map.hasLayer(m)) m.addTo(map);
    });
  }

  /* ---------- 경계 ---------- */
  function showBoundary(r) {
    if (S.boundaryLayer) { map.removeLayer(S.boundaryLayer); S.boundaryLayer = null; }
    if (!r || !r.boundary) return;
    S.boundaryLayer = L.geoJSON(r.boundary, {
      pane: 'boundary',
      style: { color: C.resourceColor, weight: 3, fillColor: C.resourceColor, fillOpacity: 0.08, dashArray: '6 4' }
    }).addTo(map);
  }

  /* ---------- 세부 요소 ---------- */
  function featStyle(f, hi) {
    const col = C.classes[f.cls].color;
    const t = f.geometry.type;
    if (/Line/.test(t)) return { color: col, weight: hi ? 7 : 4, opacity: 0.95 };
    return { color: col, weight: hi ? 4 : 2, fillColor: col, fillOpacity: hi ? 0.45 : 0.25 };
  }
  function pointLayer(f, latlng) {
    if (f.cls === 'VP') {
      const num = String(f.name).replace(/^#/, '');
      return L.marker(latlng, {
        icon: L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="vp-pin" title="${esc(f.name)}">${esc(num.length <= 3 ? num : '●')}</div>` })
      });
    }
    return L.marker(latlng, {
      icon: L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9], html: `<div class="el-pin" style="--c:${C.classes[f.cls].color}"></div>` })
    });
  }
  function buildFeatureLayer(f) {
    const lyr = L.geoJSON({ type: 'Feature', geometry: f.geometry, properties: {} }, {
      style: () => featStyle(f), pointToLayer: (_, ll) => pointLayer(f, ll)
    });
    lyr.bindTooltip(esc(f.name), { sticky: !/Point/.test(f.geometry.type), direction: 'top', offset: [0, -8] });
    lyr.on('click', e => { L.DomEvent.stopPropagation(e); selectFeature(f); });
    return lyr;
  }
  function showDetails(r, on) {
    S.featGroup.clearLayers(); S.featLayers.clear();
    S.detailOn = !!on;
    if (on) {
      // 면 → 선 → 점 순서로 그려서 점이 위에 오도록
      const rank = f => /Polygon/.test(f.geometry.type) ? 0 : /Line/.test(f.geometry.type) ? 1 : 2;
      [...r.features].sort((a, b) => rank(a) - rank(b)).forEach(f => {
        const l = buildFeatureLayer(f); S.featLayers.set(f.uid, l);
        if (S.visible[f.cls]) S.featGroup.addLayer(l);
      });
    }
    $('#legend').hidden = !on;
    renderLegend(r);
    refreshResMarkers();
  }
  function applyVisibility() {
    if (!S.current) return;
    S.current.features.forEach(f => {
      const l = S.featLayers.get(f.uid); if (!l) return;
      if (S.visible[f.cls]) S.featGroup.addLayer(l); else S.featGroup.removeLayer(l);
    });
  }
  function setHighlight(f) {
    if (S.highlight) {
      const { f: pf, l } = S.highlight;
      if (!/Point/.test(pf.geometry.type)) l.setStyle(featStyle(pf));
      l.eachLayer(x => x.getElement && x.getElement() && x.getElement().classList.remove('hi'));
    }
    S.highlight = null;
    if (!f) return;
    const l = S.featLayers.get(f.uid); if (!l) return;
    if (!/Point/.test(f.geometry.type)) { l.setStyle(featStyle(f, true)); l.bringToFront(); }
    l.eachLayer(x => { const el = x.getElement && x.getElement(); if (el && el.firstChild) el.classList.add('hi'); });
    S.highlight = { f, l };
  }

  /* ---------- 범례 ---------- */
  function renderLegend(r) {
    if (!r) { $('#legendItems').innerHTML = ''; return; }
    const counts = {}; r.features.forEach(f => counts[f.cls] = (counts[f.cls] || 0) + 1);
    $('#legendItems').innerHTML = CLS_ORDER.filter(k => counts[k]).map(k => `
      <label class="lg-row"><input type="checkbox" data-cls="${k}" ${S.visible[k] ? 'checked' : ''}>
        <span class="sw sw-${k}" style="--c:${C.classes[k].color}"></span>${C.classes[k].label}<em>${counts[k]}</em></label>`).join('')
      + `<div class="lg-row lg-static"><span class="sw sw-bd" style="--c:${C.resourceColor}"></span>자원 경계</div>`;
    $('#legendItems').querySelectorAll('input').forEach(i => i.onchange = () => { S.visible[i.dataset.cls] = i.checked; applyVisibility(); });
  }

  /* ---------- 사진 갤러리 ---------- */
  function galleryHTML(photos) {
    if (!photos.length) return `<div class="gallery empty"><span>등록된 사진이 없습니다</span></div>`;
    return `<div class="gallery" data-i="0">
      <img class="g-img" alt="">
      <div class="g-fail" hidden>사진을 불러올 수 없습니다<br><small>드라이브 공유 설정(링크가 있는 모든 사용자)을 확인해 주세요</small></div>
      ${photos.length > 1 ? `<button class="g-nav prev" aria-label="이전 사진">‹</button><button class="g-nav next" aria-label="다음 사진">›</button><span class="g-count"></span>` : ''}
      <a class="g-orig" target="_blank" rel="noopener">원본</a>
    </div>`;
  }
  function wireGallery(root, photos) {
    const g = root.querySelector('.gallery'); if (!g || !photos.length) return;
    const img = g.querySelector('.g-img'), fail = g.querySelector('.g-fail'), cnt = g.querySelector('.g-count'), orig = g.querySelector('.g-orig');
    let i = 0;
    const show = () => {
      fail.hidden = true; img.hidden = false; g.classList.add('loading');
      img.onload = () => g.classList.remove('loading');
      PHOTOS.setImg(img, photos[i], 1000, () => { img.hidden = true; fail.hidden = false; g.classList.remove('loading'); });
      if (cnt) cnt.textContent = `${i + 1} / ${photos.length}`;
      orig.href = PHOTOS.resolve(photos[i], 1000).original;
    };
    g.querySelectorAll('.g-nav').forEach(b => b.onclick = e => {
      e.stopPropagation(); i = (i + (b.classList.contains('next') ? 1 : -1) + photos.length) % photos.length; show();
    });
    img.onclick = () => openLightbox(photos, i);
    show();
  }

  /* ---------- 라이트박스 ---------- */
  const LB = { photos: [], i: 0 };
  function lbShow() {
    PHOTOS.setImg($('#lbImg'), LB.photos[LB.i], 2000);
    $('#lbCount').textContent = LB.photos.length > 1 ? `${LB.i + 1} / ${LB.photos.length}` : '';
    $('#lbPrev').hidden = $('#lbNext').hidden = LB.photos.length < 2;
  }
  function openLightbox(photos, i) { LB.photos = photos; LB.i = i; $('#lightbox').hidden = false; lbShow(); }
  $('#lbClose').onclick = () => $('#lightbox').hidden = true;
  $('#lightbox').onclick = e => { if (e.target.id === 'lightbox') $('#lightbox').hidden = true; };
  $('#lbPrev').onclick = () => { LB.i = (LB.i - 1 + LB.photos.length) % LB.photos.length; lbShow(); };
  $('#lbNext').onclick = () => { LB.i = (LB.i + 1) % LB.photos.length; lbShow(); };
  document.addEventListener('keydown', e => {
    if ($('#lightbox').hidden) return;
    if (e.key === 'Escape') $('#lightbox').hidden = true;
    if (e.key === 'ArrowLeft') $('#lbPrev').click();
    if (e.key === 'ArrowRight') $('#lbNext').click();
  });

  /* ---------- 패널 ---------- */
  const body = $('#panelBody');
  const desc = t => t ? `<p class="desc">${esc(t).replace(/\n/g, '<br>')}</p>` : `<p class="desc muted">등록된 설명이 없습니다.</p>`;
  function setPanel(html) { body.innerHTML = html; body.scrollTop = 0; document.body.classList.remove('panel-collapsed'); }

  function renderOverview() {
    setPanel(`
      <div class="p-head"><h1>${esc(C.title)}</h1><p class="muted">${esc(C.intro)}</p></div>
      <h3 class="sec">경관자원 <em>${S.resources.length}</em></h3>
      <ul class="res-list">${S.resources.map(r => `
        <li><button data-uid="${r.uid}">
          <span class="rl-thumb">${PHOTOS.list(r.content && r.content.photos).length ? '<img alt="">' : ''}</span>
          <span class="rl-txt"><b>${esc(r.name)}</b><small>${esc(r.code)}${r.features.length ? ` · 세부자료 ${r.features.length}건` : ''}</small></span>
        </button></li>`).join('')}</ul>`);
    body.querySelectorAll('.res-list button').forEach(b => {
      const r = S.resources.find(x => x.uid === b.dataset.uid);
      const img = b.querySelector('img');
      if (img) PHOTOS.setImg(img, PHOTOS.list(r.content.photos)[0], 200, () => img.remove());
      b.onclick = () => selectResource(r);
    });
  }

  function renderResource(r) {
    const c = r.content || {};
    const photos = PHOTOS.list(c.photos);
    const groups = CLS_ORDER.map(k => [k, r.features.filter(f => f.cls === k)]).filter(([, a]) => a.length);
    setPanel(`
      <button class="back" id="backAll">← 전체보기</button>
      ${galleryHTML(photos)}
      <div class="p-head"><span class="badge" style="--c:${C.resourceColor}">경관자원</span><span class="code">${esc(r.code)}</span>
        <h2>${esc(r.name)}</h2></div>
      ${desc(c.description)}
      ${r.features.length
        ? `<button class="primary" id="toggleDetail">${S.detailOn ? '세부 조사결과 숨기기' : `세부 조사결과 보기 <small>${r.features.length}건</small>`}</button>`
        : `<div class="note">아직 등록된 세부 조사결과(조망점·구성요소·배경요소)가 없습니다.</div>`}
      ${S.detailOn ? groups.map(([k, arr]) => `
        <h3 class="sec"><span class="sw sw-${k}" style="--c:${C.classes[k].color}"></span>${C.classes[k].label} <em>${arr.length}</em></h3>
        <ul class="feat-list">${arr.map(f => `<li><button data-uid="${f.uid}"><span>${esc(f.name)}</span><small>${esc(f.code)}</small></button></li>`).join('')}</ul>`).join('') : ''}
    `);
    wireGallery(body, photos);
    $('#backAll').onclick = goHome;
    const t = $('#toggleDetail');
    if (t) t.onclick = () => {
      showDetails(r, !S.detailOn);
      renderResource(r);
      if (S.detailOn) fitTo(r, true);
    };
    body.querySelectorAll('.feat-list button').forEach(b => b.onclick = () => selectFeature(r.features.find(f => f.uid === b.dataset.uid), true));
  }

  function renderFeature(f) {
    const c = f.content || {};
    const photos = PHOTOS.list(c.photos);
    const cls = C.classes[f.cls];
    const geomLabel = /Point/.test(f.geometry.type) ? '점' : /Line/.test(f.geometry.type) ? '선' : '면';
    setPanel(`
      <button class="back" id="backRes">← ${esc(f.resource.name)}</button>
      ${galleryHTML(photos)}
      <div class="p-head"><span class="badge" style="--c:${cls.color}">${cls.label}${f.cls !== 'VP' ? ` · ${geomLabel}` : ''}</span><span class="code">${esc(f.code)}</span>
        <h2>${esc(f.cls === 'VP' ? `조망점 ${f.name}` : f.name)}</h2></div>
      ${desc(c.description)}
    `);
    wireGallery(body, photos);
    $('#backRes').onclick = () => { S.selected = null; setHighlight(null); renderResource(f.resource); };
  }

  /* ---------- 동작 ---------- */
  function fitTo(r, withFeatures) {
    const b = L.latLngBounds([r.latlng]);
    if (S.boundaryLayer) b.extend(S.boundaryLayer.getBounds());
    if (withFeatures && S.featGroup.getLayers().length) b.extend(S.featGroup.getBounds());
    map.flyToBounds(b, { padding: [40, 40], maxZoom: 17, duration: 0.6, paddingBottomRight: panelPad() });
  }
  function panelPad() {
    const p = $('#panel');
    return window.innerWidth > 760 ? [p.offsetWidth + 20, 20] : [20, Math.min(p.offsetHeight, window.innerHeight * 0.5) + 20];
  }

  function selectResource(r, opts = {}) {
    const changed = S.current !== r;
    if (changed) { S.detailOn = false; S.current = r; showBoundary(r); showDetails(r, false); }
    S.selected = null; setHighlight(null);
    if (opts.detail && !S.detailOn) showDetails(r, true);
    refreshResMarkers();
    renderResource(r);
    if (changed || opts.detail) fitTo(r, S.detailOn);
  }

  function selectFeature(f, zoom) {
    if (S.current !== f.resource) selectResource(f.resource);
    if (!S.detailOn) { showDetails(f.resource, true); }
    if (!S.visible[f.cls]) { S.visible[f.cls] = true; applyVisibility(); renderLegend(f.resource); }
    S.selected = f; setHighlight(f); renderFeature(f);
    if (zoom) {
      const l = S.featLayers.get(f.uid);
      if (/Point/.test(f.geometry.type)) {
        const ll = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
        map.flyToBounds(L.latLngBounds(ll, ll), { padding: [60, 60], maxZoom: Math.max(map.getZoom(), 17), duration: 0.6, paddingBottomRight: panelPad() });
      } else map.flyToBounds(l.getBounds(), { padding: [60, 60], maxZoom: 18, duration: 0.6, paddingBottomRight: panelPad() });
    }
  }

  function goHome() {
    S.current = null; S.detailOn = false; S.selected = null; setHighlight(null);
    showBoundary(null); showDetails(null, false);
    refreshResMarkers(); renderOverview(); fitAll();
  }
  function fitAll() {
    if (!S.resources.length) return;
    map.fitBounds(L.latLngBounds(S.resources.map(r => r.latlng)), { padding: [60, 60], maxZoom: 13, paddingBottomRight: panelPad() });
  }
  $('#homeBtn').onclick = goHome;

  // 모바일: 패널 접기/펼치기
  $('#panelHandle').onclick = () => document.body.classList.toggle('panel-collapsed');
  // 범례 접기 (휴대폰은 접힌 상태로 시작)
  if (MOBILE) $('#legend').classList.add('collapsed');
  $('#legendToggle').onclick = () => $('#legend').classList.toggle('collapsed');

  /* ---------- 검색 ---------- */
  const input = $('#searchInput'), out = $('#searchResults');
  let index = [];
  function buildIndex() {
    index = [];
    S.resources.forEach(r => {
      index.push({ item: r, type: '경관자원', color: C.resourceColor, name: r.name, sub: r.code, text: [r.name, r.code, r.content && r.content.description].join(' ') });
      r.features.forEach(f => index.push({
        item: f, type: C.classes[f.cls].label, color: C.classes[f.cls].color,
        name: f.cls === 'VP' ? `조망점 ${f.name}` : f.name, sub: `${r.name} · ${f.code}`,
        text: [f.name, f.code, r.name, f.content && f.content.description].join(' ')
      }));
    });
  }
  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) { out.hidden = true; return; }
    const hits = index.filter(e => e.text.toLowerCase().includes(q))
      .sort((a, b) => (b.name.toLowerCase().includes(q) - a.name.toLowerCase().includes(q)));
    out.innerHTML = hits.length ? hits.slice(0, 30).map((h, i) => `
      <li><button data-i="${index.indexOf(h)}"><span class="badge sm" style="--c:${h.color}">${h.type}</span>
        <span class="sr-txt"><b>${esc(h.name)}</b><small>${esc(h.sub)}</small></span></button></li>`).join('')
      : `<li class="none">"${esc(q)}" 검색 결과가 없습니다</li>`;
    out.hidden = false;
    out.querySelectorAll('button').forEach(b => b.onclick = () => {
      const e = index[+b.dataset.i]; out.hidden = true; input.blur();
      if (e.item.kind === 'resource') selectResource(e.item); else selectFeature(e.item, true);
    });
  }
  input.addEventListener('input', () => search(input.value));
  input.addEventListener('focus', () => input.value && search(input.value));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const f = out.querySelector('button'); if (f) f.click(); }
    if (e.key === 'Escape') { out.hidden = true; input.blur(); }
  });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) out.hidden = true; });

  /* ---------- 시작 ---------- */
  setPanel('<div class="p-head"><p class="muted">자료를 불러오는 중…</p></div>');
  DATA.loadAll().then(({ resources }) => {
    S.resources = resources;
    drawResources(); buildIndex(); renderOverview(); fitAll();
  }).catch(err => {
    console.error(err);
    setPanel(`<div class="p-head"><h2>자료를 불러오지 못했습니다</h2><p class="muted">${esc(err.message)}</p>
      <p class="muted">파일을 더블클릭해서 열면 브라우저 보안 때문에 자료를 읽을 수 없습니다. GitHub Pages에 올리거나 로컬 서버로 열어 주세요.</p></div>`);
    map.setView([37.658, 126.832], 11);
  });
  window.__APP = { S, map, selectResource, selectFeature, goHome };
})();
