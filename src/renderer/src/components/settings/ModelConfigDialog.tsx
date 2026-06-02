import { ShieldCheck, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/Select'
import type { ModelForm, SettingsTranslate } from './types'

interface ModelConfigDialogProps {
  form: ModelForm
  open: boolean
  saving: boolean
  verifying: boolean
  t: SettingsTranslate
  onClose: () => void
  onFormChange: (patch: Partial<ModelForm>) => void
  onSave: () => void
  onVerify: () => void
}

export function ModelConfigDialog({
  form,
  open,
  saving,
  verifying,
  t,
  onClose,
  onFormChange,
  onSave,
  onVerify
}: ModelConfigDialogProps): React.JSX.Element | null {
  if (!open) return null
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
            {form.id ? t('settings.editModel') : t('settings.addModel')}
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
                placeholder={t('settings.modelNamePlaceholder')}
                className="h-8"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t('settings.providerPreset')}
              </label>
              <Select
                value={form.provider}
                onValueChange={(value) =>
                  onFormChange({
                    provider: value === 'anthropic' || value === 'google' ? value : 'openai'
                  })
                }
              >
                <SelectTrigger className="h-8">
                  <SelectValue placeholder={t('settings.providerPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="anthropic">Claude (Anthropic)</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="google">Google Gemini</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">model</label>
            <Input
              placeholder={t('settings.modelPlaceholder')}
              value={form.model}
              onChange={(e) => onFormChange({ model: e.target.value })}
              className="h-8"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('settings.modelHint')}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">base_url</label>
            <Input
              placeholder={t('settings.baseUrlPlaceholder')}
              value={form.baseUrl}
              onChange={(e) => onFormChange({ baseUrl: e.target.value })}
              className="h-8"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {form.provider === 'google'
                ? t('settings.baseUrlHintGoogle')
                : t('settings.baseUrlHint')}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">max_tokens</label>
            <Input
              type="number"
              min={256}
              max={16384}
              step={256}
              value={form.maxTokens}
              onChange={(e) =>
                onFormChange({
                  maxTokens: Math.max(256, Math.min(16384, Number(e.target.value) || 4096))
                })
              }
              className="h-8"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t('settings.maxTokensHint')}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">api_key</label>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={t('settings.apiKeyPlaceholder', {
                  provider:
                    form.provider === 'openai'
                      ? 'OpenAI'
                      : form.provider === 'google'
                        ? 'Google'
                        : 'Claude'
                })}
                value={form.apiKey}
                onChange={(e) => onFormChange({ apiKey: e.target.value })}
                className="h-8 min-w-0 flex-1"
              />
              <Button
                variant="secondary"
                onClick={onVerify}
                disabled={verifying}
                className="h-8 min-w-[80px] shrink-0 rounded-lg border border-[#7ea06f]/45 px-3 text-xs"
              >
                <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                {verifying ? t('settings.verifying') : t('settings.verify')}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('settings.verifyHint')}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-[#e3d8c5] px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? t('common.saving') : t('settings.saveModel')}
          </Button>
        </div>
      </div>
    </div>
  )
}
