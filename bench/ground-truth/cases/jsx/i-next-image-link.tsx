import Image from 'next/image'
import Link from 'next/link'

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <Image src="/logo.svg" alt="Acme" width={32} height={32} priority />
    </Link>
  )
}
