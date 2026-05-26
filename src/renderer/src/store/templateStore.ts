import { create } from 'zustand'
import { ipc, type TemplateListItem } from '@renderer/lib/ipc'

interface TemplateStore {
  templates: TemplateListItem[]
  loading: boolean
  fetchTemplates: () => Promise<void>
  createTemplateFromSession: (payload: {
    sessionId: string
    name?: string
    description?: string
    tags?: string[]
  }) => Promise<string>
  createSessionFromTemplate: (payload: {
    templateId: string
    title?: string
    pageCount?: number
    referenceDocumentPath?: string
  }) => Promise<string>
  createEditableSessionFromTemplate: (payload: {
    templateId: string
    title?: string
  }) => Promise<string>
  updateTemplateMetadata: (payload: {
    templateId: string
    name: string
    description?: string
    tags?: string[]
  }) => Promise<void>
  deleteTemplate: (templateId: string) => Promise<void>
}

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: [],
  loading: false,

  fetchTemplates: async () => {
    set({ loading: true })
    try {
      const { items } = await ipc.listTemplates()
      set({ templates: items, loading: false })
    } catch (error) {
      set({ loading: false })
      throw error
    }
  },

  createTemplateFromSession: async (payload) => {
    const result = await ipc.createTemplateFromSession(payload)
    await get().fetchTemplates()
    return result.id
  },

  createSessionFromTemplate: async (payload) => {
    const result = await ipc.createSessionFromTemplate(payload)
    return result.sessionId
  },

  createEditableSessionFromTemplate: async (payload) => {
    const result = await ipc.createEditableSessionFromTemplate(payload)
    return result.sessionId
  },

  updateTemplateMetadata: async (payload) => {
    const result = await ipc.updateTemplateMetadata(payload)
    set((state) => ({
      templates: state.templates.map((template) =>
        template.id === result.item.id ? result.item : template
      )
    }))
  },

  deleteTemplate: async (templateId) => {
    await ipc.deleteTemplate(templateId)
    await get().fetchTemplates()
  }
}))
