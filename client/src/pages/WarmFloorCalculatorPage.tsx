// client/src/pages/WarmFloorCalculatorPage.tsx

import { Link } from 'react-router-dom';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { WarmFloorCalculator } from '../features/warmFloor/components/WarmFloorCalculator';
import { useTranslation } from 'react-i18next';

export function WarmFloorCalculatorPage() {
  const { t } = useTranslation();

  return (
    <div className="page space-y-6">
      <Breadcrumbs
        items={[
          { label: t('common.labels.home'), to: '/' },
          { label: t('common.labels.tools'), to: '/tools' },
          { label: t('calculator.warmFloor.page.breadcrumb') },
        ]}
      />

      <div className="rounded-[28px] border border-line bg-surface p-6">
        <h1 className="text-3xl font-bold text-fg-strong">{t('calculator.warmFloor.page.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-fg-muted">
          {t('calculator.warmFloor.page.description')}
        </p>
      </div>

      <div className="mb-4">
        <Link
          to="/tools/warm-floor/project"
          className="inline-flex rounded-full border border-line px-4 py-2 text-sm font-semibold text-fg-strong"
        >
          Открыть multi-room проект
        </Link>
      </div>

      <WarmFloorCalculator />
    </div>
  );
}
