import { create } from 'zustand'
import type { UploadedAsset } from '@shared/generation.js'

export type SessionDetailChatType = 'main' | 'page'
export type InteractionMode = 'preview' | 'ai-inspect' | 'edit'

interface SessionDetailUiStore {
  input: string
  chatType: SessionDetailChatType
  selectedPageId: string | null
  consoleOpen: boolean
  previewKey: number
  isExportingPdf: boolean
  isExportingPng: boolean
  isExportingPptx: boolean
  isExportingSlidePack: boolean
  isExportingSessionZip: boolean
  interactionMode: InteractionMode
  thumbnailVersions: Record<string, number>
  selectedSelector: string | null
  selectorLabel: string
  elementTag: string
  elementText: string
  pendingAssets: UploadedAsset[]
  assetDragActive: boolean
  isUploadingAssets: boolean
  addPageDialogOpen: boolean
  isAddingPage: boolean
  isRetryingSinglePage: boolean
  isManagingPages: boolean
  sidebarCollapsed: boolean
  assetPickerOpen: boolean
  assetPickerType: 'image' | 'video'
  isGeneratingSpeechScript: boolean
  speechProgress: { current: number; total: number } | null
  speechScriptDialogOpen: boolean
  speechConfig: { length: 'short' | 'medium' | 'long'; style: 'formal' | 'conversational' | 'storytelling' }

  setInput: (input: string) => void
  setChatType: (chatType: SessionDetailChatType) => void
  setSelectedPageId: (pageId: string | null) => void
  setConsoleOpen: (open: boolean | ((open: boolean) => boolean)) => void
  bumpPreviewKey: () => void
  setIsExportingPdf: (isExporting: boolean) => void
  setIsExportingPng: (isExporting: boolean) => void
  setIsExportingPptx: (isExporting: boolean) => void
  setIsExportingSlidePack: (isExporting: boolean) => void
  setIsExportingSessionZip: (isExporting: boolean) => void
  setInteractionMode: (mode: InteractionMode) => void
  setSelectedElement: (
    selector: string,
    label: string,
    elementTag?: string,
    elementText?: string
  ) => void
  clearSelectedElement: () => void
  addPendingAssets: (assets: UploadedAsset[]) => void
  removePendingAsset: (assetId: string) => void
  clearPendingAssets: () => void
  setAssetDragActive: (active: boolean) => void
  setIsUploadingAssets: (isUploading: boolean) => void
  bumpThumbnailVersion: (pageId: string) => void
  setAddPageDialogOpen: (open: boolean) => void
  setIsAddingPage: (adding: boolean) => void
  setIsRetryingSinglePage: (retrying: boolean) => void
  setIsManagingPages: (managing: boolean) => void
  toggleSidebarCollapsed: () => void
  setAssetPickerOpen: (open: boolean, type?: 'image' | 'video') => void
  setIsGeneratingSpeechScript: (v: boolean) => void
  setSpeechProgress: (progress: { current: number; total: number } | null) => void
  setSpeechScriptDialogOpen: (v: boolean) => void
  setSpeechConfig: (config: { length: 'short' | 'medium' | 'long'; style: 'formal' | 'conversational' | 'storytelling' }) => void
  finishAddPage: (selectedPageId?: string | null) => void
  resetForPageChange: () => void
  resetForSessionChange: () => void
}

export const useSessionDetailUiStore = create<SessionDetailUiStore>((set) => ({
  input: '',
  chatType: 'page',
  selectedPageId: null,
  consoleOpen: true,
  previewKey: 0,
  isExportingPdf: false,
  isExportingPng: false,
  isExportingPptx: false,
  isExportingSlidePack: false,
  isExportingSessionZip: false,
  interactionMode: 'preview' as InteractionMode,
  thumbnailVersions: {},
  selectedSelector: null,
  selectorLabel: '',
  elementTag: '',
  elementText: '',
  pendingAssets: [],
  assetDragActive: false,
  isUploadingAssets: false,
  addPageDialogOpen: false,
  isAddingPage: false,
  isRetryingSinglePage: false,
  isManagingPages: false,
  sidebarCollapsed: false,
  assetPickerOpen: false,
  assetPickerType: 'image' as const,
  isGeneratingSpeechScript: false,
  speechProgress: null,
  speechScriptDialogOpen: false,
  speechConfig: { length: 'medium' as const, style: 'conversational' as const },

  setInput: (input) => set({ input }),
  setChatType: (chatType) => set({ chatType }),
  setSelectedPageId: (selectedPageId) => set({ selectedPageId }),
  setConsoleOpen: (open) =>
    set((state) => ({
      consoleOpen: typeof open === 'function' ? open(state.consoleOpen) : open
    })),
  bumpPreviewKey: () => set((state) => ({ previewKey: state.previewKey + 1 })),
  setIsExportingPdf: (isExportingPdf) => set({ isExportingPdf }),
  setIsExportingPng: (isExportingPng) => set({ isExportingPng }),
  setIsExportingPptx: (isExportingPptx) => set({ isExportingPptx }),
  setIsExportingSlidePack: (isExportingSlidePack) => set({ isExportingSlidePack }),
  setIsExportingSessionZip: (isExportingSessionZip) => set({ isExportingSessionZip }),
  setInteractionMode: (interactionMode) => set({ interactionMode }),
  // Fix: only reset to preview when currently in preview mode.
  // In edit/ai-inspect mode, selecting an element should NOT change the mode.
  setSelectedElement: (selectedSelector, selectorLabel, elementTag = '', elementText = '') =>
    set((state) => ({
      selectedSelector,
      selectorLabel,
      elementTag,
      elementText,
      interactionMode:
        state.interactionMode === 'preview' ? ('preview' as InteractionMode) : state.interactionMode
    })),
  clearSelectedElement: () =>
    set({
      selectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: ''
    }),
  addPendingAssets: (assets) =>
    set((state) => ({
      pendingAssets: [...state.pendingAssets, ...assets]
    })),
  removePendingAsset: (assetId) =>
    set((state) => ({
      pendingAssets: state.pendingAssets.filter((asset) => asset.id !== assetId)
    })),
  clearPendingAssets: () => set({ pendingAssets: [] }),
  setAssetDragActive: (assetDragActive) => set({ assetDragActive }),
  setIsUploadingAssets: (isUploadingAssets) => set({ isUploadingAssets }),
  bumpThumbnailVersion: (pageId) =>
    set((state) => ({
      thumbnailVersions: {
        ...state.thumbnailVersions,
        [pageId]: (state.thumbnailVersions[pageId] || 0) + 1
      }
    })),
  setAddPageDialogOpen: (addPageDialogOpen) => set({ addPageDialogOpen }),
  setIsAddingPage: (isAddingPage) => set({ isAddingPage }),
  setIsRetryingSinglePage: (isRetryingSinglePage) => set({ isRetryingSinglePage }),
  setIsManagingPages: (isManagingPages) => set({ isManagingPages }),
  toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setAssetPickerOpen: (open, type) =>
    set((state) => ({
      assetPickerOpen: open,
      ...(type ? { assetPickerType: type } : { assetPickerType: state.assetPickerType })
    })),
  setIsGeneratingSpeechScript: (isGeneratingSpeechScript) => set({ isGeneratingSpeechScript }),
  setSpeechProgress: (speechProgress) => set({ speechProgress }),
  setSpeechScriptDialogOpen: (speechScriptDialogOpen) => set({ speechScriptDialogOpen }),
  setSpeechConfig: (speechConfig) => set({ speechConfig }),
  finishAddPage: (selectedPageId) =>
    set((state) => ({
      isAddingPage: false,
      selectedPageId: typeof selectedPageId === 'undefined' ? state.selectedPageId : selectedPageId
    })),
  resetForPageChange: () =>
    set({
      interactionMode: 'preview' as InteractionMode,
      selectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: ''
    }),
  resetForSessionChange: () =>
    set({
      input: '',
      chatType: 'page',
      selectedPageId: null,
      interactionMode: 'preview' as InteractionMode,
      selectedSelector: null,
      selectorLabel: '',
      elementTag: '',
      elementText: '',
      pendingAssets: [],
      assetDragActive: false,
      isUploadingAssets: false,
      thumbnailVersions: {},
      addPageDialogOpen: false,
      isAddingPage: false,
      isRetryingSinglePage: false,
      isManagingPages: false,
      sidebarCollapsed: false,
      assetPickerOpen: false,
      isGeneratingSpeechScript: false,
      speechProgress: null,
      speechScriptDialogOpen: false
    })
}))
