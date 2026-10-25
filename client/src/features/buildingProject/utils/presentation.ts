/**
 * Phase 3.2M — single presentation mapper for Building Project primary UI.
 *
 * Raw engineering identifiers (method ids, provenance tokens, internal enum
 * names) must never reach the primary user-facing result. This module is the
 * ONLY place that translates them into understandable Russian labels; the
 * persisted enums/values and the backend are left untouched.
 */
import type { BuildingLoadMode } from '../types';

function modeLabel(mode: BuildingLoadMode | string): string {
  switch (mode) {
    case 'steady_state':
      return 'Профессиональный теплотехнический расчёт';
    case 'professional':
      return 'Устаревший профессиональный расчёт';
    case 'quick':
      return 'Предварительный расчёт';
    default:
      return String(mode);
  }
}

export function loadModeRussianLabel(mode: BuildingLoadMode | string | null | undefined): string {
  if (!mode) return '—';
  return modeLabel(mode);
}

export function methodDisplayName(methodId: string | null | undefined): string {
  if (!methodId) return '—';
  switch (methodId) {
    case 'ohmx.steady-state.v1':
      return 'Профессиональный теплотехнический расчёт';
    case 'building.loads.professional':
      return 'Устаревший профессиональный расчёт';
    case 'building.loads.quick':
    case 'ohmx.quick-load.v1':
      return 'Предварительный расчёт QUICK';
    default:
      return methodId;
  }
}

const AIRTIGHTNESS_RU: Record<string, string> = {
  poor: 'старый частный дом',
  average: 'обычная герметичность',
  good: 'хорошая герметичность',
  high: 'очень высокая герметичность',
};

function airProfileRu(token: string): string {
  // token looks like `airtightness_poor_private_house`
  const cls = Object.keys(AIRTIGHTNESS_RU).find((k) => token.includes(k));
  return cls ? AIRTIGHTNESS_RU[cls] : '';
}

/**
 * Translate one raw warning/provenance token into user-facing Russian, without
 * renaming the persisted value. Uses a single mapper; no per-component
 * string.replace.
 */
export function unmaskTechnicalString(raw: string): string {
  if (!raw) return raw;
  const value = String(raw).trim();

  // profile_default:<component>_<…>
  if (value.startsWith('profile_default:')) {
    const rest = value.slice('profile_default:'.length);
    if (rest.startsWith('airtightness_')) {
      const label = airProfileRu(rest);
      if (label) return `Типовой профиль герметичности: ${label}`;
    }
    if (rest.startsWith('occupancy_') || rest.startsWith('occupant_')) {
      return 'Типовой профиль количества людей';
    }
    if (rest.startsWith('lighting_')) return 'Типовой профиль освещения';
    if (rest.startsWith('equipment_')) return 'Типовой профиль оборудования';
    return 'Типовой инженерный профиль';
  }

  // occupant_profile:75W_person
  if (value.startsWith('occupant_profile:')) return 'Типовые удельные тепловыделения человека (75 Вт)';

  if (value === 'construction_profile') return 'Типовые характеристики конструкции';
  if (value === 'legacy_insulation_seed') return 'Утепление по базовому профилю объекта';
  if (value === 'certificate') return 'Введено по известным характеристикам';
  if (value === 'profile_default') return 'Типовой инженерный профиль';

  // measured/provenance short tokens
  if (value === 'measured') return 'Измерено';
  if (value === 'airtightness_profile') return 'Профиль герметичности';
  if (value === 'explicit_ach') return 'Заданная кратность воздухообмена';
  if (value === 'blower_door_derived') return 'Определено по бловер-дору (ACH50)';

  return value;
}

export const BREAKDOWN_LABELS: Record<string, string> = {
  transmissionHeatingW: 'Теплопотери через конструкции',
  transmissionCoolingW: 'Теплопередача через конструкции',
  airHeatingW: 'Вентиляция и воздух',
  airCoolingW: 'Вентиляция и воздух',
  solarCoolingW: 'Солнце',
  internalCoolingW: 'Люди и внутренние источники',
};

/** Tech method/version/provenance only for the "Технические подробности" area. */
export function technicalDetailsKey(methodId: string | null | undefined, methodVersion: string | null | undefined): string {
  if (!methodId) return '—';
  return methodVersion ? `${methodId} · ${methodVersion}` : methodId;
}