'use client'

/** Copies a value (e.g. a Paystack reference) and confirms with a short "Copied" state. */
import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="sa-copy"
      aria-label={copied ? 'Copied' : label}
      title={copied ? 'Copied' : label}
      onClick={async (event) => {
        event.stopPropagation()
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        } catch {
          setCopied(false)
        }
      }}
    >
      {copied ? <Check size={14} strokeWidth={2.25} aria-hidden /> : <Copy size={14} strokeWidth={2} aria-hidden />}
    </button>
  )
}
