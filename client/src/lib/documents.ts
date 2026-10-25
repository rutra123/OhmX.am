export const documentTypeLabels: Record<string, string> = {
  technical_passport: 'Технический паспорт',
  installation_manual: 'Инструкция по монтажу',
  certificate: 'Сертификат',
  manufacturer_catalog: 'Каталог производителя',
  connection_scheme: 'Схема подключения',
  warranty: 'Гарантия',
  declaration: 'Декларация соответствия',
  cad_bim: 'CAD / BIM файл',
  other: 'Другое',
};

export function formatFileSize(bytes?: number) {
  if (!bytes || bytes <= 0) return 'Размер не указан';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
