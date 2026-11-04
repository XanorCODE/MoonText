const { nativeImage } = require('electron');

const hex = n => Math.round(n).toString(16).padStart(2, '0');

function hslToHex(h, s, l) {
  const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + hex(f(0) * 255) + hex(f(8) * 255) + hex(f(4) * 255);
}

/** Dominant vivid color of a cover (data: URL) as #rrggbb, or null for grey or unreadable covers. */
function coverAccent(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  try {
    const img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) return null;
    const px = img.resize({ width: 24, height: 24, quality: 'good' }).toBitmap();     // BGRA
    const bins = new Array(12).fill(0), sum = Array.from({ length: 12 }, () => [0, 0, 0]);
    for (let i = 0; i + 3 < px.length; i += 4) {
      const r = px[i + 2] / 255, g = px[i + 1] / 255, b = px[i] / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (max < 0.18 || d < 0.12) continue;                                        // too dark or grey
      const s = d / max;
      let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h = (h * 60 + 360) % 360;
      const bin = Math.floor(h / 30), w = s * max;
      bins[bin] += w; sum[bin][0] += h * w; sum[bin][1] += s * w; sum[bin][2] += w;
    }
    let best = 0;
    for (let i = 1; i < 12; i++) if (bins[i] > bins[best]) best = i;
    if (bins[best] < 1.5) return null;
    const [hw, sw, w] = sum[best];
    return hslToHex(hw / w, Math.max(0.55, Math.min(0.95, sw / w)), 0.66);
  } catch { return null; }
}

module.exports = { coverAccent };
