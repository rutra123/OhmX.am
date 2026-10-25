// client/src/features/warmFloor/services/brandRefiner.ts

import type { WarmFloorSettingsV2 } from '../types/warmFloorSettings';
import type { RecommendedAccessories } from './accessoryRecommender';
import type { BrandId } from '../types/brand';

export function refineRecommendationsByBrand(
  accessories: RecommendedAccessories,
  brandId: BrandId,
  settings: WarmFloorSettingsV2
): RecommendedAccessories {
  const brand = settings.brandSelection.options.find(b => b.id === brandId);
  if (!brand) return accessories;

  const refined = { ...accessories };

  // Приоритизация термостатов под бренд
  if (brand.preferredThermostats.length > 0) {
    const preferred = brand.preferredThermostats.map(p => p.toLowerCase());

    refined.thermostat = [
      ...refined.thermostat.filter(t =>
        preferred.some(p => t.query.toLowerCase().includes(p))
      ),
      ...refined.thermostat.filter(t =>
        !preferred.some(p => t.query.toLowerCase().includes(p))
      ),
    ];
  }

  // Можно также обновлять query под бренд (для будущего поиска)
  // Пока просто возвращаем обновлённый список

  return refined;
}
