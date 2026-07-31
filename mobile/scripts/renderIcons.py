#!/usr/bin/env python3
"""
Renders the mobile icon set from the desktop icon's design values.

resources/icon.svg is the source of truth for the mark, but there is no SVG
renderer on this machine and adding one as a build dependency to draw six PNGs
is not worth it. The geometry below is copied from that file verbatim, in the
same 1024 space, so the two stay comparable by reading them side by side.

The variants exist because the platforms want different things:

  icon.png            full-bleed square. iOS applies its own squircle mask, so
                      baking rounded corners in would round it twice.
  android-icon-*      an adaptive icon is three layers. The foreground is
                      scaled into the safe zone because Android masks the outer
                      third and the launcher animates within it.
  monochrome          themed icons are recoloured by the system, so it must be
                      a silhouette — any colour in it is discarded.

Run: python3 scripts/renderIcons.py
"""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFilter

S = 1024
SS = 4  # supersample; Pillow has no antialiased drawing, so draw big and shrink

BG_STOPS = [(0.0, (0x1B, 0x17, 0x35)), (0.55, (0x12, 0x10, 0x1F)), (1.0, (0x0A, 0x09, 0x10))]
MARK_STOPS = [(0.0, (0xA6, 0x90, 0xFF)), (1.0, (0x78, 0xF7, 0xBC))]

# Geometry, in 1024 space, from resources/icon.svg.
TRACK = (176, 668, 848, 694)
PROGRESS = (176, 668, 476, 694)
PLAYHEAD_BAR = (466, 616, 476, 746)
PLAYHEAD_DOT = (471, 606, 20)
TRIANGLE = [(404, 254), (404, 526), (664, 390)]
TRIANGLE_STROKE = 56


def diagonal_gradient(size: int, stops) -> Image.Image:
    """Top-left to bottom-right, which is what x1=0,y1=0 x2=1,y2=1 means."""
    image = Image.new('RGB', (size, size))
    pixels = image.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * (size - 1))
            for index in range(len(stops) - 1):
                left, right = stops[index], stops[index + 1]
                if t <= right[0] or index == len(stops) - 2:
                    span = right[0] - left[0] or 1
                    local = min(1.0, max(0.0, (t - left[0]) / span))
                    pixels[x, y] = tuple(
                        round(left[1][channel] + (right[1][channel] - left[1][channel]) * local)
                        for channel in range(3)
                    )
                    break
    return image


def _mask(size: int, scale: float, offset, parts) -> Image.Image:
    mask = Image.new('L', (size, size), 0)
    draw = ImageDraw.Draw(mask)
    k = size / S * scale
    dx, dy = offset[0] * size / S, offset[1] * size / S

    for part in parts:
        if part[0] == 'rect':
            _, (x0, y0, x1, y1), radius, alpha = part
            draw.rounded_rectangle(
                [x0 * k + dx, y0 * k + dy, x1 * k + dx, y1 * k + dy], radius=radius * k, fill=alpha
            )
        elif part[0] == 'dot':
            _, (cx, cy, r), alpha = part
            draw.ellipse(
                [(cx - r) * k + dx, (cy - r) * k + dy, (cx + r) * k + dx, (cy + r) * k + dy], fill=alpha
            )
        else:
            points = [(x * k + dx, y * k + dy) for x, y in TRIANGLE]
            draw.polygon(points, fill=255)
            # The SVG strokes the same path with a round join, which fattens the
            # shape and rounds its corners; a closed line with a curve joint is
            # the same thing.
            draw.line(points + [points[0]], fill=255, width=round(TRIANGLE_STROKE * k), joint='curve')
            for x, y in points:
                rr = TRIANGLE_STROKE * k / 2
                draw.ellipse([x - rr, y - rr, x + rr, y + rr], fill=255)
    return mask


# Split the way the SVG splits it: the playhead and the empty track are white,
# only the progress fill and the play mark carry the gradient. Painting them all
# through one mask gave every element the same slice of the ramp and lost both
# its ends.
WHITE_PARTS = [('rect', TRACK, 13, 31), ('rect', PLAYHEAD_BAR, 5, 217), ('dot', PLAYHEAD_DOT, 255)]
GRADIENT_PARTS = [('rect', PROGRESS, 13, 217), ('triangle',)]


def mark_mask(size: int, scale: float = 1.0, offset=(0, 0)) -> Image.Image:
    """Everything, for the silhouette and the glow."""
    return _mask(size, scale, offset, WHITE_PARTS + GRADIENT_PARTS)


def _gradient_for(mask: Image.Image, size: int) -> Image.Image:
    """A gradient scoped to the mask's own bounding box, as objectBoundingBox means."""
    box = mask.getbbox() or (0, 0, size, size)
    span = max(box[2] - box[0], box[3] - box[1]) or 1
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(diagonal_gradient(span, MARK_STOPS).convert('RGBA'), (box[0], box[1]))
    return canvas


def compose(background, scale: float, offset=(0, 0), glow: bool = True) -> Image.Image:
    size = S * SS
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    if background is not None:
        canvas.paste(background, (0, 0))

    if glow:
        # The SVG's feGaussianBlur stdDeviation=26, in the supersampled space.
        halo = mark_mask(size, scale, offset).filter(ImageFilter.GaussianBlur(26 * SS * scale))
        halo = halo.point(lambda value: round(value * 0.5))
        canvas.paste(_gradient_for(halo, size), (0, 0), halo)

    white = _mask(size, scale, offset, WHITE_PARTS)
    canvas.paste(Image.new('RGBA', (size, size), (255, 255, 255, 255)), (0, 0), white)

    for part in GRADIENT_PARTS:
        piece = _mask(size, scale, offset, [part])
        canvas.paste(_gradient_for(piece, size), (0, 0), piece)
    return canvas.resize((S, S), Image.LANCZOS)


def main() -> None:
    size = S * SS

    # Full-bleed: iOS masks it into a squircle itself.
    background = diagonal_gradient(size, BG_STOPS).convert('RGBA')
    compose(background, 1.0).save('assets/icon.png')

    # Adaptive background is a flat layer; the gradient reads as banding once the
    # launcher scales and crops it, so it stays the plain brand base.
    Image.new('RGB', (S, S), (0x12, 0x10, 0x1F)).save('assets/android-icon-background.png')

    # Foreground inside the safe zone: Android crops the outer third and shifts
    # the layer during launcher animations.
    compose(None, 0.62, offset=(196, 196)).save('assets/android-icon-foreground.png')

    # Themed icons are recoloured wholesale, so this is a silhouette.
    mono = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    mono.paste(Image.new('RGBA', (size, size), (255, 255, 255, 255)), (0, 0), mark_mask(size, 0.62, (196, 196)))
    mono.resize((S, S), Image.LANCZOS).save('assets/android-icon-monochrome.png')

    compose(None, 1.0).save('assets/splash-icon.png')
    compose(background, 1.0).resize((48, 48), Image.LANCZOS).save('assets/favicon.png')
    print('wrote icon.png, android-icon-{background,foreground,monochrome}.png, splash-icon.png, favicon.png')


if __name__ == '__main__':
    main()
