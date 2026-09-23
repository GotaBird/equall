export function StatusIcon({ label }: { label: string }) {
  return (
    <svg role="img" aria-label={label} width="12" height="12" viewBox="0 0 12 12">
      <circle cx="6" cy="6" r="5" />
    </svg>
  )
}
