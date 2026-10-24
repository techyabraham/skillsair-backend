/**
 * Google Drive folders and files for the content scripts (curriculum import, caption import,
 * content source export). Uses the service account (GOOGLE_SERVICE_ACCOUNT_KEY) when it's set and
 * can read the folder, otherwise Drive's public "anyone with the link" views. Never used inside
 * API requests: these run from the migration runner or the worker.
 */
import { google, type drive_v3 } from 'googleapis'

export interface DriveItem {
  id: string
  name: string
  folder: boolean
  modifiedTime?: string
  children?: DriveItem[]
}

const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** Timestamped progress lines, so long runs never look frozen. */
export const progress = (line: string) => console.log(`  [${new Date().toISOString().slice(11, 19)}] ${line}`)

let cachedDrive: drive_v3.Drive | null | undefined

/** The service-account Drive client, or null when no usable key is configured. */
export function serviceAccountDrive(): drive_v3.Drive | null {
  if (cachedDrive !== undefined) return cachedDrive
  cachedDrive = null
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) return cachedDrive
  try {
    const key = JSON.parse(raw) as { client_email: string; private_key: string }
    if (!key.client_email || !key.private_key) return cachedDrive
    const auth = new google.auth.JWT({ email: key.client_email, key: key.private_key, scopes: ['https://www.googleapis.com/auth/drive.readonly'] })
    cachedDrive = google.drive({ version: 'v3', auth })
  } catch {
    cachedDrive = null
  }
  return cachedDrive
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const byName = (a: DriveItem, b: DriveItem) => a.name.localeCompare(b.name, undefined, { numeric: true })

async function listWithServiceAccount(drive: drive_v3.Drive, id: string): Promise<DriveItem[]> {
  const items: DriveItem[] = []
  let pageToken: string | undefined
  do {
    const { data } = await drive.files.list({
      q: `'${id}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    }, { timeout: 30_000 })
    for (const file of data.files ?? []) {
      if (!file.id || !file.name) continue
      items.push({ id: file.id, name: file.name.trim(), folder: file.mimeType === FOLDER_MIME, modifiedTime: file.modifiedTime ?? undefined })
    }
    pageToken = data.nextPageToken ?? undefined
  } while (pageToken)
  return items.sort(byName)
}

async function listPublic(id: string): Promise<DriveItem[]> {
  for (let attempt = 0; attempt < 4; attempt++) {
    // A request Google never answers is abandoned after 30 seconds and retried.
    const response = await fetch(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 SkillsAir-content-scripts' },
      signal: AbortSignal.timeout(30_000),
    }).catch((err: unknown) => {
      progress(`Drive folder ${id}: ${err instanceof Error ? err.message : String(err)}; retrying`)
      return null
    })
    if (response?.ok) {
      const html = await response.text()
      const items: DriveItem[] = []
      const pattern = /<div class="flip-entry" id="entry-([^"]+)"[\s\S]*?<a href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g
      let match: RegExpExecArray | null
      while ((match = pattern.exec(html))) items.push({ id: match[1] ?? '', name: decode(match[3] ?? '').trim(), folder: (match[2] ?? '').includes('/folders/') })
      return items.sort(byName)
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
  }
  throw new Error(`Could not list Drive folder ${id}. Share it with the service account, or as "anyone with the link".`)
}

/** One folder's files and sub-folders, sorted by name (numbers in natural order). */
export async function listFolder(id: string): Promise<DriveItem[]> {
  const drive = serviceAccountDrive()
  if (drive) {
    try {
      return await listWithServiceAccount(drive, id)
    } catch {
      // Not shared with the service account: try the public view.
    }
  }
  return listPublic(id)
}

/** The whole tree under a folder. */
export async function walkFolder(id: string, stats = { folders: 0, files: 0 }): Promise<DriveItem[]> {
  const items = await listFolder(id)
  stats.folders++
  stats.files += items.filter((item) => !item.folder).length
  if (stats.folders % 10 === 0) progress(`read ${stats.folders} folders, ${stats.files} files so far`)
  for (const item of items) if (item.folder) item.children = await walkFolder(item.id, stats)
  return items
}

/** Every file in a tree, with the folder it sits in. */
export function flattenFiles(tree: DriveItem[], parentId = ''): Array<DriveItem & { parentId: string; siblings: DriveItem[] }> {
  const out: Array<DriveItem & { parentId: string; siblings: DriveItem[] }> = []
  const files = tree.filter((item) => !item.folder)
  for (const file of files) out.push({ ...file, parentId, siblings: files })
  for (const folder of tree.filter((item) => item.folder)) out.push(...flattenFiles(folder.children ?? [], folder.id))
  return out
}

/** A small text file's contents (subtitles), through the service account or the public download link. */
export async function downloadText(fileId: string): Promise<string> {
  const drive = serviceAccountDrive()
  if (drive) {
    try {
      const response = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer', timeout: 30_000 })
      return decodeText(Buffer.from(response.data as ArrayBuffer))
    } catch {
      // Fall back to the public link.
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 SkillsAir-content-scripts' },
      signal: AbortSignal.timeout(30_000),
    }).catch(() => null)
    if (response?.ok) return decodeText(Buffer.from(await response.arrayBuffer()))
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
  }
  throw new Error(`Could not download Drive file ${fileId}`)
}

/** Subtitle files are usually UTF-8 (sometimes with a byte-order mark), occasionally UTF-16 or Windows-1252. */
export function decodeText(bytes: Buffer): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return bytes.subarray(2).toString('utf16le')
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const swapped = Buffer.from(bytes.subarray(2))
    swapped.swap16()
    return swapped.toString('utf16le')
  }
  const text = bytes.toString('utf8').replace(/^﻿/, '')
  // Invalid UTF-8 shows up as replacement characters: read it as Windows-1252 instead.
  if (text.includes('�')) return new TextDecoder('windows-1252').decode(bytes)
  return text
}

/** Video duration in seconds from Drive metadata (service account only), or null. */
export async function videoDurationSeconds(fileId: string): Promise<number | null> {
  const drive = serviceAccountDrive()
  if (!drive) return null
  try {
    const { data } = await drive.files.get({ fileId, fields: 'videoMediaMetadata(durationMillis)', supportsAllDrives: true }, { timeout: 20_000 })
    const millis = Number(data.videoMediaMetadata?.durationMillis ?? 0)
    return millis > 0 ? Math.round(millis / 1000) : null
  } catch {
    return null
  }
}
