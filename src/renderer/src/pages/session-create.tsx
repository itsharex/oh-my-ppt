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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../components/ui/Dialog'
import { CircleAlert, FileText, Loader2, Sparkles, X } from 'lucide-react'
import { useSessionStore } from '../store'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import { ModelSplitButton } from '../components/model/ModelActionButton'
import { useModelAction } from '../hooks/useModelAction'
import { ipc, type FontListItem } from '@renderer/lib/ipc'
import type { FontSelection, ParsedDocumentPlanResult } from '@shared/generation'
import { useT } from '../i18n'
import { isSupportedImageMimeType } from '@shared/image-mime'

const MIN_PAGE_COUNT = 1
const MAX_PAGE_COUNT = 500
const DEFAULT_PAGE_COUNT = 5
const MAX_DOCUMENT_SIZE_MB = 10
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const MAX_IMAGE_SIZE_MB = 5
const MAX_IMAGE_SIZE_BYTES = MAX_IMAGE_SIZE_MB * 1024 * 1024
const isImageFileName = (name: string): boolean => /\.(png|jpe?g|webp)$/i.test(name.trim())

const isSupportedImageFile = (file: File): boolean =>
  isSupportedImageMimeType(file.type) || isImageFileName(file.name || '')

type AttachedReferenceFile = ParsedDocumentPlanResult['files'][number]

type DocumentPlanSuggestion = Pick<ParsedDocumentPlanResult, 'topic' | 'pageCount' | 'briefText'>

const compactInputClass = 'h-8 px-3 py-1.5 text-xs'
const compactSelectTriggerClass = 'h-8 px-2.5 py-1.5 text-xs'
const compactSelectContentClass = 'text-xs'
const compactSelectItemClass = 'px-2.5 py-1.5 text-xs'
const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => window.setTimeout(resolve, ms))

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

export function SessionCreatePage(): ReactElement {
  const navigate = useNavigate()
  const { createSession, loading } = useSessionStore()
  const { settings } = useSettingsStore()
  const { success, error, warning } = useToastStore()
  const modelAction = useModelAction()
  const { modelConfigs, selectedModelConfigId, ensureModelActive } = modelAction
  const t = useT()
  const [submitting, setSubmitting] = useState(false)
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
  const [attachedReferenceFile, setAttachedReferenceFile] = useState<AttachedReferenceFile | null>(
    null
  )
  const [parsingDocument, setParsingDocument] = useState(false)
  const [documentParseError, setDocumentParseError] = useState<string | null>(null)
  const [referenceDocumentPath, setReferenceDocumentPath] = useState<string | null>(null)
  const [documentPlanSuggestion, setDocumentPlanSuggestion] =
    useState<DocumentPlanSuggestion | null>(null)
  const [suggestionDialogOpen, setSuggestionDialogOpen] = useState(false)
  const [applyTopicSuggestion, setApplyTopicSuggestion] = useState(false)
  const [applyPageCountSuggestion, setApplyPageCountSuggestion] = useState(false)
  const [applyBriefSuggestion, setApplyBriefSuggestion] = useState(false)
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageReference = attachedReferenceFile?.type === 'image'

  const validateForm = (modelConfigId = selectedModelConfigId): string => {
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

    const selectedModelConfig = modelConfigs.find((config) => config.id === modelConfigId)
    const resolvedApiKey = (selectedModelConfig?.apiKey || '').trim()
    const resolvedModel = (selectedModelConfig?.model || '').trim()
    const resolvedStoragePath = (settings?.storagePath || '').trim()
    if (!resolvedApiKey || !resolvedModel || !resolvedStoragePath) return t('home.settingsRequired')

    return ''
  }

  const requiredReady = (() => {
    const topicText = topic.trim()
    const pageCountText = pageCount.trim()
    const briefText = brief.trim()
    if (!topicText || !selectedStyleId || !selectedModelConfigId || !briefText) return false
    if (!/^\d+$/.test(pageCountText)) return false
    const n = Number.parseInt(pageCountText, 10)
    return n >= MIN_PAGE_COUNT && n <= MAX_PAGE_COUNT
  })()

  const loadStyleOptions = useCallback(
    async (preferredStyleId?: string): Promise<void> => {
      try {
        const { items } = await ipc.listStyles()
        const sorted = [...items].sort(
          (a, b) =>
            (b.updatedAt || 0) - (a.updatedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0)
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
      setSelectedTitleFontId((current) =>
        current === 'auto' || ids.has(current) ? current : 'auto'
      )
      setSelectedBodyFontId((current) =>
        current === 'auto' || ids.has(current) ? current : 'auto'
      )
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

  const handleSubmit = async (modelConfigId: string): Promise<void> => {
    if (parsingDocument) {
      warning(t('home.referenceProcessingWait'))
      return
    }
    if (pendingImageReference) {
      warning(t('home.completeInfoTitle'), { description: t('home.imageReferenceNeedsParse') })
      return
    }
    const validationError = validateForm(modelConfigId)
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
    const fontSelection: FontSelection =
      selectedTitleFont && selectedBodyFont
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

    setSubmitting(true)
    try {
      if (!(await ensureModelActive(modelConfigId))) return
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
      await delay(500)
      navigate(`/sessions/${sessionId}/generating`, {
        state: {
          initialPrompt
        }
      })
    } catch (err) {
      error(t('home.sessionCreateFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleChooseReferenceClick = async (): Promise<void> => {
    if (parsingDocument) return
    documentInputRef.current?.click()
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

    setParsingDocument(true)
    setDocumentParseError(null)
    try {
      const result = await ipc.prepareReferenceDocument({ files: payloadFiles })
      const referenceFile = result.files[0]
      setAttachedReferenceFile(referenceFile || null)
      setReferenceDocumentPath(
        referenceFile && referenceFile.type !== 'image' ? referenceFile.path : null
      )
      setDocumentPlanSuggestion(null)
      success(isImage ? t('home.imageReferenceAttachedNeedsParse') : t('home.referenceAttached'), {
        description: referenceFile?.name || selectedFile.name
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.retryLater')
      setDocumentParseError(message)
      error(t('home.referenceAttachFailed'), {
        description: message
      })
    } finally {
      setParsingDocument(false)
    }
  }

  const handleRemoveReferenceFile = (): void => {
    setAttachedReferenceFile(null)
    setReferenceDocumentPath(null)
    setDocumentPlanSuggestion(null)
    setDocumentParseError(null)
  }

  const handleRevealReferenceFile = async (): Promise<void> => {
    if (!attachedReferenceFile) return
    try {
      await ipc.revealFile(attachedReferenceFile.path)
    } catch (err) {
      error(t('home.revealReferenceFileFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    }
  }

  const handleParseImageReference = async (modelConfigId = selectedModelConfigId): Promise<void> => {
    if (!attachedReferenceFile || attachedReferenceFile.type !== 'image' || parsingDocument) return
    if (!(await ensureModelActive(modelConfigId))) return

    setParsingDocument(true)
    setDocumentParseError(null)
    try {
      const result = await ipc.parseImageReferenceDocument({
        file: { path: attachedReferenceFile.path, name: attachedReferenceFile.name }
      })
      const referenceFile = result.files[0]
      if (!referenceFile) throw new Error(t('common.retryLater'))
      setAttachedReferenceFile(referenceFile)
      setReferenceDocumentPath(referenceFile.path)
      setDocumentPlanSuggestion(null)
      setSuggestionDialogOpen(false)
      success(t('home.imageReferenceParsed'), { description: referenceFile.name })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.retryLater')
      setDocumentParseError(message)
      error(t('home.documentParseFailed'), { description: message })
    } finally {
      setParsingDocument(false)
    }
  }

  const handleAnalyzeReference = async (modelConfigId: string): Promise<void> => {
    if (!attachedReferenceFile || parsingDocument) return
    if (!(await ensureModelActive(modelConfigId))) return

    setParsingDocument(true)
    setDocumentParseError(null)
    try {
      const result = await ipc.parseDocumentPlan({
        files: [{ path: attachedReferenceFile.path, name: attachedReferenceFile.name }],
        topic: topic.trim(),
        existingBrief: brief.trim()
      })
      const nextSuggestion = {
        topic: result.topic,
        pageCount: result.pageCount,
        briefText: result.briefText
      }
      const referenceFile = result.files[0] || attachedReferenceFile
      setAttachedReferenceFile(referenceFile)
      setReferenceDocumentPath(referenceFile.type !== 'image' ? referenceFile.path : null)
      setDocumentPlanSuggestion(nextSuggestion)
      setApplyTopicSuggestion(!topic.trim())
      setApplyPageCountSuggestion(!pageCount.trim())
      setApplyBriefSuggestion(!brief.trim())
      setSuggestionDialogOpen(true)
      success(t('home.documentParsed'))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.retryLater')
      setDocumentParseError(message)
      error(t('home.documentParseFailed'), {
        description: message
      })
    } finally {
      setParsingDocument(false)
    }
  }

  const applyDocumentSuggestion = (mode: 'empty' | 'selected'): void => {
    if (!documentPlanSuggestion) return
    const shouldApplyTopic = mode === 'empty' ? !topic.trim() : applyTopicSuggestion
    const shouldApplyPageCount = mode === 'empty' ? !pageCount.trim() : applyPageCountSuggestion
    const shouldApplyBrief = mode === 'empty' ? !brief.trim() : applyBriefSuggestion

    if (shouldApplyTopic) setTopic(documentPlanSuggestion.topic)
    if (shouldApplyPageCount)
      setPageCount(String(resolvePageCount(String(documentPlanSuggestion.pageCount))))
    if (shouldApplyBrief) setBrief(documentPlanSuggestion.briefText)
    setSuggestionDialogOpen(false)
  }

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
        <p className="mt-2 text-[12px] text-muted-foreground">{t('home.description')}</p>
      </div>

      <div className="space-y-4">
        <input
          ref={documentInputRef}
          type="file"
          accept=".md,.txt,.text,.csv,.docx,image/png,image/jpeg,image/webp"
          multiple={false}
          className="hidden"
          onChange={(event) => void handleDocumentFilesSelected(event.target.files)}
        />
        {documentParseError && (
          <div className="flex items-start gap-2 rounded-md border border-[#d58b7f]/45 bg-[#fff2ef] px-3 py-2 text-xs text-[#8a3d33]">
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{documentParseError}</span>
          </div>
        )}

        <Card className="mb-4">
          <CardContent className="space-y-3 py-4 [&_label]:mb-1.5 [&_label]:text-xs">
            <div>
              <label className="block font-medium">{t('home.topic')}</label>
              <Input
                placeholder={t('home.topicPlaceholder')}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
                className={compactInputClass}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-[1fr_100px]">
              <div>
                <label className="block font-medium">{t('home.style')}</label>
                <Select value={selectedStyleId} onValueChange={setSelectedStyleId}>
                  <SelectTrigger className={compactSelectTriggerClass}>
                    <SelectValue placeholder={t('home.stylePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent className={compactSelectContentClass}>
                    {styleOptions.map((option) => (
                      <SelectItem
                        key={option.id}
                        value={option.id}
                        className={compactSelectItemClass}
                      >
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
                  className={compactInputClass}
                />
              </div>
            </div>

            <div>
              <label className="block font-medium">{t('home.fontScheme')}</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Select value={selectedTitleFontId} onValueChange={setSelectedTitleFontId}>
                  <SelectTrigger className={compactSelectTriggerClass}>
                    <SelectValue placeholder={t('home.fontSchemeAuto')} />
                  </SelectTrigger>
                  <SelectContent className={compactSelectContentClass}>
                    <SelectItem value="auto" className={compactSelectItemClass}>
                      {t('home.fontSchemeAuto')}
                    </SelectItem>
                    {availableTitleFonts.map((font) => {
                      const isUploaded = font.source === 'uploaded'
                      const sourceLabel = isUploaded
                        ? t('home.fontSourceUploaded')
                        : t('home.fontSourceBuiltIn')
                      return (
                        <SelectItem
                          key={`${font.source}:${font.id}`}
                          value={`${font.source}:${font.id}`}
                          className={compactSelectItemClass}
                        >
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
                  <SelectTrigger className={compactSelectTriggerClass}>
                    <SelectValue placeholder={t('home.fontSchemeAuto')} />
                  </SelectTrigger>
                  <SelectContent className={compactSelectContentClass}>
                    <SelectItem value="auto" className={compactSelectItemClass}>
                      {t('home.fontSchemeAuto')}
                    </SelectItem>
                    {availableBodyFonts.map((font) => {
                      const isUploaded = font.source === 'uploaded'
                      const sourceLabel = isUploaded
                        ? t('home.fontSourceUploaded')
                        : t('home.fontSourceBuiltIn')
                      return (
                        <SelectItem
                          key={`${font.source}:${font.id}`}
                          value={`${font.source}:${font.id}`}
                          className={compactSelectItemClass}
                        >
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
              <p className="mt-1 text-[11px] text-muted-foreground">{fontSelectHint}</p>
            </div>

            <div>
              <label className="block font-medium">{t('home.brief')}</label>
              <div className="rounded-lg border border-[#d8ccb5]/80 bg-[#fff9ef]/40 p-2">
                <Textarea
                  placeholder={t('home.briefPlaceholder')}
                  rows={7}
                  value={brief}
                  required
                  onChange={(e) => setBrief(e.target.value)}
                  className="min-h-[150px] resize-y border-0 bg-transparent shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <div className="mt-2 flex flex-col gap-2 border-t border-[#e5dccb] pt-2">
                  {attachedReferenceFile && (
                    <div className="flex min-w-0">
                      <span
                        className={`inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 text-[10px] ${
                          pendingImageReference
                            ? 'border-[#e7a19a]/80 bg-[#fff1ef] text-[#9a3f35]'
                            : 'border-[#c7d9b4]/70 bg-[#e6f1dc]/80 text-[#405333]'
                        }`}
                        title={
                          pendingImageReference
                            ? t('home.imageReferenceTagTooltip')
                            : attachedReferenceFile.path
                        }
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        <button
                          type="button"
                          onClick={() => void handleRevealReferenceFile()}
                          className="min-w-0 truncate text-left hover:underline"
                          title={t('home.revealReferenceFileTooltip')}
                          aria-label={t('home.revealReferenceFile')}
                        >
                          {attachedReferenceFile.name}
                        </button>
                        {pendingImageReference ? (
                          <>
                            <span className="shrink-0 text-[#b24d43]">
                              {t('home.imageReferenceNeedsParseShort')}
                            </span>
                            <button
                              type="button"
                              onClick={() => void handleParseImageReference(selectedModelConfigId)}
                              disabled={parsingDocument || submitting}
                              className="ml-1 inline-flex h-4 shrink-0 items-center rounded-full bg-[#c84f45] px-1.5 text-[10px] font-medium text-white hover:bg-[#ad4239] disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label={t('home.parseImageReference')}
                            >
                              {parsingDocument
                                ? t('home.parsingImageReference')
                                : t('home.parseImageReference')}
                            </button>
                          </>
                        ) : null}
                        <button
                          type="button"
                          onClick={handleRemoveReferenceFile}
                          className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full ${
                            pendingImageReference
                              ? 'text-[#a04940] hover:bg-[#f2c2bd]'
                              : 'text-[#657552] hover:bg-[#c8ddb2]'
                          }`}
                          aria-label={t('home.removeReference')}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </span>
                    </div>
                  )}
                  <TooltipProvider delayDuration={180}>
                    <div className="flex flex-wrap items-center gap-2">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                void handleChooseReferenceClick()
                              }}
                              disabled={parsingDocument}
                              className="h-8 shrink-0 rounded-lg border border-[#d8ccb5]/80 bg-[#fffdf8]/76 px-2.5 text-xs font-medium text-[#405333] shadow-none hover:bg-[#f3f7ed] hover:text-[#2f3b28]"
                            >
                              {parsingDocument ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <FileText className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              {parsingDocument
                                ? t('home.processingReference')
                                : t('home.uploadReference')}
                            </Button>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" align="start">
                          {t('home.uploadReferenceTooltip', {
                            maxSize: MAX_DOCUMENT_SIZE_MB,
                            imageMaxSize: MAX_IMAGE_SIZE_MB
                          })}
                        </TooltipContent>
                      </Tooltip>
                      {attachedReferenceFile && !pendingImageReference && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <ModelSplitButton
                                modelAction={modelAction}
                                ariaLabel={t('home.analyzeReference')}
                                label={t('home.analyzeReference')}
                                loadingLabel={t('home.analyzingReference')}
                                loading={parsingDocument}
                                disabled={!attachedReferenceFile}
                                icon={Sparkles}
                                tone="primary"
                                dropdownAlign="start"
                                className="box-border h-8 rounded-lg border-0 bg-gradient-to-r from-[#7f965f] to-[#5f7448] shadow-[0_8px_18px_rgba(93,107,77,0.18)]"
                                mainClassName="h-full bg-transparent px-2.5 text-xs text-white shadow-none hover:bg-white/10 hover:text-white hover:shadow-none"
                                triggerClassName="h-full w-8 px-0"
                                onRun={handleAnalyzeReference}
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" align="start" className="max-w-xs">
                            {t('home.analyzeReferenceTooltip')}
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </TooltipProvider>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <ModelSplitButton
            modelAction={modelAction}
            ariaLabel={t('home.createAndStart')}
            label={t('home.createAndStart')}
            loadingLabel={t('home.creating')}
            loading={submitting || loading}
            disabled={!requiredReady || parsingDocument}
            icon={Sparkles}
            tone="primary"
            className="w-full md:w-auto"
            mainClassName="min-w-0 flex-1 md:flex-none md:min-w-[156px]"
            onRun={handleSubmit}
          />
        </div>
      </div>

      <Dialog open={suggestionDialogOpen} onOpenChange={setSuggestionDialogOpen}>
        <DialogContent className="max-w-4xl gap-0 overflow-hidden border-[#d8ccb5]/85 bg-[#f7f1e8] p-0">
          <DialogHeader className="border-b border-[#ded4c1] bg-[#fffaf1] px-5 py-4 pr-12">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#b9cda7]/75 bg-[#e6f1dc] text-[#405333] shadow-[0_4px_10px_rgba(93,107,77,0.08)]">
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-sm">{t('home.analysisSuggestionTitle')}</DialogTitle>
                <DialogDescription className="mt-1 max-w-2xl text-xs leading-5">
                  {t('home.analysisSuggestionDescription')}
                </DialogDescription>
                {attachedReferenceFile && (
                  <span
                    className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#d8ccb5]/72 bg-[#fff9ef]/86 px-2 py-1 text-[11px] font-medium text-[#5d6b4d]"
                    title={attachedReferenceFile.path}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate">{attachedReferenceFile.name}</span>
                  </span>
                )}
              </div>
            </div>
          </DialogHeader>

          {documentPlanSuggestion && (
            <div className="max-h-[64vh] overflow-y-auto px-5 py-4">
              <div className="space-y-2.5">
                <section
                  className={`overflow-hidden rounded-xl border bg-[#fffdf8] shadow-[0_8px_18px_rgba(74,59,42,0.06)] transition-colors ${
                    applyTopicSuggestion
                      ? 'border-[#a9c693] ring-1 ring-[#cfe2c1]'
                      : 'border-[#e1d7c6]'
                  }`}
                >
                  <div className="grid gap-3 p-3 md:grid-cols-[120px_1fr] md:items-center">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={applyTopicSuggestion}
                        onChange={(event) => setApplyTopicSuggestion(event.target.checked)}
                        className="h-4 w-4 accent-[#6f8f64]"
                      />
                      <span className="text-sm font-semibold text-[#34402c]">{t('home.topic')}</span>
                    </label>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                      <div className="rounded-lg bg-[#f5efe4]/76 px-3 py-2">
                        <p className="mb-1 text-[10px] font-medium uppercase text-[#8a7d69]">
                          {t('home.currentValue')}
                        </p>
                        <p className="min-h-5 whitespace-pre-wrap text-xs leading-5 text-[#6d604d]">
                          {topic.trim() || t('home.emptyValue')}
                        </p>
                      </div>
                      <div className="hidden items-center text-[#b5aa95] md:flex">→</div>
                      <div className="rounded-lg bg-[#eef6e8] px-3 py-2">
                        <p className="mb-1 text-[10px] font-medium uppercase text-[#6a8054]">
                          {t('home.suggestedValue')}
                        </p>
                        <p className="min-h-5 whitespace-pre-wrap text-xs leading-5 text-[#405333]">
                          {documentPlanSuggestion.topic}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  className={`overflow-hidden rounded-xl border bg-[#fffdf8] shadow-[0_8px_18px_rgba(74,59,42,0.06)] transition-colors ${
                    applyPageCountSuggestion
                      ? 'border-[#a9c693] ring-1 ring-[#cfe2c1]'
                      : 'border-[#e1d7c6]'
                  }`}
                >
                  <div className="grid gap-3 p-3 md:grid-cols-[120px_1fr] md:items-center">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={applyPageCountSuggestion}
                        onChange={(event) => setApplyPageCountSuggestion(event.target.checked)}
                        className="h-4 w-4 accent-[#6f8f64]"
                      />
                      <span className="text-sm font-semibold text-[#34402c]">
                        {t('home.pageCount')}
                      </span>
                    </label>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                      <div className="rounded-lg bg-[#f5efe4]/76 px-3 py-2">
                        <p className="mb-1 text-[10px] font-medium uppercase text-[#8a7d69]">
                          {t('home.currentValue')}
                        </p>
                        <p className="min-h-5 text-xs leading-5 text-[#6d604d]">
                          {pageCount.trim() || t('home.emptyValue')}
                        </p>
                      </div>
                      <div className="hidden items-center text-[#b5aa95] md:flex">→</div>
                      <div className="rounded-lg bg-[#eef6e8] px-3 py-2">
                        <p className="mb-1 text-[10px] font-medium uppercase text-[#6a8054]">
                          {t('home.suggestedValue')}
                        </p>
                        <p className="min-h-5 text-xs leading-5 text-[#405333]">
                          {documentPlanSuggestion.pageCount}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                <section
                  className={`overflow-hidden rounded-xl border bg-[#fffdf8] shadow-[0_8px_18px_rgba(74,59,42,0.06)] transition-colors ${
                    applyBriefSuggestion
                      ? 'border-[#a9c693] ring-1 ring-[#cfe2c1]'
                      : 'border-[#e1d7c6]'
                  }`}
                >
                  <div className="grid gap-3 p-3 md:grid-cols-[120px_1fr] md:items-start">
                    <label className="flex cursor-pointer items-center gap-2 pt-1">
                      <input
                        type="checkbox"
                        checked={applyBriefSuggestion}
                        onChange={(event) => setApplyBriefSuggestion(event.target.checked)}
                        className="h-4 w-4 accent-[#6f8f64]"
                      />
                      <span className="truncate text-sm font-semibold text-[#34402c]">
                        {t('home.brief')}
                      </span>
                    </label>
                    <div className="grid gap-2 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
                      <div className="rounded-lg bg-[#f5efe4]/76 px-3 py-2.5">
                        <p className="mb-1 text-[10px] font-medium uppercase text-[#8a7d69]">
                          {t('home.currentValue')}
                        </p>
                        <div className="max-h-40 min-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[#6d604d]">
                          {brief.trim() || t('home.emptyValue')}
                        </div>
                      </div>
                      <div className="hidden items-center text-[#b5aa95] md:flex">→</div>
                      <div className="rounded-lg bg-[#eef6e8] px-3 py-2.5">
                        <p className="mb-1 text-[10px] font-medium uppercase text-[#6a8054]">
                          {t('home.suggestedValue')}
                        </p>
                        <div className="max-h-40 min-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-[#405333]">
                          {documentPlanSuggestion.briefText}
                        </div>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          )}

          <DialogFooter className="flex-col-reverse gap-1.5 border-t border-[#ded4c1] bg-[#fffaf1] px-5 py-2.5 sm:flex-row">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setSuggestionDialogOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => applyDocumentSuggestion('empty')}
            >
              {t('home.applyEmptyFields')}
            </Button>
            <Button
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => applyDocumentSuggestion('selected')}
            >
              {t('home.applySelectedFields')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
