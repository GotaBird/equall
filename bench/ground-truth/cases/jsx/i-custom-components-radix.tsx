import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Button } from '@/components/ui/button'

export function UserMenu() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon">
          <UserIcon />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content align="end">
        <DropdownMenu.Item>Profile</DropdownMenu.Item>
        <DropdownMenu.Item>Sign out</DropdownMenu.Item>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  )
}

function UserIcon() {
  return <svg aria-hidden="true" width="16" height="16" />
}
