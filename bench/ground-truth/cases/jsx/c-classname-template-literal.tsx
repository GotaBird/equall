export function NavItem({ active }: { active: boolean }) {
  return (
    <a
      href="/settings"
      className={`rounded px-3 py-2 aria-[current=page]:font-bold ${active ? 'bg-muted' : ''}`}
    >
      Settings
    </a>
  )
}
