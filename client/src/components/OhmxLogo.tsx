import { useTranslation } from 'react-i18next';
import { SITE_VERSION } from '../config/siteVersion';

type OhmxLogoProps = {
  className?: string;
  showMeta?: boolean;
};

export function OhmxLogo({ className = 'inline-flex', showMeta = true }: OhmxLogoProps) {
  const { t } = useTranslation();

  return (
    <div className={`${className} flex-col leading-none`} aria-label={t('header.logo.ariaLabel')}>
      <div className="text-2xl font-black tracking-tight text-white sm:text-3xl">
        Ohm<span className="text-primary">X</span><span className="text-slate-300">.am</span>
      </div>
      {showMeta ? (
        <div className="mt-1 flex items-center gap-2 ohmx-logo-meta">
          <div className="text-[10px] font-medium uppercase tracking-[0.28em] text-slate-400 sm:text-xs ohmx-logo-tagline">{t('header.logo.tagline')}</div>
          <div className="text-[10px] font-medium text-slate-400 opacity-70 sm:text-xs ohmx-logo-version">{SITE_VERSION}</div>
        </div>
      ) : null}
    </div>
  );
}
