'use client'

/** The gear popup above logout. Same as Payload's SettingsMenuButton (not exported in 3.85.1). */
import React from 'react'
import { GearIcon, Popup } from '@payloadcms/ui'

export function StudioSettingsMenuButton({ settingsMenu }: { settingsMenu: React.ReactNode[] }) {
  if (!settingsMenu.length) return null
  return (
    <Popup button={<GearIcon ariaLabel="Studio settings" />} className="settings-menu-button" horizontalAlign="left" id="settings-menu" size="small" verticalAlign="bottom">
      {settingsMenu.map((item, index) => (
        <React.Fragment key={index}>{item}</React.Fragment>
      ))}
    </Popup>
  )
}
