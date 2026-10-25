export function getSeriesSlug(value: string) {
  return String(value || '')
    .toLocaleLowerCase('ru')
    .replace(/[^a-z0-9а-яё\s-]/gi, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

const SERIES_WRAPPER_RE = /^(электроустановочные изделия|электротехнические изделия|главная|разное|action)$/iu;
const SERIES_PREFIX_RE = /^legrand серия\s+/iu;
const SERIES_COLOR_SUFFIX_RE = /\s+(белый|слоновая кость|графит|титан|антрацит|алюминий|серый|черный|чёрный|champagne|шампань)$/iu;
const SERIES_FUNCTION_RE = /^(лицевые панели|механизмы|рамки|универсальные суппорты)\s+(.+)$/iu;
const FUNCTIONAL_TYPE_DENYLIST = /^(TV-F|TV-FM-SAT|USB|HDMI|RJ45)$/i;
const COMBINED_SERIES_DENYLIST = /[/&+]/;

function normalizeSeriesName(value: string) {
  let series = String(value || '').trim();
  if (!series || SERIES_WRAPPER_RE.test(series)) return '';
  series = series.replace(SERIES_PREFIX_RE, '').trim();

  const functional = series.match(SERIES_FUNCTION_RE);
  if (functional) series = functional[2].trim();

  series = series.replace(SERIES_COLOR_SUFFIX_RE, '').trim();
  if (SERIES_WRAPPER_RE.test(series)) return '';

  // A2B: Block combined series names (Mosaic/Celiane, Valena Allure/Life etc.)
  if (COMBINED_SERIES_DENYLIST.test(series)) return '';

  // A2B: Block functional type derived cards (TV-F, TV-FM-SAT etc.)
  if (FUNCTIONAL_TYPE_DENYLIST.test(series)) return '';

  return series;
}

export function getDisplaySeriesName(product: any) {
  const explicit = String(product?.series_name || '').trim();
  if (explicit) {
    const normalized = normalizeSeriesName(explicit);
    if (normalized) return normalized;
  }

  const source = String(product?.name_ru || product?.name_en || '').trim();
  if (!source) return '';

  const dashParts = source.split(' - ').map((item) => item.trim()).filter(Boolean);
  for (const part of dashParts) {
    if (/^[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,10}){1,3}$/u.test(part)) {
      const reduced = part.replace(/-\d+[A-ZА-Я]*$/u, '');
      const candidate = reduced.includes('-') ? reduced : part;
      if (FUNCTIONAL_TYPE_DENYLIST.test(candidate)) return '';
      return candidate;
    }
  }

  const inline = source.match(/\b([A-Z]{1,6}(?:-[A-Z0-9]{1,10}){1,3})\b/u)?.[1];
  if (!inline) return '';
  const reduced = inline.replace(/-\d+[A-ZА-Я]*$/u, '');
  const candidate = reduced.includes('-') ? reduced : inline;
  if (FUNCTIONAL_TYPE_DENYLIST.test(candidate)) return '';
  return candidate;
}
