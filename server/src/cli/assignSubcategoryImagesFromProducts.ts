import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dbPath } from '../db.js';

type CategoryRow = {
  id: number;
  parent_id: number | null;
  slug: string;
  name_ru: string;
  image_url: string;
};

type ProductCandidate = {
  id: number;
  name_ru: string;
  slug: string;
  brand_name: string | null;
  series_name: string | null;
  image_url: string | null;
  images_count: number;
};

type ImageMeta = {
  ok: boolean;
  status: number;
  width: number;
  height: number;
  contentType: string;
  contentLength: number;
  format: string;
  error?: string;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const categoriesDir = path.resolve(projectRoot, 'storage', 'images');
const defaultReportPath = path.resolve(projectRoot, 'backups', 'subcategory-images', 'last-report.json');
const stopWords = new Set([
  'и', 'для', 'с', 'на', 'по', 'из', 'под', 'над', 'в', 'во', 'от', 'до', 'или',
  'the', 'and', 'for', 'with',
]);

function parseArgs(argv: string[]) {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      result[key] = 'true';
    } else {
      result[key] = next;
      i += 1;
    }
  }
  return result;
}

function resolvePath(filePath: string) {
  if (path.isAbsolute(filePath)) return filePath;
  const fromCwd = path.resolve(process.cwd(), filePath);
  if (fs.existsSync(path.dirname(fromCwd))) return fromCwd;
  return path.resolve(projectRoot, filePath);
}

function backupDatabase(targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(targetDir, `electro-before-subcategory-images-${stamp}.db`);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function normalizeText(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string) {
  return normalizeText(value)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !stopWords.has(token));
}

function scoreTextMatch(categoryName: string, parentName: string, candidate: ProductCandidate) {
  const categoryText = normalizeText(categoryName);
  const productText = normalizeText([
    candidate.name_ru,
    candidate.brand_name || '',
    candidate.series_name || '',
  ].join(' '));
  const categoryTokens = tokenize(categoryName);
  const parentTokens = tokenize(parentName);
  const productTokens = new Set(tokenize(productText));

  let score = 0;
  let overlap = 0;

  for (const token of categoryTokens) {
    if (!productTokens.has(token)) continue;
    overlap += 1;
    score += token.length >= 5 ? 12 : 8;
  }

  for (const token of parentTokens) {
    if (!productTokens.has(token)) continue;
    score += 2;
  }

  if (categoryText && productText.includes(categoryText)) score += 36;
  if (candidate.series_name && categoryText.includes(normalizeText(candidate.series_name))) score += 18;
  if (candidate.brand_name && productText.startsWith(normalizeText(candidate.brand_name))) score += 3;

  score += Math.min(candidate.images_count, 6);
  score += categoryTokens.length ? Math.round((overlap / categoryTokens.length) * 20) : 0;
  score += scoreConsumerRecognition(categoryName, parentName, candidate);
  return score;
}

function scoreConsumerRecognition(categoryName: string, parentName: string, candidate: ProductCandidate) {
  const text = normalizeText([
    categoryName,
    parentName,
    candidate.name_ru,
    candidate.brand_name || '',
    candidate.series_name || '',
  ].join(' '));

  const householdPositive = [
    ['розетк', 16], ['выключател', 16], ['кнопк', 10], ['диммер', 10], ['рамк', 8],
    ['автомат', 14], ['узо', 12], ['щит', 13], ['шкаф', 10], ['бокс', 9],
    ['кабель', 13], ['провод', 12], ['гофр', 10], ['кабель канал', 12], ['удлинител', 14],
    ['светильник', 16], ['ламп', 14], ['люстр', 14], ['прожектор', 12],
    ['термостат', 15], ['теплый пол', 14], ['нагревател', 12], ['конвектор', 13],
    ['радиатор', 16], ['котел', 14], ['бойлер', 14], ['водонагревател', 16],
    ['вентилятор', 14], ['кондиционер', 16], ['фанкойл', 11],
    ['насос', 14], ['кран', 14], ['клапан', 12], ['фильтр', 11], ['фитинг', 10], ['труб', 12],
    ['датчик', 12], ['контроллер', 9], ['реле', 8], ['пульт', 12], ['привод', 9],
  ];
  const obscureNegative = [
    ['аксессуар', -8], ['запчаст', -10], ['вставк', -7], ['клемм', -5], ['шина', -5],
    ['заглушк', -8], ['держател', -6], ['переходник', -4], ['адаптер', -4], ['модул', -3],
  ];

  let score = 0;
  for (const [needle, weight] of householdPositive) {
    if (text.includes(String(needle))) score += Number(weight);
  }
  for (const [needle, weight] of obscureNegative) {
    if (text.includes(String(needle))) score += Number(weight);
  }
  return Math.max(-18, Math.min(score, 36));
}

function parseJpegSize(buffer: Buffer) {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) break;
    const isSof = (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    );
    if (isSof) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return { width, height, format: 'jpeg' };
    }
    offset += 2 + length;
  }
  return null;
}

function parsePngSize(buffer: Buffer) {
  if (buffer.length < 24) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    format: 'png',
  };
}

function parseWebpSize(buffer: Buffer) {
  if (buffer.length < 30) return null;
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8 ') {
    const width = buffer.readUInt16LE(26) & 0x3fff;
    const height = buffer.readUInt16LE(28) & 0x3fff;
    return { width, height, format: 'webp' };
  }
  if (chunk === 'VP8L') {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height, format: 'webp' };
  }
  if (chunk === 'VP8X') {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height, format: 'webp' };
  }
  return null;
}

function parseImageSize(buffer: Buffer, contentType: string) {
  if (buffer.length >= 24 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return parsePngSize(buffer);
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return parseJpegSize(buffer);
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return parseWebpSize(buffer);
  }
  if (contentType.includes('jpeg')) return parseJpegSize(buffer);
  if (contentType.includes('png')) return parsePngSize(buffer);
  if (contentType.includes('webp')) return parseWebpSize(buffer);
  return null;
}

function scoreImageMeta(meta: ImageMeta) {
  if (!meta.ok || !meta.width || !meta.height) return -1_000;
  const aspect = meta.width / meta.height;
  const closenessToSquare = Math.max(0, 1 - Math.abs(Math.log(aspect)) / Math.log(2.2));
  const area = meta.width * meta.height;
  let score = 0;
  score += Math.min(area / 45_000, 36);
  score += closenessToSquare * 24;
  score += meta.width >= 700 && meta.height >= 700 ? 10 : 0;
  score += Math.min(meta.contentLength / 15_000, 12);
  return score;
}

async function fetchImageMeta(url: string): Promise<ImageMeta> {
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-65535' },
      signal: AbortSignal.timeout(15_000),
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const contentLength = Number(response.headers.get('content-length') || '0');
    if (!response.ok) {
      return { ok: false, status: response.status, width: 0, height: 0, contentType, contentLength, format: '', error: `HTTP ${response.status}` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const parsed = parseImageSize(buffer, contentType);
    if (!parsed) {
      return { ok: false, status: response.status, width: 0, height: 0, contentType, contentLength, format: '', error: 'Размер не распознан' };
    }
    return {
      ok: true,
      status: response.status,
      width: parsed.width,
      height: parsed.height,
      contentType,
      contentLength,
      format: parsed.format,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      width: 0,
      height: 0,
      contentType: '',
      contentLength: 0,
      format: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function downloadImage(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Не удалось скачать ${url}: HTTP ${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType };
}

function extensionFromContentType(contentType: string, fallbackUrl: string) {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  const match = fallbackUrl.toLowerCase().match(/\.([a-z0-9]{3,4})(?:$|\?)/);
  return match?.[1] || 'jpg';
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) break;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

function collectDescendants(startId: number, childrenMap: Map<number, number[]>, cache: Map<number, number[]>) {
  const cached = cache.get(startId);
  if (cached) return cached;
  const result = [startId];
  for (const childId of childrenMap.get(startId) || []) {
    result.push(...collectDescendants(childId, childrenMap, cache));
  }
  cache.set(startId, result);
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const reportPath = resolvePath(args.report || defaultReportPath);
  const targetDir = path.dirname(reportPath);
  const backupPath = backupDatabase(targetDir);

  const categories = db.prepare(`
    SELECT id, parent_id, slug, name_ru, COALESCE(image_url, '') AS image_url
    FROM categories
    WHERE is_active = 1 AND parent_id IS NOT NULL
    ORDER BY id ASC
  `).all() as CategoryRow[];
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const parentRows = db.prepare('SELECT id, name_ru FROM categories WHERE is_active = 1').all() as Array<{ id: number; name_ru: string }>;
  const parentNameById = new Map(parentRows.map((row) => [row.id, row.name_ru]));
  const childrenMap = new Map<number, number[]>();

  for (const category of categories) {
    if (category.parent_id == null) continue;
    const list = childrenMap.get(category.parent_id) || [];
    list.push(category.id);
    childrenMap.set(category.parent_id, list);
  }

  const descendantsCache = new Map<number, number[]>();
  const candidateStmt = db.prepare(`
    SELECT DISTINCT
      p.id,
      p.name_ru,
      p.slug,
      b.name AS brand_name,
      s.name AS series_name,
      (
        SELECT image_url
        FROM product_images i
        WHERE i.product_id = p.id
        ORDER BY i.is_cover DESC, i.sort_order ASC, i.id ASC
        LIMIT 1
      ) AS image_url,
      (
        SELECT COUNT(*)
        FROM product_images i
        WHERE i.product_id = p.id
      ) AS images_count
    FROM product_categories pc
    JOIN products p ON p.id = pc.product_id AND p.is_active = 1
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN series s ON s.id = p.series_id
    WHERE pc.category_id IN (SELECT value FROM json_each(?))
  `);
  const updateStmt = db.prepare('UPDATE categories SET image_url = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
  const metadataCache = new Map<string, ImageMeta>();
  const downloadCache = new Map<string, { buffer: Buffer; contentType: string }>();

  fs.mkdirSync(categoriesDir, { recursive: true });

  const categoryResults = [];

  for (const category of categories) {
    const directCategoryIds = [category.id];
    const subtreeIds = collectDescendants(category.id, childrenMap, descendantsCache);
    const directCandidates = (candidateStmt.all(JSON.stringify(directCategoryIds)) as ProductCandidate[])
      .filter((candidate) => candidate.image_url && /^https?:\/\//i.test(candidate.image_url || ''));
    const subtreeCandidates = (candidateStmt.all(JSON.stringify(subtreeIds)) as ProductCandidate[])
      .filter((candidate) => candidate.image_url && /^https?:\/\//i.test(candidate.image_url || ''));
    const candidates = directCandidates.length ? directCandidates : subtreeCandidates;

    const parentName = category.parent_id ? (parentNameById.get(category.parent_id) || '') : '';
    const rankedByText = candidates
      .map((candidate) => ({
        candidate,
        textScore: scoreTextMatch(category.name_ru, parentName, candidate),
      }))
      .sort((a, b) => b.textScore - a.textScore || a.candidate.id - b.candidate.id)
      .slice(0, 8);

    const enriched = await mapWithConcurrency(rankedByText, 4, async (entry) => {
      const url = entry.candidate.image_url as string;
      let meta = metadataCache.get(url);
      if (!meta) {
        meta = await fetchImageMeta(url);
        metadataCache.set(url, meta);
      }
      return {
        ...entry,
        meta,
        imageScore: scoreImageMeta(meta),
        finalScore: entry.textScore + scoreImageMeta(meta),
      };
    });

    const chosen = enriched
      .filter((entry) => entry.meta.ok)
      .sort((a, b) => b.finalScore - a.finalScore || b.meta.width * b.meta.height - a.meta.width * a.meta.height)[0];

    if (!chosen) {
      categoryResults.push({
        categoryId: category.id,
        slug: category.slug,
        name: category.name_ru,
        previousImageUrl: category.image_url,
        updated: false,
        reason: candidates.length ? 'Не удалось подтвердить ни одно изображение' : 'Нет товарных изображений в поддереве',
        subtreeCategories: subtreeIds.length,
        subtreeProducts: subtreeCandidates.length,
        directProducts: directCandidates.length,
      });
      continue;
    }

    const sourceUrl = chosen.candidate.image_url as string;
    let downloaded = downloadCache.get(sourceUrl);
    if (!downloaded) {
      downloaded = await downloadImage(sourceUrl);
      downloadCache.set(sourceUrl, downloaded);
    }
    const extension = extensionFromContentType(downloaded.contentType, sourceUrl);
    const fileName = `subcategory-${category.slug}.${extension}`;
    const absolutePath = path.join(categoriesDir, fileName);
    fs.writeFileSync(absolutePath, downloaded.buffer);
    const publicUrl = `/storage/images/${fileName}`;
    updateStmt.run(publicUrl, category.id);

    categoryResults.push({
      categoryId: category.id,
      slug: category.slug,
      name: category.name_ru,
      previousImageUrl: category.image_url,
      updated: true,
      imageUrl: publicUrl,
      sourceImageUrl: sourceUrl,
      chosenProductId: chosen.candidate.id,
      chosenProductName: chosen.candidate.name_ru,
      brand: chosen.candidate.brand_name,
      series: chosen.candidate.series_name,
      width: chosen.meta.width,
      height: chosen.meta.height,
      textScore: chosen.textScore,
      imageScore: chosen.imageScore,
      finalScore: chosen.finalScore,
      sourceScope: directCandidates.length ? 'direct' : 'subtree',
      subtreeCategories: subtreeIds.length,
      subtreeProducts: subtreeCandidates.length,
      directProducts: directCandidates.length,
    });
  }

  const report = {
    backup: backupPath,
    generatedAt: new Date().toISOString(),
    updated: categoryResults.filter((item) => item.updated).length,
    skipped: categoryResults.filter((item) => !item.updated).length,
    categories: categoryResults,
  };

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
