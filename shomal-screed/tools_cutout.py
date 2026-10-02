# Cuts the logo out of its navy background: everything outside the white sticker outline becomes transparent.
import sys, numpy as np
from PIL import Image
from scipy import ndimage
src, dst = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('RGB')).astype(float)
light = im.min(axis=2)                       # white outline: all channels high
outline = light > 170
# Background = non-outline pixels connected to the image border.
lab, _ = ndimage.label(~outline)
border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
bg = np.isin(lab, border[border > 0])
inside = ~bg
inside = ndimage.binary_fill_holes(inside)
inside = ndimage.binary_opening(inside, iterations=2)  # drop specks (e.g. a stray sparkle)
lab2, n = ndimage.label(inside)                         # keep only the biggest piece: the sticker
sizes = ndimage.sum(inside, lab2, range(1, n + 1))
inside = lab2 == (1 + int(np.argmax(sizes)))
# Soft 1-2 px edge.
alpha = ndimage.gaussian_filter(inside.astype(float), 1.0)
alpha = np.clip((alpha - .25) / .5, 0, 1)
rgba = np.dstack([im, alpha * 255]).astype(np.uint8)
ys, xs = np.where(alpha > 0)
rgba = rgba[ys.min():ys.max() + 1, xs.min():xs.max() + 1]
Image.fromarray(rgba, 'RGBA').save(dst)
print('saved', dst, rgba.shape)
