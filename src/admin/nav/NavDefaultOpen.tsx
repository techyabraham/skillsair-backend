'use client'

/**
 * Payload 3.85.1 starts the sidebar closed at every width up to 1440px (its "large" breakpoint),
 * so on a typical laptop Studio would open with no navigation. Payload's own layout supports
 * an open sidebar there (grid column = --nav-width), so open it on screens wider than 1024px
 * unless the person has closed it themselves (saved nav preference `open: false`).
 *
 * NavProvider closes the nav whenever its breakpoints resolve or change, in an effect that runs
 * after this child's effect; so this watches the same breakpoints and reopens one frame later,
 * once per page load.
 */
import { useEffect, useRef } from 'react'
import { useNav, useWindowInfo } from '@payloadcms/ui'

export function NavDefaultOpen({ preferOpen }: { preferOpen: boolean }) {
  const { setNavOpen } = useNav()
  const {
    breakpoints: { l: large, m: mid },
  } = useWindowInfo()
  const done = useRef(false)

  useEffect(() => {
    if (!preferOpen || done.current || mid !== false || large === undefined) return
    const frame = window.requestAnimationFrame(() => {
      done.current = true
      setNavOpen(true)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [preferOpen, large, mid, setNavOpen])

  return null
}
