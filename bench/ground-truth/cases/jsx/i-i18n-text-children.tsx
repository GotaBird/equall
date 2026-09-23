import { useTranslations } from 'next-intl'

export function Pricing() {
  const t = useTranslations('pricing')
  return (
    <section>
      <h2>{t('title')}</h2>
      <a href="/pricing">{t('cta')}</a>
      <button type="button">{t('contact')}</button>
    </section>
  )
}
