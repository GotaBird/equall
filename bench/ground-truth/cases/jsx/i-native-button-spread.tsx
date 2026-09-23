import * as React from 'react'

export function IconButton({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={className}
      {...props}
    />
  )
}
