/**
 * SkillsAir Studio brand graphics (server components, no client JS):
 * - StudioBrandMark: the three-bar SkillsAir icon (same as the website favicon), used in the nav
 *   and as `graphics.Icon` in the app header.
 * - StudioLogo: the "Skills" + orange "Air" wordmark with "Studio", `graphics.Logo` (login,
 *   forgot password). Replace with {{LOGO_SVG}} when the owner supplies one.
 * - AdirePattern: the website hero pattern (concentric dashed circles, orange centre dots on navy).
 * - StudioLoginPanel: `beforeLogin`; the navy half of the split login (CSS in studio.css).
 */
import React from 'react'

/** The SkillsAir three-bar icon (green, yellow, red bars), as on the website and favicon. */
export function StudioBrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="sa-brand-mark" width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false">
      <rect width="256" height="256" rx="56" fill="#0d1b4b" />
      <rect x="52" y="120" width="40" height="84" rx="20" fill="#339900" />
      <rect x="108" y="84" width="40" height="120" rx="20" fill="#FFD600" />
      <rect x="164" y="52" width="40" height="152" rx="20" fill="#D50000" />
    </svg>
  )
}

/** `admin.components.graphics.Icon`: the compact mark beside the breadcrumbs. */
export function StudioIcon() {
  return (
    <span className="sa-graphic-icon">
      <StudioBrandMark size={24} />
      <span className="sa-visually-hidden">SkillsAir Studio</span>
    </span>
  )
}

/** `admin.components.graphics.Logo`: the wordmark. */
export function StudioLogo() {
  return (
    <span className="sa-logo" role="img" aria-label="SkillsAir Studio">
      <StudioBrandMark size={36} />
      <span className="sa-logo__word" aria-hidden="true">
        Skills<span className="sa-logo__air">Air</span>
        <span className="sa-logo__studio">Studio</span>
      </span>
    </span>
  )
}

/** Adire-style pattern: concentric dashed circles with orange centre dots. Decorative. */
export function AdirePattern({ className, id = 'sa-adire', dotOpacity = 1 }: { className?: string; id?: string; dotOpacity?: number }) {
  return (
    <svg className={className} aria-hidden="true" focusable="false" width="100%" height="100%">
      <defs>
        <pattern id={id} width="96" height="96" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeLinecap="round">
            <circle cx="48" cy="48" r="34" strokeWidth="1.5" strokeDasharray="2 6" />
            <circle cx="48" cy="48" r="22" strokeWidth="1.5" strokeDasharray="4 5" />
            <circle cx="48" cy="48" r="11" strokeWidth="1.5" strokeDasharray="1 4" />
          </g>
          <circle cx="48" cy="48" r="3.2" fill="#f97316" fillOpacity={dotOpacity} />
          <circle cx="0" cy="0" r="2" fill="currentColor" />
          <circle cx="96" cy="0" r="2" fill="currentColor" />
          <circle cx="0" cy="96" r="2" fill="currentColor" />
          <circle cx="96" cy="96" r="2" fill="currentColor" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  )
}

/** `admin.components.beforeLogin`. */
export function StudioLoginPanel() {
  return (
    <aside className="sa-login-panel" aria-label="About SkillsAir Studio">
      <AdirePattern className="sa-login-panel__pattern" id="sa-adire-login" />
      <div className="sa-login-panel__content">
        <StudioLogo />
        <p className="sa-login-panel__line">Run admissions, programmes and learners from one place.</p>
      </div>
    </aside>
  )
}
