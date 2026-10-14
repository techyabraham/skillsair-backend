const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/

function driveIdFromUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    if (url.hostname === 'api.skillsair.com' && url.pathname === '/wp-admin/admin-ajax.php' && url.searchParams.get('action') === 'igd_stream') {
      const id = url.searchParams.get('id') ?? ''
      return DRIVE_ID_PATTERN.test(id) ? id : undefined
    }
    if (url.hostname === 'drive.google.com') {
      const filePathMatch = /^\/file\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname)
      const id = filePathMatch?.[1] ?? url.searchParams.get('id') ?? ''
      return DRIVE_ID_PATTERN.test(id) ? id : undefined
    }
  } catch {
    return undefined
  }
  return undefined
}

export function legacyDriveFileId(content: unknown): string | undefined {
  const visit = (value: unknown): string | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = visit(item)
        if (result) return result
      }
      return undefined
    }
    if (!value || typeof value !== 'object') return undefined
    const node = value as Record<string, unknown>
    const fields = node.fields && typeof node.fields === 'object' ? node.fields as Record<string, unknown> : undefined
    const candidate = driveIdFromUrl(fields?.url)
    if (candidate) return candidate
    for (const child of Object.values(node)) {
      const result = visit(child)
      if (result) return result
    }
    return undefined
  }
  return visit(content)
}
