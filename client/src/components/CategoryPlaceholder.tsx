import { LayoutGrid, ShoppingCart } from './Icons';

export function CategoryPlaceholder({
  title,
  subtitle,
  variant = 'category',
}: {
  title: string;
  subtitle?: string;
  variant?: 'category' | 'product';
}) {
  const Icon = variant === 'product' ? ShoppingCart : LayoutGrid;

  return (
    <div className="relative h-full w-full overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-black">
      <div
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.18),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(216,46,47,0.24),transparent_34%)]" />
      <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-white">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-3 shadow-[0_0_30px_rgba(15,23,42,0.35)]">
          <Icon className="h-10 w-10 text-slate-100" />
        </div>
        {subtitle ? <div className="text-[10px] uppercase tracking-[0.28em] text-slate-400">{subtitle}</div> : null}
        {title ? <div className="max-w-[12rem] text-sm font-medium text-slate-200">{title}</div> : null}
      </div>
    </div>
  );
}
