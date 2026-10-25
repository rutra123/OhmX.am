import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { contactCards } from '../data/publicMenu';

const FOOTER_NAV_ITEMS = [
  { to: '/', key: 'footer.navigation.home' },
  { to: '/catalog', key: 'footer.navigation.catalog' },
  { to: '/brands', key: 'footer.navigation.brands' },
  { to: '/tools', key: 'footer.navigation.tools' },
  { to: '/documentation', key: 'footer.navigation.documentation' },
  { to: '/contacts', key: 'footer.navigation.contacts' },
] as const;

export function SiteFooter() {
  const { t } = useTranslation();
  const contacts = [
    {
      id: 'phone',
      title: t('footer.contacts.phoneTitle'),
      value: contactCards[0].value,
      hint: t('footer.contacts.phoneHint'),
    },
    {
      id: 'messaging',
      title: contactCards[1].title,
      value: contactCards[1].value,
      hint: t('footer.contacts.messagingHint'),
    },
    {
      id: 'address',
      title: t('footer.contacts.addressTitle'),
      value: t('footer.contacts.addressValue'),
      hint: t('footer.contacts.addressHint'),
    },
  ] as const;

  return (
    <footer className="site-footer mt-12 border-t border-line bg-surface" aria-label={t('footer.ariaLabel')}>
      <div className="mx-auto w-full max-w-7xl px-4 pb-28 pt-10 sm:px-6 lg:px-8 lg:pb-10">
        <div className="grid min-w-0 gap-10 md:grid-cols-2 xl:grid-cols-[1.1fr_0.8fr_1.2fr]">
          <section className="min-w-0" aria-labelledby="footer-brand-title">
            <Link id="footer-brand-title" to="/" className="inline-flex max-w-full items-baseline gap-1 text-2xl font-black tracking-tight text-fg-strong">
              <span>Ohm</span><span className="text-primary">X</span><span>.am</span>
            </Link>
            <div className="mt-3 break-words text-sm font-semibold text-fg-soft">{t('footer.brand.tagline')}</div>
            <p className="mt-3 max-w-xl break-words text-sm leading-6 text-fg-muted">{t('footer.brand.description')}</p>
          </section>

          <nav className="min-w-0" aria-label={t('footer.navigation.ariaLabel')}>
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-fg-soft">{t('footer.navigation.title')}</h2>
            <div className="mt-4 grid gap-2">
              {FOOTER_NAV_ITEMS.map((item) => (
                <Link key={item.to} to={item.to} className="w-fit max-w-full break-words text-sm text-fg-muted transition hover:text-primary">
                  {t(item.key)}
                </Link>
              ))}
            </div>
          </nav>

          <section className="min-w-0" aria-label={t('footer.contacts.ariaLabel')}>
            <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-fg-soft">{t('footer.contacts.title')}</h2>
            <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-1">
              {contacts.map((item) => (
                <div key={item.id} className="min-w-0 rounded-2xl border border-line bg-card/70 p-4">
                  <div className="break-words text-xs font-semibold uppercase tracking-[0.12em] text-fg-faint">{item.title}</div>
                  <div className="mt-2 break-words text-sm font-semibold text-fg-strong">{item.value}</div>
                  <div className="mt-1 break-words text-xs leading-5 text-fg-muted">{item.hint}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="mt-10 flex min-w-0 flex-col gap-3 border-t border-line pt-5 text-xs leading-5 text-fg-faint lg:flex-row lg:items-start lg:justify-between">
          <div className="break-words">{t('footer.legal.copyright', { year: new Date().getFullYear() })}</div>
          <div className="max-w-2xl break-words lg:text-right">{t('footer.legal.notice')}</div>
        </div>
      </div>
    </footer>
  );
}
