'use client'

/**
 * Client half of the Studio nav: active state from the pathname (same rule as Payload's
 * DefaultNavClient), collapsible groups via Payload's NavGroup (saves open/closed per user).
 * Icons arrive pre-rendered from the server component.
 */
import React, { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation.js'
import { Link, NavGroup } from '@payloadcms/ui'

export interface StudioNavItem {
  id: string
  href: string
  label: string
  icon: React.ReactNode
  exact?: boolean
  badge?: { count: number; tone: 'accent' | 'critical'; label: string }
}

export interface StudioNavGroupData {
  label: string
  items: StudioNavItem[]
}

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href || pathname === `${href}/`
  return pathname.startsWith(href) && ['/', undefined].includes(pathname[href.length])
}

export function StudioNavGroups({
  groups,
  navPreferences,
}: {
  groups: StudioNavGroupData[]
  navPreferences: Record<string, { open?: boolean }> | null
}) {
  const pathname = usePathname() ?? ''
  // Imisi's queue view announces its live count after "Mark done" so the badge updates at once.
  const [queueCount, setQueueCount] = useState<number | null>(null)
  useEffect(() => {
    const listener = (event: Event) => setQueueCount((event as CustomEvent<{ count: number }>).detail.count)
    window.addEventListener('studio:queue-count', listener)
    return () => window.removeEventListener('studio:queue-count', listener)
  }, [])
  return (
    <>
      {groups.map((group) => (
        <NavGroup key={group.label} label={group.label} isOpen={navPreferences?.[group.label]?.open}>
          {group.items.map((item) => {
            const active = isActive(pathname, item.href, item.exact)
            const badge =
              item.id === 'nav-queue' && queueCount !== null
                ? queueCount > 0
                  ? { count: queueCount, tone: 'accent' as const, label: `${queueCount} waiting` }
                  : undefined
                : item.badge
            const content = (
              <>
                {active && <span className="nav__link-indicator" />}
                <span className="sa-nav__icon">{item.icon}</span>
                <span className="nav__link-label">{item.label}</span>
                {badge ? (
                  <span className={`sa-nav__badge sa-nav__badge--${badge.tone}`}>
                    <span aria-hidden="true">{badge.count > 99 ? '99+' : badge.count}</span>
                    <span className="sa-visually-hidden">, {badge.label}</span>
                  </span>
                ) : null}
              </>
            )
            return active ? (
              <Link key={item.id} id={item.id} className="nav__link sa-nav__link sa-nav__link--active" href={item.href} prefetch={false} aria-current="page">
                {content}
              </Link>
            ) : (
              <Link key={item.id} id={item.id} className="nav__link sa-nav__link" href={item.href} prefetch={false}>
                {content}
              </Link>
            )
          })}
        </NavGroup>
      ))}
    </>
  )
}
