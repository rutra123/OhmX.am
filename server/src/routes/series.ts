// RECOVERY: parity-first TypeScript source reconstructed from verified production runtime JavaScript.
import { Router } from 'express';
import { db } from '../db.js';
const router = Router();
router.get('/', (req, res) => {
    try {
        const brandId = req.query.brandId ? Number(req.query.brandId) : null;
        const categoryId = req.query.categoryId ? Number(req.query.categoryId) : null;
        const where = ['s.is_active = 1'];
        const params = [];
        if (brandId) {
            where.push('s.brand_id = ?');
            params.push(brandId);
        }
        if (categoryId) {
            where.push('s.category_id = ?');
            params.push(categoryId);
        }
        const rows = db.prepare(`SELECT s.*, b.name as brand_name, c.name_ru as category_name FROM series s LEFT JOIN brands b ON b.id = s.brand_id LEFT JOIN categories c ON c.id = s.category_id WHERE ${where.join(' AND ')} ORDER BY s.name`).all(...params);
        res.json(rows);
    }
    catch (error) {
        console.error('[series] Failed to load series:', error instanceof Error ? error.message : 'Unknown error');
        res.status(500).json({ error: 'Failed to load series' });
    }
});
export default router;
