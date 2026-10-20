/**
 * Shell for Studio's custom root views: Payload's DefaultTemplate (nav, header) + Gutter, one h1,
 * and the "Not available for your role" screen. Every view checks the role on the server with
 * `initPageResult.req.user` before loading data (brief 11); custom views are public by default.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { DefaultTemplate } from '@payloadcms/next/templates'
import { Gutter } from '@payloadcms/ui'
import { ShieldOff } from 'lucide-react'
import { EntityIcon } from './icons'
import { EmptyState } from './primitives'

export function StudioPage({
  props,
  title,
  eyebrow,
  icon,
  actions,
  intro,
  children,
  className,
  bare = false,
}: {
  props: AdminViewServerProps
  title: React.ReactNode
  eyebrow?: string
  icon?: string
  actions?: React.ReactNode
  intro?: React.ReactNode
  children: React.ReactNode
  className?: string
  /** The dashboard route is already inside Payload's DefaultTemplate; custom root views are not. */
  bare?: boolean
}) {
  const { initPageResult } = props
  const content = (
    <Gutter className={`sa-view${className ? ` ${className}` : ''}`}>
      <header className="sa-view__header">
        <div className="sa-view__heading">
          {eyebrow ? <p className="sa-eyebrow">{eyebrow}</p> : null}
          <h1 className="sa-view__title">
            {icon ? (
              <span className="sa-view__icon" aria-hidden="true">
                <EntityIcon slug={icon} size={22} />
              </span>
            ) : null}
            {title}
          </h1>
          {intro ? <div className="sa-view__intro">{intro}</div> : null}
        </div>
        {actions ? <div className="sa-view__actions">{actions}</div> : null}
      </header>
      {children}
    </Gutter>
  )
  if (bare) return content
  return (
    <DefaultTemplate
      i18n={initPageResult.req.i18n}
      locale={initPageResult.locale}
      params={props.params}
      payload={initPageResult.req.payload}
      // The nav groups collections by read permission; without this only custom links show.
      permissions={initPageResult.permissions}
      req={initPageResult.req}
      searchParams={props.searchParams}
      user={initPageResult.req.user ?? undefined}
      // Custom root views aren't wrapped by Payload, so pass the header actions (command bar) ourselves.
      viewActions={initPageResult.req.payload.config.admin?.components?.actions}
      viewType={props.viewType}
      visibleEntities={initPageResult.visibleEntities}
    >
      {content}
    </DefaultTemplate>
  )
}

export function NotAvailable({ props, title }: { props: AdminViewServerProps; title: string }) {
  return (
    <StudioPage props={props} title={title}>
      <div className="sa-card">
        <EmptyState icon={<ShieldOff size={22} strokeWidth={1.75} />} title="Not available for your role" action={{ href: '/admin', label: 'Back to Overview' }}>
          This page is for SkillsAir admins. If you need it for your work, ask the owner to change your role.
        </EmptyState>
      </div>
    </StudioPage>
  )
}
