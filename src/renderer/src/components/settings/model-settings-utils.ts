import type { ImageModelConfig, ImageModelProvider, ModelConfig } from '../../lib/ipc'
import type { ImageModelForm, ModelForm } from './types'

export const IMAGE_PROVIDER_OPTIONS: Array<{ value: ImageModelProvider; label: string }> = [
  { value: 'jimeng', label: '即梦3.0' },
  { value: 'jimeng4', label: '即梦4.0' },
  { value: 'agnes', label: 'Agnes AI' },
  { value: 'siliconflow', label: '硅基流动' }
]

const JIMENG_DEFAULT_REQ_KEY = 'jimeng_t2i_v30'
const JIMENG_V4_DEFAULT_REQ_KEY = 'jimeng_t2i_v40'

export const readJsonObject = (value: string): Record<string, unknown> | null => {
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

export const stringifyJsonObject = (record: Record<string, unknown>): string => {
  return JSON.stringify(record, null, 2)
}

export const summarizeImageModelConfig = (value: string): string => {
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

export const createDefaultImageModelConfig = (provider: ImageModelProvider): string => {
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
  if (provider === 'siliconflow') {
    return stringifyJsonObject({
      model: 'Tongyi-MAI/Z-Image-Turbo',
      apiKey: ''
    })
  }
  return stringifyJsonObject({
    model: 'agnes-image-2.0-flash',
    apiKey: '',
    responseFormat: 'url'
  })
}

export const createEmptyModelForm = (active = false): ModelForm => ({
  name: '',
  provider: 'openai',
  model: '',
  apiKey: '',
  baseUrl: '',
  maxTokens: 4096,
  active
})

export const createModelForm = (config: ModelConfig): ModelForm => ({
  id: config.id,
  name: config.name,
  provider: config.provider,
  model: config.model,
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  maxTokens: config.maxTokens || 4096,
  active: config.active
})

export const createEmptyImageModelForm = (active = false): ImageModelForm => ({
  name: '',
  provider: 'jimeng',
  modelConfig: createDefaultImageModelConfig('jimeng'),
  active
})

export const createImageModelForm = (config: ImageModelConfig): ImageModelForm => {
  return {
    id: config.id,
    name: config.name,
    provider: config.provider,
    modelConfig: config.modelConfig || createDefaultImageModelConfig(config.provider),
    active: config.active
  }
}
