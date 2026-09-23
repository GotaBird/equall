export function SignInForm() {
  return (
    <form className="grid gap-2">
      <label>
        Email
        <input type="email" name="email" autoComplete="email" />
      </label>
      <button type="submit">
        <svg width="16" height="16" viewBox="0 0 16 16">
          <path d="M2 8h12M9 3l5 5-5 5" />
        </svg>
      </button>
    </form>
  )
}
