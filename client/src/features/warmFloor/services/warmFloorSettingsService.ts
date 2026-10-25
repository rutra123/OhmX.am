// client/src/features/warmFloor/services/warmFloorSettingsService.ts

import type { WarmFloorSettingsV2 } from '../types/warmFloorSettings';

let cachedSettings: WarmFloorSettingsV2 | null = null;

export async function loadWarmFloorSettingsV2(): Promise<WarmFloorSettingsV2> {
  if (cachedSettings) {
    return cachedSettings;
  }

  try {
    const response = await fetch('/data/warm_floor_settings_v2.json');
    if (!response.ok) {
      throw new Error(`Failed to load settings: ${response.status}`);
    }

    const data: any = await response.json();

    // Базовая валидация (ослаблена для поддержки v3)
    if (!data.roomPowerProfilesWm2 && !data.powerPresetsWm2) {
      throw new Error('Invalid settings structure');
    }

    // Совместимость v3 -> v2 (минимальная для работы UI)
    if (data.meta && data.meta.schemaVersion === "3.0.0") {
       data.powerPresetsWm2 = data.roomPowerProfilesWm2;
       data.coveringCompatibility = data.floorCoverings;
       
       // Обеспечиваем наличие структуры v2 для старого движка
       data.voltage = data.electricalSystem?.nominalVoltageV || 230;
       data.safetyFactor = 1.1; // Default fallback
       
       if (!data.calculationRules || !data.calculationRules.numberOfCircuits) {
         data.calculationRules = {
           ...data.calculationRules,
           numberOfCircuits: {
             maxPowerPerCircuitW: 3600,
             maxLengthPerCircuitM: 150,
             default: 1,
             note: "Автоматический предел"
           },
           roundSpacingToAllowed: true,
           currentCalculation: "actualTotalPowerW / nominalVoltageV"
         };
       }

       if (!data.allowedCableSpacingCm) {
         data.allowedCableSpacingCm = [7.5, 10, 12.5, 15, 17.5, 20];
       }

       // Глубокий маппинг правил для аксессуаров
       const v3Acc = data.accessoryRules || {};
       data.accessoryRules = {
         thermostat: { 
           required: true, 
           query: v3Acc.thermostat?.fallbackSearchTerms || ["терморегулятор"], 
           note: "" 
         },
         floorSensor: { 
           required: true, 
           query: v3Acc.floorSensor?.fallbackSearchTerms || ["датчик пола"] 
         },
         corrugatedTube: { 
           required: true, 
           query: v3Acc.sensorConduit?.fallbackSearchTerms || ["гофра"] 
         },
         protection: { 
           required: true, 
           query: v3Acc.protection?.fallbackSearchTerms || ["узо"] 
         },
         mountingTape: { 
           requiredForCable: true, 
           query: v3Acc.mountingTape?.fallbackSearchTerms || ["лента"] 
         },
         contactor: { 
           requiredWhenCurrentOverA: 14, 
           query: v3Acc.powerContactor?.fallbackSearchTerms || ["контактор"], 
           note: "Требуется при высокой нагрузке" 
         }
       };

       if (!data.warningTexts) {
         data.warningTexts = data.warnings || {};
       }
    }

    cachedSettings = data;
    return data;
  } catch (error) {
    console.error('Error loading warm floor settings v2:', error);
    throw error;
  }
}

export function clearWarmFloorSettingsCache() {
  cachedSettings = null;
}
