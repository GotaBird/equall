import type { ReactNode } from 'react'

export function List({ children }: { children: ReactNode }) {
  return (
    <ul className="list-disc pl-6">
      {children}
    </ul>
  )
}
