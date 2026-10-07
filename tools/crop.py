#!/usr/bin/env python3
"""crop.py lat lon size_m out.jpg — NAIP (0.6 m) aerial close-up, north-up, linear lat/lon, with a labelled grid.
Used to place piers/floats/breakwaters at their real positions."""
import sys, math, io, urllib.request
from PIL import Image, ImageDraw
lat, lon, size, out = float(sys.argv[1]), float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
dlat = size / 2 / 110574; dlon = size / 2 / (111320 * math.cos(math.radians(lat)))
la0, la1, lo0, lo1 = lat - dlat, lat + dlat, lon - dlon, lon + dlon
u = ('https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
     f'?bbox={lo0},{la0},{lo1},{la1}&bboxSR=4326&imageSR=4326&size=1000,1000&format=jpg&f=image')
im = Image.open(io.BytesIO(urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'x'}), timeout=60).read())).convert('RGB')
d = ImageDraw.Draw(im)
step = 0.0005 if size <= 900 else 0.001
X = lambda lo: (lo - lo0) / (lo1 - lo0) * 1000
Y = lambda la: (la1 - la) / (la1 - la0) * 1000
g = math.ceil(la0 / step) * step
while g < la1: d.line([(0, Y(g)), (1000, Y(g))], fill=(255, 255, 0)); d.text((3, Y(g) + 2), f'{g:.4f}', fill=(255, 255, 0)); g += step
g = math.ceil(lo0 / step) * step
while g < lo1: d.line([(X(g), 0), (X(g), 1000)], fill=(0, 255, 255)); d.text((X(g) + 2, 3), f'{g:.4f}', fill=(0, 255, 255)); g += step
im.save(out, quality=88)
print(out, f'{size/1000:.2f} m/px')
