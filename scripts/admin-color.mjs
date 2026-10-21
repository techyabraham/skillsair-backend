/**
 * Colour maths shared by the Studio theme generator and the contrast check:
 * hex <-> sRGB <-> OKLab/OKLCH, interpolation in OKLCH, and WCAG relative luminance.
 */

export function hexToRgb(hex) {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255)
}

export function rgbToHex(rgb) {
  return `#${rgb.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('')}`
}

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)

export function rgbToOklch(rgb) {
  const [r, g, b] = rgb.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const C = Math.sqrt(A * A + B * B)
  const H = (Math.atan2(B, A) * 180) / Math.PI
  return [L, C, (H + 360) % 360]
}

export function oklchToRgb([L, C, H]) {
  const h = (H * Math.PI) / 180
  const A = C * Math.cos(h)
  const B = C * Math.sin(h)
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map(toGamma)
}

/** Interpolates between two hex colours in OKLCH (shortest hue path; grey ends keep the other hue). */
export function mixOklch(fromHex, toHex, t) {
  const a = rgbToOklch(hexToRgb(fromHex))
  const b = rgbToOklch(hexToRgb(toHex))
  let ha = a[2]
  let hb = b[2]
  if (a[1] < 0.01) ha = hb
  if (b[1] < 0.01) hb = ha
  let dh = hb - ha
  if (dh > 180) dh -= 360
  if (dh < -180) dh += 360
  return rgbToHex(oklchToRgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (ha + dh * t + 360) % 360]))
}

/** Builds a ramp keyed by step (0, 50, …) from sparse anchors {step: hex}. */
export function ramp(anchors, steps) {
  const keys = Object.keys(anchors).map(Number).sort((x, y) => x - y)
  const out = {}
  for (const step of steps) {
    if (anchors[step]) {
      out[step] = anchors[step].toLowerCase()
      continue
    }
    const upper = keys.find((k) => k > step) ?? keys[keys.length - 1]
    const lower = [...keys].reverse().find((k) => k < step) ?? keys[0]
    const t = upper === lower ? 0 : (step - lower) / (upper - lower)
    out[step] = mixOklch(anchors[lower], anchors[upper], t)
  }
  return out
}

export function luminance(hex) {
  const [r, g, b] = hexToRgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
