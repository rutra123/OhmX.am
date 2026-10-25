#!/usr/bin/env python3
"""Bounded, media-only inventory of catalog assets that no exported database row references.

Examines only storage/images, storage/docs, img/ and Baners/ under the project root (read-only),
classifies every file that export_public_catalog.py did not already copy, copies the identifiable
public catalog media byte-for-byte, and records every decision in extra-assets-manifest.tsv.
Run AFTER export_public_catalog.py (needs OUT/asset-manifest.tsv).

Usage: python3 -I scripts/export_extra_catalog_assets.py --project-root PATH --out DIR
"""
import argparse
import hashlib
import os
import re
import shutil
import sys

UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.\w+$')


def magic(b):
    if b[:3] == b'\xff\xd8\xff':
        return 'jpeg'
    if b[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png'
    if b[:4] == b'RIFF' and b[8:12] == b'WEBP':
        return 'webp'
    if b[:6] in (b'GIF87a', b'GIF89a'):
        return 'gif'
    if b[:5] == b'%PDF-':
        return 'pdf'
    if b.lstrip()[:5] == b'<?xml' or b.lstrip()[:4] == b'<svg':
        return 'svg'
    return 'other'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--project-root', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    root = os.path.realpath(a.project_root)
    out = os.path.realpath(a.out)
    if out.startswith(root + os.sep):
        sys.exit('refusing to write inside the project root')

    ref = {}
    for line in list(open(os.path.join(out, 'asset-manifest.tsv'), encoding='utf-8'))[1:]:
        url, _, digest, status, _ = line.rstrip('\n').split('\t')
        if status == 'OK':
            ref[url] = digest
    refhash = set(ref.values())

    rows = []
    for top in ('storage/images', 'storage/docs', 'img', 'Baners'):
        base = os.path.join(root, top)
        for dp, dn, fs in os.walk(base, followlinks=False):
            dn.sort()
            for f in sorted(fs):
                full = os.path.join(dp, f)
                rel = os.path.relpath(full, root)
                if '/' + rel in ref and top.startswith('storage'):
                    continue  # already exported as a referenced asset
                if os.path.islink(full):
                    rows.append((rel, 0, '', 'symlink', 'exclude', ''))
                    continue
                data = open(full, 'rb').read()
                kind, digest = magic(data[:16]), hashlib.sha256(data).hexdigest()
                if top == 'storage/images':
                    if kind == 'other' or kind == 'pdf':
                        cls, act = 'uncertain-non-image', 'exclude'
                    elif UUID.match(f):
                        cls, act = 'unrelated-design-mockup', 'exclude'
                    elif rel.startswith('storage/images/thumbs/'):
                        cls, act = 'derived-thumbnail-of-product-image', 'copy'
                    elif digest in refhash:
                        cls, act = 'duplicate-of-referenced-asset', 'copy'
                    elif f.startswith('root-category-'):
                        cls, act = 'category-art', 'copy'
                    else:
                        cls, act = 'unreferenced-identifiable-catalog-image', 'copy'
                    dest = rel
                elif top == 'storage/docs':
                    cls, act = ('placeholder-document-stub' if len(data) < 1000 else 'uncertain-document'), 'exclude'
                    dest = ''
                elif top == 'img':
                    if kind in ('jpeg', 'png', 'webp', 'gif', 'svg'):
                        cls, act = 'source-series-photo', 'copy'
                    else:
                        cls, act = 'uncertain-non-image', 'exclude'
                    dest = os.path.join('legacy-media', rel)
                else:
                    cls, act, dest = 'non-media-stock-list', 'exclude', ''
                if act == 'copy':
                    target = os.path.join(out, dest)
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    if not (os.path.isfile(target) and hashlib.sha256(open(target, 'rb').read()).hexdigest() == digest):
                        shutil.copyfile(full, target)
                else:
                    dest = ''
                rows.append((rel, len(data), digest, cls, act, dest))

    rows.sort()
    with open(os.path.join(out, 'extra-assets-manifest.tsv'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('source_path\tbytes\tsha256\tclassification\taction\tcatalog_path\n')
        for r in rows:
            f.write('\t'.join(str(x) for x in r) + '\n')
    import collections
    c = collections.Counter((r[3], r[4]) for r in rows)
    for k, v in sorted(c.items()):
        print(k, v)
    print('copied bytes', sum(r[1] for r in rows if r[4] == 'copy'))


if __name__ == '__main__':
    main()
