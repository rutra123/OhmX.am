#!/usr/bin/env python3
"""Independent verification of catalog/ against the source database (read-only).

Usage: python3 -I scripts/verify_public_catalog_export.py --db PATH --catalog DIR [--report FILE]
Exit status 0 only if every check passes.
"""
import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys


def load(path):
    with open(path, encoding='utf-8') as f:
        return [json.loads(l) for l in f]


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for c in iter(lambda: f.read(1 << 20), b''):
            h.update(c)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', required=True)
    ap.add_argument('--catalog', required=True)
    ap.add_argument('--report')
    a = ap.parse_args()
    cat = os.path.realpath(a.catalog)
    man = json.load(open(os.path.join(cat, 'manifest.json'), encoding='utf-8'))
    con = sqlite3.connect('file:%s?mode=ro' % os.path.realpath(a.db), uri=True)
    con.text_factory = lambda b: b.decode('utf-8')
    con.execute('BEGIN')
    q = lambda s: con.execute(s).fetchall()
    checks = []

    def check(name, ok, detail=''):
        checks.append({'check': name, 'ok': bool(ok), 'detail': str(detail)})

    T = {t: load(os.path.join(cat, v['file'])) for t, v in man['tables'].items()}

    # 1. counts vs database (full scope; product_documents keeps its public filter)
    flt = {'product_documents': 'WHERE is_public=1 AND deleted_at IS NULL'}
    for t in man['tables']:
        n = q('SELECT count(*) FROM "%s" %s' % (t, flt.get(t, '')))[0][0]
        check('count %s == db' % t, len(T[t]) == n, '%d export / %d db' % (len(T[t]), n))
    check('manifest records match files', all(len(T[t]) == v['records'] for t, v in man['tables'].items()))

    # 2. nothing silently omitted: ids and statuses
    all_ids = {r[0] for r in q('SELECT id FROM products')}
    exp_ids = {r['id'] for r in T['products']}
    check('products: exported ids == all db ids', exp_ids == all_ids, '%d/%d' % (len(exp_ids), len(all_ids)))
    for t in ('brands', 'categories', 'series'):
        check('%s: exported ids == all db ids' % t, {r['id'] for r in T[t]} == {r[0] for r in q('SELECT id FROM %s' % t)})
    st = lambda rows: sorted((r['is_active'], 1) for r in rows)
    check('product active/inactive preserved', sum(r['is_active'] for r in T['products']) == q('SELECT sum(is_active) FROM products')[0][0],
          '%d active, %d inactive' % (sum(1 for r in T['products'] if r['is_active']), sum(1 for r in T['products'] if not r['is_active'])))
    check('brand active/inactive preserved', sum(r['is_active'] for r in T['brands']) == q('SELECT sum(is_active) FROM brands')[0][0],
          '%d active, %d inactive' % (sum(1 for r in T['brands'] if r['is_active']), sum(1 for r in T['brands'] if not r['is_active'])))
    cat_ids = {r['id'] for r in T['categories']}

    # 3. record-level equality for EVERY exported column of EVERY table
    for table in man['tables']:
        cols = man['tables'][table]['columns']
        import collections
        dbc = collections.Counter(tuple(r) for r in q('SELECT %s FROM "%s"' % (', '.join('"%s"' % c for c in cols), table)))
        exc = collections.Counter(tuple(r[c] for c in cols) for r in T[table])
        bad = sum(((dbc - exc) + (exc - dbc)).values())
        check('row-level equality %s' % table, bad == 0, '%d mismatches' % bad)
    # approved commercial fields present and unchanged
    pc = man['tables']['products']['columns']
    for col in ('stock_quantity', 'supplier_reference', 'price_amd', 'price_tax_included'):
        check('approved field present: products.%s' % col, col in pc)
    dbp = {r[0]: r for r in q('SELECT id, stock_quantity, supplier_reference, price_amd, price_tax_included FROM products')}
    badf = sum(1 for r in T['products'] if (r['id'], r['stock_quantity'], r['supplier_reference'], r['price_amd'], r['price_tax_included']) != tuple(dbp[r['id']]))
    check('approved fields identical to db (all products)', badf == 0, '%d mismatches' % badf)
    check('no withheld columns', man['withheld_columns'] == {})

    # 4. referential integrity within the export
    brands = {r['id'] for r in T['brands']}
    series = {r['id'] for r in T['series']}
    P = T['products']
    check('FK products.brand_id', all(p['brand_id'] is None or p['brand_id'] in brands for p in P))
    check('FK products.category_id', all(p['category_id'] is None or p['category_id'] in cat_ids for p in P))
    check('FK products.primary_category_id', all(p['primary_category_id'] is None or p['primary_category_id'] in cat_ids for p in P))
    missing_series = sorted({p['series_id'] for p in P if p['series_id'] is not None and p['series_id'] not in series})
    check('FK products.series_id', not missing_series, 'dangling series ids: %s' % missing_series[:10])
    check('FK categories.parent_id', all(c['parent_id'] is None or c['parent_id'] in cat_ids for c in T['categories']))
    check('FK product_categories', all(r['product_id'] in exp_ids and r['category_id'] in cat_ids for r in T['product_categories']))
    for t in ('product_features', 'product_images', 'product_attributes', 'engineering_value', 'engineering_product_profile', 'product_documents'):
        check('FK %s.product_id' % t, all(r['product_id'] in exp_ids for r in T[t]))
    check('FK relationships', all(r['source_product_id'] in exp_ids and r['target_product_id'] in exp_ids for r in T['product_relationships']))
    params = {r['parameter_id'] for r in T['engineering_parameter']}
    srcs = {r['source_id'] for r in T['engineering_source']}
    sets = {r['condition_set_id'] for r in T['engineering_condition_set']}
    check('FK engineering_value refs', all(r['parameter_id'] in params and (r['source_id'] is None or r['source_id'] in srcs)
                                           and (r['condition_set_id'] is None or r['condition_set_id'] in sets) for r in T['engineering_value']))

    # 5. duplicate identifiers
    for t, k in (('products', 'id'), ('products', 'sku'), ('products', 'slug'), ('categories', 'id'), ('brands', 'id'), ('series', 'id'),
                 ('product_images', 'id'), ('product_features', 'id')):
        vals = [r[k] for r in T[t] if r[k] is not None]
        check('unique %s.%s' % (t, k), len(vals) == len(set(vals)))
    pcs = [(r['product_id'], r['category_id']) for r in T['product_categories']]
    check('unique product_categories pairs', len(pcs) == len(set(pcs)))

    # 6. private tables absent
    files = set(os.listdir(os.path.join(cat, 'data')))
    private = ('orders', 'order_items', 'admin_users', 'app_settings', 'user_activity_events', 'user_context_documents', 'import_logs', 'stock', 'warehouses', 'relationship_review_queue', 'relationship_rules', 'series_normalization')
    check('private/operational tables absent', not any(t + '.jsonl' in files for t in private))

    # 7. checksums + deterministic re-hash
    for t, v in man['tables'].items():
        check('sha256 %s' % t, sha(os.path.join(cat, v['file'])) == v['sha256'])
    check('sha256 asset-manifest', sha(os.path.join(cat, 'asset-manifest.tsv')) == man['images']['asset_manifest_sha256'])

    # 8. images
    rows = [l.rstrip('\n').split('\t') for l in open(os.path.join(cat, 'asset-manifest.tsv'), encoding='utf-8')][1:]
    badimg = [r[0] for r in rows if r[3] != 'OK' or not os.path.isfile(os.path.join(cat, 'storage', r[0][len('/storage/'):]))
              or sha(os.path.join(cat, 'storage', r[0][len('/storage/'):])) != r[2]]
    check('all referenced assets present with matching sha256', not badimg, '%d referenced, %d bad' % (len(rows), len(badimg)))
    refd = {r['image_url'] for r in T['product_images']}
    check('every product_images row has file', refd <= {r[0] for r in rows})
    extra_path = os.path.join(cat, 'extra-assets-manifest.tsv')
    extra = [l.rstrip('\n').split('\t') for l in open(extra_path, encoding='utf-8')][1:] if os.path.isfile(extra_path) else []
    copied = [r for r in extra if r[4] == 'copy']
    bad_extra = [r[5] for r in copied if not os.path.isfile(os.path.join(cat, r[5])) or sha(os.path.join(cat, r[5])) != r[2]]
    check('extra assets copied with matching sha256', not bad_extra, '%d copied, %d bad, %d excluded/reported' % (len(copied), len(bad_extra), len(extra) - len(copied)))
    ondisk = sum(len(fs) for sub in ('storage', 'legacy-media') for _, _, fs in os.walk(os.path.join(cat, sub)))
    check('no unmanifested files in media dirs', ondisk == len(rows) + len(copied), '%d on disk / %d referenced + %d extra' % (ondisk, len(rows), len(copied)))

    # 9. content hygiene (counts only, no values)
    blob = '\n'.join(open(os.path.join(cat, v['file']), encoding='utf-8').read() for v in man['tables'].values())
    pats = {'email': r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'private-key': r'-----BEGIN [A-Z ]*PRIVATE KEY-----',
            'ghp/sk token': r'\b(ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b', 'machine-path': r'/data/projects|/home/art',
            'phone-like': r'\+\d{3}[ -]?\(?\d{2}\)?[ -]?\d{2}[ -]?\d{2}[ -]?\d{2}'}
    hygiene = {k: len(re.findall(p, blob)) for k, p in pats.items()}

    fails = [c for c in checks if not c['ok']]
    res = {'checks_total': len(checks), 'checks_failed': len(fails), 'failed': fails, 'hygiene_match_counts': hygiene, 'checks': checks}
    if a.report:
        with open(a.report, 'w', encoding='utf-8') as f:
            json.dump(res, f, ensure_ascii=False, indent=1)
    print(json.dumps({k: v for k, v in res.items() if k != 'checks'}, ensure_ascii=False, indent=1))
    for c in checks:
        print(('PASS ' if c['ok'] else 'FAIL ') + c['check'] + (' | ' + c['detail'] if c['detail'] else ''))
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
