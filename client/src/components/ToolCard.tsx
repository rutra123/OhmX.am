import { Link } from 'react-router-dom';
import { Heart } from './Icons';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';

type ToolCardProps = {
  tool: {
    slug: string;
    name: string;
    description: string;
    cta?: string;
    href?: string;
    mock_result?: string;
  };
};

export function ToolCard({ tool }: ToolCardProps) {
  const { t } = useTranslation();
  const pinnedTools = useStore((s) => s.pinnedTools);
  const toggleToolPin = useStore((s) => s.toggleToolPin);
  const pinned = pinnedTools.includes(tool.slug);

  return (
    <div className="panel p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-fg-strong">{tool.name}</div>
          <p className="mt-2 text-sm leading-6 text-fg-muted">{tool.description}</p>
        </div>
        <button onClick={() => toggleToolPin(tool.slug)} className={`rounded-full p-2 ${pinned ? 'text-primary' : 'text-fg-muted'}`} title={pinned ? t('tools.card.unpin') : t('tools.card.pin')}>
          <Heart className="h-4 w-4" fill={pinned ? 'currentColor' : 'none'} />
        </button>
      </div>
      {tool.mock_result ? <div className="mt-3 rounded-2xl border border-dashed border-line bg-card p-3 text-sm text-fg-muted">{tool.mock_result}</div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {tool.href ? <Link to={tool.href} className="btn-primary">{tool.cta || t('common.actions.open')}</Link> : null}
      </div>
    </div>
  );
}

