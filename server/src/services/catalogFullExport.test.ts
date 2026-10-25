// Unit tests run always. Catalog tests need a DB snapshot (opened read-only) and the image storage:
// OHMX_EXPORT_TEST_DB=<snapshot.db> OHMX_EXPORT_STORAGE_ROOT=<project>/storage npm run test:catalog-full-export
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  CSV_BOM,
  FULL_EXPORT_COLUMNS,
  buildProductRow,
  csvField,
  csvLine,
  exportFilename,
  loadCatalogSnapshot,
  loadCatalogSnapshotPaged,
  readImageInfo,
  engineeringParameterView,
  featureParameterCandidates,
  FLAT_ENGINEERING_PARAMETERS,
  rowValues,
  storageFileFor,
} from './catalogFullExport.js';

/** Minimal RFC 4180 parser (quoted fields, doubled quotes, CRLF inside quotes). */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

test('csv fields: quoted, quotes doubled, line breaks and Armenian/Russian text preserved', () => {
  assert.equal(csvField(null), '""');
  assert.equal(csvField(undefined), '""');
  assert.equal(csvField(0), '"0"');
  assert.equal(csvField(-10.5), '"-10.5"', 'numbers are values, not formulas');
  assert.equal(csvField('say "hi", ok'), '"say ""hi"", ok"');
  assert.equal(csvField('line1\r\nline2'), '"line1\r\nline2"');
  assert.equal(csvField('Միջանկյալ ռելեներ — реле'), '"Միջանկյալ ռելեներ — реле"');
  assert.equal(csvField('00123'), '"00123"', 'leading zeros are kept in the file');
});

test('csv fields: spreadsheet formula injection is neutralised for text', () => {
  for (const value of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) assert.equal(csvField(value).slice(0, 2), `"'`, value);
  assert.equal(csvField('[{"a":1}]'), '"[{""a"":1}]"');
});

test('csv lines round-trip through an RFC 4180 parser', () => {
  const values = ['a,b', 'quote " here', 'multi\r\nline', '', 42];
  const parsed = parseCsv(csvLine(values) + csvLine(['x']));
  assert.deepEqual(parsed, [['a,b', 'quote " here', 'multi\r\nline', '', '42'], ['x']]);
});

test('filename carries date and time', () => {
  assert.equal(exportFilename(new Date(Date.UTC(2026, 9, 23, 7, 5, 9))), 'OHMX_FULL_PRODUCT_CATALOG_2026-10-23_070509.csv');
});

test('image headers: png, gif, webp, jpeg (SOF after other segments); unknown and missing return null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ohmx-export-img-'));
  const write = (name: string, buf: Buffer) => { const file = path.join(dir, name); fs.writeFileSync(file, buf); return file; };
  const png = Buffer.alloc(33); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4); png.writeUInt32BE(1500, 16); png.writeUInt32BE(1200, 20);
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x40, 0x01, 0xf0, 0x00])]);
  const webp = Buffer.alloc(30); webp.write('RIFF', 0); webp.write('WEBP', 8); webp.write('VP8X', 12); webp.writeUIntLE(799, 24, 3); webp.writeUIntLE(599, 27, 3);
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0]), Buffer.from([0x00, 0x10]), Buffer.alloc(14)]);
  const big = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0x13, 0x88]), Buffer.alloc(5000 - 2)]); // 5000-byte APP1 pushes SOF past 4 KB
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x03, 0x20]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app0, big, sof, Buffer.alloc(16)]);
  assert.deepEqual(readImageInfo(write('a.png', png)), { format: 'png', width: 1500, height: 1200 });
  assert.deepEqual(readImageInfo(write('a.gif', gif)), { format: 'gif', width: 320, height: 240 });
  assert.deepEqual(readImageInfo(write('a.webp', webp)), { format: 'webp', width: 800, height: 600 });
  assert.deepEqual(readImageInfo(write('a.jpg', jpeg)), { format: 'jpeg', width: 800, height: 600 });
  assert.equal(readImageInfo(write('a.txt', Buffer.from('hello world'))), null);
  assert.equal(readImageInfo(path.join(dir, 'missing.jpg')), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('storage paths: only /storage/images/ inside the storage root', () => {
  const root = '/srv/ohmx/storage';
  assert.equal(storageFileFor('/storage/images/products/p/1/a.jpg', root), '/srv/ohmx/storage/images/products/p/1/a.jpg');
  assert.equal(storageFileFor('/storage/images/../../etc/passwd', root), null);
  assert.equal(storageFileFor('/storage/images/%2e%2e/%2e%2e/etc/passwd', root), null);
  assert.equal(storageFileFor('https://example.com/a.jpg', root), null);
});


test('feature candidates: observed names copied as unverified, scoped rules, unit and conditions kept raw', () => {
  const features = [
    { feature_name: 'Kvs', feature_value: '2,5', feature_unit: null },
    { feature_name: 'Мощность ∆t 50C, Вт', feature_value: '1250', feature_unit: null },
    { feature_name: 'Длина, м', feature_value: '68', feature_unit: null },
    { feature_name: 'Мощность, кВт', feature_value: '24', feature_unit: null },
    { feature_name: 'Цвет', feature_value: 'белый', feature_unit: null },
  ];
  const radiator = featureParameterCandidates(features, { warmFloorType: '', categoryName: 'Радиаторы отопления' });
  assert.deepEqual(radiator.map((item) => item.parameter), ['kvs', 'heat_output', 'heat_output']);
  assert.equal(radiator[1].conditions_in_name, 'Мощность ∆t 50C, Вт');
  assert.equal(radiator[1].unit_in_name, 'Вт');
  assert.equal(radiator[1].value_raw, '1250');
  assert.ok(radiator.every((item) => item.status === 'CANDIDATE_FROM_IMPORTED_FEATURE' && item.verification === 'UNVERIFIED'));
  const cable = featureParameterCandidates(features, { warmFloorType: 'heating_cable', categoryName: 'Нагревательные кабели' });
  assert.deepEqual(cable.map((item) => item.parameter), ['kvs', 'heat_output', 'cable_or_mat_length'], 'length only for cables/mats; generic power only for heat sources');
});

test('engineering view: conditions and source exported, flat cell only for one KNOWN value in the canonical unit', () => {
  const snapshot: any = {
    engineeringParameters: new Map([
      [1, { parameter_id: 1, equipment_type: 'FAN_COIL', code: 'cooling_capacity', canonical_name: 'Cooling capacity', canonical_unit: 'kW', value_type: 'NUMERIC', requirement_level: 'REQUIRED_FOR_SELECTION' }],
      [2, { parameter_id: 2, equipment_type: 'FAN_COIL', code: 'airflow', canonical_name: 'Airflow', canonical_unit: 'm³/h', value_type: 'NUMERIC', requirement_level: 'REQUIRED_FOR_SELECTION' }],
      [3, { parameter_id: 3, equipment_type: 'FAN_COIL', code: 'fan_power', canonical_name: 'Fan power', canonical_unit: 'W', value_type: 'NUMERIC', requirement_level: 'RECOMMENDED' }],
      [4, { parameter_id: 4, equipment_type: 'FAN_COIL', code: 'power_supply', canonical_name: 'Supply', canonical_unit: null, value_type: 'TEXT', requirement_level: 'REQUIRED_FOR_COMPATIBILITY' }],
    ]),
    conditionSets: new Map([[10, { condition_set_id: 10, code: 'FC_COOL_HIGH' }], [11, { condition_set_id: 11, code: 'FC_COOL_LOW' }]]),
    conditionEntries: new Map([[10, [{ condition_key: 'fan_speed', value_text: 'HIGH', key_unit: null }, { condition_key: 'water_supply_c', value_numeric: 7, key_unit: '°C' }]]]),
    engineeringSources: new Map([[5, { source_id: 5, source_type: 'MANUFACTURER_DATASHEET', verification_tier: 'AUTHORITATIVE', document_title: 'Datasheet', page: '12' }]]),
  };
  const values = [
    { parameter_id: 1, value_numeric: 3.2, unit: 'kW', value_status: 'KNOWN', condition_set_id: 10, source_id: 5 },
    { parameter_id: 1, value_numeric: 2.1, unit: 'kW', value_status: 'KNOWN', condition_set_id: 11, source_id: 5 },
    { parameter_id: 3, value_numeric: 0.05, unit: 'kW', value_status: 'KNOWN', condition_set_id: null, source_id: 5 },
    { parameter_id: 4, value_text: '230/1/50', unit: 'V/Ph/Hz', value_status: 'KNOWN', condition_set_id: null, source_id: null },
  ];
  const view = engineeringParameterView(values, 'FAN_COIL', snapshot);
  assert.deepEqual(view.parameters[0].conditions, [{ key: 'fan_speed', value: 'HIGH', unit: null }, { key: 'water_supply_c', value: 7, unit: '°C' }]);
  assert.equal(view.parameters[0].condition_set_code, 'FC_COOL_HIGH');
  assert.equal(view.parameters[0].source.verification_tier, 'AUTHORITATIVE');
  assert.equal(view.flat.eng_cooling_capacity_kw, '', 'two operating points -> no flat value');
  assert.deepEqual(view.multiCondition, ['cooling_capacity(2)']);
  assert.equal(view.flat.eng_fan_power_w, '', 'kW is not the W column: never converted silently');
  assert.deepEqual(view.unitNotes, ['fan_power:unit_kW']);
  assert.equal(view.flat.eng_power_supply, '230/1/50', 'text parameters ignore units');
  assert.equal(view.selectionKnown, '1/2');
  assert.equal(view.compatibilityKnown, '1/1');
  assert.deepEqual(view.missingRequired, ['airflow']);
  assert.equal(Object.keys(view.flat).length, FLAT_ENGINEERING_PARAMETERS.length);
});

const snapshotDb = process.env.OHMX_EXPORT_TEST_DB;
const storage = process.env.OHMX_EXPORT_STORAGE_ROOT;
const skip = snapshotDb && storage ? false : 'set OHMX_EXPORT_TEST_DB and OHMX_EXPORT_STORAGE_ROOT';

test('full catalog: one row per product, valid JSON, accurate relations, database untouched', { skip }, () => {
  const before = crypto.createHash('sha256').update(fs.readFileSync(snapshotDb!)).digest('hex');
  const db = new Database(snapshotDb!, { readonly: true, fileMustExist: true });
  const started = Date.now();
  const snapshot = loadCatalogSnapshot(db);
  const options = { storageRoot: storage!, exportedAt: '2026-10-23T00:00:00.000Z' };
  const csv = CSV_BOM + csvLine(FULL_EXPORT_COLUMNS) + snapshot.products.map((product) => csvLine(rowValues(buildProductRow(product, snapshot, options)))).join('');
  const elapsedMs = Date.now() - started;

  assert.ok(csv.startsWith('﻿"product_id"'));
  const rows = parseCsv(csv.slice(1));
  const header = rows[0];
  assert.deepEqual(header, [...FULL_EXPORT_COLUMNS]);
  const data = rows.slice(1);
  const productCount = Number((db.prepare('SELECT COUNT(*) AS c FROM products').get() as any).c);
  assert.equal(data.length, productCount, 'every product, active and inactive, exactly once');
  for (const row of data) assert.equal(row.length, header.length);
  const col = (name: string) => header.indexOf(name);
  const ids = data.map((row) => row[col('product_id')]);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate product rows');

  for (const name of header.filter((column) => column.endsWith('_json'))) {
    for (const row of data) if (row[col(name)] !== '') assert.doesNotThrow(() => JSON.parse(row[col(name)]), `${name} of ${row[col('product_id')]}`);
  }
  const byId = new Map(data.map((row) => [Number(row[col('product_id')]), row]));

  // Categories: every product_categories link appears in all_categories_json.
  const links = db.prepare('SELECT product_id, category_id FROM product_categories').all() as any[];
  for (const link of links) {
    const categories = JSON.parse(byId.get(Number(link.product_id))![col('all_categories_json')]);
    assert.ok(categories.some((category: any) => category.id === Number(link.category_id)), `category ${link.category_id} of ${link.product_id}`);
  }
  // Images: counts and order match product_images.
  const imageRows = db.prepare('SELECT product_id, image_url FROM product_images ORDER BY product_id, is_cover DESC, sort_order, id').all() as any[];
  const imagesByProduct = new Map<number, string[]>();
  for (const image of imageRows) imagesByProduct.set(Number(image.product_id), [...(imagesByProduct.get(Number(image.product_id)) || []), image.image_url]);
  for (const [productId, row] of byId) {
    const urls = imagesByProduct.get(productId) || [];
    assert.deepEqual(JSON.parse(row[col('all_image_urls_json')]), urls, `images of ${productId}`);
    assert.equal(row[col('image_status')] === 'missing', urls.length === 0);
  }
  // Specifications: every product_features row is exported (specifications + import "source" rows).
  const featureCount = Number((db.prepare('SELECT COUNT(*) AS c FROM product_features').get() as any).c);
  const exportedFeatures = data.reduce((sum, row) => sum + JSON.parse(row[col('technical_specifications_json')]).length + JSON.parse(row[col('import_source_features_json')]).length, 0);
  assert.equal(exportedFeatures, featureCount);
  // Documents: every document row is listed.
  const documentCount = Number((db.prepare('SELECT COUNT(*) AS c FROM product_documents').get() as any).c);
  assert.equal(data.reduce((sum, row) => sum + JSON.parse(row[col('all_documents_json')]).length, 0), documentCount);

  // Engineering registry: every value exported with its conditions; flat cells only for a single KNOWN value.
  const valueCount = Number((db.prepare('SELECT COUNT(*) AS c FROM engineering_value').get() as any).c);
  assert.equal(data.reduce((sum, row) => sum + JSON.parse(row[col('engineering_parameters_json')]).length, 0), valueCount);
  const conditioned = Number((db.prepare('SELECT COUNT(*) AS c FROM engineering_value v WHERE v.condition_set_id IN (SELECT condition_set_id FROM engineering_condition_entry)').get() as any).c);
  assert.equal(data.reduce((sum, row) => sum + JSON.parse(row[col('engineering_parameters_json')]).filter((value: any) => value.conditions.length > 0).length, 0), conditioned);
  const knownCounts = db.prepare(`SELECT v.product_id, p.code, COUNT(*) AS c FROM engineering_value v JOIN engineering_parameter p ON p.parameter_id = v.parameter_id WHERE v.value_status = 'KNOWN' GROUP BY 1, 2`).all() as any[];
  const knownBy = new Map(knownCounts.map((item) => [`${item.product_id}:${item.code}`, Number(item.c)]));
  for (const { code, column } of FLAT_ENGINEERING_PARAMETERS) {
    for (const [productId, row] of byId) {
      if (row[col(column)] !== '') assert.equal(knownBy.get(`${productId}:${code}`), 1, `${column} of ${productId} only from a single known value`);
    }
  }
  const typed = Number((db.prepare(`SELECT COUNT(*) AS c FROM products p WHERE EXISTS (SELECT 1 FROM engineering_product_profile e WHERE e.product_id = p.id) OR TRIM(COALESCE(p.equipment_type, '')) <> '' OR TRIM(COALESCE(p.warm_floor_product_type, '')) <> ''`).get() as any).c);
  assert.equal(data.filter((row) => row[col('equipment_type')] !== '').length, typed);

  db.close();
  const after = crypto.createHash('sha256').update(fs.readFileSync(snapshotDb!)).digest('hex');
  assert.equal(after, before, 'export never writes to the database');
  console.log(`exported ${data.length} products, ${(csv.length / 1024 / 1024).toFixed(1)} MB of text in ${elapsedMs} ms`);
});

test('paged snapshot (separate read-only connection, product-id ranges) equals the single-transaction snapshot', { skip }, async () => {
  const db = new Database(snapshotDb!, { readonly: true, fileMustExist: true });
  const single = loadCatalogSnapshot(db);
  db.close();
  const paged = await loadCatalogSnapshotPaged(snapshotDb!);
  const plain = (snapshot: any) => Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, value instanceof Map ? [...(value as Map<number, unknown>).entries()].sort((a, b) => a[0] - b[0]) : value]));
  assert.deepEqual(plain(paged), plain(single));
});
