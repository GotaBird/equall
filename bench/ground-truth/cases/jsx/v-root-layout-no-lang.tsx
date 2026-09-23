import type { ReactNode } from 'react'

export const metadata = { title: 'Acme' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  )
}
