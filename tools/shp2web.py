"""
SHP → 웹용 GeoJSON 변환 스크립트
사용법:  python shp2web.py <SHP 폴더> <사이트 폴더>
  - Resource_all.shp      → data/resources.geojson   (자원 대표점)
  - *_BD.shp              → data/boundaries/<이름>.geojson (자원 경계)
  - 그 외 (예: HJS_Pt)     → data/layers/<이름>.geojson  (요소·조망점)
  - data/manifest.json    → 자원 접두어(HJS 등)별로 어떤 레이어 파일이 있는지 목록
좌표계는 .prj를 읽어 WGS84(EPSG:4326)로 변환, 한글은 .cpg를 읽어 처리합니다.
필요 패키지: pip install pyshp pyproj
"""
import json, sys, os, glob
import shapefile
from pyproj import CRS, Transformer

src, site = sys.argv[1], sys.argv[2]
DATA = os.path.join(site, "data")
for d in ("boundaries", "layers"):
    os.makedirs(os.path.join(DATA, d), exist_ok=True)


def encoding_of(base):
    cpg = base + ".cpg"
    if os.path.exists(cpg):
        v = open(cpg, encoding="ascii", errors="ignore").read().strip().lower()
        if v in ("949", "euc-kr", "euc_kr", "cp949", "ks_c_5601-1987"):
            return "cp949"
        if v:
            return v
    return "cp949"


def rnd(c):
    return [round(c[0], 6), round(c[1], 6)]


def convert(base):
    tf = None
    if os.path.exists(base + ".prj"):
        crs = CRS.from_wkt(open(base + ".prj", encoding="utf-8", errors="ignore").read())
        if not crs.equals(CRS.from_epsg(4326)):
            tf = Transformer.from_crs(crs, 4326, always_xy=True)
    else:
        print(f"  ! {os.path.basename(base)}: .prj 없음 → 좌표변환 생략")

    def tx(pts):
        if tf is None:
            return [rnd(p) for p in pts]
        xs, ys = zip(*[(p[0], p[1]) for p in pts])
        lon, lat = tf.transform(xs, ys)
        return [rnd(p) for p in zip(lon, lat)]

    r = shapefile.Reader(base, encoding=encoding_of(base))
    names = [f[0] for f in r.fields[1:]]
    feats = []
    for sr in r.iterShapeRecords():
        props = {k: (v if not isinstance(v, bytes) else v.decode("cp949", "ignore")) for k, v in zip(names, sr.record)}
        props = {k: (v.strip() if isinstance(v, str) else v) for k, v in props.items()}
        g = sr.shape.__geo_interface__
        t = g["type"]
        c = g["coordinates"]
        if t == "Point":
            c = tx([c])[0]
        elif t in ("LineString", "MultiPoint"):
            c = tx(c)
        elif t in ("Polygon", "MultiLineString"):
            c = [tx(ring) for ring in c]
        elif t == "MultiPolygon":
            c = [[tx(ring) for ring in poly] for poly in c]
        feats.append({"type": "Feature", "properties": props, "geometry": {"type": t, "coordinates": c}})
    return {"type": "FeatureCollection", "features": feats}


manifest = {}
for shp in sorted(glob.glob(os.path.join(src, "**", "*.shp"), recursive=True)):
    base = shp[:-4]
    name = os.path.basename(base)
    fc = convert(base)
    if name.lower() == "resource_all":
        out = os.path.join(DATA, "resources.geojson")
    elif name.upper().endswith("_BD"):
        out = os.path.join(DATA, "boundaries", name + ".geojson")
    else:
        out = os.path.join(DATA, "layers", name + ".geojson")
        prefix = name.split("_")[0]
        manifest.setdefault(prefix, []).append(name)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  {name:<14} {len(fc['features']):>4}개 → {os.path.relpath(out, site)}")

with open(os.path.join(DATA, "manifest.json"), "w", encoding="utf-8") as f:
    json.dump({"layers": manifest}, f, ensure_ascii=False, indent=1)
print("manifest:", manifest)
