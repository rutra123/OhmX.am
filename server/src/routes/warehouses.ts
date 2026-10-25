import { Router } from 'express';
import { db } from '../db.js';
import { toPublicWarehouseDto } from '../utils/productDtos.js';
const router = Router();
router.get('/', (_req, res) => {
  const warehouses = db.prepare('SELECT id, name, slug, address, sort_order FROM warehouses WHERE is_active = 1 ORDER BY sort_order').all() as any[];
  res.json(warehouses.map(toPublicWarehouseDto));
});
export default router;
