type Logo = { id: string; src: string }

export function LogoCloud({ logos }: { logos: Logo[] }) {
  return (
    <ul className="grid grid-cols-4 gap-4">
      {logos.map((logo) => (
        <li key={logo.id}>
          <img src={logo.src} />
        </li>
      ))}
    </ul>
  )
}
