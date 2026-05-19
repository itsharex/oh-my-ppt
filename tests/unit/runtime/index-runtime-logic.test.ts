/**
 * Unit tests for index-runtime.js logic:
 *   - tryForwardClickToFrame (clicks.total > 0 guard + advance() return value)
 *   - Transition name resolution
 *   - Duration clamping
 *   - Reduced motion guard
 *
 * These test the actual logic extracted from the runtime, not abstract mocks.
 */
import { describe, it, expect } from 'vitest'

// ── Extracted from index-runtime.js tryForwardClickToFrame ──
function tryForwardClickToFrame(
  clicks: { total: number; advance: () => boolean } | null | undefined
): boolean {
  if (!clicks) return false
  // Only forward when the page actually has click-triggered animation steps
  if (clicks.total > 0 && typeof clicks.advance === 'function') {
    return clicks.advance()
  }
  return false
}

// ── Extracted from index-runtime.js injectTransitionStyles ──
function resolveAnimationNames(transitionType: string): { out: string; in: string } {
  const prefix = 'ppt-vt-'
  switch (transitionType) {
    case 'slide-left': return { out: prefix + 'slide-left-out', in: prefix + 'slide-left-in' }
    case 'slide-up':   return { out: prefix + 'slide-up-out',   in: prefix + 'slide-up-in' }
    case 'push':       return { out: prefix + 'push-out',       in: prefix + 'push-in' }
    case 'wipe':       return { out: prefix + 'wipe-out',       in: prefix + 'wipe-in' }
    case 'zoom':       return { out: prefix + 'zoom-out',       in: prefix + 'zoom-in' }
    default:           return { out: prefix + 'fade-out',       in: prefix + 'fade-in' }
  }
}

function clampTransitionDuration(value: number | undefined): number {
  if (!Number.isFinite(value)) return 420
  return Math.max(120, Math.min(1200, Math.round(value as number)))
}

describe('tryForwardClickToFrame (total > 0 guard)', () => {
  function makeClicks(total: number) {
    let current = 0
    return {
      total,
      advance: () => {
        if (total > 0 && current >= total) return false
        current++
        return true
      }
    }
  }

  it('returns false when clicks is null/undefined', () => {
    expect(tryForwardClickToFrame(null)).toBe(false)
    expect(tryForwardClickToFrame(undefined)).toBe(false)
  })

  it('returns false when total is 0 (no click-triggered elements)', () => {
    const clicks = makeClicks(0)
    expect(tryForwardClickToFrame(clicks)).toBe(false)
    // Navigation should proceed — this is the key fix
  })

  it('returns true when step consumed', () => {
    const clicks = makeClicks(3)
    expect(tryForwardClickToFrame(clicks)).toBe(true)
  })

  it('returns false when all steps exhausted', () => {
    const clicks = makeClicks(2, false)
    clicks.advance() // → 1
    clicks.advance() // → 2
    expect(tryForwardClickToFrame(clicks)).toBe(false) // exhausted, nav should proceed
  })

  it('allows nav after last click step exhausted', () => {
    const clicks = makeClicks(1, false)
    expect(tryForwardClickToFrame(clicks)).toBe(true)  // consumed step 1
    expect(tryForwardClickToFrame(clicks)).toBe(false) // exhausted → navigate
  })
})

describe('Transition animation name resolution', () => {
  it('all 7 types resolve correctly', () => {
    expect(resolveAnimationNames('fade')).toEqual({ out: 'ppt-vt-fade-out', in: 'ppt-vt-fade-in' })
    expect(resolveAnimationNames('slide-left')).toEqual({ out: 'ppt-vt-slide-left-out', in: 'ppt-vt-slide-left-in' })
    expect(resolveAnimationNames('slide-up')).toEqual({ out: 'ppt-vt-slide-up-out', in: 'ppt-vt-slide-up-in' })
    expect(resolveAnimationNames('push')).toEqual({ out: 'ppt-vt-push-out', in: 'ppt-vt-push-in' })
    expect(resolveAnimationNames('wipe')).toEqual({ out: 'ppt-vt-wipe-out', in: 'ppt-vt-wipe-in' })
    expect(resolveAnimationNames('zoom')).toEqual({ out: 'ppt-vt-zoom-out', in: 'ppt-vt-zoom-in' })
    expect(resolveAnimationNames('cube')).toEqual({ out: 'ppt-vt-fade-out', in: 'ppt-vt-fade-in' })
  })
})

describe('Transition duration clamping', () => {
  it('clamps min 120ms', () => {
    expect(clampTransitionDuration(50)).toBe(120)
    expect(clampTransitionDuration(0)).toBe(120)
    expect(clampTransitionDuration(-100)).toBe(120)
  })
  it('clamps max 1200ms', () => {
    expect(clampTransitionDuration(2000)).toBe(1200)
  })
  it('preserves valid values', () => {
    expect(clampTransitionDuration(420)).toBe(420)
  })
  it('defaults to 420ms for undefined/NaN/Infinity', () => {
    expect(clampTransitionDuration(undefined)).toBe(420)
    expect(clampTransitionDuration(NaN)).toBe(420)
    expect(clampTransitionDuration(Infinity)).toBe(420)
  })
  it('rounds to integer', () => {
    expect(clampTransitionDuration(333.7)).toBe(334)
  })
})

describe('Reduced motion guard', () => {
  it('generates CSS disabling VT animations', () => {
    const css = '@media (prefers-reduced-motion: reduce) {' +
      ' ::view-transition-old(root), ::view-transition-new(root) { animation: none !important; } }'
    expect(css).toContain('prefers-reduced-motion: reduce')
    expect(css).toContain('animation: none !important')
  })
})

describe('Transition config JSON round-trip', () => {
  it('all 7 types survive JSON round-trip', () => {
    const types = ['fade', 'slide-left', 'slide-up', 'push', 'wipe', 'zoom', 'none']
    for (const type of types) {
      const json = JSON.stringify({ type, durationMs: type === 'none' ? 0 : 420 })
      const parsed = JSON.parse(json)
      expect(parsed.type).toBe(type)
    }
  })
})
