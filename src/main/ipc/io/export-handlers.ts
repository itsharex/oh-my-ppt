import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import log from 'electron-log/main.js'
import fs from 'fs'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { nanoid } from 'nanoid'
import { zipSync } from 'fflate'
import { PDFDocument } from 'pdf-lib'
import type { IpcContext } from '../context'
import {
  writeHtmlToPptx,
  collectEmbeddedFonts,
  type HtmlToPptxEmbeddedFont,
  type HtmlToPptxSlide
} from '../../utils/html-pptx'
import {
  captureHtmlPageToPptxImageSlide,
  extractHtmlPageToPptxSlide
} from '../../utils/html-pptx/renderer'

type PptxExportPayload = {
  sessionId?: unknown
  imageOnly?: unknown
  embedFonts?: unknown
}

const parseSessionId = (payload: unknown): string => {
  if (
    payload &&
    typeof payload === 'object' &&
    typeof (payload as PptxExportPayload).sessionId === 'string'
  ) {
    return String((payload as { sessionId?: string }).sessionId).trim()
  }
  return typeof payload === 'string' ? payload.trim() : ''
}

const parseImageOnly = (payload: unknown): boolean =>
  Boolean(
    payload && typeof payload === 'object' && (payload as PptxExportPayload).imageOnly === true
  )

const parseFontEmbedMode = (payload: unknown): 'auto' | 'always' | 'never' => {
  if (!payload || typeof payload !== 'object') return 'always'
  const value = (payload as PptxExportPayload).embedFonts
  if (value === true || value === 'always') return 'always'
  if (value === false || value === 'never') return 'never'
  if (value === 'auto') return 'auto'
  return 'always'
}

const sanitizeExportBaseName = (value: string, fallback: string): string =>
  value.replace(/[\\/:*?"<>|]/g, '_').slice(0, 120) || fallback

const isSameOrChildPath = async (candidatePath: string, parentPath: string): Promise<boolean> => {
  const resolveRealPath = async (value: string): Promise<string> =>
    fs.promises.realpath(value).catch(() => path.resolve(value))

  const candidate = path.resolve(await resolveRealPath(candidatePath))
  const parent = path.resolve(await resolveRealPath(parentPath))
  const relative = path.relative(parent, candidate)

  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const buildPngFileName = (pageNumber: number, title: string | undefined): string => {
  const paddedNumber = String(pageNumber).padStart(2, '0')
  const sanitizedTitle = sanitizeExportBaseName(String(title || '').trim(), `page-${paddedNumber}`)
  return `${paddedNumber}-${sanitizedTitle}.png`
}

export function registerExportHandlers(ctx: IpcContext): void {
  const {
    mainWindow,
    db,
    resolveSessionPageFiles,
    renderPageToPdfBuffer,
    waitForPrintReadySignal,
    EXPORT_PAGE_READY_TIMEOUT_MS,
    EXPORT_CAPTURE_SETTLE_MS
  } = ctx

  ipcMain.handle('export:pdf', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const { session, pages, projectDir } = await resolveSessionPageFiles(sessionId)
    const sessionTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const sanitizedBaseName = sanitizeExportBaseName(sessionTitle, `ohmyppt-${sessionId}`)

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: '导出 PDF',
      defaultPath: path.join(path.dirname(projectDir), `${sanitizedBaseName}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    const warnings: string[] = []
    try {
      const mergedPdf = await PDFDocument.create()
      const pdfPageWidth = 16 * 72
      const pdfPageHeight = 9 * 72

      for (const page of pages) {
        log.info('[export:pdf] render page', {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath
        })
        const rendered = await renderPageToPdfBuffer({
          page,
          timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS
        })
        if (rendered.warning) warnings.push(rendered.warning)
        const embeddedImage = await mergedPdf.embedPng(rendered.pngBuffer)
        const pageDoc = mergedPdf.addPage([pdfPageWidth, pdfPageHeight])
        pageDoc.drawImage(embeddedImage, {
          x: 0,
          y: 0,
          width: pdfPageWidth,
          height: pdfPageHeight
        })
      }

      const outputBytes = await mergedPdf.save()
      await fs.promises.writeFile(saveResult.filePath, outputBytes)
      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:pdf] completed', {
        sessionId,
        pageCount: pages.length,
        filePath: saveResult.filePath,
        warningCount: warnings.length
      })
      shell.showItemInFolder(saveResult.filePath)
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: pages.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:pdf] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  ipcMain.handle('export:png', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }

    const { pages, projectDir } = await resolveSessionPageFiles(sessionId)

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const directoryResult = await dialog.showOpenDialog(ownerWindow, {
      title: '选择 PNG 导出目录',
      defaultPath: path.dirname(projectDir),
      buttonLabel: '导出到此目录',
      properties: ['openDirectory', 'createDirectory']
    })

    if (directoryResult.canceled || directoryResult.filePaths.length === 0) {
      return { success: false, cancelled: true }
    }

    const outputParentDir = directoryResult.filePaths[0]
    const outputDir = path.join(outputParentDir, `ohmyppt-export-image_${nanoid(8)}`)
    const warnings: string[] = []

    try {
      await fs.promises.mkdir(outputDir, { recursive: true })
      for (const page of pages) {
        log.info('[export:png] render page', {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath
        })
        const rendered = await renderPageToPdfBuffer({
          page,
          timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS
        })
        if (rendered.warning) warnings.push(rendered.warning)
        await fs.promises.writeFile(
          path.join(outputDir, buildPngFileName(page.pageNumber, page.title)),
          rendered.pngBuffer
        )
      }

      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:png] completed', {
        sessionId,
        pageCount: pages.length,
        directoryPath: outputDir,
        warningCount: warnings.length
      })
      shell.openPath(outputDir).catch(() => {
        shell.showItemInFolder(outputDir)
      })
      return {
        success: true,
        cancelled: false,
        path: outputDir,
        pageCount: pages.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:png] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  ipcMain.handle('export:pptx', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) {
      throw new Error('sessionId 不能为空')
    }
    const imageOnly = parseImageOnly(payload)
    const fontEmbedMode = imageOnly ? 'never' : parseFontEmbedMode(payload)

    const { session, pages, projectDir } = await resolveSessionPageFiles(sessionId)
    const sessionTitle =
      typeof session.title === 'string' && session.title.trim().length > 0
        ? session.title.trim()
        : `ohmyppt-${sessionId}`
    const prefix = imageOnly ? '【Image】' : '【Edit】'
    const sanitizedBaseName = sanitizeExportBaseName(
      `${prefix}${sessionTitle}`,
      `ohmyppt-${sessionId}`
    )

    const ownerWindow =
      BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
    const saveResult = await dialog.showSaveDialog(ownerWindow, {
      title: '导出 PPTX',
      defaultPath: path.join(path.dirname(projectDir), `${sanitizedBaseName}.pptx`),
      filters: [{ name: 'PowerPoint', extensions: ['pptx'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, cancelled: true }
    }

    const warnings: string[] = []

    try {
      const slides: HtmlToPptxSlide[] = []
      for (const page of pages) {
        const mode = imageOnly ? 'image' : 'editable'
        log.info('[export:pptx] extract page', {
          sessionId,
          pageId: page.pageId,
          htmlPath: page.htmlPath,
          mode
        })
        const extracted = imageOnly
          ? await captureHtmlPageToPptxImageSlide({
              page,
              timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS,
              settleMs: EXPORT_CAPTURE_SETTLE_MS,
              waitForPrintReadySignal
            })
          : await extractHtmlPageToPptxSlide({
              page,
              timeoutMs: EXPORT_PAGE_READY_TIMEOUT_MS,
              settleMs: EXPORT_CAPTURE_SETTLE_MS,
              waitForPrintReadySignal
            })
        slides.push(extracted.slide)
        if (extracted.warning) warnings.push(extracted.warning)
      }

      if (!imageOnly) {
        const pagesWithoutText = slides.filter((s) => s.texts.length === 0).length
        if (pagesWithoutText > 0) {
          warnings.push(`${pages.length} 页中有 ${pagesWithoutText} 页未提取到可编辑文本。`)
        }
      }

      // Collect embedded fonts (editable mode only). The user-facing behavior is
      // always "try to include fonts"; fallback is internal compatibility handling.
      let embeddedFonts: HtmlToPptxEmbeddedFont[] = []
      if (!imageOnly) {
        try {
          embeddedFonts = await collectEmbeddedFonts(projectDir, slides, {
            mode: fontEmbedMode,
            maxTotalBytes: 20 * 1024 * 1024
          })
        } catch (error) {
          log.warn('[export:pptx] font embedding collection failed, fallback to system fonts', {
            sessionId,
            message: error instanceof Error ? error.message : String(error)
          })
          warnings.push('字体嵌入失败，已自动改用 PowerPoint 本机字体导出。')
        }
      }

      try {
        await writeHtmlToPptx(saveResult.filePath, {
          title: sessionTitle,
          author: 'OhMyPPT',
          slides,
          embeddedFonts: embeddedFonts.length > 0 ? embeddedFonts : undefined
        })
      } catch (error) {
        if (embeddedFonts.length === 0) throw error
        log.warn('[export:pptx] write with embedded fonts failed, retry without fonts', {
          sessionId,
          message: error instanceof Error ? error.message : String(error)
        })
        warnings.push('字体嵌入写入失败，已自动降级为 PowerPoint 本机字体导出。')
        embeddedFonts = []
        await writeHtmlToPptx(saveResult.filePath, {
          title: sessionTitle,
          author: 'OhMyPPT',
          slides
        })
      }
      const project = await db.getProject(sessionId)
      if (project?.id) {
        await db.updateProjectStatus(project.id, 'exported')
      }

      log.info('[export:pptx] completed', {
        sessionId,
        pageCount: slides.length,
        filePath: saveResult.filePath,
        warningCount: warnings.length,
        imageOnly,
        fontEmbedMode,
        embeddedFontCount: embeddedFonts.length
      })
      shell.showItemInFolder(saveResult.filePath)
      return {
        success: true,
        cancelled: false,
        path: saveResult.filePath,
        pageCount: slides.length,
        warnings
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:pptx] failed', {
        sessionId,
        message
      })
      throw error
    }
  })

  // Export: slide-pack (standalone executable with embedded slides)
  ipcMain.handle('export:slidePack', async (event, payload: unknown) => {
    const sessionId = parseSessionId(payload)
    if (!sessionId) throw new Error('Missing sessionId')

    try {
      const { session, projectDir } = await resolveSessionPageFiles(sessionId)

      // Find pre-compiled viewer binary in resources
      const resourcesDir = is.dev
        ? path.join(process.cwd(), 'resources')
        : path.join(process.resourcesPath, 'app.asar.unpacked', 'resources')

      const targets = [
        { platform: 'macos-arm64', bin: 'slide-pack-darwin-arm64', ext: '', os: 'darwin', arch: 'arm64' },
        { platform: 'macos-amd64', bin: 'slide-pack-darwin-amd64', ext: '', os: 'darwin', arch: 'x64' },
        { platform: 'windows-amd64', bin: 'slide-pack-windows-amd64.exe', ext: '.exe', os: 'win32', arch: 'x64' }
      ]

      const currentPlatform = process.platform
      const currentArch = process.arch

      const rawTitle = typeof session.title === 'string' && session.title.trim() ? session.title.trim() : 'slides'
      const sessionName = rawTitle.replace(/[<>:"/\\|?*]/g, '').trim()

      // Let user choose save directory
      const ownerWindow =
        BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow
      const saveResult = await dialog.showOpenDialog(ownerWindow, {
        title: '选择打包导出目录',
        defaultPath: path.dirname(projectDir),
        properties: ['openDirectory', 'createDirectory'],
        buttonLabel: '导出到此目录'
      })
      if (saveResult.canceled || !saveResult.filePaths[0]) {
        return { success: false, cancelled: true }
      }

      const outputParentDir = saveResult.filePaths[0]
      if (await isSameOrChildPath(outputParentDir, projectDir)) {
        throw new Error('打包导出目录不能选择当前会话目录或其子目录，请选择会话目录外的位置。')
      }

      // Create output folder
      const outputFolder = path.join(outputParentDir, `ohmyppt-${nanoid(8)}`)
      fs.mkdirSync(outputFolder, { recursive: true })

      log.info('[export:slidePack] starting', { sessionId, projectDir, outputFolder })

      // ZIP all slides
      const zipFiles: Record<string, Uint8Array> = {}
      const collectFiles = (dir: string, prefix: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) continue
          const fullPath = path.join(dir, entry.name)
          const zipPath = prefix ? `${prefix}/${entry.name}` : entry.name
          if (entry.isDirectory()) {
            collectFiles(fullPath, zipPath)
          } else {
            zipFiles[zipPath] = fs.readFileSync(fullPath)
          }
        }
      }
      collectFiles(projectDir, '')
      const zipData = zipSync(zipFiles)

      log.info('[export:slidePack] zip created', { fileCount: Object.keys(zipFiles).length, zipSize: zipData.byteLength })

      const generatedFiles: string[] = []

      // For each platform: viewer + zip + 8-byte trailer → output executable
      for (const t of targets) {
        const viewerPath = path.join(resourcesDir, t.bin)
        if (!fs.existsSync(viewerPath)) {
          log.warn('[export:slidePack] skip platform, viewer not found', { bin: t.bin })
          continue
        }

        const viewerData = fs.readFileSync(viewerPath)
        const outputName = `${sessionName}-${t.platform}${t.ext}`

        // Trailer: uint64 LE = ZIP data length
        const trailer = Buffer.alloc(8)
        trailer.writeBigUInt64LE(BigInt(zipData.byteLength))

        const output = Buffer.concat([viewerData, Buffer.from(zipData), trailer])

        // For cross-platform darwin binaries: wrap in a zip with Unix permissions
        // so macOS can execute after extracting (Windows chmod is a no-op for Unix perms)
        const isCrossPlatform = t.os !== currentPlatform || t.arch !== currentArch
        if (isCrossPlatform && t.os === 'darwin') {
          const innerName = `${sessionName}-${t.platform}`
          const permissionZip = zipSync(
            { [innerName]: [new Uint8Array(output), { os: 3, attrs: 0o755 << 16 }] as any }
          )
          const zipOutputName = `${sessionName}-${t.platform}.zip`
          fs.writeFileSync(path.join(outputFolder, zipOutputName), Buffer.from(permissionZip))
          generatedFiles.push(zipOutputName)
        } else {
          const outputPath = path.join(outputFolder, outputName)
          fs.writeFileSync(outputPath, output)
          fs.chmodSync(outputPath, 0o755)
          generatedFiles.push(outputName)
        }
      }

      // Write README.txt
      const readmeContent = `演示文稿预览包
================

双击对应平台的文件即可在浏览器中打开演示。

文件说明：
  *-macos-arm64(.zip)       → Apple Silicon Mac (M1/M2/M3/M4)
  *-macos-amd64(.zip)       → Intel Mac
  *-windows-amd64.exe       → Windows 电脑

使用方法：
  macOS：若为 .zip 文件请先解压，再双击解压后的文件打开
  Windows：双击 .exe 文件打开
  如果提示"无法打开"，请右键 → 打开 → 确认打开

打开后会自动启动浏览器显示演示。
关闭终端窗口或按 Ctrl+C 即可停止。
`
      fs.writeFileSync(path.join(outputFolder, 'README.txt'), readmeContent, 'utf-8')

      if (generatedFiles.length === 0) {
        throw new Error('No viewer binaries found in resources/')
      }

      await shell.openPath(outputFolder)

      log.info('[export:slidePack] completed', { sessionId, outputFolder, files: generatedFiles })

      return {
        success: true,
        path: path.join(outputFolder, generatedFiles[0]),
        cancelled: false,
        pageCount: generatedFiles.length,
        warnings: []
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.error('[export:slidePack] failed', { sessionId, message })
      throw error
    }
  })
}
