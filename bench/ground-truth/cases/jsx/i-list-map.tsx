type Item = { id: string; label: string }

export function FeatureList({ items }: { items: Item[] }) {
  return (
    <ul className="space-y-2" role="list">
      {items.map((item) => (
        <li key={item.id}>{item.label}</li>
      ))}
    </ul>
  )
}
