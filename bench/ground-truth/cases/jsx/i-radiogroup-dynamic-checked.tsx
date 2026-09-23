type Option = { value: string; label: string }

export function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: Option[]
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div role="radiogroup" aria-label="View mode" className="inline-flex rounded-md border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
