import type { CompositionLayer } from '../config/categoryCompositions';

/** Independent, proportional layers. Category text already names the link. */
export function CategoryComposition({ layers, className = '' }: { layers: CompositionLayer[]; className?: string }) {
  return (
    <div className={`category-composition ${className}`} aria-hidden="true">
      {layers.slice().sort((a, b) => a.z - b.z).map((layer) => (
        <img
          key={layer.src}
          src={layer.src}
          srcSet={layer.srcSet}
          sizes={layer.sizes}
          width={layer.intrinsicWidth}
          height={layer.intrinsicHeight}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="category-composition__layer"
          data-source-stem={layer.sourceStem}
          style={{ width: `${layer.widthPct}%`, left: `${layer.leftPct}%`, bottom: `${layer.bottomPct}%`, zIndex: layer.z }}
        />
      ))}
    </div>
  );
}
