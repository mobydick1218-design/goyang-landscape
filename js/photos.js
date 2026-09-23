/* =========================================================
   사진 주소 처리 — 구글 드라이브 링크 / 전체 URL / 파일명(R2)
   ========================================================= */
(function () {
  const C = window.CONFIG;

  function driveId(url) {
    const m = url.match(/\/file\/d\/([\w-]+)/) || url.match(/[?&]id=([\w-]+)/) || url.match(/\/d\/([\w-]+)/);
    return m && /drive\.google|googleusercontent|docs\.google/.test(url) ? m[1] : null;
  }

  // 사진 1장에 대해 [표시용 주소 후보들], 원본 링크를 돌려줌
  function resolve(raw, width) {
    raw = raw.trim();
    const id = driveId(raw);
    if (id) return {
      srcs: [
        `https://drive.google.com/thumbnail?id=${id}&sz=w${width}`,
        `https://lh3.googleusercontent.com/d/${id}=w${width}`
      ],
      original: `https://drive.google.com/file/d/${id}/view`
    };
    const url = /^https?:\/\//i.test(raw) ? raw : (C.photoBaseUrl || '') + raw;
    return { srcs: [url], original: url };
  }

  function list(field) {
    if (!field) return [];
    const seen = new Set();
    return field.split(/[;\n]/).map(s => s.trim()).filter(s => s && !seen.has(s) && seen.add(s));
  }

  // <img>에 주소 넣기: 첫 주소가 실패하면 다음 후보, 다 실패하면 안내 표시
  function setImg(img, raw, width, onFail) {
    const { srcs } = resolve(raw, width);
    let k = 0;
    img.onerror = () => { k++; if (k < srcs.length) img.src = srcs[k]; else if (onFail) onFail(); };
    img.src = srcs[0];
  }

  window.PHOTOS = { resolve, list, setImg };
})();
