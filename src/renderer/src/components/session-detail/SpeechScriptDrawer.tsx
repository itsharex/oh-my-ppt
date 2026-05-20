import { useEffect, useState } from 'react'
import { Check, Copy, Download, Loader2, X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Button } from '../ui/Button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../ui/Select'
import { useT } from '@renderer/i18n'
import { ipc } from '@renderer/lib/ipc'

type SpeechScope = 'all' | 'single'
type SpeechLength = 'short' | 'medium' | 'long'
type SpeechStyle = 'formal' | 'conversational' | 'storytelling' | 'custom'

export interface SpeechConfig {
  scope: SpeechScope
  length: SpeechLength
  style: SpeechStyle
  customStyle?: string
}

interface SpeechScriptDrawerProps {
  sessionId: string
  isGenerating: boolean
  speechProgress: { current: number; total: number } | null
  speechConfig: SpeechConfig
  onConfigChange: (config: SpeechConfig) => void
  onGenerate: (config: SpeechConfig) => void
  onClose: () => void
  sessionTitle?: string
  currentPageTitle?: string
}

export function SpeechScriptDrawer({
  sessionId,
  isGenerating,
  speechProgress,
  speechConfig,
  onConfigChange,
  onGenerate,
  onClose,
  sessionTitle,
  currentPageTitle
}: SpeechScriptDrawerProps): React.JSX.Element {
  const t = useT()
  const [tab, setTab] = useState<'config' | 'result'>('config')
  const [script, setScript] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void ipc.getSpeechScript(sessionId).then((result) => {
      if (result.script) {
        setScript(result.script)
        setTab('result')
      } else {
        setScript(null)
        setTab('config')
      }
    })
  }, [sessionId])

  useEffect(() => {
    if (!isGenerating) {
      void ipc.getSpeechScript(sessionId).then((result) => {
        if (result.script) {
          setScript(result.script)
          setTab('result')
        }
      })
    }
  }, [isGenerating, sessionId])

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

  return (
    <aside className="mr-3 my-3 flex min-h-0 w-[300px] shrink-0 flex-col overflow-hidden rounded-[2rem] border border-[#ded2bd]/60 bg-[#f3ecdf]/76 shadow-[0_20px_44px_rgba(74,59,42,0.13)] backdrop-blur-xl">
      {/* Header card */}
      <div className="relative mx-2.5 mt-2.5 overflow-hidden rounded-[1.35rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 px-3 pb-0 pt-3 shadow-[0_6px_16px_rgba(77,61,43,0.08)]">
        <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-[30%_70%_70%_30%/30%_30%_70%_70%] bg-[#c7d9b4]/12" />
        <div className="relative flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-[0.04em] text-[#34402c]">
            {t('sessionDetail.speechScriptDialogTitle')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-[#9a8f80] transition-colors hover:bg-[#ebe4d6]/80 hover:text-[#3e4a32]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-2.5 flex gap-1">
          {(['config', 'result'] as const).map((t_) => (
            <button
              key={t_}
              type="button"
              onClick={() => { if (t_ === 'result' && !script) return; setTab(t_) }}
              className={cn(
                'flex-1 rounded-t-[0.6rem] py-1.5 text-xs font-medium transition-colors',
                tab === t_
                  ? 'bg-[#f3ecdf] text-[#3e4a32]'
                  : script || t_ === 'config'
                    ? 'text-[#9a8f80] hover:text-[#5a6b4a]'
                    : 'cursor-not-allowed text-[#c8bfb0]'
              )}
            >
              {t_ === 'config'
                ? t('sessionDetail.speechScriptTabConfig')
                : t('sessionDetail.speechScriptTabResult')}
            </button>
          ))}
        </div>
      </div>

      {/* Config tab */}
      {tab === 'config' && (
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3">
          {/* Scope */}
          <div className="overflow-hidden rounded-[1.15rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 shadow-[0_4px_12px_rgba(77,61,43,0.06)]">
            <p className="border-b border-[#ede5d6]/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7a875f]">
              {t('sessionDetail.speechScriptScope')}
            </p>
            <div className="flex">
              {(['all', 'single'] as SpeechScope[]).map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => onConfigChange({ ...speechConfig, scope: s })}
                  className={cn(
                    'flex flex-1 flex-col items-center py-2.5 text-sm transition-colors',
                    i === 0 ? '' : 'border-l border-[#ede5d6]/80',
                    speechConfig.scope === s
                      ? 'bg-[#dbe7ca]/60 text-[#2f3b28]'
                      : 'text-[#7a6b56] hover:bg-[#f0e8d8]/60'
                  )}
                >
                  <span className="text-[13px] font-medium">
                    {s === 'all'
                      ? t('sessionDetail.speechScriptScopeAll')
                      : t('sessionDetail.speechScriptScopeSingle')}
                  </span>
                  <span className="mt-0.5 max-w-[110px] truncate px-1 text-[11px] text-[#9a8f80]">
                    {s === 'all'
                      ? t('sessionDetail.speechScriptScopeAllDesc')
                      : (currentPageTitle || t('sessionDetail.speechScriptScopeSingleDesc'))}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Style */}
          <div className="overflow-hidden rounded-[1.15rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 shadow-[0_4px_12px_rgba(77,61,43,0.06)]">
            <p className="border-b border-[#ede5d6]/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7a875f]">
              {t('sessionDetail.speechScriptStyle')}
            </p>
            <div className="px-3 py-2.5">
              <Select
                value={speechConfig.style}
                onValueChange={(v) => onConfigChange({ ...speechConfig, style: v as SpeechStyle })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="conversational">
                    {t('sessionDetail.speechScriptStyleConversational')}
                  </SelectItem>
                  <SelectItem value="formal">
                    {t('sessionDetail.speechScriptStyleFormal')}
                  </SelectItem>
                  <SelectItem value="storytelling">
                    {t('sessionDetail.speechScriptStyleStorytelling')}
                  </SelectItem>
                  <SelectItem value="custom">
                    {t('sessionDetail.speechScriptStyleCustom')}
                  </SelectItem>
                </SelectContent>
              </Select>
              {speechConfig.style === 'custom' && (
                <textarea
                  className="mt-2 w-full resize-none rounded-lg border border-[#d8ccb5]/80 bg-[#fffdf8]/88 px-3 py-2 text-xs text-[#3f4b35] placeholder:text-[#b0a898] shadow-[inset_0_1px_2px_rgba(74,59,42,0.05)] focus:border-[#9bb98a] focus:outline-none"
                  rows={3}
                  placeholder={t('sessionDetail.speechScriptStyleCustomPlaceholder')}
                  value={speechConfig.customStyle ?? ''}
                  onChange={(e) => onConfigChange({ ...speechConfig, customStyle: e.target.value })}
                />
              )}
            </div>
          </div>

          {/* Length */}
          <div className="overflow-hidden rounded-[1.15rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 shadow-[0_4px_12px_rgba(77,61,43,0.06)]">
            <p className="border-b border-[#ede5d6]/80 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#7a875f]">
              {t('sessionDetail.speechScriptLength')}
            </p>
            <div className="px-3 py-2.5">
              <Select
                value={speechConfig.length}
                onValueChange={(v) => onConfigChange({ ...speechConfig, length: v as SpeechLength })}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="short">{t('sessionDetail.speechScriptLengthShort')}</SelectItem>
                  <SelectItem value="medium">{t('sessionDetail.speechScriptLengthMedium')}</SelectItem>
                  <SelectItem value="long">{t('sessionDetail.speechScriptLengthLong')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Generate */}
          <Button
            className="w-full gap-2"
            onClick={() => onGenerate(speechConfig)}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {speechProgress
                  ? t('sessionDetail.speechScriptGenerating', {
                      current: speechProgress.current,
                      total: speechProgress.total
                    })
                  : t('sessionDetail.speechScriptGeneratingInit')}
              </>
            ) : (
              t('sessionDetail.speechScriptGenerate')
            )}
          </Button>
        </div>
      )}

      {/* Result tab */}
      {tab === 'result' && (
        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {isGenerating ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 px-4">
                <Loader2 className="h-6 w-6 animate-spin text-[#6f8159]" />
                <p className="text-center text-sm text-[#7a6b56]">
                  {speechProgress
                    ? t('sessionDetail.speechScriptGenerating', {
                        current: speechProgress.current,
                        total: speechProgress.total
                      })
                    : t('sessionDetail.speechScriptGeneratingInit')}
                </p>
              </div>
            ) : (
              <div className="mx-2.5 my-2.5 overflow-hidden rounded-[1.15rem] border border-[#e1d6c4]/72 bg-[#fffaf1]/78 px-3 py-3 shadow-[0_4px_12px_rgba(77,61,43,0.06)]">
                <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[#3f4b35]">
                  {script}
                </pre>
              </div>
            )}
          </div>

          {/* Footer actions */}
          {!isGenerating && script && (
            <div className="flex shrink-0 gap-2 px-3 pb-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-xs"
                onClick={() => void handleCopy()}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied
                  ? t('sessionDetail.speechScriptCopied')
                  : t('sessionDetail.speechScriptCopy')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 gap-1.5 text-xs"
                onClick={handleDownload}
              >
                <Download className="h-3.5 w-3.5" />
                {t('sessionDetail.speechScriptDownload')}
              </Button>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
