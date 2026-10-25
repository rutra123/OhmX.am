import React from 'react';
import { Link } from 'react-router-dom';
import { publicCategories } from '../data/publicMenu';

export type HouseholdCard = {
  title: string;
  icon?: string;
  description?: string;
  slugs?: string[];
  isCollapsed?: boolean;
};

export function HouseholdMenuSection({ group }: { group: { id?: string; title: string; icon?: string; cards: HouseholdCard[] } }) {
  const card = group.cards && group.cards[0] ? group.cards[0] : null;
  const slugs = card?.slugs || [];
  const firstSlug = slugs && slugs.length ? slugs[0] : null;

  const mapSlugToTitle = (slug: string) => {
    const found = publicCategories.find((c) => c.slug === slug);
    if (found) return found.title;
    return slug.replace(/-/g, ' ');
  };

  const childLinks = slugs.slice(0, 5).map((s) => ({ slug: s, title: mapSlugToTitle(s) }));

  return (
    <div className="panel p-4 flex flex-col h-full w-full min-w-0">
      <div className="flex items-center gap-3">
        <div className="text-2xl">{group.icon}</div>
        <h3 className="text-lg font-semibold">{group.title}</h3>
      </div>

      {card?.description ? (
        <div className="mt-2 text-sm text-slate-600">{card.description}</div>
      ) : null}

      {/* If collapsed card (like lighting), show only CTA and short desc */}
      {card?.isCollapsed ? (
        <div className="mt-4 mt-auto">
          <Link to={firstSlug ? `/catalog/${firstSlug}` : '/catalog'} className="btn-primary">
            Смотреть раздел
          </Link>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {childLinks.map((l) => (
              <Link key={l.slug} to={`/catalog/${l.slug}`} className="chip bg-card">
                {l.title}
              </Link>
            ))}
          </div>

          <div className="mt-3">
            <Link to={firstSlug ? `/catalog/${firstSlug}` : '/catalog'} className="btn-primary">
              Смотреть раздел
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
