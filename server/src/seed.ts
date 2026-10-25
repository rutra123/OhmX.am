import fs from 'node:fs';
import path from 'node:path';
import { db, slugify } from './db.js';
import { brands, categoryTree, warehouses } from './utils/seedData.js';

const forceReset = process.argv.includes('--force') || process.env.SEED_FORCE === '1';

const docsDir = path.resolve(process.cwd(), 'storage/docs');
const imagesDir = path.resolve(process.cwd(), 'storage/images');
fs.mkdirSync(docsDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });

function reset() {
  db.exec(`DELETE FROM order_items; DELETE FROM orders; DELETE FROM stock; DELETE FROM product_documents; DELETE FROM product_images; DELETE FROM product_features; DELETE FROM products; DELETE FROM series; DELETE FROM brands; DELETE FROM categories; DELETE FROM warehouses; DELETE FROM admin_users;`);
}

const existingData = (db.prepare('SELECT (SELECT COUNT(*) FROM categories) + (SELECT COUNT(*) FROM brands) + (SELECT COUNT(*) FROM products) AS total').get() as any)?.total || 0;
if (existingData > 0 && !forceReset) {
  console.error('Seed cancelled: database already contains data. Use npm run db:reset for a destructive rebuild.');
  process.exit(1);
}
function makePdf(name: string) {
  const pdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 63>>stream
BT /F1 18 Tf 20 120 Td (${name}) Tj ET
endstream
endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
xref
0 6
0000000000 65535 f 
0000000010 00000 n 
0000000060 00000 n 
0000000117 00000 n 
0000000243 00000 n 
0000000356 00000 n 
trailer<</Size 6/Root 1 0 R>>
startxref
426
%%EOF`;
  fs.writeFileSync(path.join(docsDir, name), pdf);
}
function makeSvg(name: string, title: string, color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="100%" height="100%" fill="#121317"/><rect x="30" y="30" width="740" height="540" rx="28" fill="${color}" opacity="0.55"/><text x="50%" y="46%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="Arial" font-size="42">OhmX.am</text><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="Arial" font-size="28">${title}</text></svg>`;
  fs.writeFileSync(path.join(imagesDir, name), svg);
}

if (forceReset || existingData === 0) reset();

const insCat = db.prepare(`INSERT INTO categories (parent_id,name_ru,name_hy,name_en,slug,description_ru,sort_order,is_active) VALUES (@parent_id,@name_ru,'','',@slug,@description_ru,@sort_order,1)`);
const categoryIds = new Map<string, number>();
categoryTree.forEach((cat, i) => {
  const info = insCat.run({ parent_id: null, name_ru: cat.name_ru, slug: cat.slug, description_ru: `${cat.name_ru}: базовая категория каталога`, sort_order: i + 1 });
  categoryIds.set(cat.name_ru, Number(info.lastInsertRowid));
  cat.children.forEach((child, idx) => {
    const slug = `${cat.slug}-${slugify(child)}`;
    const childInfo = insCat.run({ parent_id: info.lastInsertRowid, name_ru: child, slug, description_ru: `${child}: подкатегория каталога`, sort_order: idx + 1 });
    categoryIds.set(child, Number(childInfo.lastInsertRowid));
  });
});

const insBrand = db.prepare(`INSERT INTO brands (name,country,logo_url,description_ru,website_url,slug,is_active) VALUES (@name,'', '', @description_ru,'',@slug,1)`);
const brandIds = new Map<string, number>();
brands.forEach((name) => {
  const info = insBrand.run({ name, slug: slugify(name), description_ru: `${name} — бренд каталога OhmX.am` });
  brandIds.set(name, Number(info.lastInsertRowid));
});

const insWarehouse = db.prepare(`INSERT INTO warehouses (name,slug,address,is_active,sort_order) VALUES (@name,@slug,'',1,@sort_order)`);
const warehouseIds = new Map<string, number>();
warehouses.forEach((name, idx) => {
  const info = insWarehouse.run({ name, slug: slugify(name), sort_order: idx + 1 });
  warehouseIds.set(name, Number(info.lastInsertRowid));
});

db.prepare(`INSERT INTO admin_users (username,password_hint) VALUES ('admin','set in .env')`).run();

const products = [
  ['088H3122','DEVIcomfort 150 мат 1 м²','DEVI','Нагревательные маты',129000,['Мощность','150','Вт/м²'],['Площадь','1','м²'],['Гарантия','20','лет'],'devi-mat-installation-manual.pdf'],
  ['140F1090','DEVIreg Smart термостат','DEVI','Термостаты',89000,['Wi‑Fi','Да',''],['Монтаж','встраиваемый',''],['Цвет','белый',''],'devi-thermostat-passport.pdf'],
  ['EFM-210','Fenix Ecofilm 210','Fenix','Нагревательные маты',115000,['Мощность','210','Вт/м²'],['Назначение','под ламинат',''],['Ширина','0.5','м'],'fenix-floor-manual.pdf'],
  ['088L5131','Danfoss ECtemp 130 кабель','Danfoss','Нагревательные кабели',98000,['Мощность','130','Вт'],['Длина','10','м'],['Назначение','обогрев пола',''],'danfoss-cable-certificate.pdf'],
  ['OJ-MICRO-REG','OJ Microline OLED','OJ Electronics','Термостаты',99000,['Экран','OLED',''],['Датчик пола','Да',''],['Программа','7','дней'],'oj-electronics-thermostat-manual.pdf'],
  ['LG-VALENA-774420','Legrand Valena Life розетка','Legrand','Розетки',12500,['Серия','Valena Life',''],['Цвет','белый',''],['Монтаж','скрытый',''],'legrand-socket-passport.pdf'],
  ['LG-VALENA-752101','Legrand выключатель 1-клавишный','Legrand','Выключатели',9800,['Серия','Valena Life',''],['Ток','10','A'],['Монтаж','скрытый',''],'legrand-switch-passport.pdf'],
  ['LG-ETIKA-672221','Legrand Etika RJ45','Legrand','RJ45 / TV / USB',18500,['Категория','Cat6',''],['Серия','Etika',''],['Цвет','алюминий',''],'legrand-rj45-passport.pdf'],
  ['LG-RX3-63A','Legrand RX³ автоматический выключатель 63A','Legrand','Автоматические выключатели',8400,['Ток','63','A'],['Полюсов','2',''],['Характеристика','C',''],'legrand-automatic-breaker-passport.pdf'],
  ['FINDER-22-32','Finder контактор 32A','Finder','Контакторы',22800,['Ток','32','A'],['Катушка','230','V'],['Контакты','2NO',''],'finder-contactor-manual.pdf'],
  ['GEYA-RCD-40A','Geya УЗО 40A','Geya','УЗО',13800,['Ток','40','A'],['Чувствительность','30','mA'],['Полюсов','2',''],'gya-uzo-passport.pdf'],
  ['BERETTA-START-24','Beretta котёл Start 24','Beretta','Котлы',485000,['Мощность','24','кВт'],['Контуров','2',''],['Тип','газовый',''],'beretta-installation-manual.pdf'],
  ['BALTUR-BGN20','Baltur горелка BGN 20','Baltur','Горелки',620000,['Мощность','160','кВт'],['Топливо','газ',''],['Регулировка','двухступенчатая',''],'baltur-burner-passport.pdf'],
  ['DANF-RA-N15','Danfoss клапан RA-N 15','Danfoss','Клапаны',18900,['Диаметр','15','мм'],['Материал','латунь',''],['Назначение','радиаторы',''],'danfoss-valve-certificate.pdf'],
  ['KORADO-22-500','Korado радиатор 22/500','Korado','Радиаторы',58000,['Высота','500','мм'],['Длина','1000','мм'],['Тип','панельный',''],'korado-radiator-passport.pdf'],
  ['APC-BX2200','APC Back-UPS 2200','APC','UPS / ИБП',210000,['Мощность','2200','VA'],['Розеток','6',''],['Тип','line-interactive',''],'apc-ups-manual.pdf'],
  ['BASTION-SKAT-1000','Bastion стабилизатор SKAT','Bastion','Стабилизаторы',98000,['Мощность','1000','VA'],['Фаза','1',''],['Монтаж','напольный',''],'bastion-stabilizer-passport.pdf'],
  ['DAB-EVOSTA2','DAB Evosta 2','DAB','Циркуляционные насосы',129000,['Напор','6','м'],['Подключение','1 1/2',''],['Скоростей','3',''],'dab-pump-manual.pdf'],
  ['EMMETI-VALVE-3/4','Emmeti фитинг 3/4','Emmeti','Фитинги',7600,['Диаметр','3/4',''],['Материал','латунь',''],['Тип','резьбовой',''],'emmeti-fitting-passport.pdf'],
  ['BERETTA-PCB-100','Beretta плата управления','Beretta','Платы управления',145000,['Совместимость','Beretta',''],['Назначение','котлы',''],['Гарантия','12','мес'],'beretta-pcb-manual.pdf'],
  ['TICA-FAN-MOTOR','TICA вентилятор fan motor','TICA','Вентиляторы',88000,['Напряжение','220','V'],['Назначение','HVAC',''],['Скорость','2800','rpm'],'tica-fan-manual.pdf'],
];

const demoDocuments: Record<string, { file: string; name: string; type: string; language?: string; version?: string }[]> = {
  '088H3122': [
    { file: 'devi-mat-installation-manual.pdf', name: 'Инструкция по монтажу', type: 'installation_manual' },
    { file: 'devi-mat-technical-passport.pdf', name: 'Технический паспорт', type: 'technical_passport' },
    { file: 'devi-mat-certificate.pdf', name: 'Сертификат', type: 'certificate' },
  ],
  'LG-RX3-63A': [
    { file: 'legrand-rx3-technical-passport.pdf', name: 'Технический паспорт', type: 'technical_passport' },
    { file: 'legrand-rx3-manufacturer-catalog.pdf', name: 'Каталог производителя', type: 'manufacturer_catalog' },
  ],
  'DANF-RA-N15': [
    { file: 'danfoss-valve-installation-manual.pdf', name: 'Инструкция', type: 'installation_manual' },
    { file: 'danfoss-valve-connection-scheme.pdf', name: 'Схема подключения', type: 'connection_scheme' },
    { file: 'danfoss-valve-certificate.pdf', name: 'Сертификат', type: 'certificate' },
  ],
  'BERETTA-START-24': [
    { file: 'beretta-user-manual.pdf', name: 'Инструкция пользователя', type: 'other' },
    { file: 'beretta-installation-manual.pdf', name: 'Инструкция монтажа', type: 'installation_manual' },
    { file: 'beretta-warranty.pdf', name: 'Гарантийный документ', type: 'warranty' },
  ],
  'APC-BX2200': [
    { file: 'apc-user-manual.pdf', name: 'User manual', type: 'other', language: 'en' },
    { file: 'apc-technical-datasheet.pdf', name: 'Technical datasheet', type: 'technical_passport', language: 'en' },
  ],
};

const allDocFiles = new Set<string>();
for (const entry of products) allDocFiles.add(entry[8] as string);
for (const list of Object.values(demoDocuments)) for (const doc of list) allDocFiles.add(doc.file);
[...allDocFiles].forEach(makePdf);
['placeholder-product.svg','devi-mat.svg','legrand-socket.svg','apc-ups.svg','pump.svg','boiler.svg'].forEach((name, i) => makeSvg(name, name.replace(/[-.]/g, ' '), ['#d82e2f','#3b82f6','#16a34a','#9333ea','#f59e0b','#06b6d4'][i % 6]));

const insProduct = db.prepare(`INSERT INTO products (sku,name_ru,slug,brand_id,category_id,short_description_ru,description_ru,price_amd,currency,unit,is_active,is_featured,seo_title_ru,seo_description_ru) VALUES (@sku,@name_ru,@slug,@brand_id,@category_id,@short,@desc,@price,'AMD','шт',1,@featured,@name_ru,@desc)`);
const insFeature = db.prepare(`INSERT INTO product_features (product_id,feature_name,feature_value,feature_unit,sort_order) VALUES (?,?,?,?,?)`);
const insImage = db.prepare(`INSERT INTO product_images (product_id,image_url,alt_text,is_cover,sort_order) VALUES (?,?,?,?,?)`);
const insDoc = db.prepare(`INSERT INTO product_documents (product_id,document_name,document_type,file_url,file_extension,file_size,language,version,is_public,sort_order) VALUES (?,?,?,?,?,?,?,?,1,?)`);
const insStock = db.prepare(`INSERT INTO stock (product_id,warehouse_id,quantity,reserved_quantity,available_quantity,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)`);

products.forEach((p, idx) => {
  const [sku, name_ru, brand, category, price, f1, f2, f3, doc] = p as any;
  const info = insProduct.run({ sku, name_ru, slug: slugify(`${sku}-${name_ru}`), brand_id: brandIds.get(brand), category_id: categoryIds.get(category), short: `${brand} · ${category}`, desc: `${name_ru} — товар каталога OhmX.am для локального прототипа.`, price, featured: idx < 6 ? 1 : 0 });
  const productId = Number(info.lastInsertRowid);
  [f1, f2, f3].forEach((f, i) => insFeature.run(productId, f[0], f[1], f[2], i + 1));
  const image = idx < 5 ? ['devi-mat.svg','devi-mat.svg','devi-mat.svg','devi-mat.svg','devi-mat.svg'][idx] : idx < 8 ? 'legrand-socket.svg' : idx < 11 ? 'placeholder-product.svg' : idx < 15 ? 'boiler.svg' : idx < 17 ? 'apc-ups.svg' : idx < 19 ? 'pump.svg' : 'placeholder-product.svg';
  insImage.run(productId, `/storage/images/${image}`, name_ru, 1, 1);
  const docs = demoDocuments[sku] || [{ file: doc, name: doc.replace('.pdf','').replace(/-/g,' '), type: doc.includes('certificate') ? 'certificate' : doc.includes('manual') ? 'installation_manual' : 'technical_passport', language: 'ru', version: '1.0' }];
  docs.forEach((item, docIndex) => {
    const filePath = path.join(docsDir, item.file);
    const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    insDoc.run(productId, item.name, item.type, `/storage/docs/${item.file}`, path.extname(item.file).replace('.', '') || 'pdf', fileSize, item.language || 'ru', item.version || '1.0', docIndex + 1);
  });
  let base = 3 + (idx % 7);
  warehouses.forEach((w) => { const q = base; insStock.run(productId, warehouseIds.get(w), q, 0, q); base = Math.max(0, base - 1); });
});

console.log('Seed complete');
