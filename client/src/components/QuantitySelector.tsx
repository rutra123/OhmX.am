import { useTranslation } from 'react-i18next';

const MAX_QUANTITY = 9999;

export function QuantitySelector({ value, onChange, size = 'md', max = MAX_QUANTITY }: {
  value: number;
  onChange: (n: number) => void;
  size?: 'sm' | 'md';
  max?: number;
}) {
  const { t } = useTranslation();
  const clamp = (n: number) => Math.min(max, Math.max(1, Math.floor(Number.isFinite(n) ? n : 1)));
  const buttonClass = size === 'sm' ? 'h-9 w-9 text-base' : 'h-11 w-11 text-lg';
  const inputClass = size === 'sm' ? 'h-9 w-10 text-sm' : 'h-11 w-12 text-base';

  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-card" role="group" aria-label={t('common.quantity.ariaLabel')}>
      <button
        type="button"
        className={`${buttonClass} rounded-l-xl text-fg-soft transition hover:text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
        onClick={() => onChange(clamp(value - 1))}
        disabled={value <= 1}
        aria-label={t('common.quantity.decrease')}
      >
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={max}
        value={value}
        onChange={(event) => onChange(clamp(Number(event.target.value)))}
        onFocus={(event) => event.target.select()}
        className={`${inputClass} appearance-none border-0 bg-transparent p-0 text-center font-semibold text-fg-strong [-moz-appearance:textfield] focus:outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
        aria-label={t('common.quantity.ariaLabel')}
      />
      <button
        type="button"
        className={`${buttonClass} rounded-r-xl text-fg-soft transition hover:text-primary disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary`}
        onClick={() => onChange(clamp(value + 1))}
        disabled={value >= max}
        aria-label={t('common.quantity.increase')}
      >
        +
      </button>
    </div>
  );
}
