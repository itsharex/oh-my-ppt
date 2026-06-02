import { ShieldCheck, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input, Textarea } from '../ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import { IMAGE_PROVIDER_OPTIONS } from './model-settings-utils'
import type { ImageModelForm, SettingsTranslate } from './types'

interface ImageModelConfigDialogProps {
  form: ImageModelForm
  open: boolean
  saving: boolean
  verifying: boolean
  t: SettingsTranslate
  onClose: () => void
  onFormChange: (patch: Partial<ImageModelForm>) => void
  onProviderChange: (value: string) => void
  onSave: () => void
  onVerify: () => void
}

const PROVIDER_DOCS: Record<ImageModelForm['provider'], { label: string; url: string }> = {
  jimeng: {
    label: '即梦3.0',
    url: 'https://www.volcengine.com/docs/85621/1616429?lang=zh'
  },
  jimeng4: {
    label: '即梦4.0',
    url: 'https://www.volcengine.com/docs/85621/1817045?lang=zh'
  },
  agnes: {
    label: 'Agnes AI',
    url: 'https://agnes-ai.com/'
  },
  siliconflow: {
    label: '硅基流动',
    url: 'https://www.siliconflow.cn/'
  }
}

export function ImageModelConfigDialog({
  form,
  open,
  saving,
  verifying,
  t,
  onClose,
  onFormChange,
  onProviderChange,
  onSave,
  onVerify
}: ImageModelConfigDialogProps): React.JSX.Element | null {
  if (!open) return null
  const providerDocs = PROVIDER_DOCS[form.provider]
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d291f]/42 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose()
      }}
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d8ccb5]/85 bg-[#fffaf1] shadow-[0_24px_70px_rgba(53,44,32,0.28)]">
        <div className="flex items-center justify-between border-b border-[#e3d8c5] px-5 py-4">
          <h2 className="text-base font-semibold text-[#33402a]">
            {form.id ? t('settings.editImageModel') : t('settings.addImageModel')}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-3 p-5">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('settings.modelName')}</label>
              <Input
                value={form.name}
                onChange={(e) => onFormChange({ name: e.target.value })}
                placeholder={t('settings.imageModelNamePlaceholder')}
                className="h-8"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('settings.providerPreset')}
              </label>
              <Select value={form.provider} onValueChange={onProviderChange}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={t('settings.providerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {IMAGE_PROVIDER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">model_config</label>
            <Textarea
              spellCheck={false}
              rows={12}
              value={form.modelConfig}
              onChange={(e) => onFormChange({ modelConfig: e.target.value })}
              className="min-h-[240px] resize-y font-mono text-xs leading-5"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                {
                  jimeng: 'settings.imageModelConfigHintJimeng',
                  jimeng4: 'settings.imageModelConfigHintJimeng4',
                  agnes: 'settings.imageModelConfigHintAgnes',
                  siliconflow: 'settings.imageModelConfigHintSiliconflow'
                }[form.provider] as Parameters<typeof t>[0]
              )}
            </p>
            <div className="mt-2 rounded-lg border border-[#ded2bd]/70 bg-[#f8f1e6]/72 px-3 py-2 text-xs text-[#6d604d]">
              <span className="mr-1.5">{t('settings.imageProviderOfficialDocs')}:</span>
              <a
                href={providerDocs.url}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[#5d6b4d] underline decoration-[#9cb58d]/55 underline-offset-4 hover:text-[#3e4a32]"
              >
                {providerDocs.label}
              </a>
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              onClick={onVerify}
              disabled={verifying}
              className="h-8 min-w-[80px] rounded-lg border border-[#7ea06f]/45 px-3 text-xs"
            >
              <ShieldCheck className="mr-1 h-3.5 w-3.5" />
              {verifying ? t('settings.verifying') : t('settings.verify')}
            </Button>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#e3d8c5] px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? t('common.saving') : t('settings.saveImageModel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
