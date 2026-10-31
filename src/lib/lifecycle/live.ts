/**
 * Which lifecycle tracks really send. LIFECYCLE_DRY_RUN=false enables sending for the tracks in
 * LIFECYCLE_LIVE_TRACKS ("T,D" then "T,D,B"; "all" for everything). Anything else is dry-run.
 *
 * Both are typed by hand into a hosting dashboard, so case, surrounding quotes and a stray
 * full stop, semicolon or space between tracks are forgiven: a typo must not silently stop
 * every email. Dry-run stays the default for any value other than "false".
 */
const clean = (value: string | undefined): string => (value ?? '').trim().replace(/^["']|["']$/g, '').trim()

export function isDryRun(): boolean {
  return clean(process.env.LIFECYCLE_DRY_RUN).toLowerCase() !== 'false'
}

export function liveTracks(): string[] {
  return clean(process.env.LIFECYCLE_LIVE_TRACKS).split(/[\s,.;]+/).map((item) => item.toLowerCase()).filter(Boolean)
}

export function isLive(track: string): boolean {
  if (isDryRun()) return false
  const live = liveTracks()
  return live.includes('all') || live.includes(track.toLowerCase())
}
