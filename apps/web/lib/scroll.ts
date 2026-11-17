/**
 * Viewport helpers for multi-step flows.
 *
 * A step should only be scrolled to when the learner cannot already see it, so
 * a tall window does not jump for no reason.
 */
export interface StepRect {
  top: number;
  bottom: number;
}

/** True when the element sits entirely inside the viewport already. */
export function isFullyVisible(rect: StepRect, viewportHeight: number): boolean {
  return rect.top >= 0 && rect.bottom <= viewportHeight;
}

/** Honour the operating system's reduced-motion preference. */
export function stepScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? 'auto' : 'smooth';
}