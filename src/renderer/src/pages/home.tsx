import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Textarea } from '../components/ui/Input'
import { Card, CardContent } from '../components/ui/Card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/Select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../components/ui/Tooltip'
import { CircleAlert, FileText, FileUp, Loader2, Sparkles } from 'lucide-react'
import { useSessionStore } from '../store'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import { ipc, type FontListItem, type StyleParseResult } from '@renderer/lib/ipc'
import type { FontSelection } from '@shared/generation'
import { useT } from '../i18n'
import {
  isSupportedImageMimeType,
  normalizeImageMimeType
} from '@shared/image-mime'

const MIN_PAGE_COUNT = 1
const MAX_PAGE_COUNT = 40
const DEFAULT_PAGE_COUNT = 5
const MAX_DOCUMENT_SIZE_MB = 10
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const MAX_IMAGE_SIZE_MB = 5
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
const MAX_PPTX_SIZE_MB = 80
const MAX_PPTX_SIZE_BYTES = MAX_PPTX_SIZE_MB * 1024 * 1024
const IMAGE_STYLE_PARSE_DELAY_MS = 300
const isImageFileName = (name: string): boolean => /\.(png|jpe?g|webp)$/i.test(name.trim())

const getImageMimeTypeFromFileName = (name: string): string => {
  const normalized = name.trim().toLowerCase()
  if (normalized.endsWith('.png')) return 'image/png'
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg'
  if (normalized.endsWith('.webp')) return 'image/webp'
  return ''
}

const isSupportedImageFile = (file: File): boolean =>
  isSupportedImageMimeType(file.type) || isImageFileName(file.name || '')

const delay = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

const buildNeutralInitialPrompt = (args: {
  topic: string
  pageCount: number
  styleLabel: string
}): string =>
  [
    `Create a ${args.pageCount}-slide presentation about "${args.topic}".`,
    `Style preset: ${args.styleLabel}.`,
    'Determine the presentation content language from the topic, detailed brief, and source documents; do not infer it from the application UI language or this instruction language.'
  ].join('\n')

const resolvePageCount = (raw: string): number => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_COUNT
  return Math.min(MAX_PAGE_COUNT, Math.max(MIN_PAGE_COUNT, parsed))
}

export function HomePage(): ReactElement {
  const navigate = useNavigate()
  const { createSession, loading } = useSessionStore()
  const { settings, modelConfigs, fetchSettings } = useSettingsStore()
  const { success, error, warning } = useToastStore()
  const t = useT()
  const [topic, setTopic] = useState('')
  const [brief, setBrief] = useState('')
  const [pageCount, setPageCount] = useState(String(DEFAULT_PAGE_COUNT))
  const [selectedStyleId, setSelectedStyleId] = useState('')
  const [selectedTitleFontId, setSelectedTitleFontId] = useState('auto')
  const [selectedBodyFontId, setSelectedBodyFontId] = useState('auto')
  const [styleOptions, setStyleOptions] = useState<
    Array<{ id: string; label: string; description: string; styleCase?: string }>
  >([])
  const [fontOptions, setFontOptions] = useState<FontListItem[]>([])
  const [parsingDocument, setParsingDocument] = useState(false)
  const [importingPptx, setImportingPptx] = useState(false)
  const [pptxImportProgress, setPptxImportProgress] = useState<string | null>(null)
  const [documentParseError, setDocumentParseError] = useState<string | null>(null)
  const [hasParsedSource, setHasParsedSource] = useState(false)
  const [referenceDocumentPath, setReferenceDocumentPath] = useState<string | null>(null)
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const pptxInputRef = useRef<HTMLInputElement | null>(null)

  const validateForm = (): string => {
    const topicText = topic.trim()
    if (!topicText) return t('home.validationTopic')

    if (!styleOptions.length) return t('home.validationStylesLoading')
    if (!selectedStyleId) return t('home.validationStyle')
    const selectedStyle = styleOptions.find((option) => option.id === selectedStyleId)
    if (!selectedStyle) return t('home.validationStyleMissing')

    const pageCountText = pageCount.trim()
    if (!pageCountText)
      return t('home.validationPageCount', { min: MIN_PAGE_COUNT, max: MAX_PAGE_COUNT })
    if (!/^\d+$/.test(pageCountText)) return t('home.validationPageCountNumber')
    const rawPageCount = Number.parseInt(pageCountText, 10)
    if (rawPageCount < MIN_PAGE_COUNT || rawPageCount > MAX_PAGE_COUNT) {
      return t('home.validationPageCountRange', { min: MIN_PAGE_COUNT, max: MAX_PAGE_COUNT })
    }

    const briefText = brief.trim()
    if (!briefText) return t('home.validationBrief')

    const activeModelConfig = modelConfigs.find((config) => config.active)
    const resolvedApiKey = (activeModelConfig?.apiKey || '').trim()
    const resolvedModel = (activeModelConfig?.model || '').trim()
    const resolvedStoragePath = (settings?.storagePath || '').trim()
    if (!resolvedApiKey || !resolvedModel || !resolvedStoragePath) return t('home.settingsRequired')

    return ''
  }

  const requiredReady = (() => {
    const topicText = topic.trim()
    const pageCountText = pageCount.trim()
    const briefText = brief.trim()
    if (!topicText || !selectedStyleId || !briefText) return false
    if (!/^\d+$/.test(pageCountText)) return false
    const n = Number.parseInt(pageCountText, 10)
    return n >= MIN_PAGE_COUNT && n <= MAX_PAGE_COUNT
  })()

  const loadStyleOptions = useCallback(
    async (preferredStyleId?: string): Promise<void> => {
      try {
        const { items } = await ipc.listStyles()
        const sorted = [...items].sort(
          (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0)
        )
        const options = sorted.map((item) => ({
          id: item.id,
          label: item.label,
          description: item.description,
          styleCase: item.styleCase
        }))
        setStyleOptions(options)
        setSelectedStyleId((current) => {
          if (preferredStyleId && options.some((option) => option.id === preferredStyleId)) {
            return preferredStyleId
          }
          if (current && options.some((option) => option.id === current)) return current
          return options.length > 0 ? options[0].id : ''
        })
      } catch (err) {
        error(t('home.styleLoadFailed'), {
          description: err instanceof Error ? err.message : t('common.retryLater')
        })
      }
    },
    [error, t]
  )

  const loadFontOptions = useCallback(async (): Promise<void> => {
    try {
      const { googleFonts, userFonts } = await ipc.listFonts()
      const options = [...userFonts, ...googleFonts]
      setFontOptions(options)
      const ids = new Set(options.map((font) => `${font.source}:${font.id}`))
      setSelectedTitleFontId((current) => (current === 'auto' || ids.has(current) ? current : 'auto'))
      setSelectedBodyFontId((current) => (current === 'auto' || ids.has(current) ? current : 'auto'))
    } catch {
      setFontOptions([])
      setSelectedTitleFontId('auto')
      setSelectedBodyFontId('auto')
    }
  }, [])

  useEffect(() => {
    void loadStyleOptions()
  }, [loadStyleOptions])

  useEffect(() => {
    void loadFontOptions()
  }, [loadFontOptions])

  const handleSubmit = async (): Promise<void> => {
    const validationError = validateForm()
    if (validationError) {
      if (validationError === t('home.settingsRequired')) {
        warning(t('home.settingsRequiredTitle'), {
          description: t('home.settingsRequired'),
          action: {
            label: t('home.goToSettings'),
            onClick: () => navigate('/settings')
          }
        })
        return
      }
      warning(t('home.completeInfoTitle'), { description: validationError })
      return
    }
    const selectedStyle = styleOptions.find((option) => option.id === selectedStyleId)!
    const findFontBySelectId = (id: string): FontListItem | undefined =>
      fontOptions.find((font) => `${font.source}:${font.id}` === id)
    const selectedTitleFont = findFontBySelectId(selectedTitleFontId)
    const selectedBodyFont = findFontBySelectId(selectedBodyFontId)
    const fontSelection: FontSelection = selectedTitleFont && selectedBodyFont
      ? {
          mode: 'pair',
          title: {
            source: selectedTitleFont.source,
            family: selectedTitleFont.family,
            id: selectedTitleFont.id
          },
          body: {
            source: selectedBodyFont.source,
            family: selectedBodyFont.family,
            id: selectedBodyFont.id
          }
        }
      : { mode: 'auto' }
    const topicText = topic.trim()
    const briefText = brief.trim()
    const safePageCount = Number.parseInt(pageCount.trim(), 10)
    const initialPrompt =
      briefText ||
      buildNeutralInitialPrompt({
        topic: topicText || 'Untitled topic',
        pageCount: safePageCount,
        styleLabel: selectedStyle.label
      })

    try {
      const sessionId = await createSession({
        topic: topicText,
        styleId: selectedStyleId,
        pageCount: safePageCount,
        referenceDocumentPath: referenceDocumentPath || undefined,
        fontSelection
      })
      success(t('home.sessionCreated'), {
        description: t('home.generationStarted'),
        duration: 1000
      })
      setPageCount(String(safePageCount))
      navigate(`/sessions/${sessionId}/generating`, {
        state: {
          initialPrompt
        }
      })
    } catch (err) {
      error(t('home.sessionCreateFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    }
  }

  const ensureUploadPrerequisites = async (): Promise<boolean> => {
    const validation = await ipc.validateUploadPrerequisites()
    if (validation.ready) return true
    warning(t('home.settingsRequiredTitle'), {
      description: validation.message || t('home.settingsRequired'),
      action: {
        label: t('home.goToSettings'),
        onClick: () => navigate('/settings')
      }
    })
    return false
  }

  const handleParseDocumentClick = async (): Promise<void> => {
    if (parsingDocument) return
    if (!(await ensureUploadPrerequisites())) return
    documentInputRef.current?.click()
  }

  const handleImportPptxClick = async (): Promise<void> => {
    if (importingPptx) return
    if (!(await ensureUploadPrerequisites())) return
    pptxInputRef.current?.click()
  }

  const parseImageStyle = async (file: File): Promise<StyleParseResult> => {
    const hintedMimeType = normalizeImageMimeType(file.type)
    const fallbackMimeType = getImageMimeTypeFromFileName(file.name || '')
    if (!isSupportedImageMimeType(file.type) && !fallbackMimeType) {
      throw new Error(t('styleEditor.imageFormatInvalid'))
    }
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      throw new Error(t('home.imageTooLarge', { maxSize: MAX_IMAGE_SIZE_MB }))
    }

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error(t('styleEditor.imageReadFailed')))
      reader.readAsDataURL(file)
    })
    const match = dataUrl.match(/^data:([^;]*);base64,(.+)$/)
    if (!match) throw new Error(t('styleEditor.imageReadFailed'))

    const dataUrlMimeType = normalizeImageMimeType(match[1])
    const mimeType = isSupportedImageMimeType(match[1])
      ? dataUrlMimeType
      : isSupportedImageMimeType(file.type)
        ? hintedMimeType
        : fallbackMimeType
    const imageBase64 = String(match[2] || '').trim()
    if (!mimeType || !imageBase64) throw new Error(t('styleEditor.imageReadFailed'))

    return await ipc.parseStyleImage({ imageBase64, mimeType })
  }

  const createParsedImageStyle = async (parsedStyle: StyleParseResult): Promise<{ id: string; label: string }> => {
    const createdStyle = await ipc.createStyle({
      label: parsedStyle.label,
      description: parsedStyle.description,
      category: parsedStyle.category,
      aliases: parsedStyle.aliases,
      styleSkill: parsedStyle.styleSkill,
      styleCase: parsedStyle.styleCase || ''
    })
    await loadStyleOptions(createdStyle.id)
    return { id: createdStyle.id, label: parsedStyle.label }
  }

  const handleDocumentFilesSelected = async (files: FileList | null): Promise<void> => {
    const selectedFiles = Array.from(files || [])
    if (documentInputRef.current) {
      documentInputRef.current.value = ''
    }
    if (selectedFiles.length === 0) return
    if (selectedFiles.length > 1) {
      const message = t('home.documentSingleOnly')
      setDocumentParseError(message)
      error(t('home.documentCountExceeded'), {
        description: message
      })
      return
    }
    const selectedFile = selectedFiles[0]
    const isImage = isSupportedImageFile(selectedFile)
    const maxSizeMb = isImage ? MAX_IMAGE_SIZE_MB : MAX_DOCUMENT_SIZE_MB
    const maxSizeBytes = isImage ? MAX_IMAGE_SIZE_BYTES : MAX_DOCUMENT_SIZE_BYTES
    if (selectedFile.size > maxSizeBytes) {
      const message = isImage
        ? t('home.imageTooLarge', { maxSize: maxSizeMb })
        : t('home.documentTooLarge', { maxSize: maxSizeMb })
      setDocumentParseError(message)
      error(t('home.documentTooLargeTitle'), {
        description: message
      })
      return
    }

    const payloadFiles = selectedFiles
      .map((file) => ({
        path: window.electron?.getPathForFile?.(file) || '',
        name: file.name
      }))
      .filter((file) => file.path)

    if (payloadFiles.length === 0) {
      setDocumentParseError(t('home.documentPathFailed'))
      error(t('home.documentPathFailedTitle'))
      return
    }

    const safePageCount = /^\d+$/.test(pageCount.trim())
      ? resolvePageCount(pageCount.trim())
      : DEFAULT_PAGE_COUNT

    setParsingDocument(true)
    setDocumentParseError(null)
    setHasParsedSource(false)
    try {
      const planPromise = ipc.parseDocumentPlan({
        files: payloadFiles,
        topic: topic.trim(),
        pageCount: safePageCount,
        existingBrief: brief.trim()
      })
      const imageStyleParsePromise = isImage
        ? delay(IMAGE_STYLE_PARSE_DELAY_MS).then(() => parseImageStyle(selectedFile))
        : Promise.resolve(null)
      const [result, parsedImageStyle] = await Promise.all([planPromise, imageStyleParsePromise])
      const imageStyle = parsedImageStyle ? await createParsedImageStyle(parsedImageStyle) : null
      setTopic(result.topic)
      setPageCount(String(result.pageCount))
      setBrief(result.briefText)
      const referenceFile = result.files.find((file) => file.type !== 'image')
      setReferenceDocumentPath(referenceFile?.path || null)
      setHasParsedSource(true)
      success(t('home.documentParsed'), {
        description: imageStyle
          ? t('home.imageParsedWithStyle', { style: imageStyle.label })
          : t('home.documentParsedDescription', { count: result.files.length })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.retryLater')
      setDocumentParseError(message)
      setHasParsedSource(false)
      error(t('home.documentParseFailed'), {
        description: message
      })
    } finally {
      setParsingDocument(false)
    }
  }

  const handlePptxFilesSelected = async (files: FileList | null): Promise<void> => {
    const selectedFiles = Array.from(files || [])
    if (pptxInputRef.current) {
      pptxInputRef.current.value = ''
    }
    if (selectedFiles.length === 0) return
    if (selectedFiles.length > 1) {
      error(t('home.pptxSingleOnlyTitle'), {
        description: t('home.pptxSingleOnly')
      })
      return
    }
    const selectedFile = selectedFiles[0]
    if (!/\.pptx$/i.test(selectedFile.name)) {
      error(t('home.unsupportedFileTitle'), {
        description: t('home.unsupportedPptx')
      })
      return
    }
    if (selectedFile.size > MAX_PPTX_SIZE_BYTES) {
      error(t('home.pptxTooLargeTitle'), {
        description: t('home.pptxTooLarge', { maxSize: MAX_PPTX_SIZE_MB })
      })
      return
    }
    const filePath = window.electron?.getPathForFile?.(selectedFile) || ''
    if (!filePath) {
      error(t('home.pptxPathFailedTitle'), {
        description: t('home.pptxPathFailed')
      })
      return
    }
    setImportingPptx(true)
    setPptxImportProgress(t('home.pptxPreparing'))
    try {
      const result = await ipc.importPptx({
        filePath,
        title: selectedFile.name.replace(/\.pptx$/i, ''),
        styleId: selectedStyleId || null
      })
      success(t('home.pptxImportDone'), {
        description:
          result.warnings.length > 0
            ? t('home.pptxImportedWithWarnings', {
                pageCount: result.pageCount,
                warningCount: result.warnings.length
              })
            : t('home.pptxImported', { pageCount: result.pageCount })
      })
      navigate(`/sessions/${result.sessionId}`)
    } catch (err) {
      error(t('home.pptxImportFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setImportingPptx(false)
      setPptxImportProgress(null)
    }
  }

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    // 提前注册，避免主进程导入刚开始时的进度事件丢失。
    return ipc.onPptxImportProgress((payload) => {
      setPptxImportProgress(`${payload.label}${payload.progress ? ` · ${payload.progress}%` : ''}`)
    })
  }, [])

  const titleFontOptions = fontOptions.filter((font) => font.role.includes('title'))
  const bodyFontOptions = fontOptions.filter((font) => font.role.includes('body'))
  const availableTitleFonts = titleFontOptions.length > 0 ? titleFontOptions : fontOptions
  const availableBodyFonts = bodyFontOptions.length > 0 ? bodyFontOptions : fontOptions
  const fontSelectHint =
    selectedTitleFontId === 'auto' && selectedBodyFontId === 'auto'
      ? t('home.fontSchemeAutoHint')
      : selectedTitleFontId !== 'auto' && selectedBodyFontId !== 'auto'
        ? t('home.fontSchemeManualHint')
        : t('home.fontSchemePartialHint')

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-6">
      <div>
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {t('home.eyebrow')}
        </p>
        <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">
          {t('home.title')}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('home.description')}</p>
      </div>

      <div className="space-y-4">
        <div>
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <TooltipProvider delayDuration={180}>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void handleParseDocumentClick()
                        }}
                        disabled={parsingDocument || importingPptx}
                        className="shrink-0"
                      >
                        {parsingDocument ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileText className="mr-2 h-4 w-4" />
                        )}
                        {parsingDocument ? t('home.parsingDocument') : t('home.uploadDocument')}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    {t('home.uploadDocumentTooltip', {
                      maxSize: MAX_DOCUMENT_SIZE_MB,
                      imageMaxSize: MAX_IMAGE_SIZE_MB
                    })}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          void handleImportPptxClick()
                        }}
                        disabled={importingPptx || parsingDocument}
                        className="shrink-0"
                      >
                        {importingPptx ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <FileUp className="mr-2 h-4 w-4" />
                        )}
                        {importingPptx ? t('home.importingPptx') : t('home.importPptx')}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    {t('home.importPptxTooltip', { maxSize: MAX_PPTX_SIZE_MB })}
                  </TooltipContent>
                </Tooltip>

                {hasParsedSource && !parsingDocument ? (
                  <span className="rounded-full bg-[#e8f0df] px-2.5 py-1 text-xs text-[#4f6340]">
                    {t('home.parsed')}
                  </span>
                ) : null}
              </div>
            </TooltipProvider>

            {pptxImportProgress ? (
              <p className="min-w-0 text-xs text-[#4f6340]">{pptxImportProgress}</p>
            ) : null}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{t('home.localOnly')}</p>

          <input
            ref={documentInputRef}
            type="file"
            accept=".md,.txt,.text,.csv,.docx,image/png,image/jpeg,image/webp"
            multiple={false}
            className="hidden"
            onChange={(event) => void handleDocumentFilesSelected(event.target.files)}
          />
          <input
            ref={pptxInputRef}
            type="file"
            accept=".pptx"
            multiple={false}
            className="hidden"
            onChange={(event) => void handlePptxFilesSelected(event.target.files)}
          />
        </div>
        {documentParseError && (
          <div className="flex items-start gap-2 rounded-md border border-[#d58b7f]/45 bg-[#fff2ef] px-3 py-2 text-xs text-[#8a3d33]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{documentParseError}</span>
          </div>
        )}

        <Card className="mb-4">
          <CardContent className="space-y-3 py-4 [&_input]:h-9 [&_button]:h-9 [&_label]:mb-1.5 [&_label]:text-xs">
            <div>
              <label className="block font-medium">{t('home.topic')}</label>
              <Input
                placeholder={t('home.topicPlaceholder')}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_100px]">
              <div>
                <label className="block font-medium">{t('home.style')}</label>
                <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('home.stylePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {styleOptions.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        <span className="flex items-center gap-1.5">
                          {option.label}
                          {(option.styleCase || option.description) && (
                            <span className="rounded-md border border-[#d6c08d]/80 bg-[#fff7e8] px-1.5 py-px text-[10px] font-medium text-[#7c6a4c]">
                              {option.styleCase || option.description}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block font-medium">{t('home.pageCount')}</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder={`${MIN_PAGE_COUNT}-${MAX_PAGE_COUNT}`}
                  value={pageCount}
                  required
                  onChange={(e) => {
                    const next = e.target.value
                    if (next === '') {
                      setPageCount('')
                      return
                    }
                    if (!/^\d+$/.test(next)) return
                    setPageCount(next)
                  }}
                  onBlur={() => {
                    setPageCount(String(resolvePageCount(pageCount)))
                  }}
                />
              </div>
            </div>

            <div>
              <label className="block font-medium">{t('home.fontScheme')}</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Select value={selectedTitleFontId} onValueChange={setSelectedTitleFontId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('home.fontSchemeAuto')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('home.fontSchemeAuto')}</SelectItem>
                    {availableTitleFonts.map((font) => {
                      const isUploaded = font.source === 'uploaded'
                      const sourceLabel = isUploaded
                        ? t('home.fontSourceUploaded')
                        : t('home.fontSourceBuiltIn')
                      return (
                        <SelectItem key={`${font.source}:${font.id}`} value={`${font.source}:${font.id}`}>
                          <span className="flex items-center gap-2">
                            <span
                              className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
                                isUploaded
                                  ? 'bg-[#eef9ec] text-[#4a7a46]'
                                  : 'bg-[#eef6ff] text-[#3e6685]'
                              }`}
                            >
                              {sourceLabel}
                            </span>
                            <span className="truncate">
                              {t('home.fontPairTitle')} · {font.family}
                            </span>
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <Select value={selectedBodyFontId} onValueChange={setSelectedBodyFontId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('home.fontSchemeAuto')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{t('home.fontSchemeAuto')}</SelectItem>
                    {availableBodyFonts.map((font) => {
                      const isUploaded = font.source === 'uploaded'
                      const sourceLabel = isUploaded
                        ? t('home.fontSourceUploaded')
                        : t('home.fontSourceBuiltIn')
                      return (
                        <SelectItem key={`${font.source}:${font.id}`} value={`${font.source}:${font.id}`}>
                          <span className="flex items-center gap-2">
                            <span
                              className={`shrink-0 rounded px-1 py-0.5 text-[10px] font-medium ${
                                isUploaded
                                  ? 'bg-[#eef9ec] text-[#4a7a46]'
                                  : 'bg-[#eef6ff] text-[#3e6685]'
                              }`}
                            >
                              {sourceLabel}
                            </span>
                            <span className="truncate">
                              {t('home.fontPairBody')} · {font.family}
                            </span>
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {fontSelectHint}
              </p>
            </div>

            <div>
              <label className="block font-medium">{t('home.brief')}</label>
              <Textarea
                placeholder={t('home.briefPlaceholder')}
                rows={4}
                value={brief}
                required
                onChange={(e) => setBrief(e.target.value)}
                className="min-h-[100px] resize-y"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              void handleSubmit()
            }}
            className="w-full md:w-auto"
            disabled={loading || !requiredReady}
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {loading ? t('home.creating') : t('home.createAndStart')}
          </Button>
        </div>
      </div>
    </div>
  )
}
