import { useEffect, useMemo, useState } from 'react'
import { Button } from '../components/ui/Button'
import { Input, Textarea } from '../components/ui/Input'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../components/ui/Select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/Tabs'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/Popover'
import { useSettingsStore } from '../store'
import { useToastStore } from '../store'
import {
  CheckCircle2,
  CircleHelp,
  FolderSearch,
  Image as ImageIcon,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import { useLang } from '../i18n'
import type { ImageModelConfig, ImageModelProvider, ModelConfig } from '../lib/ipc'
import {
  CONFIGURABLE_MODEL_TIMEOUT_PROFILES,
  type ConfigurableModelTimeoutProfile,
  modelTimeoutMsToSeconds,
  resolveModelTimeoutMs
} from '@shared/model-timeout.js'

type ProviderId = 'anthropic' | 'openai' | 'google'

interface ModelForm {
  id?: string
  name: string
  provider: ProviderId
  model: string
  apiKey: string
  baseUrl: string
  maxTokens: number
  active: boolean
}

interface ImageModelForm {
  id?: string
  name: string
  provider: ImageModelProvider
  modelConfig: string
  active: boolean
}

const createTimeoutSeconds = (
  timeouts?: Partial<Record<ConfigurableModelTimeoutProfile, number>>
): Record<ConfigurableModelTimeoutProfile, number> =>
  Object.fromEntries(
    CONFIGURABLE_MODEL_TIMEOUT_PROFILES.map((profile) => [
      profile,
      modelTimeoutMsToSeconds(timeouts?.[profile], profile)
    ])
  ) as Record<ConfigurableModelTimeoutProfile, number>

const MODEL_PROVIDER_LINKS = [
  { label: 'DeepSeek', url: 'https://platform.deepseek.com' },
  { label: 'Moonshot (Kimi)', url: 'https://platform.moonshot.cn' },
  { label: 'GLM (智谱)', url: 'https://open.bigmodel.cn' },
  { label: 'Qwen (通义千问)', url: 'https://bailian.console.aliyun.com/' },
  { label: 'Doubao (豆包)', url: 'https://console.volcengine.com/ark' },
  { label: 'Mimo (小米)', url: 'https://platform.xiaomimimo.com' },
  { label: 'MiniMax', url: 'https://www.minimaxi.com/' },
  { label: 'OpenAI', url: 'https://platform.openai.com' },
  { label: 'Claude (Anthropic)', url: 'https://console.anthropic.com' },
  { label: 'Google Gemini', url: 'https://ai.google.dev' }
]

const IMAGE_PROVIDER_OPTIONS: Array<{ value: ImageModelProvider; label: string }> = [
  { value: 'jimeng', label: '即梦3.0' },
  { value: 'jimeng4', label: '即梦4.0' },
  { value: 'agnes', label: 'Agnes AI' }
]

const JIMENG_DEFAULT_REQ_KEY = 'jimeng_t2i_v30'
const JIMENG_V4_DEFAULT_REQ_KEY = 'jimeng_t2i_v40'

const readJsonObject = (value: string): Record<string, unknown> | null => {
  const text = value.trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

const stringifyJsonObject = (record: Record<string, unknown>): string => {
  return JSON.stringify(record, null, 2)
}

const summarizeImageModelConfig = (value: string): string => {
  const config = readJsonObject(value)
  if (!config) return 'model_config'
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  const reqKey = typeof config.reqKey === 'string' ? config.reqKey.trim() : ''
  const endpoint =
    typeof config.endpoint === 'string'
      ? config.endpoint.trim()
      : typeof config.baseUrl === 'string'
        ? config.baseUrl.trim()
        : ''
  return [model || reqKey || 'model_config', endpoint].filter(Boolean).join(' · ')
}

const createDefaultImageModelConfig = (provider: ImageModelProvider): string => {
  if (provider === 'jimeng') {
    return stringifyJsonObject({
      reqKey: JIMENG_DEFAULT_REQ_KEY,
      accessKeyId: '',
      secretKey: ''
    })
  }
  if (provider === 'jimeng4') {
    return stringifyJsonObject({
      reqKey: JIMENG_V4_DEFAULT_REQ_KEY,
      accessKeyId: '',
      secretKey: '',
      force_single: true
    })
  }
  return stringifyJsonObject({
    model: 'agnes-image-2.0-flash',
    apiKey: '',
    responseFormat: 'url'
  })
}

const createEmptyModelForm = (active = false): ModelForm => ({
  name: '',
  provider: 'openai',
  model: '',
  apiKey: '',
  baseUrl: '',
  maxTokens: 4096,
  active
})

const createModelForm = (config: ModelConfig): ModelForm => ({
  id: config.id,
  name: config.name,
  provider: config.provider,
  model: config.model,
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  maxTokens: config.maxTokens || 4096,
  active: config.active
})

const createEmptyImageModelForm = (active = false): ImageModelForm => ({
  name: '',
  provider: 'jimeng',
  modelConfig: createDefaultImageModelConfig('jimeng'),
  active
})

const createImageModelForm = (config: ImageModelConfig): ImageModelForm => {
  return {
    id: config.id,
    name: config.name,
    provider: config.provider,
    modelConfig: config.modelConfig || createDefaultImageModelConfig(config.provider),
    active: config.active
  }
}

export function SettingsPage(): React.JSX.Element {
  const {
    modelConfigs,
    imageModelConfigs,
    fetchSettings,
    saveSettings,
    upsertModelConfig,
    upsertImageModelConfig,
    setActiveModelConfig,
    setActiveImageModelConfig,
    deleteModelConfig,
    deleteImageModelConfig,
    setVerificationMessage,
    verifyApiKey,
    verifyImageModel,
    chooseStoragePath
  } = useSettingsStore()
  const { success, error, warning, info } = useToastStore()
  const { lang, setLang, t } = useLang()
  const [storagePath, setStoragePath] = useState(
    () => useSettingsStore.getState().settings?.storagePath || ''
  )
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [modelForm, setModelForm] = useState<ModelForm>(() => createEmptyModelForm())
  const [imageModelDialogOpen, setImageModelDialogOpen] = useState(false)
  const [imageModelForm, setImageModelForm] = useState<ImageModelForm>(() =>
    createEmptyImageModelForm()
  )
  const [timeoutSeconds, setTimeoutSeconds] = useState<
    Record<ConfigurableModelTimeoutProfile, number>
  >(() => createTimeoutSeconds(useSettingsStore.getState().settings?.timeouts))
  const [savingModel, setSavingModel] = useState(false)
  const [savingTimeouts, setSavingTimeouts] = useState(false)
  const [proxyUrl, setProxyUrl] = useState(
    () => useSettingsStore.getState().settings?.proxyUrl || ''
  )
  const [verifying, setVerifying] = useState(false)
  const [verifyingImageModel, setVerifyingImageModel] = useState(false)
  const [activatingId, setActivatingId] = useState<string | null>(null)
  const [activatingImageId, setActivatingImageId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const loadSettings = async (): Promise<void> => {
      await fetchSettings()
      if (!active) return
      const nextSettings = useSettingsStore.getState().settings
      setStoragePath(nextSettings?.storagePath || '')
      setTimeoutSeconds(createTimeoutSeconds(nextSettings?.timeouts))
      setProxyUrl(nextSettings?.proxyUrl || '')
    }
    void loadSettings()
    return () => {
      active = false
    }
  }, [fetchSettings])

  useEffect(() => {
    if (!modelDialogOpen) return
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !savingModel) {
        setModelDialogOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [modelDialogOpen, savingModel])

  const activeModelConfig = modelConfigs.find((config) => config.active)
  const activeImageModelConfig = imageModelConfigs.find((config) => config.active)
  const timeoutFields: Array<{
    profile: ConfigurableModelTimeoutProfile
    label: string
    hint: string
    min: number
  }> = useMemo(
    () => [
      {
        profile: 'planning',
        label: t('settings.timeoutPlanning'),
        hint: t('settings.timeoutPlanningHint'),
        min: 120
      },
      {
        profile: 'design',
        label: t('settings.timeoutDesign'),
        hint: t('settings.timeoutDesignHint'),
        min: 120
      },
      {
        profile: 'agent',
        label: t('settings.timeoutAgent'),
        hint: t('settings.timeoutAgentHint'),
        min: 300
      },
      {
        profile: 'document',
        label: t('settings.timeoutDocument'),
        hint: t('settings.timeoutDocumentHint'),
        min: 300
      }
    ],
    [t]
  )

  const openCreateModelDialog = (): void => {
    setModelForm(createEmptyModelForm(modelConfigs.length === 0))
    setVerificationMessage(null)
    setModelDialogOpen(true)
  }

  const openEditModelDialog = (config: ModelConfig): void => {
    setModelForm(createModelForm(config))
    setVerificationMessage(null)
    setModelDialogOpen(true)
  }

  const updateModelForm = (patch: Partial<ModelForm>): void => {
    setModelForm((form) => ({ ...form, ...patch }))
    setVerificationMessage(null)
  }

  const openCreateImageModelDialog = (): void => {
    setImageModelForm(createEmptyImageModelForm(imageModelConfigs.length === 0))
    setVerificationMessage(null)
    setImageModelDialogOpen(true)
  }

  const openEditImageModelDialog = (config: ImageModelConfig): void => {
    setImageModelForm(createImageModelForm(config))
    setVerificationMessage(null)
    setImageModelDialogOpen(true)
  }

  const updateImageModelForm = (patch: Partial<ImageModelForm>): void => {
    setImageModelForm((form) => ({ ...form, ...patch }))
    setVerificationMessage(null)
  }

  const handleImageProviderChange = (value: string): void => {
    if (!IMAGE_PROVIDER_OPTIONS.some((item) => item.value === value)) return
    const provider = value as ImageModelProvider
    setImageModelForm((form) => ({
      ...form,
      provider,
      modelConfig:
        provider !== form.provider ? createDefaultImageModelConfig(provider) : form.modelConfig
    }))
    setVerificationMessage(null)
  }

  const normalizeImageModelConfigForSave = (): string | null => {
    const modelConfig = readJsonObject(imageModelForm.modelConfig)
    return modelConfig ? stringifyJsonObject(modelConfig) : null
  }

  const handleSaveModel = async (): Promise<void> => {
    if (!modelForm.name.trim()) {
      warning(t('settings.fillModelName'))
      return
    }
    if (!modelForm.model.trim()) {
      warning(t('settings.fillModel'))
      return
    }
    if (!modelForm.apiKey.trim()) {
      warning(t('settings.fillApiKey'))
      return
    }

    setSavingModel(true)
    setVerificationMessage(null)
    try {
      const id = await upsertModelConfig({
        id: modelForm.id,
        name: modelForm.name.trim(),
        provider: modelForm.provider,
        model: modelForm.model.trim(),
        apiKey: modelForm.apiKey.trim(),
        baseUrl: modelForm.baseUrl.trim(),
        maxTokens: modelForm.maxTokens,
        active: modelForm.active
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (!id || saveError) {
        error(t('settings.saveFailed'), { description: saveError || t('common.retryLater') })
        return
      }
      setModelDialogOpen(false)
      success(t('settings.modelSaved'), { description: t('settings.modelSavedDescription') })
    } finally {
      setSavingModel(false)
    }
  }

  const handleSaveImageModel = async (): Promise<void> => {
    if (!imageModelForm.name.trim()) {
      warning(t('settings.fillModelName'))
      return
    }
    const modelConfig = normalizeImageModelConfigForSave()
    if (!modelConfig) {
      warning(t('settings.fillImageModelConfig'))
      return
    }

    setSavingModel(true)
    setVerificationMessage(null)
    try {
      const id = await upsertImageModelConfig({
        id: imageModelForm.id,
        name: imageModelForm.name.trim(),
        provider: imageModelForm.provider,
        active: imageModelForm.active,
        modelConfig
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (!id || saveError) {
        error(t('settings.saveFailed'), { description: saveError || t('common.retryLater') })
        return
      }
      setImageModelDialogOpen(false)
      success(t('settings.imageModelSaved'), {
        description: t('settings.imageModelSavedDescription')
      })
    } finally {
      setSavingModel(false)
    }
  }

  const handleTimeoutChange = (profile: ConfigurableModelTimeoutProfile, value: string): void => {
    const num = Number(value)
    if (Number.isFinite(num) && num >= 0) {
      setTimeoutSeconds((current) => ({
        ...current,
        [profile]: num
      }))
    }
    setVerificationMessage(null)
  }

  const handleSaveAdvanced = async (): Promise<void> => {
    setSavingTimeouts(true)
    setVerificationMessage(null)
    try {
      await saveSettings({
        timeouts: Object.fromEntries(
          CONFIGURABLE_MODEL_TIMEOUT_PROFILES.map((profile) => [
            profile,
            timeoutSeconds[profile] * 1000
          ])
        ) as Record<ConfigurableModelTimeoutProfile, number>,
        proxyUrl: proxyUrl.trim()
      })
      const saveError = useSettingsStore.getState().verificationMessage
      if (saveError) {
        error(t('settings.saveFailed'), { description: saveError })
        return
      }
      success(t('settings.saved'), {
        description: t('settings.savedDescription')
      })
    } finally {
      setSavingTimeouts(false)
    }
  }

  const handleVerify = async (): Promise<void> => {
    if (!modelForm.apiKey.trim()) {
      warning(t('settings.fillApiKey'))
      return
    }
    if (!modelForm.model.trim()) {
      warning(t('settings.fillModel'))
      return
    }

    setVerifying(true)
    setVerificationMessage(null)
    try {
      const valid = await verifyApiKey(
        modelForm.provider,
        modelForm.apiKey,
        modelForm.model,
        modelForm.baseUrl,
        modelForm.maxTokens,
        resolveModelTimeoutMs(undefined, 'verify')
      )
      const verifyMessage = useSettingsStore.getState().verificationMessage
      if (valid) {
        success(t('settings.verifyPassed'), {
          description: verifyMessage || t('settings.verifyPassedDescription')
        })
      } else {
        error(t('settings.verifyFailed'), {
          description: verifyMessage || t('settings.verifyFailedDescription')
        })
      }
    } finally {
      setVerifying(false)
    }
  }

  const handleVerifyImageModel = async (): Promise<void> => {
    const modelConfig = normalizeImageModelConfigForSave()
    if (!modelConfig) {
      warning(t('settings.fillImageModelConfig'))
      return
    }

    setVerifyingImageModel(true)
    setVerificationMessage(null)
    try {
      const valid = await verifyImageModel(
        imageModelForm.provider,
        modelConfig
      )
      const verifyMessage = useSettingsStore.getState().verificationMessage
      if (valid) {
        success(t('settings.verifyPassed'), {
          description: verifyMessage || t('settings.verifyPassedDescription')
        })
      } else {
        error(t('settings.verifyFailed'), {
          description: verifyMessage || t('settings.verifyFailedDescription')
        })
      }
    } finally {
      setVerifyingImageModel(false)
    }
  }

  const handleActivateModel = async (id: string): Promise<void> => {
    setActivatingId(id)
    setVerificationMessage(null)
    try {
      await setActiveModelConfig(id)
      const activateError = useSettingsStore.getState().verificationMessage
      if (activateError) {
        error(t('settings.activateModelFailed'), { description: activateError })
        return
      }
      success(t('settings.activeModelUpdated'))
    } finally {
      setActivatingId(null)
    }
  }

  const handleDeleteModel = async (config: ModelConfig): Promise<void> => {
    if (!window.confirm(t('settings.deleteModelConfirm', { name: config.name }))) return
    setDeletingId(config.id)
    setVerificationMessage(null)
    try {
      await deleteModelConfig(config.id)
      const deleteError = useSettingsStore.getState().verificationMessage
      if (deleteError) {
        error(t('settings.deleteModelFailed'), { description: deleteError })
        return
      }
      info(t('settings.modelDeleted'))
    } finally {
      setDeletingId(null)
    }
  }

  const handleActivateImageModel = async (id: string): Promise<void> => {
    setActivatingImageId(id)
    setVerificationMessage(null)
    try {
      await setActiveImageModelConfig(id)
      const activateError = useSettingsStore.getState().verificationMessage
      if (activateError) {
        error(t('settings.activateImageModelFailed'), { description: activateError })
        return
      }
      success(t('settings.activeImageModelUpdated'))
    } finally {
      setActivatingImageId(null)
    }
  }

  const handleDeleteImageModel = async (config: ImageModelConfig): Promise<void> => {
    if (!window.confirm(t('settings.deleteModelConfirm', { name: config.name }))) return
    setDeletingImageId(config.id)
    setVerificationMessage(null)
    try {
      await deleteImageModelConfig(config.id)
      const deleteError = useSettingsStore.getState().verificationMessage
      if (deleteError) {
        error(t('settings.deleteImageModelFailed'), { description: deleteError })
        return
      }
      info(t('settings.imageModelDeleted'))
    } finally {
      setDeletingImageId(null)
    }
  }

  const handleChoosePath = async (): Promise<void> => {
    const path = await chooseStoragePath()
    const pathError = useSettingsStore.getState().storagePathError
    if (pathError) {
      error(t('settings.choosePathFailed'), { description: pathError })
      return
    }
    if (path) {
      setVerificationMessage(null)
      await saveSettings({ storagePath: path })
      const saveError = useSettingsStore.getState().verificationMessage
      if (saveError) {
        error(t('settings.saveFailed'), { description: saveError })
        return
      }
      setStoragePath(path)
      info(t('settings.storagePathUpdated'), { description: path })
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-5">
        <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">
          {t('settings.eyebrow')}
        </p>
        <h1 className="organic-serif mt-2 text-[32px] font-semibold leading-none text-[#3e4a32]">
          {t('settings.title')}
        </h1>
      </div>

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">{t('settings.generalTab')}</TabsTrigger>
          <TabsTrigger value="model">{t('settings.modelTab')}</TabsTrigger>
          <TabsTrigger value="imageModel">{t('settings.imageModelTab')}</TabsTrigger>
          <TabsTrigger value="advanced">{t('settings.advancedTab')}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.interface')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div>
                <label className="mb-1.5 block text-sm font-medium">{t('settings.language')}</label>
                <Select value={lang} onValueChange={(v) => setLang(v === 'en' ? 'en' : 'zh')}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder={t('settings.languagePlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="zh">{t('settings.chinese')}</SelectItem>
                    <SelectItem value="en">{t('settings.english')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.storage')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {t('settings.storagePath')}
                </label>
                <div className="flex gap-2">
                  <Input
                    value={storagePath}
                    readOnly
                    placeholder={t('settings.storagePlaceholder')}
                    className="h-10 min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    onClick={handleChoosePath}
                    className="h-10 min-w-[96px] shrink-0 rounded-lg border border-[#7ea06f]/45 px-4"
                  >
                    <FolderSearch className="mr-1.5 h-4 w-4" />
                    {t('settings.choose')}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.storageHint')}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model">
          <Card className="mb-4">
            <CardHeader className="flex-row items-center justify-between p-5 pb-3">
              <div>
                <CardTitle className="flex items-center gap-1.5 text-base">
                  {t('settings.modelAccess')}
                  <Popover>
                    <PopoverTrigger asChild>
                      <CircleHelp className="h-3.5 w-3.5 cursor-pointer text-muted-foreground/50 hover:text-foreground transition-colors" />
                    </PopoverTrigger>
                    <PopoverContent
                      side="bottom"
                      align="start"
                      className="w-auto max-w-xs border-[#d8cfbc]/80 bg-[#fffdf8] p-3"
                    >
                      <p className="mb-2 text-[11px] font-semibold text-[#3e4a32]">
                        {t('settings.modelHelpTitle')}
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {MODEL_PROVIDER_LINKS.map((item) => (
                          <a
                            key={item.url}
                            href={item.url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-md border border-[#d8cfbc]/80 bg-[#f5efe2]/60 px-2 py-1 text-[11px] text-[#5b6b4d] transition-colors hover:border-[#96b77f]/60 hover:bg-[#e8f0de] hover:text-[#3e4a32]"
                          >
                            {item.label}
                          </a>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </CardTitle>
                {activeModelConfig && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('settings.currentActiveModel', { name: activeModelConfig.name })}
                  </p>
                )}
              </div>
              <Button size="sm" onClick={openCreateModelDialog}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t('settings.addModel')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2.5 p-5 pt-0">
              {modelConfigs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#d8ccb5]/85 bg-[#fff9ef]/70 p-6 text-sm text-muted-foreground">
                  {t('settings.noModels')}
                </div>
              ) : (
                modelConfigs.map((config) => (
                  <div
                    key={config.id}
                    className={
                      config.active
                        ? 'flex flex-col gap-3 rounded-lg border border-[#96b77f]/80 bg-[#eef6e8] p-3 shadow-[inset_3px_0_0_#6f8f64] sm:flex-row sm:items-center sm:justify-between'
                        : 'flex flex-col gap-3 rounded-lg border border-[#d8ccb5]/80 bg-[#fffdf8]/78 p-3 sm:flex-row sm:items-center sm:justify-between'
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {config.active && <CheckCircle2 className="h-4 w-4 text-[#5d7b4d]" />}
                        <p className="font-medium text-[#33402a]">{config.name}</p>
                        <span className="rounded-full bg-[#e9efde] px-2 py-0.5 text-[11px] uppercase text-[#506141]">
                          {config.provider}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {config.model}
                      </p>
                      {config.baseUrl && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {config.baseUrl}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={config.active ? 'secondary' : 'outline'}
                        disabled={config.active || activatingId === config.id}
                        onClick={() => void handleActivateModel(config.id)}
                      >
                        {config.active ? t('settings.activeModel') : t('settings.activateModel')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEditModelDialog(config)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deletingId === config.id}
                        onClick={() => void handleDeleteModel(config)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imageModel">
          <Card className="mb-4">
            <CardHeader className="flex-row items-center justify-between p-5 pb-3">
              <div>
                <CardTitle className="flex items-center gap-1.5 text-base">
                  <ImageIcon className="h-4 w-4 text-[#5d7b4d]" />
                  {t('settings.imageModelAccess')}
                </CardTitle>
                {activeImageModelConfig && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t('settings.currentActiveImageModel', { name: activeImageModelConfig.name })}
                  </p>
                )}
              </div>
              <Button size="sm" onClick={openCreateImageModelDialog}>
                <Plus className="mr-1.5 h-4 w-4" />
                {t('settings.addImageModel')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2.5 p-5 pt-0">
              {imageModelConfigs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-[#d8ccb5]/85 bg-[#fff9ef]/70 p-6 text-sm text-muted-foreground">
                  {t('settings.noImageModels')}
                </div>
              ) : (
                imageModelConfigs.map((config) => (
                  <div
                    key={config.id}
                    className={
                      config.active
                        ? 'flex flex-col gap-3 rounded-lg border border-[#96b77f]/80 bg-[#eef6e8] p-3 shadow-[inset_3px_0_0_#6f8f64] sm:flex-row sm:items-center sm:justify-between'
                        : 'flex flex-col gap-3 rounded-lg border border-[#d8ccb5]/80 bg-[#fffdf8]/78 p-3 sm:flex-row sm:items-center sm:justify-between'
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {config.active && <CheckCircle2 className="h-4 w-4 text-[#5d7b4d]" />}
                        <p className="font-medium text-[#33402a]">{config.name}</p>
                        <span className="rounded-full bg-[#e9efde] px-2 py-0.5 text-[11px] uppercase text-[#506141]">
                          {config.provider}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {summarizeImageModelConfig(config.modelConfig)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={config.active ? 'secondary' : 'outline'}
                        disabled={config.active || activatingImageId === config.id}
                        onClick={() => void handleActivateImageModel(config.id)}
                      >
                        {config.active
                          ? t('settings.activeImageModel')
                          : t('settings.activateImageModel')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEditImageModelDialog(config)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deletingImageId === config.id}
                        onClick={() => void handleDeleteImageModel(config)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="advanced">
          <Card className="mb-4">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.timeoutSection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <p className="text-xs text-muted-foreground">{t('settings.timeoutHint')}</p>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {timeoutFields.map((field) => (
                  <div key={field.profile}>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      {field.label}
                    </label>
                    <Input
                      type="number"
                      min={field.min}
                      max={3600}
                      step={30}
                      placeholder={t('settings.timeoutPlaceholder')}
                      value={timeoutSeconds[field.profile]}
                      onChange={(e) => handleTimeoutChange(field.profile, e.target.value)}
                      className="h-10"
                    />
                    <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                      {field.hint}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardHeader className="p-5 pb-3">
              <CardTitle className="text-base">{t('settings.proxySection')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-5 pt-0">
              <div>
                <label className="mb-1.5 block text-sm font-medium">
                  {t('settings.proxyLabel')}
                </label>
                <Input
                  value={proxyUrl}
                  onChange={(e) => {
                    setProxyUrl(e.target.value)
                    setVerificationMessage(null)
                  }}
                  placeholder={t('settings.proxyPlaceholder')}
                  className="h-10"
                />
                <p className="mt-2 text-xs text-muted-foreground">{t('settings.proxyHint')}</p>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button onClick={handleSaveAdvanced} disabled={savingTimeouts}>
              {savingTimeouts ? t('common.saving') : t('settings.saveTimeouts')}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {modelDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d291f]/42 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingModel) {
              setModelDialogOpen(false)
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d8ccb5]/85 bg-[#fffaf1] shadow-[0_24px_70px_rgba(53,44,32,0.28)]">
            <div className="flex items-center justify-between border-b border-[#e3d8c5] px-5 py-4">
              <h2 className="text-base font-semibold text-[#33402a]">
                {modelForm.id ? t('settings.editModel') : t('settings.addModel')}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setModelDialogOpen(false)}
                disabled={savingModel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3 p-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('settings.modelName')}
                  </label>
                  <Input
                    value={modelForm.name}
                    onChange={(e) => updateModelForm({ name: e.target.value })}
                    placeholder={t('settings.modelNamePlaceholder')}
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('settings.providerPreset')}
                  </label>
                  <Select
                    value={modelForm.provider}
                    onValueChange={(value) =>
                      updateModelForm({
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
                  value={modelForm.model}
                  onChange={(e) => updateModelForm({ model: e.target.value })}
                  className="h-8"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.modelHint')}</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">base_url</label>
                <Input
                  placeholder={t('settings.baseUrlPlaceholder')}
                  value={modelForm.baseUrl}
                  onChange={(e) => updateModelForm({ baseUrl: e.target.value })}
                  className="h-8"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {modelForm.provider === 'google'
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
                  value={modelForm.maxTokens}
                  onChange={(e) =>
                    updateModelForm({
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
                        modelForm.provider === 'openai'
                          ? 'OpenAI'
                          : modelForm.provider === 'google'
                            ? 'Google'
                            : 'Claude'
                    })}
                    value={modelForm.apiKey}
                    onChange={(e) => updateModelForm({ apiKey: e.target.value })}
                    className="h-8 min-w-0 flex-1"
                  />
                  <Button
                    variant="secondary"
                    onClick={handleVerify}
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => setModelDialogOpen(false)}
                disabled={savingModel}
              >
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveModel} disabled={savingModel}>
                {savingModel ? t('common.saving') : t('settings.saveModel')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {imageModelDialogOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d291f]/42 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !savingModel) {
              setImageModelDialogOpen(false)
            }
          }}
        >
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-[#d8ccb5]/85 bg-[#fffaf1] shadow-[0_24px_70px_rgba(53,44,32,0.28)]">
            <div className="flex items-center justify-between border-b border-[#e3d8c5] px-5 py-4">
              <h2 className="text-base font-semibold text-[#33402a]">
                {imageModelForm.id ? t('settings.editImageModel') : t('settings.addImageModel')}
              </h2>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setImageModelDialogOpen(false)}
                disabled={savingModel}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-3 p-5">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('settings.modelName')}
                  </label>
                  <Input
                    value={imageModelForm.name}
                    onChange={(e) => updateImageModelForm({ name: e.target.value })}
                    placeholder={t('settings.imageModelNamePlaceholder')}
                    className="h-8"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t('settings.providerPreset')}
                  </label>
                  <Select
                    value={imageModelForm.provider}
                    onValueChange={handleImageProviderChange}
                  >
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
                  value={imageModelForm.modelConfig}
                  onChange={(e) => updateImageModelForm({ modelConfig: e.target.value })}
                  className="min-h-[240px] resize-y font-mono text-xs leading-5"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t('settings.imageModelConfigHint')}
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  variant="secondary"
                  onClick={handleVerifyImageModel}
                  disabled={verifyingImageModel}
                  className="h-8 min-w-[80px] rounded-lg border border-[#7ea06f]/45 px-3 text-xs"
                >
                  <ShieldCheck className="mr-1 h-3.5 w-3.5" />
                  {verifyingImageModel ? t('settings.verifying') : t('settings.verify')}
                </Button>
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-[#e3d8c5] px-5 py-4">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setImageModelDialogOpen(false)}
                disabled={savingModel}
              >
                {t('common.cancel')}
              </Button>
              <Button onClick={handleSaveImageModel} disabled={savingModel}>
                {savingModel ? t('common.saving') : t('settings.saveImageModel')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
