import { ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import * as cheerio from 'cheerio'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import log from 'electron-log/main.js'
import type { IpcContext } from '../context'
import { resolveActiveModelConfig } from '../config/model-config-utils'
import { resolveModel } from '../../agent'
import { readAppLocale, uiText } from '../config/locale-utils'

export type SpeechLength = 'short' | 'medium' | 'long'
export type SpeechStyle = 'formal' | 'conversational' | 'storytelling'

const SPEECH_SCRIPT_FILE = 'speech-script.md'

function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html, { scriptingEnabled: false })
  $('script, style').remove()
  return $('body').text().replace(/\s+/g, ' ').trim()
}

function buildLengthInstruction(length: SpeechLength, isZh: boolean): string {
  if (isZh) {
    switch (length) {
      case 'short':
        return '演讲内容约100-150字，控制在1分钟以内。'
      case 'long':
        return '演讲内容约400-500字，详细展开，约3-4分钟。'
      default:
        return '演讲内容约200-300字，约2分钟。'
    }
  } else {
    switch (length) {
      case 'short':
        return 'Keep the section to ~100-150 words, around 1 minute.'
      case 'long':
        return 'Write ~400-500 words with rich detail, around 3-4 minutes.'
      default:
        return 'Write ~200-300 words, around 2 minutes.'
    }
  }
}

function buildStyleInstruction(style: SpeechStyle, isZh: boolean): string {
  if (isZh) {
    switch (style) {
      case 'formal':
        return '语气正式、专业，适合商务或学术场合，避免口语化表达。'
      case 'storytelling':
        return '采用叙事风格，以故事或案例引入，有情节感和情感共鸣，吸引听众注意力。'
      default:
        return '语气轻松自然，口语化，像和听众对话一样，亲切易懂。'
    }
  } else {
    switch (style) {
      case 'formal':
        return 'Use a formal, professional tone suitable for business or academic settings. Avoid colloquialisms.'
      case 'storytelling':
        return 'Use a storytelling approach — open with a story or case study, build narrative flow, and engage emotions.'
      default:
        return 'Use a relaxed, conversational tone as if speaking directly to the audience. Keep it approachable and natural.'
    }
  }
}

export function registerSpeechHandlers(ctx: IpcContext): void {
  ipcMain.handle('speech:generateScript', async (event, payload) => {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
    if (!sessionId) throw new Error('Session ID is required')

    const length: SpeechLength =
      payload?.length === 'short' || payload?.length === 'long' ? payload.length : 'medium'
    const style: SpeechStyle =
      payload?.style === 'formal' || payload?.style === 'storytelling' ? payload.style : 'conversational'

    const locale = await readAppLocale(ctx)
    const isZh = locale === 'zh'

    const session = await ctx.db.getSession(sessionId)
    if (!session) {
      throw new Error(uiText(locale, '找不到会话', 'Session not found'))
    }

    const pages = await ctx.db.listSessionPages(sessionId)
    if (pages.length === 0) {
      throw new Error(uiText(locale, '该会话没有幻灯片页面', 'No pages found in this session'))
    }

    const projectDir = await ctx.resolveSessionProjectDir(sessionId)

    const slideContents: Array<{ pageNumber: number; title: string; text: string }> = []
    for (const p of pages) {
      if (!p.html_path) continue
      if (!ctx.isPathInside(p.html_path, projectDir)) {
        log.warn('[speech] skipping page with unsafe htmlPath', { htmlPath: p.html_path, projectDir })
        continue
      }
      try {
        const html = await fs.promises.readFile(p.html_path, 'utf-8')
        const text = extractTextFromHtml(html)
        if (text) {
          slideContents.push({ pageNumber: p.page_number, title: p.title || '', text })
        }
      } catch (err) {
        log.warn('[speech] failed to read page html', { htmlPath: p.html_path, err })
      }
    }

    if (slideContents.length === 0) {
      throw new Error(uiText(locale, '没有可读取的幻灯片内容', 'No readable slide content found'))
    }

    const modelConfig = await resolveActiveModelConfig(ctx)
    const model = resolveModel(
      modelConfig.provider,
      modelConfig.apiKey,
      modelConfig.model,
      modelConfig.baseUrl,
      0.7,
      modelConfig.maxTokens
    )

    const lengthInstruction = buildLengthInstruction(length, isZh)
    const styleInstruction = buildStyleInstruction(style, isZh)
    const total = slideContents.length
    const sessionTitle = session.title || session.topic || (isZh ? '未命名' : 'Untitled')

    const systemPrompt = uiText(
      locale,
      `你是一位专业的演讲稿撰写人。你将逐页为演讲者生成演讲稿。
每次只生成当前一页的演讲内容，以 "## 第N页：标题" 开头。
- ${lengthInstruction}
- ${styleInstruction}
- 如有上一页的结尾提供，请自然衔接过渡语句。`,
      `You are a professional speech writer. You will generate speaker notes one slide at a time.
Each response covers only the current slide, starting with "## Slide N: Title".
- ${lengthInstruction}
- ${styleInstruction}
- If the previous slide's ending is provided, include a natural transition.`
    )

    const scriptParts: string[] = []
    let prevEnding = ''

    for (let i = 0; i < slideContents.length; i++) {
      const slide = slideContents[i]
      const current = i + 1
      event.sender.send('speech:progress', { sessionId, current, total })

      const contextPart = prevEnding
        ? uiText(locale, `上一页结尾：${prevEnding}\n\n`, `Previous slide ending: ${prevEnding}\n\n`)
        : ''

      const userPrompt = uiText(
        locale,
        `${contextPart}演示文稿标题：${sessionTitle}\n当前第${slide.pageNumber}页（共${total}页），标题：${slide.title}\n\n幻灯片内容：\n${slide.text}\n\n请生成本页演讲稿。`,
        `${contextPart}Presentation: ${sessionTitle}\nCurrent slide ${slide.pageNumber} of ${total}: ${slide.title}\n\nSlide content:\n${slide.text}\n\nGenerate the speaker script for this slide.`
      )

      log.info('[speech] generating slide', { sessionId, current, total })

      const response = await model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt)
      ])
      const part =
        typeof response.content === 'string' ? response.content : JSON.stringify(response.content)
      scriptParts.push(part)

      prevEnding = part.slice(-100).replace(/\s+/g, ' ').trim()
    }

    const script = scriptParts.join('\n\n---\n\n')
    const scriptPath = path.join(projectDir, SPEECH_SCRIPT_FILE)
    await fs.promises.writeFile(scriptPath, script, 'utf-8')

    log.info('[speech] script saved', { sessionId, scriptPath })
    return { success: true }
  })

  ipcMain.handle('speech:getScript', async (_event, payload) => {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
    if (!sessionId) throw new Error('Session ID is required')

    const projectDir = await ctx.resolveSessionProjectDir(sessionId)
    const scriptPath = path.join(projectDir, SPEECH_SCRIPT_FILE)

    try {
      const script = await fs.promises.readFile(scriptPath, 'utf-8')
      return { success: true, script }
    } catch {
      return { success: true, script: null }
    }
  })

  ipcMain.handle('speech:clearScript', async (_event, payload) => {
    const sessionId = typeof payload?.sessionId === 'string' ? payload.sessionId.trim() : ''
    if (!sessionId) throw new Error('Session ID is required')

    const projectDir = await ctx.resolveSessionProjectDir(sessionId)
    const scriptPath = path.join(projectDir, SPEECH_SCRIPT_FILE)

    try {
      await fs.promises.unlink(scriptPath)
    } catch {
      // file may not exist
    }
    return { success: true }
  })
}
