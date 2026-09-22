import { google, drive_v3 } from 'googleapis'
import type { Readable } from 'node:stream'
import { AppError } from '../types/index.js'
import type { DriveFileMetadata, GoogleServiceAccountKey, ParsedRange } from '../types/google-drive.js'
import { logger } from './logger.js'

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

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const isLastAttempt = attempt === attempts - 1
      if (isLastAttempt) break
      const backoffMs = 2 ** attempt * 250
      logger.warn({ attempt, backoffMs }, 'google_drive_retry')
      await new Promise((resolve) => setTimeout(resolve, backoffMs))
    }
  }
  throw lastError
}

export async function getFileMetadata(fileId: string): Promise<DriveFileMetadata> {
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
