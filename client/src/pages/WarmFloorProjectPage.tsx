import { Link } from 'react-router-dom';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { WarmFloorProjectWizard } from '../features/warmFloorProject/components/WarmFloorProjectWizard';

export function WarmFloorProjectPage() {
  return (
    <div className="page space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: 'Tools', to: '/tools' },
          { label: 'Warm floor', to: '/tools/warm-floor' },
          { label: 'Project' },
        ]}
      />
      <div className="rounded-[28px] border border-line bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-fg-strong">Проект тёплого пола</h1>
            <p className="mt-2 max-w-2xl text-sm text-fg-muted">
              Несколько помещений → инженерный расчёт → подбор → подтверждение → спецификация и смета.
            </p>
          </div>
          <Link className="text-sm underline text-fg-muted" to="/tools/warm-floor">
            Одно помещение (legacy)
          </Link>
        </div>
      </div>
      <WarmFloorProjectWizard />
    </div>
  );
}
