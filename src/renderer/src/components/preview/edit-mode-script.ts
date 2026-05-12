export const EDIT_MODE_CONSOLE_PREFIX = '__PPT_EDIT_MODE__:'

export interface EditSelectionPayload {
  selector: string
  label: string
  elementTag: string
  elementText: string
  isText: boolean
  text: string
  style: {
    color?: string
    fontSize?: string
    fontWeight?: string
    lineHeight?: string
    textAlign?: string
    backgroundColor?: string
  }
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  }
  translateX: number
  translateY: number
  editability?: {
    x: boolean
    y: boolean
    width: boolean
    height: boolean
  }
}

export interface EditModeMovePayload {
  selector: string
  label: string
  elementTag: string
  x: number
  y: number
  deltaX: number
  deltaY: number
  width?: number
  height?: number
  scale?: number
  childUpdates?: Array<{
    path: number[]
    width?: number
    height?: number
  }>
}

export function buildEditModeInjectScript(previewScale = 1): string {
  return `
(() => {
  const STATE_KEY = "__pptEditModeState";
  const STYLE_ID = "ppt-edit-mode-style";
  const OVERLAY_ID = "ppt-edit-mode-resize-overlay";
  const HOVER_CLASS = "ppt-edit-mode-hover";
  const SELECTED_CLASS = "ppt-edit-mode-selected";
  const HANDLE_CLASS = "ppt-edit-mode-resize-handle";
  const INITIAL_PREVIEW_SCALE = ${JSON.stringify(
    Number.isFinite(previewScale) && previewScale > 0 ? Number(previewScale.toFixed(4)) : 1
  )};
  const LOG_PREFIX = "${EDIT_MODE_CONSOLE_PREFIX}";
  const SCAFFOLD_BLOCK_IDS = new Set(["content"]);
  const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "span", "strong", "em", "b", "i", "small", "label", "button", "td", "th", "blockquote", "figcaption"]);
  const BLOCKED_TEXT_TAGS = new Set(["script", "style", "svg", "canvas", "img", "video", "audio", "input", "textarea", "select", "option"]);

  const normalizeText = (value) => String(value || "").replace(/\\\\s+/g, " ").trim();
  const normalizeScale = (value) => {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 1;
  };

  const hasOnlyEditableTextChildren = (element) => {
    return Array.from(element.children || []).every((child) => {
      const tag = child.tagName ? child.tagName.toLowerCase() : "";
      return tag === "br";
    });
  };

  const isEditableTextElement = (element) => {
    if (!(element instanceof Element)) return false;
    const tag = element.tagName ? element.tagName.toLowerCase() : "";
    if (!tag || BLOCKED_TEXT_TAGS.has(tag)) return false;
    if (element.closest("svg, canvas, script, style")) return false;
    if (!hasOnlyEditableTextChildren(element)) return false;
    if (!TEXT_TAGS.has(tag) && !element.getAttribute("data-role") && !element.getAttribute("data-block-id")) return false;
    const text = normalizeText(element.textContent);
    if (!text || text.length > 500) return false;
    return true;
  };

  const existing = window[STATE_KEY];
  if (existing && existing.active) {
    try {
      existing.setPreviewScale?.(INITIAL_PREVIEW_SCALE);
      window.__pptEditModeSetPreviewScale?.(INITIAL_PREVIEW_SCALE);
    } catch (_error) {}
    return;
  }

  let previewScaleValue = normalizeScale(INITIAL_PREVIEW_SCALE);

  const cssEscape = (value) => {
    if (window.CSS && typeof window.CSS.escape === "function") {
      return window.CSS.escape(String(value));
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\\\" + ch);
  };

  const attrEscape = (value) => String(value).replace(/"/g, '\\\\"');

  const isUniqueSelector = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch (_error) {
      return false;
    }
  };

  const getPageScopeSelector = () => {
    const pageId = document.body ? document.body.getAttribute("data-page-id") : "";
    if (pageId) return 'body[data-page-id="' + attrEscape(pageId) + '"]';
    return "body";
  };

  const getClassList = (el) =>
    Array.from(el.classList || [])
      .filter((item) => item && !item.startsWith("ppt-edit-mode-") && !item.includes(":"))
      .slice(0, 3);

  const buildSegment = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.getAttribute("id");
    if (id) return "#" + cssEscape(id);
    const role = el.getAttribute("data-role");
    if (role) return tag + '[data-role="' + attrEscape(role) + '"]';
    const blockId = el.getAttribute("data-block-id");
    if (blockId) return tag + '[data-block-id="' + attrEscape(blockId) + '"]';
    const classes = getClassList(el);
    if (classes.length > 0) {
      return tag + "." + classes.map((item) => cssEscape(item)).join(".");
    }
    return tag;
  };

  const buildScopedSelector = (scope, el) => {
    const levels = [];
    let cursor = el;
    while (
      cursor &&
      cursor instanceof Element &&
      cursor !== document.body &&
      cursor !== document.documentElement &&
      levels.length < 3
    ) {
      levels.unshift(buildSegment(cursor));
      cursor = cursor.parentElement;
    }

    const candidates = [];
    if (levels.length >= 1) {
      candidates.push(scope + " " + levels[levels.length - 1]);
    }
    if (levels.length >= 2) {
      candidates.push(scope + " " + levels[levels.length - 2] + " > " + levels[levels.length - 1]);
    }
    if (levels.length >= 3) {
      candidates.push(scope + " " + levels[levels.length - 3] + " > " + levels[levels.length - 2] + " > " + levels[levels.length - 1]);
    }

    for (const candidate of candidates) {
      if (isUniqueSelector(candidate)) return candidate;
    }

    return candidates[candidates.length - 1] || (scope + " " + buildSegment(el));
  };

  const buildStableSelector = (el) => {
    if (!(el instanceof Element)) return null;
    const scope = getPageScopeSelector();
    const blockId = el.getAttribute("data-block-id");
    if (blockId) return scope + ' [data-block-id="' + attrEscape(blockId) + '"]';

    const role = el.getAttribute("data-role");
    if (role) {
      const owner = el.closest("[data-block-id]");
      const ownerBlockId = owner ? owner.getAttribute("data-block-id") : "";
      if (ownerBlockId) {
        const roleSelector =
          scope +
          ' [data-block-id="' +
          attrEscape(ownerBlockId) +
          '"] [data-role="' +
          attrEscape(role) +
          '"]';
        if (isUniqueSelector(roleSelector)) return roleSelector;
      }
    }

    const idValue = el.getAttribute("id");
    if (idValue) {
      const selector = scope + " #" + cssEscape(idValue);
      if (isUniqueSelector(selector)) return selector;
      return selector;
    }

    const root = el.closest("[data-ppt-guard-root='1'], .ppt-page-root");
    if (root) {
      const rootSelector = root.getAttribute("data-ppt-guard-root") === "1"
        ? '[data-ppt-guard-root="1"]'
        : ".ppt-page-root";
      const segments = [];
      let current = el;
      while (current && current !== root) {
        const parent = current.parentElement;
        if (!parent) break;
        const index = Array.prototype.indexOf.call(parent.children, current);
        if (index < 0) break;
        const tag = current.tagName ? current.tagName.toLowerCase() : "*";
        segments.unshift(tag + ":nth-child(" + (index + 1) + ")");
        current = parent;
      }
      if (current === root && segments.length > 0) {
        const selector = scope + " " + rootSelector + " " + segments.join(" > ");
        if (isUniqueSelector(selector)) return selector;
      }
    }

    return buildScopedSelector(scope, el);
  };

  const isInsidePageRoot = (element) => {
    return element && (element.closest(".ppt-page-root") !== null || element.closest("[data-ppt-guard-root='1']") !== null);
  };

  const getPageRoot = (element) => {
    return element && element.closest(".ppt-page-root, [data-ppt-guard-root='1']");
  };

  const isScaffoldBlock = (element) => {
    if (!(element instanceof Element)) return false;
    const blockId = element.getAttribute("data-block-id");
    const role = element.getAttribute("data-role");
    return (
      SCAFFOLD_BLOCK_IDS.has(String(blockId || "")) ||
      role === "content" ||
      element.classList.contains("ppt-page-root") ||
      element.classList.contains("ppt-page-fit-scope") ||
      element.classList.contains("ppt-page-content") ||
      element.getAttribute("data-ppt-guard-root") === "1" ||
      element.tagName === "BODY" ||
      element.tagName === "HTML"
    );
  };

  const getContentRoot = (element) => {
    return element && element.closest('[data-block-id="content"], [data-role="content"]');
  };

  const getElementRenderScale = (element) => {
    if (!(element instanceof HTMLElement)) {
      return { x: 1, y: 1 };
    }

    const scope = element.closest(".ppt-page-fit-scope");
    if (scope instanceof HTMLElement) {
      const scopeRect = scope.getBoundingClientRect();
      const scopeWidth = scope.offsetWidth || scope.clientWidth;
      const scopeHeight = scope.offsetHeight || scope.clientHeight;
      return {
        x: Math.max(0.01, scopeWidth > 0 ? scopeRect.width / scopeWidth : 1),
        y: Math.max(0.01, scopeHeight > 0 ? scopeRect.height / scopeHeight : 1),
      };
    }

    const rect = element.getBoundingClientRect();
    const width = element.offsetWidth || element.clientWidth;
    const height = element.offsetHeight || element.clientHeight;
    return {
      x: Math.max(0.01, width > 0 ? rect.width / width : 1),
      y: Math.max(0.01, height > 0 ? rect.height / height : 1),
    };
  };

  const getPointerScale = (element) => {
    const renderScale = getElementRenderScale(element);
    // NOTE: Do NOT multiply by the external webview previewScale here.
    // The browser already maps pointer coordinates to the iframe's own
    // coordinate system when the webview element has a CSS transform,
    // so including previewScale would double-compensate and make the
    // element move 1/previewScale times too far.
    return {
      x: Math.max(0.01, renderScale.x),
      y: Math.max(0.01, renderScale.y),
    };
  };

  const getPointerDelta = (element, currentClientX, currentClientY, startClientX, startClientY) => {
    const scale = getPointerScale(element);
    return {
      x: (currentClientX - startClientX) / scale.x,
      y: (currentClientY - startClientY) / scale.y,
    };
  };

  const isUsableElementTarget = (element) => {
    if (!(element instanceof Element)) return false;
    if (isScaffoldBlock(element)) return false;
    if (!isInsidePageRoot(element)) return false;
    if (["SCRIPT", "STYLE", "LINK", "META", "TITLE"].includes(element.tagName)) return false;
    // Atomic visual elements — rendered as a single unit, internals should
    // not be individually selected; clicks bubble up to the parent container.
    if (element.closest("svg")) return false;
    if (["CANVAS", "VIDEO", "AUDIO", "IFRAME"].includes(element.tagName)) return false;
    const contentRoot = getContentRoot(element);
    const boundaryRoot = contentRoot || getPageRoot(element);
    if (!boundaryRoot || element === boundaryRoot) return false;
    const rect = element.getBoundingClientRect();
    return rect.width >= 2 && rect.height >= 2;
  };

  const isPointInRect = (rect, clientX, clientY) => {
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  };

  const getElementDepth = (element) => {
    let depth = 0;
    let current = element;
    while (current && current.parentElement) {
      depth += 1;
      current = current.parentElement;
    }
    return depth;
  };

  const getPointTarget = (origin, clientX, clientY) => {
    const hitElement = document.elementFromPoint(clientX, clientY);
    const root = getPageRoot(origin) || getPageRoot(hitElement) || document.querySelector(".ppt-page-root, [data-ppt-guard-root='1']");
    if (!root) return null;
    const seen = new Set();
    const candidates = [];
    const addCandidate = (element) => {
      if (!(element instanceof Element)) return;
      if (seen.has(element)) return;
      seen.add(element);
      if (!root.contains(element)) return;
      if (!isUsableElementTarget(element)) return;
      const selector = buildStableSelector(element);
      if (!selector) return;
      const rect = element.getBoundingClientRect();
      if (!isPointInRect(rect, clientX, clientY)) return;
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      candidates.push({
        element,
        area: Math.max(1, rect.width * rect.height),
        distance: Math.hypot(centerX - clientX, centerY - clientY),
        depth: getElementDepth(element),
      });
    };

    if (typeof document.elementsFromPoint === "function") {
      document.elementsFromPoint(clientX, clientY).forEach(addCandidate);
    }
    root.querySelectorAll("*").forEach(addCandidate);

    candidates.sort((a, b) => a.area - b.area || b.depth - a.depth || a.distance - b.distance);
    return candidates[0]?.element || null;
  };

  const pickCanvasTarget = (origin) => {
    const canvas = origin.closest("canvas");
    if (!canvas || !isInsidePageRoot(canvas)) return null;
    let candidate = canvas.parentElement && !isScaffoldBlock(canvas.parentElement) ? canvas.parentElement : canvas;
    while (candidate && candidate.parentElement && !buildStableSelector(candidate)) {
      if (isScaffoldBlock(candidate.parentElement)) break;
      candidate = candidate.parentElement;
    }
    return buildStableSelector(candidate) ? candidate : null;
  };

  const pickLooseContentTarget = (origin) => {
    const contentRoot = getContentRoot(origin) || getPageRoot(origin);
    if (!contentRoot) return null;
    let candidate = origin;
    while (candidate && candidate !== contentRoot) {
      if (isUsableElementTarget(candidate) && buildStableSelector(candidate)) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  };

  const promoteToWrapper = (element) => {
    const contentRoot = getContentRoot(element);
    if (!contentRoot) return element;
    let candidate = element.parentElement;
    while (candidate && candidate !== contentRoot) {
      if (isScaffoldBlock(candidate)) break;
      const hasBlockChildren = candidate.querySelectorAll("[data-block-id]").length >= 2;
      const noBlockId = !candidate.getAttribute("data-block-id");
      if (noBlockId && hasBlockChildren && buildStableSelector(candidate)) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return element;
  };

  const pickTarget = (origin, clientX, clientY) => {
    if (!(origin instanceof Element)) return null;
    const chartTarget = pickCanvasTarget(origin);
    if (chartTarget) return chartTarget;
    if (Number.isFinite(clientX) && Number.isFinite(clientY)) {
      const pointTarget = getPointTarget(origin, clientX, clientY);
      if (pointTarget) return promoteToWrapper(pointTarget);
    }
    const looseTarget = pickLooseContentTarget(origin);
    if (looseTarget) return promoteToWrapper(looseTarget);
    const blocks = Array.from(origin.closest(".ppt-page-root, [data-ppt-guard-root='1']")?.querySelectorAll("[data-block-id]") || []);
    const target = origin.closest("[data-block-id]");
    if (target && blocks.includes(target) && isInsidePageRoot(target) && !isScaffoldBlock(target)) {
      return target;
    }
    return null;
  };

  const parsePx = (value) => {
    const match = String(value || "").trim().match(/^(-?\\d+(?:\\.\\d+)?)px$/);
    return match ? Number(match[1]) : 0;
  };

  const ensureDragTranslate = (target) => {
    const computed = getComputedStyle(target);
    if (computed.display === "inline") {
      target.style.display = "inline-block";
    }
    // Read custom property values and set translate directly as numeric px.
    // Using var() references can be a no-op when the same template string is
    // already in the inline style (persisted from a previous drag), preventing
    // CSS variable changes from taking effect before getBoundingClientRect().
    const x = parsePx(target.style.getPropertyValue("--ppt-drag-x") || computed.getPropertyValue("--ppt-drag-x"));
    const y = parsePx(target.style.getPropertyValue("--ppt-drag-y") || computed.getPropertyValue("--ppt-drag-y"));
    target.style.translate = x.toFixed(1) + "px " + y.toFixed(1) + "px";
    target.style.willChange = "transform";
  };

  const roundPx = (value) => Number(Math.max(1, value).toFixed(1));

  const buildElementPath = (root, element) => {
    const path = [];
    let current = element;
    while (current && current !== root) {
      const parent = current.parentElement;
      if (!parent) return [];
      const index = Array.prototype.indexOf.call(parent.children, current);
      if (index < 0) return [];
      path.unshift(index);
      current = parent;
    }
    return current === root ? path : [];
  };

  const collectResizableChildren = (target) => {
    const items = [];
    const seen = new Set();
    target.querySelectorAll("canvas").forEach((canvas) => {
      const parent = canvas.parentElement;
      const element = parent && parent !== target ? parent : canvas;
      if (!element || seen.has(element)) return;
      seen.add(element);
      const rect = element.getBoundingClientRect();
      const path = buildElementPath(target, element);
      if (!path.length && element !== target) return;
      items.push({
        element,
        path,
        baseWidth: Math.max(1, rect.width),
        baseHeight: Math.max(1, rect.height),
      });
    });
    return items;
  };

  const resizeNestedCharts = (target) => {
    if (window.PPT && typeof window.PPT.resizeCharts === "function") {
      try { window.PPT.resizeCharts(target); } catch (_error) {}
    }
  };

  const ensureStyle = () => {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = \`
      html, body, body * {
        animation: none !important;
        transition: none !important;
      }
      .\${HOVER_CLASS} {
        outline: 2px dashed rgba(93,107,77,0.78) !important;
        outline-offset: 3px !important;
        cursor: move !important;
      }
      .\${HOVER_CLASS} * {
        cursor: move !important;
      }
      .\${SELECTED_CLASS} {
        outline: 2px solid #5d6b4d !important;
        outline-offset: 3px !important;
        box-shadow: 0 0 0 4px rgba(93,107,77,0.14) !important;
        cursor: move !important;
        user-select: none !important;
      }
      .\${SELECTED_CLASS} * {
        cursor: move !important;
      }
      #\${OVERLAY_ID} {
        position: fixed !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        border: 1px solid rgba(93,107,77,0.92) !important;
        box-shadow: 0 0 0 3px rgba(93,107,77,0.12) !important;
        box-sizing: border-box !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS} {
        position: absolute !important;
        width: 16px !important;
        height: 16px !important;
        border: 2px solid #ffffff !important;
        border-radius: 999px !important;
        background: #5d6b4d !important;
        box-shadow: 0 2px 8px rgba(0,0,0,0.18) !important;
        pointer-events: auto !important;
        box-sizing: border-box !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="n"] {
        left: calc(50% - 8px) !important;
        top: -9px !important;
        cursor: ns-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="s"] {
        left: calc(50% - 8px) !important;
        bottom: -9px !important;
        cursor: ns-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="w"] {
        left: -9px !important;
        top: calc(50% - 8px) !important;
        cursor: ew-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="e"] {
        right: -9px !important;
        top: calc(50% - 8px) !important;
        cursor: ew-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="nw"] {
        left: -9px !important;
        top: -9px !important;
        cursor: nwse-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="ne"] {
        right: -9px !important;
        top: -9px !important;
        cursor: nesw-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="sw"] {
        left: -9px !important;
        bottom: -9px !important;
        cursor: nesw-resize !important;
      }
      #\${OVERLAY_ID} .\${HANDLE_CLASS}[data-dir="se"] {
        right: -9px !important;
        bottom: -9px !important;
        cursor: nwse-resize !important;
      }
      html,
      body,
      body * {
        cursor: move !important;
        -webkit-user-select: none !important;
        user-select: none !important;
      }
    \`;
    document.head.appendChild(style);
  };

  // --- State ---
  let hoverElement = null;
  let selectedElement = null;
  let dragState = null;
  let resizeState = null;
  let pendingAnchorState = null;
  let dragPendingState = null;
  let pendingClientX = 0;
  let pendingClientY = 0;
  let frameId = 0;
  let overlayElement = null;
  let overlayResizeObserver = null;

  // Double-click detection
  const DBLCLICK_MS = 400;
  let lastClickTime = 0;
  let lastClickTarget = null;
  let lastClickSelector = null;

  // Anchor resolution — host resolves selector and calls this
  window.__pptResolveEditModeAnchor = function(result) {
    if (!pendingAnchorState) return;
    const stableSelector = (result && result.selector) || pendingAnchorState.tempSelector;
    if (pendingAnchorState.mode === 'drag') {
      dragState = {
        target: pendingAnchorState.target,
        selector: stableSelector,
        elementTag: pendingAnchorState.elementTag,
        startClientX: pendingAnchorState.startClientX,
        startClientY: pendingAnchorState.startClientY,
        baseX: pendingAnchorState.baseX,
        baseY: pendingAnchorState.baseY,
      };
      setSelected(pendingAnchorState.target);
    } else if (pendingAnchorState.mode === 'resize') {
      resizeState = {
        target: pendingAnchorState.target,
        selector: stableSelector,
        elementTag: pendingAnchorState.elementTag,
        dir: pendingAnchorState.dir,
        startClientX: pendingAnchorState.startClientX,
        startClientY: pendingAnchorState.startClientY,
        baseX: pendingAnchorState.baseX,
        baseY: pendingAnchorState.baseY,
        baseWidth: pendingAnchorState.baseWidth,
        baseHeight: pendingAnchorState.baseHeight,
        childItems: pendingAnchorState.childItems,
      };
    }
    pendingAnchorState = null;
  };

  const cursorHost = document.body || document.documentElement;
  const rootHost = document.documentElement;
  const previousCursor = cursorHost && cursorHost.style ? cursorHost.style.cursor : "";
  const previousRootCursor = rootHost && rootHost.style ? rootHost.style.cursor : "";
  if (rootHost && rootHost.style) {
    rootHost.style.cursor = "move";
  }
  if (cursorHost && cursorHost.style) {
    cursorHost.style.cursor = "move";
  }
  ensureStyle();

  // Kill residual animations from ppt-default-motion (anime.js).
  (() => {
    if (window.PPT && typeof window.PPT.stopAnimations === "function") {
      try { window.PPT.stopAnimations(); } catch (_e) {}
    }
    const root = document.querySelector(".ppt-page-root, [data-ppt-guard-root='1']");
    if (!root) return;
    root.querySelectorAll("[style]").forEach((el) => {
      const s = el.style;
      if (s.transition && (s.transition.includes("transform") || s.transition.includes("opacity"))) {
        s.transition = "";
      }
    });
  })();

  // --- Visual helpers ---
  const setHover = (target) => {
    if (hoverElement === target) return;
    if (hoverElement && hoverElement !== selectedElement) hoverElement.classList.remove(HOVER_CLASS);
    hoverElement = target;
    if (hoverElement && hoverElement !== selectedElement) hoverElement.classList.add(HOVER_CLASS);
  };

  const ensureOverlay = () => {
    if (overlayElement && overlayElement.isConnected) return overlayElement;
    const overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    ["n", "s", "w", "e", "nw", "ne", "sw", "se"].forEach((dir) => {
      const handle = document.createElement("div");
      handle.className = HANDLE_CLASS;
      handle.setAttribute("data-dir", dir);
      overlay.appendChild(handle);
    });
    document.body.appendChild(overlay);
    overlayElement = overlay;
    return overlayElement;
  };

  const updateOverlay = () => {
    if (!selectedElement) {
      if (overlayElement) overlayElement.remove();
      overlayElement = null;
      return;
    }
    const overlay = ensureOverlay();
    const rect = selectedElement.getBoundingClientRect();
    overlay.style.left = rect.left.toFixed(1) + "px";
    overlay.style.top = rect.top.toFixed(1) + "px";
    overlay.style.width = Math.max(1, rect.width).toFixed(1) + "px";
    overlay.style.height = Math.max(1, rect.height).toFixed(1) + "px";
  };

  const setSelected = (target) => {
    if (selectedElement === target) return;
    if (selectedElement) selectedElement.classList.remove(SELECTED_CLASS);
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }
    selectedElement = target;
    if (selectedElement) {
      selectedElement.classList.remove(HOVER_CLASS);
      selectedElement.classList.add(SELECTED_CLASS);
      updateOverlay();
      overlayResizeObserver = new ResizeObserver(() => updateOverlay());
      overlayResizeObserver.observe(selectedElement);
    } else {
      updateOverlay();
    }
  };

  const clearVisualState = () => {
    if (hoverElement) hoverElement.classList.remove(HOVER_CLASS);
    if (selectedElement) selectedElement.classList.remove(SELECTED_CLASS);
    hoverElement = null;
    selectedElement = null;
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }
    if (overlayElement) overlayElement.remove();
    overlayElement = null;
  };

  // --- Emit helpers ---
  // All elements can be edited — first edit converts to position:absolute.
  const analyzeEditability = () => ({ x: true, y: true, width: true, height: true });

  const emitSelected = (target, selector) => {
    const elementTag = target.tagName ? target.tagName.toLowerCase() : "";
    const isText = isEditableTextElement(target);
    const rawText = isText ? normalizeText(target.textContent) : "";
    const elementText = rawText.length > 80 ? rawText.slice(0, 80) + "\\u2026" : rawText;
    const computed = isText ? window.getComputedStyle(target) : null;
    const rect = target.getBoundingClientRect();
    const currentDragX = parsePx(target.style.getPropertyValue("--ppt-drag-x"));
    const currentDragY = parsePx(target.style.getPropertyValue("--ppt-drag-y"));

    console.log(LOG_PREFIX + JSON.stringify({
      type: "selected",
      selector,
      label: selector,
      elementTag,
      elementText,
      isText,
      text: rawText,
      style: computed ? {
        color: computed.color || "",
        fontSize: computed.fontSize || "",
        fontWeight: computed.fontWeight || "",
        lineHeight: computed.lineHeight || "",
        textAlign: computed.textAlign || "",
        backgroundColor: computed.backgroundColor || ""
      } : {},
      bounds: {
            x: Math.round(rect.left * 10) / 10,
            y: Math.round(rect.top * 10) / 10,
            width: Math.round(rect.width * 10) / 10,
            height: Math.round(rect.height * 10) / 10
          },
      translateX: target.hasAttribute("data-ppt-layout-converted") ? 0 : currentDragX,
      translateY: target.hasAttribute("data-ppt-layout-converted") ? 0 : currentDragY,
      editability: analyzeEditability(target)
    }));
  };

  // --- Drag/Resize frame callbacks ---
  const applyPendingDrag = () => {
    frameId = 0;
    if (!dragState) return;
    // Absolute-converted elements: move via left/top directly
    if (dragState.target.hasAttribute("data-ppt-layout-converted")) {
      const delta = getPointerDelta(
        dragState.target,
        pendingClientX,
        pendingClientY,
        dragState.startClientX,
        dragState.startClientY
      );
      dragState.target.style.left = (dragState.baseX + delta.x).toFixed(1) + "px";
      dragState.target.style.top = (dragState.baseY + delta.y).toFixed(1) + "px";
      // Sync the viewport tracker so next Inspector edit computes correct delta
      const dragRect = dragState.target.getBoundingClientRect();
      dragState.target.setAttribute("data-ppt-last-vp-x", dragRect.left.toFixed(1));
      dragState.target.setAttribute("data-ppt-last-vp-y", dragRect.top.toFixed(1));
      updateOverlay();
      return;
    }
    const delta = getPointerDelta(
      dragState.target,
      pendingClientX,
      pendingClientY,
      dragState.startClientX,
      dragState.startClientY
    );
    const nextX = dragState.baseX + delta.x;
    const nextY = dragState.baseY + delta.y;
    dragState.target.style.setProperty("--ppt-drag-x", nextX.toFixed(1) + "px");
    dragState.target.style.setProperty("--ppt-drag-y", nextY.toFixed(1) + "px");
    ensureDragTranslate(dragState.target);
    updateOverlay();
  };

  const applyPendingResize = () => {
    frameId = 0;
    if (!resizeState) return;
    const delta = getPointerDelta(
      resizeState.target,
      pendingClientX,
      pendingClientY,
      resizeState.startClientX,
      resizeState.startClientY
    );
    const dx = delta.x;
    const dy = delta.y;
    const dir = resizeState.dir;
    const affectsWidth = dir.includes("w") || dir.includes("e");
    const affectsHeight = dir.includes("n") || dir.includes("s");
    const signedDx = dir.includes("w") ? -dx : (dir.includes("e") ? dx : 0);
    const signedDy = dir.includes("n") ? -dy : (dir.includes("s") ? dy : 0);
    let nextWidth = affectsWidth ? roundPx(resizeState.baseWidth + signedDx) : resizeState.baseWidth;
    let nextHeight = affectsHeight ? roundPx(resizeState.baseHeight + signedDy) : resizeState.baseHeight;
    if (affectsWidth && affectsHeight) {
      const scaleFromX = (resizeState.baseWidth + signedDx) / resizeState.baseWidth;
      const scaleFromY = (resizeState.baseHeight + signedDy) / resizeState.baseHeight;
      const rawScale = Math.abs(signedDx) >= Math.abs(signedDy) ? scaleFromX : scaleFromY;
      const nextScale = Math.max(0.15, Math.min(5, Number.isFinite(rawScale) ? rawScale : 1));
      nextWidth = roundPx(resizeState.baseWidth * nextScale);
      nextHeight = roundPx(resizeState.baseHeight * nextScale);
    }
    const nextX = resizeState.baseX + (dir.includes("w") ? resizeState.baseWidth - nextWidth : 0);
    const nextY = resizeState.baseY + (dir.includes("n") ? resizeState.baseHeight - nextHeight : 0);
    const scaleX = nextWidth / resizeState.baseWidth;
    const scaleY = nextHeight / resizeState.baseHeight;
    resizeState.target.style.width = nextWidth.toFixed(1) + "px";
    resizeState.target.style.height = nextHeight.toFixed(1) + "px";
    resizeState.childItems.forEach((item) => {
      if (affectsWidth) item.element.style.width = roundPx(item.baseWidth * scaleX).toFixed(1) + "px";
      if (affectsHeight) item.element.style.height = roundPx(item.baseHeight * scaleY).toFixed(1) + "px";
    });
    // Absolute-converted elements: move via left/top
    if (resizeState.target.hasAttribute("data-ppt-layout-converted")) {
      resizeState.target.style.left = nextX.toFixed(1) + "px";
      resizeState.target.style.top = nextY.toFixed(1) + "px";
      // Sync the viewport tracker so next Inspector edit computes correct delta
      const resizeRect = resizeState.target.getBoundingClientRect();
      resizeState.target.setAttribute("data-ppt-last-vp-x", resizeRect.left.toFixed(1));
      resizeState.target.setAttribute("data-ppt-last-vp-y", resizeRect.top.toFixed(1));
    } else {
      resizeState.target.style.setProperty("--ppt-drag-x", nextX.toFixed(1) + "px");
      resizeState.target.style.setProperty("--ppt-drag-y", nextY.toFixed(1) + "px");
      ensureDragTranslate(resizeState.target);
    }
    resizeNestedCharts(resizeState.target);
    updateOverlay();
  };

  // --- Pointer event handlers ---
  const onPointerMove = (event) => {
    if (pendingAnchorState) {
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    // Deferred drag: only activate when pointer moves beyond threshold
    if (dragPendingState) {
      const dx = event.clientX - dragPendingState.startClientX;
      const dy = event.clientY - dragPendingState.startClientY;
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      // Threshold exceeded — convert to real drag
      const s = dragPendingState;
      dragPendingState = null;
      ensureDragTranslate(s.target);
      if (rootHost && rootHost.style) rootHost.style.cursor = "move";
      if (cursorHost && cursorHost.style) cursorHost.style.cursor = "move";
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      if (s.selector.indexOf('[data-block-id=') !== -1) {
        setSelected(s.target);
        dragState = {
          target: s.target,
          selector: s.selector,
          elementTag: s.elementTag,
          startClientX: s.startClientX,
          startClientY: s.startClientY,
          baseX: s.baseX,
          baseY: s.baseY,
        };
      } else {
        pendingAnchorState = {
          mode: 'drag',
          target: s.target,
          tempSelector: s.selector,
          elementTag: s.elementTag,
          startClientX: s.startClientX,
          startClientY: s.startClientY,
          baseX: s.baseX,
          baseY: s.baseY,
        };
        console.log(LOG_PREFIX + JSON.stringify({ type: "pre-anchor", selector: s.selector, elementTag: s.elementTag }));
      }
      try {
        s.target.setPointerCapture?.(event.pointerId);
      } catch (_error) {}
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (resizeState) {
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      if (!frameId) {
        frameId = requestAnimationFrame(applyPendingResize);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (dragState) {
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      if (!frameId) {
        frameId = requestAnimationFrame(applyPendingDrag);
      }
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = pickTarget(event.target, event.clientX, event.clientY);
    setHover(target);
  };

  const onPointerDown = (event) => {
    if (event.button !== 0) return;
    const handle = event.target instanceof Element ? event.target.closest("." + HANDLE_CLASS) : null;
    if (handle && selectedElement) {
      const selector = buildStableSelector(selectedElement);
      if (!selector) return;
      const isAbsSel = selectedElement.hasAttribute("data-ppt-layout-converted");
      const computed = isAbsSel ? null : getComputedStyle(selectedElement);
      const rect = selectedElement.getBoundingClientRect();
      const baseX = isAbsSel
        ? parseFloat(selectedElement.style.left || "0")
        : parsePx(selectedElement.style.getPropertyValue("--ppt-drag-x") || computed.getPropertyValue("--ppt-drag-x"));
      const baseY = isAbsSel
        ? parseFloat(selectedElement.style.top || "0")
        : parsePx(selectedElement.style.getPropertyValue("--ppt-drag-y") || computed.getPropertyValue("--ppt-drag-y"));
      if (!isAbsSel) ensureDragTranslate(selectedElement);
      pendingClientX = event.clientX;
      pendingClientY = event.clientY;
      const elementTag = selectedElement.tagName ? selectedElement.tagName.toLowerCase() : "";
      if (selector.indexOf('[data-block-id=') !== -1) {
        resizeState = {
          target: selectedElement,
          selector,
          elementTag,
          dir: handle.getAttribute("data-dir") || "se",
          startClientX: event.clientX,
          startClientY: event.clientY,
          baseX,
          baseY,
          baseWidth: Math.max(1, rect.width),
          baseHeight: Math.max(1, rect.height),
          childItems: collectResizableChildren(selectedElement),
        };
      } else {
        pendingAnchorState = {
          mode: 'resize',
          target: selectedElement,
          tempSelector: selector,
          elementTag,
          dir: handle.getAttribute("data-dir") || "se",
          startClientX: event.clientX,
          startClientY: event.clientY,
          baseX,
          baseY,
          baseWidth: Math.max(1, rect.width),
          baseHeight: Math.max(1, rect.height),
          childItems: collectResizableChildren(selectedElement),
        };
        console.log(LOG_PREFIX + JSON.stringify({ type: "pre-anchor", selector, elementTag }));
      }
      try {
        handle.setPointerCapture?.(event.pointerId);
      } catch (_error) {}
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const target = pickTarget(event.target, event.clientX, event.clientY);
    if (!target) return;

    const selector = buildStableSelector(target);
    if (!selector) return;

    // All elements: deferred drag. Record start position.
    // < 3px on pointerup = click (emit selected). >= 3px on pointermove = drag.
    const isAbsConverted = target.hasAttribute("data-ppt-layout-converted");
    const computed = isAbsConverted ? null : getComputedStyle(target);
    const baseX = isAbsConverted
      ? parseFloat(target.style.left || "0")
      : parsePx(target.style.getPropertyValue("--ppt-drag-x") || computed.getPropertyValue("--ppt-drag-x"));
    const baseY = isAbsConverted
      ? parseFloat(target.style.top || "0")
      : parsePx(target.style.getPropertyValue("--ppt-drag-y") || computed.getPropertyValue("--ppt-drag-y"));
    const elementTag = target.tagName ? target.tagName.toLowerCase() : "";
    dragPendingState = {
      target,
      selector,
      elementTag,
      startClientX: event.clientX,
      startClientY: event.clientY,
      baseX,
      baseY,
    };
    event.preventDefault();
    event.stopPropagation();
  };

  const onPointerUp = (event) => {
    // Click (< 3px movement): select visually, double-click opens editing panel
    if (dragPendingState) {
      const s = dragPendingState;
      dragPendingState = null;
      const now = Date.now();
      // Always select on click (show overlay + handles for resize)
      setSelected(s.target);
      if (
        s.target === lastClickTarget &&
        s.selector === lastClickSelector &&
        now - lastClickTime < DBLCLICK_MS
      ) {
        // Double-click: also emit to host (opens editing panel)
        emitSelected(s.target, s.selector);
        lastClickTime = 0;
        lastClickTarget = null;
        lastClickSelector = null;
      } else {
        // Single click: visual select only, record for double-click detection
        lastClickTime = now;
        lastClickTarget = s.target;
        lastClickSelector = s.selector;
      }
      return;
    }

    if (pendingAnchorState) {
      try {
        event.target?.releasePointerCapture?.(event.pointerId);
      } catch (_error) {}
      pendingAnchorState = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (resizeState) {
      if (frameId) {
        cancelAnimationFrame(frameId);
        applyPendingResize();
      }
      const target = resizeState.target;
      const isAbsUp = target.hasAttribute("data-ppt-layout-converted");
      // For absolute elements: payload.x = displacement (same semantics as translate offset)
      // For translate elements: payload.x = the translate offset
      let nextX, nextY;
      if (isAbsUp) {
        const currentLeft = parseFloat(target.style.left || "0");
        const currentTop = parseFloat(target.style.top || "0");
        nextX = currentLeft - resizeState.baseX;
        nextY = currentTop - resizeState.baseY;
      } else {
        nextX = parsePx(target.style.getPropertyValue("--ppt-drag-x"));
        nextY = parsePx(target.style.getPropertyValue("--ppt-drag-y"));
      }
      const nextWidth = parsePx(target.style.width) || resizeState.baseWidth;
      const nextHeight = parsePx(target.style.height) || resizeState.baseHeight;
      // For absolute: nextX is already displacement from baseX. For translate: nextX is the offset.
      const deltaX = isAbsUp ? nextX : (nextX - resizeState.baseX);
      const deltaY = isAbsUp ? nextY : (nextY - resizeState.baseY);
      const scale = nextWidth / resizeState.baseWidth;
      const affectsWidth = resizeState.dir.includes("w") || resizeState.dir.includes("e");
      const affectsHeight = resizeState.dir.includes("n") || resizeState.dir.includes("s");
      const childUpdates = resizeState.childItems.map((item) => ({
        path: item.path,
        width: affectsWidth ? parsePx(item.element.style.width) || undefined : undefined,
        height: affectsHeight ? parsePx(item.element.style.height) || undefined : undefined,
      })).filter((item) => item.width !== undefined || item.height !== undefined);
      try {
        event.target?.releasePointerCapture?.(event.pointerId);
      } catch (_error) {}
      target.style.willChange = "";
      resizeNestedCharts(target);
      updateOverlay();
      if (
        Math.abs(deltaX) >= 0.5 ||
        Math.abs(deltaY) >= 0.5 ||
        Math.abs(nextWidth - resizeState.baseWidth) >= 0.5 ||
        Math.abs(nextHeight - resizeState.baseHeight) >= 0.5
      ) {
        console.log(LOG_PREFIX + JSON.stringify({
          type: "moved",
          selector: resizeState.selector,
          label: resizeState.selector,
          elementTag: resizeState.elementTag,
          x: Number(nextX.toFixed(1)),
          y: Number(nextY.toFixed(1)),
          deltaX: Number(deltaX.toFixed(1)),
          deltaY: Number(deltaY.toFixed(1)),
          width: Number(nextWidth.toFixed(1)),
          height: Number(nextHeight.toFixed(1)),
          scale: Number(scale.toFixed(3)),
          childUpdates,
        }));
      }
      resizeState = null;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (!dragState) return;
    if (frameId) cancelAnimationFrame(frameId);
    // Always apply the latest pointer position — the last rAF may have
    // already fired (frameId === 0) while the pointer kept moving.
    pendingClientX = event.clientX;
    pendingClientY = event.clientY;
    applyPendingDrag();
    const target = dragState.target;
    const isAbsDrag = target.hasAttribute("data-ppt-layout-converted");
    // For absolute elements: payload.x = visual displacement from the position
    // at selection time. handleElementMoved computes visualX = originalCSSX + payload.x,
    // where originalCSSX = bounds.x (since translateX=0). So payload.x = currentViewportX - bounds.x.
    // For translate elements: payload.x = the translate offset directly.
    let nextX, nextY;
    if (isAbsDrag) {
      const dragRect = target.getBoundingClientRect();
      // baseX for absolute was stored as style.left (offsetParent-relative).
      // We need the viewport displacement: use rect delta from drag start.
      // dragState.baseX = initial style.left; applyPendingDrag set style.left = baseX + pointerDelta.
      // So the pointer delta = currentLeft - baseX = viewport displacement.
      const currentLeft = parseFloat(target.style.left || "0");
      const pointerDeltaX = currentLeft - dragState.baseX;
      const pointerDeltaY = parseFloat(target.style.top || "0") - dragState.baseY;
      // payload.x = displacement from selection-time viewport position
      // At selection time, translateX was 0 (cleared during conversion), so:
      // originalCSSX = bounds.x, and we want visualX = bounds.x + payload.x = currentViewportX
      // => payload.x = pointerDeltaX (the movement since drag start)
      nextX = pointerDeltaX;
      nextY = pointerDeltaY;
    } else {
      nextX = parsePx(target.style.getPropertyValue("--ppt-drag-x"));
      nextY = parsePx(target.style.getPropertyValue("--ppt-drag-y"));
    }
    const deltaX = isAbsDrag ? nextX : (nextX - dragState.baseX);
    const deltaY = isAbsDrag ? nextY : (nextY - dragState.baseY);
    try {
      target.releasePointerCapture?.(event.pointerId);
    } catch (_error) {}
    target.style.willChange = "";
    updateOverlay();
    if (rootHost && rootHost.style) rootHost.style.cursor = "move";
    if (cursorHost && cursorHost.style) cursorHost.style.cursor = "move";

    if (Math.abs(deltaX) >= 0.5 || Math.abs(deltaY) >= 0.5) {
      console.log(LOG_PREFIX + JSON.stringify({
        type: "moved",
        selector: dragState.selector,
        label: dragState.selector,
        elementTag: dragState.elementTag,
        x: Number(nextX.toFixed(1)),
        y: Number(nextY.toFixed(1)),
        deltaX: Number(deltaX.toFixed(1)),
        deltaY: Number(deltaY.toFixed(1)),
      }));
    }
    dragState = null;
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      console.log(LOG_PREFIX + JSON.stringify({ type: "exit" }));
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const setPreviewScale = (value) => {
    previewScaleValue = normalizeScale(value);
  };

  // --- Live update API (called by host via executeJavaScript) ---
  window.__pptEditModeLiveUpdate = (selector, patch) => {
    try {
      const el = document.querySelector(selector);
      if (!el) return;
      if (typeof patch.text === "string") {
        el.textContent = patch.text;
      }
      if (patch.style) {
        if (patch.style.color) el.style.setProperty("color", patch.style.color, "important");
        if (patch.style.fontSize) el.style.setProperty("font-size", patch.style.fontSize, "important");
        if (patch.style.fontWeight) el.style.setProperty("font-weight", patch.style.fontWeight, "important");
      }
    } catch (_error) {}
  };

  // Convert element to position:absolute on first layout edit ("browser-like").
  // Uses incremental approach (same as drag) to avoid coordinate system issues:
  // remember the last viewport position, compute delta, apply to style.left/top.
  window.__pptEditModeSetLayout = (selector, layout) => {
    try {
      const el = document.querySelector(selector);
      if (!el) return;
      // First edit: convert to position:absolute
      if (!el.hasAttribute("data-ppt-layout-converted")) {
        // 1. Record current visual position BEFORE changing position
        const rect = el.getBoundingClientRect();
        // 2. Set position:absolute first — this changes the offsetParent
        el.style.position = "absolute";
        // 3. Force synchronous reflow so offsetParent updates to the absolute context
        void el.offsetTop;
        // 4. Now read the NEW offsetParent (nearest positioned ancestor for absolute)
        const newOffsetParent = el.offsetParent;
        const newOffsetRect = newOffsetParent
          ? newOffsetParent.getBoundingClientRect()
          : { left: 0, top: 0 };
        // 5. Set left/top using pre-conversion visual position minus new offset
        el.style.left = (rect.left - newOffsetRect.left).toFixed(1) + "px";
        el.style.top = (rect.top - newOffsetRect.top).toFixed(1) + "px";
        el.style.width = Math.max(1, rect.width).toFixed(1) + "px";
        el.style.height = Math.max(1, rect.height).toFixed(1) + "px";
        el.style.zIndex = "10";
        // Clear translate mechanism
        el.style.translate = "";
        el.style.removeProperty("--ppt-drag-x");
        el.style.removeProperty("--ppt-drag-y");
        // Remember the current viewport position for delta-based updates
        el.setAttribute("data-ppt-last-vp-x", rect.left.toFixed(1));
        el.setAttribute("data-ppt-last-vp-y", rect.top.toFixed(1));
        el.setAttribute("data-ppt-layout-converted", "1");
      }
      // Incremental: compute delta from last known viewport position,
      // apply to current style.left/top (offsetParent-relative).
      // This mirrors how drag works — only relative changes, no coordinate conversion.
      if (layout.x !== undefined) {
        const lastVpX = parseFloat(el.getAttribute("data-ppt-last-vp-x") || "0");
        const delta = layout.x - lastVpX;
        const curLeft = parseFloat(el.style.left || "0");
        el.style.left = (curLeft + delta).toFixed(1) + "px";
        el.setAttribute("data-ppt-last-vp-x", layout.x.toFixed(1));
      }
      if (layout.y !== undefined) {
        const lastVpY = parseFloat(el.getAttribute("data-ppt-last-vp-y") || "0");
        const delta = layout.y - lastVpY;
        const curTop = parseFloat(el.style.top || "0");
        el.style.top = (curTop + delta).toFixed(1) + "px";
        el.setAttribute("data-ppt-last-vp-y", layout.y.toFixed(1));
      }
      if (layout.width !== undefined) el.style.width = Math.max(1, layout.width).toFixed(1) + "px";
      if (layout.height !== undefined) el.style.height = Math.max(1, layout.height).toFixed(1) + "px";
      updateOverlay();
    } catch (_error) {}
  };

  window.__pptEditModeClearSelection = () => {
    if (selectedElement) {
      selectedElement.classList.remove(SELECTED_CLASS);
      selectedElement = null;
    }
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }
    if (overlayElement) {
      overlayElement.remove();
      overlayElement = null;
    }
  };

  window.__pptEditModeSetPreviewScale = setPreviewScale;

  // --- Cleanup ---
  const cleanup = () => {
    document.removeEventListener("pointermove", onPointerMove, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("pointercancel", onPointerUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    clearVisualState();
    if (overlayResizeObserver) {
      overlayResizeObserver.disconnect();
      overlayResizeObserver = null;
    }
    if (frameId) {
      cancelAnimationFrame(frameId);
      frameId = 0;
    }
    if (overlayElement) overlayElement.remove();
    overlayElement = null;
    resizeState = null;
    pendingAnchorState = null;
    dragPendingState = null;
    delete window.__pptResolveEditModeAnchor;
    delete window.__pptEditModeLiveUpdate;
    delete window.__pptEditModeSetLayout;
    delete window.__pptEditModeClearSelection;
    delete window.__pptEditModeSetPreviewScale;
    const style = document.getElementById(STYLE_ID);
    if (style) style.remove();
    if (cursorHost && cursorHost.style) {
      cursorHost.style.cursor = previousCursor || "";
    }
    if (rootHost && rootHost.style) {
      rootHost.style.cursor = previousRootCursor || "";
    }
    delete window[STATE_KEY];
  };

  document.addEventListener("pointermove", onPointerMove, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("pointercancel", onPointerUp, true);
  document.addEventListener("keydown", onKeyDown, true);

  window[STATE_KEY] = { active: true, cleanup, setPreviewScale };
})();
`
}

export function buildEditModeSetPreviewScaleScript(previewScale: number): string {
  const normalizedScale =
    Number.isFinite(previewScale) && previewScale > 0 ? Number(previewScale.toFixed(4)) : 1;
  return `
(() => {
  const value = ${JSON.stringify(normalizedScale)};
  if (typeof window.__pptEditModeSetPreviewScale === "function") {
    window.__pptEditModeSetPreviewScale(value);
    return;
  }
  const state = window.__pptEditModeState;
  if (state && typeof state.setPreviewScale === "function") {
    state.setPreviewScale(value);
  }
})();
`;
}

export function buildEditModeCleanupScript(): string {
  return `
(() => {
  const STATE_KEY = "__pptEditModeState";
  const state = window[STATE_KEY];
  if (state && typeof state.cleanup === "function") {
    state.cleanup();
  } else {
    delete window[STATE_KEY];
  }
})();
`
}
