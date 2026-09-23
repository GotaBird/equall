import * as React from 'react'

export function NativeSelect({ children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select className="h-9 rounded-md border px-2" {...props}>
      {children}
    </select>
  )
}
