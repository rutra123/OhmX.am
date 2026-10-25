export function BrandChip({ brand, active, onClick }: { brand: string; active?: boolean; onClick?: () => void }) {
  return <button onClick={onClick} className={`chip ${active ? 'border-primary text-white' : ''}`}>{brand}</button>;
}
