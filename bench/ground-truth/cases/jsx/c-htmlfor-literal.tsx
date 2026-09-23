export function EmailField() {
  return (
    <div className="grid gap-1">
      <label htmlFor="email">Email</label>
      <input id="email" type="email" name="email" autoComplete="email" />
    </div>
  )
}
