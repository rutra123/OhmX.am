import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { requireAdmin } from '../middleware/auth.js';
import { db } from '../db.js';
import { applyProductsCsv, previewProductsCsv } from '../utils/importProducts.js';
import { dataRoot, storageRoot } from '../paths.js';

const router = Router();
const importRoot = path.join(dataRoot, 'imports');
const templatePath = path.join(importRoot, 'templates/ohmx-products-template.csv');

const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const documentExtensions = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx']);
const importExtensions = new Set(['.csv']);

function uploadLimitMb(kind: 'images' | 'documents' | 'imports') {
  const fallback = kind === 'images' ? 10 : kind === 'imports' ? 50 : 25;
  const configured = Number(process.env.MAX_UPLOAD_MB || fallback);
  const mb = Number.isFinite(configured) && configured > 0 ? configured : fallback;
  return mb * 1024 * 1024;
}

function safeFilename(original: string) {
  const ext = path.extname(original).toLowerCase();
  const base = path.basename(original, ext).replace(/[^a-zA-Z0-9а-яА-ЯёЁ._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'file';
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `${unique}-${base}${ext}`;
}

function allowedForKind(kind: 'images' | 'documents' | 'imports') {
  if (kind === 'images') return imageExtensions;
  if (kind === 'documents') return documentExtensions;
  return importExtensions;
}

function makeStorage(kind: 'images' | 'documents' | 'imports') {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = kind === 'images'
          ? path.join(storageRoot, 'images')
          : kind === 'documents'
            ? path.join(storageRoot, 'docs')
            : path.join(importRoot, 'logs');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (_req, file, cb) => cb(null, safeFilename(file.originalname)),
    }),
    limits: { fileSize: uploadLimitMb(kind) },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowedForKind(kind).has(ext)) return cb(new Error(`Unsupported file type: ${ext || 'unknown'}`));
      return cb(null, true);
    },
  });
}

const imgUpload = makeStorage('images');
const docUpload = makeStorage('documents');
const importUpload = makeStorage('imports');

function handleUploadError(error: any, res: any) {
  if (!error) return false;
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    res.status(400).json({ error: 'File exceeds upload size limit' });
    return true;
  }
  res.status(400).json({ error: error.message || 'Upload failed' });
  return true;
}

router.post('/products/:id/images', requireAdmin, (req, res) => {
  imgUpload.array('files', 10)(req, res, (error: any) => {
    if (handleUploadError(error, res)) return;
    const files = (req.files as Express.Multer.File[]) || [];
    for (const [index, file] of files.entries()) {
      db.prepare('INSERT INTO product_images (product_id,image_url,alt_text,is_cover,sort_order) VALUES (?,?,?,?,?)').run(req.params.id, `/storage/images/${file.filename}`, file.originalname, index === 0 ? 1 : 0, index + 1);
    }
    res.json({ uploaded: files.length });
  });
});

router.post('/products/:id/documents', requireAdmin, (req, res) => {
  docUpload.array('files', 10)(req, res, (error: any) => {
    if (handleUploadError(error, res)) return;
    const files = (req.files as Express.Multer.File[]) || [];
    for (const [index, file] of files.entries()) {
      db.prepare('INSERT INTO product_documents (product_id,document_name,document_type,file_url,file_extension,file_size,language,version,is_public,sort_order) VALUES (?,?,?,?,?,?, ?, ?,1,?)').run(req.params.id, file.originalname, 'other', `/storage/docs/${file.filename}`, path.extname(file.originalname).replace('.', ''), file.size, 'ru', '1.0', index + 1);
    }
    res.json({ uploaded: files.length });
  });
});

router.post('/brands/:id/logo', requireAdmin, (req, res) => {
  imgUpload.single('file')(req, res, (error: any) => {
    if (handleUploadError(error, res)) return;
    if (!req.file) return res.status(400).json({ error: 'File not uploaded' });
    const logoUrl = `/storage/images/${req.file.filename}`;
    db.prepare('UPDATE brands SET logo_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(logoUrl, req.params.id);
    res.json({ logo_url: logoUrl });
  });
});

router.post('/categories/:id/image', requireAdmin, (req, res) => {
  imgUpload.single('file')(req, res, (error: any) => {
    if (handleUploadError(error, res)) return;
    if (!req.file) return res.status(400).json({ error: 'File not uploaded' });
    const imageUrl = `/storage/images/${req.file.filename}`;
    db.prepare('UPDATE categories SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(imageUrl, req.params.id);
    res.json({ image_url: imageUrl });
  });
});

router.get('/import/products-csv/template', requireAdmin, (_req, res) => {
  res.download(templatePath, 'ohmx-products-template.csv');
});

router.post('/import/products-csv/preview', requireAdmin, (req, res) => {
  importUpload.single('file')(req, res, (error: any) => {
    if (handleUploadError(error, res)) return;
    if (!req.file) return res.status(400).json({ error: 'CSV файл не загружен' });
    const preview = previewProductsCsv(req.file.path, {
      createMissingBrands: String(req.body.createMissingBrands || '') === 'true',
      createMissingCategories: String(req.body.createMissingCategories || '') === 'true',
    });
    res.json(preview);
  });
});

router.post('/import/products-csv/apply', requireAdmin, (req, res) => {
  importUpload.single('file')(req, res, (error: any) => {
    if (handleUploadError(error, res)) return;
    if (!req.file) return res.status(400).json({ error: 'CSV файл не загружен' });
    try {
      const result = applyProductsCsv(req.file.path, {
        createMissingBrands: String(req.body.createMissingBrands || '') === 'true',
        createMissingCategories: String(req.body.createMissingCategories || '') === 'true',
      });
      return res.json(result);
    } catch (importError: any) {
      return res.status(400).json({ error: importError.message || 'Import failed' });
    }
  });
});

export default router;
