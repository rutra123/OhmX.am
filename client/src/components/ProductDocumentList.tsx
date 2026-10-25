import { useTranslation } from 'react-i18next';

const DOCUMENT_TYPE_KEYS: Record<string, string> = {
  technical_passport: 'product.documents.types.technicalPassport',
  installation_manual: 'product.documents.types.installationManual',
  certificate: 'product.documents.types.certificate',
  manufacturer_catalog: 'product.documents.types.manufacturerCatalog',
  connection_scheme: 'product.documents.types.connectionScheme',
  warranty: 'product.documents.types.warranty',
  declaration: 'product.documents.types.declaration',
  cad_bim: 'product.documents.types.cadBim',
  other: 'product.documents.types.other',
};

function formatFileSize(bytes: number | undefined, unknownLabel: string) {
  if (!bytes || bytes <= 0) return unknownLabel;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function ProductDocumentList({ documents }: { documents: any[] }) {
  const { t } = useTranslation();

  if (!documents?.length) {
    return (
      <div className="panel p-4">
        <h3 className="text-xl font-semibold">{t('product.documents.title')}</h3>
        <p className="mt-3 text-slate-300">{t('product.documents.empty')}</p>
      </div>
    );
  }

  return (
    <div className="panel p-4">
      <h3 className="text-xl font-semibold">{t('product.documents.title')}</h3>
      <div className="mt-4 space-y-3">
        {documents.map((doc) => {
          const typeKey = DOCUMENT_TYPE_KEYS[doc.document_type] || DOCUMENT_TYPE_KEYS.other;
          return (
            <div key={doc.id} className="flex flex-col gap-3 rounded-xl border border-line bg-card p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm text-primary">[{(doc.file_extension || 'pdf').toUpperCase()}] {t(typeKey)}</div>
                <div className="mt-1 font-medium text-white">{doc.document_name}</div>
                <div className="mt-1 text-sm text-slate-400">{(doc.file_extension || 'pdf').toUpperCase()} · {formatFileSize(doc.file_size, t('product.documents.fileSizeUnknown'))} · {(doc.language || 'ru').toUpperCase()}{doc.version ? ` · v${doc.version}` : ''}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <a className="btn-secondary" href={doc.file_url} target="_blank" rel="noreferrer" aria-label={t('product.documents.openAria', { name: doc.document_name })}>{t('product.documents.open')}</a>
                <a className="btn-primary" href={doc.file_url} download aria-label={t('product.documents.downloadAria', { name: doc.document_name })}>{t('product.documents.download')}</a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
