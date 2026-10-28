# Region-wise diff of two homepage screenshots.
# Usage: python diff-home.py <new.png> <old.png>
import sys
from PIL import Image

a = Image.open(sys.argv[1]).convert('RGB')
b = Image.open(sys.argv[2]).convert('RGB')
if a.size != b.size:
    print('size mismatch:', a.size, b.size)
    b = b.resize(a.size)
W, H = a.size
print('%-14s %8s %8s %8s %10s' % ('region', 'lumA', 'lumB', 'dLum', 'meanAbsDiff'))
pa, pb = a.load(), b.load()
for ry in range(10):
    for rx in range(3):
        x0, x1 = W * rx // 3, W * (rx + 1) // 3
        y0, y1 = H * ry // 10, H * (ry + 1) // 10
        n = 0
        sa = sb = sd = 0.0
        for y in range(y0, y1, 2):
            for x in range(x0, x1, 2):
                ca = pa[x, y]
                cb = pb[x, y]
                la = 0.2126 * ca[0] + 0.7152 * ca[1] + 0.0722 * ca[2]
                lb = 0.2126 * cb[0] + 0.7152 * cb[1] + 0.0722 * cb[2]
                sa += la
                sb += lb
                sd += abs(ca[0] - cb[0]) + abs(ca[1] - cb[1]) + abs(ca[2] - cb[2])
                n += 1
        print('%-14s %8.1f %8.1f %+8.1f %10.1f' % ('r%d c%d' % (ry, rx), sa / n, sb / n, sa / n - sb / n, sd / n / 3))
