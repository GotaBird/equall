export function RepoLink({ url }: { url: string }) {
  return (
    <a href={url} aria-label="Open repository on GitHub" className="p-2">
      <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8" />
      </svg>
    </a>
  )
}
