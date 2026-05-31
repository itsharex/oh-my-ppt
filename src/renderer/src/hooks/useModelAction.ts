import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useT } from '@renderer/i18n'
import { useSettingsStore, useToastStore } from '@renderer/store'
import type { ModelConfig } from '@renderer/lib/ipc'

export interface ModelActionState {
  modelConfigs: ModelConfig[]
  selectedModelConfigId: string
  activatingModelConfigId: string | null
  hasMultipleModelConfigs: boolean
  currentModelConfig: ModelConfig | null
  ensureModelActive: (modelConfigId?: string) => Promise<boolean>
}

export function useModelAction(): ModelActionState {
  const t = useT()
  const navigate = useNavigate()
  const { error: toastError, warning: toastWarning } = useToastStore()
  const { modelConfigs, fetchSettings, setActiveModelConfig } = useSettingsStore()
  const [selectedModelConfigId, setSelectedModelConfigId] = useState('')
  const [activatingModelConfigId, setActivatingModelConfigId] = useState<string | null>(null)

  useEffect(() => {
    void fetchSettings()
  }, [fetchSettings])

  useEffect(() => {
    setSelectedModelConfigId((current) => {
      if (current && modelConfigs.some((config) => config.id === current)) return current
      return modelConfigs.find((config) => config.active)?.id || modelConfigs[0]?.id || ''
    })
  }, [modelConfigs])

  const ensureModelActive = useCallback(
    async (modelConfigId = selectedModelConfigId): Promise<boolean> => {
      const warnModelSettingsRequired = (): void => {
        toastWarning(t('settings.modelSettingsRequiredTitle'), {
          description: t('settings.modelSettingsRequiredDescription'),
          action: {
            label: t('home.goToSettings'),
            onClick: () => navigate('/settings')
          }
        })
      }
      const nextModelConfigId = modelConfigId || selectedModelConfigId
      if (activatingModelConfigId) return false
      if (!nextModelConfigId) {
        warnModelSettingsRequired()
        return false
      }

      const latestConfigs = useSettingsStore.getState().modelConfigs
      const selected =
        latestConfigs.find((config) => config.id === nextModelConfigId) ||
        modelConfigs.find((config) => config.id === nextModelConfigId)
      if (!selected) {
        warnModelSettingsRequired()
        return false
      }

      const previousModelConfigId = selectedModelConfigId
      setSelectedModelConfigId(nextModelConfigId)
      if (selected.active) return true

      setActivatingModelConfigId(nextModelConfigId)
      try {
        await setActiveModelConfig(nextModelConfigId)
        const activateError = useSettingsStore.getState().verificationMessage
        if (activateError) {
          setSelectedModelConfigId(previousModelConfigId)
          toastError(t('settings.activateModelFailed'), { description: activateError })
          return false
        }
        return true
      } finally {
        setActivatingModelConfigId(null)
      }
    },
    [
      activatingModelConfigId,
      modelConfigs,
      navigate,
      selectedModelConfigId,
      setActiveModelConfig,
      t,
      toastError,
      toastWarning
    ]
  )

  const currentModelConfig = useMemo(
    () => modelConfigs.find((config) => config.id === selectedModelConfigId) || null,
    [modelConfigs, selectedModelConfigId]
  )

  return {
    modelConfigs,
    selectedModelConfigId,
    activatingModelConfigId,
    hasMultipleModelConfigs: modelConfigs.length > 1,
    currentModelConfig,
    ensureModelActive
  }
}
