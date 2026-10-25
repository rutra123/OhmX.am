import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

type StatusCode = 403 | 404 | 500;

type StatusPageProps = {
  code?: StatusCode;
};

const statusKeyByCode: Record<StatusCode, 'forbidden' | 'notFound' | 'serverError'> = {
  403: 'forbidden',
  404: 'notFound',
  500: 'serverError',
};

export function StatusPage({ code = 404 }: StatusPageProps) {
  const { t } = useTranslation();
  const statusKey = statusKeyByCode[code] ?? 'notFound';

  return (
    <div className="page flex min-h-[52vh] items-center justify-center py-10">
      <section className="panel max-w-2xl p-8 text-center" aria-labelledby="status-page-title">
        <div className="text-sm font-black uppercase tracking-[0.22em] text-primary">{code}</div>
        <h1 id="status-page-title" className="mt-3 text-3xl font-bold text-fg-strong">{t(`status.${statusKey}.title`)}</h1>
        <p className="mt-3 text-sm leading-6 text-fg-muted">{t(`status.${statusKey}.description`)}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/" className="btn-primary">{t('status.actions.home')}</Link>
          <Link to="/catalog" className="btn-secondary">{t('status.actions.catalog')}</Link>
        </div>
      </section>
    </div>
  );
}
