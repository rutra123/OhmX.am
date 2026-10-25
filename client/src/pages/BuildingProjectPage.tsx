import { Link } from 'react-router-dom';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { BuildingProjectWizard } from '../features/buildingProject/components/BuildingProjectWizard';

export function BuildingProjectPage() {
  return (
    <div className="page building-project-page space-y-3">
      <Breadcrumbs
        items={[
          { label: 'Home', to: '/' },
          { label: 'Tools', to: '/tools' },
          { label: 'Building project' },
        ]}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <h1 className="text-xl sm:text-2xl font-bold text-fg-strong">Инженерный проект объекта</h1>
        <Link className="text-sm underline text-fg-muted" to="/tools/warm-floor/project">Проект тёплого пола</Link>
      </div>
      <BuildingProjectWizard />
    </div>
  );
}
