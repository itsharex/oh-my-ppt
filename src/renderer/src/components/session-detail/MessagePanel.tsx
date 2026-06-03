import { MessageCircle, Sparkles } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailUiStore } from '@renderer/store'
import { useT } from '@renderer/i18n'
import type { GeneratedImageAsset } from '@shared/image-generation.js'
import { ChatPanel } from './ChatPanel'
import { ImageGenerationPanel } from './ImageGenerationPanel'

type PanelProgress = {
  label?: string
  progress: number
}

export function MessagePanel({
  sessionId,
  selectedPageExists,
  selectedPageHtmlPath,
  selectedPageNumber,
  selectedPageTitle,
  selectedPageOutline,
  isGenerating,
  progress,
  error,
  onDropFiles,
  onChooseAssets,
  onSend,
  onCancel,
  onGenerateImage,
  onCancelImageGeneration,
  onAddGeneratedImageToCanvas,
  onSetGeneratedImageAsBackground,
  onRevealImageFile,
  cleanMessageContent
}: {
  sessionId?: string
  selectedPageExists: boolean
  selectedPageHtmlPath?: string
  selectedPageNumber?: number | null
  selectedPageTitle?: string
  selectedPageOutline?: string | null
  isGenerating: boolean
  progress: PanelProgress | null
  error: string | null
  onDropFiles: (files: File[]) => void
  onChooseAssets: (assetType: 'image' | 'video') => void
  onSend: () => void
  onCancel: () => void
  onGenerateImage: () => void
  onCancelImageGeneration: () => void
  onAddGeneratedImageToCanvas: (asset: GeneratedImageAsset) => void
  onSetGeneratedImageAsBackground: (asset: GeneratedImageAsset) => void
  onRevealImageFile: (filePath: string) => void
  cleanMessageContent: (content: string) => string
}): React.JSX.Element {
  const t = useT()
  const aiPanelMode = useSessionDetailUiStore((state) => state.aiPanelMode)
  const setAiPanelMode = useSessionDetailUiStore((state) => state.setAiPanelMode)

  return (
    <aside className="mr-3 mb-3 mt-1 flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-[2rem] border border-[#ded2bd]/60 bg-[#f3ecdf]/76 shadow-[0_14px_32px_rgba(74,59,42,0.11)] backdrop-blur-xl">
      <div className="mx-2.5 mt-2.5 grid grid-cols-2 gap-1 rounded-[1.1rem] border border-[#ded2bd]/70 bg-[#fffaf1]/78 p-1 shadow-[0_4px_12px_rgba(77,61,43,0.06)]">
        <button
          type="button"
          onClick={() => setAiPanelMode('chat')}
          className={cn(
            'inline-flex h-8 items-center justify-center gap-1.5 rounded-[0.85rem] text-xs font-medium transition-colors',
            aiPanelMode === 'chat'
              ? 'bg-[#dbe7ca] text-[#2f3b28] shadow-sm'
              : 'text-[#6d604d] hover:bg-[#f4ebdc]'
          )}
        >
          <MessageCircle className="h-3.5 w-3.5" />
          {t('sessionDetail.chatMode')}
        </button>
        <button
          type="button"
          onClick={() => setAiPanelMode('image')}
          className={cn(
            'inline-flex h-8 items-center justify-center gap-1.5 rounded-[0.85rem] text-xs font-medium transition-colors',
            aiPanelMode === 'image'
              ? 'bg-[#dbe7ca] text-[#2f3b28] shadow-sm'
              : 'text-[#6d604d] hover:bg-[#f4ebdc]'
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t('sessionDetail.imageMode')}
        </button>
      </div>

      {aiPanelMode === 'image' ? (
        <ImageGenerationPanel
          sessionId={sessionId}
          selectedPageExists={selectedPageExists}
          selectedPageHtmlPath={selectedPageHtmlPath}
          selectedPageNumber={selectedPageNumber}
          selectedPageTitle={selectedPageTitle}
          selectedPageOutline={selectedPageOutline}
          onGenerate={onGenerateImage}
          onCancel={onCancelImageGeneration}
          onAddToCanvas={onAddGeneratedImageToCanvas}
          onSetAsBackground={onSetGeneratedImageAsBackground}
          onRevealFile={onRevealImageFile}
        />
      ) : (
        <ChatPanel
          selectedPageExists={selectedPageExists}
          selectedPageNumber={selectedPageNumber}
          isGenerating={isGenerating}
          progress={progress}
          error={error}
          onDropFiles={onDropFiles}
          onChooseAssets={onChooseAssets}
          onSend={onSend}
          onCancel={onCancel}
          cleanMessageContent={cleanMessageContent}
        />
      )}
    </aside>
  )
}
