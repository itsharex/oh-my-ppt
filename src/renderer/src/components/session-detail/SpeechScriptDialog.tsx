import { useEffect, useState } from 'react'
import { Check, Copy, Download, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { useT } from '@renderer/i18n'
import { ipc } from '@renderer/lib/ipc'

type SpeechLength = 'short' | 'medium' | 'long'
type SpeechStyle = 'formal' | 'conversational' | 'storytelling'

export interface SpeechConfig {
  length: SpeechLength
  style: SpeechStyle
}

interface SpeechScriptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionId: string
  isGenerating: boolean
  speechProgress: { current: number; total: number } | null
  speechConfig: SpeechConfig
  onConfigChange: (config: SpeechConfig) => void
  onGenerate: (config: SpeechConfig) => void
  sessionTitle?: string
}

function OptionButton({
  selected,
  onClick,
  label,
  desc
}: {
  selected: boolean
  onClick: () => void
  label: string
  desc?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-start rounded-xl border px-4 py-3 text-left transition-all',
        selected
          ? 'border-[#6f8159] bg-[#6f8159]/10 text-[#3e4a32]'
          : 'border-[#ded2bd]/70 bg-white/50 text-[#5a5a4a] hover:border-[#b5c9a0] hover:bg-[#f5f2ec]'
      )}
    >
      <span className="text-sm font-medium">{label}</span>
      {desc && <span className="mt-0.5 text-xs text-[#9a8f80]">{desc}</span>}
    </button>
  )
}

export function SpeechScriptDialog({
  open,
  onOpenChange,
  sessionId,
  isGenerating,
  speechProgress,
  speechConfig,
  onConfigChange,
  onGenerate,
  sessionTitle
}: SpeechScriptDialogProps): React.JSX.Element {
  const t = useT()
  const [script, setScript] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [phase, setPhase] = useState<'config' | 'result'>('config')

  // Load script from file when dialog opens
  useEffect(() => {
    if (!open) return
    void ipc.getSpeechScript(sessionId).then((result) => {
      if (result.script) {
        setScript(result.script)
        setPhase('result')
      } else {
        setScript(null)
        setPhase('config')
      }
    })
  }, [open, sessionId])

  // When generation finishes, reload script from file
  useEffect(() => {
    if (!isGenerating && open) {
      void ipc.getSpeechScript(sessionId).then((result) => {
        if (result.script) {
          setScript(result.script)
          setPhase('result')
        }
      })
    }
  }, [isGenerating, open, sessionId])

  const handleCopy = async (): Promise<void> => {
    if (!script) return
    await navigator.clipboard.writeText(script)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleDownload = (): void => {
    if (!script) return
    const suffix = t('sessionDetail.speechScriptDownloadSuffix')
    const fileName = sessionTitle ? `${sessionTitle}${suffix}.md` : 'speech-script.md'
    const blob = new Blob([script], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleGenerate = (): void => {
    onGenerate(speechConfig)
  }

  const handleRegenerate = (): void => {
    setScript(null)
    setPhase('config')
  }

  const showConfig = phase === 'config' && !isGenerating
  const showLoading = isGenerating
  const showResult = phase === 'result' && !isGenerating && script !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-full max-w-xl flex-col gap-0 overflow-hidden rounded-2xl border border-[#ded2bd]/60 bg-[#faf7f2] p-0 shadow-xl">
        <DialogHeader className="flex-shrink-0 border-b border-[#ded2bd]/50 px-6 py-4">
          <DialogTitle className="text-base font-semibold text-[#3e4a32]">
            {t('sessionDetail.speechScriptDialogTitle')}
          </DialogTitle>
        </DialogHeader>

        {/* Config phase */}
        {showConfig && (
          <div className="flex flex-col gap-5 overflow-y-auto px-6 py-5">
            <div>
              <p className="mb-3 text-sm font-medium text-[#3e4a32]">
                {t('sessionDetail.speechScriptLength')}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(['short', 'medium', 'long'] as SpeechLength[]).map((l) => (
                  <OptionButton
                    key={l}
                    selected={speechConfig.length === l}
                    onClick={() => onConfigChange({ ...speechConfig, length: l })}
                    label={t(`sessionDetail.speechScriptLength${l.charAt(0).toUpperCase() + l.slice(1)}` as Parameters<typeof t>[0])}
                    desc={t(`sessionDetail.speechScriptLength${l.charAt(0).toUpperCase() + l.slice(1)}Desc` as Parameters<typeof t>[0])}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="mb-3 text-sm font-medium text-[#3e4a32]">
                {t('sessionDetail.speechScriptStyle')}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(['formal', 'conversational', 'storytelling'] as SpeechStyle[]).map((s) => (
                  <OptionButton
                    key={s}
                    selected={speechConfig.style === s}
                    onClick={() => onConfigChange({ ...speechConfig, style: s })}
                    label={t(`sessionDetail.speechScriptStyle${s.charAt(0).toUpperCase() + s.slice(1)}` as Parameters<typeof t>[0])}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Loading phase */}
        {showLoading && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16">
            <Loader2 className="h-7 w-7 animate-spin text-[#6f8159]" />
            <p className="text-sm text-[#6b7c5a]">
              {speechProgress
                ? t('sessionDetail.speechScriptGenerating', {
                    current: speechProgress.current,
                    total: speechProgress.total
                  })
                : t('sessionDetail.speechScriptGeneratingInit')}
            </p>
          </div>
        )}

        {/* Result phase */}
        {showResult && (
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[#3e4a32]">
              {script}
            </pre>
          </div>
        )}

        {/* Footer */}
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-t border-[#ded2bd]/50 px-6 py-4">
          {showResult ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-[#7a8a6a] hover:text-[#3e4a32]"
                onClick={handleRegenerate}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('sessionDetail.speechScriptRegenerate')}
              </Button>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 border-[#ded2bd] bg-white/70 text-[#3e4a32] hover:bg-[#f0ebe0]"
                  onClick={handleDownload}
                >
                  <Download className="h-3.5 w-3.5" />
                  {t('sessionDetail.speechScriptDownload')}
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 bg-[#6f8159] text-white hover:bg-[#5e6e4a]"
                  onClick={handleCopy}
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? t('sessionDetail.speechScriptCopied') : t('sessionDetail.speechScriptCopy')}
                </Button>
              </div>
            </>
          ) : (
            <div className="ml-auto">
              <Button
                size="sm"
                className="bg-[#6f8159] text-white hover:bg-[#5e6e4a] disabled:opacity-50"
                onClick={handleGenerate}
                disabled={isGenerating}
              >
                {t('sessionDetail.speechScriptGenerate')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
