import { zipSync, strToU8 } from 'fflate'
import { writeFileSync } from 'fs'
import type {
  HtmlToPptxDocument,
  HtmlToPptxSlide,
  HtmlToPptxTextBox,
  HtmlToPptxShape,
  HtmlToPptxImage
} from './types'

// ─── Constants ───────────────────────────────────────────────────────
const EMU_PER_INCH = 914400
const SLIDE_WIDTH_EMU = 12192000  // 13.333"
const SLIDE_HEIGHT_EMU = 6858000  // 7.5"

const inToEmu = (inches: number): number => Math.round(inches * EMU_PER_INCH)
const ptToEmu = (pt: number): number => Math.round(pt * 12700)
const degToRot = (deg: number): number => Math.round(deg * 60000)

// ─── XML helpers ─────────────────────────────────────────────────────
const escapeXml = (str: string): string =>
  String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

const mapAlign = (align?: string): string => {
  switch (align) {
    case 'center': return 'ctr'
    case 'right': return 'r'
    case 'justify': return 'just'
    default: return 'l'
    }
}

const mapShapePreset = (shapeType?: string): string => {
  switch (shapeType) {
    case 'ellipse': return 'ellipse'
    case 'roundRect': return 'roundRect'
    default: return 'rect'
  }
}

const normalizeHexColor = (color: string | undefined, fallback = '000000'): string => {
  if (!color) return fallback
  const trimmed = color.trim().replace(/^#/, '').toUpperCase()
  if (/^[0-9A-F]{3}$/.test(trimmed)) {
    return trimmed.split('').map(c => c + c).join('')
  }
  return /^[0-9A-F]{6}$/.test(trimmed) ? trimmed : fallback
}

// ─── Element builders ────────────────────────────────────────────────

function buildTextShape(id: number, tb: HtmlToPptxTextBox): string {
  const text = normalizePptxText(tb.text)
  if (!text) return ''

  const lines = text.split('\n')
  const paragraphs = lines.map((line) => {
    const fillXml = buildColorFillXml(tb.color || '111827', tb.opacity)
    const lang = /[\u4e00-\u9fff]/.test(line) ? 'zh-CN' : 'en-US'
    const sz = tb.fontSize ? ` sz="${Math.round(tb.fontSize * 100)}"` : ''
    const b = tb.bold ? ' b="1"' : ''
    const i = tb.italic ? ' i="1"' : ''
    const u = tb.underline ? ' u="sng"' : ''
    const strike = tb.strike ? ' strike="sngStrike"' : ''
    const spc = tb.charSpacing ? ` spc="${Math.round(tb.charSpacing * 100)}"` : ''
    const fontFace = tb.fontFace || 'Aptos'

    const pPrParts: string[] = []
    if (tb.align && tb.align !== 'left') {
      pPrParts.push(` algn="${mapAlign(tb.align)}"`)
    }
    if (tb.lineSpacing && tb.lineSpacing > 0) {
      pPrParts.push(
        `<a:lnSpc><a:spcPts val="${Math.round(tb.lineSpacing * 100)}"/></a:lnSpc>`
      )
    }
    const pPr = pPrParts.length > 0
      ? `<a:pPr${pPrParts.filter(p => !p.startsWith('<')).join('')}>${pPrParts.filter(p => p.startsWith('<')).join('')}</a:pPr>`
      : '<a:pPr/>'

    return `      <a:p>
        ${pPr}
        <a:r>
          <a:rPr lang="${lang}"${sz}${b}${i}${u}${strike}${spc} dirty="0">
            ${fillXml}
            <a:latin typeface="${escapeXml(fontFace)}"/>
            <a:ea typeface="${escapeXml(fontFace)}"/>
          </a:rPr>
          <a:t>${escapeXml(line)}</a:t>
        </a:r>
      </a:p>`
  }).join('\n')

  const rot = tb.rotate ? ` rot="${degToRot(tb.rotate)}"` : ''
  const wrap = tb.wrap ? 'square' : 'none'

  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="TextBox ${id}"/>
      <p:cNvSpPr txBox="1"/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm${rot}>
        <a:off x="${inToEmu(tb.x)}" y="${inToEmu(tb.y)}"/>
        <a:ext cx="${inToEmu(tb.w)}" cy="${inToEmu(tb.h)}"/>
      </a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
      <a:noFill/>
    </p:spPr>
    <p:txBody>
      <a:bodyPr wrap="${wrap}" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"/>
      <a:lstStyle/>
${paragraphs}
    </p:txBody>
  </p:sp>`
}

function buildImagePic(id: number, rId: string, img: HtmlToPptxImage): string {
  const rot = img.rotate ? ` rot="${degToRot(img.rotate)}"` : ''
  return `<p:pic>
    <p:nvPicPr>
      <p:cNvPr id="${id}" name="Image ${id}"/>
      <p:cNvPicPr/>
      <p:nvPr/>
    </p:nvPicPr>
    <p:blipFill>
      <a:blip r:embed="${rId}"/>
      <a:stretch><a:fillRect/></a:stretch>
    </p:blipFill>
    <p:spPr>
      <a:xfrm${rot}>
        <a:off x="${inToEmu(img.x)}" y="${inToEmu(img.y)}"/>
        <a:ext cx="${inToEmu(img.w)}" cy="${inToEmu(img.h)}"/>
      </a:xfrm>
      <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    </p:spPr>
  </p:pic>`
}

function buildShapeXml(id: number, shape: HtmlToPptxShape): string {
  const preset = mapShapePreset(shape.shapeType)

  const rot = shape.rotate ? ` rot="${degToRot(shape.rotate)}"` : ''

  // Geometry
  let geomXml: string
  if (preset === 'roundRect' && shape.radius) {
    const adj = Math.min(50000, Math.max(0, Math.round(shape.radius * 500)))
    geomXml = `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${adj}"/></a:avLst></a:prstGeom>`
  } else {
    geomXml = `<a:prstGeom prst="${preset}"><a:avLst/></a:prstGeom>`
  }

  // Fill
  let fillXml: string
  if (shape.fill) {
    const color = normalizeHexColor(shape.fill)
    const alphaVal = shape.transparency !== undefined
      ? Math.round((100 - shape.transparency) * 1000)
      : 100000
    fillXml = alphaVal < 100000
      ? `<a:solidFill><a:srgbClr val="${color}"><a:alpha val="${alphaVal}"/></a:srgbClr></a:solidFill>`
      : `<a:solidFill><a:srgbClr val="${color}"/></a:solidFill>`
  } else {
    fillXml = '<a:noFill/>'
  }

  // Border
  let borderXml: string
  if (shape.border) {
    const bColor = normalizeHexColor(shape.border.color)
    const bWidth = ptToEmu(shape.border.widthPt)
    const bAlphaVal = shape.border.transparency !== undefined
      ? Math.round((100 - shape.border.transparency) * 1000)
      : 100000
    const dashVal = shape.border.dash === 'dash' ? 'dash' : 'solid'
    const borderFill = bAlphaVal < 100000
      ? `<a:solidFill><a:srgbClr val="${bColor}"><a:alpha val="${bAlphaVal}"/></a:srgbClr></a:solidFill>`
      : `<a:solidFill><a:srgbClr val="${bColor}"/></a:solidFill>`
    borderXml = `<a:ln w="${bWidth}">${borderFill}<a:prstDash val="${dashVal}"/></a:ln>`
  } else {
    borderXml = '<a:ln><a:noFill/></a:ln>'
  }

  return `<p:sp>
    <p:nvSpPr>
      <p:cNvPr id="${id}" name="Shape ${id}"/>
      <p:cNvSpPr/>
      <p:nvPr/>
    </p:nvSpPr>
    <p:spPr>
      <a:xfrm${rot}>
        <a:off x="${inToEmu(shape.x)}" y="${inToEmu(shape.y)}"/>
        <a:ext cx="${inToEmu(shape.w)}" cy="${inToEmu(shape.h)}"/>
      </a:xfrm>
      ${geomXml}
      ${fillXml}
      ${borderXml}
    </p:spPr>
  </p:sp>`
}

function buildColorFillXml(color: string, opacity?: number): string {
  const hex = normalizeHexColor(color)
  if (opacity !== undefined && opacity < 1) {
    const alphaVal = Math.round(opacity * 100000)
    return `<a:solidFill><a:srgbClr val="${hex}"><a:alpha val="${alphaVal}"/></a:srgbClr></a:solidFill>`
  }
  return `<a:solidFill><a:srgbClr val="${hex}"/></a:solidFill>`
}

function normalizePptxText(value: string): string {
  const lines = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .split('\n')
    .map(line => line.replace(/[^\S\n]+/g, ' ').trim())
  while (lines.length > 0 && !lines[0]) lines.shift()
  while (lines.length > 0 && !lines[lines.length - 1]) lines.pop()
  return lines.join('\n')
}

// ─── Slide XML ───────────────────────────────────────────────────────

interface ImageRel {
  rId: string
  mediaFile: string
}

function buildSlideXml(
  slide: HtmlToPptxSlide,
  imageRels: Map<string, ImageRel>,
  idStart: number
): string {
  let nextId = idStart
  const shapes: string[] = []

  // Background color
  let bgXml = ''
  if (slide.backgroundColor) {
    const hex = normalizeHexColor(slide.backgroundColor)
    bgXml = `<p:bg><p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>`
  }

  // Z-order: background image → images → shapes → texts

  // Background image
  if (slide.backgroundImage) {
    nextId++
    const rel = imageRels.get(slide.backgroundImage.dataUri)
    if (rel) {
      shapes.push(buildImagePic(nextId, rel.rId, {
        dataUri: slide.backgroundImage.dataUri,
        mimeType: slide.backgroundImage.mimeType,
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5,
        alt: slide.backgroundImage.alt
      }))
    }
  }

  // Images
  for (const img of slide.images || []) {
    nextId++
    const rel = imageRels.get(img.dataUri)
    if (rel) {
      shapes.push(buildImagePic(nextId, rel.rId, img))
    }
  }

  // Shapes
  for (const shape of slide.shapes || []) {
    nextId++
    shapes.push(buildShapeXml(nextId, shape))
  }

  // Texts
  for (const tb of slide.texts) {
    nextId++
    const xml = buildTextShape(nextId, tb)
    if (xml) shapes.push(xml)
  }

  return `${XML_HEADER}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    ${bgXml}
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      ${shapes.join('\n      ')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
</p:sld>`
}

// ─── Package-level XML ───────────────────────────────────────────────

function buildContentTypesXml(slideCount: number, mediaExtensions: Set<string>): string {
  const overrides: string[] = [
    `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>`,
    `<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>`,
    `<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>`,
    `<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>`
  ]
  for (let i = 1; i <= slideCount; i++) {
    overrides.push(
      `<Override PartName="/ppt/slides/slide${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
  }

  const defaults = [
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `<Default Extension="xml" ContentType="application/xml"/>`
  ]
  for (const ext of mediaExtensions) {
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    defaults.push(`<Default Extension="${ext}" ContentType="${mime}"/>`)
  }

  return `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  ${defaults.join('\n  ')}
  ${overrides.join('\n  ')}
</Types>`
}

function buildRootRelsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`
}

function buildPresentationXml(slideCount: number): string {
  const sldIds: string[] = []
  for (let i = 1; i <= slideCount; i++) {
    sldIds.push(`<p:sldId id="${255 + i}" r:id="rId${i}"/>`)
  }
  return `${XML_HEADER}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
                xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
                xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    ${sldIds.join('\n    ')}
  </p:sldIdLst>
  <p:sldMasterIdLst>
    <p:sldMasterId id="2147483648" r:id="rIdSm"/>
  </p:sldMasterIdLst>
  <p:sldSz cx="${SLIDE_WIDTH_EMU}" cy="${SLIDE_HEIGHT_EMU}" type="wide"/>
  <p:notesSz cx="${SLIDE_HEIGHT_EMU}" cy="${SLIDE_WIDTH_EMU}"/>
</p:presentation>`
}

function buildPresentationRelsXml(slideCount: number): string {
  const rels: string[] = [
    `<Relationship Id="rIdSm" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`
  ]
  for (let i = 1; i <= slideCount; i++) {
    rels.push(
      `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i}.xml"/>`
    )
  }
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.join('\n  ')}
</Relationships>`
}

function buildSlideMasterXml(): string {
  return `${XML_HEADER}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:bg>
      <p:bgRef idx="1001">
        <a:schemeClr val="bg1"/>
      </p:bgRef>
    </p:bg>
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
  <p:sldLayoutIdLst>
    <p:sldLayoutId id="2147483649" r:id="rId1"/>
  </p:sldLayoutIdLst>
</p:sldMaster>`
}

function buildSlideMasterRelsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`
}

function buildSlideLayoutXml(): string {
  return `${XML_HEADER}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1">
  <p:cSld name="Blank">
    <p:spTree>
      <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sldLayout>`
}

function buildSlideLayoutRelsXml(): string {
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`
}

function buildThemeXml(): string {
  return `${XML_HEADER}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="44546A"/></a:dk2>
      <a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
      <a:accent1><a:srgbClr val="4472C4"/></a:accent1>
      <a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
      <a:accent3><a:srgbClr val="A5A5A5"/></a:accent3>
      <a:accent4><a:srgbClr val="FFC000"/></a:accent4>
      <a:accent5><a:srgbClr val="5B9BD5"/></a:accent5>
      <a:accent6><a:srgbClr val="70AD47"/></a:accent6>
      <a:hlink><a:srgbClr val="0563C1"/></a:hlink>
      <a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont>
        <a:latin typeface="Aptos Display"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:majorFont>
      <a:minorFont>
        <a:latin typeface="Aptos"/>
        <a:ea typeface=""/>
        <a:cs typeface=""/>
      </a:minorFont>
    </a:fontScheme>
    <a:fmtScheme name="Office">
      <a:fillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:fillStyleLst>
      <a:lnStyleLst>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
        <a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
      </a:lnStyleLst>
      <a:effectStyleLst>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
        <a:effectStyle><a:effectLst/></a:effectStyle>
      </a:effectStyleLst>
      <a:bgFillStyleLst>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
        <a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
      </a:bgFillStyleLst>
    </a:fmtScheme>
  </a:themeElements>
  <a:objectDefaults/>
  <a:extraClrSchemeLst/>
</a:theme>`
}

function buildSlideRelsXml(imageRels: ImageRel[]): string {
  const rels: string[] = [
    `<Relationship Id="rIdLayout" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
  ]
  for (const r of imageRels) {
    rels.push(
      `<Relationship Id="${r.rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${r.mediaFile}"/>`
    )
  }
  return `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${rels.join('\n  ')}
</Relationships>`
}

// ─── Media helpers ───────────────────────────────────────────────────

function dataUriToBuffer(dataUri: string): { buffer: Uint8Array; ext: string } | null {
  const match = dataUri.match(/^data:image\/(png|jpeg|jpg|gif);base64,(.+)$/i)
  if (!match) return null
  const ext = match[1].toLowerCase() === 'jpg' ? 'jpg' : match[1].toLowerCase()
  const raw = atob(match[2])
  const buffer = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    buffer[i] = raw.charCodeAt(i)
  }
  return { buffer, ext }
}

// ─── Main writer ─────────────────────────────────────────────────────

export const writePptxDocument = async (
  outputPath: string,
  document: HtmlToPptxDocument
): Promise<void> => {
  const slides = document.slides.length > 0 ? document.slides : [{ texts: [] }]
  const slideCount = slides.length

  // 1. Collect all unique images across all slides → assign media file names
  const dataUriToMedia = new Map<string, { mediaFile: string; ext: string }>()
  let mediaIndex = 0

  const collectImage = (dataUri: string) => {
    if (dataUriToMedia.has(dataUri)) return
    const parsed = dataUriToBuffer(dataUri)
    if (!parsed) return
    mediaIndex++
    const mediaFile = `image${mediaIndex}.${parsed.ext}`
    dataUriToMedia.set(dataUri, { mediaFile, ext: parsed.ext })
  }

  for (const slide of slides) {
    if (slide.backgroundImage) collectImage(slide.backgroundImage.dataUri)
    for (const img of slide.images || []) collectImage(img.dataUri)
  }

  // 2. Build per-slide image rels
  const slideImageRels: Map<string, ImageRel>[] = []

  for (const slide of slides) {
    const relsMap = new Map<string, ImageRel>()
    let relIndex = 0

    const addRel = (dataUri: string) => {
      if (relsMap.has(dataUri)) return
      const media = dataUriToMedia.get(dataUri)
      if (!media) return
      relIndex++
      relsMap.set(dataUri, { rId: `rId${relIndex}`, mediaFile: media.mediaFile })
    }

    if (slide.backgroundImage) addRel(slide.backgroundImage.dataUri)
    for (const img of slide.images || []) addRel(img.dataUri)

    slideImageRels.push(relsMap)
  }

  // 3. Collect media extensions for Content_Types
  const mediaExtensions = new Set<string>()
  for (const [, media] of dataUriToMedia) {
    mediaExtensions.add(media.ext)
  }

  // 4. Build ZIP
  const files: Record<string, Uint8Array> = {}

  // Global XML
  files['[Content_Types].xml'] = strToU8(buildContentTypesXml(slideCount, mediaExtensions))
  files['_rels/.rels'] = strToU8(buildRootRelsXml())
  files['ppt/presentation.xml'] = strToU8(buildPresentationXml(slideCount))
  files['ppt/_rels/presentation.xml.rels'] = strToU8(buildPresentationRelsXml(slideCount))

  // Theme, slideMaster, slideLayout (required by Office)
  files['ppt/theme/theme1.xml'] = strToU8(buildThemeXml())
  files['ppt/slideMasters/slideMaster1.xml'] = strToU8(buildSlideMasterXml())
  files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = strToU8(buildSlideMasterRelsXml())
  files['ppt/slideLayouts/slideLayout1.xml'] = strToU8(buildSlideLayoutXml())
  files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = strToU8(buildSlideLayoutRelsXml())

  // Per-slide
  for (let i = 0; i < slideCount; i++) {
    const relsMap = slideImageRels[i]
    const imageRelsForSlide = Array.from(relsMap.values())

    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(buildSlideXml(slides[i], relsMap, 1))
    files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(buildSlideRelsXml(imageRelsForSlide))
  }

  // Media files
  for (const [dataUri, media] of dataUriToMedia) {
    const parsed = dataUriToBuffer(dataUri)
    if (parsed) {
      files[`ppt/media/${media.mediaFile}`] = parsed.buffer
    }
  }

  // 5. Generate ZIP and write
  const zipped = zipSync(files, { level: 6 })
  writeFileSync(outputPath, zipped)
}
