import type { ImageGenerationProviderAdapter, ResolvedImageModelConfig } from '../types'
import { agnesAiAdapter } from './agnes-ai'
import { jimengAdapter } from './jimeng'
import { jimengV4Adapter } from './jimeng-v4'
import { siliconFlowAdapter } from './siliconflow'

const PROVIDER_ADAPTERS: Record<
  ResolvedImageModelConfig['provider'],
  ImageGenerationProviderAdapter
> = {
  agnes: agnesAiAdapter,
  jimeng: jimengAdapter,
  jimeng4: jimengV4Adapter,
  siliconflow: siliconFlowAdapter
}

export function resolveImageGenerationProvider(
  provider: ResolvedImageModelConfig['provider']
): ImageGenerationProviderAdapter {
  return PROVIDER_ADAPTERS[provider]
}
