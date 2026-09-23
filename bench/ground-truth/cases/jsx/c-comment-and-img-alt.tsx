export function Avatar() {
  return (
    <div className="flex items-center gap-2">
      {/* The user's profile picture */}
      <img src="/me.jpg" alt="Profile picture of Ada Lovelace" width={32} height={32} />
      <span>Ada Lovelace</span>
    </div>
  )
}
