export function ProgressBar({ value }: { value: number }) {
  return (
    <div
      role="progressbar"
      aria-label="Upload progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value}
      style={{ width: `${value}%` }}
      className="h-2 bg-primary"
    />
  )
}
