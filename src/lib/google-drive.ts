import { google, drive_v3 } from 'googleapis'
import type { Readable } from 'node:stream'
import { AppError } from '../types/index.js'
import type { DriveFileMetadata, GoogleServiceAccountKey, ParsedRange } from '../types/google-drive.js'
import { logger } from './logger.js'
import { CACHE_KEYS, cachedJson } from './cache.js'
import { noteQuotaError } from './drive-health.js'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly'

let driveClient: drive_v3.Drive | null = null

function getServiceAccountKey(): GoogleServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not configured')
  return JSON.parse(raw) as GoogleServiceAccountKey
}

function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient
  const key = getServiceAccountKey()
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [DRIVE_SCOPE],
  })
  driveClient = google.drive({ version: 'v3', auth })
  return driveClient
}

/** Drive's per-file download quota ("download quota exceeded") is a 403 with these reasons. */
function isQuotaError(err: unknown): boolean {
  const e = err as { code?: number; status?: number; errors?: Array<{ reason?: string }>; message?: string; response?: { status?: number } }
  const status = e?.code ?? e?.status ?? e?.response?.status
  const reasons = (e?.errors ?? []).map((item) => item.reason ?? '')
  return status === 403 && (reasons.some((reason) => /quota|rateLimit|userRateLimit/i.test(reason)) || /quota/i.test(e?.message ?? ''))
}

/** Only server errors and network failures are worth retrying (not 403/404). */
function isRetryable(err: unknown): boolean {
  const e = err as { code?: number | string; status?: number; response?: { status?: number } }
  const status = Number(e?.response?.status ?? e?.status ?? (typeof e?.code === 'number' ? e.code : NaN))
  if (Number.isFinite(status)) return status >= 500 || status === 429
  return true
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (isQuotaError(err)) {
        logger.warn({ err: (err as Error)?.message }, 'drive_quota_exceeded')
        await noteQuotaError()
        throw new AppError('SERVICE_BUSY', 'This video is busy, please try again in a few minutes.')
      }
      const isLastAttempt = attempt === attempts - 1
      if (isLastAttempt || !isRetryable(err)) break
      const backoffMs = 2 ** attempt * 250
      logger.warn({ attempt, backoffMs }, 'google_drive_retry')
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

/** File size and type, cached in Redis for an hour so each video request calls Drive once (the bytes). */
export async function getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
  return cachedJson(CACHE_KEYS.driveMeta(fileId), 3600, () => fetchFileMetadata(fileId))
}

async function fetchFileMetadata(fileId: string): Promise<DriveFileMetadata> {
  return withRetry(async () => {
    const response = await getDriveClient().files.get({
      fileId,
      fields: 'id,name,mimeType,size',
      supportsAllDrives: true,
    })
    const data = response.data
    if (!data.id || !data.mimeType || !data.size) {
      throw new AppError('NOT_FOUND', 'Video file metadata unavailable')
    }
    return {
      id: data.id,
      name: data.name ?? 'video',
      mimeType: data.mimeType,
      size: data.size,
    }
  })
}

export interface DriveByteRangeStream {
  stream: Readable
  status: number
}

/** Streams a byte range of a Drive file using the Range header on the underlying request. */
export async function streamFileRange(fileId: string, range: ParsedRange): Promise<DriveByteRangeStream> {
  return withRetry(async () => {
    const response = await getDriveClient().files.get(
      { fileId, alt: 'media', supportsAllDrives: true },
      {
        responseType: 'stream',
        headers: { Range: `bytes=${range.start}-${range.end}` },
      },
    )
    return {
      stream: response.data as unknown as Readable,
      status: response.status,
    }
  })
}

export function parseRangeHeader(rangeHeader: string | undefined, totalSize: number): ParsedRange {
  if (!rangeHeader) {
    return { start: 0, end: totalSize - 1 }
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) {
    return { start: 0, end: totalSize - 1 }
  }
  const [, startStr, endStr] = match
  let start = startStr ? Number(startStr) : 0
  let end = endStr ? Number(endStr) : totalSize - 1
  if (!startStr && endStr) {
    // suffix range: bytes=-500 means last 500 bytes
    start = Math.max(totalSize - Number(endStr), 0)
    end = totalSize - 1
  }
  end = Math.min(end, totalSize - 1)
  if (start > end || start < 0) {
    start = 0
    end = totalSize - 1
  }
  return { start, end }
}
