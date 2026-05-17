import type { BrowserWindow } from 'electron'
import type { PPTDatabase } from '../db/database'
import type { AgentManager } from '../agent'
import { createIpcContext } from './context'
import { registerSessionHandlers } from './session/session-handlers'
import { registerAssetHandlers, registerLocalAssetProtocol } from './io/assets-handlers'
import { registerGenerationHandlers } from './engine/generation-handlers'
import { registerExportHandlers } from './io/export-handlers'
import { registerStyleHandlers } from './config/style-handlers'
import { registerFontHandlers } from './config/font-handlers'
import { registerSettingsHandlers } from './config/settings-handlers'
import { registerPreviewHandlers } from './session/preview-handlers'
import { registerPageManagementHandlers } from './session/page-management-handlers'
import { registerFileHandlers } from './io/file-handlers'
import { registerEditorHandlers } from './editor'
import { registerDocumentParseHandlers } from './io/document-parse-handlers'
import { registerPptxImportHandlers } from './io/pptx-import-handlers'
import { registerHistoryHandlers } from './history/history-handlers'
import { registerPresentationHandlers } from './session/presentation-handlers'

export { registerLocalAssetProtocol }

export function setupIPC(
  mainWindow: BrowserWindow,
  db: PPTDatabase,
  agentManager: AgentManager
): void {
  const context = createIpcContext(mainWindow, db, agentManager)

  registerSessionHandlers(context)
  registerPageManagementHandlers(context)
  registerAssetHandlers(context)
  registerGenerationHandlers(context)
  registerExportHandlers(context)
  registerStyleHandlers(context)
  registerFontHandlers(context)
  registerSettingsHandlers(context)
  registerPreviewHandlers(context)
  registerFileHandlers(context)
  registerEditorHandlers(context)
  registerDocumentParseHandlers(context)
  registerPptxImportHandlers(context)
  registerHistoryHandlers(context)
  registerPresentationHandlers(context)
}
