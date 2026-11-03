export const shortcutModifiers = [
  { value: 'Ctrl', label: 'Ctrl' },
  { value: 'Alt', label: 'Alt' },
  { value: 'Shift', label: 'Shift' },
  { value: 'Super', label: 'Win' },
] as const

export const shortcutKeys = [
  ...Array.from({ length: 26 }, (_, index) => String.fromCharCode(65 + index)),
  ...Array.from({ length: 10 }, (_, index) => String(index)),
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  'Space', 'Tab', 'Enter', 'Backspace', 'Insert', 'Delete', 'Home', 'End',
  'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'PrintScreen',
]

const keyDescriptions: Record<string, string> = {
  Space: '空格', Tab: '制表键', Enter: '回车', Backspace: '退格', Insert: '插入', Delete: '删除',
  Home: '行首', End: '行尾', PageUp: '向上翻页', PageDown: '向下翻页',
  Up: '上方向键', Down: '下方向键', Left: '左方向键', Right: '右方向键', PrintScreen: '屏幕打印键',
}
export const shortcutKeyOptions = shortcutKeys.map(value => ({ value, label: keyDescriptions[value] ? `${value} · ${keyDescriptions[value]}` : value }))

export function formatCaptureShortcut(value: string) {
  return value.split('+').map(part => part === 'Super' ? 'Win' : part).join(' + ')
}

export function splitCaptureShortcut(value: string) {
  const parts = value.split('+')
  const key = parts.at(-1) || 'A'
  return { modifiers: shortcutModifiers.filter(item => parts.slice(0, -1).includes(item.value)).map(item => item.value as string), key }
}

export function buildCaptureShortcut(modifiers: string[], key: string) {
  return [...shortcutModifiers.filter(item => modifiers.includes(item.value)).map(item => item.value), key].join('+')
}

export function captureShortcutWarning(modifiers: string[], key: string) {
  if (!shortcutKeys.includes(key)) return '请选择列表中的主键。'
  if (!/^(?:F(?:[1-9]|1\d|2[0-4])|PrintScreen)$/.test(key) && !modifiers.some(value => ['Ctrl', 'Alt', 'Super'].includes(value))) {
    return '字母、数字和导航键需搭配 Ctrl、Alt 或 Win。'
  }
  return ''
}
