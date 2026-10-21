'use client'

/**
 * Accessible names for a few Payload 3.85.1 controls that ship without one (found by axe):
 * list pagination arrows, the document "more actions" (⋯) menu, row checkboxes, select, date and
 * rich-text inputs; plus three attribute fixes (ATTRIBUTE_FIXES) for react-select and doc tabs.
 * Never changes what a control does; names are only added where none exists. Registered as
 * an admin provider so it covers every screen. Remove an entry once Payload labels it upstream.
 */
import React, { useEffect } from 'react'

const PATCHES: Array<{ selector: string; label: (el: Element) => string }> = [
  { selector: '.clickable-arrow--left', label: () => 'Previous page' },
  { selector: '.clickable-arrow--right', label: () => 'Next page' },
  { selector: '.doc-controls__popup .popup-button', label: () => 'More actions' },
  { selector: '.table thead input[type="checkbox"]', label: () => 'Select all rows' },
  { selector: '.table tbody input[type="checkbox"]', label: () => 'Select row' },
  // react-select inputs and the Lexical editor aren't tied to their visible field label.
  { selector: '.field-type .react-select input', label: fieldLabel },
  { selector: '.field-type .ContentEditable__root', label: fieldLabel },
  { selector: '.field-type .react-datepicker__input-container input', label: fieldLabel },
  // SEO plugin preview: an empty link around the URL line.
  { selector: 'a[href="/"]:empty', label: () => 'Page address preview' },
]

/**
 * Attribute fixes (no names involved), applied once per element:
 * - react-select's dropdown/clear indicators are focusable inside aria-hidden; take them out of
 *   the tab order (keyboard users open and clear the select from its input: arrows, Backspace).
 * - a sortable multi-value chip is role="button" with buttons inside (nested interactive);
 *   role="group" keeps it focusable and draggable (dnd-kit keys) without nesting buttons.
 * - the Edit/API document tabs are a <ul> without <li> children; drop the list role.
 */
const ATTRIBUTE_FIXES: Array<{ selector: string; apply: (el: Element) => void }> = [
  { selector: '.rs__indicators [aria-hidden="true"]:is(button, [role="button"]):not([tabindex="-1"])', apply: (el) => el.setAttribute('tabindex', '-1') },
  {
    selector: '.rs__multi-value[role="button"]',
    apply: (el) => {
      el.setAttribute('role', 'group')
      if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', (el.textContent ?? '').trim() || 'Selected item')
    },
  },
  { selector: 'ul.doc-tabs__tabs:not([role])', apply: (el) => el.setAttribute('role', 'none') },
]

function fieldLabel(el: Element): string {
  const text = el.closest('.field-type')?.querySelector('.field-label, label')?.textContent?.replace(/\*/g, '').trim()
  return text || 'Field'
}

function patch(root: ParentNode) {
  for (const { selector, label } of PATCHES) {
    root.querySelectorAll(selector).forEach((el) => {
      // Payload renders some of these with aria-label="" (empty), which names nothing.
      if (!el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby') && !(el.textContent ?? '').trim()) el.setAttribute('aria-label', label(el))
    })
  }
  for (const { selector, apply } of ATTRIBUTE_FIXES) root.querySelectorAll(selector).forEach(apply)
}

export function A11yPatches({ children }: { children?: React.ReactNode }) {
  useEffect(() => {
    patch(document)
    let queued = false
    const observer = new MutationObserver(() => {
      if (queued) return
      queued = true
      window.requestAnimationFrame(() => {
        queued = false
        patch(document)
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return <>{children}</>
}
