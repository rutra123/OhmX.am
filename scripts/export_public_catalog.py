#!/usr/bin/env python3
"""Deterministic public-catalog export from the OhmX.am SQLite database.

Read-only: the database is opened with mode=ro inside one read transaction, so
the export is a consistent snapshot. Nothing is written next to the database or
the storage root. Customer, order, credential and operational tables are never
read. Withheld columns, if any, are listed in the manifest.

Usage:
  python3 -I scripts/export_public_catalog.py --db PATH --storage-root PATH --out DIR
"""
import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import sys

# Columns withheld from the export. Empty: the owner approved stock_quantity,
# supplier_reference and both price columns for publication.
WITHHELD = {}

# table -> (filter SQL appended to "FROM <table> AS t", order-by)
# Full scope: inactive products/brands and every dependent row are included.
# Only product_documents keeps a visibility filter (non-public documents are private).
SELECTS = {
    'products': ('', 't.id'),
    'brands': ('', 't.id'),
    'categories': ('', 't.id'),
    'series': ('', 't.id'),
    'product_categories': ('', 't.product_id, t.category_id'),
    'product_features': ('', 't.id'),
    'product_attributes': ('', 't.id'),
    'product_images': ('', 't.id'),
    'product_documents': ('WHERE t.is_public = 1 AND t.deleted_at IS NULL', 't.id'),
    'product_relationships': ('', 't.id'),
    'engineering_equipment_type': ('', 't.equipment_type'),
    'engineering_parameter': ('', 't.parameter_id'),
    'engineering_source_type': ('', 't.source_type'),
    'engineering_source': ('', 't.source_id'),
    'engineering_condition_key': ('', 't.condition_key'),
    'engineering_condition_set': ('', 't.condition_set_id'),
    'engineering_condition_entry': ('', 't.condition_entry_id'),
    'engineering_product_profile': ('', 't.product_id'),
    'engineering_value': ('', 't.value_id'),
}


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--storage-root', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()

    db = os.path.realpath(a.db)
    storage = os.path.realpath(a.storage_root)
    out = os.path.realpath(a.out)
    if out.startswith(os.path.dirname(db) + os.sep) or out.startswith(storage + os.sep):
        sys.exit('refusing to write inside the database or storage directory')
    data_dir = os.path.join(out, 'data')
    os.makedirs(data_dir, exist_ok=True)

    con = sqlite3.connect('file:%s?mode=ro' % db, uri=True)
    con.text_factory = lambda b: b.decode('utf-8')
    con.execute('BEGIN')
    manifest = {'format': 'jsonl-utf8', 'tables': {}, 'withheld_columns': WITHHELD, 'images': {}}
    rows_by_table = {}

    for table, (flt, order) in SELECTS.items():
        cols = [r[1] for r in con.execute('PRAGMA table_info("%s")' % table)]
        keep = [c for c in cols if c not in WITHHELD.get(table, {})]
        sql = 'SELECT %s FROM "%s" AS t %s ORDER BY %s' % (', '.join('t."%s"' % c for c in keep), table, flt, order)
        path = os.path.join(data_dir, table + '.jsonl')
        h = hashlib.sha256()
        n = 0
        rows = []
        with open(path, 'w', encoding='utf-8', newline='\n') as f:
            for row in con.execute(sql):
                for v in row:
                    if isinstance(v, bytes):
                        sys.exit('unexpected BLOB in %s' % table)
                line = json.dumps(dict(zip(keep, row)), ensure_ascii=False, separators=(',', ':')) + '\n'
                f.write(line)
                h.update(line.encode('utf-8'))
                n += 1
                rows.append(dict(zip(keep, row)))
        rows_by_table[table] = rows
        manifest['tables'][table] = {'file': 'data/%s.jsonl' % table, 'records': n, 'sha256': h.hexdigest(),
                                     'columns': keep, 'withheld': sorted(WITHHELD.get(table, {}))}
    con.execute('ROLLBACK')
    con.close()

    # image / document references
    refs = {}

    def ref(url, kind):
        if url:
            refs.setdefault(url, set()).add(kind)
    for r in rows_by_table['product_images']:
        ref(r['image_url'], 'product_image')
    for r in rows_by_table['categories']:
        ref(r['image_url'], 'category_image')
    for r in rows_by_table['brands']:
        ref(r['logo_url'], 'brand_logo')
    for r in rows_by_table['series']:
        ref(r['image_url'], 'series_image')
    for r in rows_by_table['product_documents']:
        ref(r['file_url'], 'product_document')

    img_rows = []
    missing = []
    external = []
    copied_bytes = 0
    for url in sorted(refs):
        if url.startswith('/storage/'):
            rel = url[len('/storage/'):]
            src = os.path.realpath(os.path.join(storage, rel))
            if not src.startswith(storage + os.sep):
                sys.exit('path escapes storage root: %s' % url)
            if not os.path.isfile(src):
                missing.append(url)
                img_rows.append((url, '', '', 'MISSING', ','.join(sorted(refs[url]))))
                continue
            dst = os.path.join(out, 'storage', rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            digest = sha256_file(src)
            if not (os.path.isfile(dst) and sha256_file(dst) == digest):
                shutil.copyfile(src, dst)
            size = os.path.getsize(dst)
            copied_bytes += size
            img_rows.append((url, str(size), digest, 'OK', ','.join(sorted(refs[url]))))
        else:
            external.append(url)
            img_rows.append((url, '', '', 'EXTERNAL', ','.join(sorted(refs[url]))))
    with open(os.path.join(out, 'asset-manifest.tsv'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('url\tbytes\tsha256\tstatus\treferenced_as\n')
        for r in img_rows:
            f.write('\t'.join(r) + '\n')
    digests = {}
    for r in img_rows:
        if r[3] == 'OK':
            digests.setdefault(r[2], []).append(r[0])
    dup_groups = [v for v in digests.values() if len(v) > 1]
    manifest['images'] = {
        'referenced_urls': len(refs), 'copied_files': sum(1 for r in img_rows if r[3] == 'OK'),
        'copied_bytes': copied_bytes, 'missing': missing, 'external': external,
        'duplicate_content_groups': len(dup_groups), 'duplicate_content_extra_files': sum(len(v) - 1 for v in dup_groups),
        'asset_manifest_sha256': sha256_file(os.path.join(out, 'asset-manifest.tsv')),
    }
    with open(os.path.join(out, 'manifest.json'), 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    print(json.dumps({t: v['records'] for t, v in manifest['tables'].items()}, indent=1))
    print(json.dumps(manifest['images'], indent=1)[:1500])


if __name__ == '__main__':
    main()
