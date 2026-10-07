#!/usr/bin/env python3
"""Download real terrain + aerial imagery for the play area and bake them into game textures.

Sources (both public domain / free):
  - Elevation: AWS Open Data "Terrain Tiles" (Mapzen terrarium encoding; USGS 3DEP/NED on land,
    NOAA coastal DEMs/ETOPO offshore).  https://registry.opendata.aws/terrain-tiles/
  - Imagery:   USGS The National Map "USGSImageryOnly" (NAIP-based orthoimagery, public domain).

Outputs (in data/):
  terrain.png   - heightmap over the main bounds, v = R*256 + G, height_m = v/10 - 1000
  imagery.jpg   - aerial imagery over the main bounds (north-up, equirectangular in lat/lon)
  region_terrain.png / region_imagery.jpg - same, larger area at lower resolution (backdrop)
"""
import io, math, os, sys, concurrent.futures as cf, urllib.request
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(__file__), '..', 'data')
os.makedirs(ROOT, exist_ok=True)
MAIN = dict(lat0=37.765, lat1=37.92, lon0=-122.52, lon1=-122.35)
REGION = dict(lat0=37.55, lat1=38.10, lon0=-122.80, lon1=-122.05)

def tx(lon, z): return (lon + 180) / 360 * 2 ** z
def ty(lat, z):
    r = math.radians(lat)
    return (1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * 2 ** z

def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'sfbay-boating-trainer/1.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read()
        except Exception as e:
            if i == tries - 1:
                print('FAIL', url, e, file=sys.stderr); return None

def mosaic(url_fmt, z, b, mode):
    x0, x1 = int(tx(b['lon0'], z)), int(tx(b['lon1'], z))
    y0, y1 = int(ty(b['lat1'], z)), int(ty(b['lat0'], z))
    W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    canvas = Image.new(mode, (W, H))
    jobs = {}
    with cf.ThreadPoolExecutor(12) as ex:
        for x in range(x0, x1 + 1):
            for y in range(y0, y1 + 1):
                jobs[ex.submit(get, url_fmt.format(z=z, x=x, y=y))] = (x, y)
        for f in cf.as_completed(jobs):
            x, y = jobs[f]; data = f.result()
            if data:
                canvas.paste(Image.open(io.BytesIO(data)).convert(mode), ((x - x0) * 256, (y - y0) * 256))
    return canvas, (x0, y0)

def reproject(canvas, origin, z, b, W, H, decode=None):
    """Resample a web-mercator mosaic onto a regular lat/lon grid (north-up)."""
    arr = np.asarray(canvas).astype(np.float64)
    lats = np.linspace(b['lat1'], b['lat0'], H)
    lons = np.linspace(b['lon0'], b['lon1'], W)
    px = (np.array([tx(l, z) for l in lons]) - origin[0]) * 256
    py = (np.array([ty(l, z) for l in lats]) - origin[1]) * 256
    X, Y = np.meshgrid(px, py)
    x0 = np.clip(np.floor(X).astype(int), 0, arr.shape[1] - 2); y0 = np.clip(np.floor(Y).astype(int), 0, arr.shape[0] - 2)
    fx = (X - x0)[..., None] if arr.ndim == 3 else X - x0
    fy = (Y - y0)[..., None] if arr.ndim == 3 else Y - y0
    a = arr[y0, x0]; bb = arr[y0, x0 + 1]; c = arr[y0 + 1, x0]; d = arr[y0 + 1, x0 + 1]
    if decode is not None:  # decode before interpolating (terrarium is packed RGB)
        a, bb, c, d = decode(a), decode(bb), decode(c), decode(d)
        fx, fy = X - x0, Y - y0
    return (a * (1 - fx) + bb * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def terrarium(rgb): return rgb[..., 0] * 256 + rgb[..., 1] + rgb[..., 2] / 256 - 32768

def build(name, b, zt, zi, tW, tH, iW, iH):
    print(f'[{name}] terrain z{zt}…', flush=True)
    t, o = mosaic('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', zt, b, 'RGB')
    h = reproject(t, o, zt, b, tW, tH, decode=terrarium)
    enc = np.clip((h + 1000) * 10, 0, 65535).astype(np.uint32)
    # packed into RGB (R = high byte, G = low byte) so a browser canvas can read it losslessly
    rgb = np.stack([(enc >> 8) & 255, enc & 255, np.zeros_like(enc)], -1).astype(np.uint8)
    Image.fromarray(rgb).save(os.path.join(ROOT, f'{name}terrain.png'))
    print(f'  height range {h.min():.1f} .. {h.max():.1f} m', flush=True)
    if os.environ.get('TERRAIN_ONLY'): return
    print(f'[{name}] imagery z{zi}…', flush=True)
    im, o = mosaic('https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}', zi, b, 'RGB')
    img = reproject(im, o, zi, b, iW, iH)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(os.path.join(ROOT, f'{name}imagery.jpg'), quality=84, optimize=True)
    print('  done', flush=True)

if __name__ == '__main__':
    build('', MAIN, 14, 15, 1536, 1536, 4096, 4096)
    build('region_', REGION, 11, 12, 1024, 1024, 2048, 2048)
