/* =========================================================
   데이터 불러오기 — GeoJSON + content.csv 연결
   연결 규칙:  CSV의 file_name + code  ↔  SHP 파일명 + code
              (code가 안 맞으면 file_name + name 으로 한 번 더 찾음)
   ========================================================= */
(function () {
  const C = window.CONFIG;

  function parseCSV(text) {
    text = text.replace(/^﻿/, '');
    const rows = []; let row = []; let cur = ''; let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = '';
        if (row.some(v => v.trim() !== '')) rows.push(row);
        row = [];
      } else cur += ch;
    }
    row.push(cur);
    if (row.some(v => v.trim() !== '')) rows.push(row);
    const head = rows.shift().map(h => h.trim().toLowerCase());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || '').trim()])));
  }

  const norm = s => String(s == null ? '' : s).trim().toUpperCase().replace(/_/g, '-');
  const fileKey = s => String(s || '').trim().toUpperCase();

  function classOf(props, file) {
    if (/VPT?$/i.test(file) || /^VP/i.test(props.code || '')) return 'VP';
    const c = String(props.class || props.code || '').trim().toUpperCase();
    if (c.startsWith('LE')) return 'LE';
    if (c.startsWith('BE')) return 'BE';
    return 'ETC';
  }

  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' ' + r.status);
    return r.json();
  }

  async function loadAll() {
    const [resFC, manifest, csvText] = await Promise.all([
      getJSON('data/resources.geojson'),
      getJSON('data/manifest.json').catch(() => ({ layers: {} })),
      fetch('data/content.csv', { cache: 'no-cache' }).then(r => r.ok ? r.text() : '').catch(() => '')
    ]);

    const rows = csvText ? parseCSV(csvText) : [];
    const byCode = new Map(), byName = new Map();
    rows.forEach(r => {
      r._used = false;
      byCode.set(fileKey(r.file_name) + '|' + norm(r.code), r);
      byName.set(fileKey(r.file_name) + '|' + String(r.name || '').trim(), r);
    });
    const findRow = (file, props) =>
      byCode.get(fileKey(file) + '|' + norm(props.code)) ||
      byName.get(fileKey(file) + '|' + String(props.name || '').trim()) || null;

    const resources = await Promise.all(resFC.features.map(async (f, i) => {
      const p = f.properties;
      const bd = String(p.BD || p.bd || '').trim();
      const prefix = bd.replace(/_BD$/i, '');
      const row = findRow(C.resourceFile, p);
      if (row) row._used = true;
      const res = {
        uid: 'R' + i, kind: 'resource',
        code: p.code || '', name: (row && row.name) || p.name || '',
        bd, prefix,
        latlng: [f.geometry.coordinates[1], f.geometry.coordinates[0]],
        content: row, boundary: null, features: []
      };
      if (bd) res.boundary = await getJSON('data/boundaries/' + bd + '.geojson')
        .catch(() => { console.warn('[경계 없음]', bd); return null; });
      const files = (manifest.layers || {})[prefix] || [];
      const fcs = await Promise.all(files.map(n =>
        getJSON('data/layers/' + n + '.geojson').then(fc => [n, fc]).catch(() => null)));
      fcs.filter(Boolean).forEach(([file, fc]) => {
        fc.features.forEach((ft, j) => {
          const row = findRow(file, ft.properties);
          if (row) row._used = true;
          res.features.push({
            uid: file + ':' + j, kind: 'feature', file,
            cls: classOf(ft.properties, file),
            code: ft.properties.code || '',
            name: (row && row.name) || ft.properties.name || ft.properties.code || '(이름 없음)',
            geometry: ft.geometry, content: row, resource: res
          });
        });
      });
      return res;
    }));

    rows.filter(r => !r._used).forEach(r =>
      console.warn('[CSV 연결 안 됨]', r.file_name, r.code, r.name));
    return { resources };
  }

  window.DATA = { loadAll };
})();
