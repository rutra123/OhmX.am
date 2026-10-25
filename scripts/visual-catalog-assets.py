#!/usr/bin/env python3
"""Build ONLY 13 pilot layers from the supplied ZIP; never edit source PNGs.

No AI processing or mask repair. Verify supplied SHA-256, trim transparent
margins, resize proportionally without upscaling, preserve alpha, encode WebP.
All output locations must be explicit and outside both this checkout and a
caller-supplied protected project root.
"""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile
from PIL import Image

# folder, source stem, visually reviewed alternative, honest managed name
SELECTIONS = [
    ('controllers', '7247', 'birefnet', 'controllers-ecl-comfort-310'),
    ('controllers', '7279', 'inspyrenet', 'controllers-ecl-application-key-a266'),
    ('controllers', '7280', 'birefnet', 'controllers-terminal-panel'),
    ('sensors', '7329', 'birefnet', 'sensors-kp61-capillary'),
    ('sensors', '7332', 'birefnet', 'sensors-kpi36-pressure-switch'),
    ('sensors', '7338', 'birefnet', 'sensors-pressure-gauge'),
    ('sensors', '7335', 'inspyrenet', 'sensors-mbs3000-transmitter'),
    ('thermostats', '7315', 'birefnet', 'thermostats-underfloor-control'),
    ('thermostats', '7309', 'birefnet', 'thermostats-fancoil-display'),
    ('thermostats', '7310', 'inspyrenet', 'thermostats-round-display'),
    ('actuators', '7295', 'birefnet', 'actuators-linear-linkage'),
    ('actuators', '7305', 'birefnet', 'actuators-amb182'),
    ('actuators', '7304', 'birefnet', 'actuators-thermal-cable'),
]


def build(archive, out, report, protected_root):
    project_root = Path(__file__).resolve().parents[1]
    protected_root = protected_root.expanduser().resolve()
    if not protected_root.is_dir():
        raise SystemExit('Protected project root must be an existing directory')
    for target in (out, report):
        resolved_target = target.expanduser().resolve()
        if resolved_target.is_relative_to(project_root) or resolved_target.is_relative_to(protected_root):
            raise SystemExit('Refusing to write inside a protected project checkout')
    before = hashlib.sha256(archive.read_bytes()).hexdigest()
    rows = []
    with zipfile.ZipFile(archive) as bundle:
        manifest = {r['file_path']: r for r in csv.DictReader(io.StringIO(bundle.read('manifest.csv').decode('utf-8-sig')))}
        sums = dict((line.split('  ', 1)[1], line.split('  ', 1)[0]) for line in bundle.read('SHA256SUMS.txt').decode().splitlines())
        for folder, stem, variant, name in SELECTIONS:
            source = f'assets/hvac_automation/{folder}/{stem}_{variant}.png'
            data = bundle.read(source)
            digest = hashlib.sha256(data).hexdigest()
            assert digest == manifest[source]['sha256'] == sums[source], source
            original = Image.open(io.BytesIO(data)).convert('RGBA')
            alpha = original.getchannel('A')
            bbox = alpha.getbbox()
            # 7310 contains invisible alpha 1–3 outliers far outside the disc.
            # Crop that padding only, with a 4px safety margin. Do NOT repaint
            # or threshold the retained alpha pixels; source PNG stays intact.
            if stem == '7310':
                visible = alpha.point(lambda a: 255 if a >= 4 else 0).getbbox()
                assert visible, source
                bbox = (max(0, visible[0] - 4), max(0, visible[1] - 4), min(original.width, visible[2] + 4), min(original.height, visible[3] + 4))
            assert bbox, source
            cropped = original.crop(bbox)
            outputs = []
            for limit in (320, 640):
                image = cropped.copy()
                image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
                target = out / folder / f'{name}-{limit}.webp'
                target.parent.mkdir(parents=True, exist_ok=True)
                image.save(target, 'WEBP', quality=88, method=4, exact=True)
                print(f'Wrote {target.name}: {image.width}x{image.height}', flush=True)
                reopened = Image.open(target)
                assert reopened.size == image.size and 'A' in reopened.getbands()
                outputs.append({'path': str(target), 'width': image.width, 'height': image.height, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
            rows.append({'folder': folder, 'stem': stem, 'variant': variant, 'name': name, 'source': source, 'source_sha256': digest, 'source_bytes': len(data), 'source_dimensions': original.size, 'trim_bbox': bbox, 'outputs': outputs})
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == before
    report.parent.mkdir(parents=True, exist_ok=True)
    report.write_text(json.dumps({'archive_sha256': before, 'webp_quality': 88, 'no_upscale': True, 'rows': rows}, indent=2))
    print(json.dumps({'layers': len(rows), 'derivatives': sum(len(r['outputs']) for r in rows), 'source_bytes': sum(r['source_bytes'] for r in rows), 'large_webp_bytes': sum(r['outputs'][1]['bytes'] for r in rows), 'small_webp_bytes': sum(r['outputs'][0]['bytes'] for r in rows), 'dimensions': {r['stem']: [o['width:height'] if 'width:height' in o else [o['width'], o['height']] for o in r['outputs']] for r in rows}}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--report', type=Path, required=True)
    parser.add_argument('--protected-root', type=Path, required=True, help='project tree that output paths must not modify')
    args = parser.parse_args()
    build(args.archive, args.out, args.report, args.protected_root)
