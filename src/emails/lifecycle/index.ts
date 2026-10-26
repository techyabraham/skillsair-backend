import { TRACK_A } from './track-a.js'
import { TRACK_P_B_X } from './track-p-b-x.js'
import { TRACK_T_D } from './track-t-d.js'
import { TRACK_I_R_C_G } from './track-i-r-c-g.js'
import { TRACK_L } from './track-l.js'
import type { LifecycleTemplate } from './shared.js'

/** Every lifecycle email by id (A0–A7, W1, P1–P6, B1–B3, T1–T9, D1–D3, I0–I3, L1–L2, R1–R5, C1–C5, C2L, G1–G4, X1). */
export const LIFECYCLE_TEMPLATES: Record<string, LifecycleTemplate> = Object.fromEntries(
  [...TRACK_A, ...TRACK_P_B_X, ...TRACK_T_D, ...TRACK_I_R_C_G, ...TRACK_L].map((template) => [template.id, template]),
)

export { SAMPLE, type LifecycleTemplate } from './shared.js'
