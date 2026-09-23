'use client'

import { useState } from 'react'

export function Banner() {
  const [open, setOpen] = useState(true)
  if (!open) return null
  return (
    <div className="flex items-center justify-between">
      <p>New release available.</p>
      <a href="/changelog" onClick={() => setOpen(false)}>Read the changelog</a>
      <button type="button" onClick={() => setOpen(false)}>
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path d="M1 1l10 10M11 1L1 11" />
        </svg>
      </button>
    </div>
  )
}
