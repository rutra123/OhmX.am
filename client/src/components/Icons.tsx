import type { SVGProps } from 'react';

const I = (p: SVGProps<SVGSVGElement> & { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
    <path d={p.d} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const Home = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />;
export const LayoutGrid = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />;
export const Wrench = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M14.7 6.3a4 4 0 1 0 3 3L21 13l-4 4-3.7-3.3-6.6 6.6-2.4-2.4 6.6-6.6L6.6 7 10.6 3l4.1 3.3z" />;
export const Calculator = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 4h6M8.5 11h.01M12 11h.01M15.5 11h.01M8.5 15h.01M12 15h.01M15.5 15h.01" />;
export const ShoppingCart = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8H18a1 1 0 0 0 1-.8L21 7H7M9 20a1 1 0 1 1-2 0 1 1 0 0 1 2 0Zm10 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" />;
export const User = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M20 21a8 8 0 0 0-16 0M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />;
export const Search = (p: SVGProps<SVGSVGElement>) => <I {...p} d="m21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z" />;
export const Heart = (p: SVGProps<SVGSVGElement>) => <I {...p} d="m12 20-1.5-1.3C5 14 2 11.2 2 7.8A4.8 4.8 0 0 1 6.8 3c1.8 0 3.5.8 4.6 2.2A6 6 0 0 1 16 3a4.8 4.8 0 0 1 4.8 4.8c0 3.4-3 6.2-8.5 10.9Z" />;
export const Star = (p: SVGProps<SVGSVGElement>) => <I {...p} d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3Z" />;
export const FileText = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zm0 0v5h5M9 13h6M9 17h6M9 9h2" />;
export const Pin = (p: SVGProps<SVGSVGElement>) => <I {...p} d="m15 4 5 5-3 1-3 8-2-2-3 3-2-2 3-3-2-2 8-3 1-3Z" />;
export const GripVertical = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" />;
export const Bolt = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M13 2 5 13h5l-1 9 8-11h-5z" />;
export const Bell = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M15 17H5l1.4-1.4A2 2 0 0 0 7 14.2V10a5 5 0 1 1 10 0v4.2a2 2 0 0 0 .6 1.4L19 17h-4m0 0a3 3 0 1 1-6 0" />;
export const Check = (p: SVGProps<SVGSVGElement>) => <I {...p} d="m20 6-11 11-5-5" />;
export const Info = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 16v-4M12 8h.01" />;
export const ArrowLeft = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M15 18 9 12l6-6M9 12h11" />;
export const ChevronRight = (p: SVGProps<SVGSVGElement>) => <I {...p} d="m9 6 6 6-6 6" />;
export const Filter = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />;
export const ViewGrid = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" />;
export const ViewList = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M5 7h2M5 12h2M5 17h2M10 7h9M10 12h9M10 17h9" />;
export const Compare = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4M14 5h4a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-4M9 9l3 3-3 3M15 9l-3 3 3 3" />;
export const Document = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M8 3h6l5 5v13H8a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm5 1v5h5" />;
export const Sun = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M12 3v2.2M12 18.8V21M5.64 5.64l1.56 1.56M16.8 16.8l1.56 1.56M3 12h2.2M18.8 12H21M5.64 18.36l1.56-1.56M16.8 7.2l1.56-1.56M12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />;
export const Moon = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M20 14.5A7.5 7.5 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />;
export const Globe = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M12 3a9 9 0 1 0 0 18m0-18c2.4 2.5 3.8 5.7 4 9-0.2 3.3-1.6 6.5-4 9m0-18C9.6 5.5 8.2 8.7 8 12c0.2 3.3 1.6 6.5 4 9M4 12h16M5.3 7.5h13.4M5.3 16.5h13.4" />;

export const Snowflake = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M12 2v20M2 12h20M6 6l12 12M18 6L6 18M12 4l-2 2M12 4l2 2M12 20l-2-2M12 20l2-2M4 12l2 2M4 12l2-2M20 12l-2 2M20 12l-2-2" />;

export const Flame = (p: SVGProps<SVGSVGElement>) => <I {...p} d="M12 3C8 11 5 14 5 17.5a7 7 0 0 0 14 0c0-3.5-3-6.5-7-14.5zM9 5l-1 2M15 5l1 2" />;
