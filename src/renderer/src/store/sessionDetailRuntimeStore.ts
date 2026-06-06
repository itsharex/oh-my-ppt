import { create } from 'zustand'
import type { AddSessionElementHandler } from '@renderer/types/session-detail'

export type {
  AddSessionElementHandler,
  AddSessionElementOptions
} from '@renderer/types/session-detail'

interface SessionDetailRuntimeStore {
  addElementHandler: AddSessionElementHandler | null
  setAddElementHandler: (handler: AddSessionElementHandler | null) => void
  addElement: AddSessionElementHandler
}

export const useSessionDetailRuntimeStore = create<SessionDetailRuntimeStore>((set, get) => ({
  addElementHandler: null,
  setAddElementHandler: (addElementHandler) => set({ addElementHandler }),
  addElement: async (relativePath, fileName, options) => {
    const handler = get().addElementHandler
    return handler ? handler(relativePath, fileName, options) : false
  }
}))
