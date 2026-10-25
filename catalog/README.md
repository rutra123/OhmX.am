# OhmX.am public product catalog export

Deterministic snapshot of the public product catalog, exported read-only from the production
SQLite database by `scripts/export_public_catalog.py` and checked by
`scripts/verify_public_catalog_export.py`. Counts and SHA-256 checksums are in `manifest.json`.

## Layout

- `data/<table>.jsonl` — one JSON object per line, UTF-8, original column names and identifiers,
  sorted by primary key. Armenian, Russian and English text and decimal values are stored as in the database.
- `storage/images/...`, `storage/docs/...` — every file referenced by the exported rows, at the same
  relative path as the site URL (`/storage/images/x.jpg` -> `storage/images/x.jpg`).
- `asset-manifest.tsv` — url, bytes, sha256, status and role of every referenced file.
- `manifest.json` — record counts, checksums, column lists, withheld columns, image summary.

## Tables and joins

| File | Key joins |
|---|---|
| `products` | `brand_id` -> brands, `series_id` -> series, `category_id` / `primary_category_id` -> categories |
| `categories` | `parent_id` -> categories (hierarchy; names in ru / hy / en) |
| `brands`, `series` | `series.brand_id`, `series.category_id` |
| `product_categories` | `product_id`, `category_id` (many-to-many) |
| `product_features` | `product_id`; name / value / unit |
| `product_attributes` | `product_id`; normalized attributes with unit, source and extraction version |
| `product_images` | `product_id`; `image_url` resolves under `storage/` |
| `product_documents` | public documents only |
| `product_relationships` | owner-approved compatibility links between exported products |
| `engineering_*` | engineering parameter schema, sources, condition sets, per-product profiles and values |

## Scope rules

- Included: every row of products (5,306, active and inactive, `is_active` preserved), brands (45, including
  inactive), categories (all, so the hierarchy is complete), series, and every dependent row
  (product categories, features, attributes, images, approved relationships, engineering data).
- Owner-approved commercial fields are included unchanged: `price_amd`, `price_tax_included`,
  `stock_quantity` and `supplier_reference`.
- Not exported (not catalog content): orders, order items, customer data, admin users, application settings,
  activity events, user context documents, import logs, warehouses and per-warehouse stock, and the internal
  relationship review queue.
- Only non-public product documents would be filtered out (`product_documents`); at export time none existed.

## Media

- `storage/` mirrors the site URL space. Files referenced by exported rows are listed in `asset-manifest.tsv`.
- Unreferenced but identifiable catalog media (generated thumbnails, category art, duplicates, series photos)
  are also copied byte-for-byte; every decision, including files deliberately not copied, is in
  `extra-assets-manifest.tsv`. `legacy-media/img/` holds the series photos from the project-root `img/` folder.

## Rights notice

Product photographs, series images and category artwork may be third-party (manufacturer) material.
Redistribution rights have not been confirmed; see the repository publication checklist.

## Reproduce

```
python3 -I scripts/export_public_catalog.py --db <electro.db> --storage-root <storage> --out catalog
python3 -I scripts/export_extra_catalog_assets.py --project-root <project> --out catalog
python3 -I scripts/verify_public_catalog_export.py --db <electro.db> --catalog catalog
```
