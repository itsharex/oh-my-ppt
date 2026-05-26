import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleAlert, FileText, LayoutTemplate, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/Dialog'
import { Input, Textarea } from '../components/ui/Input'
import { SaveTemplateDialog } from '../components/templates/SaveTemplateDialog'
import { TemplateCard, TemplateEmptyState } from '../components/templates/TemplateCard'
import { useTemplateStore, useToastStore } from '../store'
import { ipc, type TemplateListItem } from '../lib/ipc'
import { useT } from '../i18n'

const MIN_PAGE_COUNT = 1
const MAX_PAGE_COUNT = 40
const MAX_DOCUMENT_SIZE_MB = 10
const MAX_DOCUMENT_SIZE_BYTES = MAX_DOCUMENT_SIZE_MB * 1024 * 1024
const DIRECT_CREATE_DONE_DELAY_MS = 500

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

const localAssetUrl = (filePath: string): string =>
  `local-asset://${encodeURI(filePath.replace(/\\/g, '/'))}`

const templateThumbnailUrl = (filePath: string): string => {
  const separator = filePath.includes('?') ? '&' : '?'
  return `${localAssetUrl(filePath)}${separator}print=1&thumbnail=1&fit=off`
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => window.setTimeout(resolve, ms))

export function TemplatesPage(): React.JSX.Element {
  const navigate = useNavigate()
  const t = useT()
  const {
    templates,
    loading,
    fetchTemplates,
    createEditableSessionFromTemplate,
    createSessionFromTemplate,
    updateTemplateMetadata,
    deleteTemplate
  } = useTemplateStore()
  const { success, error, warning } = useToastStore()
  const [useTarget, setUseTarget] = useState<TemplateListItem | null>(null)
  const [previewTarget, setPreviewTarget] = useState<TemplateListItem | null>(null)
  const [editTarget, setEditTarget] = useState<TemplateListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TemplateListItem | null>(null)
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [pageCount, setPageCount] = useState('5')
  const [referenceDocumentPath, setReferenceDocumentPath] = useState<string | null>(null)
  const [parsingDocument, setParsingDocument] = useState(false)
  const [documentParseError, setDocumentParseError] = useState<string | null>(null)
  const [hasParsedSource, setHasParsedSource] = useState(false)
  const [creating, setCreating] = useState(false)
  const [directCreatingTemplateName, setDirectCreatingTemplateName] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const documentInputRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async (): Promise<void> => {
    try {
      await fetchTemplates()
    } catch (err) {
      error(t('templates.loadFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    }
  }, [error, fetchTemplates, t])

  useEffect(() => {
    void load()
  }, [load])

  const openUseDialog = (template: TemplateListItem): void => {
    setUseTarget(template)
    setTitle(template.name)
    setBrief('')
    setPageCount(String(resolvePageCount(String(template.pageCount || 5), 5)))
    setReferenceDocumentPath(null)
    setDocumentParseError(null)
    setHasParsedSource(false)
  }

  const closeUseDialog = (): void => {
    if (creating || parsingDocument) return
    setUseTarget(null)
    setTitle('')
    setBrief('')
    setReferenceDocumentPath(null)
    setDocumentParseError(null)
    setHasParsedSource(false)
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

  const handleParseDocumentClick = async (): Promise<void> => {
    if (parsingDocument) return
    if (!(await ensureUploadPrerequisites())) return
    documentInputRef.current?.click()
  }

  const handleDocumentFilesSelected = async (files: FileList | null): Promise<void> => {
    const selectedFiles = Array.from(files || [])
    if (documentInputRef.current) {
      documentInputRef.current.value = ''
    }
    if (!useTarget || selectedFiles.length === 0) return
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
      const result = await ipc.parseDocumentPlan({
        files: payloadFiles,
        topic: title.trim() || useTarget.name,
        pageCount: resolvePageCount(pageCount, useTarget.pageCount || 5),
        existingBrief: brief.trim()
      })
      setTitle(result.topic || title || useTarget.name)
      setPageCount(String(result.pageCount))
      setBrief(result.briefText)
      const referenceFile = result.files.find((file) => file.type !== 'image')
      setReferenceDocumentPath(referenceFile?.path || null)
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

  const handleCreate = async (): Promise<void> => {
    if (!useTarget || creating) return
    const deckTitle = title.trim() || useTarget.name
    const briefText = brief.trim()
    if (!briefText) {
      warning(t('templates.briefRequired'))
      return
    }
    const safePageCount = resolvePageCount(pageCount, useTarget.pageCount || 5)
    setCreating(true)
    try {
      const sessionId = await createSessionFromTemplate({
        templateId: useTarget.id,
        title: deckTitle,
        pageCount: safePageCount,
        referenceDocumentPath: referenceDocumentPath || undefined
      })
      const initialPrompt = buildTemplateInitialPrompt({
        templateName: useTarget.name,
        title: deckTitle,
        pageCount: safePageCount,
        brief: briefText
      })
      success(t('templates.sessionCreated'), { description: t('templates.sessionCreatedDescription') })
      setUseTarget(null)
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

  const handleCreateEditable = async (template: TemplateListItem): Promise<void> => {
    if (directCreatingTemplateName) return
    const deckTitle = template.name
    setDirectCreatingTemplateName(deckTitle)
    try {
      const sessionId = await createEditableSessionFromTemplate({
        templateId: template.id,
        title: deckTitle
      })
      await wait(DIRECT_CREATE_DONE_DELAY_MS)
      success(t('templates.sessionCreated'), { description: t('templates.directEditCreatedDescription') })
      setUseTarget(null)
      navigate(`/sessions/${sessionId}`)
    } catch (err) {
      error(t('templates.createFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setDirectCreatingTemplateName(null)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await deleteTemplate(deleteTarget.id)
      success(t('templates.deleted'))
      setDeleteTarget(null)
    } catch (err) {
      error(t('templates.deleteFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setDeleting(false)
    }
  }

  const handleUpdateMetadata = async (payload: {
    name: string
    description: string
    tags: string[]
  }): Promise<void> => {
    if (!editTarget || editing) return
    setEditing(true)
    try {
      await updateTemplateMetadata({
        templateId: editTarget.id,
        ...payload
      })
      success(t('templates.updated'))
      setEditTarget(null)
    } catch (err) {
      error(t('templates.updateFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setEditing(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl p-6">
      <div className="mb-6">
        <p className="text-xs uppercase tracking-[0.22em] text-[#8a7e6c]">{t('templates.eyebrow')}</p>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="organic-serif text-[32px] font-semibold leading-none text-[#3e4a32]">{t('templates.title')}</h1>
            <p className="mt-2 text-[12px] text-muted-foreground">
              {t('templates.description')}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-md border border-[#d6c08d]/70 bg-[#fff7e8] px-2.5 py-1.5 text-xs font-medium text-[#7c6a4c]">
              {t('templates.count', { count: templates.length })}
            </span>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {t('templates.refresh')}
            </Button>
          </div>
        </div>
      </div>

      {templates.length === 0 ? (
        <TemplateEmptyState />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onUseDirect={(item) => void handleCreateEditable(item)}
              onUseGenerate={openUseDialog}
              onPreview={setPreviewTarget}
              onEdit={setEditTarget}
              onDelete={setDeleteTarget}
            />
          ))}
        </div>
      )}

      {directCreatingTemplateName ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d261f]/28 backdrop-blur-[2px]">
          <div className="w-[min(360px,calc(100vw-32px))] rounded-xl border border-[#ded2bd]/80 bg-[#fffdf8] px-5 py-4 shadow-[0_18px_45px_rgba(57,47,36,0.22)]">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#eef3e7] text-[#5f6b50]">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[#34402c]">{t('templates.creatingEditable')}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{directCreatingTemplateName}</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <Dialog open={Boolean(previewTarget)} onOpenChange={(open) => !open && setPreviewTarget(null)}>
        <DialogContent className="w-auto max-w-none gap-3 rounded-lg bg-[#f6efe2] p-4">
          <DialogHeader className="pr-10">
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4" />
              {previewTarget?.name || t('templates.previewTitle')}
            </DialogTitle>
          </DialogHeader>
          {previewTarget ? (
            <div className="max-h-[min(72vh,720px)] w-[min(84vw,920px)] overflow-y-auto pr-1">
              <div className="grid justify-center gap-3 [grid-template-columns:repeat(auto-fill,260px)]">
                {(previewTarget.previewPages.length > 0
                  ? previewTarget.previewPages
                  : previewTarget.previewHtmlPath
                    ? [
                        {
                          pageNumber: 1,
                          pageId: 'preview',
                          title: previewTarget.name,
                          htmlPath: previewTarget.previewHtmlPath
                        }
                      ]
                    : []
                ).map((page) => (
                  <div
                    key={`${previewTarget.id}-${page.pageId}-${page.pageNumber}`}
                    className="overflow-hidden rounded-lg border border-[#ded2bd]/80 bg-[#fffdf8] shadow-[0_8px_18px_rgba(74,59,42,0.09)]"
                  >
                    <div className="relative aspect-video overflow-hidden bg-white">
                      <iframe
                        src={templateThumbnailUrl(page.htmlPath)}
                        className="absolute left-0 top-0 h-[900px] w-[1600px] origin-top-left border-0 bg-white"
                        style={{ transform: 'scale(0.1625)' }}
                        title={`${previewTarget.name} page ${page.pageNumber}`}
                      />
                    </div>
                    <div className="flex min-w-0 items-center gap-2 border-t border-[#eee4d2]/80 px-2.5 py-2">
                      <span className="shrink-0 rounded-md bg-[#e8f0df] px-1.5 py-0.5 text-[11px] font-semibold text-[#4f6340]">
                        P{page.pageNumber}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs text-[#5f6b50]">
                        {page.title || t('templates.pageFallback', { pageNumber: page.pageNumber })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(useTarget)} onOpenChange={(open) => !open && closeUseDialog()}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LayoutTemplate className="h-4 w-4" />
              {t('templates.useDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {t('templates.useDialogDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row">
              <div className="min-w-0 flex-1">
                <label className="mb-1 block text-xs font-medium text-[#5f6b50]">{t('templates.sessionTitleLabel')}</label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} />
              </div>
              <div className="w-full sm:w-28">
                <label className="mb-1 block text-xs font-medium text-[#5f6b50]">{t('templates.pageCountLabel')}</label>
                <Input
                  value={pageCount}
                  inputMode="numeric"
                  onChange={(event) => setPageCount(event.target.value)}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-[#5f6b50]">{t('templates.briefLabel')}</label>
                {hasParsedSource && !parsingDocument ? (
                  <span className="rounded-full bg-[#e8f0df] px-2 py-0.5 text-[11px] text-[#4f6340]">
                    {t('templates.parsed')}
                  </span>
                ) : null}
              </div>
              <Textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                className="min-h-[160px]"
                placeholder={t('templates.briefPlaceholder')}
              />
            </div>
            <input
              ref={documentInputRef}
              type="file"
              accept=".md,.txt,.text,.csv,.docx"
              multiple={false}
              className="hidden"
              onChange={(event) => void handleDocumentFilesSelected(event.target.files)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleParseDocumentClick()}
                disabled={parsingDocument || creating}
              >
                {parsingDocument ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="mr-2 h-4 w-4" />
                )}
                {parsingDocument ? t('templates.parsingDocument') : t('templates.uploadDocument')}
              </Button>
              <span className="text-xs text-muted-foreground">
                {t('templates.supportedDocuments', { maxSize: MAX_DOCUMENT_SIZE_MB })}
              </span>
            </div>
            {documentParseError ? (
              <div className="flex items-start gap-2 rounded-md border border-[#d58b7f]/45 bg-[#fff2ef] px-3 py-2 text-xs text-[#8a3d33]">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{documentParseError}</span>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={closeUseDialog} disabled={creating || parsingDocument}>
              {t('common.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={() => void handleCreate()} disabled={creating || parsingDocument}>
              {creating ? t('templates.creating') : t('templates.createAndGenerate')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !deleting && !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('templates.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('templates.deleteDescription', { name: deleteTarget?.name || '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={() => void handleDelete()} disabled={deleting}>
              {deleting ? t('templates.deleting') : t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SaveTemplateDialog
        open={Boolean(editTarget)}
        mode="edit"
        defaultName={editTarget?.name || ''}
        defaultDescription={editTarget?.description || ''}
        defaultTags={editTarget?.tags || []}
        saving={editing}
        onOpenChange={(open) => !open && setEditTarget(null)}
        onSubmit={(payload) => void handleUpdateMetadata(payload)}
      />
    </div>
  )
}
