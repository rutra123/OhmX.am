import type { MouseEvent } from 'react';
type PinButtonProps = {
  active: boolean;
  onClick: () => void;
  title?: string;
  className?: string;
  size?: 'sm' | 'md';
};

export function PinButton({ active, onClick, title, className = '', size = 'sm' }: PinButtonProps) {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  };

  return (
    <button
      type="button"
      className={`pin-icon-btn ${size === 'md' ? 'pin-icon-btn--md' : ''} ${active ? 'active' : ''} ${className}`.trim()}
      onClick={handleClick}
      aria-pressed={active}
      title={title}
    >
      {/* heart icon (filled when saved); the navigation-bar pin in the catalog header keeps the pin icon */}
      <svg className="pin-icon-btn__svg h-4 w-4" viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
        <path d="m12 20-1.5-1.3C5 14 2 11.2 2 7.8A4.8 4.8 0 0 1 6.8 3c1.8 0 3.5.8 4.6 2.2A6 6 0 0 1 16 3a4.8 4.8 0 0 1 4.8 4.8c0 3.4-3 6.2-8.5 10.9Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
