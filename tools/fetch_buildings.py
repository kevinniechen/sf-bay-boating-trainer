#!/usr/bin/env python3
"""Fetch OpenStreetMap building footprints (+ heights) for the waterfront areas and bake them into
data/buildings.bin for the game.  Data © OpenStreetMap contributors (ODbL).

Binary layout (little-endian):
  uint32 count
  per building: uint16 nverts, uint16 height_dm, uint8 kind, uint8 pad, then nverts × (float32 lon_offset, float32 lat_offset)
  where lon = -122.43 + lon_offset, lat = 37.83 + lat_offset
kind: 0 house/residential, 1 apartments, 2 commercial/office, 3 industrial/pier shed, 4 civic/other, 5 tower (>= 60 m)
"""
import json, math, os, re, struct, sys, time, urllib.request, urllib.parse

OUT = os.path.join(os.path.dirname(__file__), '..', 'data', 'buildings.bin')
AREAS = [
    # (lat0, lon0, lat1, lon1) — split into tiles below
    (37.772, -122.482, 37.812, -122.384),  # SF: Presidio edge → Marina → North Beach → FiDi → SoMa → Mission Bay
    (37.843, -122.507, 37.878, -122.468),  # Sausalito
    (37.860, -122.478, 37.890, -122.440),  # Tiburon & Belvedere
    (37.814, -122.381, 37.834, -122.356),  # Treasure Island & YBI
    (37.824, -122.427, 37.830, -122.419),  # Alcatraz
    (37.855, -122.445, 37.873, -122.415),  # Angel Island
]
TILE = 0.02

CACHE = os.path.join(os.path.dirname(__file__), '..', '.cache', 'osm')

def overpass(bbox):
    os.makedirs(CACHE, exist_ok=True)
    cf = os.path.join(CACHE, '_'.join(f'{v:.4f}' for v in bbox) + '.json')
    if os.path.exists(cf):
        with open(cf) as fh: return json.load(fh)
    els = _overpass(bbox); time.sleep(1.0)
    if els:
        with open(cf, 'w') as fh: json.dump(els, fh)
    return els

def _overpass(bbox):
    q = f'[out:json][timeout:120];way["building"]({bbox[0]},{bbox[1]},{bbox[2]},{bbox[3]});out tags geom;'
    req = urllib.request.Request('https://overpass-api.de/api/interpreter', data=urllib.parse.urlencode({'data': q}).encode(),
                                 headers={'User-Agent': 'sfbay-boating-trainer/1.0', 'Accept': '*/*'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read())['elements']
        except Exception as e:
            print('  retry', attempt, e, file=sys.stderr); time.sleep(5 + attempt * 5)
    return []

def num(v):
    if v is None: return None
    m = re.match(r'\s*([\d.]+)', str(v))
    if not m: return None
    x = float(m.group(1))
    return x * 0.3048 if "'" in str(v) or 'ft' in str(v) else x

def simplify_ring(ring, tol):
    """RDP on a closed ring: split at the vertex farthest from vertex 0 so neither half is degenerate."""
    if len(ring) <= 4: return ring
    x0, y0 = ring[0]
    k = max(range(len(ring)), key=lambda i: (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2)
    a = simplify(ring[:k + 1], tol); b = simplify(ring[k:] + [ring[0]], tol)
    return a[:-1] + b[:-1]

def simplify(pts, tol):
    if len(pts) < 3: return pts
    def rdp(a, b):
        (x1, y1), (x2, y2) = pts[a], pts[b]
        best, idx = 0, -1
        for i in range(a + 1, b):
            x0, y0 = pts[i]
            dx, dy = x2 - x1, y2 - y1
            d = abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1) / (math.hypot(dx, dy) or 1e-9)
            if d > best: best, idx = d, i
        if best > tol: return rdp(a, idx)[:-1] + rdp(idx, b)
        return [pts[a], pts[b]]
    return rdp(0, len(pts) - 1)

def main():
    seen, out = set(), []
    tiles = []
    for la0, lo0, la1, lo1 in AREAS:
        la = la0
        while la < la1:
            lo = lo0
            while lo < lo1:
                tiles.append((la, lo, min(la + TILE, la1), min(lo + TILE, lo1))); lo += TILE
            la += TILE
    for n, t in enumerate(tiles):
        els = overpass(t)
        print(f'tile {n + 1}/{len(tiles)}: {len(els)} buildings', flush=True)
        for e in els:
            if e['id'] in seen or 'geometry' not in e: continue
            seen.add(e['id'])
            tags = e.get('tags', {})
            if tags.get('building') in ('roof', 'construction', 'no') or tags.get('location') == 'underground': continue
            g = [(p['lon'], p['lat']) for p in e['geometry']]
            if len(g) < 4: continue
            if g[0] == g[-1]: g = g[:-1]
            # metres-ish coordinates for simplification
            m = [((lo + 122.43) * 87960, (la - 37.83) * 110574) for lo, la in g]
            area = 0.5 * abs(sum(m[i][0] * m[(i + 1) % len(m)][1] - m[(i + 1) % len(m)][0] * m[i][1] for i in range(len(m))))
            if area < 12: continue
            ms = simplify_ring(m, 0.6)
            if len(ms) < 3: continue
            h = num(tags.get('height')) or num(tags.get('building:height'))
            lv = num(tags.get('building:levels'))
            b = tags.get('building', 'yes')
            if not h:
                if lv: h = lv * 3.3 + 1.5
                elif b in ('house', 'detached', 'residential', 'terrace', 'semidetached_house'): h = 8.5
                elif b in ('garage', 'garages', 'shed', 'hut', 'kiosk'): h = 3.5
                else: h = 10 if area < 600 else 13
            kind = 0 if b in ('house', 'detached', 'residential', 'terrace', 'semidetached_house') else \
                   1 if b in ('apartments',) else 2 if b in ('commercial', 'office', 'retail', 'hotel') else \
                   3 if b in ('industrial', 'warehouse', 'hangar', 'shed', 'boathouse') else 4
            if h >= 60: kind = 5
            out.append((ms, h, kind))
    with open(OUT, 'wb') as f:
        f.write(struct.pack('<I', len(out)))
        for pts, h, kind in out:
            f.write(struct.pack('<HHBB', len(pts), min(65535, int(h * 10)), kind, 0))
            for x, y in pts:
                f.write(struct.pack('<ff', x / 87960, y / 110574))
    print(f'wrote {len(out)} buildings, {os.path.getsize(OUT) / 1e6:.1f} MB → {OUT}')

if __name__ == '__main__':
    main()
