import { cn } from '@/lib/utils'

export function SubmitButton({ pending }: { pending: boolean }) {
  return (
    <button
      type="submit"
      className={cn(
        'inline-flex h-9 items-center rounded-md px-4 text-sm',
        'aria-invalid:border-destructive aria-disabled:opacity-50 data-[state=open]:bg-accent',
        pending && 'opacity-70'
      )}
    >
      Create account
    </button>
  )
}
