import { Router } from 'express';
import { db } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
const MAX_QUANTITY = 999;

type OrderItemInput = {
  productId?: unknown;
  quantity?: unknown;
};

type ProductForOrder = {
  id: number;
  sku: string;
  name_ru: string;
  price_amd: number | null;
  show_price: number | null;
  availability_status: string | null;
  is_active: number;
};

function cleanString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePositiveInteger(value: unknown) {
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return null;
  return number;
}

function validationError(res: any, message: string) {
  return res.status(400).json({ error: message });
}

router.post('/', (req, res) => {
  const body = req.body || {};
  const customerName = cleanString(body.customer_name);
  const phone = cleanString(body.phone);
  const email = cleanString(body.email);
  const comment = cleanString(body.comment);
  const deliveryType = cleanString(body.delivery_type) || 'pickup';
  const pickupWarehouse = cleanString(body.pickup_warehouse);
  const items = Array.isArray(body.items) ? body.items : [];

  if (customerName.length < 2) return validationError(res, 'customer_name is required');
  if (phone.length < 5) return validationError(res, 'phone is required');
  if (!items.length) return validationError(res, 'items must be a non-empty array');
  if (items.length > 100) return validationError(res, 'too many order items');

  const productStmt = db.prepare('SELECT id, sku, name_ru, price_amd, show_price, availability_status, is_active FROM products WHERE id = ? AND is_active = 1');
  const normalizedItems: Array<{ product: ProductForOrder; quantity: number; priceAmd: number; lineTotal: number }> = [];

  for (const [index, rawItem] of (items as OrderItemInput[]).entries()) {
    const productId = parsePositiveInteger(rawItem?.productId);
    const quantity = parsePositiveInteger(rawItem?.quantity);

    if (!productId) return validationError(res, `items[${index}].productId is invalid`);
    if (!quantity || quantity > MAX_QUANTITY) return validationError(res, `items[${index}].quantity must be an integer from 1 to ${MAX_QUANTITY}`);

    const product = productStmt.get(productId) as ProductForOrder | undefined;
    if (!product) return validationError(res, `items[${index}].productId does not exist`);

    const showPrice = Number(product.show_price ?? 1) === 1;
    const dbPrice = Math.max(0, Number(product.price_amd || 0));
    const priceAmd = showPrice ? dbPrice : 0;
    normalizedItems.push({ product, quantity, priceAmd, lineTotal: quantity * priceAmd });
  }

  const totalAmount = normalizedItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const orderNumber = `EK-${Date.now().toString().slice(-8)}`;

  const createOrder = db.transaction(() => {
    const info = db.prepare('INSERT INTO orders (order_number,customer_name,phone,email,delivery_type,pickup_warehouse,comment,total_amount) VALUES (?,?,?,?,?,?,?,?)').run(
      orderNumber,
      customerName,
      phone,
      email,
      deliveryType,
      pickupWarehouse,
      comment,
      totalAmount,
    );
    const orderId = Number(info.lastInsertRowid);
    const insertItem = db.prepare('INSERT INTO order_items (order_id,product_id,sku,product_name,quantity,price_amd,line_total) VALUES (?,?,?,?,?,?,?)');
    for (const item of normalizedItems) {
      insertItem.run(orderId, item.product.id, item.product.sku, item.product.name_ru, item.quantity, item.priceAmd, item.lineTotal);
    }
    return orderId;
  });

  try {
    const orderId = createOrder();
    res.json({ id: orderId, order_number: orderNumber, total_amount: totalAmount });
  } catch {
    res.status(500).json({ error: 'Order could not be created' });
  }
});

router.get('/:id', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(req.params.id);
  res.json({ order, items });
});

export default router;
