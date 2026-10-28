import React from 'react'
import type { AdminViewServerProps } from 'payload'
import { NotAvailable, StudioPage } from '../../ui/StudioPage'
import { isAdmin } from '../../data/auth'
import { AmbassadorDirectory } from './AmbassadorDirectory'

export async function DirectoryView(props: AdminViewServerProps) {
  if (!isAdmin(props.initPageResult.req)) return <NotAvailable props={props} title="Ambassadors" />
  return <StudioPage props={props} title="Ambassadors" icon="ambassadors" eyebrow="Programme management" intro="Find ambassadors, review status and open each wallet and action history."><AmbassadorDirectory /></StudioPage>
}
