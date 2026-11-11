/**
 * LaTeX to readable-Unicode conversion for AI answers.
 *
 * Kept dependency-free and framework-agnostic so it can be unit tested from
 * the API test suite as well as used by the web renderer.
 */

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ',
  omega: 'ω', Delta: 'Δ', Sigma: 'Σ', Omega: 'Ω', infinity: '∞',
};

const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', leq: '≤', geq: '≥',
  neq: '≠', approx: '≈', rightarrow: '→', to: '→', Rightarrow: '⇒',
  leftarrow: '←', leftrightarrow: '↔', infty: '∞', sums: '∑', in: '∈',
  notin: '∉', subset: '⊂', cup: '∪', cap: '∩', land: '∧', lor: '∨',
};

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  n: 'ⁿ', i: 'ⁱ',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
};

/** Convert the most common LaTeX constructs to readable Unicode. */
export function latexToUnicode(raw: string): string {
  let out = raw;
  out = out.replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1');
  out = out.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)');
  out = out.replace(/\\sqrt\{([^{}]*)\}/g, '√($1)');
  out = out.replace(/\\(?:left|right|big|Big|bigg|Bigg)/g, '');
  out = out.replace(/\^\{\\circ\}/g, '°');
  out = out.replace(/\\cdot/g, '·');
  out = out.replace(/\\([A-Za-z]+)/g, (_m, name: string) => GREEK[name] ?? SYMBOLS[name] ?? name);
  out = out.replace(/\^\{([^{}]*)\}/g, (_m, g: string) =>
    [...g].map((ch) => SUPERSCRIPTS[ch] ?? ch).join(''),
  );
  out = out.replace(/\^(\w)/g, (_m, ch: string) => SUPERSCRIPTS[ch] ?? `^${ch}`);
  out = out.replace(/_\{([^{}]*)\}/g, (_m, g: string) =>
    [...g].map((ch) => SUBSCRIPTS[ch] ?? ch).join(''),
  );
  out = out.replace(/_(\w)/g, (_m, ch: string) => SUBSCRIPTS[ch] ?? `_${ch}`);
  out = out.replace(/\\[,;:!]/g, ' ');
  out = out.replace(/\\[()[\]]/g, '');
  out = out.replace(/\\/g, '');
  out = out.replace(/[{}]/g, '');
  return out.replace(/\s+/g, ' ').trim();
}

