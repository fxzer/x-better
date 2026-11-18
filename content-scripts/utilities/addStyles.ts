import { removeElementById } from './removeElement'

export default function addStyles(id: string, css: string) {
  const styleId = 'xf-style-' + id
  const textContent = css.trim().split('\n').join('')
  // 幂等：已存在且内容一致时直接复用，避免高频路径反复删插 <style>
  // 触发全页样式重算（Style Recalculation）
  const existing = document.getElementById(styleId)
  if (existing && existing.textContent === textContent) return existing
  removeElementById(styleId)
  const head = document.querySelector('head')
  const style = document.createElement('style')
  style.id = styleId
  style.textContent = textContent
  head!.appendChild(style)
  return style
}

export function removeStyles(id: string) {
  removeElementById('xf-style-' + id)
}

export function stylesExist(id: string) {
  return document.getElementById('xf-style-' + id)
}
