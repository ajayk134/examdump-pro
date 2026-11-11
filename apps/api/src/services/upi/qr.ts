/**
 * QR rendering for UPI payment strings.
 *
 * We emit SVG, not PNG: it stays crisp at any size on a phone screen, needs no
 * native image codec, and cannot carry a payload that a browser would try to
 * fetch. The matrix comes from `qrcode-generator` (MIT, ISO/IEC 18004).
 *
 * Error correction level `M` (~15% recovery) is the usual choice for a screen
 * that may be scanned at an angle or behind a glare-prone phone display.
 */

import qrcode from 'qrcode-generator';

export interface QrSvgOptions {
  /** Rendered width/height in px. The SVG also scales via CSS. */
  size?: number;
  /** Quiet-zone border in modules. The spec requires at least 4. */
  margin?: number;
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  darkColor?: string;
  lightColor?: string;
}

/**
 * Render `text` as a standalone SVG document.
 *
 * Returns markup rather than a data URL so the caller can size it however it
 * likes, and so no base64 round-trip is needed on the hot path.
 */
export function renderQrSvg(text: string, options: QrSvgOptions = {}): string {
  if (!text) throw new Error('qr_text_required');

  const size = options.size ?? 256;
  const margin = Math.max(0, options.margin ?? 4);
  const ec = options.errorCorrection ?? 'M';
  const dark = options.darkColor ?? '#000000';
  const light = options.lightColor ?? '#ffffff';

  const qr = qrcode(0, ec);
  qr.addData(text);
  qr.make();

  const count = qr.getModuleCount();
  const total = count + margin * 2;

  // One path for every dark module keeps the SVG small: a per-module <rect>
  // would triple the output for no visual gain.
  let path = '';
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        path += `M${col + margin} ${row + margin}h1v1h-1z`;
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"`,
    ` viewBox="0 0 ${total} ${total}" role="img" aria-label="UPI payment QR code"`,
    ` shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="${light}"/>`,
    `<path d="${path}" fill="${dark}"/>`,
    `</svg>`,
  ].join('');
}

/** Number of modules per side, useful for asserting scannability in tests. */
export function qrModuleCount(text: string, ec: 'L' | 'M' | 'Q' | 'H' = 'M'): number {
  const qr = qrcode(0, ec);
  qr.addData(text);
  qr.make();
  return qr.getModuleCount();
}
