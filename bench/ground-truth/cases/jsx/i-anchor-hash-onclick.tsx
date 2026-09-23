export function ScrollTop() {
  return (
    <a
      href="#"
      onClick={(e) => {
        e.preventDefault()
        window.scrollTo({ top: 0 })
      }}
    >
      Back to top
    </a>
  )
}
