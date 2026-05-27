import { describe, expect, it } from 'vitest'
import { parsePptxSlideAnimationPlan } from '../../src/main/utils/pptx-animation-import'

describe('parsePptxSlideAnimationPlan', () => {
  it('maps native PPT timing targets to importable data-anim entries', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:nvSpPr><p:cNvPr id="7" name="标题文本"/></p:nvSpPr>
        <p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="1828800" cy="914400"/></a:xfrm></p:spPr>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:timing>
    <p:tnLst>
      <p:par>
        <p:cTn id="1" dur="indefinite" nodeType="tmRoot">
          <p:childTnLst>
            <p:par>
              <p:cTn id="5" presetID="2" presetClass="entr" presetSubtype="8" nodeType="withEffect">
                <p:stCondLst><p:cond delay="250"/></p:stCondLst>
                <p:childTnLst>
                  <p:anim>
                    <p:cBhvr><p:cTn id="6" dur="700"/><p:tgtEl><p:spTgt spid="7"/></p:tgtEl></p:cBhvr>
                  </p:anim>
                </p:childTnLst>
              </p:cTn>
            </p:par>
          </p:childTnLst>
        </p:cTn>
      </p:par>
    </p:tnLst>
  </p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, { cx: 9144000, cy: 5143500 }, { width: 960, height: 540 })

    expect(plan.animations).toHaveLength(1)
    expect(plan.animations[0]).toMatchObject({
      type: 'fade-up',
      trigger: 'load',
      duration: 700,
      delay: 250,
      sourceId: '7',
      sourceName: '标题文本'
    })
    expect(plan.byName.get('标题文本')?.[0]).toBe(plan.animations[0])
    expect(plan.animations[0].x).toBeCloseTo(96)
  })

  it('preserves click-triggered scale effects', () => {
    const xml = `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree><p:sp><p:nvSpPr><p:cNvPr id="3" name="Icon"/></p:nvSpPr></p:sp></p:spTree></p:cSld>
  <p:timing><p:tnLst><p:par><p:cTn id="9" presetID="31" presetClass="entr" nodeType="clickEffect">
    <p:childTnLst><p:animScale><p:cBhvr><p:cTn id="10" dur="400"/><p:tgtEl><p:spTgt spid="3"/></p:tgtEl></p:cBhvr></p:animScale></p:childTnLst>
  </p:cTn></p:par></p:tnLst></p:timing>
</p:sld>`

    const plan = parsePptxSlideAnimationPlan(xml, null, { width: 960, height: 540 })

    expect(plan.animations[0]).toMatchObject({
      type: 'scale-in',
      trigger: 'click',
      duration: 400,
      sourceName: 'Icon'
    })
  })
})
