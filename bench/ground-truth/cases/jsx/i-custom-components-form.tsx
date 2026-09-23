import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'

export function ProfileForm() {
  return (
    <form className="grid gap-4">
      <Label htmlFor="display-name">Display name</Label>
      <Input id="display-name" name="displayName" />
      <Select name="role">
        <SelectTrigger aria-label="Role">
          <SelectValue placeholder="Pick a role" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
          <SelectItem value="member">Member</SelectItem>
        </SelectContent>
      </Select>
    </form>
  )
}
