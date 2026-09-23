export function CartButton() {
  return (
    <button type="button" className="relative p-2">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" />
      </svg>
      <span className="sr-only">Open cart</span>
    </button>
  )
}
