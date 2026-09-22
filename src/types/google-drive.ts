export interface GoogleServiceAccountKey {
  type: string
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  token_uri: string
}

export interface DriveFileMetadata {
  id: string
  name: string
  mimeType: string
  size: string
}

export interface ParsedRange {
  start: number
  end: number
}
