// client/src/features/warmFloor/services/accessoryRecommender.ts

import type { WarmFloorSettingsV2 } from '../types/warmFloorSettings';
import type { CalculationResult } from '../types/calculatorState';
import type { Accessory } from '../types/accessory';

export interface RecommendedAccessories {
  thermostat: Accessory[];
  floorSensor: Accessory[];
  corrugatedTube: Accessory[];
  protection: Accessory[];
  mountingTape: Accessory[];
  contactor?: Accessory[];
}

/**
 * Жёсткая проверка — является ли товар термостатом именно для тёплого пола
 */
const isFloorHeatingThermostat = (query: string): boolean => {
  const text = query.toLowerCase();

  // Негативные маркеры (точно не подходит)
  const negativeKeywords = [
    'охладител', 'бутылок', 'жидкост', 'радиатор', 'воздух',
    'комнатный термостат', 'air thermostat', 'термостат без датчика пола',
    'для холодильника', 'для кондиционера', 'для бойлера', 'для радиатора'
  ];

  // Положительные маркеры (должно быть хотя бы одно)
  const positiveKeywords = [
    'теплого пола', 'тёплого пола', 'warm floor', 'underfloor',
    'датчик пола', 'floor sensor', 'для теплого пола', 'теплый пол'
  ];

  const hasNegative = negativeKeywords.some(kw => text.includes(kw));
  const hasPositive = positiveKeywords.some(kw => text.includes(kw));

  return !hasNegative && hasPositive;
};

export function getRecommendedAccessories(
  result: CalculationResult,
  settings: WarmFloorSettingsV2
): RecommendedAccessories {
  const rules = settings.accessoryRules;

  // === Термостаты (строгая фильтрация) ===
  const thermostat: Accessory[] = rules.thermostat.query
    .filter(query => isFloorHeatingThermostat(query))
    .slice(0, 6)
    .map(query => ({
      category: 'thermostat',
      query,
      required: true,
      note: rules.thermostat.note,
    }));

  // Если после жёсткой фильтрации ничего не осталось — берём безопасный fallback
  if (thermostat.length === 0) {
    thermostat.push({
      category: 'thermostat',
      query: 'терморегулятор для теплого пола',
      required: true,
    });
  }

  const floorSensor: Accessory[] = rules.floorSensor.query.map(query => ({
    category: 'floorSensor',
    query,
    required: true,
  }));

  const corrugatedTube: Accessory[] = rules.corrugatedTube.query.map(query => ({
    category: 'corrugatedTube',
    query,
    required: true,
  }));

  const protection: Accessory[] = rules.protection.query.map(query => ({
    category: 'protection',
    query,
    required: true,
  }));

  const mountingTape: Accessory[] = rules.mountingTape.requiredForCable
    ? rules.mountingTape.query.map(query => ({
        category: 'mountingTape',
        query,
        required: true,
      }))
    : [];

  let contactor: Accessory[] | undefined;
  if (result.actualCurrentA > 14) { // Simplified check for now
    contactor = rules.contactor.query.map(query => ({
      category: 'contactor',
      query,
      required: true,
      note: rules.contactor.note,
    }));
  }

  return {
    thermostat,
    floorSensor,
    corrugatedTube,
    protection,
    mountingTape,
    contactor,
  };
}
