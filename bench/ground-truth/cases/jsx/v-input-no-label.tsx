export function SearchBar() {
  return (
    <form action="/search">
      <input type="text" name="q" />
      <button type="submit">Search</button>
    </form>
  )
}
