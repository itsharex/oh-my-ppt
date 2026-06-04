import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Check,
  CircleAlert,
  FileText,
  LayoutTemplate,
  Loader2,
  Pencil,
  Sparkles,
  X
} from 'lucide-react'
import { Button } from '../ui/Button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/Dialog'
import { Input, Textarea } from '../ui/Input'
import { ModelSplitButton } from '../model/ModelActionButton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/Tooltip'
import { useModelAction } from '@renderer/hooks/useModelAction'
import { useT } from '@renderer/i18n'
import { ipc, type TemplateListItem } from '@renderer/lib/ipc'
import { useTemplateStore, useToastStore } from '@renderer/store'
import type { DocumentPlanPageSkeletonItem, ParsedDocumentPlanResult } from '@shared/generation'
import {
  buildSuggestionDraft,
  formatSourceOutlineBriefText,
  updateDraftSourcePlanItems,
  type DocumentPlanSuggestion,
  type DocumentPlanSuggestionDraft
} from '../session-create/SessionCreateSuggestionDialog'

const MIN_PAGE_COUNT = 1
const MAX_PAGE_COUNT = 500
const MAX_DOCUMENT_SIZE_MB = 10
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024

type AttachedReferenceFile = ParsedDocumentPlanResult['files'][number]

const resolvePageCount = (raw: string, fallback: number): number => {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(MAX_PAGE_COUNT, Math.max(MIN_PAGE_COUNT, parsed))
}

const buildTemplateInitialPrompt = (args: {
  templateName: string
  title: string
  pageCount: number
  brief: string
}): string =>
  [
    `Create a ${args.pageCount}-slide presentation titled "${args.title}".`,
    `Use the selected template "${args.templateName}" as the fixed visual template reference.`,
    'Regenerate every slide from the new brief/source document. Preserve the template direction for layout roles, visual rhythm, colors, typography, and component treatment, but do not reuse old slide text unless the user asks for it.',
    'Page-count mapping: preserve the template cover/opening role for slide 1 and the closing/ending role for the final slide when possible. If the final deck has more pages than the template, add the extra pages in the middle by reusing or varying relevant middle-page roles. If it has fewer pages, merge or skip less relevant middle-page roles. Do not force one-to-one page matching.',
    'Determine the presentation content language from the brief and source documents; do not infer it from the application UI language or this instruction language.',
    '',
    'Brief:',
    args.brief
  ].join('\n')

export function TemplateUseDialog({
  template,
  onOpenChange
}: {
  template: TemplateListItem | null
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const navigate = useNavigate()
  const t = useT()
  const { createSessionFromTemplate } = useTemplateStore()
  const { success, error, warning } = useToastStore()
  const modelAction = useModelAction()
  const { selectedModelConfigId, ensureModelActive } = modelAction
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [pageCount, setPageCount] = useState('5')
  const [attachedReferenceFile, setAttachedReferenceFile] = useState<AttachedReferenceFile | null>(
    null
  )
  const [referenceDocumentPath, setReferenceDocumentPath] = useState<string | null>(null)
  const [parsingDocument, setParsingDocument] = useState(false)
  const [documentParseError, setDocumentParseError] = useState<string | null>(null)
  const [hasParsedSource, setHasParsedSource] = useState(false)
  const [documentPlanSuggestion, setDocumentPlanSuggestion] =
    useState<DocumentPlanSuggestion | null>(null)
  const [suggestionDraft, setSuggestionDraft] = useState<DocumentPlanSuggestionDraft | null>(null)
  const [acceptedSourcePlan, setAcceptedSourcePlan] =
    useState<DocumentPlanSuggestion['sourcePlan']>(undefined)
  const [suggestionDialogOpen, setSuggestionDialogOpen] = useState(false)
  const [editingSuggestionField, setEditingSuggestionField] = useState<
    'topic' | 'pageCount' | 'brief' | null
  >(null)
  const [editingOutlineIndex, setEditingOutlineIndex] = useState<number | null>(null)
  const [applyTitleSuggestion, setApplyTitleSuggestion] = useState(false)
  const [applyPageCountSuggestion, setApplyPageCountSuggestion] = useState(false)
  const [applyBriefSuggestion, setApplyBriefSuggestion] = useState(false)
  const [creating, setCreating] = useState(false)
  const documentInputRef = useRef<HTMLInputElement | null>(null)
  const open = Boolean(template)

  useEffect(() => {
    if (!template) return
    setTitle(template.name)
    setBrief('')
    setPageCount(String(resolvePageCount(String(template.pageCount || 5), 5)))
    setAttachedReferenceFile(null)
    setReferenceDocumentPath(null)
    setDocumentParseError(null)
    setHasParsedSource(false)
    setDocumentPlanSuggestion(null)
    setSuggestionDraft(null)
    setAcceptedSourcePlan(undefined)
    setEditingSuggestionField(null)
    setEditingOutlineIndex(null)
    setSuggestionDialogOpen(false)
  }, [template])

  const close = (): void => {
    if (creating || parsingDocument) return
    onOpenChange(false)
  }

  const ensureUploadPrerequisites = async (): Promise<boolean> => {
    const validation = await ipc.validateUploadPrerequisites()
    if (validation.ready) return true
    warning(t('templates.settingsRequiredTitle'), {
      description: validation.message || t('templates.settingsRequiredDescription'),
      action: {
        label: t('templates.goToSettings'),
        onClick: () => navigate('/settings')
      }
    })
    return false
  }

  const handleChooseDocumentClick = async (): Promise<void> => {
    if (parsingDocument) return
    if (!(await ensureUploadPrerequisites())) return
    documentInputRef.current?.click()
  }

  const handleDocumentFilesSelected = async (files: FileList | null): Promise<void> => {
    const selectedFiles = Array.from(files || [])
    if (documentInputRef.current) {
      documentInputRef.current.value = ''
    }
    if (!template || selectedFiles.length === 0) return
    if (selectedFiles.length > 1) {
      const message = t('templates.documentSingleOnly')
      setDocumentParseError(message)
      error(t('templates.documentCountExceeded'), { description: message })
      return
    }

    const selectedFile = selectedFiles[0]
    if (selectedFile.size > MAX_DOCUMENT_SIZE_BYTES) {
      const message = t('templates.documentTooLarge', { maxSize: MAX_DOCUMENT_SIZE_MB })
      setDocumentParseError(message)
      error(t('templates.documentTooLargeTitle'), { description: message })
      return
    }

    const payloadFiles = selectedFiles
      .map((file) => ({
        path: window.electron?.getPathForFile?.(file) || '',
        name: file.name
      }))
      .filter((file) => file.path)
    if (payloadFiles.length === 0) {
      setDocumentParseError(t('templates.documentPathFailed'))
      error(t('templates.documentPathFailedTitle'))
      return
    }

    setParsingDocument(true)
    setDocumentParseError(null)
    setHasParsedSource(false)
    try {
      const result = await ipc.prepareReferenceDocument({ files: payloadFiles })
      const referenceFile = result.files[0]
      setAttachedReferenceFile(referenceFile || null)
      setReferenceDocumentPath(
        referenceFile && referenceFile.type !== 'image' ? referenceFile.path : null
      )
      setDocumentPlanSuggestion(null)
      setSuggestionDraft(null)
      setAcceptedSourcePlan(undefined)
      setEditingSuggestionField(null)
      setEditingOutlineIndex(null)
      setSuggestionDialogOpen(false)
      success(t('templates.referenceAttached'), {
        description: referenceFile?.name || selectedFile.name
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.retryLater')
      setDocumentParseError(message)
      error(t('templates.referenceAttachFailed'), { description: message })
    } finally {
      setParsingDocument(false)
    }
  }

  const handleRemoveReferenceFile = (): void => {
    setAttachedReferenceFile(null)
    setReferenceDocumentPath(null)
    setDocumentParseError(null)
    setHasParsedSource(false)
    setDocumentPlanSuggestion(null)
    setSuggestionDraft(null)
    setAcceptedSourcePlan(undefined)
    setEditingSuggestionField(null)
    setEditingOutlineIndex(null)
    setSuggestionDialogOpen(false)
  }

  const handleAnalyzeDocument = async (modelConfigId = selectedModelConfigId): Promise<void> => {
    if (!template || !attachedReferenceFile || parsingDocument) return
    if (!(await ensureModelActive(modelConfigId))) return

    setParsingDocument(true)
    setDocumentParseError(null)
    try {
      const result = await ipc.parseDocumentPlan({
        files: [{ path: attachedReferenceFile.path, name: attachedReferenceFile.name }],
        topic: title.trim() || template.name,
        existingBrief: brief.trim()
      })
      const referenceFile = result.files[0] || attachedReferenceFile
      setAttachedReferenceFile(referenceFile)
      setReferenceDocumentPath(referenceFile.type !== 'image' ? referenceFile.path : null)
      const nextSuggestion = {
        topic: result.topic || title || template.name,
        pageCount: resolvePageCount(String(result.pageCount), 5),
        briefText: result.briefText,
        sourcePlan: result.sourcePlan
      }
      setDocumentPlanSuggestion(nextSuggestion)
      setSuggestionDraft(buildSuggestionDraft(nextSuggestion))
      setAcceptedSourcePlan(undefined)
      setEditingSuggestionField(null)
      setEditingOutlineIndex(null)
      setApplyTitleSuggestion(!title.trim() || title.trim() === template.name)
      setApplyPageCountSuggestion(!result.sourcePlan?.pageSkeleton.length)
      setApplyBriefSuggestion(Boolean(result.sourcePlan?.pageSkeleton.length) || !brief.trim())
      setSuggestionDialogOpen(true)
      setHasParsedSource(true)
      success(t('templates.documentParsed'), {
        description: t('templates.documentParsedDescription', { count: result.files.length })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : t('common.retryLater')
      setDocumentParseError(message)
      error(t('templates.documentParseFailed'), { description: message })
    } finally {
      setParsingDocument(false)
    }
  }

  const applyDocumentSuggestion = (): void => {
    const draft =
      suggestionDraft ||
      (documentPlanSuggestion ? buildSuggestionDraft(documentPlanSuggestion) : null)
    if (!draft) return
    const sourceOutlinePageCount = draft.sourcePlan?.pageSkeleton.length || 0
    const hasSourceOutline = sourceOutlinePageCount > 0
    const shouldApplySourceOutline = hasSourceOutline && applyBriefSuggestion

    if (applyTitleSuggestion) setTitle(draft.topic)
    if (shouldApplySourceOutline) {
      setPageCount(String(resolvePageCount(String(sourceOutlinePageCount), 5)))
    } else if (applyPageCountSuggestion) {
      setPageCount(String(resolvePageCount(draft.pageCount, 5)))
    }
    if (applyBriefSuggestion) {
      setBrief(
        draft.sourcePlan?.pageSkeleton.length
          ? formatSourceOutlineBriefText(draft.sourcePlan.pageSkeleton)
          : draft.briefText
      )
    }
    setAcceptedSourcePlan(shouldApplySourceOutline ? draft.sourcePlan : undefined)
    setSuggestionDialogOpen(false)
  }

  const handleCreate = async (modelConfigId = selectedModelConfigId): Promise<void> => {
    if (!template || creating) return
    if (!(await ensureModelActive(modelConfigId))) return
    const deckTitle = title.trim() || template.name
    const briefText = brief.trim()
    if (!briefText) {
      warning(t('templates.briefRequired'))
      return
    }
    const safePageCount = resolvePageCount(pageCount, template.pageCount || 5)
    setCreating(true)
    try {
      const sessionId = await createSessionFromTemplate({
        templateId: template.id,
        title: deckTitle,
        pageCount: safePageCount,
        referenceDocumentPath: referenceDocumentPath || undefined,
        sourcePlan: acceptedSourcePlan
      })
      const initialPrompt = buildTemplateInitialPrompt({
        templateName: template.name,
        title: deckTitle,
        pageCount: safePageCount,
        brief: briefText
      })
      success(t('templates.sessionCreated'), {
        description: t('templates.sessionCreatedDescription')
      })
      onOpenChange(false)
      navigate(`/sessions/${sessionId}/template-generating`, {
        state: { initialPrompt }
      })
    } catch (err) {
      error(t('templates.createFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setCreating(false)
    }
  }

  const sourceOutlineItems = suggestionDraft?.sourcePlan?.pageSkeleton ?? []
  const hasSourceOutline = sourceOutlineItems.length > 0
  const updateSuggestionOutlineItem = (
    index: number,
    patch: Partial<DocumentPlanPageSkeletonItem>
  ): void => {
    setSuggestionDraft((current) =>
      current
        ? updateDraftSourcePlanItems(current, (items) =>
            items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
          )
        : current
    )
  }
  const deleteSuggestionOutlineItem = (index: number): void => {
    setSuggestionDraft((current) =>
      current
        ? updateDraftSourcePlanItems(current, (items) =>
            items.filter((_, itemIndex) => itemIndex !== index)
          )
        : current
    )
  }
  const suggestionCardClass =
    'rounded-lg border border-[#d7e8cc] bg-[#fbfff7] px-3 py-2.5 shadow-[0_4px_10px_rgba(93,107,77,0.06)]'
  const suggestionIconButtonClass =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#bfd9ae] bg-[#f8fff3] text-[#5f7448] transition-colors hover:bg-[#edf8e5]'
  const deleteSuggestionIconButtonClass =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[#e1c4b9] bg-[#fff8f5] text-[#9a5d4d] transition-colors hover:bg-[#f5ded6]'

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && close()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4" />
              {t('templates.useDialogTitle')}
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              {t('templates.useDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-[#5f6b50]">
                  {t('templates.sessionTitleLabel')}
                </label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="w-full sm:w-28">
                <label className="mb-1 block text-xs font-medium text-[#5f6b50]">
                  {t('templates.pageCountLabel')}
                </label>
                <Input
                  value={pageCount}
                  inputMode="numeric"
                  onChange={(event) => {
                    setAcceptedSourcePlan(undefined)
                    setPageCount(event.target.value)
                  }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-[#5f6b50]">
                  {t('templates.briefLabel')}
                </label>
                {hasParsedSource && !parsingDocument ? (
                  <span className="rounded-full bg-[#e8f0df] px-2 py-0.5 text-[11px] text-[#4f6340]">
                    {t('templates.parsed')}
                  </span>
                ) : null}
              </div>
              <Textarea
                value={brief}
                onChange={(event) => {
                  setAcceptedSourcePlan(undefined)
                  setBrief(event.target.value)
                }}
                className="min-h-[160px]"
                placeholder={t('templates.briefPlaceholder')}
              />
            </div>
            {attachedReferenceFile ? (
              <div className="flex min-w-0">
                <span
                  className="inline-flex h-6 max-w-[260px] items-center gap-1 rounded-full border border-[#c7d9b4]/70 bg-[#e6f1dc]/80 px-2 text-[10px] text-[#405333]"
                  title={attachedReferenceFile.path}
                >
                  <FileText className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate">{attachedReferenceFile.name}</span>
                  <button
                    type="button"
                    onClick={handleRemoveReferenceFile}
                    className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-[#657552] hover:bg-[#c8ddb2]"
                    aria-label={t('templates.removeReference')}
                  >
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              </div>
            ) : null}
            <input
              ref={documentInputRef}
              type="file"
              accept=".md,.txt,.text,.csv,.docx"
              multiple={false}
              className="hidden"
              onChange={(event) => void handleDocumentFilesSelected(event.target.files)}
            />
            <TooltipProvider delayDuration={180}>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleChooseDocumentClick()}
                        disabled={parsingDocument || creating}
                        className="h-8 shrink-0 rounded-lg border border-[#d8ccb5]/80 bg-[#fffdf8]/76 px-2.5 text-xs font-medium text-[#405333] shadow-none hover:bg-[#f3f7ed] hover:text-[#2f3b28]"
                      >
                        {parsingDocument ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <FileText className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {parsingDocument
                          ? t('templates.processingDocument')
                          : t('templates.uploadDocument')}
                      </Button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" align="start">
                    {t('templates.uploadDocumentTooltip', { maxSize: MAX_DOCUMENT_SIZE_MB })}
                  </TooltipContent>
                </Tooltip>
                {attachedReferenceFile ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <ModelSplitButton
                          modelAction={modelAction}
                          label={t('templates.analyzeDocument')}
                          loadingLabel={t('templates.analyzingDocument')}
                          loading={parsingDocument}
                          disabled={creating || !attachedReferenceFile}
                          icon={Sparkles}
                          tone="primary"
                          dropdownAlign="start"
                          className="h-8 rounded-lg border-0 bg-gradient-to-r from-[#7f965f] to-[#5f7448] shadow-[0_8px_18px_rgba(93,107,77,0.18)]"
                          mainClassName="h-full bg-transparent px-2.5 text-xs text-white shadow-none hover:bg-white/10 hover:text-white hover:shadow-none"
                          triggerClassName="h-full w-8 px-0"
                          onRun={handleAnalyzeDocument}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" align="start" className="max-w-xs">
                      {t('templates.analyzeDocumentTooltip')}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
                <span className="text-xs text-muted-foreground">
                  {t('templates.supportedDocuments', { maxSize: MAX_DOCUMENT_SIZE_MB })}
                </span>
              </div>
            </TooltipProvider>
            {documentParseError ? (
              <div className="flex items-start gap-2 rounded-md border border-[#d58b7f]/45 bg-[#fff2ef] px-3 py-2 text-xs text-[#8a3d33]">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{documentParseError}</span>
              </div>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={close}
              disabled={creating || parsingDocument}
            >
              {t('common.cancel')}
            </Button>
            <ModelSplitButton
              modelAction={modelAction}
              label={t('templates.createAndGenerate')}
              loadingLabel={t('templates.creating')}
              loading={creating}
              disabled={parsingDocument}
              icon={Sparkles}
              tone="primary"
              onRun={handleCreate}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={suggestionDialogOpen}
        onOpenChange={(next) => {
          setSuggestionDialogOpen(next)
          if (!next) {
            setEditingSuggestionField(null)
            setEditingOutlineIndex(null)
          }
        }}
      >
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
                {attachedReferenceFile ? (
                  <span
                    className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#d8ccb5]/72 bg-[#fff9ef]/86 px-2 py-1 text-[11px] font-medium text-[#5d6b4d]"
                    title={attachedReferenceFile.path}
                  >
                    <FileText className="h-3 w-3 shrink-0" />
                    <span className="min-w-0 truncate">{attachedReferenceFile.name}</span>
                  </span>
                ) : null}
              </div>
            </div>
          </DialogHeader>

          {suggestionDraft ? (
            <div className="max-h-[64vh] overflow-y-auto px-5 py-4">
              <div className="space-y-2.5">
                <section
                  className={`overflow-hidden rounded-xl border bg-[#fffdf8] shadow-[0_8px_18px_rgba(74,59,42,0.06)] transition-colors ${
                    applyTitleSuggestion
                      ? 'border-[#a9c693] ring-1 ring-[#cfe2c1]'
                      : 'border-[#e1d7c6]'
                  }`}
                >
                  <div className="p-3">
                    <div className={suggestionCardClass}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <input
                          type="checkbox"
                          checked={applyTitleSuggestion}
                          onChange={(event) => setApplyTitleSuggestion(event.target.checked)}
                          className="h-4 w-4 accent-[#6f8f64]"
                          aria-label={t('templates.sessionTitleLabel')}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setEditingSuggestionField(
                              editingSuggestionField === 'topic' ? null : 'topic'
                            )
                          }
                          className={suggestionIconButtonClass}
                          aria-label={
                            editingSuggestionField === 'topic' ? t('common.save') : t('common.edit')
                          }
                          title={
                            editingSuggestionField === 'topic' ? t('common.save') : t('common.edit')
                          }
                        >
                          {editingSuggestionField === 'topic' ? (
                            <Check className="h-3.5 w-3.5" />
                          ) : (
                            <Pencil className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </div>
                      {editingSuggestionField === 'topic' ? (
                        <Input
                          value={suggestionDraft.topic}
                          onChange={(event) =>
                            setSuggestionDraft((current) =>
                              current ? { ...current, topic: event.target.value } : current
                            )
                          }
                          className="h-8 border-[#cddfbe] bg-white text-xs text-[#405333]"
                        />
                      ) : (
                        <p className="whitespace-pre-wrap text-sm font-medium leading-5 text-[#34402c]">
                          {suggestionDraft.topic || t('home.emptyValue')}
                        </p>
                      )}
                    </div>
                  </div>
                </section>

                {hasSourceOutline && (
                  <section
                    className={`overflow-hidden rounded-xl border bg-[#fffdf8] shadow-[0_8px_18px_rgba(74,59,42,0.06)] transition-colors ${
                      applyBriefSuggestion
                        ? 'border-[#a9c693] ring-1 ring-[#cfe2c1]'
                        : 'border-[#e1d7c6]'
                    }`}
                  >
                    <div className="p-3">
                      <div className="rounded-lg bg-[#eef6e8] px-3 py-2.5">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <input
                            type="checkbox"
                            checked={applyBriefSuggestion}
                            onChange={(event) => setApplyBriefSuggestion(event.target.checked)}
                            className="h-4 w-4 accent-[#6f8f64]"
                            aria-label={t('home.documentOutline')}
                          />
                          <span className="rounded-full border border-[#bfd9ae] bg-[#f8fff3] px-2 py-0.5 text-[11px] font-medium text-[#405333]">
                            {t('home.outlinePageCount', { count: sourceOutlineItems.length })}
                          </span>
                        </div>
                        <ol className="grid max-h-80 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                          {sourceOutlineItems.map((item, index) => (
                            <li
                              key={`${item.pageNumber}-${item.lineStart}-${item.sourceHeading}`}
                              className="rounded-lg border border-[#d7e8cc] bg-[#fbfff7] px-3 py-2.5 shadow-[0_4px_10px_rgba(93,107,77,0.06)]"
                            >
                              <div className="flex min-w-0 items-start justify-between gap-2">
                                <div className="flex min-w-0 items-start gap-2">
                                  <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#dceccb] text-[10px] font-semibold text-[#405333]">
                                    {item.pageNumber}
                                  </span>
                                  <div className="min-w-0">
                                    {editingOutlineIndex === index ? (
                                      <p className="text-[10px] font-medium text-[#6a8054]">
                                        {t('home.outlineItemTitle')}
                                      </p>
                                    ) : (
                                      <h4 className="min-w-0 break-words text-sm font-semibold leading-5 text-[#34402c]">
                                        {item.title || t('home.emptyValue')}
                                      </h4>
                                    )}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingOutlineIndex(
                                        editingOutlineIndex === index ? null : index
                                      )
                                    }
                                    className={suggestionIconButtonClass}
                                    aria-label={
                                      editingOutlineIndex === index
                                        ? t('common.save')
                                        : t('common.edit')
                                    }
                                    title={
                                      editingOutlineIndex === index
                                        ? t('common.save')
                                        : t('common.edit')
                                    }
                                  >
                                    {editingOutlineIndex === index ? (
                                      <Check className="h-3.5 w-3.5" />
                                    ) : (
                                      <Pencil className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => deleteSuggestionOutlineItem(index)}
                                    className={deleteSuggestionIconButtonClass}
                                    aria-label={t('common.delete')}
                                    title={t('common.delete')}
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                              {editingOutlineIndex === index ? (
                                <div className="mt-2 grid min-w-0 gap-1.5">
                                  <Input
                                    value={item.title}
                                    onChange={(event) =>
                                      updateSuggestionOutlineItem(index, {
                                        title: event.target.value
                                      })
                                    }
                                    className="h-7 min-w-0 border-[#cddfbe] bg-white px-2 text-xs font-semibold text-[#34402c]"
                                  />
                                  <p className="text-[10px] font-medium text-[#6a8054]">
                                    {t('home.outlineItemContent')}
                                  </p>
                                  <Textarea
                                    value={item.reason}
                                    onChange={(event) =>
                                      updateSuggestionOutlineItem(index, {
                                        reason: event.target.value
                                      })
                                    }
                                    className="max-h-24 min-h-14 resize-y border-[#d7e8cc] bg-white px-2 py-1.5 text-[11px] leading-5 text-[#6d604d]"
                                  />
                                </div>
                              ) : (
                                <div className="mt-2">
                                  <p className="text-[10px] font-medium text-[#6a8054]">
                                    {t('home.outlineItemContent')}
                                  </p>
                                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-xs leading-5 text-[#6d604d]">
                                    {item.reason || t('home.emptyValue')}
                                  </p>
                                </div>
                              )}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  </section>
                )}

                {!hasSourceOutline && (
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
                          {t('templates.pageCountLabel')}
                        </span>
                      </label>
                      <div className={suggestionCardClass}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-medium uppercase text-[#6a8054]">
                            {t('home.suggestedValue')}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingSuggestionField(
                                editingSuggestionField === 'pageCount' ? null : 'pageCount'
                              )
                            }
                            className={suggestionIconButtonClass}
                            aria-label={
                              editingSuggestionField === 'pageCount'
                                ? t('common.save')
                                : t('common.edit')
                            }
                            title={
                              editingSuggestionField === 'pageCount'
                                ? t('common.save')
                                : t('common.edit')
                            }
                          >
                            {editingSuggestionField === 'pageCount' ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                        {editingSuggestionField === 'pageCount' ? (
                          <Input
                            value={suggestionDraft.pageCount}
                            inputMode="numeric"
                            onChange={(event) => {
                              const next = event.target.value
                              if (next === '' || /^\d+$/.test(next)) {
                                setSuggestionDraft((current) =>
                                  current ? { ...current, pageCount: next } : current
                                )
                              }
                            }}
                            className="h-8 border-[#cddfbe] bg-white text-xs text-[#405333]"
                          />
                        ) : (
                          <p className="text-sm font-semibold leading-5 text-[#34402c]">
                            {suggestionDraft.pageCount || t('home.emptyValue')}
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                )}

                {!hasSourceOutline && (
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
                          {t('templates.briefLabel')}
                        </span>
                      </label>
                      <div className={suggestionCardClass}>
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <p className="text-[10px] font-medium uppercase text-[#6a8054]">
                            {t('home.suggestedValue')}
                          </p>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingSuggestionField(
                                editingSuggestionField === 'brief' ? null : 'brief'
                              )
                            }
                            className={suggestionIconButtonClass}
                            aria-label={
                              editingSuggestionField === 'brief'
                                ? t('common.save')
                                : t('common.edit')
                            }
                            title={
                              editingSuggestionField === 'brief'
                                ? t('common.save')
                                : t('common.edit')
                            }
                          >
                            {editingSuggestionField === 'brief' ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              <Pencil className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                        {editingSuggestionField === 'brief' ? (
                          <Textarea
                            value={suggestionDraft.briefText}
                            onChange={(event) =>
                              setSuggestionDraft((current) =>
                                current ? { ...current, briefText: event.target.value } : current
                              )
                            }
                            className="max-h-40 min-h-24 resize-y border-[#cddfbe] bg-white text-xs leading-5 text-[#405333]"
                          />
                        ) : (
                          <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-[#405333]">
                            {suggestionDraft.briefText || t('home.emptyValue')}
                          </p>
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          ) : null}

          <DialogFooter className="flex-col-reverse gap-1.5 border-t border-[#ded4c1] bg-[#fffaf1] px-5 py-2.5 sm:flex-row">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setSuggestionDialogOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button size="sm" className="h-8 px-3 text-xs" onClick={applyDocumentSuggestion}>
              {t('home.applySelectedFields')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
