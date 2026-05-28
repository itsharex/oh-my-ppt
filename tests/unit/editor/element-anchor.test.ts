import { describe, expect, it } from 'vitest'

import {
  ensureElementAnchorInHtml,
  patchGenericElementProperties
} from '../../../src/main/ipc/editor/shared'

describe('ensureElementAnchorInHtml', () => {
  it('keeps an existing block id only when it is unique', () => {
    const html = `
      <html><body data-page-id="page">
        <main data-block-id="content" data-role="content">
          <p data-block-id="text">first</p>
          <p data-block-id="text">second</p>
        </main>
      </body></html>
    `

    const result = ensureElementAnchorInHtml(html, {
      pageId: 'page',
      selector: 'body[data-page-id="page"] main > p:nth-child(2)',
      elementTag: 'p'
    })

    expect(result.changed).toBe(true)
    expect(result.blockId).not.toBe('text')
    expect(result.selector).toBe(`body[data-page-id="page"] [data-block-id="${result.blockId}"]`)
    expect(result.html).toContain(`<p data-block-id="${result.blockId}">second</p>`)
  })

})

describe('patchGenericElementProperties rich text', () => {
  it('updates inline rich text without flattening spans', () => {
    const html = `
      <html><body data-page-id="page">
        <p data-block-id="text"><span style="color:#FB4526" data-block-id="text-1">南欧</span>旧文字</p>
      </body></html>
    `

    const result = patchGenericElementProperties(
      html,
      'body[data-page-id="page"] [data-block-id="text"]',
      {
        html: '<span style="color:#FB4526" data-block-id="text-1">南欧</span>新文字'
      }
    )

    expect(result).toContain(
      '<span style="color:#FB4526" data-block-id="text-1">南欧</span>新文字'
    )
  })

  it('strips editor-only zoom from rich text before writing html', () => {
    const html = `
      <html><body data-page-id="page">
        <p data-block-id="text">旧文字</p>
      </body></html>
    `

    const result = patchGenericElementProperties(
      html,
      'body[data-page-id="page"] [data-block-id="text"]',
      {
        html: '<span style="zoom: 0.5; color: #FB4526; font-size: 60px">新文字</span>'
      }
    )

    expect(result).toContain('<span style="color: #FB4526; font-size: 60px">新文字</span>')
    expect(result).not.toContain('zoom')
  })

  it('can update a bare text node by parent selector and child node index', () => {
    const html = `
      <html><body data-page-id="page">
        <p data-block-id="text"><span data-block-id="text-1">南欧</span>旧文字</p>
      </body></html>
    `

    const result = patchGenericElementProperties(
      html,
      'body[data-page-id="page"] [data-block-id="text"]',
      {
        text: '新文字',
        textTarget: {
          type: 'text-node',
          parentSelector: 'body[data-page-id="page"] [data-block-id="text"]',
          textNodeIndex: 1
        }
      }
    )

    expect(result).toContain('<span data-block-id="text-1">南欧</span>新文字')
  })
})
