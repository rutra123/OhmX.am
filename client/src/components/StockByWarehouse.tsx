import { useTranslation } from 'react-i18next';

export function StockByWarehouse({ stock }: { stock: any[] }) {
  const { t } = useTranslation();

  return (
    <div className="panel p-4">
      <h3 className="text-xl font-semibold">{t('stock.title')}</h3>
      <div className="mt-4 space-y-2">
        {stock.map((item) => (
          <div key={item.warehouse_id} className="flex items-center justify-between rounded-xl border border-line bg-card px-4 py-3">
            <div>{item.warehouse_name}</div>
            <div className={item.available_quantity > 0 ? 'text-ok' : 'text-warn'}>
              {item.available_quantity > 0 ? t('common.fallbacks.inStock') : t('common.fallbacks.preorder')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
