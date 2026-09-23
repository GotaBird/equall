export function Alert({ urgent, children }: { urgent?: boolean; children: React.ReactNode }) {
  return (
    <div role={urgent ? 'alert' : 'status'} className="rounded border p-4">
      {children}
    </div>
  )
}
