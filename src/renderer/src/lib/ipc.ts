import type {
  FontSelection,
  GenerateAddPagePayload,
  GenerateChunkEvent,
  GenerateRetryFailedPayload,
  GenerateRetrySinglePagePayload,
  GenerateStartPayload,
  ParseDocumentPlanPayload,
  ParsedDocumentPlanResult,
  PptxImportPayload,
  PptxImportProgressPayload,
  PptxImportResult,
  UploadedAsset
} from '@shared/generation.js'
import type { UpdateAvailablePayload } from '@shared/app-update.js'
import type { SpeechConfig } from '@shared/speech'
import type { HistoryVersion, RollbackHistoryResult } from '@shared/history.js'
import type {
  ThinkingStage,
  ThinkingChatMessage,
  ThinkingWorkspace,
  ThinkingChatResult,
  ThinkingPrepareGenerationResult
} from '@shared/thinking.js'

type IpcRendererLike = Window['electron']['ipcRenderer']

function getIpc(): IpcRendererLike {
  const ipc = window.electron?.ipcRenderer
  if (!ipc) {
    const electronKeys = window.electron ? Object.keys(window.electron).join(', ') : 'none'
    throw new Error(`Electron preload IPC is unavailable. window.electron keys: ${electronKeys}`)
  }
  return ipc
}

export interface StyleCategory {
  name: string
  styles: Array<{
    id: string
    label: string
    description: string
    source?: 'builtin' | 'custom' | 'override'
    editable?: boolean
    styleCase?: string
  }>
}

export interface StyleDetail {
  id: string
  styleKey?: string
  label: string
  description: string
  aliases: string[]
  styleSkill: string
  source?: 'builtin' | 'custom' | 'override'
  editable?: boolean
  category?: string
  styleCase?: string
}

export interface StyleListItem {
  id: string
  label: string
  description: string
  category: string
  source?: 'builtin' | 'custom' | 'override'
  editable?: boolean
  styleCase?: string
  previewPath?: string | null
  createdAt?: number
  updatedAt?: number
}

export interface StyleParseResult {
  label: string
  description: string
  category: string
  aliases: string[]
  styleSkill: string
  styleCase?: string
}

export interface GenerateRunStateSnapshot {
  sessionId: string
  runId: string | null
  status: 'idle' | 'running' | 'completed' | 'failed'
  hasActiveRun: boolean
  progress: number
  totalPages: number
  events: GenerateChunkEvent[]
  error: string | null
  startedAt: number | null
  updatedAt: number | null
}

export interface ExportDeckResult {
  success: boolean
  cancelled?: boolean
  path?: string
  warnings?: string[]
  pageCount?: number
}

export interface ImportSessionFileResult {
  success: boolean
  cancelled?: boolean
  sessionId?: string
  title?: string
  pageCount?: number
  warnings?: string[]
}

export interface EnsureElementAnchorPayload {
  sessionId?: string
  htmlPath: string
  pageId: string
  selector: string
  elementTag?: string
  elementText?: string
  reason?: 'inspect' | 'drag' | 'text-edit'
}

export interface EnsureElementAnchorResult {
  success: boolean
  selector: string
  blockId: string
  changed: boolean
}

export interface UploadAssetsPayload {
  sessionId: string
  files: Array<{
    path: string
    name?: string
  }>
}

export interface UpdateElementLayoutPayload {
  sessionId: string
  htmlPath: string
  pageId: string
  selector: string
  x: number
  y: number
  width?: number
  height?: number
  childUpdates?: Array<{
    path: number[]
    width?: number
    height?: number
  }>
  isAbsoluteMode?: boolean
}

export interface UpdateElementPropertiesPayload {
  sessionId: string
  htmlPath: string
  pageId: string
  selector: string
  patch: {
    text?: string
    style?: {
      color?: string
      fontSize?: string
      fontWeight?: string
    }
  }
}

export interface CreateSessionPayload {
  topic: string
  styleId: string
  pageCount?: number
  referenceDocumentPath?: string
  fontSelection?: FontSelection
}

export interface ModelConfig {
  id: string
  name: string
  provider: 'anthropic' | 'openai' | 'google'
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface UploadPrerequisitesResult {
  ready: boolean
  missing: Array<'storagePath' | 'activeModel' | 'apiKey' | 'model'>
  message?: string
}

export type FontRole = 'title' | 'body'
export type FontScript = 'latin' | 'cjk'

export interface FontFileEntry {
  file: string
  weight: number
  style: 'normal' | 'italic'
  size?: number
  sha256?: string
}

export interface FontListItem {
  id: string
  family: string
  source: 'google' | 'uploaded'
  category: string
  role: FontRole[]
  scripts: FontScript[]
  files?: FontFileEntry[]
  createdAt?: number
  updatedAt?: number
}

export interface FontRegistryResponse {
  googleFonts: FontListItem[]
  userFonts: FontListItem[]
}

export interface UploadFontPayload {
  files: Array<{
    path: string
    weight?: number
    style?: 'normal' | 'italic'
  }>
  family: string
  category?: string
  role?: FontRole[]
  scripts?: FontScript[]
}

export const ipc = {
  createSession: (payload: CreateSessionPayload) =>
    getIpc().invoke('session:create', payload) as Promise<{ sessionId: string }>,
  listSessions: () => getIpc().invoke('session:list') as Promise<unknown[]>,
  getSession: (sessionId: string) =>
    getIpc().invoke('session:get', sessionId) as Promise<{
      session: unknown
      messages: unknown[]
      generatedPages: Array<{
        id: string
        pageNumber: number
        title: string
        html: string
        htmlPath?: string
        pageId?: string
        sourceUrl?: string
        status?: string
        error?: string | null
      }>
    }>,
  reorderSessionPages: (payload: {
    sessionId: string
    orderedPageIds: string[]
    selectedPageId?: string
  }) =>
    getIpc().invoke('session:reorderPages', payload) as Promise<{
      ok: boolean
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        html: string
        htmlPath?: string
        status?: string
        error?: string | null
      }>
      selectedPageId: string | null
    }>,
  deleteSessionPages: (payload: {
    sessionId: string
    pageIds: string[]
    selectedPageId?: string
  }) =>
    getIpc().invoke('session:deletePages', payload) as Promise<{
      ok: boolean
      generatedPages: Array<{
        id: string
        pageNumber: number
        pageId: string
        title: string
        html: string
        htmlPath?: string
        status?: string
        error?: string | null
      }>
      selectedPageId: string | null
    }>,
  getSessionMessages: (payload: {
    sessionId: string
    chatType: 'main' | 'page'
    pageId?: string
  }) => getIpc().invoke('session:getMessages', payload) as Promise<unknown[]>,
  deleteSession: (sessionId: string) =>
    getIpc().invoke('session:delete', sessionId) as Promise<{ success: boolean }>,
  updateSessionTitle: (payload: { sessionId: string; title: string }) =>
    getIpc().invoke('session:updateTitle', payload) as Promise<{ ok: boolean }>,
  importSessionFile: () =>
    getIpc().invoke('session:importFile') as Promise<ImportSessionFileResult>,
  startGenerate: (payload: GenerateStartPayload) =>
    getIpc().invoke('generate:start', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
    }>,
  retryFailedPages: (payload: GenerateRetryFailedPayload) =>
    getIpc().invoke('generate:retryFailedPages', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
    }>,
  addPage: (payload: GenerateAddPagePayload) =>
    getIpc().invoke('generate:addPage', payload) as Promise<{
      success: boolean
      runId?: string
      alreadyRunning?: boolean
    }>,
  retrySinglePage: (payload: GenerateRetrySinglePagePayload) =>
    getIpc().invoke('generate:retrySinglePage', payload) as Promise<{
      success: boolean
      runId?: string
    }>,
  getGenerateState: (sessionId: string) =>
    getIpc().invoke('generate:state', sessionId) as Promise<GenerateRunStateSnapshot>,
  cancelGenerate: (sessionId: string) =>
    getIpc().invoke('generate:cancel', sessionId) as Promise<{ success: boolean }>,
  listHistoryVersions: (payload: { sessionId: string; limit?: number }) =>
    getIpc().invoke('history:listVersions', payload) as Promise<HistoryVersion[]>,
  rollbackToHistoryVersion: (payload: { sessionId: string; versionId: string }) =>
    getIpc().invoke('history:rollbackToVersion', payload) as Promise<RollbackHistoryResult>,
  recordHistorySnapshot: (payload: {
    sessionId: string
    type?: 'generate' | 'edit' | 'addPage' | 'retry' | 'import' | 'rollback' | 'reorder' | 'delete'
    scope?: 'session' | 'deck' | 'page' | 'selector' | 'shell'
    prompt?: string
    metadata?: Record<string, unknown>
  }) => getIpc().invoke('history:recordSnapshot', payload) as Promise<unknown>,
  uploadAssets: (payload: UploadAssetsPayload) =>
    getIpc().invoke('assets:upload', payload) as Promise<{ assets: UploadedAsset[] }>,
  parseDocumentPlan: (payload: ParseDocumentPlanPayload) =>
    getIpc().invoke('documents:parsePlan', payload) as Promise<ParsedDocumentPlanResult>,
  importPptx: (payload: PptxImportPayload) =>
    getIpc().invoke('pptx:import', payload) as Promise<PptxImportResult>,
  chooseAndUploadAssets: (sessionId: string, assetType: 'image' | 'video' = 'image') =>
    getIpc().invoke('assets:chooseAndUpload', { sessionId, assetType }) as Promise<{
      assets: UploadedAsset[]
      cancelled?: boolean
    }>,
  listAssets: (sessionId: string, assetType: 'image' | 'video') =>
    getIpc().invoke('assets:list', { sessionId, assetType }) as Promise<{
      assets: Array<{ fileName: string; relativePath: string; absolutePath: string }>
    }>,
  exportPdf: (sessionId: string) =>
    getIpc().invoke('export:pdf', { sessionId }) as Promise<ExportDeckResult>,
  exportPng: (sessionId: string) =>
    getIpc().invoke('export:png', { sessionId }) as Promise<ExportDeckResult>,
  exportPptx: (
    sessionId: string,
    options?: { imageOnly?: boolean; embedFonts?: boolean | 'auto' | 'always' | 'never' }
  ) =>
    getIpc().invoke('export:pptx', { sessionId, ...options }) as Promise<ExportDeckResult>,
  exportSlidePack: (sessionId: string) =>
    getIpc().invoke('export:slidePack', { sessionId }) as Promise<ExportDeckResult>,
  exportSessionZip: (sessionId: string) =>
    getIpc().invoke('export:sessionZip', { sessionId }) as Promise<ExportDeckResult>,
  getSettings: () => getIpc().invoke('settings:get') as Promise<Record<string, unknown>>,
  listModelConfigs: () => getIpc().invoke('settings:listModelConfigs') as Promise<ModelConfig[]>,
  validateUploadPrerequisites: () =>
    getIpc().invoke('settings:validateUploadPrerequisites') as Promise<UploadPrerequisitesResult>,
  listFonts: () => getIpc().invoke('fonts:list') as Promise<FontRegistryResponse>,
  uploadFont: (payload: UploadFontPayload) =>
    getIpc().invoke('fonts:upload', payload) as Promise<{ success: true; font: FontListItem }>,
  updateFont: (payload: {
    id: string
    family?: string
    category?: string
    role?: FontRole[]
    scripts?: FontScript[]
  }) => getIpc().invoke('fonts:update', payload) as Promise<{ success: true; font: FontListItem }>,
  deleteFont: (fontId: string) =>
    getIpc().invoke('fonts:delete', fontId) as Promise<{ success: true }>,
  revealFontsFolder: () => getIpc().invoke('fonts:revealFolder') as Promise<{ success: true }>,
  chooseFontFiles: () =>
    getIpc().invoke('fonts:chooseFiles') as Promise<{ canceled: boolean; filePaths: string[] }>,
  loadFontPreviewCss: () => getIpc().invoke('fonts:previewCss') as Promise<string>,
  saveSettings: (settings: Record<string, unknown>) =>
    getIpc().invoke('settings:save', settings) as Promise<{ success: boolean }>,
  upsertModelConfig: (payload: {
    id?: string
    name: string
    provider: 'anthropic' | 'openai' | 'google'
    model: string
    apiKey: string
    baseUrl: string
    maxTokens?: number
    active?: boolean
  }) =>
    getIpc().invoke('settings:upsertModelConfig', payload) as Promise<{
      success: boolean
      id: string
    }>,
  setActiveModelConfig: (id: string) =>
    getIpc().invoke('settings:setActiveModelConfig', id) as Promise<{ success: boolean }>,
  deleteModelConfig: (id: string) =>
    getIpc().invoke('settings:deleteModelConfig', id) as Promise<{ success: boolean }>,
  verifyApiKey: (payload: {
    provider: string
    apiKey: string
    model: string
    baseUrl: string
    maxTokens?: number
    timeoutMs: number
  }) =>
    getIpc().invoke('settings:verifyApiKey', payload) as Promise<{
      valid: boolean
      message?: string
    }>,
  chooseStoragePath: () =>
    getIpc().invoke('settings:chooseStoragePath') as Promise<{
      path: string | null
      error?: string
    }>,
  getStyles: () =>
    getIpc().invoke('styles:get') as Promise<{
      categories: Record<
        string,
        Array<{
          id: string
          label: string
          description: string
          source?: 'builtin' | 'custom' | 'override'
          editable?: boolean
          styleCase?: string
        }>
      >
      defaultStyle: string
    }>,
  getStyleDetail: (styleId: string) =>
    getIpc().invoke('styles:getDetail', styleId) as Promise<StyleDetail>,
  listStyles: () => getIpc().invoke('styles:list') as Promise<{ items: StyleListItem[] }>,
  parseStyleFile: (payload: { filePath: string }) =>
    getIpc().invoke('styles:parseFile', payload) as Promise<StyleParseResult>,
  parseStylePptx: (payload: { filePath: string }) =>
    getIpc().invoke('styles:parsePptx', payload) as Promise<StyleParseResult>,
  parseStyleImage: (payload: { imageBase64: string; mimeType: string }) =>
    getIpc().invoke('styles:parseImage', payload) as Promise<StyleParseResult>,
  createStyle: (payload: {
    label: string
    description: string
    category?: string
    aliases?: string[]
    styleSkill: string
    styleCase?: string
  }) =>
    getIpc().invoke('styles:create', payload) as Promise<{
      success: boolean
      id: string
      source: 'custom' | 'override'
    }>,
  updateStyle: (payload: {
    id: string
    label: string
    description: string
    category?: string
    aliases?: string[]
    styleSkill: string
    styleCase?: string
  }) =>
    getIpc().invoke('styles:update', payload) as Promise<{
      success: boolean
      id: string
      source: 'custom' | 'override'
    }>,
  deleteStyle: (styleId: string) =>
    getIpc().invoke('styles:delete', styleId) as Promise<{
      success: boolean
      deleted: boolean
      message?: string
    }>,
  loadPreview: (htmlPath: string, sessionId?: string) =>
    getIpc().invoke('preview:load', { htmlPath, sessionId }) as Promise<string>,
  loadPagePreview: (htmlPath: string, pageId: string, sessionId?: string) =>
    getIpc().invoke('preview:loadPage', { htmlPath, pageId, sessionId }) as Promise<{
      pageNumber: number
      pageId: string
      title: string
      html: string
    }>,
  updateElementLayout: (payload: UpdateElementLayoutPayload) =>
    getIpc().invoke('drag-editor:update-element-layout', payload) as Promise<{
      success: boolean
    }>,
  ensureElementAnchor: (payload: EnsureElementAnchorPayload) =>
    getIpc().invoke('element-anchor:ensure', payload) as Promise<EnsureElementAnchorResult>,
  updateElementProperties: (payload: UpdateElementPropertiesPayload) =>
    getIpc().invoke('text-editor:update-element-properties', payload) as Promise<{
      success: boolean
    }>,
  deleteElement: (payload: {
    sessionId: string
    htmlPath: string
    pageId: string
    selector: string
  }) =>
    getIpc().invoke('element-editor:delete-element', payload) as Promise<{
      success: boolean
    }>,
  saveEditBatch: (payload: {
    sessionId: string
    htmlPath: string
    pageId: string
    dragEdits: unknown[]
    textEdits: unknown[]
    propertyEdits?: unknown[]
    deletes?: unknown[]
    addElements?: unknown[]
    prompt?: string
  }) =>
    getIpc().invoke('edit:save-batch', payload) as Promise<{
      success: boolean
      dragCount: number
      textCount: number
      propertyCount?: number
      deleteCount: number
      addCount: number
      warnings?: string[]
    }>,
  openFile: (filePath: string, sessionId?: string) =>
    getIpc().invoke('file:open', { path: filePath, sessionId }) as Promise<string>,
  revealFile: (filePath: string, sessionId?: string) =>
    getIpc().invoke('file:reveal', { path: filePath, sessionId }) as Promise<{ success: boolean }>,
  openInBrowser: (filePath: string, hash?: string, sessionId?: string) =>
    getIpc().invoke('file:openInBrowser', { path: filePath, hash, sessionId }) as Promise<{
      success: boolean
    }>,
  saveFile: (payload: { path: string; content: string; sessionId?: string }) =>
    getIpc().invoke('file:save', payload) as Promise<{ success: boolean }>,
  onGenerateChunk: (callback: (chunk: GenerateChunkEvent) => void): (() => void) => {
    const channel = 'generate:chunk'
    const handler = (_event: unknown, chunk: unknown): void => callback(chunk as GenerateChunkEvent)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  onPptxImportProgress: (callback: (payload: PptxImportProgressPayload) => void): (() => void) => {
    const channel = 'pptx:import:progress'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as PptxImportProgressPayload)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  onUpdateAvailable: (callback: (payload: UpdateAvailablePayload) => void): (() => void) => {
    const channel = 'app:update-available'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as UpdateAvailablePayload)
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  getAppVersion: () =>
    getIpc().invoke('app:getVersion') as Promise<{
      version: string
    }>,
  openPresentation: (payload: { sessionId: string; startIndex?: number }) =>
    getIpc().invoke('presentation:open', payload) as Promise<{ success: boolean }>,
  generateSpeechScript: (
    sessionId: string,
    config: SpeechConfig & { currentPageId?: string }
  ) =>
    getIpc().invoke('speech:generateScript', { sessionId, ...config }) as Promise<{ success: boolean }>,
  getSpeechScript: (sessionId: string) =>
    getIpc().invoke('speech:getScript', { sessionId }) as Promise<{
      success: boolean
      script: string | null
    }>,
  openSpeechScriptFile: (sessionId: string) =>
    getIpc().invoke('speech:openScriptFile', { sessionId }) as Promise<{
      success: boolean
      path: string
    }>,
  clearSpeechScript: (sessionId: string) =>
    getIpc().invoke('speech:clearScript', { sessionId }) as Promise<{ success: boolean }>,
  onSpeechProgress: (
    callback: (payload: { sessionId: string; current: number; total: number }) => void
  ): (() => void) => {
    const channel = 'speech:progress'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as { sessionId: string; current: number; total: number })
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },

  thinkingCreateWorkspace: () =>
    getIpc().invoke('thinking:createWorkspace') as Promise<ThinkingWorkspace>,
  thinkingGetWorkspace: (thinkingId: string) =>
    getIpc().invoke('thinking:getWorkspace', thinkingId) as Promise<ThinkingWorkspace>,
  thinkingGetLatestWorkspace: () =>
    getIpc().invoke('thinking:getLatestWorkspace') as Promise<ThinkingWorkspace | null>,
  thinkingRevealWorkspace: (thinkingId: string) =>
    getIpc().invoke('thinking:revealWorkspace', thinkingId) as Promise<{ success: boolean }>,
  thinkingUploadSources: (payload: {
    thinkingId: string
    files: Array<{ path: string; name?: string }>
  }) =>
    getIpc().invoke('thinking:uploadSources', payload) as Promise<{
      sources: Array<{ id: string; name: string; kind: string }>
    }>,
  thinkingChat: (payload: {
    thinkingId: string
    userMessage: string
    recentMessages?: ThinkingChatMessage[]
  }) =>
    getIpc().invoke('thinking:chat', payload) as Promise<ThinkingChatResult>,
  thinkingPrepareGeneration: (payload: { thinkingId: string }) =>
    getIpc().invoke('thinking:prepareGeneration', payload) as Promise<ThinkingPrepareGenerationResult>,
  onThinkingStreamThinking: (
    callback: (payload: { thinkingId: string; type: string; toolName: string; summary: string }) => void
  ): (() => void) => {
    const channel = 'thinking:stream:thinking'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(payload as { thinkingId: string; type: string; toolName: string; summary: string })
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  },
  onThinkingStreamEnd: (
    callback: (
      payload: {
        thinkingId: string
        reply: string
        thinkingMd: string
        contextMd: string
        stage: ThinkingStage
      }
    ) => void
  ): (() => void) => {
    const channel = 'thinking:stream:end'
    const handler = (_event: unknown, payload: unknown): void =>
      callback(
        payload as {
          thinkingId: string
          reply: string
          thinkingMd: string
          contextMd: string
          stage: ThinkingStage
        }
      )
    getIpc().on(channel, handler)
    return () => getIpc().removeListener(channel, handler)
  }
}
