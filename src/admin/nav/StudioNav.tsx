/**
 * SkillsAir Studio sidebar (`admin.components.Nav`). Based on Payload 3.85.1's DefaultNav
 * (@payloadcms/next/dist/elements/Nav): same permissions (visibleEntities + groupNavItems),
 * collapsible groups with saved preferences (NavGroup), mobile drawer (NavWrapper/NavHamburger),
 * settings menu and logout. Adds a brand header, the scholarship window chip, the Overview
 * group (custom views), icons and live badges. Groups and items follow STUDIO_NAV_ORDER.
 */
import React from 'react'
import type { PayloadRequest, ServerProps } from 'payload'
import { PREFERENCE_KEYS } from 'payload/shared'
import { Logout } from '@payloadcms/ui'
import { NavHamburger, NavWrapper } from '@payloadcms/next/client'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { EntityType, groupNavItems } from '@payloadcms/ui/shared'
import { getTranslation } from '@payloadcms/translations'
import { EntityIcon } from '../ui/icons'
import { studioUser } from '../data/auth'
import { getNavCounts, getWindowState } from '../data/nav'
import { ADMIN_ROUTE, STUDIO_GROUP, STUDIO_NAV_ORDER } from '../studio-config'
import { formatDay } from '../format'
import { StudioBrandMark } from '../brand/StudioBrand'
import { StudioNavGroups, type StudioNavGroupData } from './StudioNavClient'
import { StudioSettingsMenuButton } from './StudioSettingsMenuButton'
import { NavDefaultOpen } from './NavDefaultOpen'

type NavProps = ServerProps & { req?: PayloadRequest }

async function getNavPrefs(req: PayloadRequest | undefined) {
  if (!req?.user?.collection) return null
  const result = await req.payload.find({
    collection: 'payload-preferences',
    depth: 0,
    limit: 1,
    pagination: false,
    req,
    where: {
      and: [
        { key: { equals: PREFERENCE_KEYS.NAV } },
        { 'user.relationTo': { equals: req.user.collection } },
        { 'user.value': { equals: req.user.id } },
      ],
    },
  })
  return (result.docs[0] as { value?: { open?: boolean; groups?: Record<string, { open?: boolean }> } } | undefined)?.value ?? null
}

export async function StudioNav(props: NavProps) {
  const { documentSubViewType, i18n, locale, params, payload, permissions, req, searchParams, user, viewType, visibleEntities } = props
  if (!payload?.config || !visibleEntities) return null

  const { admin: { components: { logout, settingsMenu } }, collections, globals } = payload.config
  const role = studioUser(req ?? null)?.role ?? null

  const groups = groupNavItems(
    [
      ...collections.filter(({ slug }) => visibleEntities.collections.includes(slug)).map((entity) => ({ type: EntityType.collection as const, entity })),
      ...globals.filter(({ slug }) => visibleEntities.globals.includes(slug)).map((entity) => ({ type: EntityType.global as const, entity })),
    ],
    permissions ?? ({} as never),
    i18n,
  )

  const [navPreferences, counts, windowState] = await Promise.all([
    getNavPrefs(req),
    req ? getNavCounts(req).catch(() => null) : null,
    req ? getWindowState(req).catch(() => null) : null,
  ])

  const order = new Map(STUDIO_NAV_ORDER.map(({ group }, index) => [group as string, index]))
  const slugOrder = new Map(STUDIO_NAV_ORDER.flatMap(({ slugs }) => slugs).map((slug, index) => [slug, index]))

  const badges: Record<string, { count: number; tone: 'accent' | 'critical'; label: string }> = {}
  if (counts?.pastDue) badges.subscriptions = { count: counts.pastDue, tone: 'critical', label: `${counts.pastDue} past due` }

  const entityGroups: StudioNavGroupData[] = groups
    .map((group) => ({
      label: group.label,
      items: [...group.entities]
        .sort((a, b) => (slugOrder.get(a.slug) ?? 999) - (slugOrder.get(b.slug) ?? 999))
        .map((entity) => ({
          id: entity.type === EntityType.collection ? `nav-${entity.slug}` : `nav-global-${entity.slug}`,
          href: `${ADMIN_ROUTE}/${entity.type === EntityType.collection ? 'collections' : 'globals'}/${entity.slug}`,
          label: getTranslation(entity.label, i18n),
          icon: <EntityIcon slug={entity.slug} size={18} />,
          badge: badges[entity.slug],
        })),
    }))
    .sort((a, b) => (order.get(a.label) ?? 999) - (order.get(b.label) ?? 999))

  // Emails (the Studio email editor, a custom view) sits first in Messaging, for admins.
  if (role === 'admin') {
    const emails = { id: 'nav-emails', href: `${ADMIN_ROUTE}/emails`, label: 'Emails', icon: <EntityIcon slug="emails" size={18} /> }
    const messaging = entityGroups.find((group) => group.label === STUDIO_GROUP.messaging)
    if (messaging) messaging.items.unshift(emails)
    else entityGroups.push({ label: STUDIO_GROUP.messaging, items: [emails] })
  }

  const overview: StudioNavGroupData = {
    label: STUDIO_GROUP.overview,
    items: [
      { id: 'nav-overview', href: ADMIN_ROUTE, label: 'Overview', icon: <EntityIcon slug="overview" size={18} />, exact: true },
      ...(role === 'admin'
        ? [
            {
              id: 'nav-queue',
              href: `${ADMIN_ROUTE}/queue`,
              label: "Imisi's queue",
              icon: <EntityIcon slug="queue" size={18} />,
              badge: counts?.queue ? { count: counts.queue, tone: 'accent' as const, label: `${counts.queue} waiting` } : undefined,
            },
            { id: 'nav-lifecycle', href: `${ADMIN_ROUTE}/lifecycle`, label: 'Lifecycle emails', icon: <EntityIcon slug="lifecycle" size={18} /> },
          ]
        : []),
      ...(role === 'admin' || role === 'instructor'
        ? [{ id: 'nav-question-bank', href: `${ADMIN_ROUTE}/question-bank`, label: 'Question bank', icon: <EntityIcon slug="quiz-questions" size={18} /> }]
        : []),
      { id: 'nav-guide', href: `${ADMIN_ROUTE}/guide`, label: 'Studio guide', icon: <EntityIcon slug="pages" size={18} /> },
    ],
  }

  const serverProps = { i18n, locale, params, payload, permissions, searchParams, user }
  const clientProps = { documentSubViewType, viewType }

  const LogoutComponent = RenderServerComponent({ clientProps, Component: logout?.Button, Fallback: Logout, importMap: payload.importMap, serverProps })
  const RenderedSettingsMenu = Array.isArray(settingsMenu)
    ? settingsMenu.map((item, index) =>
        RenderServerComponent({ clientProps, Component: item, importMap: payload.importMap, key: `settings-menu-item-${index}`, serverProps }),
      )
    : []

  const windowChip = windowState ? (
    <a className={`sa-nav__window sa-nav__window--${windowState.isOpen ? 'open' : 'closed'}`} href={`${ADMIN_ROUTE}/globals/scholarship-window`}>
      <span className="sa-nav__window-dot" aria-hidden="true" />
      <span>
        {windowState.isOpen ? 'Window open' : 'Window closed'}
        {windowState.isOpen && windowState.closesAt ? <small> · closes {formatDay(windowState.closesAt)}</small> : null}
      </span>
    </a>
  ) : null

  return (
    <NavWrapper baseClass="nav">
      <NavDefaultOpen preferOpen={navPreferences?.open !== false} />
      <nav className="nav__wrap sa-nav" aria-label="Studio">
        <a className="sa-nav__brand" href={ADMIN_ROUTE} aria-label="SkillsAir Studio, Overview">
          <StudioBrandMark />
          <span className="sa-nav__brand-text">
            Skills<span className="sa-nav__brand-air">Air</span> <span className="sa-nav__brand-studio">Studio</span>
          </span>
        </a>
        {windowChip}
        <StudioNavGroups groups={[overview, ...entityGroups]} navPreferences={navPreferences?.groups ?? null} />
        <div className="nav__controls sa-nav__controls">
          <StudioSettingsMenuButton settingsMenu={RenderedSettingsMenu} />
          {LogoutComponent}
        </div>
      </nav>
      <div className="nav__header">
        <div className="nav__header-content">
          <NavHamburger baseClass="nav" />
        </div>
      </div>
    </NavWrapper>
  )
}
