import { useForm } from 'react-hook-form'

export function LoginForm() {
  const { register } = useForm<{ email: string }>()
  return (
    <form>
      <label className="grid gap-1">
        <span>Email</span>
        <input type="email" {...register('email')} />
      </label>
    </form>
  )
}
