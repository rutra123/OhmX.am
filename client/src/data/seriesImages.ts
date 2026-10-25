const LEGRAND_SERIES_IMAGE_BASE = '/assets/series/legrand';
const LEGRAND_SERIES_IMAGE_VERSION = '20260624-legrand-local-android-1';

const seriesImageEntries: Array<[string, string]> = [
  ['legrand серия arteor', `${LEGRAND_SERIES_IMAGE_BASE}/arteor.jpg`],
  ['arteor', `${LEGRAND_SERIES_IMAGE_BASE}/arteor.jpg`],
  ['legrand серия cariva', `${LEGRAND_SERIES_IMAGE_BASE}/cariva.jpg`],
  ['cariva', `${LEGRAND_SERIES_IMAGE_BASE}/cariva.jpg`],
  ['legrand серия celiane', `${LEGRAND_SERIES_IMAGE_BASE}/celiane.jpg`],
  ['celiane', `${LEGRAND_SERIES_IMAGE_BASE}/celiane.jpg`],
  ['legrand серия inspiria', `${LEGRAND_SERIES_IMAGE_BASE}/inspiria.jpg`],
  ['inspiria', `${LEGRAND_SERIES_IMAGE_BASE}/inspiria.jpg`],
  ['legrand серия mallia senses', `${LEGRAND_SERIES_IMAGE_BASE}/mallia-senses.png`],
  ['mallia senses', `${LEGRAND_SERIES_IMAGE_BASE}/mallia-senses.png`],
  ['legrand серия mosaic', `${LEGRAND_SERIES_IMAGE_BASE}/mosaic.jpg`],
  ['mosaic', `${LEGRAND_SERIES_IMAGE_BASE}/mosaic.jpg`],
  ['legrand серия niloe', `${LEGRAND_SERIES_IMAGE_BASE}/niloe.jpg`],
  ['niloe', `${LEGRAND_SERIES_IMAGE_BASE}/niloe.jpg`],
  ['legrand серия niloe step', `${LEGRAND_SERIES_IMAGE_BASE}/niloe-step.jpg`],
  ['niloe step', `${LEGRAND_SERIES_IMAGE_BASE}/niloe-step.jpg`],
  ['legrand серия plexo ip 55 ip 66', `${LEGRAND_SERIES_IMAGE_BASE}/plexo-ip55-ip66.png`],
  ['plexo ip 55 ip 66', `${LEGRAND_SERIES_IMAGE_BASE}/plexo-ip55-ip66.png`],
  ['legrand серия quteo forix', `${LEGRAND_SERIES_IMAGE_BASE}/quteo-forix.jpg`],
  ['quteo forix', `${LEGRAND_SERIES_IMAGE_BASE}/quteo-forix.jpg`],
  ['legrand серия suno', `${LEGRAND_SERIES_IMAGE_BASE}/suno.jpg`],
  ['suno', `${LEGRAND_SERIES_IMAGE_BASE}/suno.jpg`],
  ['legrand серия valena allure', `${LEGRAND_SERIES_IMAGE_BASE}/valena-allure.jpg`],
  ['valena allure', `${LEGRAND_SERIES_IMAGE_BASE}/valena-allure.jpg`],
  ['legrand серия valena classic', `${LEGRAND_SERIES_IMAGE_BASE}/valena-classic.jpg`],
  ['valena classic', `${LEGRAND_SERIES_IMAGE_BASE}/valena-classic.jpg`],
  ['legrand серия valena life', `${LEGRAND_SERIES_IMAGE_BASE}/valena-life.jpg`],
  ['valena life', `${LEGRAND_SERIES_IMAGE_BASE}/valena-life.jpg`],
];

function normalizeSeriesImageKey(value: string) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('ru')
    .replace(/[\\/_-]+/g, ' ')
    .replace(/[^a-zа-яё0-9\s]+/giu, ' ')
    .replace(/\s+/g, ' ');
}

const seriesImageByNormalizedName = Object.fromEntries(
  seriesImageEntries.map(([name, image]) => [normalizeSeriesImageKey(name), image]),
);

export function getSeriesCoverImage(seriesName: string) {
  const mapped = seriesImageByNormalizedName[normalizeSeriesImageKey(seriesName)] || '';
  if (!mapped) return '';
  const separator = mapped.includes('?') ? '&' : '?';
  return `${mapped}${separator}v=${LEGRAND_SERIES_IMAGE_VERSION}`;
}
