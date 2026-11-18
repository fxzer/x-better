/**
 * 生成全扩展统一的极细淡灰半透明滚动条样式。
 * 显式重置 scrollbar-width / scrollbar-color 为 auto，阻断从 X.com 根节点继承的
 * scrollbar-color，从而让 ::-webkit-scrollbar 在 Chromium 中稳定生效，避免
 * macOS Chrome 原生标准滚动条在 hover 时强制变深。
 */
export function buildThinScrollbarCss(selectors: string[]): string {
  const normalized = selectors.map((s) => s.trim()).filter(Boolean)
  if (normalized.length === 0) return ''

  const baseSelectors = normalized.join(',\n')
  const webkitScrollbar = normalized.map((s) => `${s}::-webkit-scrollbar`).join(',\n')
  const webkitTrack = normalized.map((s) => `${s}::-webkit-scrollbar-track`).join(',\n')
  const webkitThumb = normalized.map((s) => `${s}::-webkit-scrollbar-thumb`).join(',\n')
  const webkitContainerHoverThumb = normalized
    .map((s) => `${s}:hover::-webkit-scrollbar-thumb`)
    .join(',\n')
  const webkitThumbHover = normalized
    .map((s) => `${s}::-webkit-scrollbar-thumb:hover`)
    .join(',\n')

  return `
${baseSelectors} {
  scrollbar-width: auto !important;
  scrollbar-color: auto !important;
}
${webkitScrollbar} {
  width: 5px !important;
  height: 5px !important;
}
${webkitTrack} {
  background: transparent !important;
}
${webkitThumb} {
  background: rgba(150, 150, 150, 0.2) !important;
  border-radius: 9999px !important;
}
${webkitContainerHoverThumb} {
  background: rgba(150, 150, 150, 0.26) !important;
}
${webkitThumbHover} {
  background: rgba(150, 150, 150, 0.34) !important;
}
`
}
