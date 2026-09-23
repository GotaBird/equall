function formatCount(count: number) {
  return (
    count > 99 ? '99+' : String(count)
  )
}

export function Notifications({ count }: { count: number }) {
  return (
    <div className="relative">
      <img src="/bell.svg" />
      <span>{formatCount(count)}</span>
    </div>
  )
}
