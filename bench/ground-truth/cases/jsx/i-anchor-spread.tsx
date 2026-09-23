import * as React from 'react'

export function TextLink(props: React.ComponentProps<'a'>) {
  return (
    <a className="underline underline-offset-4" {...props} />
  )
}
