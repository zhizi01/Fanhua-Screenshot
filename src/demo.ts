import type { CaptureContext, Screenshot } from './shared'

export function getDemoScreenshot(): Screenshot {
  try {
    const saved = sessionStorage.getItem('fanhua:demo-screenshot')
    if (saved) {
      const parsed = JSON.parse(saved) as Screenshot
      if (parsed.dataUrl?.startsWith('data:image/png;') && parsed.width > 0 && parsed.height > 0) return parsed
    }
  } catch { /* A demo should remain usable when storage is disabled. */ }
  const canvas = document.createElement('canvas')
  canvas.width = 1280
  canvas.height = 800
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#eeeaf3'
  ctx.fillRect(0, 0, 1280, 800)
  ctx.fillStyle = '#fcfbfe'
  ctx.beginPath()
  ctx.roundRect(100, 70, 1080, 660, 18)
  ctx.fill()
  ctx.fillStyle = '#f4f1f8'
  ctx.fillRect(100, 122, 216, 608)
  ;['#e79491', '#e4c67a', '#9bc4a2'].forEach((color, i) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(128 + i * 20, 96, 5, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.fillStyle = '#87808f'
  ctx.font = '16px "Microsoft YaHei UI", sans-serif'
  ctx.fillText('灵感手记 / 周末计划', 352, 101)
  ctx.fillStyle = '#7860d2'
  ctx.font = 'bold 21px "Microsoft YaHei UI", sans-serif'
  ctx.fillText('我的灵感', 128, 182)
  ctx.fillStyle = '#88808f'
  ctx.font = '16px "Microsoft YaHei UI", sans-serif'
  ;['所有笔记', '生活碎片', '工作灵感', '旅行清单'].forEach((text, i) => ctx.fillText(text, 132, 246 + i * 52))
  ctx.fillStyle = '#34303d'
  ctx.font = 'bold 40px "Microsoft YaHei UI", sans-serif'
  ctx.fillText('把日子过成喜欢的样子', 366, 244)
  ctx.fillStyle = '#90879b'
  ctx.font = '18px "Microsoft YaHei UI", sans-serif'
  ctx.fillText('留一点时间，收集生活里的小美好。', 366, 292)
  ctx.fillStyle = '#e8e4f1'
  ctx.beginPath()
  ctx.roundRect(366, 336, 734, 214, 12)
  ctx.fill()
  ctx.fillStyle = '#d0c6e7'
  ctx.beginPath()
  ctx.arc(1000, 402, 40, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#c1b6d9'
  ctx.beginPath()
  ctx.moveTo(366, 550)
  ctx.lineTo(600, 384)
  ctx.lineTo(798, 550)
  ctx.fill()
  ctx.fillStyle = '#a79abf'
  ctx.beginPath()
  ctx.moveTo(650, 550)
  ctx.lineTo(890, 420)
  ctx.lineTo(1100, 550)
  ctx.fill()
  ctx.fillStyle = '#6f667c'
  ctx.font = '18px "Microsoft YaHei UI", sans-serif'
  ctx.fillText('01  去公园散散步，看看秋天的颜色', 366, 606)
  ctx.fillText('02  拍一张喜欢的照片，分享给朋友', 366, 650)
  return { id: 'demo', dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height, createdAt: new Date().toISOString() }
}

export function getDemoCaptureContext(): CaptureContext {
  const screenshot = getDemoScreenshot()
  const width = window.innerWidth
  const height = window.innerHeight
  return { displayId: 1, dataUrl: screenshot.dataUrl, width, height, pixelWidth: screenshot.width, pixelHeight: screenshot.height,
    windows: [{ id: 'demo-note', title: '灵感手记 · 演示窗口', x: width * 100 / 1280, y: height * 70 / 800, width: width * 1080 / 1280, height: height * 660 / 800 }], windowDetectionAvailable: true }
}
