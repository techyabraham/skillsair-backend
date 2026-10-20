'use client'

/**
 * Settings (gear) menu items: theme (Payload's own preference, saved in its theme cookie),
 * the Studio guide and "Report a problem".
 */
import React from 'react'
import { PopupList, useTheme } from '@payloadcms/ui'

export function StudioSettingsMenu() {
  const { autoMode, setTheme, theme } = useTheme()
  const choose = (value: 'light' | 'dark' | 'auto') => (setTheme as (value: string) => void)(value)
  const current = autoMode ? 'auto' : theme
  return (
    <>
      <PopupList.GroupLabel label="Theme" />
      <PopupList.ButtonGroup>
        <PopupList.Button active={current === 'light'} onClick={() => choose('light')}>Light</PopupList.Button>
        <PopupList.Button active={current === 'dark'} onClick={() => choose('dark')}>Dark</PopupList.Button>
        <PopupList.Button active={current === 'auto'} onClick={() => choose('auto')}>System</PopupList.Button>
      </PopupList.ButtonGroup>
      <PopupList.Divider />
      <PopupList.ButtonGroup>
        <PopupList.Button href="/admin/guide">Studio guide</PopupList.Button>
        <PopupList.Button href="mailto:hello@skillsair.com?subject=SkillsAir%20Studio%20problem">Report a problem</PopupList.Button>
      </PopupList.ButtonGroup>
    </>
  )
}
