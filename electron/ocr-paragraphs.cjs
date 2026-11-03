'use strict'

function normalizeText(text) {
  // Windows OCR inserts spaces between CJK characters; preserve English spaces.
  return text.trim().replace(/([\p{Script=Han}])\s+(?=[\p{Script=Han}])/gu, '$1')
}

function clipLine(input, width, height) {
  if (!input || typeof input.text !== 'string' || !input.text.trim() || !input.bounds) return null
  const b = input.bounds
  if (!['x', 'y', 'width', 'height'].every(key => Number.isFinite(b[key])) || b.width <= 0 || b.height <= 0) return null
  const left = Math.max(0, b.x), top = Math.max(0, b.y)
  const right = Math.min(width, b.x + b.width), bottom = Math.min(height, b.y + b.height)
  if (right <= left || bottom <= top) return null
  return { text: normalizeText(input.text), bounds: { x: left, y: top, width: right - left, height: bottom - top } }
}

function unionBounds(lines) {
  const left = Math.min(...lines.map(line => line.bounds.x)), top = Math.min(...lines.map(line => line.bounds.y))
  return {
    x: left, y: top,
    width: Math.max(...lines.map(line => line.bounds.x + line.bounds.width)) - left,
    height: Math.max(...lines.map(line => line.bounds.y + line.bounds.height)) - top,
  }
}
const lineOrder = (a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x
const lineKey = line => JSON.stringify([line.text, line.bounds.x, line.bounds.y, line.bounds.width, line.bounds.height])

/** Some OCR page segmentation combines two columns into the same line. Keep
 * ordinary engine paragraphs, but split unmistakable gutters between words. */
function splitWordGaps(line) {
  if (!Array.isArray(line?.words) || line.words.length < 2) return [line]
  const words = line.words.filter(word => word && typeof word.text === 'string' && word.text.trim()
    && word.bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(word.bounds[key]))
    && word.bounds.width > 0 && word.bounds.height > 0).sort((a, b) => a.bounds.x - b.bounds.x)
  if (words.length < 2) return [line]
  const heights = words.map(word => word.bounds.height).sort((a, b) => a - b)
  const gaps = words.slice(1).map((word, index) => Math.max(0, word.bounds.x - words[index].bounds.x - words[index].bounds.width)).sort((a, b) => a - b)
  const usualGap = gaps[Math.floor((gaps.length - 1) / 2)]
  const threshold = Math.max(heights[Math.floor(heights.length / 2)] * 1.8, usualGap * 3.5)
  const fragments = [[words[0]]]
  for (const [index, word] of words.slice(1).entries()) {
    const previous = words[index]
    if (word.bounds.x - previous.bounds.x - previous.bounds.width > threshold) fragments.push([])
    fragments[fragments.length - 1].push(word)
  }
  if (fragments.length === 1) return [line]
  return fragments.map(fragment => ({ text: normalizeText(fragment.map(word => word.text).join(' ')), bounds: unionBounds(fragment) }))
}

function prepareOcrLayout(result) {
  let split = false
  const lines = (Array.isArray(result.lines) ? result.lines : []).flatMap(line => {
    const fragments = splitWordGaps(line)
    if (fragments.length > 1) split = true
    return fragments
  })
  // A fused multi-column line means the engine paragraph segmentation is also
  // unreliable. Re-infer from fragments, including short continuation lines.
  return { lines, paragraphs: split ? undefined : result.paragraphs }
}

function continuationScore(group, line) {
  const previous = group.lines[group.lines.length - 1].bounds, current = line.bounds
  const h = Math.min(previous.height, current.height)
  const heightRatio = Math.max(previous.height, current.height) / h
  const gap = current.y - previous.y - previous.height
  if (heightRatio > 1.4 || gap < -h * .25 || gap > h * .95) return Infinity
  const overlap = Math.min(previous.x + previous.width, current.x + current.width) - Math.max(previous.x, current.x)
  if (overlap < Math.min(previous.width, current.width) * .5) return Infinity
  const dx = current.x - previous.x
  // A new indented first line starts a paragraph. Its following flush-left line
  // can join it; the opposite direction must not merge consecutive paragraphs.
  const leftAligned = Math.abs(dx) <= h * .8
    || (group.lines.length === 1 && dx < 0 && Math.abs(dx) <= h * 2.6)
  const centered = Math.abs(previous.x + previous.width / 2 - current.x - current.width / 2) <= h * .4
    && Math.abs(dx) > h * 2.6
  if (!leftAligned && !centered) return Infinity
  return Math.max(0, gap) / h + Math.min(Math.abs(dx), h) / h * .2 + (heightRatio - 1) * .5
}

/** Windows only supplies lines, so infer paragraphs from typography and gaps. */
function inferGroups(lines) {
  const groups = []
  let active = []
  for (const line of [...lines].sort(lineOrder)) {
    active = active.filter(group => {
      const b = group.lines[group.lines.length - 1].bounds
      return b.y + b.height >= line.bounds.y - Math.max(100, line.bounds.height * 2.5)
    })
    let nearest, best = Infinity
    for (const group of active) {
      const score = continuationScore(group, line)
      if (score < best) { nearest = group; best = score }
    }
    if (nearest) nearest.lines.push(line)
    else { const group = { lines: [line] }; groups.push(group); active.push(group) }
  }
  return groups
}

function widestGap(groups, axis, minimum, first = false) {
  const dimension = axis === 'x' ? 'width' : 'height'
  const ranges = groups.map(group => [group.bounds[axis], group.bounds[axis] + group.bounds[dimension]]).sort((a, b) => a[0] - b[0])
  let end = ranges[0][1], best = null
  for (const range of ranges.slice(1)) {
    const gap = range[0] - end
    if (first && gap >= minimum) return { size: gap, cut: end + gap / 2 }
    if (gap >= minimum && (!best || gap > best.size)) best = { size: gap, cut: end + gap / 2 }
    end = Math.max(end, range[1])
  }
  return best
}

/** Whitespace cuts keep newspaper-style columns together, including a title
 * spanning both columns. If there is no clear gutter, use top-to-bottom order. */
function readingOrder(groups, typicalHeight, depth = 0) {
  if (groups.length < 2) return groups
  if (depth > 32) return [...groups].sort(lineOrder)
  const horizontal = widestGap(groups, 'x', typicalHeight * 1.2)
  // Isolate a spanning title before scanning the body for column gutters.
  const vertical = horizontal ? null : widestGap(groups, 'y', typicalHeight * .35, true)
  const split = horizontal || vertical
  if (!split) return [...groups].sort(lineOrder)
  const axis = horizontal ? 'x' : 'y'
  const before = [], after = []
  for (const group of groups) (group.bounds[axis] < split.cut ? before : after).push(group)
  return [...readingOrder(before, typicalHeight, depth + 1), ...readingOrder(after, typicalHeight, depth + 1)]
}

/** Input lines have already been deduplicated and clipped. Engine paragraphs
 * take precedence; unmatched lines still get a spatially inferred paragraph. */
function buildParagraphs(lines, width, height, engineParagraphs) {
  if (!lines.length) return []
  const hints = new Map()
  for (const [index, paragraph] of (Array.isArray(engineParagraphs) ? engineParagraphs : []).entries()) {
    for (const raw of Array.isArray(paragraph?.lines) ? paragraph.lines : []) {
      const line = clipLine(raw, width, height)
      if (line && !hints.has(lineKey(line))) hints.set(lineKey(line), index)
    }
  }
  const hinted = new Map(), remaining = []
  for (const line of lines) {
    const hint = hints.get(lineKey(line))
    if (hint === undefined) remaining.push(line)
    else {
      if (!hinted.has(hint)) hinted.set(hint, { lines: [] })
      hinted.get(hint).lines.push(line)
    }
  }
  const groups = [...hinted.values(), ...inferGroups(remaining)].map(group => {
    const ordered = [...group.lines].sort(lineOrder)
    return { lines: ordered, bounds: unionBounds(ordered), text: ordered.map(line => line.text).join('\n') }
  })
  const heights = lines.map(line => line.bounds.height).sort((a, b) => a - b)
  const ordered = readingOrder(groups, heights[Math.floor(heights.length / 2)])
  return ordered.map((paragraph, index) => ({ id: `ocr-paragraph-${index + 1}`, ...paragraph }))
}

module.exports = { normalizeText, clipLine, buildParagraphs, prepareOcrLayout }
