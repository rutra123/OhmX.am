import { EXPORT_GROUP_TITLE as GROUP_TITLES } from '../features/buildingProject/equipment/specExport';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api/client';
import { useStore } from '../store/useStore';

export function CartPage() {
  const { t, i18n } = useTranslation();
  const { cart, updateQty, removeFromCart, clearCart } = useStore();
  const [form, setForm] = useState({ customer_name: '', phone: '', email: '', delivery_type: 'pickup', pickup_warehouse: 'Комитас', comment: '' });
  const [order, setOrder] = useState<any>(null);
  const total = useMemo(() => cart.reduce((sum, item) => sum + item.price * item.quantity, 0), [cart]);
  const numberLocale = i18n.resolvedLanguage === 'hy' ? 'hy-AM' : i18n.resolvedLanguage === 'en' ? 'en-US' : 'ru-RU';

  const submit = async () => {
    const created = await api('/orders', { method: 'POST', body: JSON.stringify({ ...form, items: cart, total_amount: total }) });
    setOrder(created);
    clearCart();
  };

  return (
    <div className="page space-y-4">
      <h1 className="text-3xl font-bold">{t('cart.title')}</h1>
      {!cart.length && !order ? <div className="panel p-4 text-slate-300">{t('cart.empty')}</div> : null}
      {cart.length ? (
        <div className="space-y-3">
          {cart.map((item, index) => (
            <div key={item.productId}>
              {item.group && cart[index - 1]?.group !== item.group ? <div className="mt-2 text-sm font-semibold uppercase tracking-wide text-muted">{(GROUP_TITLES as Record<string, string>)[item.group] ?? item.group}</div> : null}
            <div className="panel flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-semibold">{item.name}</div>
                <div className="text-sm text-muted">{item.sku}{item.unit ? ` · ${item.unit}` : ''}</div>
              </div>
              <div className="flex items-center gap-3">
                <input className="field max-w-24" type="number" value={item.quantity} onChange={(event) => updateQty(item.productId, Number(event.target.value || 1))} />
                {item.unit ? <span className="text-sm text-muted">{item.unit}</span> : null}
                <div>{(item.price * item.quantity).toLocaleString(numberLocale)} AMD</div>
                <button className="btn-secondary" onClick={() => removeFromCart(item.productId)}>{t('cart.remove')}</button>
              </div>
            </div>
            </div>
          ))}
        </div>
      ) : null}
      {cart.length ? (
        <div className="panel grid gap-3 p-4 md:grid-cols-2">
          <input className="field" placeholder={t('cart.fields.name')} value={form.customer_name} onChange={(event) => setForm({ ...form, customer_name: event.target.value })} />
          <input className="field" placeholder={t('cart.fields.phone')} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          <input className="field" placeholder={t('cart.fields.emailOptional')} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          <select className="field" value={form.delivery_type} onChange={(event) => setForm({ ...form, delivery_type: event.target.value })}>
            <option value="pickup">{t('cart.fulfillment.pickup')}</option>
            <option value="delivery">{t('cart.fulfillment.delivery')}</option>
          </select>
          <input className="field" placeholder={t('cart.fields.pickupWarehouse')} value={form.pickup_warehouse} onChange={(event) => setForm({ ...form, pickup_warehouse: event.target.value })} />
          <input className="field md:col-span-2" placeholder={t('cart.fields.comment')} value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} />
          <div className="md:col-span-2 rounded-2xl border border-line bg-card px-4 py-3 text-sm text-slate-300">{t('cart.availabilityNotice')}</div>
          <div className="md:col-span-2 flex items-center justify-between">
            <div className="text-2xl font-bold">{t('cart.total', { amount: total.toLocaleString(numberLocale) })}</div>
            <button className="btn-primary" onClick={submit}>{t('cart.submit')}</button>
          </div>
        </div>
      ) : null}
      {order ? (
        <div className="panel p-4">
          <h2 className="text-2xl font-bold">{t('cart.order.success')}</h2>
          <div className="mt-2">{t('cart.order.number', { number: order.order_number })}</div>
          <button className="mt-3 btn-primary" onClick={() => navigator.clipboard.writeText(order.order_number)}>{t('cart.order.copy')}</button>
        </div>
      ) : null}
    </div>
  );
}
