import type { WatermarkConfig, WatermarkPreset } from '../shared'
import { defaultWatermark } from './render'
import { clampNumber } from './layout'

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
  if (!window.fanhua) throw new Error('水印存档仅在 Windows 桌面版中可用。')
  return window.fanhua.listWatermarkPresets()
}

export async function savePreset(name: string, config: WatermarkConfig, id?: string): Promise<WatermarkPreset> {
  const normalized = name.trim().slice(0, 60)
  if (!normalized) throw new Error('请填写水印存档名称')
  const plain = plainWatermark(config)
  if (!window.fanhua) throw new Error('水印存档仅在 Windows 桌面版中可用。')
  return window.fanhua.saveWatermarkPreset({ ...(id ? { id } : {}), name: normalized, config: plain })
}

export async function deletePreset(id: string): Promise<void> {
  if (!window.fanhua) throw new Error('水印存档仅在 Windows 桌面版中可用。')
  return window.fanhua.deleteWatermarkPreset(id)
}
