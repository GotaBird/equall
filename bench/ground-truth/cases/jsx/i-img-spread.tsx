import * as React from 'react'

export function AvatarImage({ className, ...props }: React.ComponentProps<'img'>) {
  return (
    <img
      data-slot="avatar-image"
      className={className}
      {...props}
    />
  )
}
