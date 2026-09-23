export function EmailInput({ error }: { error?: string }) {
  return (
    <div className="grid gap-1">
      <label htmlFor="signup-email">Email</label>
      <input
        id="signup-email"
        type="email"
        aria-invalid={!!error}
        aria-describedby={error ? 'signup-email-error' : undefined}
      />
      {error && (
        <p id="signup-email-error" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  )
}
