import { MessageCircle, Sparkles } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSessionDetailUiStore } from '@renderer/store'
import { useT } from '@renderer/i18n'
import { ChatPanel } from './ChatPanel'
import { ImageGenerationPanel } from './ImageGenerationPanel'
import { sessionDetailRightPanelContentClass } from '../workspace/right-panel/styles'

export function MessagePanel({ sessionId }: { sessionId: string }): React.JSX.Element {
  const t = useT()
  const aiPanelMode = useSessionDetailUiStore((state) => state.aiPanelMode)
  const setAiPanelMode = useSessionDetailUiStore((state) => state.setAiPanelMode)

  return (
    <div className={sessionDetailRightPanelContentClass}>
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
        <ImageGenerationPanel sessionId={sessionId} />
      ) : (
        <ChatPanel sessionId={sessionId} />
      )}
    </div>
  )
}
