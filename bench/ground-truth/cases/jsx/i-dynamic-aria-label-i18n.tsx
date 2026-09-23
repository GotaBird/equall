import { useTranslations } from 'next-intl'

export function CloseButton({ onClose }: { onClose: () => void }) {
  const t = useTranslations('common')
  return (
    <button type="button" aria-label={t('close')} onClick={onClose}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16">
        <path d="M2 2l12 12" />
      </svg>
    </button>
  )
}
