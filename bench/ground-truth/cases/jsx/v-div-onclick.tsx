export function Card({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="card" onClick={onOpen}>
      Open details
    </div>
  )
}
