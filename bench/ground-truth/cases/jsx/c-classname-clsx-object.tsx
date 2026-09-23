import clsx from 'clsx'

export function Chip({ selected }: { selected: boolean }) {
  return (
    <span
      className={clsx('rounded-full px-2 text-xs', {
        'bg-primary text-primary-foreground': selected,
        'aria-selected:ring-2': !selected,
      })}
    >
      Beta
    </span>
  )
}
