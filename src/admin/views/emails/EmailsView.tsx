/**
 * /admin/emails: edit the wording of every email without a developer (Studio email editor).
 * Without ?template: every editable email grouped by type, with status, search and filter.
 * With ?template=<id>: the editor (fields on the left, live preview on the right, history drawer).
 * Admins only. Data loads on the server (src/emails/editor-data.ts); actions call the editor API.
 */
import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { Callout } from '../../ui/primitives'
import { isAdmin } from '../../data/auth'
import { entryById } from '../../../emails/catalog'
import { editorDetail, listEditorItems, type EditorDetail, type EditorListItem } from '../../../emails/editor-data'
import { ensureOverrideStore } from '../../../emails/override-store'
import { EmailsListClient } from './EmailsListClient'
import { EmailEditorClient } from './EmailEditorClient'

const param = (value: unknown): string => (Array.isArray(value) ? String(value[0] ?? '') : typeof value === 'string' ? value : '')

export async function EmailsView(props: AdminViewServerProps) {
  const req = props.initPageResult.req
  if (!isAdmin(req)) return <NotAvailable props={props} title="Emails" />
  const search = (props.searchParams ?? {}) as Record<string, unknown>
  const templateId = param(search.template)
  await ensureOverrideStore(req.payload).catch(() => null)

  if (templateId) {
    const entry = entryById(templateId)
    let detail: EditorDetail | null = null
    try {
      detail = entry ? await editorDetail(req.payload, entry) : null
    } catch {
      detail = null
    }
    return (
      <StudioPage
        props={props}
        title={entry ? `${entry.id.startsWith('_') ? '' : `${entry.id} · `}${entry.name}` : 'Email not found'}
        icon="emails"
        eyebrow="Messaging · Emails"
        intro={entry?.whenSent}
        actions={
          <a className="sa-button sa-button--ghost" href="/admin/emails">
            All emails
          </a>
        }
      >
        {detail ? (
          <EmailEditorClient initial={detail} />
        ) : (
          <Callout tone="critical" title={entry ? 'This email couldn’t be loaded' : 'There’s no email with that name'}>
            {entry ? 'Refresh to try again.' : <a href="/admin/emails">Back to all emails</a>}
          </Callout>
        )}
      </StudioPage>
    )
  }

  let items: EditorListItem[] | null = null
  try {
    items = await listEditorItems(req.payload)
  } catch {
    items = null
  }
  return (
    <StudioPage
      props={props}
      title="Emails"
      icon="emails"
      eyebrow="Messaging"
      intro="Change the wording of any email. Drafts don’t reach anyone until you publish; you can always go back to an earlier version or the original."
    >
      {items ? (
        <EmailsListClient items={items} />
      ) : (
        <Callout tone="critical" title="The emails couldn’t be loaded">
          Refresh to try again.
        </Callout>
      )}
    </StudioPage>
  )
}
