export type ProductRelationType = 'required' | 'recommended' | 'optional' | 'alternative' | 'incompatible';
export type CompatibilityStatus = 'compatible' | 'compatible_when_conditions_match' | 'requires_manual_review' | 'incompatible' | 'unknown';

export type PublicProductSummary = {
  id: number | string;
  slug?: string;
  sku?: string;
  name_ru?: string;
  name?: string;
  brand_name?: string;
  price_amd?: number | string | null;
  show_price?: number | boolean | null;
  can_add_to_cart?: number | boolean | null;
  availability_status?: string | null;
  availability_label?: string | null;
  images?: Array<{ id?: number | string; image_url?: string; alt_text?: string }>;
  [key: string]: unknown;
};

export type SafeRelationshipConditions = Record<string, string | number | boolean | null | Array<string | number | boolean | null>>;

export type RelatedProductItem = {
  product?: PublicProductSummary;
  relationType?: ProductRelationType;
  reasonEngineering?: string;
  conditions?: SafeRelationshipConditions | null;
  compatibilityStatus?: CompatibilityStatus;
};

export type RelatedProductGroups = {
  required: RelatedProductItem[];
  recommended: RelatedProductItem[];
  optional: RelatedProductItem[];
  alternatives: RelatedProductItem[];
};

export type CompatibilityWarning = {
  relationType?: ProductRelationType;
  reasonEngineering?: string;
  conditions?: SafeRelationshipConditions | null;
  compatibilityStatus?: CompatibilityStatus;
  product?: PublicProductSummary;
  targetProductId?: number | string;
};

export type SeriesKitItem = PublicProductSummary & {
  color?: string;
  color_key?: string;
  type_label?: string;
  cover_image?: string;
  matches_product?: boolean;
};

export type SeriesKitColorVariant = {
  slug: string;
  name_ru: string;
  color: string;
  color_key: string;
  cover_image?: string;
  availability_status?: string;
};

export type SeriesKit = {
  familyName: string;
  productColor: string;
  productColorKey: string;
  defaultColorKey: string;
  colors: Array<{ key: string; label: string; count: number }>;
  colorVariants: SeriesKitColorVariant[];
  groups: Array<{ key: string; title: string; items: SeriesKitItem[] }>;
};

export type ProductPageApiResponse = {
  product: PublicProductSummary & Record<string, unknown>;
  relatedProducts?: PublicProductSummary[];
  relatedProductGroups?: Partial<RelatedProductGroups> | null;
  compatibilityWarnings?: CompatibilityWarning[] | null;
  seriesKit?: SeriesKit | null;
};

export const emptyRelatedProductGroups = (): RelatedProductGroups => ({
  required: [],
  recommended: [],
  optional: [],
  alternatives: [],
});
