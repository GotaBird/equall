import { useId } from 'react'

export function NameField() {
  const id = useId()
  return (
    <div className="grid gap-1">
      <label htmlFor={id}>Name</label>
      <input id={id} type="text" name="name" />
    </div>
  )
}
