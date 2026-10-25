export interface Product {
  id: number;
  slug: string;
  sku: string;
  name: string;
  brand: string;
  article: string;
  powerKw?: number | null;
  recommendedAreaM2?: number | null;
  price?: number | null;
  currency?: string;
  image?: string;
  availabilityStatus: string;
  availabilityLabel: string;
  preorderNote: string;
  equipmentType: string;
  energySource: string;
  systemType: string;
}
