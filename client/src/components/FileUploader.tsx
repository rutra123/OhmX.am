export function FileUploader({ label, multiple, accept, onChange }: { label: string; multiple?: boolean; accept?: string; onChange: (files: FileList | null) => void }) {
  return (
    <label className="panel block cursor-pointer p-4 text-center text-sm text-muted">
      <div>{label}</div>
      <input className="hidden" type="file" accept={accept} multiple={multiple} onChange={(e) => onChange(e.target.files)} />
    </label>
  );
}
