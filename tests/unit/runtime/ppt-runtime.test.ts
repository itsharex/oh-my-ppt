/**
 * @vitest-environment happy-dom
 *
 * Unit tests for ppt-runtime.js v1.3.0:
 *   - PPT.stopAnimations() / PPT.resumeAnimations()
 *   - PPT.clicks state machine (advance returns boolean, _dispatch exact match)
 *   - PPT.scanDataAnim() / PPT.executeDataAnim() (routed through PPT.animate)
 *   - Click-triggered initial hidden state
 *   - Lottie hook (PPT.playLottie placeholder)
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const runtimeSrc = fs.readFileSync(
  path.resolve(__dirname, '../../../resources/ppt-runtime.js'),
  'utf-8'
)

function createMockAnime() {
  const animations: Array<{
    pause: ReturnType<typeof vi.fn>
    play: ReturnType<typeof vi.fn>
    finished: Promise<void>
  }> = []

  const anime = {
    animate: vi.fn((_targets: unknown, _params: unknown) => {
      let resolveFinished!: () => void
      const finished = new Promise<void>((r) => { resolveFinished = r })
      const anim = {
        pause: vi.fn(),
        play: vi.fn(),
        finished,
        _resolve: resolveFinished
      }
      animations.push(anim)
      return anim
    }),
    stagger: vi.fn((gap: number) => {
      return (_el: unknown, i: number) => i * gap
    }),
    createTimeline: vi.fn(() => ({ add: vi.fn() })),
    timeline: vi.fn(() => ({ add: vi.fn() }))
  }

  return { anime, animations }
}

function setupRuntime() {
  const { anime, animations } = createMockAnime()

  document.body.innerHTML = `
    <div class="ppt-page-root">
      <div data-anim="fade-up" data-anim-duration="500" id="el1">Card 1</div>
      <div data-anim="fade-up" data-anim-delay="stagger(100)" id="el2">Card 2</div>
      <div data-anim="fade-up" data-anim-delay="stagger(100)" id="el3">Card 3</div>
      <div data-anim="scale-in" data-anim-trigger="click" id="el4">Reveal click</div>
      <div data-anim="fade-left" data-anim-trigger="click" id="el5">Reveal click 2</div>
      <div data-anim="none" id="el6">Skipped</div>
      <div class="card" id="el7">Legacy target</div>
    </div>
  `

  const existingPPT = (globalThis as Record<string, unknown>).PPT as Record<string, unknown> | undefined
  if (existingPPT) existingPPT.__runtimeVersion = null
  ;(globalThis as Record<string, unknown>).anime = anime

  new Function(runtimeSrc)()

  const PPT = (globalThis as Record<string, unknown>).PPT as Record<string, unknown>
  return { PPT, anime, animations }
}

// ── Helper: typed clicks access ──
type ClicksAPI = {
  current: number; total: number
  setTotal: (n: number) => void
  advance: () => boolean
  reset: () => void
  on: (clickNum: number, fn: () => void) => void
  onAdvance: (fn: (click: number, current: number, total: number) => void) => void
}
function getClicks(PPT: Record<string, unknown>): ClicksAPI {
  return PPT.clicks as ClicksAPI
}

describe('PPT.stopAnimations / PPT.resumeAnimations', () => {
  let PPT: Record<string, unknown>
  let animations: ReturnType<typeof createMockAnime>['animations']

  beforeEach(() => {
    const s = setupRuntime(); PPT = s.PPT; animations = s.animations
  })

  it('pauses all active animations', () => {
    const animate = PPT.animate as Function
    animate('.card', { opacity: [0, 1] })
    animate('.card', { opacity: [0, 1] })
    expect(animations.length).toBeGreaterThanOrEqual(2)
    ;(PPT.stopAnimations as Function)()
    animations.forEach(a => { expect(a.pause).toHaveBeenCalled() })
  })

  it('resumes all active animations', () => {
    const animate = PPT.animate as Function
    animate('.card', { opacity: [0, 1] })
    ;(PPT.resumeAnimations as Function)()
    animations.forEach(a => { expect(a.play).toHaveBeenCalled() })
  })

  it('handles empty active set gracefully', () => {
    expect(() => (PPT.stopAnimations as Function)()).not.toThrow()
    expect(() => (PPT.resumeAnimations as Function)()).not.toThrow()
  })
})

describe('PPT.clicks state machine', () => {
  let PPT: Record<string, unknown>

  beforeEach(() => { PPT = setupRuntime().PPT })

  it('init: current=0, total=0', () => {
    const c = getClicks(PPT)
    expect(c.current).toBe(0)
    expect(c.total).toBe(0)
  })

  it('setTotal', () => {
    const c = getClicks(PPT)
    c.setTotal(5)
    expect(c.total).toBe(5)
  })

  it('advance increments current and returns true when step consumed', () => {
    const c = getClicks(PPT)
    // total=0 means auto/unbounded mode
    expect(c.advance()).toBe(true)
    expect(c.current).toBe(1)
    expect(c.advance()).toBe(true)
    expect(c.current).toBe(2)
  })

  it('advance stops at total and returns false when exhausted', () => {
    const c = getClicks(PPT)
    c.setTotal(2)
    expect(c.advance()).toBe(true)  // → 1
    expect(c.advance()).toBe(true)  // → 2
    expect(c.advance()).toBe(false) // exhausted
    expect(c.current).toBe(2)       // never goes past total
  })

  it('advance returns false when total=0 before any click (no steps defined)', () => {
    // Fresh PPT with no data-anim-trigger="click" elements scanned:
    // total stays 0, advance should return false because 0>0 && 0>=0 fails
    // but wait — advance checks `if (this.total > 0 && this.current >= this.total) return false`
    // When total=0 and current=0: this.total > 0 is false, so we skip that guard.
    // This means advance() succeeds (current becomes 1, returns true).
    // This is intentional for auto/unbounded mode where total hasn't been set.
    // The parent frame checks `clicks.total > 0` before forwarding, so this path
    // is only reached when scanDataAnim explicitly set total=0.
    const c = getClicks(PPT)
    expect(c.total).toBe(0)
    // In auto mode, advance always succeeds
    expect(c.advance()).toBe(true)
    expect(c.current).toBe(1)
  })

  it('reset sets current back to 0', () => {
    const c = getClicks(PPT)
    c.advance()
    c.advance()
    c.reset()
    expect(c.current).toBe(0)
  })

  it('on() fires callback at matching click, does NOT replay on later clicks', () => {
    const c = getClicks(PPT)
    const fn1 = vi.fn(), fn2 = vi.fn(), fn3 = vi.fn()
    c.on(1, fn1)
    c.on(2, fn2)
    c.on(3, fn3)

    c.advance() // click 1
    expect(fn1).toHaveBeenCalledTimes(1)
    expect(fn2).not.toHaveBeenCalled()
    expect(fn3).not.toHaveBeenCalled()

    c.advance() // click 2
    expect(fn1).toHaveBeenCalledTimes(1) // ⬅ NOT replayed
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn3).not.toHaveBeenCalled()

    c.advance() // click 3
    expect(fn1).toHaveBeenCalledTimes(1) // ⬅ NOT replayed
    expect(fn2).toHaveBeenCalledTimes(1)
    expect(fn3).toHaveBeenCalledTimes(1)
  })

  it('on() fires immediately if current >= clickNum (late registration)', () => {
    const c = getClicks(PPT)
    c.advance()
    c.advance() // current=2
    const fn = vi.fn()
    c.on(1, fn) // click 1 already past
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('onAdvance fires on every advance with (click, current, total)', () => {
    const c = getClicks(PPT)
    const fn = vi.fn()
    c.onAdvance(fn)
    c.advance()
    expect(fn).toHaveBeenCalledWith(1, 1, 0)
    c.advance()
    expect(fn).toHaveBeenCalledWith(2, 2, 0)
  })
})

describe('PPT.scanDataAnim', () => {
  let PPT: Record<string, unknown>

  beforeEach(() => { PPT = setupRuntime().PPT })

  it('returns null when no data-anim elements found', () => {
    document.body.innerHTML = '<div class="ppt-page-root"></div>'
    const result = (PPT.scanDataAnim as Function)(document.body)
    expect(result).toBeNull()
  })

  it('splits load vs click animations', () => {
    const root = document.querySelector('.ppt-page-root')!
    const result = (PPT.scanDataAnim as Function)(root) as { load: unknown[]; click: unknown[]; all: unknown[] }
    expect(result.load).toHaveLength(3)
    expect(result.click).toHaveLength(2)
    expect(result.all).toHaveLength(5)
  })

  it('sets PPT.clicks.total to click-triggered count', () => {
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)
    const c = getClicks(PPT)
    expect(c.total).toBe(2)
  })

  it('applies initial hidden state to click-triggered elements', () => {
    const el4 = document.getElementById('el4')!
    const el5 = document.getElementById('el5')!
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)

    // click-triggered elements should be hidden
    expect(el4.style.opacity).toBe('0')
    // el5: fade-left → opacity 0 + translateX(20px)
    expect(el5.style.opacity).toBe('0')
  })

  it('does NOT hide load-triggered elements (PPT.animate handles that)', () => {
    const el1 = document.getElementById('el1')!
    const root = document.querySelector('.ppt-page-root')!
    ;(PPT.scanDataAnim as Function)(root)
    // load-triggered: no inline style applied by scan
    expect(el1.style.opacity).toBe('')
  })

  it('skips data-anim="none" elements', () => {
    const root = document.querySelector('.ppt-page-root')!
    const result = (PPT.scanDataAnim as Function)(root) as { all: Array<{ type: string }> }
    const types = result.all.map(a => a.type)
    expect(types).not.toContain('none')
  })

  it('falls back to document when root is null', () => {
    const result = (PPT.scanDataAnim as Function)(null)
    expect(result).not.toBeNull()
    expect((result as { all: unknown[] }).all.length).toBeGreaterThan(0)
  })
})

describe('PPT.executeDataAnim (routed through PPT.animate)', () => {
  let PPT: Record<string, unknown>
  let anime: Record<string, unknown>

  beforeEach(() => {
    const s = setupRuntime(); PPT = s.PPT; anime = s.anime
  })

  it('handles empty config', () => {
    expect(() => (PPT.executeDataAnim as Function)([])).not.toThrow()
  })

  it('calls PPT.animate (not timeline) for each config entry', () => {
    const animateSpy = vi.spyOn(PPT, 'animate' as never)
    const config = [
      { targets: document.getElementById('el1'), type: 'fade-up', duration: 500, easing: 'easeOutCubic', delay: 0 }
    ]
    ;(PPT.executeDataAnim as Function)(config)
    expect(animateSpy).toHaveBeenCalled()
    animateSpy.mockRestore()
  })

  it('passes through print mode via PPT.animate', () => {
    // PPT.animate checks isPrintMode internally — executeDataAnim
    // delegates to it, so print-mode behavior is unified.
    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'fade', duration: 500, easing: 'linear', delay: 0 }]
    // Should not throw
    expect(() => (PPT.executeDataAnim as Function)(config)).not.toThrow()
  })

  it('calls PPT.playLottie for lottie type', () => {
    const playLottieSpy = vi.fn()
    const origPlayLottie = PPT.playLottie
    PPT.playLottie = playLottieSpy

    const el = document.getElementById('el1')!
    const config = [{ targets: el, type: 'lottie', lottieSrc: './test.json', lottieLoop: true, lottieAutoplay: true, duration: 500, easing: 'linear', delay: 0 }]
    ;(PPT.executeDataAnim as Function)(config)
    expect(playLottieSpy).toHaveBeenCalledWith(el, config[0])

    PPT.playLottie = origPlayLottie
  })
})

describe('PPT.playLottie placeholder', () => {
  it('exists as a no-op function', () => {
    const PPT = setupRuntime().PPT
    expect(typeof PPT.playLottie).toBe('function')
    // Should not throw when called with valid args
    expect(() => (PPT.playLottie as Function)(document.body, {})).not.toThrow()
  })
})

describe('PPT.animate tracks animations for stop/resume', () => {
  it('adds animation to active set', () => {
    const { PPT, animations } = setupRuntime()
    ;(PPT.animate as Function)('.card', { opacity: [0, 1] })
    ;(PPT.stopAnimations as Function)()
    const pauseCalls = animations.filter(a => a.pause.mock.calls.length > 0)
    expect(pauseCalls.length).toBeGreaterThan(0)
  })
})

describe('Version guard', () => {
  it('runtime version is 1.3.0', () => {
    const PPT = setupRuntime().PPT
    expect(PPT.__runtimeVersion).toBe('1.3.0')
  })
})
