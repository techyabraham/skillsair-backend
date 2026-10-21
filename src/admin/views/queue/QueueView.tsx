/**
 * /admin/queue, Imisi's queue (brief 7.3). Admin only (checked on the server before any data is
 * read). Header: how many are waiting, the oldest wait and the working hours; a calm banner
 * outside working hours. Cards and actions live in QueueBoard (client).
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { Callout } from '../../ui/primitives'
import { isAdmin } from '../../data/auth'
import { getQueue } from '../../data/queue'
import { inWorkingHours } from '../../data/metrics-core'
import { formatDuration } from '../../format'
import { WORKING_HOURS } from '../../studio-config'
import { QueueBoard } from './QueueBoard'

export async function QueueView(props: AdminViewServerProps) {
  if (!isAdmin(props.initPageResult.req)) return <NotAvailable props={props} title="Imisi’s queue" />
  const now = Date.now()
  let items: Awaited<ReturnType<typeof getQueue>> | null = null
  try {
    items = await getQueue(props.initPageResult.req, now)
  } catch {
    items = null
  }
  const oldest = items?.reduce((max, item) => Math.max(max, item.waitingMs), 0) ?? 0
  const open = inWorkingHours(now)

  return (
    <StudioPage
      props={props}
      title="Imisi’s queue"
      icon="queue"
      eyebrow="Admissions"
      intro={
        items ? (
          <p className="sa-queue__summary">
            <strong>{items.length} waiting</strong>
            {items.length ? <> · oldest {formatDuration(oldest)}</> : null} · Working hours {WORKING_HOURS.label}
          </p>
        ) : null
      }
      actions={
        <a className="sa-button sa-button--secondary" href="/admin/collections/leads?where[or][0][and][0][needsHuman][equals]=true&sort=-score">
          Open as a table
        </a>
      }
    >
      {!open ? (
        <div className="sa-queue__banner">
          <Callout tone="info" title="Outside working hours">
            Replies sent tomorrow from 9am will still be on time.
          </Callout>
        </div>
      ) : null}
      {items ? (
        <QueueBoard items={items} initialNow={now} />
      ) : (
        <Callout tone="critical" title="The queue couldn’t load">
          Refresh the page. If it keeps happening, check the admin service logs.
        </Callout>
      )}
    </StudioPage>
  )
}
