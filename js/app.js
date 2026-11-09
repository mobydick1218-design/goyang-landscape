/* 고양시 대표경관자원 지도 */
(function () {
  "use strict";
  var C = window.SITE_CONFIG;
  var KIND_LABEL = { VP: "조망점", LE: "구성요소", BE: "배경요소", etc: "기타" };
  var KIND_CLASS = { VP: "vp", LE: "le", BE: "be", etc: "etc" };

  var S = {
    map: null, ready: false, base: null,
    resources: {},          // code -> resource row (+ point)
    elements: {},           // "code|kind|name" -> row
    viewpoints: {},         // "code|no" -> row
    geo: {},                // code -> {fc, items, byId, bd, built}
    cur: null, detail: {}, sel: null,
    layers: { VP: true, LE: true, BE: true, etc: true, LABEL: true },
    resMarkers: {}, cityPoly: [], me: null, watchId: null, sheet: "mid"
  };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      if (k === "class") el.className = attrs[k];
      else if (k === "html") el.innerHTML = attrs[k];
      else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return el;
  }
  function isMobile() { return window.matchMedia("(max-width: 768px)").matches; }
  function toast(msg, ms) {
    var t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 3000);
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    var rows = [], row = [], f = "", q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = ""; rows.push(row); row = [];
      } else f += c;
    }
    if (f !== "" || row.length) { row.push(f); rows.push(row); }
    var head = rows.shift().map(function (s) { return s.trim(); });
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ""; }); }).map(function (r) {
      var o = {}; head.forEach(function (k, j) { o[k] = (r[j] || "").trim(); }); return o;
    });
  }
  function getJSON(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  function getCSV(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u); return r.text(); }).then(parseCSV); }

  /* ---------- photos ---------- */
  function photoURL(fn, code) {
    fn = fn.trim();
    if (/^https?:\/\//.test(fn)) {
      var m = fn.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=view&)?id=)([\w-]+)/);
      return m ? "https://lh3.googleusercontent.com/d/" + m[1] : fn;
    }
    return C.PHOTO_BASE + (fn.indexOf("/") >= 0 ? fn : code + "/" + fn);
  }
  function parsePhotos(str, code) {
    return (str || "").split(";").map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) {
      var p = s.split("|"); return { src: photoURL(p[0], code), cap: (p[1] || "").trim() };
    });
  }

  /* ---------- geometry helpers ---------- */
  function LL(c) { return new kakao.maps.LatLng(c[1], c[0]); }
  function ringCentroid(r) {
    var a = 0, x = 0, y = 0;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      var f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
      a += f; x += (r[j][0] + r[i][0]) * f; y += (r[j][1] + r[i][1]) * f;
    }
    if (Math.abs(a) < 1e-14) return r[0];
    return [x / (3 * a), y / (3 * a)];
  }
  function ringArea(r) { var a = 0; for (var i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return Math.abs(a / 2); }
  function labelPoint(g) {
    if (g.type === "Point") return g.coordinates;
    if (g.type === "MultiLineString") {
      var best = g.coordinates.reduce(function (a, b) { return b.length > a.length ? b : a; });
      return best[Math.floor(best.length / 2)];
    }
    var polys = g.coordinates, big = polys[0][0];
    polys.forEach(function (p) { if (ringArea(p[0]) > ringArea(big)) big = p[0]; });
    return ringCentroid(big);
  }
  function eachCoord(g, fn) {
    (function walk(c) { if (typeof c[0] === "number") fn(c); else c.forEach(walk); })(g.coordinates);
  }

  /* ---------- map basics ---------- */
  function panelPad() {
    // [top, right, bottom, left] padding for fitting bounds
    if (isMobile()) {
      var p = $("#panel"), vis = window.innerHeight - p.getBoundingClientRect().top;
      return [60, 60, Math.max(vis, 140) + 20, 30];
    }
    return [60, $("#legend").hidden ? 70 : 190, 40, 40];
  }
  function fitCoords(list) {
    if (!S.map || !list.length) return;
    var b = new kakao.maps.LatLngBounds();
    list.forEach(function (c) { b.extend(LL(c)); });
    var p = panelPad();
    S.map.setBounds(b, p[0], p[1], p[2], p[3]);
  }
  function focusItem(it) {
    if (!S.map) return;
    if (S.map.getLevel() > C.LABEL_LEVEL) S.map.setLevel(C.LABEL_LEVEL, { anchor: LL(it.label) });
    showInView(it.label);
  }
  function showInView(coord) {
    if (!S.map) return;
    var proj = S.map.getProjection(), el = $("#map");
    var pt = proj.containerPointFromCoords(LL(coord));
    var W = el.clientWidth, H = el.clientHeight;
    var bottom = H;
    if (isMobile()) bottom = $("#panel").getBoundingClientRect().top - el.getBoundingClientRect().top;
    var top = 60, left = 30, right = W - 70;
    if (pt.x > left && pt.x < right && pt.y > top && pt.y < bottom - 30) return;
    var cpt = proj.containerPointFromCoords(S.map.getCenter());
    var dx = pt.x - W / 2, dy = pt.y - (top + bottom) / 2;
    S.map.panTo(proj.coordsFromContainerPoint(new kakao.maps.Point(cpt.x + dx, cpt.y + dy)));
  }

  /* ---------- start ---------- */
  var dataReady = Promise.all([
    getJSON("data/geo/base.json"),
    getCSV("data/resources.csv"),
    getCSV("data/elements.csv"),
    getCSV("data/viewpoints.csv")
  ]).then(function (r) {
    S.base = r[0];
    r[1].forEach(function (row) { S.resources[row.code] = row; });
    r[0].resources.features.forEach(function (f) {
      var p = f.properties, row = S.resources[p.code];
      if (row) { row.coord = f.geometry.coordinates; row.lrNum = parseInt((p.lr || "").replace(/\D/g, ""), 10) || ""; }
    });
    r[2].forEach(function (row) { S.elements[row.resource + "|" + row.kind + "|" + row.name] = row; });
    r[3].forEach(function (row) { S.viewpoints[row.resource + "|" + parseInt(row.no, 10)] = row; });
  });

  function readyCodes() {
    return C.READY.filter(function (c) { return S.resources[c] && S.resources[c].coord; })
      .sort(function (a, b) { return (S.resources[a].lrNum || 99) - (S.resources[b].lrNum || 99); });
  }

  function start() {
    var el = $("#map");
    S.map = new kakao.maps.Map(el, { center: new kakao.maps.LatLng(37.658, 126.832), level: 9 });
    kakao.maps.event.addListener(S.map, "zoom_changed", updateLabels);
    // 지도 영역 크기가 바뀌면(화면 회전, 숨김 탭에서 표시 등) 다시 맞춤
    var lastW = el.clientWidth, lastH = el.clientHeight;
    if (window.ResizeObserver) new ResizeObserver(function () {
      var w = el.clientWidth, hh = el.clientHeight;
      if (!w || !hh || (w === lastW && hh === lastH)) return;
      var wasEmpty = !lastW || !lastH; lastW = w; lastH = hh;
      S.map.relayout();
      if (wasEmpty && S.ready) { S.fitKey = null; route(true); }
    }).observe(el);
    dataReady.then(function () {
      drawCity(); drawResourceMarkers();
      S.ready = true; route(true);
    }).catch(dataFailed);
  }
  function mapFailed() {
    var box = h("div", { class: "map-error" }, [h("div", null, [
      h("b", null, ["지도를 불러오지 못했습니다"]),
      h("span", { html: "카카오맵 JavaScript 키에 이 사이트 주소가 등록되어 있는지 확인해 주세요.<br>(Kakao Developers → 앱 → 플랫폼 키 → JavaScript SDK 도메인)<br><br>" + location.origin }, [])
    ])]);
    $("#mapWrap").appendChild(box);
    dataReady.then(function () { S.ready = true; route(true); }).catch(dataFailed);
  }
  function dataFailed(e) {
    console.error(e);
    $("#panelBody").innerHTML = '<div class="view"><p class="lead">데이터를 불러오지 못했습니다.</p><p class="muted">내 컴퓨터에서 index.html을 바로 열면 보안 정책 때문에 데이터를 읽을 수 없습니다. GitHub Pages에 올리거나, 폴더에서 <b>python -m http.server 8000</b>을 실행한 뒤 http://localhost:8000 으로 열어 주세요.</p></div>';
  }

  /* ---------- base layers ---------- */
  function drawCity() {
    S.base.boundary.features.forEach(function (f) {
      var g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
      polys.forEach(function (rings) {
        S.cityPoly.push(new kakao.maps.Polygon({
          map: S.map, path: rings.map(function (r) { return r.map(LL); }),
          strokeWeight: 2.5, strokeColor: C.COLORS.CITY, strokeOpacity: .55, strokeStyle: "solid",
          fillColor: "#ffffff", fillOpacity: 0, zIndex: 1
        }));
      });
    });
  }
  function drawResourceMarkers() {
    readyCodes().forEach(function (code) {
      var r = S.resources[code];
      var el = h("div", { class: "m-res", title: r.name }, [h("span", { class: "pin" }, [String(r.lrNum)]), h("span", { class: "nm" }, [r.name])]);
      el.addEventListener("click", function () { go(code); });
      var ov = new kakao.maps.CustomOverlay({ position: LL(r.coord), content: el, xAnchor: 0, yAnchor: 0.5, zIndex: 30, clickable: true });
      ov.setMap(S.map);
      S.resMarkers[code] = { ov: ov, el: el };
    });
  }
  function homeView() {
    var all = [];
    S.base.boundary.features.forEach(function (f) { eachCoord(f.geometry, function (c) { all.push(c); }); });
    fitCoords(all);
  }

  /* ---------- resource geo ---------- */
  function loadGeo(code) {
    if (S.geo[code]) return Promise.resolve(S.geo[code]);
    return getJSON("data/geo/" + code + ".json").then(function (fc) {
      var G = { fc: fc, items: [], byId: {}, bd: [], built: false };
      fc.features.forEach(function (f) {
        var p = f.properties;
        if (p.kind === "BD") { G.bd.push(f); return; }
        var info = p.kind === "VP" ? S.viewpoints[code + "|" + p.no] : S.elements[code + "|" + p.kind + "|" + p.name];
        var it = { id: p.id, kind: p.kind, name: p.name, no: p.no, g: f.geometry, info: info || {}, code: code, label: labelPoint(f.geometry), objs: [] };
        G.items.push(it); G.byId[it.id] = it;
      });
      S.geo[code] = G; return G;
    });
  }
  function buildGeo(code) {
    var G = S.geo[code]; if (G.built || !S.map) return; G.built = true;
    var col = C.COLORS;
    G.bdObjs = [];
    G.bd.forEach(function (f) {
      if (f.geometry.type === "MultiLineString") { // 선형 자원(중앙로 등)은 선으로
        f.geometry.coordinates.forEach(function (line) {
          G.bdObjs.push(new kakao.maps.Polyline({ path: line.map(LL), strokeWeight: 6, strokeColor: col.BD, strokeOpacity: .85, strokeStyle: "solid", zIndex: 2 }));
        });
        return;
      }
      var polys = f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
      polys.forEach(function (rings) {
        G.bdObjs.push(new kakao.maps.Polygon({ path: rings.map(function (r) { return r.map(LL); }), strokeWeight: 3, strokeColor: col.BD, strokeOpacity: .9, strokeStyle: "shortdash", fillColor: col.BD, fillOpacity: .06, zIndex: 2 }));
      });
    });
    var order = { A: 0, L: 1, P: 2 };
    G.items.slice().sort(function (a, b) { return (order[geomCode(a)] || 0) - (order[geomCode(b)] || 0); }).forEach(function (it) {
      var c = col[it.kind] || col.etc, click = function () { go(code, it.id); };
      if (it.g.type === "MultiPolygon") {
        it.g.coordinates.forEach(function (rings) {
          var pg = new kakao.maps.Polygon({ path: rings.map(function (r) { return r.map(LL); }), strokeWeight: 1.5, strokeColor: c, strokeOpacity: .9, fillColor: c, fillOpacity: it.kind === "BE" ? .18 : .22, zIndex: 3 });
          kakao.maps.event.addListener(pg, "click", click);
          it.objs.push(pg);
        });
        it.style = "poly";
      } else if (it.g.type === "MultiLineString") {
        it.g.coordinates.forEach(function (line) {
          var pl = new kakao.maps.Polyline({ path: line.map(LL), strokeWeight: 5, strokeColor: c, strokeOpacity: .85, zIndex: 4 });
          kakao.maps.event.addListener(pl, "click", click);
          it.objs.push(pl);
        });
        it.style = "line";
      } else {
        var el;
        if (it.kind === "VP") {
          el = h("div", { class: "m-vp", title: "조망점 " + it.no + " " + it.name, html: vpSVG(it) });
        } else {
          el = h("div", { class: "m-pt " + KIND_CLASS[it.kind], title: it.name }, [h("span", { class: "s" })]);
        }
        el.addEventListener("click", function (e) { e.stopPropagation(); click(); });
        it.marker = el;
        it.objs.push(new kakao.maps.CustomOverlay({ position: LL(it.g.coordinates), content: el, xAnchor: 0.5, yAnchor: 0.5, zIndex: it.kind === "VP" ? 25 : 20, clickable: true }));
        it.style = "point";
      }
      it.labEl = h("div", { class: "m-label " + KIND_CLASS[it.kind] + (it.style === "poly" ? " area" : "") }, [it.name]);
      it.labOv = new kakao.maps.CustomOverlay({ position: LL(it.label), content: it.labEl, xAnchor: 0, yAnchor: 0, zIndex: it.kind === "VP" ? 24 : 15 });
    });
  }
  /* 조망점 마커: 번호 원 + 시야 부채꼴 (angle: 북쪽 0°, 시계방향 / 비어 있으면 사방 조망 → 원만) */
  function vpAngle(it) {
    var s = String(it.info.angle == null ? "" : it.info.angle).trim();
    return s === "" || isNaN(parseFloat(s)) ? null : parseFloat(s);
  }
  function vpSVG(it) {
    var a = vpAngle(it), dir = "";
    if (a !== null) {
      dir = '<path class="cone" transform="rotate(' + a + ')" d="M0 0 L-17 -29.4 A34 34 0 0 1 17 -29.4 Z"/>';
    }
    return '<svg viewBox="-40 -40 80 80" width="80" height="80" aria-hidden="true">' + dir +
      '<circle class="c" r="9.5"/><text y="3.8" text-anchor="middle">' + it.no + "</text></svg>";
  }
  function geomCode(it) { return it.g.type === "MultiPolygon" ? "A" : it.g.type === "MultiLineString" ? "L" : "P"; }

  function setResourceVisible(code, on) {
    var G = S.geo[code]; if (!G || !G.built) return;
    G.bdObjs.forEach(function (o) { o.setMap(on ? S.map : null); });
    var det = on && S.detail[code];
    G.items.forEach(function (it) {
      var vis = det && S.layers[it.kind];
      it.objs.forEach(function (o) { o.setMap(vis ? S.map : null); });
      it.visible = vis;
    });
    updateLabels();
  }
  function updateLabels() {
    if (!S.map) return;
    var lv = S.map.getLevel();
    Object.keys(S.geo).forEach(function (code) {
      var G = S.geo[code]; if (!G.built) return;
      G.items.forEach(function (it) {
        var isSel = S.sel === it;
        var show = it.visible && (isSel || (S.layers.LABEL && lv <= (it.kind === "VP" ? C.LABEL_LEVEL + 1 : C.LABEL_LEVEL)));
        it.labOv.setMap(show ? S.map : null);
        it.labEl.classList.toggle("sel", isSel);
      });
    });
    $("#map").classList.toggle("far", lv >= 9); // 멀리서 볼 때는 자원 이름 숨기고 번호만
    var anyDetail = S.cur && S.detail[S.cur];
    Object.keys(S.resMarkers).forEach(function (code) {
      var m = S.resMarkers[code];
      m.ov.setMap(anyDetail && code === S.cur ? null : S.map);
      m.el.classList.toggle("sel", code === S.cur);
      m.el.classList.toggle("dim", !!S.cur && code !== S.cur);
    });
  }
  function highlight(it) {
    var prev = S.sel;
    if (prev) styleItem(prev, false);
    S.sel = it || null;
    if (it) styleItem(it, true);
    updateLabels();
  }
  function styleItem(it, on) {
    var c = C.COLORS[it.kind] || C.COLORS.etc;
    if (it.marker) it.marker.classList.toggle("sel", on);
    it.objs.forEach(function (o) {
      if (o instanceof kakao.maps.Polygon) o.setOptions({ strokeWeight: on ? 3.5 : 1.5, strokeColor: on ? "#f2a900" : c, fillOpacity: on ? .45 : (it.kind === "BE" ? .18 : .22) });
      else if (o instanceof kakao.maps.Polyline) o.setOptions({ strokeWeight: on ? 8 : 5, strokeColor: on ? "#f2a900" : c });
    });
  }

  /* ---------- routing ---------- */
  function go(code, fid, opts) {
    var hsh = "#/" + (code || "") + (fid ? "/" + encodeURIComponent(fid) : "") + (opts && opts.detail ? "/d" : "");
    if (location.hash === hsh) route(); else location.hash = hsh;
  }
  window.addEventListener("hashchange", function () { route(); });

  function route(initial) {
    if (!S.ready) return;
    var parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
    var code = parts[0], fid = parts[1] && parts[1] !== "d" ? parts[1] : null, wantDetail = parts.indexOf("d") >= 0;
    if (!code || !S.resources[code] || C.READY.indexOf(code) < 0) {
      var prevCode = S.cur;
      S.cur = null; S.fitKey = null; highlight(null);
      if (prevCode) setResourceVisible(prevCode, false);
      renderHome(); updateLabels();
      if (S.map) homeView();
      return;
    }
    loadGeo(code).then(function (G) {
      var changed = S.cur !== code;
      if (changed && S.cur) setResourceVisible(S.cur, false);
      S.cur = code;
      buildGeo(code);
      if ((fid || wantDetail) && G.items.length) S.detail[code] = true;
      else S.detail[code] = false;
      var fitKey = code + (S.detail[code] ? "d" : ""), refit = S.fitKey !== fitKey;
      S.fitKey = fitKey;
      setResourceVisible(code, true);
      var it = fid ? G.byId[fid] : null;
      highlight(it);
      if (it) {
        renderFeature(code, it);
        if (S.zoomNext || initial) { S.zoomNext = false; focusItem(it); }
        else showInView(it.label);
      } else {
        renderResource(code);
        if (initial || refit) fitResource(code, S.detail[code]);
      }
    });
  }
  function fitResource(code, detail) {
    var G = S.geo[code], list = [];
    G.bd.forEach(function (f) { eachCoord(f.geometry, function (c) { list.push(c); }); });
    if (detail) G.items.forEach(function (it) { if (it.kind === "VP" || S.layers[it.kind]) list.push(it.label); });
    if (!list.length) list.push(S.resources[code].coord);
    fitCoords(list);
  }

  /* ---------- panel views ---------- */
  function setBody(view) {
    if (S.pano) { try { S.pano.destroy(); } catch (e) {} S.pano = null; }
    var b = $("#panelBody"); b.innerHTML = ""; b.appendChild(view); b.scrollTop = 0;
  }
  function gallery(photos) {
    if (!photos.length) return h("div", { class: "noimg-box" }, ["등록된 사진이 없습니다"]);
    var i = 0, wrap = h("div"), g = h("figure", { class: "gallery" }), img = h("img", { class: "main", alt: "" }),
      cap = h("figcaption"), cnt = h("span", { class: "count" }), thumbs = h("div", { class: "thumbs" });
    function show(n) {
      i = (n + photos.length) % photos.length;
      img.src = photos[i].src; img.alt = photos[i].cap || "사진";
      cap.textContent = photos[i].cap || ""; cap.style.display = photos[i].cap ? "" : "none";
      cnt.textContent = (i + 1) + " / " + photos.length;
      $$("img", thumbs).forEach(function (t, k) { t.classList.toggle("on", k === i); });
    }
    img.addEventListener("load", function () { img.classList.toggle("pano", img.naturalWidth / img.naturalHeight > 2.2); });
    img.addEventListener("click", function () { lightbox(photos, i); });
    g.appendChild(img);
    if (photos.length > 1) {
      g.appendChild(cnt);
      g.appendChild(h("button", { class: "g-nav prev", "aria-label": "이전 사진", onclick: function () { show(i - 1); } }, ["‹"]));
      g.appendChild(h("button", { class: "g-nav next", "aria-label": "다음 사진", onclick: function () { show(i + 1); } }, ["›"]));
      photos.forEach(function (p, k) { thumbs.appendChild(h("img", { src: p.src, alt: "", loading: "lazy", onclick: function () { show(k); } })); });
    }
    g.appendChild(cap); wrap.appendChild(g);
    if (photos.length > 1) wrap.appendChild(thumbs);
    show(0);
    return wrap;
  }

  function renderHome() {
    var v = h("div", { class: "view" });
    v.appendChild(h("div", null, [
      h("div", { class: "eyebrow" }, ["고양시 경관계획 재정비 수립 용역"]),
      h("h1", { class: "title" }, ["대표경관자원 조사결과"])
    ]));
    v.appendChild(h("p", { class: "lead" }, ["일반경관자원 조사 후 현장평가 점수와 설문조사 응답을 고려해 선정한 고양시 대표경관자원의 구성요소, 배경요소, 조망점을 지도로 살펴볼 수 있습니다."]));
    v.appendChild(h("p", { class: "muted" }, ["지도의 자원 점이나 아래 목록을 누르면 자원 소개와 경계가 나타나고, ‘세부 조사결과 보기’를 누르면 조망점과 요소가 지도에 표시됩니다."]));
    var cards = h("div", { class: "cards" });
    readyCodes().forEach(function (code) {
      var r = S.resources[code], ph = parsePhotos(r.rep_photo, code)[0];
      cards.appendChild(h("button", { class: "card", onclick: function () { go(code); } }, [
        ph ? h("img", { src: ph.src, alt: "", loading: "lazy" }) : h("span", { class: "noimg" }),
        h("span", null, [h("b", null, [h("span", { class: "num" }, [String(r.lrNum)]), r.name]), h("span", { class: "muted" }, [r.category + (r.address ? " · " + r.address : "")])])
      ]));
    });
    v.appendChild(h("h2", { class: "sec" }, ["대표경관자원"]));
    v.appendChild(cards);
    setBody(h("div", null, [v, h("div", { class: "foot" }, ["고양시 경관계획 재정비 수립 용역 · 대표경관자원 자료집"])]));
    setSheet("mid");
  }

  function renderResource(code) {
    var r = S.resources[code], G = S.geo[code], det = !!S.detail[code];
    var v = h("div", { class: "view" });
    v.appendChild(h("button", { class: "back", onclick: function () { go(); } }, ["‹ 전체 자원"]));
    var rep = parsePhotos(r.rep_photo, code)[0];
    if (rep) {
      v.appendChild(h("figure", { class: "gallery" }, [h("img", { class: "main", src: rep.src, alt: r.name + " 대표사진",
        onclick: function () { lightbox([{ src: rep.src, cap: rep.cap || r.name }], 0); } })]));
    }
    v.appendChild(h("div", null, [
      h("div", { class: "badges" }, [h("span", { class: "badge" }, ["대표경관자원 " + r.lrNum]), h("span", { class: "badge le" }, [r.category])]),
      h("h1", { class: "title" }, [r.name])
    ]));
    v.appendChild(h("p", { class: "lead" }, [r.intro]));
    var facts = [];
    if (r.address) facts.push(h("dt", null, ["위치"]), h("dd", null, [r.address]));
    if (r.score) facts.push(h("dt", null, ["가치판단"]), h("dd", null, [r.score + "점 / 20점"]));
    if (facts.length) v.appendChild(h("dl", { class: "facts" }, facts));
    if (G.items.length) {
      v.appendChild(h("button", { class: "btn-primary" + (det ? " on" : ""), onclick: function () {
        if (det) go(code); else go(code, null, { detail: true });
      } }, [det ? "세부 조사결과 숨기기" : "세부 조사결과 보기"]));
    }

    if (det) {
      var vps = G.items.filter(function (it) { return it.kind === "VP"; }).sort(function (a, b) { return a.no - b.no; });
      v.appendChild(h("h2", { class: "sec" }, ["조망점 (" + vps.length + ")"]));
      v.appendChild(itemList(code, vps));
      ["LE", "BE", "etc"].forEach(function (k) {
        var list = uniqueByName(G.items.filter(function (it) { return it.kind === k; }));
        if (!list.length) return;
        v.appendChild(h("h2", { class: "sec" }, [KIND_LABEL[k] + " (" + list.length + ")"]));
        v.appendChild(itemList(code, list, true));
      });
    }
    if (r.overview) {
      v.appendChild(h("h2", { class: "sec" }, ["주요 경관 현황"]));
      v.appendChild(h("ul", { class: "bul" }, r.overview.split("\n").map(function (s) { return h("li", null, [s]); })));
    }
    if (r.zones) {
      v.appendChild(h("h2", { class: "sec" }, ["구역별 특성"]));
      r.zones.split("\n").forEach(function (z) {
        var p = z.split("|"); v.appendChild(h("details", { class: "fold" }, [h("summary", null, [p[0]]), h("p", null, [p[1] || ""])]));
      });
    }
    if (r.management) {
      v.appendChild(h("h2", { class: "sec" }, ["관리 방향"]));
      r.management.split("\n").forEach(function (z, k) {
        var p = z.split("|"); v.appendChild(h("details", { class: "fold" }, [h("summary", null, [(k + 1) + ") " + p[0]]), h("p", null, [p[1] || ""])]));
      });
      var mp = parsePhotos(r.mgmt_photos, code);
      if (mp.length) { var d = h("div"); d.style.marginTop = "10px"; d.appendChild(gallery(mp)); v.appendChild(d); }
    }
    if (r.extra) {
      v.appendChild(h("h2", { class: "sec" }, [r.extra_title || "기타"]));
      v.appendChild(h("ul", { class: "bul" }, r.extra.split("\n").map(function (s) { return h("li", null, [s]); })));
    }
    setBody(v);
    setSheet(isMobile() && det ? "mid" : "mid");
  }
  function uniqueByName(list) {
    var seen = {}, out = [];
    list.forEach(function (it) { if (!seen[it.name]) { seen[it.name] = 1; out.push(it); } });
    return out;
  }
  function itemList(code, list, grouped) {
    var ul = h("ul", { class: "list" }), lastG = null;
    list.forEach(function (it) {
      var grp = grouped ? (it.info.group || "") : "";
      if (grouped && grp && grp !== lastG && grp.indexOf(" / ") < 0) { ul.appendChild(h("li", { class: "grp" }, [grp])); lastG = grp; }
      var icon = it.kind === "VP" ? h("span", { class: "vpnum" }, [String(it.no)]) : h("span", { class: "dot " + KIND_CLASS[it.kind] });
      var sub = it.kind === "VP" ? (it.info.pano ? "360° · " : "") + (it.info.direction ? "⇒ " + it.info.direction : "") : (parsePhotos(it.info.photos, code).length ? "사진 " + parsePhotos(it.info.photos, code).length : "");
      ul.appendChild(h("li", null, [h("button", { onclick: function () { S.zoomNext = true; go(code, it.id); } }, [icon, h("span", null, [it.name]), h("span", { class: "sub" }, [sub])])]));
    });
    return ul;
  }

  function renderFeature(code, it) {
    var r = S.resources[code], info = it.info || {};
    var v = h("div", { class: "view" });
    v.appendChild(h("button", { class: "back", onclick: function () { go(code, null, { detail: true }); } }, ["‹ " + r.name]));
    var pano = parsePhotos(info.pano, code)[0], photos = parsePhotos(info.photos, code);
    if (pano) v.appendChild(panoBox(pano));
    if (photos.length || !pano) v.appendChild(gallery(photos));
    var badges = [h("span", { class: "badge " + KIND_CLASS[it.kind] }, [it.kind === "VP" ? "조망점 #" + it.no : KIND_LABEL[it.kind]])];
    if (info.group && it.kind !== "VP") badges.push(h("span", { class: "badge" }, [info.group]));
    v.appendChild(h("div", null, [h("div", { class: "badges" }, badges), h("h1", { class: "title" }, [it.name])]));
    if (it.kind === "VP" && info.direction) {
      var ang = vpAngle(it), comp = ang === null ? "" : " (" + compass(ang) + ", " + Math.round(ang) + "°)";
      v.appendChild(h("p", { class: "muted" }, [info.direction === "사방" ? "조망 방향: 사방 조망" : "조망 방향: " + it.name + " ⇒ " + info.direction + comp]));
    }
    if (info.description) v.appendChild(h("p", { class: "desc" }, [info.description]));
    else if (it.kind !== "etc") v.appendChild(h("p", { class: "empty" }, ["등록된 설명이 없습니다."]));

    if (it.kind === "VP") {
      var lat = it.g.coordinates[1].toFixed(5), lng = it.g.coordinates[0].toFixed(5);
      var copyBtn = h("button", { onclick: function () {
        var txt = lat + ", " + lng;
        (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("좌표를 복사했습니다"); }, function () { toast(txt); });
      } }, ["복사"]);
      v.appendChild(h("h2", { class: "sec" }, ["위치"]));
      v.appendChild(h("div", { class: "coord" }, [h("span", null, ["위도 " + lat + ", 경도 " + lng]), copyBtn]));
      var nm = encodeURIComponent(r.name + " 조망점" + it.no + " " + it.name);
      v.appendChild(h("div", { class: "btn-row" }, [
        newWinLink("https://map.kakao.com/link/to/" + nm + "," + lat + "," + lng, "카카오맵 길찾기"),
        newWinLink("https://map.kakao.com/link/map/" + nm + "," + lat + "," + lng, "카카오맵에서 보기")
      ]));
    }
    // same-name siblings
    var sib = S.geo[code].items.filter(function (x) { return x !== it && x.kind === it.kind && x.name === it.name; });
    if (sib.length) v.appendChild(h("p", { class: "muted" }, ["같은 이름의 요소가 지도에 " + (sib.length + 1) + "곳 있습니다."]));
    setBody(v);
    setSheet("mid");
  }

  // 외부 링크는 항상 새 창(새 탭)으로
  function newWinLink(url, label) {
    return h("a", { class: "btn-ghost", href: url, target: "_blank", rel: "noopener noreferrer", onclick: function (e) {
      e.preventDefault();
      var w = window.open(url, "_blank");
      if (w) { try { w.opener = null; } catch (err) {} }
      else location.href = url; // 팝업이 막힌 경우에만 같은 창
    } }, [label + " ↗"]);
  }
  function compass(a) {
    return ["북", "북동", "동", "남동", "남", "남서", "서", "북서"][Math.round(((a % 360) + 360) % 360 / 45) % 8] + "쪽";
  }

  /* ---------- 360° viewer (Pannellum, 필요할 때만 불러옴) ---------- */
  var pannellumReady = null;
  function loadPannellum() {
    if (pannellumReady) return pannellumReady;
    pannellumReady = new Promise(function (ok, fail) {
      var css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css";
      document.head.appendChild(css);
      var s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js";
      s.onload = ok; s.onerror = fail; document.head.appendChild(s);
    });
    return pannellumReady;
  }
  function panoBox(p) {
    var wrap = h("figure", { class: "gallery pano360" }), box = h("div", { class: "pano-view" }, [h("span", { class: "pano-loading" }, ["360° 사진 불러오는 중…"])]);
    wrap.appendChild(box);
    wrap.appendChild(h("figcaption", null, [(p.cap ? p.cap + " · " : "") + "드래그해서 둘러보세요. 오른쪽 위 버튼으로 전체 화면"]));
    loadPannellum().then(function () {
      box.innerHTML = "";
      S.pano = window.pannellum.viewer(box, {
        type: "equirectangular", panorama: p.src, autoLoad: true, hfov: 100,
        showZoomCtrl: false, showFullscreenCtrl: true, compass: false, mouseZoom: true
      });
    }, function () { box.textContent = "360° 뷰어를 불러오지 못했습니다."; });
    return wrap;
  }

  function renderSearch(q) {
    q = q.trim();
    if (!q) { route(); return; }
    var v = h("div", { class: "view" }), ql = q.toLowerCase(), total = 0;
    v.appendChild(h("div", { class: "eyebrow" }, ["검색 결과"]));
    var hit = function (s) { return (s || "").toLowerCase().indexOf(ql) >= 0; };
    readyCodes().forEach(function (code) {
      var r = S.resources[code], rows = [];
      if (hit(r.name) || hit(r.intro)) rows.push({ t: "자원", name: r.name, go: function () { go(code); } });
      Object.keys(S.viewpoints).forEach(function (k) {
        var x = S.viewpoints[k]; if (x.resource !== code) return;
        if (hit(x.name) || hit(x.description)) rows.push({ t: "VP", no: x.no, name: x.name, go: function () { goName(code, "VP", x.name, parseInt(x.no, 10)); } });
      });
      Object.keys(S.elements).forEach(function (k) {
        var x = S.elements[k]; if (x.resource !== code) return;
        if (hit(x.name) || hit(x.description)) rows.push({ t: x.kind, name: x.name, go: function () { goName(code, x.kind, x.name); } });
      });
      if (!rows.length) return;
      total += rows.length;
      v.appendChild(h("h2", { class: "sec" }, [r.name + " (" + rows.length + ")"]));
      var ul = h("ul", { class: "list" });
      rows.forEach(function (x) {
        var icon = x.t === "VP" ? h("span", { class: "vpnum" }, [String(x.no)]) : x.t === "자원" ? h("span", { class: "dot", style: "background:" + C.COLORS.RES }) : h("span", { class: "dot " + KIND_CLASS[x.t] });
        ul.appendChild(h("li", null, [h("button", { onclick: function () { $("#searchInput").value = ""; x.go(); } }, [icon, h("span", null, [x.name]), h("span", { class: "sub" }, [x.t === "VP" ? "조망점" : KIND_LABEL[x.t] || "자원"])])]));
      });
      v.appendChild(ul);
    });
    if (!total) v.appendChild(h("p", { class: "empty" }, ["‘" + q + "’에 맞는 결과가 없습니다."]));
    setBody(v); setSheet("open");
  }
  function goName(code, kind, name, no) {
    loadGeo(code).then(function (G) {
      var it = G.items.filter(function (x) { return x.kind === kind && (kind === "VP" ? x.no === no : x.name === name); })[0];
      if (it) { S.zoomNext = true; go(code, it.id); }
      else { S.detail[code] = true; go(code, null, { detail: true }); toast("지도에 위치가 등록되지 않은 항목입니다"); }
    });
  }

  /* ---------- lightbox ---------- */
  function lightbox(photos, i) {
    var lb = $("#lightbox"), img = $("img", lb), cap = $("figcaption", lb);
    function show(n) { i = (n + photos.length) % photos.length; img.src = photos[i].src; cap.textContent = photos[i].cap || ""; }
    lb.hidden = false; show(i);
    $(".prev", lb).style.display = $(".next", lb).style.display = photos.length > 1 ? "" : "none";
    $(".prev", lb).onclick = function (e) { e.stopPropagation(); show(i - 1); };
    $(".next", lb).onclick = function (e) { e.stopPropagation(); show(i + 1); };
    var close = function () { lb.hidden = true; document.removeEventListener("keydown", key); };
    var key = function (e) { if (e.key === "Escape") close(); if (e.key === "ArrowLeft") show(i - 1); if (e.key === "ArrowRight") show(i + 1); };
    $(".lb-close", lb).onclick = close;
    lb.onclick = function (e) { if (e.target === lb) close(); };
    document.addEventListener("keydown", key);
  }

  /* ---------- mobile sheet ---------- */
  function setSheet(st) {
    if (!isMobile()) return;
    S.sheet = st;
    var p = $("#panel");
    p.classList.toggle("open", st === "open");
    p.classList.toggle("min", st === "min");
  }
  $("#sheetHandle").addEventListener("click", function () {
    setSheet(S.sheet === "open" ? "min" : S.sheet === "min" ? "mid" : "open");
  });
  (function sheetDrag() {
    var handle = $("#sheetHandle"), y0 = null;
    handle.addEventListener("touchstart", function (e) { y0 = e.touches[0].clientY; }, { passive: true });
    handle.addEventListener("touchend", function (e) {
      if (y0 == null) return; var dy = e.changedTouches[0].clientY - y0; y0 = null;
      if (Math.abs(dy) < 25) return;
      var order = ["min", "mid", "open"], k = order.indexOf(S.sheet);
      setSheet(order[Math.max(0, Math.min(2, k + (dy < 0 ? 1 : -1)))]);
    });
  })();

  /* ---------- controls ---------- */
  $$(".seg button").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!S.map) return;
      $$(".seg button").forEach(function (x) { x.classList.toggle("on", x === b); });
      S.map.setMapTypeId(kakao.maps.MapTypeId[b.dataset.type]);
      $("#map").classList.toggle("hybrid", b.dataset.type === "HYBRID");
    });
  });
  $$("#legend input").forEach(function (cb) {
    cb.addEventListener("change", function () {
      S.layers[cb.dataset.layer] = cb.checked;
      if (S.cur) setResourceVisible(S.cur, true);
    });
  });
  if (isMobile()) $("#legend").classList.add("collapsed");
  $(".legend-title").addEventListener("click", function () { if (isMobile()) $("#legend").classList.toggle("collapsed"); });
  $("#zoomIn").addEventListener("click", function () { S.map && S.map.setLevel(S.map.getLevel() - 1, { animate: true }); });
  $("#zoomOut").addEventListener("click", function () { S.map && S.map.setLevel(S.map.getLevel() + 1, { animate: true }); });
  $("#brand").addEventListener("click", function (e) { e.preventDefault(); $("#searchInput").value = ""; go(); });
  var st;
  ["input", "compositionend"].forEach(function (ev) {
    $("#searchInput").addEventListener(ev, function (e) { clearTimeout(st); st = setTimeout(function () { renderSearch(e.target.value); }, 200); });
  });
  $("#searchInput").addEventListener("focus", function () { setSheet("open"); });

  $("#btnLocate").addEventListener("click", function () {
    var btn = this;
    if (!S.map) return;
    if (S.watchId != null) {
      navigator.geolocation.clearWatch(S.watchId); S.watchId = null;
      if (S.me) { S.me.dot.setMap(null); S.me.circle.setMap(null); S.me = null; }
      btn.classList.remove("on"); return;
    }
    if (!navigator.geolocation) { toast("이 브라우저는 위치 기능을 지원하지 않습니다"); return; }
    toast("현재 위치를 찾는 중…");
    var first = true;
    S.watchId = navigator.geolocation.watchPosition(function (pos) {
      var ll = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
      if (!S.me) {
        S.me = {
          dot: new kakao.maps.CustomOverlay({ position: ll, content: h("div", { class: "m-me" }), zIndex: 40 }),
          circle: new kakao.maps.Circle({ center: ll, radius: pos.coords.accuracy, strokeWeight: 1, strokeColor: "#1a73e8", strokeOpacity: .5, fillColor: "#1a73e8", fillOpacity: .12 })
        };
        S.me.dot.setMap(S.map); S.me.circle.setMap(S.map);
      } else { S.me.dot.setPosition(ll); S.me.circle.setPosition(ll); S.me.circle.setRadius(pos.coords.accuracy); }
      btn.classList.add("on");
      if (first) { first = false; S.map.setLevel(Math.min(S.map.getLevel(), 4)); showInView([pos.coords.longitude, pos.coords.latitude]); $("#toast").hidden = true; }
    }, function (err) {
      S.watchId = null; btn.classList.remove("on");
      toast(err.code === 1 ? "위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요." : "현재 위치를 찾지 못했습니다.", 4000);
    }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
  });

  // legend visible only in detail mode
  var _setVis = setResourceVisible;
  setResourceVisible = function (code, on) { _setVis(code, on); $("#legend").hidden = !(S.cur && S.detail[S.cur]); };

  window.APP = { start: start, mapFailed: mapFailed, state: S };
  if (window.__mapState === "ready") start();
  else if (window.__mapState === "failed") mapFailed();
})();
