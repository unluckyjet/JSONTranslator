"""Perceptual colour distance, including under colour vision deficiency.

Two series are tellable apart when the colours a reader actually sees are far
enough apart in a perceptually uniform space. Hex difference does not measure
that, and neither does RGB euclidean distance, so this module goes to CIELAB and
uses CIEDE2000.

Roughly one in twelve men has a colour vision deficiency, so the same distance
is measured again through simulated protanopia, deuteranopia and tritanopia.
"""

from __future__ import annotations

import math

# Machado, Oliveira and Fernandes (2009), severity 1.0, applied to linear RGB.
DICHROMACY_MATRICES: dict[str, tuple[tuple[float, float, float], ...]] = {
    "protanopia": (
        (0.152286, 1.052583, -0.204868),
        (0.114503, 0.786281, 0.099216),
        (-0.003882, -0.048116, 1.051998),
    ),
    "deuteranopia": (
        (0.367322, 0.860646, -0.227968),
        (0.280085, 0.672501, 0.047413),
        (-0.011820, 0.042940, 0.968881),
    ),
    "tritanopia": (
        (1.255528, -0.076749, -0.178779),
        (-0.078411, 0.930809, 0.147602),
        (0.004733, 0.691367, 0.303900),
    ),
}

_D65 = (0.95047, 1.00000, 1.08883)

RGB = tuple[float, float, float]
Lab = tuple[float, float, float]


def _to_linear(channel: float) -> float:
    if channel <= 0.04045:
        return channel / 12.92
    return ((channel + 0.055) / 1.055) ** 2.4


def _to_srgb(channel: float) -> float:
    channel = min(max(channel, 0.0), 1.0)
    if channel <= 0.0031308:
        return channel * 12.92
    return 1.055 * (channel ** (1 / 2.4)) - 0.055


def composite_over_white(rgb: RGB, alpha: float) -> RGB:
    """What the reader sees. A 0.4-alpha line on paper is not its own colour."""
    alpha = min(max(alpha, 0.0), 1.0)
    return tuple(channel * alpha + (1.0 - alpha) for channel in rgb)  # type: ignore[return-value]


def simulate(rgb: RGB, deficiency: str) -> RGB:
    """Re-render a colour as someone with the named deficiency would see it."""
    matrix = DICHROMACY_MATRICES[deficiency]
    linear = [_to_linear(channel) for channel in rgb]
    converted = [row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2] for row in matrix]
    return tuple(_to_srgb(channel) for channel in converted)  # type: ignore[return-value]


def to_lab(rgb: RGB) -> Lab:
    red, green, blue = (_to_linear(channel) for channel in rgb)
    x = 0.4124564 * red + 0.3575761 * green + 0.1804375 * blue
    y = 0.2126729 * red + 0.7151522 * green + 0.0721750 * blue
    z = 0.0193339 * red + 0.1191920 * green + 0.9503041 * blue

    def f(value: float) -> float:
        if value > 0.008856451679035631:
            return value ** (1 / 3)
        return value * 7.787037037037035 + 16 / 116

    fx, fy, fz = f(x / _D65[0]), f(y / _D65[1]), f(z / _D65[2])
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def relative_luminance(rgb: RGB) -> float:
    """WCAG relative luminance, which is what survives a greyscale print."""
    red, green, blue = (_to_linear(channel) for channel in rgb)
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue


def ciede2000(lab1: Lab, lab2: Lab) -> float:
    """CIEDE2000 difference. Under about 2.3 is imperceptible to most people."""
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2

    c1 = math.hypot(a1, b1)
    c2 = math.hypot(a2, b2)
    c_bar = (c1 + c2) / 2
    g = 0.5 * (1 - math.sqrt(c_bar**7 / (c_bar**7 + 25**7))) if c_bar > 0 else 0.0

    a1p, a2p = (1 + g) * a1, (1 + g) * a2
    c1p, c2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if (a1p or b1) else 0.0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if (a2p or b2) else 0.0

    delta_l = l2 - l1
    delta_c = c2p - c1p

    if c1p * c2p == 0:
        delta_h = 0.0
    elif abs(h2p - h1p) <= 180:
        delta_h = h2p - h1p
    elif h2p - h1p > 180:
        delta_h = h2p - h1p - 360
    else:
        delta_h = h2p - h1p + 360
    delta_hp = 2 * math.sqrt(c1p * c2p) * math.sin(math.radians(delta_h) / 2)

    l_bar = (l1 + l2) / 2
    c_bar_p = (c1p + c2p) / 2

    if c1p * c2p == 0:
        h_bar = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        h_bar = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        h_bar = (h1p + h2p + 360) / 2
    else:
        h_bar = (h1p + h2p - 360) / 2

    t = (
        1
        - 0.17 * math.cos(math.radians(h_bar - 30))
        + 0.24 * math.cos(math.radians(2 * h_bar))
        + 0.32 * math.cos(math.radians(3 * h_bar + 6))
        - 0.20 * math.cos(math.radians(4 * h_bar - 63))
    )

    sl = 1 + (0.015 * (l_bar - 50) ** 2) / math.sqrt(20 + (l_bar - 50) ** 2)
    sc = 1 + 0.045 * c_bar_p
    sh = 1 + 0.015 * c_bar_p * t

    delta_theta = 30 * math.exp(-(((h_bar - 275) / 25) ** 2))
    rc = 2 * math.sqrt(c_bar_p**7 / (c_bar_p**7 + 25**7)) if c_bar_p > 0 else 0.0
    rt = -rc * math.sin(2 * math.radians(delta_theta))

    return math.sqrt(
        (delta_l / sl) ** 2
        + (delta_c / sc) ** 2
        + (delta_hp / sh) ** 2
        + rt * (delta_c / sc) * (delta_hp / sh)
    )


def distance(rgb1: RGB, rgb2: RGB) -> float:
    return ciede2000(to_lab(rgb1), to_lab(rgb2))


def worst_case_distance(rgb1: RGB, rgb2: RGB) -> tuple[float, str]:
    """The smallest distance across normal vision and the three dichromacies."""
    worst = (distance(rgb1, rgb2), "normal vision")
    for deficiency in DICHROMACY_MATRICES:
        candidate = distance(simulate(rgb1, deficiency), simulate(rgb2, deficiency))
        if candidate < worst[0]:
            worst = (candidate, deficiency)
    return worst
