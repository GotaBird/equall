type Props<T> = { items: T[]; label: string }

export const Summary = <T,>({ items, label }: Props<T>) => {
  const count = items.length
  return (
    <p>
      {label}: {count}
    </p>
  )
}
