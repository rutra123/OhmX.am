import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ManagedImage } from '../../../../components/ManagedImage';
import { catalogIndex } from '../../equipment/selection/catalogIndex';
import { shortProductName } from '../../equipment/selection/shortName';
import type { ChoiceOption, LineChoice } from '../../equipment/selection/choices';
import type { CatalogProduct } from '../../equipment/equipmentEngine';

/**
 * Product picker for one "Нужно выбрать" position: a compact trigger (selected product with photo, or a
 * "Выбрать из каталога" button) and a mini-catalog dialog with photo cards. Cards show the short model
 * name, the quantity this room needs, price and availability; the full catalog name is the tooltip.
 */
interface Props {
  choice: LineChoice;
  /** Position name, used as the dialog title. */
  title: string;
  catalog: Map<string, CatalogProduct | null> | null;
  formatAmd: (n: number) => string;
  selected: ChoiceOption | null;
  triggerId: string;
  onChoose: (value: string | null) => void;
}

/** "Name — 3 шт." / "Name — нужно 8 секций": the quantity text after the name. */
function quantityText(o: ChoiceOption): string {
  const tail = o.label.split(' — ').slice(1).join(' — ').trim();
  if (tail) return tail;
  return o.quantity != null ? `${o.quantity} шт.` : '';
}

function useCardData(o: ChoiceOption, catalog: Props['catalog'], formatAmd: Props['formatAmd']) {
  const product = o.sku ? catalog?.get(o.sku) ?? null : null;
  const profile = o.sku ? catalogIndex().get(o.sku) : undefined;
  const fullName = product?.name || profile?.name || o.label;
  const short = shortProductName(fullName, profile?.brand ?? null);
  const price = product?.priceAmd != null ? formatAmd(product.priceAmd * (o.quantity ?? 1)) : product ? 'цена по запросу' : '';
  return { product, fullName, short, price, qty: quantityText(o) };
}

function StockChip({ product }: { product: CatalogProduct | null }) {
  if (!product || product.inStock == null) return null;
  return <span className={`bp-pick-chip ${product.inStock ? 'ok' : ''}`}>{product.inStock ? 'в наличии' : 'под заказ'}</span>;
}

function PickCard({ o, active, catalog, formatAmd, onPick }: { o: ChoiceOption; active: boolean; catalog: Props['catalog']; formatAmd: Props['formatAmd']; onPick: () => void }) {
  const d = useCardData(o, catalog, formatAmd);
  return (
    <li className={`bp-pick-card${active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}>
      <button type="button" className="bp-pick-main" disabled={o.disabled} aria-pressed={active} onClick={onPick} title={d.fullName}>
        <span className="bp-pick-photo">
          <ManagedImage thumb src={d.product?.image} alt="" variant="product" placeholderTitle={d.short.title || o.label} placeholderSubtitle={d.short.caption} className="bp-pick-img" />
        </span>
        <span className="bp-pick-title">{d.short.title || o.label}</span>
        {d.short.variant && <span className="bp-pick-variant">{d.short.variant}</span>}
        <span className="bp-pick-caption">{d.short.caption}</span>
        <span className="bp-pick-meta">
          {d.qty && !o.disabled && <span className="bp-pick-chip qty">{d.qty}</span>}
          <StockChip product={d.product} />
          {d.price && !o.disabled && <span className="bp-pick-price">{d.price}</span>}
        </span>
        {o.detail && <span className="bp-pick-detail">{o.detail}</span>}
        {active && <span className="bp-pick-flag">Выбрано</span>}
      </button>
      {d.product?.slug && <a className="bp-pick-link" href={`/product/${d.product.slug}`} target="_blank" rel="noreferrer">Карточка товара</a>}
    </li>
  );
}

export function ProductChoicePicker({ choice, title, catalog, formatAmd, selected, triggerId, onChoose }: Props) {
  const [open, setOpen] = useState(false);
  const [onlyStock, setOnlyStock] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const products = useMemo(() => choice.options.filter((o) => o.kind === 'product'), [choice.options]);
  const decisions = useMemo(() => choice.options.filter((o) => o.kind !== 'product'), [choice.options]);
  const stockKnown = products.some((o) => (o.sku ? catalog?.get(o.sku)?.inStock : null) === true);
  const shown = onlyStock ? products.filter((o) => (o.sku ? catalog?.get(o.sku)?.inStock : null) === true) : products;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      triggerRef.current?.focus();
    };
  }, [open]);

  const close = () => setOpen(false);
  const pick = (id: string | null) => { onChoose(id); close(); };

  const selData = useCardData(selected ?? { id: '', label: '', kind: 'value' }, catalog, formatAmd);
  const selectedIsProduct = selected?.kind === 'product';

  return (
    <div className="bp-pick">
      <div className="bp-pick-trigger-row">
        {selectedIsProduct && selected && (
          <span className="bp-pick-thumb" title={selData.fullName}>
            <ManagedImage thumb src={selData.product?.image} alt="" variant="product" placeholderTitle={selData.short.title} placeholderSubtitle={selData.short.caption} className="bp-pick-img" />
          </span>
        )}
        <span className="bp-pick-current">
          {selected ? (
            selectedIsProduct ? (
              <>
                <strong>{selData.short.title}</strong>
                <span className="bp-muted">{[selData.short.variant, selData.short.caption, selData.qty, selData.price].filter(Boolean).join(' · ')}</span>
              </>
            ) : <strong>{selected.label}</strong>
          ) : <span className="bp-muted">Не выбрано</span>}
        </span>
        <button ref={triggerRef} id={triggerId} type="button" className={`bp-pick-trigger${selected ? '' : ' is-primary'}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {selected ? 'Изменить' : products.length ? 'Выбрать из каталога' : 'Выбрать'}
        </button>
      </div>

      {open && createPortal(
        // .bp-wrap is a layout container (position:fixed inside it would be relative to it) and owns the design tokens:
        // the dialog is rendered under <body> in its own token scope.
        <div className="bp-wrap bp-pick-backdrop" role="presentation" onClick={close}>
          <div className="bp-pick-dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
            <div className="bp-pick-head">
              <div>
                <strong>{title}</strong>
                <div className="bp-muted">{products.length ? `Из каталога OhmX: ${products.length}` : 'Подходящих товаров в каталоге нет'}</div>
              </div>
              <button ref={closeRef} type="button" className="bp-pick-close" onClick={close} aria-label="Закрыть">×</button>
            </div>
            {products.length > 0 && stockKnown && (
              <label className="bp-pick-filter">
                <input type="checkbox" checked={onlyStock} onChange={(e) => setOnlyStock(e.target.checked)} /> Только в наличии
              </label>
            )}
            {shown.length > 0 && (
              <ul className="bp-pick-grid">
                {shown.map((o) => <PickCard key={o.id} o={o} active={selected?.id === o.id} catalog={catalog} formatAmd={formatAmd} onPick={() => pick(o.id)} />)}
              </ul>
            )}
            {products.length > 0 && shown.length === 0 && <div className="bp-muted">В наличии подходящих нет — снимите фильтр, чтобы увидеть товары под заказ.</div>}
            {decisions.length > 0 && (
              <div className="bp-pick-decisions">
                {decisions.map((o) => (
                  <button key={o.id} type="button" className={`bp-pick-decision${selected?.id === o.id ? ' is-active' : ''}`} disabled={o.disabled} onClick={() => pick(o.id)}>{o.label}</button>
                ))}
              </div>
            )}
            {selected && <button type="button" className="bp-pick-clear" onClick={() => pick(null)}>Снять выбор</button>}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
