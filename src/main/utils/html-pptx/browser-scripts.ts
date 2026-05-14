export const FREEZE_PAGE_FOR_EXPORT_SCRIPT = `
(async () => {
  const root =
    document.querySelector('.ppt-page-root[data-ppt-guard-root="1"]') ||
    document.querySelector('.ppt-page-root') ||
    document.body;
  const existing = document.getElementById('ohmyppt-export-freeze-page');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'ohmyppt-export-freeze-page';
  style.textContent = [
    'html { scroll-behavior: auto !important; }',
    '*, *::before, *::after { animation: none !important; transition: none !important; animation-delay: 0s !important; animation-duration: 0s !important; animation-play-state: paused !important; transition-delay: 0s !important; transition-duration: 0s !important; }',
    '.opacity-0, [data-anime], [data-animate] { opacity: 1 !important; transform: none !important; }'
  ].join('\\n');
  document.head.appendChild(style);

  try {
    document.getAnimations?.().forEach((animation) => {
      try {
        animation.finish();
      } catch (_err) {
        try {
          animation.cancel();
        } catch (_cancelErr) {}
      }
    });
  } catch (_err) {}

  const motionTargets = root.querySelectorAll(
    '.opacity-0, [data-anime], [data-animate], h1, h2, h3, p, li, .card, .panel, .text-section, .diagram-section, .timeline-node, section, section > *'
  );
  motionTargets.forEach((element) => {
    const node = element;
    node.style.transition = 'none';
    node.style.animation = 'none';
    if (Number(getComputedStyle(node).opacity || '1') < 0.98) {
      node.setAttribute('data-pptx-animated', '1');
      node.style.opacity = '1';
    }
    if (/translateY\\([^)]*\\)/.test(node.style.transform || '')) {
      node.setAttribute('data-pptx-animated', '1');
      node.style.transform = 'none';
    }
  });

  root.querySelectorAll('*').forEach((element) => {
    const node = element;
    const computed = getComputedStyle(node);
    if (computed.display === 'none' || computed.visibility === 'hidden') return;
    if (Number(computed.opacity || '1') < 0.98) {
      node.setAttribute('data-pptx-animated', '1');
      node.style.opacity = '1';
    }
    if (/translate(?:3d|X|Y)?\\(/.test(node.style.transform || '')) {
      node.setAttribute('data-pptx-animated', '1');
      node.style.transform = 'none';
    }
  });

  const scope = root.querySelector?.(':scope > .ppt-page-fit-scope');
  if (scope) scope.style.transform = 'scale(1)';
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_err) {}
  }
  return true;
})()
`

export const FREEZE_PAGE_FOR_PPTX_SCRIPT = FREEZE_PAGE_FOR_EXPORT_SCRIPT

export const HIDE_TEXT_FOR_PPTX_BACKGROUND_SCRIPT = `
(async () => {
  const existing = document.getElementById('ohmyppt-pptx-hide-text');
  if (existing) existing.remove();
  const isVisibleColor = (value) => {
    const color = String(value || '').trim().toLowerCase();
    return Boolean(color && color !== 'transparent' && !/^rgba?\\([^)]*,\\s*0\\s*\\)$/.test(color));
  };
  const resolveVisibleTextColor = (element) => {
    let current = element;
    while (current && current.nodeType === 1) {
      const color = getComputedStyle(current).color;
      if (isVisibleColor(color)) return color;
      current = current.parentElement;
    }
    return '#111827';
  };
  const style = document.createElement('style');
  style.id = 'ohmyppt-pptx-hide-text';
  style.textContent = [
    'body :not(.katex):not(.katex *):not(canvas) { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }',
    'body :not(.katex):not(.katex *)::before, body :not(.katex):not(.katex *)::after { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }',
    '.katex, .katex * { -webkit-text-fill-color: currentColor !important; text-shadow: none !important; }',
    'svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }',
    'input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  document.querySelectorAll('.katex').forEach((element) => {
    const node = element;
    const color = resolveVisibleTextColor(node);
    node.style.color = color;
    node.style.webkitTextFillColor = color;
    node.style.fontFamily = 'KaTeX_Main, "Times New Roman", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif';
  });
  const hideTextPaint = (node) => {
    node.style.setProperty('-webkit-text-fill-color', 'transparent', 'important');
    node.style.setProperty('-webkit-text-stroke-color', 'transparent', 'important');
    node.style.setProperty('text-shadow', 'none', 'important');
    node.style.setProperty('text-decoration-color', 'transparent', 'important');
    node.style.setProperty('caret-color', 'transparent', 'important');
  };
  const hasOwnTextNode = (element) =>
    Array.from(element.childNodes || []).some((node) => node.nodeType === Node.TEXT_NODE && String(node.textContent || '').trim());
  document.querySelectorAll('body *').forEach((element) => {
    if (element.closest('.katex, .katex-mathml, script, style, noscript, canvas')) return;
    if (hasOwnTextNode(element)) hideTextPaint(element);
  });
  document.querySelectorAll('svg text, svg tspan').forEach((element) => {
    element.style.setProperty('fill', 'transparent', 'important');
    element.style.setProperty('stroke', 'transparent', 'important');
  });
  void document.body.offsetHeight;
  if (document.fonts?.ready) {
    try {
      await document.fonts.ready;
    } catch (_err) {}
  }
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

// Background capture for PPTX: keep animated elements ([data-pptx-animated] set by freeze),
// decorative elements (blur blobs), and SVGs visible.
// Hide text and non-animated shapes/images (which are extracted separately).
export const HIDE_FOR_PPTX_BACKGROUND_SCRIPT = `
(async () => {
  // 1. Mark additional decorative elements (blur blobs, glass-morphism, very low Tailwind opacity)
  const root = document.querySelector('.ppt-page-root') || document.body;
  root.querySelectorAll('*').forEach((el) => {
    if (el.hasAttribute('data-pptx-animated')) return;
    const style = getComputedStyle(el);
    const hasBlur = /blur/i.test(style.filter || '') || /blur/i.test(style.backdropFilter || '');
    const cls = el.className && typeof el.className === 'string' ? el.className : '';
    const hasDecoClass = /\\b(opacity-[012]0|opacity-[12]5)\\b/.test(cls) || /\\bblur-(sm|md|lg|xl|2xl|3xl)\\b/.test(cls);
    if (hasBlur || hasDecoClass) {
      el.setAttribute('data-pptx-animated', '1');
    }
  });

  // 2. Remove previous style
  const existing = document.getElementById('ohmyppt-pptx-hide-elements');
  if (existing) existing.remove();

  // 3. CSS: keep [data-pptx-animated] and SVGs visible, hide text + non-animated shapes/images
  const style = document.createElement('style');
  style.id = 'ohmyppt-pptx-hide-elements';
  style.textContent = [
    'img:not([data-pptx-animated]), canvas:not([data-pptx-animated]) { opacity: 0 !important; visibility: hidden !important; }',
    'section:not([data-pptx-animated]), main:not([data-pptx-animated]), article:not([data-pptx-animated]), header:not([data-pptx-animated]), footer:not([data-pptx-animated]), aside:not([data-pptx-animated]), div:not([data-pptx-animated]), figure:not([data-pptx-animated]), figcaption:not([data-pptx-animated]), table:not([data-pptx-animated]), td:not([data-pptx-animated]), th:not([data-pptx-animated]) { background-color: transparent !important; border-color: transparent !important; }',
    'body :not(.katex):not(.katex *):not(canvas):not([data-pptx-animated]) { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }',
    'body :not(.katex):not(.katex *)::before, body :not(.katex):not(.katex *)::after { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }',
    '.katex, .katex * { -webkit-text-fill-color: currentColor !important; text-shadow: none !important; }',
    'svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }',
    'input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

export const HIDE_ELEMENTS_FOR_PPTX_BACKGROUND_SCRIPT = `
(async () => {
  let existing = document.getElementById('ohmyppt-pptx-hide-elements');
  if (existing) existing.remove();
  const style = document.createElement('style');
  style.id = 'ohmyppt-pptx-hide-elements';
  style.textContent = [
    'img, canvas { opacity: 0 !important; visibility: hidden !important; }',
    'svg { opacity: 0 !important; visibility: hidden !important; }',
    'section, main, article, header, footer, aside, div, figure, figcaption, table, td, th { background-color: transparent !important; border-color: transparent !important; }',
    'body :not(.katex):not(.katex *):not(canvas) { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; caret-color: transparent !important; }',
    'body :not(.katex):not(.katex *)::before, body :not(.katex):not(.katex *)::after { -webkit-text-fill-color: transparent !important; -webkit-text-stroke-color: transparent !important; text-shadow: none !important; text-decoration-color: transparent !important; }',
    '.katex, .katex * { -webkit-text-fill-color: currentColor !important; text-shadow: none !important; }',
    'svg text, svg tspan { fill: transparent !important; stroke: transparent !important; }',
    'input, textarea { color: transparent !important; -webkit-text-fill-color: transparent !important; }'
  ].join('\\n');
  document.head.appendChild(style);
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  return true;
})()
`

export const WAIT_FOR_PPTX_CAPTURE_FRAME_SCRIPT = `
(async () => {
  void document.body.offsetHeight;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  void document.body.offsetHeight;
  return true;
})()
`
