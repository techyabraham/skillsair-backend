/**
 * Subtitles: SRT files from Google Drive become WebVTT captions and a plain-text transcript.
 * Pure functions (no I/O), so they're unit-tested in captions.test.ts.
 */

export interface Cue {
  start: number
  end: number
  text: string
}

export interface TranscriptLine {
  start: number
  text: string
}

const TIME = /(?:(\d{1,2}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/
const TIMING = new RegExp(`${TIME.source}\\s*-->\\s*${TIME.source}`)

function seconds(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** Cue text without formatting tags, positioning codes or stray whitespace. */
export function cleanCueText(text: string): string {
  return text
    .replace(/\{\\[^}]*\}/g, '') // ASS/SSA codes such as {\an8}
    .replace(/<[^>]+>/g, '') // <i>, <font color=…>, <b>…
    .replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
}

const URL_ONLY = /^(?:(?:https?:\/\/|www\.)\S+|[\w-]+(?:\.[\w-]+)*\.(?:com|net|org|io|info|me|co|ng|xyz|site|online)(?:\/\S*)?)$/i

/** Promotional cues that are nothing but a web address ("www.example.com"). */
export function isUrlOnly(text: string): boolean {
  const words = text.split(/\s+/).map((word) => word.replace(/^[([{"']+|[)\]}"'.,!?:;]+$/g, '')).filter(Boolean)
  return words.length > 0 && words.every((word) => URL_ONLY.test(word))
}

/** Parses SRT (tolerant of missing numbers, CRLF, "." or "," milliseconds and blank-line noise). */
export function parseSrt(input: string): Cue[] {
  // Line endings: \n, \r\n, old-Mac \r, and the doubled \r\r\n some converted files have.
  const text = input.replace(/^﻿/, '').replace(/\r+\n?/g, '\n')
  const cues: Cue[] = []
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n').map((line) => line.trimEnd())
    const timingIndex = lines.findIndex((line) => TIMING.test(line))
    if (timingIndex < 0) continue
    const match = TIMING.exec(lines[timingIndex] ?? '')
    if (!match) continue
    const start = seconds(match[1], match[2] ?? '0', match[3] ?? '0', match[4] ?? '0')
    const end = seconds(match[5], match[6] ?? '0', match[7] ?? '0', match[8] ?? '0')
    const body = cleanCueText(lines.slice(timingIndex + 1).join('\n'))
    if (!body || !(end > start)) continue
    cues.push({ start, end, text: body })
  }
  return cues.sort((a, b) => a.start - b.start)
}

/** Drops web-address-only cues and merges cues shorter than `minSeconds` into a neighbour. */
export function tidyCues(cues: Cue[], minSeconds = 0.8): Cue[] {
  const kept = cues.filter((cue) => !isUrlOnly(cue.text))
  const out: Cue[] = []
  for (const cue of kept) {
    const previous = out[out.length - 1]
    if (previous && cue.end - cue.start < minSeconds) {
      previous.text = `${previous.text}\n${cue.text}`
      previous.end = Math.max(previous.end, cue.end)
      continue
    }
    if (previous && previous.end - previous.start < minSeconds) {
      previous.text = `${previous.text}\n${cue.text}`
      previous.end = Math.max(previous.end, cue.end)
      continue
    }
    out.push({ ...cue })
  }
  return out
}

const pad = (n: number, width = 2) => String(Math.floor(n)).padStart(width, '0')

/** "00:04:12.500" */
export function vttTime(value: number): string {
  const total = Math.max(0, value)
  const ms = Math.round((total % 1) * 1000)
  const whole = Math.floor(total) + (ms === 1000 ? 1 : 0)
  return `${pad(whole / 3600)}:${pad((whole % 3600) / 60)}:${pad(whole % 60)}.${pad(ms === 1000 ? 0 : ms, 3)}`
}

/** "04:12" (or "1:04:12" past an hour) */
export function clockTime(value: number): string {
  const whole = Math.max(0, Math.floor(value))
  const hours = Math.floor(whole / 3600)
  return hours ? `${hours}:${pad((whole % 3600) / 60)}:${pad(whole % 60)}` : `${pad(whole / 60)}:${pad(whole % 60)}`
}

export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues.map((cue) => `${vttTime(cue.start)} --> ${vttTime(cue.end)}\n${cue.text}`).join('\n\n')}\n`
}

/** Transcript lines, a new line roughly every `everySeconds` (each starting with its time). */
export function transcriptLines(cues: Cue[], everySeconds = 30): TranscriptLine[] {
  const lines: TranscriptLine[] = []
  let current: TranscriptLine | null = null
  for (const cue of cues) {
    const text = cue.text.replace(/\n/g, ' ')
    if (!current || cue.start - current.start >= everySeconds) {
      current = { start: cue.start, text }
      lines.push(current)
    } else current.text = `${current.text} ${text}`
  }
  return lines.map((line) => ({ start: line.start, text: line.text.replace(/\s+/g, ' ').trim() }))
}

/** "[00:00] Welcome to…\n[00:31] Next…" */
export function transcriptText(lines: TranscriptLine[]): string {
  return lines.map((line) => `[${clockTime(line.start)}] ${line.text}`).join('\n')
}

/** Reads transcriptText back into lines. */
export function parseTranscript(text: string): TranscriptLine[] {
  return text.split('\n').map((line) => {
    const match = /^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]\s*(.*)$/.exec(line.trim())
    if (!match) return null
    return { start: Number(match[1] ?? 0) * 3600 + Number(match[2]) * 60 + Number(match[3]), text: match[4] ?? '' }
  }).filter((line): line is TranscriptLine => Boolean(line?.text))
}

/** SRT -> { vtt, transcript } (null when the file has no usable cues). */
export function convertSrt(srt: string): { vtt: string; transcript: string; cueCount: number } | null {
  const cues = tidyCues(parseSrt(srt))
  if (!cues.length) return null
  return { vtt: toVtt(cues), transcript: transcriptText(transcriptLines(cues)), cueCount: cues.length }
}

const LANGUAGE_SUFFIX = /([._\s-](en|eng|english|en-us|en-gb|subtitles?|subs?|captions?))+$/i

/** Name used to pair a video with its subtitle file: no extension, "Copy of", language suffix, case or punctuation. */
export function subtitleBase(name: string): string {
  return name
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/^copy of\s+/i, '')
    .replace(LANGUAGE_SUFFIX, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** The subtitle file in the same folder that belongs to this video, if any: .srt, else .vtt (the parser reads both). */
export function findSubtitle<T extends { name: string }>(videoName: string, siblings: T[]): T | undefined {
  const base = subtitleBase(videoName)
  const matching = siblings.filter((file) => /\.(srt|vtt)$/i.test(file.name) && subtitleBase(file.name) === base)
  return matching.find((file) => /\.srt$/i.test(file.name)) ?? matching[0]
}
