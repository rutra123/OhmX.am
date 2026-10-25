export interface Category {
  id: number;
  parent_id: number | null;
  parent_name?: string | null;
  name_ru: string;
  name_hy?: string;
  name_en?: string;
  slug: string;
  description_ru?: string;
  short_description_ru?: string;
  icon?: string;
  image_url?: string;
  sort_order: number;
  is_active: number | boolean;
  is_public?: number | boolean;
  is_public_card?: number | boolean;
  level: number;
  children_count?: number;
  product_count?: number;
  created_at?: string;
  updated_at?: string;
}
