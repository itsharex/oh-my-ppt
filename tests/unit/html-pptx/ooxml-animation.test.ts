import { describe, expect, it } from 'vitest'
import { buildSlideXml } from '../../../src/main/utils/html-pptx/ooxml-writer'
import type { HtmlToPptxSlide } from '../../../src/main/utils/html-pptx/types'

describe('buildSlideXml animation export', () => {
  it('binds one data-anim container trace to every exported shape inside it', () => {
    const slide: HtmlToPptxSlide = {
      texts: [
        { text: 'Title', x: 1, y: 0.5, w: 6, h: 0.8, fontSize: 36 },
        { text: 'Body', x: 1.2, y: 2, w: 5.5, h: 0.8, fontSize: 20 }
      ],
      shapes: [],
      images: [],
      tables: [],
      animationTraces: [
        {
          type: 'fade-up',
          trigger: 'load',
          duration: 500,
          delay: 100,
          order: 0,
          x: 100,
          y: 40,
          w: 800,
          h: 320
        }
      ]
    }

    const xml = buildSlideXml(slide, new Map(), 1)

    expect(xml).toContain('<p:timing>')
    expect(xml).toContain('<p:bldP spid="2" grpId="0"/>')
    expect(xml).toContain('<p:bldP spid="3" grpId="0"/>')
    expect(xml).toContain('<p:spTgt spid="2"/>')
    expect(xml).toContain('<p:spTgt spid="3"/>')
  })

  it('keeps transition and timing after clrMapOvr for valid slide child ordering', () => {
    const slide: HtmlToPptxSlide = {
      texts: [{ text: 'Slide', x: 1, y: 1, w: 5, h: 1, fontSize: 24 }],
      shapes: [],
      images: [],
      tables: [],
      transitionType: 'fade',
      transitionDurationMs: 600,
      animationTraces: [
        {
          type: 'fade',
          trigger: 'load',
          duration: 400,
          delay: 0,
          order: 0,
          x: 100,
          y: 100,
          w: 700,
          h: 150
        }
      ]
    }

    const xml = buildSlideXml(slide, new Map(), 1)

    expect(xml.indexOf('<p:cSld>')).toBeLessThan(xml.indexOf('<p:clrMapOvr>'))
    expect(xml.indexOf('<p:clrMapOvr>')).toBeLessThan(xml.indexOf('<p:transition'))
    expect(xml.indexOf('<p:transition')).toBeLessThan(xml.indexOf('<p:timing>'))
  })

  it('can target overlay images such as formula screenshots', () => {
    const dataUri = 'data:image/png;base64,abc'
    const slide: HtmlToPptxSlide = {
      texts: [],
      shapes: [],
      images: [],
      tables: [],
      overlayImages: [
        {
          dataUri,
          mimeType: 'image/png',
          x: 2,
          y: 2,
          w: 2,
          h: 1
        }
      ],
      animationTraces: [
        {
          type: 'fade',
          trigger: 'load',
          duration: 400,
          delay: 0,
          order: 0,
          x: 240,
          y: 240,
          w: 240,
          h: 120
        }
      ]
    }

    const xml = buildSlideXml(slide, new Map([[dataUri, { rId: 'rId1', mediaFile: 'image1.png' }]]), 1)

    expect(xml).toContain('<p:pic>')
    expect(xml).toContain('<p:bldP spid="2" grpId="0"/>')
    expect(xml).toContain('<p:spTgt spid="2"/>')
  })
})
