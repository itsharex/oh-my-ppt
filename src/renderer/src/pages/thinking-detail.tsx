import { useEffect, useState, type ReactElement } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useThinkingStore } from '../store/thinkingStore'
import { useSessionStore, useToastStore } from '../store'
import { ipc } from '@renderer/lib/ipc'
import { ThinkingChat } from '../components/thinking/ThinkingChat'
import { ThinkingPageCards } from '../components/thinking/ThinkingPageCards'
import { GenerationConfirmDialog } from '../components/thinking/GenerationConfirmDialog'
import { useT } from '../i18n'
import type {
  ThinkingChatMessage,
  ThinkingSource,
  ThinkingPrepareGenerationResult
} from '@shared/thinking'

const buildWelcomeMessage = (
  t: (key: 'thinking.welcomeMessage') => string
): ThinkingChatMessage => ({
  role: 'assistant',
  content: t('thinking.welcomeMessage'),
  timestamp: Date.now()
})

const buildThinkingGenerationPrompt = (args: {
  topic: string
  pageCount: number
  thinkingMd: string
}): string =>
  [
    `Create a ${args.pageCount}-slide presentation about "${args.topic}" from the finalized thinking document below.`,
    'Treat each "## Page N: ..." section as the exact intended page structure.',
    'For each page, honor Role, Objective, Summary, and key points as the page brief.',
    'If the attached reference document includes image source notes, use the listed ./images/... public paths when relevant.',
    'Determine the presentation content language from the thinking document and source notes; do not infer it from the application UI language.',
    '',
    'Final thinking document:',
    args.thinkingMd
  ].join('\n')

export function ThinkingDetailPage(): ReactElement {
  const t = useT()
  const navigate = useNavigate()
  const { thinkingId } = useParams<{ thinkingId: string }>()
  const { success, error: toastError } = useToastStore()
  const { createSession } = useSessionStore()
  const {
    thinkingMd,
    stage,
    messages,
    sources,
    loading,
    thinkingSteps,
    animatingText,
    loadWorkspace,
    sendMessage,
    addThinkingStep,
    setAnimatingText
  } = useThinkingStore()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [prepared, setPrepared] = useState<ThinkingPrepareGenerationResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [pendingSources, setPendingSources] = useState<ThinkingSource[]>([])

  useEffect(() => {
    if (thinkingId) {
      void loadWorkspace(thinkingId)
    }
  }, [thinkingId, loadWorkspace])

  // Listen for thinking events and final result
  useEffect(() => {
    const unsubscribeThinking = ipc.onThinkingStreamThinking((payload) => {
      if (payload.thinkingId === thinkingId) {
        addThinkingStep({
          type: payload.type as 'tool_call' | 'tool_result',
          toolName: payload.toolName,
          summary: payload.summary
        })
      }
    })
    const unsubscribeEnd = ipc.onThinkingStreamEnd((payload) => {
      if (payload.thinkingId === thinkingId) {
        // Update workspace state immediately
        useThinkingStore.setState({
          thinkingMd: payload.thinkingMd,
          contextMd: payload.contextMd,
          stage: payload.stage
        })
        // Start typing animation for the reply
        const fullText = payload.reply
        if (!fullText) {
          useThinkingStore.setState({ loading: false, thinkingSteps: [], animatingText: '' })
          return
        }
        let index = 0
        const CHARS_PER_TICK = 3
        const TICK_MS = 20
        const animate = (): void => {
          const current = useThinkingStore.getState()
          if (!current.loading) return
          index = Math.min(index + CHARS_PER_TICK, fullText.length)
          current.setAnimatingText(fullText.slice(0, index))
          if (index < fullText.length) {
            setTimeout(animate, TICK_MS)
          } else {
            // Animation complete — finalize
            current.addMessage({
              role: 'assistant',
              content: fullText,
              timestamp: Date.now()
            })
            useThinkingStore.setState({
              loading: false,
              thinkingSteps: [],
              animatingText: ''
            })
          }
        }
        animate()
      }
    })
    return () => {
      unsubscribeThinking()
      unsubscribeEnd()
    }
  }, [thinkingId, addThinkingStep, setAnimatingText])

  const handleSend = (content: string): void => {
    const attachments = pendingSources.length > 0 ? pendingSources : undefined
    setPendingSources([])
    void sendMessage(content, attachments)
  }

  const handleSourcesUploaded = (newSources: ThinkingSource[]): void => {
    useThinkingStore.setState((state) => ({
      sources: [...state.sources, ...newSources]
    }))
    setPendingSources((prev) => [...prev, ...newSources])
  }

  const handleSourceRemoved = (sourceId: string): void => {
    useThinkingStore.setState((state) => ({
      sources: state.sources.filter((source) => source.id !== sourceId)
    }))
    setPendingSources((prev) => prev.filter((source) => source.id !== sourceId))
  }

  const handleConfirmGenerate = async (): Promise<void> => {
    if (!thinkingId) return
    try {
      const result = await ipc.thinkingPrepareGeneration({ thinkingId })
      setPrepared(result)
      setConfirmOpen(true)
    } catch (err) {
      toastError(t('thinking.prepareFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    }
  }

  const handleRevealWorkspace = async (): Promise<void> => {
    if (!thinkingId) return
    try {
      await ipc.thinkingRevealWorkspace(thinkingId)
    } catch (err) {
      toastError(t('thinking.revealWorkspace'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    }
  }

  const handleGenerationConfirm = async (params: {
    topic: string
    pageCount: number
    styleId: string
    fontSelection: import('@shared/generation').FontSelection
    referenceDocumentPath: string
    modelConfigId?: string
  }): Promise<void> => {
    if (generating || !prepared) return
    setGenerating(true)
    try {
      const sessionId = await createSession({
        topic: params.topic,
        styleId: params.styleId,
        pageCount: params.pageCount,
        referenceDocumentPath: params.referenceDocumentPath,
        fontSelection: params.fontSelection
      })
      success(t('home.sessionCreated'), {
        description: t('home.generationStarted'),
        duration: 1000
      })
      navigate(`/sessions/${sessionId}/generating`, {
        state: {
          initialPrompt: buildThinkingGenerationPrompt({
            topic: params.topic,
            pageCount: params.pageCount,
            thinkingMd
          })
        }
      })
    } catch (err) {
      toastError(t('home.sessionCreateFailed'), {
        description: err instanceof Error ? err.message : t('common.retryLater')
      })
    } finally {
      setGenerating(false)
    }
  }

  const displayMessages = messages.length > 0 ? messages : [buildWelcomeMessage(t)]
  const showOutlinePanel = stage !== 'collect'

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f5f1e8] text-foreground">
      <div className="shrink-0 border-b border-[#e0d8c8] bg-[#f5f1e8]/90 px-6 py-4 backdrop-blur">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
            {t('thinking.eyebrow')}
          </p>
          <h1 className="organic-serif mt-2 flex min-w-0 items-baseline gap-3 text-[32px] font-semibold leading-none text-[#3e4a32]">
            <span className="truncate">{t('thinking.title')}</span>
            <button
              type="button"
              className="min-w-0 rounded-full px-2 py-0.5 font-mono text-[11px] font-normal leading-none text-[#7a806c] transition-colors hover:bg-[#d4e4c1] hover:text-[#3e4a32]"
              onClick={() => void handleRevealWorkspace()}
              title={t('thinking.revealWorkspace')}
            >
              {thinkingId}
            </button>
          </h1>
          <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">
            {t('thinking.description')}
          </p>
        </div>
      </div>

      <div
        className={`grid min-h-0 flex-1 gap-4 p-4 ${
          showOutlinePanel ? 'lg:grid-cols-[minmax(0,1fr)_360px]' : 'grid-cols-1'
        }`}
      >
        <section className="min-h-0 overflow-hidden rounded-[2rem] border border-[#e0d8c8] bg-[#fffdf8] shadow-[0_14px_34px_rgba(86,73,54,0.12)]">
          <ThinkingChat
            thinkingId={thinkingId || ''}
            messages={displayMessages}
            sources={sources}
            pendingSources={pendingSources}
            loading={loading}
            thinkingSteps={thinkingSteps}
            animatingText={animatingText}
            onSend={handleSend}
            onSourcesUploaded={handleSourcesUploaded}
            onSourceRemoved={handleSourceRemoved}
          />
        </section>
        {showOutlinePanel && (
          <aside className="min-h-0 overflow-hidden rounded-[2rem] border border-[#c8d6ba] bg-[#d4e4c1] shadow-[0_14px_34px_rgba(86,73,54,0.12)]">
            <ThinkingPageCards
              thinkingMd={thinkingMd}
              stage={stage}
              onConfirmGenerate={() => void handleConfirmGenerate()}
              loading={loading || generating}
            />
          </aside>
        )}
      </div>

      <GenerationConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        prepared={prepared}
        onConfirm={(params) => void handleGenerationConfirm(params)}
      />
    </div>
  )
}
