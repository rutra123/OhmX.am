import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { ToolCard } from '../components/ToolCard';
import { useTranslation } from 'react-i18next';

type ToolItem = {
  slug: string;
  name: string;
  description: string;
  cta?: string;
  href?: string;
  mock_result?: string;
};

const DEFAULT_TOOLS: ToolItem[] = [
  {
    slug: 'ai-engineering-selector',
    name: 'ИИ-инженерный подбор оборудования',
    description: 'Подбор отопления, охлаждения, тёплого пола, котлов, конвекторов и сопутствующих товаров через диалог с ИИ.',
    cta: 'Открыть ИИ-подбор',
    href: '/tools/ai-engineering-selector',
  },
  {
    slug: 'power-calculator',
    name: 'Калькулятор мощности охлаждения/отопления',
    description: 'Предварительный расчёт требуемой мощности в кВт и подбор реальных товаров OhmX.am по наличию.',
    cta: 'Открыть калькулятор',
    href: '/tools/power-calculator',
  },
  {
    slug: 'warm-floor',
    name: 'Подбор электрического тёплого пола',
    description: 'Расчёт кабелей, матов, монтажной ленты, терморегуляторов и аксессуаров.',
    cta: 'Открыть калькулятор',
    href: '/tools/warm-floor',
  },
  {
    slug: 'warm-floor-project',
    name: 'Проект тёплого пола',
    description: 'Несколько помещений: инженерный расчёт, подбор оборудования, спецификация по комнатам, закупочная ведомость и смета.',
    cta: 'Открыть проектный калькулятор',
    href: '/tools/warm-floor/project',
  },
  {
    slug: 'building-project',
    name: 'Инженерный проект объекта',
    description: 'Квартира, дом или коммерческий объект: помещения, параметры, подтверждённая модель здания.',
    cta: 'Открыть проект объекта',
    href: '/tools/building-project',
  },
];

export function ToolsPage() {
  const { t } = useTranslation();
  const localizedDefaultTools = useMemo(() => DEFAULT_TOOLS.map((tool) => ({
    ...tool,
    name: t(`tools.items.${tool.slug}.name`, { defaultValue: tool.name }),
    description: t(`tools.items.${tool.slug}.description`, { defaultValue: tool.description }),
    cta: t(`tools.items.${tool.slug}.cta`, { defaultValue: tool.cta || 'Open' }),
  })), [t]);
  const [tools, setTools] = useState<ToolItem[]>(localizedDefaultTools);
  useEffect(() => {
    api<ToolItem[]>('/tools')
      .then((items) => {
        const apiItems = Array.isArray(items) ? items : [];
        // Merge: keep API order/content, append local-only tools (e.g. project calculator) missing from API.
        const bySlug = new Map<string, ToolItem>();
        for (const tool of localizedDefaultTools) bySlug.set(tool.slug, tool);
        for (const tool of apiItems) {
          const fallback = bySlug.get(tool.slug);
          bySlug.set(tool.slug, {
            ...fallback,
            ...tool,
            name: tool.name || fallback?.name || tool.slug,
            description: tool.description || fallback?.description || '',
            href: tool.href || fallback?.href,
            cta: tool.cta || fallback?.cta,
          });
        }
        // Preserve preferred order from defaults, then any unknown API slugs
        const ordered: ToolItem[] = [];
        const seen = new Set<string>();
        for (const d of localizedDefaultTools) {
          const item = bySlug.get(d.slug);
          if (item) {
            ordered.push(item);
            seen.add(d.slug);
          }
        }
        for (const [slug, item] of bySlug) {
          if (!seen.has(slug)) ordered.push(item);
        }
        setTools(ordered.length ? ordered : localizedDefaultTools);
      })
      .catch(() => setTools(localizedDefaultTools));
  }, [localizedDefaultTools]);

  return (
    <div className="page space-y-4">
      <Breadcrumbs items={[{ label: t('common.labels.home'), to: '/' }, { label: t('tools.breadcrumb') }]} />
      <div className="rounded-[28px] border border-line bg-surface p-4 md:p-6">
        <h1 className="text-3xl font-bold text-fg-strong">{t('tools.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-fg-muted">{t('tools.description')}</p>
      </div>

      <section className="space-y-3">
        <div className="grid gap-3 md:grid-cols-2">
          {tools.map((tool) => <ToolCard key={tool.slug} tool={tool} />)}
        </div>
      </section>
    </div>
  );
}
