# Pixel contrast check: asteroid interiors vs open space backdrop.
# Usage: python check-rock-contrast.py <screenshot.png> <level-dump.json>
import json
import sys
from PIL import Image

img = Image.open(sys.argv[1]).convert('RGB')
raw = open(sys.argv[2], 'rb').read()
for enc in ('utf-8-sig', 'utf-16', 'utf-8'):
    try:
        geo = json.loads(raw.decode(enc))
        break
    except (UnicodeDecodeError, UnicodeError):
        continue
cell = geo['cell']
w, h = img.size

def sample(cx, cy, r=10):
    n = 0
    sr = sg = sb = 0
    slum = 0.0
    for x in range(int(cx - r), int(cx + r) + 1):
        for y in range(int(cy - r), int(cy + r) + 1):
            if 0 <= x < w and 0 <= y < h:
                pr, pg, pb = img.getpixel((x, y))
                sr += pr; sg += pg; sb += pb
                slum += 0.2126 * pr + 0.7152 * pg + 0.0722 * pb
                n += 1
    return (sr / n, sg / n, sb / n, slum / n)

rock = geo['rocks']
occupied = {(r['x'], r['y']) for r in rock}
occupied |= {(g['x'], g['y']) for g in geo['gates']}
occupied.add((geo['base']['x'], geo['base']['y']))
# also exclude cells adjacent to rocks/gates to avoid rim pixels
near = set()
for (x, y) in occupied:
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            near.add((x + dx, y + dy))

rock_samples = [sample((r['x'] + 0.5) * cell, (r['y'] + 0.5) * cell) for r in rock]
open_samples = []
for y in range(2, geo['rows'] - 2):
    for x in range(1, geo['cols'] - 1):
        if (x, y) in near:
            continue
        open_samples.append(sample((x + 0.5) * cell, (y + 0.5) * cell, r=6))

rl = sorted(s[3] for s in rock_samples)
ol = sorted(s[3] for s in open_samples)
def med(a):
    n = len(a)
    return a[n // 2] if n % 2 else (a[n // 2 - 1] + a[n // 2]) / 2

print(f"rocks sampled: {len(rock_samples)}, open cells sampled: {len(open_samples)}")
print(f"asteroid median luminance: {med(rl):.1f}")
print(f"open-space median luminance: {med(ol):.1f}")
print(f"contrast (asteroid/open): {med(rl) / max(med(ol), 1e-6):.2f}x")
rr = med([s[0] for s in rock_samples]); rg = med([s[1] for s in rock_samples]); rb = med([s[2] for s in rock_samples])
orr = med([s[0] for s in open_samples]); og = med([s[1] for s in open_samples]); ob = med([s[2] for s in open_samples])
print(f"asteroid avg RGB: ({rr:.0f}, {rg:.0f}, {rb:.0f})")
print(f"open-space avg RGB: ({orr:.0f}, {og:.0f}, {ob:.0f})")
