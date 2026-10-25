/**
 * Building Project Phase 2.8 — integrity / readiness validation.
 *
 * Backend is the authority. Warnings never auto-block Confirm.
 * This module must stay free of Phase 3 numbers (kW, BTU, flow, DN, SKU).
 */
import {
  HYDRONIC_FAN_COIL_FAMILY_IDS,
  HYDRONIC_TERMINAL_FAMILY_IDS,
} from './buildingProjectHydronics.js';
import type {
  BuildingProject,
  EngineeringRoomAssignment,
  EngineeringSystemConfiguration,
  EngineeringSystemFamily,
  ServicePreference,
  SystemsValidationResult,
  ValidationIssue,
} from './buildingProjectTypes.js';

export interface SystemsFamilyApi {
  familyById(id: string): EngineeringSystemFamily | null;
  isProjectSharedSourceFamily(family: EngineeringSystemFamily | null | undefined): boolean;
  isRoomLocalSystemFamily(family: EngineeringSystemFamily | null | undefined): boolean;
  servicesSupportedByFamily(family: EngineeringSystemFamily | null | undefined): Set<'heating' | 'cooling'>;
}

let familyApi: SystemsFamilyApi | null = null;

export function registerSystemsFamilyApi(api: SystemsFamilyApi) {
  familyApi = api;
}

function api(): SystemsFamilyApi {
  if (!familyApi) {
    throw new Error('buildingProjectValidation: systems family API is not registered');
  }
  return familyApi;
}

function isProjectSharedSourceFamily(family: EngineeringSystemFamily | null | undefined): boolean {
  return api().isProjectSharedSourceFamily(family);
}

function isRoomLocalSystemFamily(family: EngineeringSystemFamily | null | undefined): boolean {
  return api().isRoomLocalSystemFamily(family);
}

function servicesSupportedByFamily(family: EngineeringSystemFamily | null | undefined): Set<'heating' | 'cooling'> {
  return api().servicesSupportedByFamily(family);
}

export class BuildingSystemsValidationError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const VALIDATION_CODES = {
  missingRequestedService: 'missing_requested_service',
  missingHeatingArchitecture: 'missing_heating_architecture',
  missingCoolingArchitecture: 'missing_cooling_architecture',
  requiredRoomMissingTerminal: 'required_room_missing_terminal',
  familyServiceMismatch: 'family_service_mismatch',
  unknownSourceId: 'unknown_source_id',
  sourceMissingService: 'source_missing_required_service',
  sourceTerminalIncompatible: 'source_terminal_incompatible',
  hydronicTerminalMissingSource: 'hydronic_terminal_missing_source',
  unsupportedRoomCombination: 'unsupported_room_combination',
  notYetVerifiedActive: 'not_yet_verified_active',
  simultaneousUnsupported: 'simultaneous_heat_cool_unsupported',
  roomSourceConflictsProject: 'room_source_conflicts_project',
  conflictingCentralSources: 'conflicting_central_sources',
} as const;

const HYDRONIC_HEATING_SOURCE_IDS = new Set([
  'gas_boiler',
  'gas_condensing_boiler',
  'electric_boiler',
  'heat_pump_air_to_water',
  'reversible_air_to_water_heat_pump',
  'external_building_heating_supply',
]);

const HYDRONIC_COOLING_SOURCE_IDS = new Set([
  'chiller_fan_coils',
  'reversible_air_to_water_heat_pump',
  'external_building_cooling_supply',
]);

function issue(
  code: string,
  message: string,
  extra: Partial<Pick<ValidationIssue, 'roomId' | 'service' | 'familyId'>> = {},
): ValidationIssue {
  return { code, message, ...extra };
}

function familyOf(id: string | null | undefined): EngineeringSystemFamily | null {
  if (!id) return null;
  return api().familyById(id);
}

function assignmentSystems(assignment: EngineeringRoomAssignment, service: 'heating' | 'cooling') {
  return service === 'heating' ? assignment.heatingSystems : assignment.coolingSystems;
}

function preferenceOf(assignment: EngineeringRoomAssignment, service: 'heating' | 'cooling'): ServicePreference {
  const value = assignment.servicePreferences?.[service];
  return value === 'required' || value === 'optional' || value === 'not_required' ? value : 'optional';
}

function hasCompatibleHeatingTerminal(assignment: EngineeringRoomAssignment): boolean {
  return assignment.heatingSystems.some((item) => {
    const family = familyOf(item.familyId);
    return Boolean(family && api().servicesSupportedByFamily(family).has('heating'));
  });
}

function hasCompatibleCoolingTerminal(assignment: EngineeringRoomAssignment): boolean {
  return assignment.coolingSystems.some((item) => {
    const family = familyOf(item.familyId);
    return Boolean(family && api().servicesSupportedByFamily(family).has('cooling'));
  });
}

function projectHydronicHeatingSourceId(config: EngineeringSystemConfiguration): string | null {
  const id = config.architecture.spaceCombinedSourceId || config.architecture.spaceHeatingSourceId;
  return id && HYDRONIC_HEATING_SOURCE_IDS.has(id) ? id : null;
}

function projectHydronicCoolingSourceId(config: EngineeringSystemConfiguration): string | null {
  const id = config.architecture.spaceCombinedSourceId || config.architecture.spaceCoolingSourceId;
  return id && HYDRONIC_COOLING_SOURCE_IDS.has(id) ? id : null;
}

function sharedHeatingSourceIds(config: EngineeringSystemConfiguration): string[] {
  const ids: string[] = [];
  for (const family of config.selectedSystemFamilies) {
    if (!isProjectSharedSourceFamily(family)) continue;
    if (!servicesSupportedByFamily(family).has('heating')) continue;
    if (family.kind === 'solution_template') continue;
    ids.push(family.id);
  }
  return [...new Set(ids)];
}

function sharedCoolingSourceIds(config: EngineeringSystemConfiguration): string[] {
  const ids: string[] = [];
  for (const family of config.selectedSystemFamilies) {
    if (!isProjectSharedSourceFamily(family)) continue;
    if (!servicesSupportedByFamily(family).has('cooling')) continue;
    if (family.kind === 'solution_template') continue;
    ids.push(family.id);
  }
  return [...new Set(ids)];
}

function hasAnyHeatingArchitecture(config: EngineeringSystemConfiguration): boolean {
  if (config.architecture.spaceHeatingSourceId || config.architecture.spaceCombinedSourceId) return true;
  if (sharedHeatingSourceIds(config).length) return true;
  return config.roomAssignments.some((assignment) => hasCompatibleHeatingTerminal(assignment));
}

function hasAnyCoolingArchitecture(config: EngineeringSystemConfiguration): boolean {
  if (config.architecture.spaceCoolingSourceId || config.architecture.spaceCombinedSourceId) return true;
  if (sharedCoolingSourceIds(config).length) return true;
  return config.roomAssignments.some((assignment) => hasCompatibleCoolingTerminal(assignment));
}

function activeNotYetVerifiedFamilies(config: EngineeringSystemConfiguration): Array<{ familyId: string; roomId?: string; service?: 'heating' | 'cooling' }> {
  const hits: Array<{ familyId: string; roomId?: string; service?: 'heating' | 'cooling' }> = [];
  const archIds = [
    config.architecture.spaceHeatingSourceId,
    config.architecture.spaceCoolingSourceId,
    config.architecture.spaceCombinedSourceId,
    ...config.architecture.sources.map((s) => s.familyId),
  ].filter(Boolean) as string[];
  for (const id of archIds) {
    const family = familyOf(id);
    if (family?.capabilityStatus === 'not_yet_verified') hits.push({ familyId: id });
  }
  for (const assignment of config.roomAssignments) {
    for (const service of ['heating', 'cooling'] as const) {
      if (preferenceOf(assignment, service) !== 'required') continue;
      for (const item of assignmentSystems(assignment, service)) {
        if (item.capabilityStatus === 'not_yet_verified' || familyOf(item.familyId)?.capabilityStatus === 'not_yet_verified') {
          hits.push({ familyId: item.familyId, roomId: assignment.roomId, service });
        }
      }
    }
  }
  return hits;
}

export function validateSystemsConfigurationForConfirmation(
  project: BuildingProject,
  config: EngineeringSystemConfiguration | null | undefined,
): SystemsValidationResult {
  const blockers: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const info: ValidationIssue[] = [];

  if (!config) {
    return {
      ready: false,
      blockers: [issue(VALIDATION_CODES.missingRequestedService, 'Выберите отопление, охлаждение или обе задачи проектирования.')],
      warnings,
      info,
    };
  }

  const requested = config.requestedServices.filter((s): s is 'heating' | 'cooling' => s === 'heating' || s === 'cooling');
  if (!requested.length) {
    blockers.push(issue(VALIDATION_CODES.missingRequestedService, 'Выберите отопление, охлаждение или обе задачи проектирования.'));
  }

  if (requested.includes('heating') && !hasAnyHeatingArchitecture(config)) {
    blockers.push(issue(VALIDATION_CODES.missingHeatingArchitecture, 'Для отопления нет допустимой архитектуры источника или терминала.', { service: 'heating' }));
  }
  if (requested.includes('cooling') && !hasAnyCoolingArchitecture(config)) {
    blockers.push(issue(VALIDATION_CODES.missingCoolingArchitecture, 'Для охлаждения нет допустимой архитектуры источника или терминала.', { service: 'cooling' }));
  }

  if (config.simultaneousHeatCoolRequired && !config.architecture.simultaneousHeatCoolSupported) {
    blockers.push(issue(
      VALIDATION_CODES.simultaneousUnsupported,
      'Требуется одновременное отопление и охлаждение разных зон, но выбранная архитектура это не поддерживает.',
    ));
  }

  const heatingSources = sharedHeatingSourceIds(config);
  const coolingSources = sharedCoolingSourceIds(config);
  if (heatingSources.length > 1) {
    blockers.push(issue(
      VALIDATION_CODES.conflictingCentralSources,
      `Одновременно выбраны конфликтующие центральные источники отопления (${heatingSources.join(', ')}). Multi-source архитектура не задана.`,
      { service: 'heating', familyId: heatingSources[1] },
    ));
  }
  if (coolingSources.length > 1) {
    blockers.push(issue(
      VALIDATION_CODES.conflictingCentralSources,
      `Одновременно выбраны конфликтующие центральные источники охлаждения (${coolingSources.join(', ')}). Multi-source архитектура не задана.`,
      { service: 'cooling', familyId: coolingSources[1] },
    ));
  }

  const projectHeatSource = config.architecture.spaceCombinedSourceId || config.architecture.spaceHeatingSourceId;
  const projectCoolSource = config.architecture.spaceCombinedSourceId || config.architecture.spaceCoolingSourceId;

  for (const id of [projectHeatSource, projectCoolSource, ...config.architecture.sources.map((s) => s.familyId)]) {
    if (!id) continue;
    if (!familyOf(id)) {
      blockers.push(issue(VALIDATION_CODES.unknownSourceId, `Неизвестный идентификатор источника: ${id}.`, { familyId: id }));
    }
  }

  if (projectHeatSource) {
    const family = familyOf(projectHeatSource);
    if (family && requested.includes('heating') && !servicesSupportedByFamily(family).has('heating')) {
      blockers.push(issue(VALIDATION_CODES.sourceMissingService, `Источник ${family.label} не поддерживает отопление.`, { service: 'heating', familyId: family.id }));
    }
  }
  if (projectCoolSource) {
    const family = familyOf(projectCoolSource);
    if (family && requested.includes('cooling') && !servicesSupportedByFamily(family).has('cooling')) {
      blockers.push(issue(VALIDATION_CODES.sourceMissingService, `Источник ${family.label} не поддерживает охлаждение.`, { service: 'cooling', familyId: family.id }));
    }
  }

  for (const hit of activeNotYetVerifiedFamilies(config)) {
    const family = familyOf(hit.familyId);
    blockers.push(issue(
      VALIDATION_CODES.notYetVerifiedActive,
      `${family?.label || hit.familyId}: расчёт в разработке — нельзя подтверждать как инженерно проверенную схему.`,
      { familyId: hit.familyId, roomId: hit.roomId, service: hit.service },
    ));
  }

  const roomsById = new Map(project.rooms.map((room) => [room.id, room]));

  for (const assignment of config.roomAssignments) {
    const room = roomsById.get(assignment.roomId);
    const roomName = room?.name || assignment.roomName || assignment.roomId;

    for (const service of ['heating', 'cooling'] as const) {
      if (!requested.includes(service)) continue;
      const pref = preferenceOf(assignment, service);
      const systems = assignmentSystems(assignment, service);

      for (const item of systems) {
        const family = familyOf(item.familyId);
        if (!family) {
          blockers.push(issue(VALIDATION_CODES.unknownSourceId, `${roomName}: неизвестная система ${item.familyId}.`, { roomId: assignment.roomId, service, familyId: item.familyId }));
          continue;
        }
        if (!servicesSupportedByFamily(family).has(service)) {
          blockers.push(issue(
            VALIDATION_CODES.familyServiceMismatch,
            `${roomName}: ${family.label} нельзя назначить на ${service === 'heating' ? 'отопление' : 'охлаждение'}.`,
            { roomId: assignment.roomId, service, familyId: family.id },
          ));
        }
      }

      if (pref === 'required') {
        const hasTerminal = service === 'heating' ? hasCompatibleHeatingTerminal(assignment) : hasCompatibleCoolingTerminal(assignment);
        if (!hasTerminal) {
          blockers.push(issue(
            VALIDATION_CODES.requiredRoomMissingTerminal,
            `${roomName}: для обязательного ${service === 'heating' ? 'отопления' : 'охлаждения'} нет подходящего терминала или системы.`,
            { roomId: assignment.roomId, service },
          ));
        }
      }

      const roomSourceId = assignment.sourceSystemIds?.[service] || null;
      if (roomSourceId) {
        const roomSource = familyOf(roomSourceId);
        if (!roomSource) {
          blockers.push(issue(VALIDATION_CODES.unknownSourceId, `${roomName}: неизвестный источник ${roomSourceId}.`, { roomId: assignment.roomId, service, familyId: roomSourceId }));
        } else {
          if (!servicesSupportedByFamily(roomSource).has(service)) {
            blockers.push(issue(
              VALIDATION_CODES.sourceMissingService,
              `${roomName}: источник ${roomSource.label} не поддерживает ${service === 'heating' ? 'отопление' : 'охлаждение'}.`,
              { roomId: assignment.roomId, service, familyId: roomSource.id },
            ));
          }
          const projectSource = service === 'heating' ? projectHeatSource : projectCoolSource;
          if (
            isProjectSharedSourceFamily(roomSource)
            && projectSource
            && roomSource.id !== projectSource
            && isProjectSharedSourceFamily(familyOf(projectSource))
          ) {
            blockers.push(issue(
              VALIDATION_CODES.roomSourceConflictsProject,
              `${roomName}: источник помещения (${roomSource.label}) противоречит источнику объекта (${familyOf(projectSource)?.label || projectSource}).`,
              { roomId: assignment.roomId, service, familyId: roomSource.id },
            ));
          }
        }
      }

      if (service === 'heating') {
        const hydronicTerminals = assignment.heatingSystems.filter((item) => HYDRONIC_TERMINAL_FAMILY_IDS.has(item.familyId));
        if (hydronicTerminals.length && !projectHydronicHeatingSourceId(config) && !(roomSourceId && HYDRONIC_HEATING_SOURCE_IDS.has(roomSourceId))) {
          blockers.push(issue(
            VALIDATION_CODES.hydronicTerminalMissingSource,
            `${roomName}: водяной терминал отопления не имеет совместимого гидравлического источника.`,
            { roomId: assignment.roomId, service, familyId: hydronicTerminals[0]?.familyId },
          ));
        }
      }

      if (service === 'cooling') {
        const hydronicCoils = assignment.coolingSystems.filter((item) => HYDRONIC_FAN_COIL_FAMILY_IDS.has(item.familyId));
        if (hydronicCoils.length && !projectHydronicCoolingSourceId(config) && !(roomSourceId && HYDRONIC_COOLING_SOURCE_IDS.has(roomSourceId))) {
          blockers.push(issue(
            VALIDATION_CODES.hydronicTerminalMissingSource,
            `${roomName}: фанкойл охлаждения не имеет совместимого гидравлического источника холода.`,
            { roomId: assignment.roomId, service, familyId: 'fan_coils' },
          ));
        }
      }

      if (pref === 'required' && service === 'heating' && assignment.heatingSystems.length && !hasCompatibleHeatingTerminal(assignment)) {
        blockers.push(issue(
          VALIDATION_CODES.unsupportedRoomCombination,
          `${roomName}: набор систем отопления инженерно несовместим.`,
          { roomId: assignment.roomId, service },
        ));
      }
    }

    if (assignment.warnings?.length) {
      for (const message of assignment.warnings) {
        warnings.push(issue('room_warning', message, { roomId: assignment.roomId }));
      }
    }
  }

  for (const message of config.warnings || []) {
    if (!warnings.some((w) => w.message === message) && !blockers.some((b) => b.message === message)) {
      warnings.push(issue('configuration_warning', message));
    }
  }

  if (config.hydronicRequirements?.unresolvedRequirements?.length) {
    for (const item of config.hydronicRequirements.unresolvedRequirements) {
      info.push(issue('hydronic_pending', item));
    }
  }

  const unique = (list: ValidationIssue[]) => {
    const seen = new Set<string>();
    const out: ValidationIssue[] = [];
    for (const item of list) {
      const key = `${item.code}|${item.message}|${item.roomId || ''}|${item.service || ''}|${item.familyId || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  };

  const result: SystemsValidationResult = {
    ready: unique(blockers).length === 0,
    blockers: unique(blockers),
    warnings: unique(warnings),
    info: unique(info),
  };
  return result;
}

export function firstConfirmBlocker(result: SystemsValidationResult): ValidationIssue | null {
  return result.blockers[0] || null;
}

export function confirmErrorForBlocker(issueItem: ValidationIssue): BuildingSystemsValidationError {
  if (issueItem.code === VALIDATION_CODES.missingRequestedService) {
    return new BuildingSystemsValidationError('building.systems_missing_services', 'Choose heating, cooling, or both before confirming systems', issueItem);
  }
  if (issueItem.code === VALIDATION_CODES.simultaneousUnsupported) {
    return new BuildingSystemsValidationError(
      'building.systems_incompatible_architecture',
      'Одновременное отопление и охлаждение разных зон требует 4-трубной или независимой архитектуры. Выбранная схема это не поддерживает.',
      issueItem,
    );
  }
  if (issueItem.code === VALIDATION_CODES.familyServiceMismatch) {
    return new BuildingSystemsValidationError('building.systems_service_mismatch', issueItem.message, issueItem);
  }
  return new BuildingSystemsValidationError('building.systems_not_ready', issueItem.message, { blocker: issueItem });
}

/** Engineering-significant fingerprint. Excludes timestamps and revision counters. */
export function engineeringFingerprint(config: EngineeringSystemConfiguration): string {
  const rooms = [...config.roomAssignments]
    .map((a) => ({
      roomId: a.roomId,
      prefs: a.servicePreferences,
      prefSource: a.servicePreferenceSource,
      towel: a.towelRadiatorPreference,
      heat: a.heatingSystems.map((s) => s.familyId).sort(),
      cool: a.coolingSystems.map((s) => s.familyId).sort(),
      sources: a.sourceSystemIds,
    }))
    .sort((a, b) => a.roomId.localeCompare(b.roomId));
  const payload = {
    requestedServices: [...config.requestedServices],
    simultaneousHeatCoolRequired: Boolean(config.simultaneousHeatCoolRequired),
    families: config.selectedSystemFamilies.map((f) => f.id).sort(),
    architecture: {
      heat: config.architecture.spaceHeatingSourceId,
      cool: config.architecture.spaceCoolingSourceId,
      combined: config.architecture.spaceCombinedSourceId,
      distribution: config.architecture.distribution.id,
      circuitKind: config.architecture.distribution.circuitKind,
      supported: config.architecture.simultaneousHeatCoolSupported,
      dhw: config.architecture.dhw.status,
    },
    rooms,
  };
  return JSON.stringify(payload);
}

export function suggestionFamilyIdsForPreview(selectedIds: string[]): string[] {
  return selectedIds.filter((id) => {
    const family = familyOf(id);
    return Boolean(family && (isProjectSharedSourceFamily(family) || family.kind === 'source'));
  });
}

export function isRoomEditorFamily(family: EngineeringSystemFamily | null | undefined, service: 'heating' | 'cooling'): boolean {
  if (!family || family.external) return false;
  if (!servicesSupportedByFamily(family).has(service)) return false;
  if (family.kind === 'source') return false;
  if (isProjectSharedSourceFamily(family) && family.kind === 'combined' && family.scope === 'central') return false;
  return isRoomLocalSystemFamily(family) || family.kind === 'terminal' || family.kind === 'solution_template' || family.kind === 'combined';
}
