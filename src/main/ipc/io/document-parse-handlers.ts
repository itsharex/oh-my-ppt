import { ipcMain } from 'electron'
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import log from 'electron-log/main.js'
import { nanoid } from 'nanoid'
import { resolveModel } from '../../agent'
import { FilesystemBackend, createDeepAgent } from 'deepagents'
import { extractModelText } from '../utils'
import type { IpcContext } from '../context'
import type {
  ParseDocumentPlanPayload,
  ParseImageReferencePayload,
  ParsedDocumentPlanResult,
  PrepareReferenceDocumentPayload,
  PreparedReferenceDocumentResult
} from '@shared/generation'
import { resolveModelTimeoutMs } from '@shared/model-timeout'
import { resolveActiveModelConfig, resolveGlobalModelTimeouts } from '../config/model-config-utils'
import { assertImageWasRead, isImageUnsupportedError } from '../../utils/style-image-import'
import { invokeVisionModelText } from '../../utils/vision-model'
import { normalizeGeneratedPlan as normalizeDocumentPlan } from './document-plan-normalizer'

type PreparedSourceFile = ParsedDocumentPlanResult['files'][number] & {
  originalPath: string
  workspacePath: string
  virtualPath: string
}

const MAX_DOCUMENT_FILES = 1
const MAX_DOCUMENT_SIZE = 10 * 1024 * 1024
const MAX_PAGE_COUNT = 500

const SUPPORTED_EXTENSIONS = new Set(['.md', '.txt', '.text', '.csv', '.docx'])
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}
const NULL_CHAR_PATTERN = new RegExp(String.fromCharCode(0), 'g')
const CJK_PATTERN = /[\u3400-\u9fff]/
const LATIN_WORD_PATTERN = /\b[A-Za-z][A-Za-z'-]{2,}\b/g

class RetryableDocumentPlanQualityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableDocumentPlanQualityError'
  }
}

const require = createRequire(import.meta.url)
const mammoth = require('mammoth') as typeof import('mammoth')
const TurndownService = require('turndown') as new (options?: Record<string, unknown>) => {
  use: (plugin: unknown) => void
  turndown: (html: string) => string
}
const { gfm } = require('@joplin/turndown-plugin-gfm') as { gfm: unknown }

const stripControlChars = (value: string): string =>
  value.replace(NULL_CHAR_PATTERN, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

const compactText = (value: string): string =>
  stripControlChars(value)
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()

const countCjkChars = (value: string): number =>
  Array.from(value).filter((char) => CJK_PATTERN.test(char)).length

const countLatinWords = (value: string): number => value.match(LATIN_WORD_PATTERN)?.length ?? 0

const isMostlyEnglishText = (value: string): boolean => {
  const sample = value.slice(0, 30_000)
  const latinWords = countLatinWords(sample)
  const cjkChars = countCjkChars(sample)
  return latinWords >= 30 && cjkChars <= Math.max(10, latinWords * 0.08)
}

const isMostlyChineseText = (value: string): boolean => {
  const sample = value.slice(0, 30_000)
  const latinWords = countLatinWords(sample)
  const cjkChars = countCjkChars(sample)
  return cjkChars >= 50 && cjkChars > latinWords
}

const ENGLISH_BRIEF_LABEL_PATTERN =
  /(?:^|\n)\s*(?:Presentation\s*goal|Presentationgoal|Audience\s*\/\s*context|Audiencecontext|Core\s*argument|Coreargument|Recommended\s*outline|Recommendedoutline|Per[-\s]*page\s*points|Per-pagepoints|Perpagepoints|Facts\s*\/\s*metrics\s*\/\s*terms\s*to\s*preserve|Facts\/metrics\/termstopreserve|Factsmetricstermstopreserve|Style\s*or\s*expression\s*notes|Styleorexpressionnotes|Page\s*\d{1,2})\s*[:：]/i

const assertPlanLanguageMatchesSource = async (args: {
  file: PreparedSourceFile
  plan: Pick<ParsedDocumentPlanResult, 'topic' | 'briefText'>
  userText: string
}): Promise<void> => {
  if (args.file.type === 'image') return
  if (countCjkChars(args.userText) >= 6) return

  const sourceText = await fs.promises.readFile(args.file.workspacePath, 'utf-8').catch(() => '')
  const outputText = `${args.plan.topic}\n${args.plan.briefText}`

  if (isMostlyEnglishText(sourceText) && countCjkChars(outputText) >= 12) {
    throw new RetryableDocumentPlanQualityError(
      'The source document is primarily English, but topic/briefText were returned in Chinese. Return topic and briefText in English; do not translate the outline into Chinese.'
    )
  }

  if (isMostlyChineseText(sourceText) && ENGLISH_BRIEF_LABEL_PATTERN.test(args.plan.briefText)) {
    throw new RetryableDocumentPlanQualityError(
      '源文档主要是中文，但 briefText 使用了英文结构标签。请用中文结构标签返回，例如：演示目标、受众/场景、核心观点、建议大纲、每页要点、必须保留的事实/指标/术语、风格/表达要求。不要使用 Presentation goal、Audience/context、Core argument、Recommended outline、Per-page points、Page 1 等英文模板标签。'
    )
  }
}

const stripInlineImagesFromHtml = (html: string): string =>
  html.replace(/<img\b[^>]*>/gi, (tag) => {
    const alt = tag.match(/\balt=(["'])(.*?)\1/i)?.[2]?.trim()
    return alt ? `<p>[图片：${alt}]</p>` : ''
  })

const stripMarkdownDataImages = (markdown: string): string =>
  markdown.replace(/!\[[^\]]*]\(data:[^)]+\)/gi, '').replace(/!\[[^\]]*]\(\s*\)/g, '')

const previewValue = (value: unknown, maxLength = 240): string => {
  const source =
    typeof value === 'string'
      ? value
      : value === undefined
        ? ''
        : (() => {
            try {
              return JSON.stringify(value)
            } catch {
              return String(value)
            }
          })()
  const compact = source.replace(/\s+/g, ' ').trim()
  return compact.length > maxLength ? `${compact.slice(0, maxLength)}...` : compact
}

const getObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

const readMessageField = (message: Record<string, unknown>, key: string): unknown => {
  const direct = message[key]
  if (direct !== undefined) return direct
  const kwargs = getObject(message.kwargs)
  if (kwargs && kwargs[key] !== undefined) return kwargs[key]
  return undefined
}

const summarizeToolCall = (
  toolCall: unknown
): {
  id: string
  name: string
  argsPreview: string
  argsLength: number
} | null => {
  const record = getObject(toolCall)
  if (!record) return null
  const functionRecord = getObject(record.function)
  const rawArgs = record.args ?? record.arguments ?? functionRecord?.arguments ?? ''
  const argsText = typeof rawArgs === 'string' ? rawArgs : previewValue(rawArgs, 10_000)
  const name = String(record.name ?? functionRecord?.name ?? '').trim()
  const id = String(record.id ?? record.tool_call_id ?? '').trim()
  if (!name && !id && !argsText) return null
  return {
    id,
    name,
    argsPreview: previewValue(argsText),
    argsLength: argsText.length
  }
}

const logDocumentPlanToolEvents = (
  data: unknown,
  seenToolEvents: Set<string>,
  source: 'updates' | 'messages'
): void => {
  const visitMessage = (message: unknown): void => {
    const record = getObject(message)
    if (!record) return
    const toolCallsSources = [
      readMessageField(record, 'tool_calls'),
      readMessageField(record, 'tool_call_chunks'),
      getObject(readMessageField(record, 'additional_kwargs'))?.tool_calls
    ]
    for (const calls of toolCallsSources) {
      if (!Array.isArray(calls)) continue
      for (const call of calls) {
        const summary = summarizeToolCall(call)
        if (!summary) continue
        const key = `call:${summary.id}:${summary.name}:${summary.argsPreview}`
        if (seenToolEvents.has(key)) continue
        seenToolEvents.add(key)
        log.info('[documents:parsePlan] tool_call', {
          source,
          toolCallId: summary.id || null,
          toolName: summary.name || null,
          argsLength: summary.argsLength,
          argsPreview: summary.argsPreview
        })
      }
    }

    const messageType = String(
      readMessageField(record, 'type') ?? readMessageField(record, 'role') ?? ''
    )
    const toolCallId = String(readMessageField(record, 'tool_call_id') ?? '').trim()
    const toolName = String(readMessageField(record, 'name') ?? '').trim()
    if (toolCallId || messageType === 'tool') {
      const content = readMessageField(record, 'content')
      const contentText = typeof content === 'string' ? content : previewValue(content, 10_000)
      const key = `result:${toolCallId}:${toolName}:${contentText.length}`
      if (!seenToolEvents.has(key)) {
        seenToolEvents.add(key)
        log.info('[documents:parsePlan] tool_result', {
          source,
          toolCallId: toolCallId || null,
          toolName: toolName || null,
          contentLength: contentText.length
        })
      }
    }
  }

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit)
      return
    }
    const record = getObject(value)
    if (!record) return
    if (
      readMessageField(record, 'tool_calls') !== undefined ||
      readMessageField(record, 'tool_call_chunks') !== undefined ||
      readMessageField(record, 'tool_call_id') !== undefined ||
      readMessageField(record, 'role') === 'tool' ||
      readMessageField(record, 'type') === 'tool'
    ) {
      visitMessage(record)
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') visit(nested)
    }
  }

  visit(data)
}

const extractAssistantTextsFromState = (data: unknown): string[] => {
  const texts: string[] = []
  const seenObjects = new Set<object>()

  const visitMessage = (message: unknown): void => {
    const record = getObject(message)
    if (!record) return
    const role = String(readMessageField(record, 'role') ?? '').toLowerCase()
    const type = String(readMessageField(record, 'type') ?? '').toLowerCase()
    const constructorName = String(
      getObject(readMessageField(record, 'lc_kwargs'))?.type ??
        getObject(readMessageField(record, 'kwargs'))?.type ??
        ''
    ).toLowerCase()
    const isAssistant =
      role === 'assistant' || type === 'ai' || type === 'assistant' || constructorName === 'ai'
    const isToolOrHuman =
      role === 'tool' ||
      role === 'user' ||
      role === 'system' ||
      type === 'tool' ||
      type === 'human' ||
      type === 'system'
    if (!isAssistant || isToolOrHuman) return
    const text = extractModelText(record).trim()
    if (text) texts.push(text)
  }

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      const looksLikeMessages = value.some((item) => {
        const record = getObject(item)
        if (!record) return false
        return (
          readMessageField(record, 'content') !== undefined &&
          (readMessageField(record, 'role') !== undefined ||
            readMessageField(record, 'type') !== undefined ||
            readMessageField(record, 'tool_calls') !== undefined)
        )
      })
      if (looksLikeMessages) value.forEach(visitMessage)
      value.forEach(visit)
      return
    }
    const record = getObject(value)
    if (!record) return
    if (seenObjects.has(record)) return
    seenObjects.add(record)
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object') visit(nested)
    }
  }

  visit(data)
  return texts
}

const convertDocxToMarkdown = async (filePath: string): Promise<string> => {
  const result = await mammoth.convertToHtml({ path: filePath })
  if (result.messages.length > 0) {
    log.info('[documents:parsePlan] mammoth warnings', {
      filePath,
      messages: result.messages.map((message) => message.message)
    })
  }
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced'
  })
  turndown.use(gfm)
  return compactText(
    stripMarkdownDataImages(turndown.turndown(stripInlineImagesFromHtml(result.value)))
  )
}

const toSafeFileName = (value: string): string =>
  value
    .replace(/[\\/:"*?<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'source'

const prepareSourceFile = async (
  file: { path?: unknown; name?: unknown },
  workspaceDir: string
): Promise<PreparedSourceFile> => {
  const rawPath = typeof file.path === 'string' ? file.path.trim() : ''
  if (!rawPath) throw new Error('无法读取文档路径')
  const filePath = path.resolve(rawPath)
  const stat = await fs.promises.stat(filePath)
  if (!stat.isFile()) throw new Error(`文档不是文件: ${filePath}`)
  if (stat.size > MAX_DOCUMENT_SIZE) throw new Error('单个文档不能超过 10MB')

  const ext = path.extname(filePath).toLowerCase()
  const isImage = SUPPORTED_IMAGE_EXTENSIONS.has(ext)
  if (!SUPPORTED_EXTENSIONS.has(ext) && !isImage) {
    throw new Error('暂只支持 md、txt、csv、docx 文档，以及 png、jpg、jpeg、webp 图片')
  }
  log.info('[documents:parsePlan] read source file', {
    fileName: path.basename(filePath),
    extension: ext,
    size: stat.size
  })

  const name =
    typeof file.name === 'string' && file.name.trim().length > 0
      ? file.name.trim()
      : path.basename(filePath)
  const type: PreparedSourceFile['type'] =
    isImage
      ? 'image'
      : ext === '.docx'
        ? 'docx'
        : ext === '.md'
          ? 'markdown'
          : ext === '.csv'
            ? 'csv'
            : 'text'

  const safeBaseName = toSafeFileName(path.basename(name, ext))
  const stamp = Date.now()
  const uniqueId = nanoid(8)
  const workspaceName =
    ext === '.docx'
      ? `${stamp}-${uniqueId}-${safeBaseName || 'source'}.md`
      : `${stamp}-${uniqueId}-${safeBaseName}${ext}`
  const workspacePath = path.join(workspaceDir, workspaceName)
  let characterCount = stat.size

  if (isImage) {
    if (path.resolve(filePath) !== path.resolve(workspacePath)) {
      await fs.promises.copyFile(filePath, workspacePath)
    }
    log.info('[documents:parsePlan] image source prepared for vision', {
      originalName: name,
      workspaceName,
      size: stat.size
    })
  } else if (ext === '.docx') {
    const markdown = await convertDocxToMarkdown(filePath)
    if (!markdown) throw new Error(`${name} 未解析出可用文本`)
    await fs.promises.writeFile(
      workspacePath,
      [
        `# ${path.basename(name, ext)}`,
        '',
        '> Converted from Word .docx for agent reading. Inline images were omitted; image alt text may be preserved when available.',
        '',
        markdown
      ].join('\n'),
      'utf-8'
    )
    characterCount = markdown.length
    log.info('[documents:parsePlan] docx converted for reading', {
      originalName: name,
      workspaceName,
      characterCount
    })
  } else {
    if (path.resolve(filePath) !== path.resolve(workspacePath)) {
      await fs.promises.copyFile(filePath, workspacePath)
    }
    log.info('[documents:parsePlan] text source prepared for reading', {
      originalName: name,
      workspaceName,
      characterCount
    })
  }

  return {
    name,
    type,
    characterCount,
    path: workspacePath,
    originalPath: filePath,
    workspacePath,
    virtualPath: `/${workspaceName}`
  }
}

const buildDocumentPlanPrompt = (args: {
  topic: string
  pageCount: number | null
  existingBrief: string
  file: PreparedSourceFile
  retryHint?: string
}): string =>
  [
    'Use the filesystem tool to read the uploaded document and produce the fixed structure needed by the PPT creation form.',
    'This is a source-grounded extraction task, not a creative planning task. The output must stay tightly bound to the source document.',
    '',
    'Return only a JSON object. Do not return Markdown, explanations, or extra fields.',
    'Use exactly these fields: topic, pageCount, briefText.',
    '',
    'Output language rules:',
    '- First determine the dominant language of the source document and the latest user-provided topic/brief.',
    '- If the user explicitly asks for a language, use that language.',
    '- Otherwise, topic and briefText must use the dominant language of the source document.',
    '- If the source document is primarily English, topic and briefText must be written in English. Do not translate the outline into Chinese.',
    '- If the source document is primarily Chinese, topic and briefText must be written in Chinese.',
    '- The section labels inside briefText must also use the selected output language. For Chinese output, use Chinese labels such as 演示目标、受众/场景、核心观点、建议大纲、每页要点、必须保留的事实/指标/术语、风格/表达要求.',
    '- Do not use English template labels such as Presentation goal, Audience/context, Core argument, Recommended outline, Per-page points, Facts/metrics/terms to preserve, or Style or expression notes when the source document is Chinese.',
    '- Keep proper nouns, product names, technical terms, quoted text, and metrics in their original form when appropriate.',
    '',
    'Field rules:',
    '- topic: a concise title suitable for the creation form topic input, in the selected output language.',
    `- pageCount: an integer suitable for the creation form page-count input, from 1 to ${MAX_PAGE_COUNT}.`,
    '- IMPORTANT: pageCount means the target number of PPT slides to generate. It is NOT the number of uploaded files, NOT the number of source-document pages, and NOT the number of pages/screens shown in the source.',
    '- Use pageCount=1 only when the source is extremely short and contains one single presentation point. For ordinary multi-section documents, infer a multi-slide deck, usually at least 4-8 slides depending on density.',
    '- briefText: a concise but source-faithful structured outline suitable for the creation form detailed-brief input, in the selected output language.',
    '- briefText must capture enough concrete source evidence for later generation: source headings, key conclusions, named entities, metrics, time points, examples, risks, actions, and terminology.',
    '- Do not rewrite the source into a new storyline, generic consulting framework, marketing narrative, or inspirational theme.',
    '- Do not add generic pages such as agenda, background, outlook, summary, next steps, or transition pages unless the source document or user brief clearly requires them.',
    '- briefText should include these sections in the selected output language: presentation goal, audience/context, core argument, recommended outline, per-page points, facts/metrics/terms to preserve, and style/expression notes when useful.',
    '- Decide pageCount before writing briefText by estimating how many slides are needed to faithfully cover the document at presentation density.',
    '- Base pageCount on the document structure, information density, major sections, narrative flow, and required cover/closing pages when useful.',
    '- The recommended outline must contain exactly pageCount numbered items.',
    '- The per-page points section must contain exactly pageCount page entries.',
    '- Per-page points must be specific to the source content and should include concrete source anchors; avoid vague placeholders such as background/goals/value.',
    '- Preserve the source order and hierarchy unless the user explicitly asks for a different structure.',
    '- Before returning, silently check consistency: pageCount must match the number of recommended outline items and per-page point entries.',
    '- If pageCount, recommended outline, and per-page points are inconsistent, fix them before returning the final JSON. Do not include the self-check.',
    '- If no page count is provided by the user, infer it only from the document. Do not copy an example pageCount.',
    '- If a page count is provided by the user, treat it as a hard target: pageCount must equal that number, and outline/per-page entries must be adapted to exactly that number.',
    '- Later PPT generation will read the source document again, so briefText should focus on clear direction and structure.',
    '- Preserve key facts, numbers, proper nouns, conclusions, product names, systems, timelines, roles, risks, and terminology from the document.',
    '- Compress the source; do not paste long passages verbatim.',
    '- Do not invent exact data that is not present in the document.',
    args.pageCount
      ? `- User-provided page count: ${args.pageCount}. Return pageCount=${args.pageCount} exactly.`
      : '- No page count was provided. Infer the target PPT slide count from the document structure and information density. Do not return 1 merely because one file was uploaded.',
    '',
    'Reading requirements:',
    `- Document path: ${args.file.virtualPath}`,
    '- You must call read_file on relevant document sections before producing the result.',
    '- Read the document carefully enough to cover all major sections before returning. Do not only read the beginning.',
    '- For long documents, first use grep to map headings, section names, tables, metrics, dates, named entities, and other cues, then call read_file on the relevant sections. Do not read the whole file into context at once.',
    '- If the file is long, call read_file multiple times in targeted sections and summarize progressively, keeping track of source headings and concrete facts.',
    '- If some later section cannot be read within context, say so inside briefText and avoid inventing content for it.',
    '- If the document is a Word file, it has already been converted to Markdown for reading.',
    args.retryHint
      ? `\nRetry requirement: the previous output failed validation because: ${args.retryHint}. Fix this issue. Ensure briefText is non-empty and pageCount exactly matches the page-level outline and per-page points.`
      : '',
    args.topic
      ? `\nUser-provided topic: ${args.topic}`
      : '\nThe user did not provide a topic; infer it from the document.',
    args.existingBrief ? `\nExisting user brief:\n${args.existingBrief}` : '',
    '',
    'Return format example:',
    'For Chinese source: {"topic":"AI动漫产业发展分析","pageCount":7,"briefText":"演示目标：...\\n受众/场景：...\\n核心观点：...\\n建议大纲：\\n1. ...\\n2. ...\\n每页要点：\\n第 1 页：...\\n第 2 页：...\\n必须保留的事实/指标/术语：...\\n风格/表达要求：..."}',
    'For English source: {"topic":"Product Launch Readiness Review","pageCount":8,"briefText":"Presentation goal: ...\\nAudience/context: ...\\nCore argument: ...\\nRecommended outline:\\n1. ...\\n2. ...\\nPer-page points:\\nPage 1: ...\\nPage 2: ...\\nFacts/metrics/terms to preserve: ...\\nStyle or expression notes: ..."}'
  ].join('\n')

const runDocumentPlanAgent = async (args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens?: number
  modelTimeoutMs: number
  workspaceDir: string
  file: PreparedSourceFile
  topic: string
  pageCount: number | null
  existingBrief: string
  retryHint?: string
}): Promise<string> => {
  const model = resolveModel(args.provider, args.apiKey, args.model, args.baseUrl, 0.2, args.maxTokens)
  const prompt = buildDocumentPlanPrompt({
    topic: args.topic,
    pageCount: args.pageCount,
    existingBrief: args.existingBrief,
    file: args.file,
    retryHint: args.retryHint
  })
  log.info('[documents:parsePlan] agent read_file requested', {
    virtualPath: args.file.virtualPath,
    workspaceName: path.basename(args.file.workspacePath)
  })
  const agent = createDeepAgent({
    model,
    backend: new FilesystemBackend({
      rootDir: args.workspaceDir,
      virtualMode: true
    }),
    systemPrompt:
      'You are a document-to-PPT-creation-form parsing agent. This is source-grounded extraction, not creative ideation. You must inspect the uploaded document carefully, using grep first for long documents to map headings, section names, tables, metrics, dates, named entities, and other cues, then read_file only on targeted sections as needed. Extract topic, pageCount, and a structured briefText outline that preserves source order, source hierarchy, concrete facts, named entities, metrics, dates, conclusions, risks, and terminology. Do not read the whole file into context at once. Do not rewrite the source into a generic storyline, marketing narrative, consulting framework, or inspirational theme. Do not add agenda/background/outlook/summary/next-step pages unless the source or user explicitly requires them. pageCount means the target number of PPT slides to generate; it is not the number of uploaded files or source-document pages. If no page count is provided, infer pageCount from the document structure and information density, and do not return 1 merely because one file was uploaded. If a page count is provided, return that exact pageCount. Keep topic and briefText in the dominant language of the source document unless the user explicitly asks for another language. The section labels inside briefText must also use that language. If the source document is primarily Chinese, do not use English template labels. If the source document is primarily English, do not translate the outline into Chinese. Before returning, silently verify that pageCount, recommended outline count, and per-page point count are consistent. Return strict JSON only: topic, pageCount, briefText.'
  })
  const stream = await agent.stream(
    {
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    },
    {
      streamMode: ['updates', 'messages'],
      subgraphs: true,
      signal: AbortSignal.timeout(resolveModelTimeoutMs(args.modelTimeoutMs, 'document'))
    }
  )

  let messageBuffer = ''
  let latestAssistantStateText = ''
  const seenToolEvents = new Set<string>()
  for await (const chunk of stream as AsyncIterable<unknown>) {
    if (!Array.isArray(chunk) || chunk.length < 3) continue
    const mode = chunk[1] as string
    const data = chunk[2]
    if (mode === 'updates') {
      logDocumentPlanToolEvents(data, seenToolEvents, 'updates')
      const assistantTexts = extractAssistantTextsFromState(data)
      const longestText = assistantTexts.sort((a, b) => b.length - a.length)[0] || ''
      if (longestText.length >= latestAssistantStateText.length) {
        latestAssistantStateText = longestText
      }
      continue
    }
    if (mode !== 'messages' || !Array.isArray(data)) continue
    logDocumentPlanToolEvents(data, seenToolEvents, 'messages')
    for (const message of data as Array<Record<string, unknown>>) {
      const content = extractModelText(message).trim()
      if (content) {
        messageBuffer += content
      }
    }
  }
  if (latestAssistantStateText.length > messageBuffer.length) {
    log.info('[documents:parsePlan] use assistant state response fallback', {
      streamLength: messageBuffer.length,
      stateLength: latestAssistantStateText.length
    })
    return latestAssistantStateText
  }
  return messageBuffer
}

const buildImageDocumentPlanPrompt = (args: {
  topic: string
  pageCount: number | null
  existingBrief: string
  fileName: string
  retryHint?: string
}): string =>
  [
    'Analyze the attached image or screenshot and produce the fixed structure needed by the PPT creation form.',
    'The image is attached to this same message as a multimodal image block. Do not look for a file upload tool, file path, or external attachment.',
    'You must directly inspect the attached image content before answering.',
    '',
    'Return only a JSON object. Do not return Markdown, explanations, or extra fields.',
    'Use exactly these fields: topic, pageCount, briefText.',
    '',
    'Interpretation rules:',
    '- If the image is a slide, dashboard, poster, whiteboard, document screenshot, product screenshot, chart, or design mockup, infer the presentation topic and outline from visible text, chart labels, layout, and visual context.',
    '- If visible text is limited, produce a conservative editable brief based on what can be observed. Do not invent exact numbers or facts that are not visible.',
    '- Preserve visible names, metrics, labels, dates, and terminology when they are readable.',
    '- Mention uncertainty explicitly inside briefText when image content is ambiguous.',
    '- Treat the image as an input reference only. Do not assume the original image will be available during later slide generation.',
    '- Therefore briefText must fully capture both the content reference and the visual style reference needed for generation.',
    '',
    'Output language rules:',
    '- Use the dominant language visible in the image and the latest user-provided topic/brief.',
    '- If the user explicitly asks for a language, use that language.',
    '- If the image is primarily Chinese, use Chinese section labels such as 演示目标、受众/场景、核心观点、建议大纲、每页要点、必须保留的事实/指标/术语、风格/表达要求.',
    '- If the image is primarily English, use English section labels.',
    '',
    'Field rules:',
    '- topic: a concise title suitable for the creation form topic input.',
    `- pageCount: an integer from 1 to ${MAX_PAGE_COUNT}.`,
    '- pageCount means the target number of PPT slides to generate from this image/reference. It is not the number of attached images.',
    '- Use pageCount=1 only for a single simple visual with one presentation point; if the image contains multiple sections, panels, metrics, or a document-like screenshot, infer a multi-slide deck.',
    '- briefText: a concise but structured outline suitable for the creation form detailed-brief input.',
    '- briefText should include presentation goal, audience/context, core argument, recommended outline, per-page points, facts/metrics/terms to preserve, and visual/style reference.',
    '- visual/style reference should cover approximate colors, background, typography feel, layout density, alignment, cards/shapes/borders/shadows, chart style, image/illustration style, and any mood or motion guidance that would help recreate the look.',
    '- The recommended outline and per-page points should align with pageCount.',
    args.pageCount
      ? `- Prefer pageCount=${args.pageCount} unless the image strongly suggests otherwise.`
      : '- Infer the target PPT slide count from the image structure. Do not return 1 merely because one image was attached.',
    args.retryHint
      ? `\nRetry requirement: the previous output failed validation because: ${args.retryHint}. Fix this issue. Ensure briefText is non-empty and pageCount matches the page-level outline.`
      : '',
    args.topic ? `\nUser-provided topic: ${args.topic}` : '\nThe user did not provide a topic; infer it from the image.',
    args.existingBrief ? `\nExisting user brief:\n${args.existingBrief}` : '',
    `\nImage file name: ${args.fileName}`,
    '',
    'Return format examples:',
    '{"topic":"AI动漫产业发展分析","pageCount":7,"briefText":"演示目标：...\\n受众/场景：...\\n核心观点：...\\n建议大纲：\\n1. ...\\n每页要点：\\n第 1 页：...\\n必须保留的事实/指标/术语：...\\n风格/表达要求：..."}',
    '{"topic":"Product Launch Readiness Review","pageCount":8,"briefText":"Presentation goal: ...\\nAudience/context: ...\\nCore argument: ...\\nRecommended outline:\\n1. ...\\nPer-page points:\\nPage 1: ...\\nFacts/metrics/terms to preserve: ...\\nStyle or expression notes: ..."}'
  ].join('\n')

const writeImagePlanReferenceFile = async (args: {
  file: PreparedSourceFile
  plan: Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'>
}): Promise<PreparedSourceFile> => {
  const ext = path.extname(args.file.workspacePath).toLowerCase()
  const mdPath = args.file.workspacePath.replace(/\.[^.]+$/, '.image.md')
  const briefText = compactText(args.plan.briefText)
  if (!briefText) throw new Error('图片解析完成，但模型未返回可用参考内容')
  const useChineseLabels = isMostlyChineseText(`${args.plan.topic}\n${briefText}`)
  const markdown = [
    `# ${path.basename(args.file.name, ext) || (useChineseLabels ? '图片参考' : 'Image reference')}`,
    '',
    `> Source image: ${args.file.name}`,
    '> This file was generated after the user explicitly parsed the uploaded image, so later generation can use it as text reference.',
    '',
    `## ${useChineseLabels ? '主题' : 'Topic'}`,
    '',
    args.plan.topic,
    '',
    `## ${useChineseLabels ? '建议页数' : 'Suggested page count'}`,
    '',
    String(args.plan.pageCount),
    '',
    `## ${useChineseLabels ? '图片解析参考' : 'Image analysis reference'}`,
    '',
    briefText
  ].join('\n')
  await fs.promises.writeFile(mdPath, markdown, 'utf-8')

  return {
    ...args.file,
    name: `${args.file.name}.image.md`,
    type: 'markdown',
    characterCount: markdown.length,
    path: mdPath,
    workspacePath: mdPath,
    virtualPath: `/${path.basename(mdPath)}`
  }
}

const buildImageReferenceMarkdownPrompt = (fileName: string): string =>
  [
    'Analyze the attached image or screenshot and convert it into a readable Markdown reference document.',
    'The image is attached to this same message as a multimodal image block. Directly inspect the image before answering.',
    '',
    'Return Markdown only. Do not return JSON. Do not include task explanations.',
    'Do not generate a PPT outline, page count, slide plan, or creation-form suggestions. Only organize what can be read or observed from the image.',
    '',
    `# 图片参考：${fileName}`,
    '',
    'Required sections:',
    '## 可见文字',
    '- Transcribe readable text, headings, labels, chart labels, names, metrics, dates, and terminology. Keep the original language.',
    '- Preserve line breaks or hierarchy when they are visible.',
    '## 内容整理',
    '- Organize the observed content into concise Markdown bullets or tables when helpful.',
    '- Mark uncertain or unreadable items clearly instead of guessing.',
    '## 视觉信息',
    '- Briefly describe visible layout, chart/table/UI structure, colors, and other visual cues that may help later generation.',
    '',
    'Rules:',
    '- Do not invent exact numbers or facts that are not visible.',
    '- If text is unreadable, say it is unreadable.',
    '- If the image is mainly visual with little text, describe only the observable visual content.'
  ].join('\n')

const convertImageReferenceToMarkdown = async (args: {
  file: PreparedSourceFile
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens?: number
  modelTimeoutMs: number
}): Promise<PreparedSourceFile> => {
  const ext = path.extname(args.file.workspacePath).toLowerCase()
  const mimeType = IMAGE_MIME_BY_EXTENSION[ext]
  if (!mimeType) throw new Error('暂只支持 png、jpg、jpeg、webp 图片')

  const imageBase64 = (await fs.promises.readFile(args.file.workspacePath)).toString('base64')
  let markdown = ''
  try {
    markdown = await invokeVisionModelText({
      imageBase64,
      mimeType,
      prompt: buildImageReferenceMarkdownPrompt(args.file.name),
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      maxTokens: args.maxTokens,
      modelTimeoutMs: args.modelTimeoutMs,
      logTag: 'documents:parseImageReference'
    })
  } catch (error) {
    if (isImageUnsupportedError(error)) {
      throw new Error('当前模型不支持图片解析，请在设置中切换到支持多模态的模型')
    }
    throw error
  }

  const content = compactText(markdown)
  assertImageWasRead(content)
  if (!content) throw new Error('图片解析完成，但模型未返回可用内容')

  const mdPath = args.file.workspacePath.replace(/\.[^.]+$/, '.image.md')
  await fs.promises.writeFile(
    mdPath,
    [
      `# ${path.basename(args.file.name, ext) || '图片参考'}`,
      '',
      `> Source image: ${args.file.name}`,
      '> This file was generated after the user explicitly parsed the uploaded image into a readable Markdown reference.',
      '',
      content
    ].join('\n'),
    'utf-8'
  )

  return {
    ...args.file,
    name: `${args.file.name}.image.md`,
    type: 'markdown',
    characterCount: content.length,
    path: mdPath,
    workspacePath: mdPath,
    virtualPath: `/${path.basename(mdPath)}`
  }
}

const runImageDocumentPlanModel = async (args: {
  provider: string
  apiKey: string
  model: string
  baseUrl: string
  maxTokens?: number
  modelTimeoutMs: number
  file: PreparedSourceFile
  topic: string
  pageCount: number | null
  existingBrief: string
  retryHint?: string
}): Promise<string> => {
  const ext = path.extname(args.file.workspacePath).toLowerCase()
  const mimeType = IMAGE_MIME_BY_EXTENSION[ext]
  if (!mimeType) throw new Error('暂只支持 png、jpg、jpeg、webp 图片')

  const imageBase64 = (await fs.promises.readFile(args.file.workspacePath)).toString('base64')
  const prompt = buildImageDocumentPlanPrompt({
    topic: args.topic,
    pageCount: args.pageCount,
    existingBrief: args.existingBrief,
    fileName: args.file.name,
    retryHint: args.retryHint
  })
  try {
    return await invokeVisionModelText({
      imageBase64,
      mimeType,
      prompt,
      provider: args.provider,
      apiKey: args.apiKey,
      model: args.model,
      baseUrl: args.baseUrl,
      maxTokens: args.maxTokens,
      modelTimeoutMs: args.modelTimeoutMs,
      logTag: 'documents:parsePlan:image'
    })
  } catch (error) {
    if (isImageUnsupportedError(error)) {
      throw new Error('当前模型不支持图片解析，请在设置中切换到支持多模态的模型')
    }
    throw error
  }
}

export function registerDocumentParseHandlers(ctx: IpcContext): void {
  const { resolveStoragePath } = ctx

  ipcMain.handle(
    'documents:prepareReference',
    async (_event, payload: PrepareReferenceDocumentPayload) => {
      const input = payload && typeof payload === 'object' ? payload : { files: [] }
      const files = Array.isArray(input.files) ? input.files.slice(0, MAX_DOCUMENT_FILES) : []
      if (files.length === 0) throw new Error('请先选择要附加的参考文件')

      const docsDir = path.join(await resolveStoragePath(), 'docs')
      await fs.promises.mkdir(docsDir, { recursive: true })
      const preparedFiles = await Promise.all(files.map((file) => prepareSourceFile(file, docsDir)))

      return {
        files: preparedFiles.map(({ name, type, characterCount, workspacePath }) => ({
          name,
          type,
          characterCount,
          path: workspacePath
        }))
      } satisfies PreparedReferenceDocumentResult
    }
  )

  ipcMain.handle(
    'documents:parseImageReference',
    async (_event, payload: ParseImageReferencePayload) => {
      const input = payload && typeof payload === 'object' ? payload : { file: null }
      const rawFile = input.file && typeof input.file === 'object' ? input.file : null
      if (!rawFile) throw new Error('请先选择要解析的图片')

      const docsDir = path.join(await resolveStoragePath(), 'docs')
      await fs.promises.mkdir(docsDir, { recursive: true })
      const sourceFile = await prepareSourceFile(rawFile, docsDir)
      if (sourceFile.type !== 'image') throw new Error('请选择 png、jpg、jpeg、webp 图片')

      const activeModel = await resolveActiveModelConfig(ctx)
      const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
      const referenceFile = await convertImageReferenceToMarkdown({
        file: sourceFile,
        provider: activeModel.provider,
        apiKey: activeModel.apiKey,
        model: activeModel.model,
        baseUrl: activeModel.baseUrl,
        maxTokens: activeModel.maxTokens,
        modelTimeoutMs: modelTimeouts.document
      })

      return {
        files: [
          {
            name: referenceFile.name,
            type: referenceFile.type,
            characterCount: referenceFile.characterCount,
            path: referenceFile.workspacePath
          }
        ]
      } satisfies PreparedReferenceDocumentResult
    }
  )

  ipcMain.handle('documents:parsePlan', async (_event, payload: ParseDocumentPlanPayload) => {
    const input = payload && typeof payload === 'object' ? payload : { files: [] }
    const files = Array.isArray(input.files) ? input.files.slice(0, MAX_DOCUMENT_FILES) : []
    if (files.length === 0) throw new Error('请先选择要解析的文档')
    log.info('[documents:parsePlan] invoke', {
      files: files.map((file) => ({
        name: typeof file.name === 'string' ? file.name : path.basename(String(file.path || '')),
        pathProvided: typeof file.path === 'string' && file.path.trim().length > 0
      }))
    })

    const docsDir = path.join(await resolveStoragePath(), 'docs')
    await fs.promises.mkdir(docsDir, { recursive: true })
    const preparedFiles = await Promise.all(files.map((file) => prepareSourceFile(file, docsDir)))
    const [sourceFile] = preparedFiles
    if (!sourceFile) throw new Error('请先选择要解析的文档')

    const activeModel = await resolveActiveModelConfig(ctx)
    const modelTimeouts = await resolveGlobalModelTimeouts(ctx)
    const { provider, model, apiKey } = activeModel
    const baseUrl = activeModel.baseUrl
    const maxTokens = activeModel.maxTokens
    const modelTimeoutMs = modelTimeouts.document

    const topic = typeof input.topic === 'string' ? input.topic.trim() : ''
    const existingBrief = typeof input.existingBrief === 'string' ? input.existingBrief.trim() : ''
    const pageCount =
      typeof input.pageCount === 'number' && Number.isFinite(input.pageCount)
        ? Math.min(MAX_PAGE_COUNT, Math.max(1, Math.floor(input.pageCount)))
        : null

    const fallbackPlan = {
      topic: topic || path.basename(sourceFile.name, path.extname(sourceFile.name)),
      pageCount,
      briefText: existingBrief
    }
    const MAX_ATTEMPTS = 2
    let plan: Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'> | null = null
    let lastError: unknown = null

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const retryHint = attempt > 1 && lastError instanceof Error ? lastError.message : undefined
      const responseText = (
        sourceFile.type === 'image'
          ? await runImageDocumentPlanModel({
              provider,
              apiKey,
              model,
              baseUrl,
              maxTokens,
              modelTimeoutMs,
              file: sourceFile,
              topic,
              pageCount,
              existingBrief,
              retryHint
            })
          : await runDocumentPlanAgent({
              provider,
              apiKey,
              model,
              baseUrl,
              maxTokens,
              modelTimeoutMs,
              workspaceDir: docsDir,
              file: sourceFile,
              topic,
              pageCount,
              existingBrief,
              retryHint
            })
      ).trim()
      if (!responseText) {
        lastError = new Error('文档解析完成，但模型未返回可用内容')
        log.warn('[documents:parsePlan] empty response', { attempt })
        continue
      }
      log.info('[documents:parsePlan] agent response received', {
        attempt,
        responseLength: responseText.length,
        sourceVirtualPath: sourceFile.virtualPath
      })
      try {
        const candidatePlan = normalizeDocumentPlan(responseText, fallbackPlan)
        if (sourceFile.type === 'image') {
          assertImageWasRead(`${candidatePlan.topic}\n${candidatePlan.briefText}`)
        }
        await assertPlanLanguageMatchesSource({
          file: sourceFile,
          plan: candidatePlan,
          userText: `${topic}\n${existingBrief}`
        })
        plan = candidatePlan
        break
      } catch (error) {
        lastError = error
        if (error instanceof RetryableDocumentPlanQualityError && attempt >= MAX_ATTEMPTS) {
          plan = normalizeDocumentPlan(responseText, fallbackPlan)
          log.warn(
            '[documents:parsePlan] quality check failed after retry, returning editable plan',
            {
              attempt,
              message: error.message,
              responsePreview: responseText.slice(0, 400)
            }
          )
          break
        }
        log.warn('[documents:parsePlan] normalize failed, will retry', {
          attempt,
          message: error instanceof Error ? error.message : String(error),
          responsePreview: responseText.slice(0, 400)
        })
      }
    }
    if (!plan) throw lastError || new Error('文档解析完成，但模型未返回 briefText')
    const resultFiles =
      sourceFile.type === 'image'
        ? [await writeImagePlanReferenceFile({ file: sourceFile, plan })]
        : preparedFiles

    return {
      ...plan,
      files: resultFiles.map(({ name, type, characterCount, workspacePath }) => ({
        name,
        type,
        characterCount,
        path: workspacePath
      }))
    } satisfies ParsedDocumentPlanResult
  })
}
