import type { WatermarkConfig, WatermarkPreset } from '../shared'
import { defaultWatermark } from './render'
import { clampNumber } from './layout'

const storageKey = 'fanhua:watermark-presets:v1'
const placements = ['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right', 'tile']

/** Explicitly copy scalar fields so no Vue proxy crosses the Electron bridge. */
export function plainWatermark(value: WatermarkConfig): WatermarkConfig {
  const defaults = defaultWatermark()
  return {
    enabled: Boolean(value.enabled), kind: value.kind === 'image' ? 'image' : 'text',
    text: String(value.text ?? '').slice(0, 2000), font: String(value.font ?? defaults.font).slice(0, 200),
    fontSize: clampNumber(Number(value.fontSize), 8, 240, defaults.fontSize),
    color: /^#[a-f\d]{6}$/i.test(value.color) ? value.color : defaults.color,
    imageDataUrl: String(value.imageDataUrl ?? ''),
    imageWidth: clampNumber(Number(value.imageWidth), 0, 8192), imageHeight: clampNumber(Number(value.imageHeight), 0, 8192),
    scale: clampNumber(Number(value.scale), .05, 4, defaults.scale),
    placement: placements.includes(value.placement) ? value.placement : defaults.placement,
    opacity: clampNumber(Number(value.opacity), 0, 1, defaults.opacity),
    rotation: clampNumber(Number(value.rotation), -180, 180), margin: clampNumber(Number(value.margin), 0, 1000, defaults.margin),
    spacing: clampNumber(Number(value.spacing), 0, 1000, defaults.spacing),
  }
}

export async function listPresets(): Promise<WatermarkPreset[]> {
  if (window.fanhua) return window.fanhua.listWatermarkPresets()
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is WatermarkPreset => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.name === 'string' && item.config)).slice(0, 30).map(item => ({ ...item, config: plainWatermark(item.config) }))
  } catch { throw new Error('无法读取水印存档，请检查浏览器本地存储') }
}

export async function savePreset(name: string, config: WatermarkConfig, id?: string): Promise<WatermarkPreset> {
  const normalized = name.trim().slice(0, 60)
  if (!normalized) throw new Error('请填写水印存档名称')
  const plain = plainWatermark(config)
  if (window.fanhua) return window.fanhua.saveWatermarkPreset({ ...(id ? { id } : {}), name: normalized, config: plain })
  const current = await listPresets()
  const index = id ? current.findIndex(item => item.id === id) : -1
  if (id && index < 0) throw new Error('该水印存档已不存在，请另存为新存档')
  if (index < 0 && current.length >= 30) throw new Error('最多保存 30 个水印存档，请先删除不用的存档')
  const preset = { id: id || crypto.randomUUID(), name: normalized, config: plain, updatedAt: new Date().toISOString() }
  if (index < 0) current.unshift(preset)
  else current[index] = preset
  try { localStorage.setItem(storageKey, JSON.stringify(current)) }
  catch { throw new Error('本地存储空间不足，水印存档未保存') }
  return preset
}

export async function deletePreset(id: string): Promise<void> {
  if (window.fanhua) return window.fanhua.deleteWatermarkPreset(id)
  const current = await listPresets()
  try { localStorage.setItem(storageKey, JSON.stringify(current.filter(item => item.id !== id))) }
  catch { throw new Error('无法删除水印存档，请稍后重试') }
}
