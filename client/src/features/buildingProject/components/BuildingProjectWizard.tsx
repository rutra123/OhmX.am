import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomPatch } from '../utils/roomPropagation';
import type { ReactNode } from 'react';
import { useBuildingProjectStore } from '../store/useBuildingProjectStore';
import {
  EQUIPMENT_UI_CSS,
  EquipmentPictogram,
  RoomEquipmentSelector,
  RoomHeading,
  RoomNavigator,
  ServiceGlyph,
  SharedSourceLine,
  ServiceSummaryLine,
  SourceChoiceList,
  TowelWarmerPanel,
  FanCoilMountingPanel,
} from './equipmentSelection/EquipmentSelection';
import { fanCoilCountByMounting, type FanCoilMounting } from '../equipment/fanCoilMounting';
import {
  EQUIPMENT_CHOICES_EVENT,
  fanCoilMountingKey,
  fanCoilMountingOf,
  loadEquipmentChoices,
  roomUsesFanCoils,
  saveEquipmentChoices,
  syncEquipmentChoices,
  withChoice,
  type EquipmentChoices,
} from '../utils/equipmentChoices';
import { ObjectGlyph, RoomGlyph } from './equipmentSelection/RoomIcon';
import { CFG_TEXT, CONFIGURATOR_CSS, Disclosure, Notice, ProjectServicesLabel, SegmentedChoice, StepNav } from './configurator/ConfiguratorUi';
import { equipmentSubtitle, roomServiceSummary, roomTerminalView, sharedRoomSource, type RoomTerminalView } from '../utils/equipmentPresentation';
import { groupValidationIssues, hydronicValueText, wizardSteps } from '../utils/configuratorPresentation';
import { suggestSystemsConfiguration } from '../services/buildingProjectApi';
import {
  apartmentSourceMode,
  projectSourceOptions,
  setApartmentSourceMode,
  setProjectSource,
  suggestionSourceFamilyIds,
} from '../systemsSourceModes';
import type {
  BasementType,
  BuildingCatalog,
  BuildingLoadCalculation,
  BuildingLoadMode,
  BuildingLoadState,
  BuildingProject,
  BuildingRoom,
  BuildingRoomInput,
  BuildingSystemsCatalog,
  BuildingSystemArchitecture,
  EngineeringRoomAssignment,
  EngineeringRoomSystemSelection,
  EngineeringSystemFamily,
  HydronicSystemRequirements,
  InsulationLevel,
  ObjectType,
  PlantLocationKind,
  RoomLoadResult,
  ServicePreference,
  SystemsValidationResult,
  TopBoundaryType,
  ValidationIssue,
  WindowGlazingType,
} from '../types';
import { RoomEngineeringPanel, type PanelSectionKey } from './RoomEngineeringPanel';
import { EngineeringQualityPanel } from './EngineeringQualityPanel';
import { EquipmentSpecPanel } from './EquipmentSpecPanel';
import {
  buildProjectMissingSummary,
  buildSteadyStateReadiness,
  firstMissingSection,
  friendlyMissingList,
  legacyLoadModes,
  loadModePrimaryLabel,
  primaryLoadModes,
  readinessStatusLabel,
  roomEditorMissingCount,
  roomEditorReadinessItems,
  serviceChoiceLabel,
  type SteadyStateReadiness,
} from '../utils/smartLoadUx';
import {
  loadModeRussianLabel,
  methodDisplayName,
  technicalDetailsKey,
  unmaskTechnicalString,
} from '../utils/presentation';
import {
  missingEditTarget,
  resolveReturnTarget,
  getWizardScrollContainer,
  scrollWizardToTop,
  stepChangeResetsScroll,
  type CalcStep,
  type MissingEditTarget,
} from '../utils/mobileNav';
import {
  QUICK_ENTRY_ATTR,
  areaProgress,
  expandRoomRows,
  focusNextEntry,
  formatQuickNumber,
  parseQuickNumber,
  standardRoomSet,
  type StandardRoomRow,
} from '../utils/quickEntry';
import {
  buildLoadResultSummary,
  climateLabelRu,
  explainRoomCooling,
  explainRoomHeating,
  formatPower,
  heatingCapacity,
  heatingReserveRatio,
  type RoomExplanation,
} from '../utils/loadResultSummary';
import {
  TOWEL_WARMER_MAX_QUANTITY,
  loadTowelWarmerOverrides,
  resolveProjectTowelWarmers,
  resolveTowelWarmer,
  saveTowelWarmerOverrides,
  towelWarmerKindLabel,
  towelWarmerTotals,
  type TowelWarmerKind,
  type TowelWarmerOverride,
  type TowelWarmerOverrides,
  type TowelWarmerSelection,
} from '../utils/towelWarmer';

type ServiceChoice = 'heating' | 'cooling' | 'heating_and_cooling';
type BulkTarget = 'all_rooms' | 'bedrooms' | 'living_rooms' | 'wet_rooms';
type RoomEditorSectionKey = 'main' | PanelSectionKey;

const WET_TYPES = new Set(['bathroom', 'shower', 'wc', 'laundry']);
const LIVING_TYPES = new Set(['bedroom', 'child_room', 'living_room', 'office', 'guest_room', 'dressing_room']);


const GROUP_LABEL: Record<string, string> = {
  living: 'Жилые', common: 'Общие', wet: 'Влажные', extra: 'Доп.', commercial: 'Коммерция',
};

const DISTRIBUTION_PRESETS = {
  hydronic_2pipe_heating_cooling: {
    id: 'hydronic_2pipe_heating_cooling',
    label: '2-трубная гидравлика отопления/охлаждения',
    circuitKind: '2pipe',
    simultaneousHeatCool: false,
    notes: ['Сезонное переключение: отопление или охлаждение по очереди.'],
  },
  hydronic_4pipe_heating_cooling: {
    id: 'hydronic_4pipe_heating_cooling',
    label: '4-трубная гидравлика отопления/охлаждения',
    circuitKind: '4pipe',
    simultaneousHeatCool: true,
    notes: ['Отдельные контуры отопления и охлаждения позволяют одновременно обслуживать разные зоны.'],
  },
} as const;

function clone<T>(value: T): T { return structuredClone(value); }

function roomIcon(type: string) {
  return <span className="bp-room-glyph" aria-hidden="true"><RoomGlyph roomType={type} size={20} /></span>;
}
const HEAT_MARK = <span className="bp-svc" data-service="heating" aria-hidden="true"><ServiceGlyph service="heating" size={16} /></span>;
const COOL_MARK = <span className="bp-svc" data-service="cooling" aria-hidden="true"><ServiceGlyph service="cooling" size={16} /></span>;

/** Room row in a multi-room list: the shared source is shown once above, so only a room-specific source stays in the row. */
function roomRowSummary(view: RoomTerminalView, shared: RoomTerminalView['source']) {
  if (view.source && (!shared || shared.familyId !== view.source.familyId)) return { state: 'selected' as const, items: [view.source, ...view.items] };
  return view;
}

/** Family ids of the existing recommended (suggested) scheme for one room, per service. */
function recommendedForRoom(list: EngineeringRoomAssignment[], roomId: string, catalog: BuildingSystemsCatalog | null): Partial<Record<'heating' | 'cooling', string[]>> | undefined {
  const item = list.find((a) => a.roomId === roomId);
  if (!item) return undefined;
  const families = catalog?.systemFamilies || [];
  return {
    heating: roomServiceSummary(item, 'heating', families).items.map((i) => i.familyId),
    cooling: roomServiceSummary(item, 'cooling', families).items.map((i) => i.familyId),
  };
}
function systemIcon(id: string) {
  return <span className="eq-inline-icon" aria-hidden="true"><EquipmentPictogram familyId={id} size={18} /></span>;
}

function matchBulkTarget(room: BuildingRoom, target: BulkTarget) {
  if (target === 'all_rooms') return true;
  if (target === 'bedrooms') return room.roomType === 'bedroom';
  if (target === 'wet_rooms') return WET_TYPES.has(room.roomType);
  return LIVING_TYPES.has(room.roomType);
}

function familyById(catalog: BuildingSystemsCatalog | null, id: string) {
  return catalog?.systemFamilies.find((item) => item.id === id) || null;
}

function choiceFromServices(services: Array<'heating' | 'cooling'>): ServiceChoice | null {
  if (services.includes('heating') && services.includes('cooling')) return 'heating_and_cooling';
  if (services.includes('heating')) return 'heating';
  if (services.includes('cooling')) return 'cooling';
  return null;
}

function getRoomTerminal(assignment: EngineeringRoomAssignment | undefined, architecture: BuildingSystemArchitecture | null): EngineeringRoomSystemSelection | null {
  if (!assignment || !architecture) return null;
  const combined = architecture.spaceCombinedSourceId;
  const heating = architecture.spaceHeatingSourceId;
  const cooling = architecture.spaceCoolingSourceId;

  // Prefer heating terminal for heating-only, cooling terminal for cooling-only.
  const allSystems = [...(assignment.heatingSystems || []), ...(assignment.coolingSystems || [])];
  for (const item of allSystems) {
    if (item.kind === 'terminal' || item.kind === 'solution_template') {
      // Skip source-level selections (reversible pump, boiler, etc.)
      if (item.familyId !== combined && item.familyId !== heating && item.familyId !== cooling) {
        return item;
      }
    }
  }
  return null;
}

function architectureSummary(architecture: BuildingSystemArchitecture, rooms: BuildingRoom[], assignments: EngineeringRoomAssignment[], catalog: BuildingSystemsCatalog | null) {
  if (!architecture) return null;
  const sourceLabel = familyById(catalog, architecture.spaceCombinedSourceId || architecture.spaceHeatingSourceId || architecture.spaceCoolingSourceId || '')?.label
    || architecture.spaceCombinedSourceId || architecture.spaceHeatingSourceId || architecture.spaceCoolingSourceId || '—';
  const distributionLabel = architecture.distribution?.label || '—';

  // Phase 2.7 — per-service source facts. External building supply is shown by
  // its family label («Центральное отопление здания» etc.); a room-local
  // cooling family (e.g. Настенный split) is presented as local room systems,
  // not as a shared project source.
  const heatingSourceId = architecture.spaceCombinedSourceId || architecture.spaceHeatingSourceId;
  const coolingSourceId = architecture.spaceCombinedSourceId || architecture.spaceCoolingSourceId;
  const heatingSourceFamily = familyById(catalog, heatingSourceId || '');
  const coolingSourceFamily = familyById(catalog, coolingSourceId || '');
  const heatingSourceLabel = heatingSourceFamily?.label || heatingSourceId || '—';
  const coolingSourceLabel = coolingSourceFamily?.label || coolingSourceId || '—';
  const coolingLocalOnly = Boolean(coolingSourceFamily && coolingSourceFamily.scope === 'room_local');

  const roomTerminals: Array<{ room: BuildingRoom; terminal: EngineeringRoomSystemSelection; service: 'heating' | 'cooling' | 'both' }> = [];
  for (const room of rooms) {
    const assignment = assignments.find((a) => a.roomId === room.id);
    if (!assignment) continue;
    const terminal = getRoomTerminal(assignment, architecture);
    if (terminal) {
      roomTerminals.push({ room, terminal, service: 'both' });
    }
  }

  const hasDhw = architecture.dhw?.status === 'configured' || architecture.dhw?.sourceFamilyId;
  return { sourceLabel, heatingSourceId, coolingSourceId, heatingSourceLabel, coolingSourceLabel, coolingLocalOnly, distributionLabel, roomTerminals, hasDhw, twoPipe: architecture.distribution?.circuitKind === '2pipe', simultaneousHeatCool: architecture.simultaneousHeatCoolSupported };
}

// ---------------------------------------------------------------------------
// Area consistency (UX feedback only — NEVER blocks, NEVER auto-corrects).
// Comparison uses the same 0.1 m² precision as the existing area fields, so
// floating-point noise like 180.0000001 cannot produce a false warning.
// ---------------------------------------------------------------------------
type AreaConsistencyState =
  | { state: 'under'; objectM2: number; roomsM2: number; deltaM2: number }
  | { state: 'equal'; objectM2: number; roomsM2: number; deltaM2: 0 }
  | { state: 'over'; objectM2: number; roomsM2: number; deltaM2: number };

function areaConsistency(totalArea: number | null, sumArea: number): AreaConsistencyState | null {
  if (totalArea == null) return null;
  const objectM2 = Math.round(totalArea * 10) / 10;
  const roomsM2 = Math.round(sumArea * 10) / 10;
  if (roomsM2 < objectM2) return { state: 'under', objectM2, roomsM2, deltaM2: Math.round((objectM2 - roomsM2) * 10) / 10 };
  if (roomsM2 === objectM2) return { state: 'equal', objectM2, roomsM2, deltaM2: 0 };
  return { state: 'over', objectM2, roomsM2, deltaM2: Math.round((roomsM2 - objectM2) * 10) / 10 };
}

function AreaConsistencySummary({ totalArea, sumArea }: { totalArea: number | null; sumArea: number }) {
  const c = areaConsistency(totalArea, sumArea);
  if (!c) return <span>Σ комнат: <strong>{sumArea.toFixed(1)} м²</strong></span>;
  if (c.state === 'under') {
    return (
      <span>
        Объект: <strong>{c.objectM2.toFixed(1)} м²</strong> · Помещения: <strong>{c.roomsM2.toFixed(1)} м²</strong> · Не распределено: <strong>{c.deltaM2.toFixed(1)} м²</strong>
      </span>
    );
  }
  if (c.state === 'equal') {
    return (
      <span>
        Объект: <strong>{c.objectM2.toFixed(1)} м²</strong> · Помещения: <strong>{c.roomsM2.toFixed(1)} м²</strong> · <span className="bp-ok">Площадь распределена полностью</span>
      </span>
    );
  }
  return (
    <span className="bp-alert">
      Объект: <strong>{c.objectM2.toFixed(1)} м²</strong> · Помещения: <strong>{c.roomsM2.toFixed(1)} м²</strong> · Превышение: <strong>+{c.deltaM2.toFixed(1)} м²</strong>
    </span>
  );
}

function AreaOverWarning({ totalArea, sumArea }: { totalArea: number | null; sumArea: number }) {
  const c = areaConsistency(totalArea, sumArea);
  if (!c || c.state !== 'over') return null;
  return (
    <div className="bp-alert" role="status">
      ⚠ Сумма площадей помещений превышает площадь объекта на {c.deltaM2.toFixed(1)} м².
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact Review labels. The central shared source (architecture-level) is
// shown ONCE in the system summary; each room line shows only what is in the
// room (terminals + room-local sources). Room-local sources are never hidden.
// ---------------------------------------------------------------------------
function compactRoomLabel(
  assignment: EngineeringRoomAssignment | undefined,
  service: 'heating' | 'cooling',
  catalog: BuildingSystemsCatalog | null,
  architecture: BuildingSystemArchitecture | null,
) {
  if (!assignment || assignment.servicePreferences[service] === 'not_required') return 'нет';
  const rawCentralId = service === 'heating'
    ? (architecture?.spaceCombinedSourceId || architecture?.spaceHeatingSourceId || null)
    : (architecture?.spaceCombinedSourceId || architecture?.spaceCoolingSourceId || null);
  // Phase 2.7 — a ROOM-LOCAL source family (e.g. Настенный split) is not a
  // central shared source: it belongs to the room and must render in the room
  // line. Only truly shared sources are deduplicated into the system summary.
  const centralFamily = rawCentralId ? familyById(catalog, rawCentralId) : null;
  const centralId = centralFamily && centralFamily.scope !== 'room_local' ? rawCentralId : null;
  const sourceId = assignment.sourceSystemIds[service];
  const systems = service === 'heating' ? assignment.heatingSystems : assignment.coolingSystems;
  const parts: string[] = [];
  // Room-local source (NOT the central shared source) stays in the room line.
  if (sourceId && sourceId !== centralId) parts.push(familyById(catalog, sourceId)?.label || sourceId);
  for (const item of systems) {
    // Central shared source is shown once in the system summary, not per room.
    if (item.familyId === centralId) continue;
    if (sourceId && item.familyId === sourceId) continue; // already listed as room-local source
    parts.push(item.label || familyById(catalog, item.familyId)?.label || item.familyId);
  }
  if (parts.length) return parts.join(' + ');
  // Served by a source but no terminal selected yet — keep the source name.
  if (sourceId) return familyById(catalog, sourceId)?.label || sourceId;
  return '—';
}

function emptyAssignment(room: BuildingRoom, requested: Array<'heating' | 'cooling'>): EngineeringRoomAssignment {
  return {
    roomId: room.id,
    roomName: room.name,
    roomPurpose: room.roomType,
    sourceSystemId: null,
    sourceSystemIds: { heating: null, cooling: null },
    userPreference: null,
    servicePreferences: {
      heating: requested.includes('heating') ? (WET_TYPES.has(room.roomType) ? 'required' : 'optional') : 'not_required',
      cooling: requested.includes('cooling') ? (WET_TYPES.has(room.roomType) ? 'not_required' : 'optional') : 'not_required',
    },
    servicePreferenceSource: { heating: 'default', cooling: 'default' },
    towelRadiatorPreference: (room.roomType === 'bathroom' || room.roomType === 'shower') ? 'optional' : 'not_required',
    towelRadiatorPreferenceSource: 'default',
    heatingSystems: [],
    coolingSystems: [],
    status: 'not_yet_verified',
    warnings: [],
    reasons: [],
  };
}

/**
 * Narrow an HTML select value (string) to the existing WindowGlazingType union.
 * '' and unknown values map to null (default/Обычное semantics). Validity is
 * proven against the same typed option list that renders the <option>s, so no
 * unsafe assertion is needed: find() can only return a WindowGlazingType.
 */
function parseWindowGlazingType(value: string, options: Array<{ value: WindowGlazingType; label: string }>): WindowGlazingType | null {
  if (value === '') return null;
  return options.find((o) => o.value === value)?.value ?? null;
}

/**
 * Narrow an HTML select value (string) to the existing InsulationLevel union.
 * '' and unknown values map to null («как у объекта» semantics). Validity is
 * proven against the same typed option list that renders the <option>s.
 */
function parseInsulationLevel(value: string, options: Array<{ value: InsulationLevel; label: string }>): InsulationLevel | null {
  if (value === '') return null;
  return options.find((o) => o.value === value)?.value ?? null;
}

export function BuildingProjectWizard() {
  const {
    project, catalog, systemsCatalog, step, isLoading, error, hydrated,
    loadState, loadFailed,
    hydrateFromStorage, createProject, updateMeta, setRoomTypeCount, updateRoom, removeRoom,
    confirmObject, reopenObject, saveSystemsConfiguration, applySuggestedSystems,
    confirmSystemsConfiguration, fetchLoadState, calculateLoads, setStep, startNewProject,
  } = useBuildingProjectStore();
  // Chains room saves so propagated (auto-filled) rooms are written after the room being edited.
  const lastRoomUpdateRef = useRef<Promise<void>>(Promise.resolve());

  const [createForm, setCreateForm] = useState({
    objectType: 'private_house' as ObjectType,
    regionCode: 'AM-ER',
    // No invented area: the object area is optional and stays empty until typed.
    totalAreaM2: '',
    defaultCeilingHeightM: '2.7',
    insulationLevel: 'medium' as InsulationLevel,
    name: '',
    floorCount: '1',
    basementType: 'none' as BasementType,
    topBoundaryType: 'direct_roof' as TopBoundaryType,
  });
  // Standard room rows preselected for a new project (editable counts, no areas).
  const [createRooms, setCreateRooms] = useState<StandardRoomRow[]>(() => standardRoomSet('private_house'));
  const [createError, setCreateError] = useState<string | null>(null);
  const [extraRoomType, setExtraRoomType] = useState('');
  const [openRoomId, setOpenRoomId] = useState<string | null>(null);
  const [engRoomId, setEngRoomId] = useState<string | null>(null);
  const [focusSectionKey, setFocusSectionKey] = useState<string | null>(null);
  const [missingEdit, setMissingEdit] = useState<MissingEditTarget | null>(null);
  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [roomDoneMessage, setRoomDoneMessage] = useState<string | null>(null);
  const [bulkSourceId, setBulkSourceId] = useState<string | null>(null);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [undoState, setUndoState] = useState<{ assignments: EngineeringRoomAssignment[]; validRevision: number } | null>(null);
  const [suggestion, setSuggestion] = useState<any | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [loadMode, setLoadMode] = useState<BuildingLoadMode>('quick');

  useEffect(() => { void hydrateFromStorage(); }, [hydrateFromStorage]);
  useEffect(() => {
    const onFocus = () => { void hydrateFromStorage(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [hydrateFromStorage]);
  // Phase 2.6: keep the selected floor tab valid when topology changes.
  useEffect(() => {
    if (!project?.topology?.floors?.length) return;
    const ids = project.topology.floors.map((f) => f.id);
    if (!selectedFloorId || !ids.includes(selectedFloorId)) setSelectedFloorId(ids[0]);
  }, [project?.topology?.floors, selectedFloorId]);
  // Phase 3.2L: a step change resets the SINGLE scroll owner (.mobile-scroll-content)
  // to the top of the working content — never window.scrollTo, never a preserved bottom.
  const prevStepRef = useRef<CalcStep | null>(null);
  useEffect(() => {
    const prev = prevStepRef.current;
    prevStepRef.current = step;
    if (stepChangeResetsScroll(prev, step)) scrollWizardToTop();
  }, [step]);

  const [towelOverrides, setTowelOverrides] = useState<TowelWarmerOverrides>({});
  useEffect(() => { setTowelOverrides(loadTowelWarmerOverrides(project?.id)); }, [project?.id]);
  const [eqChoices, setEqChoices] = useState<EquipmentChoices>({});
  useEffect(() => {
    const reload = () => setEqChoices(loadEquipmentChoices(project?.id));
    reload();
    void syncEquipmentChoices(project?.id).then(reload);
    globalThis.addEventListener?.(EQUIPMENT_CHOICES_EVENT, reload);
    return () => globalThis.removeEventListener?.(EQUIPMENT_CHOICES_EVENT, reload);
  }, [project?.id]);
  const setFanCoilMounting = (roomIds: string[], mounting: FanCoilMounting | null) => {
    let next = loadEquipmentChoices(project?.id);
    for (const id of roomIds) next = withChoice(next, fanCoilMountingKey(id), mounting);
    setEqChoices(next);
    void saveEquipmentChoices(project?.id, next);
  };

  const rooms = project?.rooms || [];
  const locked = project?.status !== 'draft';
  const requested = project?.systemsConfiguration?.requestedServices || [];
  const serviceChoice = choiceFromServices(requested);
  const assignments = project?.systemsConfiguration?.roomAssignments || [];
  const selectedFamilies = project?.systemsConfiguration?.selectedSystemFamilies || [];
  const architecture = project?.systemsConfiguration?.architecture || null;
  const archSummary = architecture ? architectureSummary(architecture, rooms, assignments, systemsCatalog) : null;
  const hydronic = project?.systemsConfiguration?.hydronicRequirements || null;
  const validation = project?.systemsConfiguration?.validation || null;
  const blockers = validation?.blockers || [];
  const isCommercialObject = project?.objectType === 'commercial';
  const isHouseObject = project?.objectType === 'private_house';
  const isApartmentObject = project?.objectType === 'apartment';
  const simultaneousRequired = project?.systemsConfiguration?.simultaneousHeatCoolRequired ?? false;
  const simultaneousSupported = architecture?.simultaneousHeatCoolSupported ?? false;
  const topology = project?.topology || null;
  const floors = topology?.floors || [];
  const selectedFloor = floors.find((f) => f.id === selectedFloorId) || floors[0] || null;
  const sumArea = rooms.reduce((s, r) => s + Number(r.areaM2 || 0), 0);
  const totalArea = project?.totalAreaM2 ?? null;
  const missingAreas = rooms.filter((r) => r.areaM2 == null || Number(r.areaM2) <= 0).length;
  const floorRooms = selectedFloor ? rooms.filter((r) => r.floorId === selectedFloor.id) : rooms;
  const floorMissingAreas = floorRooms.filter((r) => r.areaM2 == null || Number(r.areaM2) <= 0).length;

  const groupedTypes = useMemo(() => {
    const order = ['living', 'common', 'wet', 'extra', 'commercial'];
    return order.map((group) => ({
      group,
      label: GROUP_LABEL[group],
      items: (catalog?.roomTypes || []).filter((t) => t.group === group),
    })).filter((g) => g.items.length);
  }, [catalog]);

  const sourceRoom = rooms.find((r) => r.id === (bulkSourceId || openRoomId || rooms[0]?.id)) || rooms[0] || null;
  const sourceAssignment = sourceRoom ? assignments.find((a) => a.roomId === sourceRoom.id) : null;

  // Phase 3.2L — the single room currently in focused-editor mode (max one).
  const focusedRoom = rooms.find((r) => r.id === engRoomId) ?? null;
  // Only real engineering sections should auto-open the engineering accordion;
  // 'area' targets the "Основное" block of the focused editor instead.
  const engFocusKey = focusSectionKey && ['envelope', 'windows', 'air', 'internal'].includes(focusSectionKey) ? focusSectionKey : null;
  const focusedReadiness = project && focusedRoom
    ? buildSteadyStateReadiness(project, focusedRoom, { requestedServices: requested })
    : null;
  const requiredMissingCount = focusedReadiness ? roomEditorMissingCount(focusedReadiness) : 0;

  useEffect(() => {
    if (requiredMissingCount === 0) setRoomDoneMessage(null);
  }, [requiredMissingCount]);

  const addRoomOfType = async (roomType: string) => {
    const scrollOwner = getWizardScrollContainer();
    const scrollTop = scrollOwner?.scrollTop ?? null;
    const count = (isHouseObject && floors.length ? floorRooms : rooms).filter((r) => r.roomType === roomType).length;
    await setRoomTypeCount(roomType, count + 1, isHouseObject && floors.length ? selectedFloor?.id || null : null);

    // The picker stays mounted while the list grows. Restore the single
    // scroll-owner position after React commits the new room, so focus/layout
    // compensation cannot move the user away from the picker.
    if (scrollOwner && scrollTop !== null) {
      requestAnimationFrame(() => { scrollOwner.scrollTop = scrollTop; });
    }
  };

  // Stable id-derived key for the suggestion preview: the effect body reads
  // suggestionSourceFamilyIds(selectedFamilies), so the deps MUST include it.
  // Using the raw array ref would re-fetch on every render when empty (`|| []`
  // allocates a fresh ref); an id-derived string only changes when the actual
  // source set changes, keeping Preview and Apply on the same source inputs.
  const selectedFamilyKey = suggestionSourceFamilyIds(selectedFamilies).join(',');

  useEffect(() => {
    if (!project || step !== 'systems' || !requested.length || project.status === 'draft') {
      setSuggestion(null);
      return;
    }
    let cancelled = false;
    void suggestSystemsConfiguration(project.id, { requestedServices: requested, selectedFamilyIds: suggestionSourceFamilyIds(selectedFamilies), apply: false })
      .then((res) => { if (!cancelled) setSuggestion((res as any).suggestion || null); })
      .catch(() => { if (!cancelled) setSuggestion(null); });
    return () => { cancelled = true; };
  }, [project?.id, step, requested.join(','), project?.status, rooms.length, selectedFamilyKey]);

  // Phase 3: refresh the load state whenever the Loads stage is opened (after
  // systems confirmation) or when the project changed underneath us.
  useEffect(() => {
    if (!project || step !== 'loads') return;
    void fetchLoadState();
  }, [project?.id, project?.buildingRevision, project?.systemsRevision, step, fetchLoadState]);

  const persistSystems = async (patch: Record<string, unknown>) => {
    await saveSystemsConfiguration(patch);
  };

  // Phase 3.2L — focused engineering edit. From the Rooms list this opens ONE
  // room's editor; from the Professional missing summary it also records a
  // return target so "Готово" lands back on Loads with Professional preserved.
  const openRoomEditor = (roomId: string) => {
    setEngRoomId(roomId);
    setFocusSectionKey(null);
    setMissingEdit(null);
    setRoomDoneMessage(null);
    scrollWizardToTop();
  };

  const closeRoomEditor = () => {
    setEngRoomId(null);
    setFocusSectionKey(null);
    setMissingEdit(null);
    setRoomDoneMessage(null);
  };

  // Deep-link from the actionable missing-input summary (Loads step) to the
  // focused room editor, NOT the long Rooms page. Engineering inputs are only
  // editable in draft, so a confirmed object is reopened first (same action as
  // the Review "Изменить объект" button — the systems config is preserved).
  const openMissingInput = async (roomId: string, sectionKey: string) => {
    if (sectionKey === 'climate') {
      setStep('object');
      return;
    }
    if (locked) await reopenObject();
    else setStep('rooms');
    setEngRoomId(roomId);
    setMissingEdit(missingEditTarget(roomId, sectionKey));
    setFocusSectionKey(sectionKey);
    setRoomDoneMessage(null);
    scrollWizardToTop();
  };

  // Return to the calculation after a focused missing-edit: re-confirm object +
  // systems (required to reopen Loads from a reopened draft) and restore the
  // previously-selected Professional mode.
  const returnToLoadsAfterEdit = async () => {
    const target = resolveReturnTarget(missingEdit, loadMode);
    closeRoomEditor();
    if (!target) return;
    setLoadMode(target.loadMode);
    try {
      if (project && project.status === 'draft') {
        await confirmObject();
        await confirmSystemsConfiguration();
      }
    } catch {
      // best-effort — the loads nav gate surfaces anything still required
    }
    setStep(target.step);
  };

  const doneRoomEditor = async () => {
    if (requiredMissingCount > 0) {
      setRoomDoneMessage(`Заполните ещё ${requiredMissingCount} обязательных параметров`);
      return;
    }
    if (requiredMissingCount === 0) {
      setRoomDoneMessage(null);
      if (missingEdit) await returnToLoadsAfterEdit();
      else closeRoomEditor();
    }
  };

  /**
   * Apartment default: a requested service with no source decided yet gets «Собственный источник»
   * (the same default family the card applies). «Не требуется» removes the service from the project,
   * so a requested service without any source is by definition undecided, never an explicit «none».
   * Explicit choices (central / own) are never touched.
   */
  const applyDefaultApartmentSources = async (services: Array<'heating' | 'cooling'>) => {
    const fresh = useBuildingProjectStore.getState().project;
    if (!fresh || fresh.objectType !== 'apartment') return;
    const families = fresh.systemsConfiguration?.selectedSystemFamilies || [];
    const undecided = services.filter((svc) => apartmentSourceMode(families, svc) === 'none');
    if (!undecided.length) return;
    let nextFamilies = families;
    for (const svc of undecided) nextFamilies = setApartmentSourceMode(nextFamilies, svc, 'own', services, systemsCatalog);
    if (nextFamilies === families || nextFamilies.length === families.length) return;
    await persistSystems({ selectedSystemFamilies: nextFamilies });
  };

  // Drafts that already request a service but have no source yet (created before this default existed,
  // or after switching the service) open with «Собственный источник» preselected. Once per project+services.
  const defaultSourcesKey = useRef('');
  useEffect(() => {
    if (!project || step !== 'systems' || !isApartmentObject || !systemsCatalog || !requested.length) return;
    if (project.systemsConfiguration?.configurationStatus === 'confirmed') return;
    if (!requested.some((svc) => apartmentSourceMode(selectedFamilies, svc) === 'none')) return;
    const key = `${project.id}:${requested.join(',')}`;
    if (defaultSourcesKey.current === key) return;
    defaultSourcesKey.current = key;
    void applyDefaultApartmentSources(requested);
  }, [project?.id, step, isApartmentObject, systemsCatalog, requested.join(','), selectedFamilyKey]);

  const setService = async (choice: ServiceChoice) => {
    const next: Array<'heating' | 'cooling'> = choice === 'heating_and_cooling' ? ['heating', 'cooling'] : [choice];
    setManualMode(false);
    await persistSystems({ requestedServices: next });
    await applyDefaultApartmentSources(next);
    // Fast path: if NO room has any system chosen yet, apply the same
    // recommended scheme the «Применить рекомендуемую схему» button applies.
    // Existing selections are never overwritten; apartments keep the explicit
    // central/own source choice, so they are excluded.
    const fresh = useBuildingProjectStore.getState().project;
    const freshConfig = fresh?.systemsConfiguration;
    const freshFamilies = freshConfig?.selectedSystemFamilies || [];
    const nothingChosen = !(freshConfig?.roomAssignments || []).some((a) => a.heatingSystems.length || a.coolingSystems.length || a.sourceSystemIds.heating || a.sourceSystemIds.cooling);
    if (fresh && fresh.objectType !== 'apartment' && nothingChosen && !freshFamilies.some((f) => f.external)) {
      await applySuggestedSystems(next, suggestionSourceFamilyIds(freshFamilies));
      if (!useBuildingProjectStore.getState().error) setBulkMessage('Рекомендуемая схема подставлена автоматически — её можно изменить ниже.');
    }
  };

  const setApartmentMode = async (service: 'heating' | 'cooling', mode: 'external' | 'own' | 'none') => {
    if (!project) return;
    setManualMode(true);
    const nextFamilies = setApartmentSourceMode(selectedFamilies, service, mode, requested, systemsCatalog);
    const nextServices = mode === 'none'
      ? requested.filter((s) => s !== service)
      : (requested.includes(service) ? requested : [...requested, service]);
    // External/central supply owns the service at the building level: clear stale
    // room-level source ids (and, for 'none', the room systems) so an old own
    // source never leaks into the Review. Apartment-side terminals stay intact.
    const nextAssignments = (mode === 'external' || mode === 'none')
      ? assignments.map((a) => ({
          ...a,
          sourceSystemIds: { ...a.sourceSystemIds, [service]: null },
          ...(mode === 'none' ? (service === 'heating' ? { heatingSystems: [] } : { coolingSystems: [] }) : {}),
        }))
      : assignments;
    await persistSystems({ requestedServices: nextServices, selectedSystemFamilies: nextFamilies, roomAssignments: nextAssignments });
  };

  const setBothCentral = async () => {
    if (!project) return;
    setManualMode(true);
    let nextFamilies = setApartmentSourceMode(selectedFamilies, 'heating', 'external', ['heating', 'cooling'], systemsCatalog);
    nextFamilies = setApartmentSourceMode(nextFamilies, 'cooling', 'external', ['heating', 'cooling'], systemsCatalog);
    // Both services moved to building-level external supply: stale room-level
    // own-source ids must be cleared exactly like setApartmentMode('external')
    // does per service — otherwise the server flags room_source_conflicts_project
    // / conflicting_central_sources and Review shows removed sources.
    const nextAssignments = assignments.map((a) => ({ ...a, sourceSystemIds: { heating: null, cooling: null } }));
    await persistSystems({ requestedServices: ['heating', 'cooling'], selectedSystemFamilies: nextFamilies, roomAssignments: nextAssignments });
  };

  const applySuggestion = async () => {
    if (!requested.length) return;
    await applySuggestedSystems(requested, suggestionSourceFamilyIds(selectedFamilies));
    setManualMode(false);
    setBulkMessage('Рекомендуемая схема применена');
  };

  // ---- Fast entry: new project form + inline room areas ----
  const changeCreateObjectType = (objectType: ObjectType) => {
    setCreateForm((f) => ({ ...f, objectType }));
    setCreateRooms(standardRoomSet(objectType));
  };

  const setCreateRoomCount = (roomType: string, count: number) => {
    const n = Math.max(0, Math.min(30, count));
    setCreateRooms((rows) => rows.some((r) => r.roomType === roomType)
      ? rows.map((r) => (r.roomType === roomType ? { ...r, count: n } : r))
      : [...rows, { roomType, count: n }]);
  };

  const submitCreate = async () => {
    const area = parseQuickNumber(createForm.totalAreaM2);
    if (area.status === 'invalid') { setCreateError(`Площадь объекта: ${area.message.toLowerCase()}`); return; }
    const height = parseQuickNumber(createForm.defaultCeilingHeightM);
    if (height.status !== 'ok' || height.value < 1.8 || height.value > 8) { setCreateError('Высота потолков: укажите значение от 1,8 до 8 м'); return; }
    const floorCount = Number(createForm.floorCount);
    if (createForm.objectType === 'private_house' && (!Number.isInteger(floorCount) || floorCount < 1)) { setCreateError('Этажей: укажите целое число от 1'); return; }
    setCreateError(null);
    await createProject({
      name: createForm.name || undefined,
      objectType: createForm.objectType,
      regionCode: createForm.regionCode || null,
      totalAreaM2: area.status === 'ok' ? area.value : null,
      defaultCeilingHeightM: height.value,
      insulationLevel: createForm.insulationLevel,
      floorCount: createForm.objectType === 'private_house' ? floorCount : undefined,
      basementType: createForm.objectType === 'private_house' ? createForm.basementType : undefined,
      topBoundaryType: createForm.objectType === 'private_house' ? createForm.topBoundaryType : undefined,
      plantLocation: createForm.objectType === 'private_house' ? { kind: 'not_defined' } : undefined,
      rooms: expandRoomRows(createRooms),
    });
    // Land the cursor in the first empty area field: the user can type at once.
    window.setTimeout(() => {
      const first = document.querySelector<HTMLInputElement>(`[${QUICK_ENTRY_ATTR}]`);
      first?.focus();
    }, 80);
  };

  const removeRoomRow = async (room: BuildingRoom) => {
    if (!window.confirm(`Удалить помещение «${room.name}»?`)) return;
    await removeRoom(room.id);
  };

  const setSimultaneousRequirement = async (enabled: boolean) => {
    const patch: Record<string, unknown> = {
      requestedServices: requested,
      simultaneousHeatCoolRequired: enabled,
    };
    if (enabled) {
      // For a reversible hydronic source, switch to a simultaneous-capable 4-pipe circuit.
      // Independent (hybrid) architectures already support simultaneous operation.
      if (architecture?.spaceCombinedSourceId) {
        patch.architecture = { distribution: DISTRIBUTION_PRESETS.hydronic_4pipe_heating_cooling };
      }
    } else if (architecture?.distribution?.id === 'hydronic_4pipe_heating_cooling') {
      // Revert the explicit 4-pipe override back to the seasonal 2-pipe circuit.
      patch.architecture = { distribution: DISTRIBUTION_PRESETS.hydronic_2pipe_heating_cooling };
    }
    await persistSystems(patch);
  };

  const toggleRoomFamily = async (roomId: string, service: 'heating' | 'cooling', family: EngineeringSystemFamily, role: 'source' | 'terminal') => {
    if (!project) return;
    const nextAssignments = rooms.map((room) => {
      const current = assignments.find((item) => item.roomId === room.id) || emptyAssignment(room, requested);
      if (room.id !== roomId) return current;
      const next = clone(current);
      if (next.servicePreferences[service] === 'not_required') {
        next.servicePreferences[service] = 'optional';
        next.servicePreferenceSource = { ...(next.servicePreferenceSource || { heating: 'default', cooling: 'default' }), [service]: 'user' };
      }
      if (role === 'source') {
        next.sourceSystemIds[service] = next.sourceSystemIds[service] === family.id ? null : family.id;
      } else {
        const list = service === 'heating' ? next.heatingSystems : next.coolingSystems;
        const exists = list.some((item) => item.familyId === family.id);
        const selection: EngineeringRoomSystemSelection = {
          familyId: family.id, label: family.label, service: family.service, kind: family.kind, scope: family.scope,
          capabilityStatus: family.capabilityStatus, sourceSystemId: family.kind === 'source' || family.kind === 'combined' ? family.id : null,
          selectedAt: new Date().toISOString(), userPreference: null, reasons: [],
        };
        if (service === 'heating') next.heatingSystems = exists ? list.filter((item) => item.familyId !== family.id) : [...list, selection];
        else next.coolingSystems = exists ? list.filter((item) => item.familyId !== family.id) : [...list, selection];
      }
      return next;
    });
    const families = selectedFamilies.filter((item) => item.kind === 'source' || item.scope !== 'room_local' || item.kind === 'combined');
    await persistSystems({ requestedServices: requested, selectedSystemFamilies: families, roomAssignments: nextAssignments });
  };

  const setNotRequired = async (roomId: string, service: 'heating' | 'cooling') => {
    const nextAssignments = rooms.map((room) => {
      const current = assignments.find((item) => item.roomId === room.id) || emptyAssignment(room, requested);
      if (room.id !== roomId) return current;
      const next = clone(current);
      next.servicePreferences[service] = 'not_required';
      next.servicePreferenceSource = { ...(next.servicePreferenceSource || { heating: 'default', cooling: 'default' }), [service]: 'user' };
      if (service === 'heating') { next.heatingSystems = []; next.sourceSystemIds.heating = null; }
      else { next.coolingSystems = []; next.sourceSystemIds.cooling = null; }
      return next;
    });
    await persistSystems({ requestedServices: requested, roomAssignments: nextAssignments, selectedSystemFamilies: selectedFamilies });
  };

  const applyBulk = async (target: BulkTarget) => {
    if (!sourceRoom) return;
    if (!sourceAssignment || (!sourceAssignment.heatingSystems.length && !sourceAssignment.coolingSystems.length && !sourceAssignment.sourceSystemIds.heating && !sourceAssignment.sourceSystemIds.cooling)) {
      setBulkMessage('Сначала настройте исходную комнату — копировать нечего');
      return;
    }
    const targets = rooms.filter((room) => room.id !== sourceRoom.id && matchBulkTarget(room, target));
    if (!targets.length) {
      setBulkMessage('Нет подходящих комнат для этого назначения');
      return;
    }
    const previous = clone(assignments);
    await persistSystems({
      requestedServices: requested,
      selectedSystemFamilies: selectedFamilies,
      roomAssignments: assignments,
      bulk: { sourceRoomId: sourceRoom.id, target },
    });
    const newRev = useBuildingProjectStore.getState().project?.systemsRevision ?? -1;
    setUndoState({ assignments: previous, validRevision: newRev });
    const copied = [
      ...sourceAssignment.heatingSystems.map((item) => item.label),
      ...sourceAssignment.coolingSystems.map((item) => item.label),
    ].join(' + ') || 'выбранную схему';
    // the fan-coil installation type travels with the copied scheme
    const sourceMounting = fanCoilMountingOf(eqChoices, sourceRoom.id);
    if (sourceMounting && roomUsesFanCoils(sourceAssignment)) setFanCoilMounting(targets.map((room) => room.id), sourceMounting);
    setBulkMessage(`Применено к ${targets.length} пом.: ${copied}${sourceMounting && roomUsesFanCoils(sourceAssignment) ? ' (с типом установки фанкойла)' : ''}`);
  };

  const undoBulk = async () => {
    if (!undoState || !project) return;
    if (project.systemsRevision !== undoState.validRevision) {
      setUndoState(null);
      setBulkMessage('Отмена недоступна: схема уже изменена');
      return;
    }
    await persistSystems({ requestedServices: requested, selectedSystemFamilies: selectedFamilies, roomAssignments: undoState.assignments });
    setUndoState(null);
    setBulkMessage('Отменено');
  };

  const setProjectLevelSource = async (service: 'heating' | 'cooling', familyId: string) => {
    const nextFamilies = setProjectSource(selectedFamilies, service, familyId, systemsCatalog);
    const nextAssignments = assignments.map((a) => ({
      ...a,
      sourceSystemIds: {
        ...a.sourceSystemIds,
        [service]: a.sourceSystemIds[service] && a.sourceSystemIds[service] !== familyId ? null : a.sourceSystemIds[service],
      },
    }));
    await persistSystems({ requestedServices: requested, selectedSystemFamilies: nextFamilies, roomAssignments: nextAssignments });
  };

  const updateTowelOverride = (roomId: string, patch: TowelWarmerOverride) => {
    setTowelOverrides((current) => {
      const next = { ...current, [roomId]: { ...current[roomId], ...patch } };
      saveTowelWarmerOverrides(project?.id, next);
      return next;
    });
  };

  const setTowelPreference = async (roomId: string, preference: ServicePreference) => {
    const nextAssignments = rooms.map((room) => {
      const current = assignments.find((item) => item.roomId === room.id) || emptyAssignment(room, requested);
      if (room.id !== roomId) return current;
      return { ...clone(current), towelRadiatorPreference: preference, towelRadiatorPreferenceSource: 'user' as const };
    });
    await persistSystems({ requestedServices: requested, roomAssignments: nextAssignments, selectedSystemFamilies: selectedFamilies });
  };

  if (!hydrated) return <div className="bp-wrap">Загрузка…</div>;
  if (loadFailed && !project) {
    return (
      <div className="bp-wrap">
        <div className="bp-card" role="alert" style={{ border: '1px solid #f59f00', borderRadius: 12, padding: 12, display: 'grid', gap: 10 }}>
          <strong>Не удалось открыть ваш проект</strong>
          <div style={{ opacity: .8 }}>Похоже, пропала связь с сервером. Данные проекта сохранены — попробуйте ещё раз.</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={{ minHeight: 44, borderRadius: 10, padding: '6px 16px', border: '1px solid #12b886', background: 'rgba(18,184,134,.14)', color: 'inherit', fontWeight: 700, cursor: 'pointer' }} onClick={() => void hydrateFromStorage()}>Повторить</button>
            <button type="button" style={{ minHeight: 44, borderRadius: 10, padding: '6px 16px', border: '1px solid #495057', background: 'transparent', color: 'inherit', cursor: 'pointer' }} onClick={() => startNewProject()}>Начать новый проект</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bp-wrap${focusedRoom ? ' bp-focused-room' : ''}`} lang="ru">
      <style>{CONFIGURATOR_CSS}</style>
      <style>{EQUIPMENT_UI_CSS}</style>
      <style>{`
        .eq-inline-icon { display: inline-flex; vertical-align: -4px; margin-right: 4px; }
        .bp-svc { display: inline-flex; vertical-align: -3px; margin-right: 4px; }
        .bp-svc[data-service='heating'] { color: rgb(var(--bp-heat)); }
        .bp-svc[data-service='cooling'] { color: rgb(var(--bp-cool)); }
        .bp-room-glyph { display: inline-flex; vertical-align: -4px; margin-right: 6px; color: rgb(var(--bp-text-soft)); }
        .bp-wrap { width: 100%; max-width: 100%; min-width: 0; margin: 0; padding: 0 0 calc(80px + env(safe-area-inset-bottom, 0px)); display: grid; gap: var(--bp-s3); grid-template-columns: minmax(0, 1fr); }
        .bp-wrap > *, .bp-grid > * { min-width: 0; }
        .bp-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--bp-s3); }
        .bp-card { width: 100%; max-width: 100%; min-width: 0; overflow-wrap: break-word; }
        .bp-nav { display: flex; max-width: 100%; min-width: 0; gap: var(--bp-s2); flex-wrap: wrap; }
        .bp-floor-nav { display: flex; width: 100%; max-width: 100%; min-width: 0; gap: var(--bp-s2); overflow-x: auto; flex-wrap: nowrap; padding: 2px 2px 6px; -webkit-overflow-scrolling: touch; scrollbar-width: thin; overscroll-behavior-inline: contain; }
        .bp-floor-nav .bp-chip { flex: 0 0 auto; max-width: none; font-weight: 600; white-space: nowrap; }
        .bp-chip, .bp-btn { max-width: 100%; min-width: var(--bp-tap); min-height: var(--bp-tap); border-radius: var(--bp-r-sm); border: 1px solid rgb(var(--bp-line-strong)); background: transparent; color: rgb(var(--bp-text)); padding: 8px 14px; cursor: pointer; font: inherit; font-size: var(--bp-fs-sm); font-weight: 600; white-space: normal; overflow-wrap: break-word; touch-action: manipulation; }
        .bp-chip.on { border-color: rgb(var(--bp-accent)); box-shadow: inset 0 0 0 1px rgb(var(--bp-accent)); background: rgb(var(--bp-accent) / .1); font-weight: 700; }
        .bp-btn.pri { border-color: rgb(var(--bp-accent)); background: rgb(var(--bp-accent)); color: rgb(var(--bp-on-accent)); font-weight: 750; font-size: var(--bp-fs-body); }
        .bp-chip:disabled, .bp-btn:disabled { opacity: .5; cursor: not-allowed; }
        .bp-btn.pri:disabled { background: rgb(var(--bp-line-strong)); border-color: rgb(var(--bp-line-strong)); color: rgb(var(--bp-text)); opacity: .7; }
        .bp-chip:focus-visible, .bp-btn:focus-visible, .bp-input:focus-visible, .bp-tile:focus-visible, .bp-stepper button:focus-visible, .bp-wrap summary:focus-visible { outline: none; box-shadow: var(--bp-focus); }
        .bp-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 156px), 1fr)); gap: var(--bp-s2); }
        .bp-tile { display: flex; align-items: center; gap: var(--bp-s2); min-height: 52px; border: 1px solid rgb(var(--bp-line)); border-radius: var(--bp-r-md); padding: 8px 12px; background: rgb(var(--bp-surface-1)); color: rgb(var(--bp-text)); font: inherit; font-size: var(--bp-fs-sm); font-weight: 600; text-align: left; cursor: pointer; }
        .bp-tile .eq-glyph { color: rgb(var(--bp-text-soft)); }
        .bp-tile.active { border-color: rgb(var(--bp-accent)); }
        .bp-count { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
        .bp-count button { width: var(--bp-tap); height: var(--bp-tap); border-radius: var(--bp-r-sm); border: 1px solid rgb(var(--bp-line-strong)); background: transparent; color: inherit; font-size: 18px; }
        .bp-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) 88px 44px; gap: 8px; align-items: center; }
        .bp-card { border: 1px solid rgb(var(--bp-line)); border-radius: var(--bp-r-lg); padding: var(--bp-s4); display: grid; gap: var(--bp-s3); background: rgb(var(--bp-surface-1) / .55); }
        .bp-card > strong:first-child { font-size: var(--bp-fs-h); line-height: 1.3; }
        .bp-muted { color: rgb(var(--bp-text-muted)); font-size: var(--bp-fs-sm); }
        .bp-input { width: 100%; max-width: 100%; min-width: 0; min-height: 48px; border-radius: var(--bp-r-sm); border: 1px solid rgb(var(--bp-line-strong)); background: rgb(var(--bp-surface-0)); color: rgb(var(--bp-text)); padding: 8px 12px; }
        .bp-alert { color: rgb(var(--bp-warn)); font-size: var(--bp-fs-sm); }
        .bp-ok { color: rgb(var(--bp-ok)); font-size: var(--bp-fs-sm); }
        .bp-sum { display: flex; max-width: 100%; min-width: 0; flex-wrap: wrap; gap: 6px 14px; font-size: var(--bp-fs-sm); }
        .bp-projbar { position: sticky; top: 0; z-index: 30; display: flex; width: 100%; max-width: 100%; min-width: 0; align-items: center; gap: var(--bp-s2); flex-wrap: wrap; padding: 6px 2px; background: rgb(var(--bg)); border-bottom: 1px solid rgb(var(--bp-line)); }
        .bp-projbar .cfg-linkbtn { flex: 0 0 auto; margin-left: auto; }
        .bp-steps { display: block; width: 100%; max-width: 100%; min-width: 0; overflow-x: auto; overscroll-behavior-inline: contain; scrollbar-width: none; padding: 4px 0; }
        .bp-steps::-webkit-scrollbar { display: none; }
        .bp-editor-head { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
        .bp-editor-title { display: flex; flex: 1 1 240px; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
        .bp-room-list-row { min-width: 0; }
        .bp-accordion-trigger { width: 100%; max-width: 100%; min-width: 0; }
        .bp-accordion-summary { flex: 1 1 auto; min-width: 0; }
        .bp-chips { display: flex; max-width: 100%; min-width: 0; flex-wrap: wrap; gap: var(--bp-s2); }
        .bp-chips .bp-chip { flex: 0 1 auto; }
        .bp-focused-room { min-height: calc(100dvh - 12px); padding: 8px 0 calc(80px + env(safe-area-inset-bottom, 0px)); align-content: start; }
        .bp-h { font-weight: 750; font-size: var(--bp-fs-h); line-height: 1.3; }
        .bp-kv { display: grid; grid-template-columns: minmax(8em, 1fr) minmax(0, auto); gap: 8px 14px; margin: 0; font-size: 15px; align-items: baseline; }
        .bp-kv dt { margin: 0; min-width: 0; overflow-wrap: break-word; hyphens: auto; }
        .bp-kv dd { margin: 0; font-weight: 750; text-align: right; white-space: nowrap; }
        .bp-kv .bp-kv-sub { font-size: var(--bp-fs-sm); font-weight: 400; color: rgb(var(--bp-text-muted)); padding-left: 22px; }
        .bp-room-result { border-top: 1px solid rgb(var(--bp-line)); padding-top: 4px; min-width: 0; }
        .bp-room-result > summary { cursor: pointer; min-height: var(--bp-tap); display: flex; align-items: center; gap: 4px; padding: 6px 0; line-height: 1.4; overflow-wrap: anywhere; list-style: none; }
        .bp-room-result > summary::-webkit-details-marker { display: none; }
        .bp-room-result > summary::after { content: ''; flex: 0 0 auto; margin-left: auto; width: 8px; height: 8px; border-right: 2px solid rgb(var(--bp-text-muted)); border-bottom: 2px solid rgb(var(--bp-text-muted)); transform: rotate(45deg); }
        .bp-room-result[open] > summary::after { transform: rotate(-135deg); }
        .bp-explain { display: grid; gap: 6px; font-size: var(--bp-fs-sm); line-height: 1.5; min-width: 0; overflow-wrap: anywhere; }
        .bp-explain ol, .bp-explain ul { margin: 0; padding-left: 20px; display: grid; gap: 4px; }
        .bp-kv dd.bp-kv-wrap { white-space: normal; overflow-wrap: anywhere; font-weight: 700; }
        .bp-spec { gap: var(--bp-s3); }
        .bp-bom-group { display: grid; gap: var(--bp-s2); min-width: 0; }
        .bp-bom-line { display: grid; gap: 4px; border-top: 1px solid rgb(var(--bp-line)); padding-top: var(--bp-s2); min-width: 0; overflow-wrap: anywhere; font-size: var(--bp-fs-sm); }
        .bp-bom-name { font-weight: 700; font-size: 15px; }
        .bp-bom-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; min-width: 0; }
        .bp-bom-chip { display: inline-block; margin-left: 6px; padding: 1px 8px; border-radius: 999px; border: 1px solid rgb(var(--bp-line-strong)); font-size: var(--bp-fs-xs); font-weight: 600; }
        .bp-bom-chip.warn { border-color: rgb(var(--bp-warn) / .6); color: rgb(var(--bp-warn)); }
        .bp-bom-chip.ok { border-color: rgb(var(--bp-ok) / .6); color: rgb(var(--bp-ok)); }
        .bp-bom-check { color: rgb(var(--bp-warn)); font-size: var(--bp-fs-xs); }
        .bp-spec { container-type: inline-size; }
        .bp-bom-head { display: flex; align-items: center; gap: 10px; margin-top: var(--bp-s2); }
        .bp-bom-head-icon { display: inline-grid; place-items: center; width: 40px; height: 40px; flex: 0 0 auto; border-radius: var(--bp-r-md); background: rgb(var(--bp-text-muted) / .1); color: rgb(var(--bp-text-soft)); }
        .bp-bom-head-icon.is-missing { color: rgb(var(--bp-warn)); background: rgb(var(--bp-warn) / .1); }
        .bp-bom-line .bp-bom-meta strong { color: rgb(var(--bp-text)); }
        .bp-bom-missing { border-left: 3px solid rgb(var(--bp-warn) / .7); padding-left: var(--bp-s3); }
        .bp-bom-choice { border-left: 3px solid rgb(var(--bp-info) / .7); padding-left: var(--bp-s3); }
        @container (min-width: 640px) {
          .bp-bom-line { grid-template-columns: minmax(0, 1fr) minmax(170px, auto); column-gap: var(--bp-s5); }
          .bp-bom-line > * { grid-column: 1; }
          .bp-bom-line > .bp-bom-meta { grid-column: 2; grid-row: 1 / span 3; flex-direction: column; align-items: flex-end; text-align: right; gap: 2px; }
        }
        .bp-bom-total { border-top: 2px solid rgb(var(--bp-line-strong)); padding-top: var(--bp-s2); display: grid; gap: 4px; }
        .bp-hero { display: grid; gap: var(--bp-s3); min-width: 0; }
        .bp-hero-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: var(--bp-s2); }
        .bp-stat { display: grid; align-content: start; gap: 2px; min-width: 0; padding: var(--bp-s3) var(--bp-s4); border: 1px solid rgb(var(--bp-line)); border-radius: var(--bp-r-md); background: rgb(var(--bp-surface-2) / .55); }
        .bp-stat[data-service='heating'] { border-top: 3px solid rgb(var(--bp-heat) / .8); }
        .bp-stat[data-service='cooling'] { border-top: 3px solid rgb(var(--bp-cool) / .8); }
        .bp-stat-label { display: flex; align-items: center; gap: 6px; font-size: var(--bp-fs-xs); color: rgb(var(--bp-text-muted)); font-weight: 600; }
        .bp-stat-value { font-size: 28px; line-height: 1.15; font-weight: 700; color: rgb(var(--bp-text)); overflow-wrap: anywhere; }
        .bp-stat-unit { font-size: var(--bp-fs-body); font-weight: 600; color: rgb(var(--bp-text-soft)); }
        .bp-stat-sub { font-size: var(--bp-fs-xs); color: rgb(var(--bp-text-soft)); overflow-wrap: anywhere; }
        .bp-hero-scheme { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; font-size: var(--bp-fs-sm); }
        .bp-hero-chip { padding: 3px 10px; border-radius: 999px; background: rgb(var(--bp-text-muted) / .12); color: rgb(var(--bp-text)); font-weight: 600; }
        .bp-hero-status { list-style: none; margin: 0; padding: var(--bp-s2) var(--bp-s3); display: flex; flex-wrap: wrap; align-items: center; gap: 6px 18px; border-radius: var(--bp-r-md); background: rgb(var(--bp-text-muted) / .08); font-size: var(--bp-fs-sm); }
        .bp-hero-status li { display: inline-flex; align-items: center; gap: 6px; }
        .bp-hero-status li.is-warn svg { color: rgb(var(--bp-warn)); }
        .bp-hero-status li.is-ok svg { color: rgb(var(--bp-ok)); }
        .bp-choices { display: grid; gap: var(--bp-s2); padding: var(--bp-s3) var(--bp-s4); border: 1px solid rgb(var(--bp-info) / .45); border-radius: var(--bp-r-md); background: rgb(var(--bp-info) / .06); scroll-margin-top: 80px; min-width: 0; }
        .bp-choices-head { display: flex; align-items: center; gap: 8px; font-size: var(--bp-fs-h); }
        .bp-choice-list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--bp-s3); }
        .bp-choice { display: grid; gap: 6px; min-width: 0; padding-top: var(--bp-s2); border-top: 1px solid rgb(var(--bp-line)); }
        .bp-choice:first-child { border-top: 0; padding-top: 0; }
        .bp-choice-label { display: flex; align-items: flex-start; gap: 8px; font-weight: 700; font-size: 15px; overflow-wrap: anywhere; }
        .bp-choice-mark { flex: 0 0 auto; margin-top: 2px; }
        .bp-choice-mark.is-ok { color: rgb(var(--bp-ok)); }
        .bp-choice-mark.is-warn { color: rgb(var(--bp-warn)); }
        .bp-pick-trigger-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; max-width: 720px; }
        .bp-pick-current { display: grid; gap: 2px; min-width: 0; flex: 1 1 200px; overflow-wrap: anywhere; }
        .bp-pick-thumb { flex: 0 0 56px; width: 56px; height: 56px; border-radius: var(--bp-r-sm, 8px); background: #fff; padding: 3px; overflow: hidden; }
        .bp-pick-img { width: 100%; height: 100%; object-fit: contain; display: block; }
        .bp-pick-trigger { min-height: var(--bp-tap); padding: 0 16px; border-radius: var(--bp-r-md); border: 1px solid rgb(var(--bp-line)); background: transparent; color: rgb(var(--bp-text)); font-weight: 600; cursor: pointer; }
        .bp-pick-trigger.is-primary { background: rgb(var(--bp-accent)); border-color: rgb(var(--bp-accent)); color: rgb(var(--bp-on-accent)); }
        .bp-pick-backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0,0,0,.6); container-type: normal; display: flex; align-items: flex-end; justify-content: center; padding: 0; }
        .bp-pick-dialog { width: 100%; max-width: 1040px; max-height: 92vh; overflow: auto; background: rgb(var(--bp-surface-1)); color: rgb(var(--bp-text)); border: 1px solid rgb(var(--bp-line)); border-radius: 16px 16px 0 0; padding: var(--bp-s4); display: grid; gap: var(--bp-s3); align-content: start; }
        @media (min-width: 720px) { .bp-pick-backdrop { align-items: center; padding: 24px; } .bp-pick-dialog { border-radius: 16px; } }
        .bp-pick-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; position: sticky; top: calc(-1 * var(--bp-s4)); background: inherit; padding-bottom: 6px; z-index: 1; }
        .bp-pick-close { width: var(--bp-tap); height: var(--bp-tap); border-radius: 50%; border: 1px solid rgb(var(--bp-line)); background: transparent; color: inherit; font-size: 24px; line-height: 1; cursor: pointer; }
        .bp-pick-filter { display: inline-flex; align-items: center; gap: 8px; font-size: var(--bp-fs-sm); }
        .bp-pick-grid { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
        @media (max-width: 480px) { .bp-pick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; } .bp-pick-main { padding: 8px; } .bp-pick-title { font-size: 14px; } }
        .bp-pick-card { display: grid; gap: 4px; min-width: 0; }
        .bp-pick-main { position: relative; display: grid; gap: 4px; align-content: start; text-align: left; width: 100%; padding: 10px; border-radius: var(--bp-r-md); border: 1px solid rgb(var(--bp-line)); background: rgb(var(--bp-text-muted) / .06); color: inherit; cursor: pointer; }
        .bp-pick-main:hover:not(:disabled), .bp-pick-main:focus-visible { border-color: rgb(var(--bp-info)); outline: none; }
        .bp-pick-card.is-active .bp-pick-main { border-color: rgb(var(--bp-ok)); box-shadow: 0 0 0 2px rgb(var(--bp-ok) / .5); }
        .bp-pick-card.is-disabled .bp-pick-main { opacity: .55; cursor: not-allowed; }
        .bp-pick-photo { display: block; aspect-ratio: 4 / 3; background: #fff; border-radius: 8px; padding: 6px; overflow: hidden; }
        .bp-pick-title { font-weight: 700; font-size: 15px; line-height: 1.25; overflow-wrap: anywhere; }
        .bp-pick-variant { font-size: var(--bp-fs-sm); font-weight: 600; color: rgb(var(--bp-text-soft)); overflow-wrap: anywhere; }
        .bp-pick-caption { font-size: var(--bp-fs-xs); color: rgb(var(--bp-text-muted)); overflow-wrap: anywhere; }
        .bp-pick-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
        .bp-pick-chip { padding: 2px 8px; border-radius: 999px; font-size: var(--bp-fs-xs); font-weight: 600; background: rgb(var(--bp-text-muted) / .15); }
        .bp-pick-chip.ok { background: rgb(var(--bp-ok) / .18); color: rgb(var(--bp-ok)); }
        .bp-pick-chip.qty { background: rgb(var(--bp-info) / .2); }
        .bp-pick-price { font-weight: 700; font-size: var(--bp-fs-sm); }
        .bp-pick-detail { font-size: var(--bp-fs-xs); color: rgb(var(--bp-text-soft)); display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .bp-pick-flag { position: absolute; top: 14px; right: 14px; padding: 2px 8px; border-radius: 999px; background: rgb(var(--bp-ok)); color: #fff; font-size: var(--bp-fs-xs); font-weight: 700; }
        .bp-pick-link { font-size: var(--bp-fs-xs); color: rgb(var(--bp-text-soft)); text-decoration: underline; justify-self: start; padding: 0 4px; }
        .bp-pick-decisions { display: grid; gap: 8px; }
        .bp-pick-decision { text-align: left; min-height: var(--bp-tap); padding: 8px 14px; border-radius: var(--bp-r-md); border: 1px dashed rgb(var(--bp-line)); background: transparent; color: inherit; cursor: pointer; }
        .bp-pick-decision.is-active { border-style: solid; border-color: rgb(var(--bp-ok)); }
        .bp-pick-clear { justify-self: start; background: transparent; border: 0; color: rgb(var(--bp-text-soft)); text-decoration: underline; cursor: pointer; min-height: 32px; }
        .bp-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 200px), 1fr)); gap: var(--bp-s3); }
        .bp-field { display: grid; gap: 6px; font-size: var(--bp-fs-sm); font-weight: 600; min-width: 0; }
        .bp-hint { color: rgb(var(--bp-text-muted)); font-weight: 400; }
        .bp-input { font-size: 16px; }
        .bp-input[aria-invalid="true"] { border-color: rgb(var(--bp-danger)); box-shadow: 0 0 0 1px rgb(var(--bp-danger)); }
        .bp-num { min-height: 48px; font-size: 18px; font-variant-numeric: tabular-nums; padding-right: 40px; }
        .bp-unit-wrap { position: relative; display: block; min-width: 0; }
        .bp-unit { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); color: rgb(var(--bp-text-muted)); pointer-events: none; font-size: var(--bp-fs-sm); }
        .bp-chip-lg { min-height: 52px; font-size: 15px; flex: 1 1 140px; }
        .bp-btn-lg { min-height: 52px; font-size: var(--bp-fs-body); font-weight: 750; }
        .bp-more > summary { cursor: pointer; min-height: var(--bp-tap); display: flex; align-items: center; color: rgb(var(--bp-text-soft)); font-size: var(--bp-fs-sm); font-weight: 600; }
        .bp-more[open] > summary { margin-bottom: 6px; }
        .bp-stepper { display: inline-flex; align-items: center; gap: 6px; }
        .bp-stepper button { width: var(--bp-tap); height: var(--bp-tap); border-radius: var(--bp-r-sm); border: 1px solid rgb(var(--bp-line-strong)); background: transparent; color: inherit; font-size: 20px; touch-action: manipulation; }
        .bp-stepper output { min-width: 28px; text-align: center; font-weight: 750; font-size: 17px; }
        .bp-room-rows { display: grid; gap: 0; }
        .bp-room-row { display: flex; align-items: center; gap: var(--bp-s3); min-width: 0; padding: 6px 0; border-bottom: 1px solid rgb(var(--bp-line)); }
        .bp-room-row.off { opacity: .55; }
        .bp-room-row-name { flex: 1 1 auto; min-width: 0; }
        .bp-room-card { padding: var(--bp-s3) var(--bp-s4); gap: var(--bp-s2); }
        .bp-room-card.missing { border-color: rgb(var(--bp-warn) / .7); }
        .bp-room-list-row { display: flex; align-items: center; gap: 10px; }
        .bp-room-icon { display: inline-flex; flex: 0 0 auto; color: rgb(var(--bp-text-soft)); }
        .bp-room-name { flex: 1 1 auto; min-width: 0; }
        .bp-room-list-row .bp-qn { flex: 0 0 150px; }
        .bp-room-meta { display: flex; align-items: center; gap: var(--bp-s2); font-size: var(--bp-fs-xs); min-width: 0; }
        @media (min-width: 720px) {
          .bp-room-card { display: flex; align-items: center; gap: 12px; }
          .bp-room-card > .bp-room-list-row { flex: 1 1 auto; min-width: 0; }
          .bp-room-card > .bp-room-meta { flex: 0 0 auto; }
          .bp-room-card > .bp-room-meta > span:nth-child(2) { display: none; }
        }
        .bp-room-meta > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .bp-room-meta .bp-chip { flex: 0 0 auto; }
        .bp-qn { display: grid; gap: 2px; min-width: 0; }
        .bp-qn-msg { font-size: var(--bp-fs-xs); }
        .bp-progress { display: grid; gap: 6px; padding: 2px 0; }
        .bp-progress-bar { height: 8px; border-radius: 999px; background: rgb(var(--bp-line)); overflow: hidden; }
        .bp-progress-bar > span { display: block; height: 100%; background: rgb(var(--bp-accent)); transition: width .2s ease; }
        .bp-focused-room > .bp-card { border: 0; padding: 0; background: transparent; }
        @media (prefers-reduced-motion: reduce) { .bp-wrap *, .bp-wrap *::before, .bp-wrap *::after { transition: none !important; animation: none !important; } }
        @media (max-width: 640px) {
          .bp-editor-head > .bp-btn { width: 100%; }
          .bp-room-list-row { flex-wrap: wrap; }
          .bp-room-list-row > .bp-chip { margin-left: auto; }
          .bp-room-list-row { flex-wrap: nowrap; }
          .bp-room-list-row .bp-qn { flex: 0 0 128px; }
        }
      `}</style>

      {!focusedRoom && <div className="bp-steps" aria-label="Шаги">
        <StepNav
          steps={wizardSteps(project, Boolean(loadState?.loads && !loadState.isStale))}
          current={step}
          onSelect={(id) => setStep(id as CalcStep)}
        />
      </div>}

      {!focusedRoom && project && (
        <div className="bp-projbar">
          <ProjectServicesLabel services={requested} label={serviceChoice ? serviceChoiceLabel(serviceChoice) : null} />
          {project.status !== 'draft' && (
            <button type="button" className="cfg-linkbtn" onClick={() => setStep('systems')}>{CFG_TEXT.change}</button>
          )}
        </div>
      )}

      {!focusedRoom && error && <div className="bp-alert" role="alert">{error}</div>}
      {!focusedRoom && isLoading && <div className="bp-muted" role="status">Сохранение…</div>}

      {focusedRoom ? (
        project && focusedReadiness ? (
          <FocusedRoomEditor
            project={project}
            room={focusedRoom}
            readiness={focusedReadiness}
            requestedServices={requested}
            disabled={locked}
            saving={isLoading}
            catalog={catalog}
            missingEdit={missingEdit}
            focusSectionKey={focusSectionKey}
            doneMessage={roomDoneMessage}
            onPatch={(patch) => { lastRoomUpdateRef.current = updateRoom(focusedRoom.id, patch); }}
            onPropagate={(patches) => {
              // Building-wide answers reused in other rooms: after the source room is saved, one room at a time,
              // so every server response already contains the previous changes.
              const pending = lastRoomUpdateRef.current;
              lastRoomUpdateRef.current = (async () => {
                await pending.catch(() => undefined);
                for (const item of patches) await updateRoom(item.roomId, item.patch);
              })();
            }}
            onBack={closeRoomEditor}
            onDone={() => void doneRoomEditor()}
            onFocusConsumed={() => setFocusSectionKey(null)}
          />
        ) : null
      ) : null}

      {!focusedRoom && step === 'object' && (
        <section className="bp-grid">
          {project ? (
            <div className="bp-card">
              <strong>{project.name}</strong>
              <div className="bp-muted">{project.status === 'systems_configured' ? 'системы подтверждены' : project.status === 'object_confirmed' ? 'объект подтверждён' : 'черновик'}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="bp-btn pri" onClick={() => setStep(project.status === 'draft' ? 'rooms' : 'systems')}>Продолжить</button>
                <button type="button" className="bp-btn" onClick={() => startNewProject()}>Новый</button>
              </div>
              {!locked && (
                <div className="bp-tiles">
                  <label className="bp-muted">Тип
                    <select className="bp-input" value={project.objectType} onChange={(e) => updateMeta({ objectType: e.target.value })}>
                      {(catalog?.objectTypes || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                  <label className="bp-muted">Регион
                    <select className="bp-input" value={project.region?.code || ''} onChange={(e) => updateMeta({ regionCode: e.target.value || null })}>
                      {(catalog?.regions || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                  <label className="bp-muted">Площадь объекта, м²
                    <input className="bp-input" type="number" min={1} step={0.1} value={project.totalAreaM2 ?? ''} onChange={(e) => updateMeta({ totalAreaM2: e.target.value === '' ? null : Number(e.target.value) })} />
                  </label>
                  {isHouseObject && topology && (
                    <>
                      <label className="bp-muted">Количество этажей
                        <input className="bp-input" type="number" min={1} step={1} value={topology.floorCount} onChange={(e) => updateMeta({ floorCount: Number(e.target.value) })} />
                      </label>
                      <label className="bp-muted">Подвал
                        <select className="bp-input" value={topology.basementType} onChange={(e) => updateMeta({ basementType: e.target.value })}>
                          {(catalog?.basementTypes || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </label>
                      <label className="bp-muted">Верхняя граница
                        <select className="bp-input" value={topology.topBoundaryType} onChange={(e) => updateMeta({ topBoundaryType: e.target.value })}>
                          {(catalog?.topBoundaryTypes || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </label>
                      <label className="bp-muted">Расположение оборудования
                        <select className="bp-input" value={topology.plantLocation.kind} onChange={(e) => {
                          const kind = e.target.value as PlantLocationKind;
                          updateMeta({ plantLocation: kind === 'floor' ? { kind, floorId: floors[0]?.id || null } : kind === 'room' ? { kind, floorId: selectedFloor?.id || floors[0]?.id || null, roomId: null } : { kind, floorId: null, roomId: null } });
                        }}>
                          {(catalog?.plantLocationKinds || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </label>
                      {(topology.plantLocation.kind === 'floor' || topology.plantLocation.kind === 'room') && (
                        <label className="bp-muted">Этаж оборудования
                          <select className="bp-input" value={topology.plantLocation.floorId || ''} onChange={(e) => updateMeta({ plantLocation: { ...topology.plantLocation, floorId: e.target.value, roomId: null } })}>
                            {floors.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                          </select>
                        </label>
                      )}
                      {topology.plantLocation.kind === 'room' && (
                        <label className="bp-muted">Помещение оборудования
                          <select className="bp-input" value={topology.plantLocation.roomId || ''} onChange={(e) => updateMeta({ plantLocation: { ...topology.plantLocation, roomId: e.target.value } })}>
                            <option value="">— выберите —</option>
                            {rooms.filter((r) => r.floorId === topology.plantLocation.floorId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        </label>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="bp-card">
                <h2 className="cfg-section-title">1. Что за объект?</h2>
                <div className="cfg-seg cfg-seg-objects" role="group" aria-label="Тип объекта">
                  {(catalog?.objectTypes || []).map((t) => (
                    <button key={t.value} type="button" className="cfg-seg-btn"
                      aria-pressed={createForm.objectType === t.value} onClick={() => changeCreateObjectType(t.value as ObjectType)}>
                      <ObjectGlyph objectType={t.value} size={30} />
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
                <div className="bp-fields">
                  <label className="bp-field">Город / регион
                    <select className="bp-input" value={createForm.regionCode} onChange={(e) => setCreateForm({ ...createForm, regionCode: e.target.value })}>
                      {(catalog?.regions || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                  <label className="bp-field">Общая площадь <span className="bp-hint">необязательно</span>
                    <span className="bp-unit-wrap">
                      <input className="bp-input bp-num" type="text" inputMode="decimal" enterKeyHint="next" autoComplete="off" placeholder="например 120"
                        value={createForm.totalAreaM2} onChange={(e) => setCreateForm({ ...createForm, totalAreaM2: e.target.value })}
                        aria-invalid={parseQuickNumber(createForm.totalAreaM2).status === 'invalid' || undefined} />
                      <span className="bp-unit">м²</span>
                    </span>
                  </label>
                  <label className="bp-field">Высота потолков
                    <span className="bp-unit-wrap">
                      <input className="bp-input bp-num" type="text" inputMode="decimal" enterKeyHint="next" autoComplete="off"
                        value={createForm.defaultCeilingHeightM} onChange={(e) => setCreateForm({ ...createForm, defaultCeilingHeightM: e.target.value })} />
                      <span className="bp-unit">м</span>
                    </span>
                  </label>
                  {createForm.objectType === 'private_house' && (
                    <div className="bp-field">Этажей
                      <Stepper value={Number(createForm.floorCount) || 1} min={1} max={10} label="этажей"
                        onChange={(n) => setCreateForm({ ...createForm, floorCount: String(n) })} />
                    </div>
                  )}
                </div>
                <details className="bp-more">
                  <summary>Дополнительно: утепление{createForm.objectType === 'private_house' ? ', подвал, кровля' : ''}, название</summary>
                  <div className="bp-fields">
                    <label className="bp-field">Утепление дома
                      <select className="bp-input" value={createForm.insulationLevel} onChange={(e) => setCreateForm({ ...createForm, insulationLevel: e.target.value as InsulationLevel })}>
                        {(catalog?.insulationLevels || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </label>
                    {createForm.objectType === 'private_house' && (
                      <>
                        <label className="bp-field">Подвал
                          <select className="bp-input" value={createForm.basementType} onChange={(e) => setCreateForm({ ...createForm, basementType: e.target.value as BasementType })}>
                            {(catalog?.basementTypes || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </label>
                        <label className="bp-field">Что над верхним этажом
                          <select className="bp-input" value={createForm.topBoundaryType} onChange={(e) => setCreateForm({ ...createForm, topBoundaryType: e.target.value as TopBoundaryType })}>
                            {(catalog?.topBoundaryTypes || []).map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                        </label>
                      </>
                    )}
                    <label className="bp-field">Название проекта
                      <input className="bp-input" value={createForm.name} placeholder="создастся автоматически" onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} />
                    </label>
                  </div>
                </details>
              </div>

              <div className="bp-card">
                <h2 className="cfg-section-title">2. Какие есть помещения?</h2>
                <div className="bp-muted">Стандартный набор уже выбран — поправьте количество, если нужно. Площади введёте на следующем шаге.</div>
                <div className="bp-room-rows">
                  {createRooms.map((row) => {
                    const type = (catalog?.roomTypes || []).find((t) => t.value === row.roomType);
                    return (
                      <div key={row.roomType} className={`bp-room-row${row.count === 0 ? ' off' : ''}`}>
                        {roomIcon(row.roomType)}
                        <span className="bp-room-row-name">{type?.label || row.roomType}</span>
                        <Stepper value={row.count} min={0} max={30} label={type?.label || row.roomType} onChange={(n) => setCreateRoomCount(row.roomType, n)} />
                      </div>
                    );
                  })}
                </div>
                <label className="bp-field">Добавить другое помещение
                  <select className="bp-input" value={extraRoomType} onChange={(e) => {
                    const v = e.target.value;
                    if (v) setCreateRoomCount(v, (createRooms.find((r) => r.roomType === v)?.count || 0) + 1);
                    setExtraRoomType('');
                  }}>
                    <option value="">— выберите тип —</option>
                    {groupedTypes.map((g) => (
                      <optgroup key={g.group} label={g.label}>
                        {g.items.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </label>
                {createForm.objectType === 'private_house' && Number(createForm.floorCount) > 1 && (
                  <div className="bp-muted">Эти помещения попадут на 1-й этаж. Помещения других этажей добавите на следующем шаге.</div>
                )}
              </div>

              {createError && <div className="bp-alert" role="alert">{createError}</div>}
              <button type="button" className="bp-btn pri bp-btn-lg" disabled={isLoading} onClick={() => void submitCreate()}>
                {isLoading ? 'Создаём…' : `Создать и ввести площади (${expandRoomRows(createRooms).length} пом.)`}
              </button>
            </>
          )}
        </section>
      )}

      {!focusedRoom && project && step === 'rooms' && (
        <section className="bp-grid">
          <EntryProgress rooms={rooms} />
          <div className="bp-sum">
            <span>Комнат: <strong>{rooms.length}</strong></span>
            <AreaConsistencySummary totalArea={totalArea} sumArea={sumArea} />
          </div>
          <AreaOverWarning totalArea={totalArea} sumArea={sumArea} />

          {isHouseObject && floors.length > 1 && (
            <div className="bp-floor-nav">
              {floors.map((floor) => {
                const floorRoomsList = rooms.filter((r) => r.floorId === floor.id);
                const floorArea = floorRoomsList.reduce((s, r) => s + Number(r.areaM2 || 0), 0);
                return (
                  <button key={floor.id} type="button" className={`bp-chip${selectedFloor?.id === floor.id ? ' on' : ''}`} onClick={() => setSelectedFloorId(floor.id)}>
                    {floor.label} · {floorRoomsList.length}{floorArea > 0 ? ` · ${floorArea.toFixed(0)} м²` : ''}
                  </button>
                );
              })}
            </div>
          )}

          <>
              {/* ---- COMPACT room list (C): area is typed right here ---- */}
              {!locked && (isHouseObject && floors.length ? floorRooms : rooms).length > 0 && (
                <div className="bp-muted">Введите площадь каждого помещения и нажмите Enter — курсор перейдёт к следующему. Можно писать «3,5×4» или «12+4,5».</div>
              )}
              {(isHouseObject && floors.length ? floorRooms : rooms).map((room) => {
                const readiness = buildSteadyStateReadiness(project, room, { requestedServices: requested });
                const areaMissing = room.areaM2 == null || Number(room.areaM2) <= 0;
                return (
                  <div key={room.id} className={`bp-card bp-room-card${areaMissing ? ' missing' : ''}`} data-bp-room={room.id}>
                    <div className="bp-room-list-row">
                      <span className="bp-room-icon">{roomIcon(room.roomType)}</span>
                      <strong className="bp-room-name">{room.name}</strong>
                      <QuickNumberField
                        value={room.areaM2}
                        unit="м²"
                        label={`Площадь: ${room.name}`}
                        required
                        disabled={locked}
                        onCommit={(v) => void updateRoom(room.id, { areaM2: v })}
                      />
                    </div>
                    <div className="bp-room-meta">
                      <span className={readiness.ready ? 'bp-ok' : 'bp-muted'} title="Данные для точного (профессионального) расчёта — необязательно для быстрой оценки">
                        {readiness.ready ? '✓ Готово' : `Для точного расчёта: ${readiness.missingCount}`}
                      </span>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="bp-chip" onClick={() => openRoomEditor(room.id)}>Подробнее</button>
                      {!locked && <button type="button" className="bp-chip" aria-label={`Удалить ${room.name}`} onClick={() => void removeRoomRow(room)}>✕</button>}
                    </div>
                  </div>
                );
              })}
              {(isHouseObject && floors.length ? floorRooms : rooms).length === 0 && (
                <div className="bp-muted">Помещений нет — добавьте первое помещение.</div>
              )}

              {!locked && (
                <button type="button" className="bp-btn" onClick={() => setAddRoomOpen(true)}>+ Добавить помещение</button>
              )}
          </>

          {/* ---- room-type picker (only after "+ Добавить помещение") ---- */}
          {addRoomOpen && !focusedRoom && (
            <div className="bp-card" style={{ borderColor: 'rgb(var(--bp-accent))' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <strong>Добавить помещение</strong>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="bp-btn pri" onClick={() => setAddRoomOpen(false)}>Готово</button>
                  <button type="button" className="bp-chip" onClick={() => setAddRoomOpen(false)} aria-label="Закрыть каталог типов комнат">✕</button>
                </div>
              </div>
              <div className="bp-muted">Выберите тип — создастся новая комната.</div>
              {groupedTypes.map((group) => (
                <div key={group.group} className="bp-grid">
                  <div className="bp-muted">{group.label}</div>
                  <div className="bp-tiles">
                    {group.items.map((type) => (
                      <button key={type.value} type="button" className="bp-tile" onClick={() => addRoomOfType(type.value)}>
                        {roomIcon(type.value)}<span>{type.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!locked ? (
            <button type="button" className="bp-btn pri" disabled={!rooms.length || missingAreas > 0 || isLoading} onClick={() => void confirmObject()}>
              {missingAreas > 0
                ? `Заполните площади (осталось ${missingAreas}${isHouseObject && floors.length > 1 ? `, на этом этаже ${floorMissingAreas}` : ''})`
                : 'Подтвердить объект и выбрать системы'}
            </button>
          ) : (
            <button type="button" className="bp-btn pri" onClick={() => setStep('systems')}>К системам</button>
          )}
        </section>
      )}

      {!focusedRoom && project && step === 'systems' && (
        <section className="bp-grid">
          <div className="bp-card">
            <h2 className="cfg-section-title">Что проектируем</h2>
            <SegmentedChoice
              label="Что проектируем"
              value={serviceChoice}
              onChange={(value) => void setService(value as ServiceChoice)}
              options={(systemsCatalog?.serviceOptions || []).map((option) => ({
                value: option.value as ServiceChoice,
                label: option.label,
                icon: (
                  <span style={{ display: 'inline-flex', gap: 2 }}>
                    {(option.value === 'cooling' ? ['cooling'] : option.value === 'heating' ? ['heating'] : ['heating', 'cooling']).map((svc) => (
                      <span key={svc} className="bp-svc" data-service={svc}><ServiceGlyph service={svc as 'heating' | 'cooling'} size={20} /></span>
                    ))}
                  </span>
                ),
              }))}
            />
          </div>

          {isApartmentObject && (
            <div className="bp-card eq-scope">
              <h2 className="cfg-section-title">Источник тепла и холода</h2>
              <p className="cfg-section-hint">
                Центральная система здания — источник вне квартиры; оборудование источника не подбирается. Отопление и охлаждение настраиваются независимо и могут комбинироваться с локальными системами в комнатах.
              </p>
              {requested.includes('heating') && (
                <div className="bp-grid" role="group" aria-label="Отопление: источник">
                  <div className="eq-group-title" data-service="heating"><span className="bp-svc" data-service="heating"><ServiceGlyph service="heating" size={18} /></span>Отопление</div>
                  <SourceChoiceList service="heating" options={[
                    { key: 'none', familyId: null, glyph: 'none_heating', label: 'Не требуется', pressed: apartmentSourceMode(selectedFamilies, 'heating') === 'none', onPress: () => void setApartmentMode('heating', 'none') },
                    { key: 'external', familyId: 'external_building_heating_supply', label: 'Центральное отопление здания', subtitle: 'Источник вне квартиры, не подбирается', pressed: apartmentSourceMode(selectedFamilies, 'heating') === 'external', onPress: () => void setApartmentMode('heating', 'external') },
                    { key: 'own', familyId: null, glyph: 'gas_boiler', label: 'Собственный источник', subtitle: 'Свой котёл, тепловой насос или кондиционеры', pressed: apartmentSourceMode(selectedFamilies, 'heating') === 'own', onPress: () => void setApartmentMode('heating', 'own') },
                  ]} />
                </div>
              )}
              {requested.includes('cooling') && (
                <div className="bp-grid" role="group" aria-label="Охлаждение: источник">
                  <div className="eq-group-title" data-service="cooling"><span className="bp-svc" data-service="cooling"><ServiceGlyph service="cooling" size={18} /></span>Охлаждение</div>
                  <SourceChoiceList service="cooling" options={[
                    { key: 'none', familyId: null, glyph: 'none_cooling', label: 'Не требуется', pressed: apartmentSourceMode(selectedFamilies, 'cooling') === 'none', onPress: () => void setApartmentMode('cooling', 'none') },
                    { key: 'external', familyId: 'external_building_cooling_supply', label: 'Центральное охлаждение здания', subtitle: 'Источник вне квартиры, не подбирается', pressed: apartmentSourceMode(selectedFamilies, 'cooling') === 'external', onPress: () => void setApartmentMode('cooling', 'external') },
                    { key: 'own', familyId: null, glyph: 'split_wall', label: 'Собственный источник', subtitle: 'Свой котёл, тепловой насос или кондиционеры', pressed: apartmentSourceMode(selectedFamilies, 'cooling') === 'own', onPress: () => void setApartmentMode('cooling', 'own') },
                  ]} />
                </div>
              )}
              {requested.includes('heating') && requested.includes('cooling') && (
                <div className="bp-nav">
                  <button type="button" className="bp-chip" onClick={() => void setBothCentral()}>Центральное отопление + охлаждение здания</button>
                </div>
              )}
            </div>
          )}

          {!isApartmentObject && requested.length > 0 && (
            <div className="bp-card eq-scope">
              <h2 className="cfg-section-title">Источник объекта</h2>
              <p className="cfg-section-hint">Общий источник выбирается на уровне объекта. В комнатах назначаются терминалы и локальные системы.</p>
              {requested.includes('heating') && (
                <div className="bp-grid" role="group" aria-label="Источник отопления">
                  <div className="eq-group-title" data-service="heating"><span className="bp-svc" data-service="heating"><ServiceGlyph service="heating" size={18} /></span>Источник отопления</div>
                  <SourceChoiceList service="heating" options={projectSourceOptions(systemsCatalog?.systemFamilies || [], 'heating').map((family) => ({
                    key: `ps-h-${family.id}`,
                    familyId: family.id,
                    label: family.label,
                    subtitle: equipmentSubtitle(family),
                    pressed: architecture?.spaceHeatingSourceId === family.id || architecture?.spaceCombinedSourceId === family.id || selectedFamilies.some((f) => f.id === family.id && (f.service === 'heating' || f.service === 'heating_and_cooling')),
                    onPress: () => void setProjectLevelSource('heating', family.id),
                  }))} />
                </div>
              )}
              {requested.includes('cooling') && (
                <div className="bp-grid" role="group" aria-label="Источник охлаждения">
                  <div className="eq-group-title" data-service="cooling"><span className="bp-svc" data-service="cooling"><ServiceGlyph service="cooling" size={18} /></span>Источник охлаждения</div>
                  <SourceChoiceList service="cooling" options={projectSourceOptions(systemsCatalog?.systemFamilies || [], 'cooling').map((family) => ({
                    key: `ps-c-${family.id}`,
                    familyId: family.id,
                    label: family.label,
                    subtitle: equipmentSubtitle(family),
                    pressed: architecture?.spaceCoolingSourceId === family.id || architecture?.spaceCombinedSourceId === family.id || selectedFamilies.some((f) => f.id === family.id && (f.service === 'cooling' || f.service === 'heating_and_cooling')),
                    onPress: () => void setProjectLevelSource('cooling', family.id),
                  }))} />
                </div>
              )}
            </div>
          )}

          {isCommercialObject && serviceChoice === 'heating_and_cooling' && (
            <div className="bp-card">
              <h2 className="cfg-section-title">Одновременные зоны (расширенно)</h2>
              <label style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 44, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  style={{ width: 22, height: 22, flex: '0 0 auto', accentColor: 'rgb(var(--bp-accent))' }}
                  checked={simultaneousRequired}
                  onChange={(e) => void setSimultaneousRequirement(e.target.checked)}
                />
                <span>Требуется одновременное отопление и охлаждение разных зон</span>
              </label>
              <div className="bp-muted">
                {simultaneousRequired
                  ? (simultaneousSupported
                      ? 'Архитектура поддерживает одновременную работу разных зон.'
                      : 'Выбранная 2-трубная схема — сезонное переключение. Требуется 4-трубная или независимая схема.')
                  : 'Обычный режим — сезонное переключение отопление/охлаждение.'}
              </div>
            </div>
          )}

          {requested.length > 0 && suggestion && !selectedFamilies.some((f) => f.external) && (
            <div className="bp-card eq-scope">
              <h2 className="cfg-section-title">{CFG_TEXT.recommendedScheme}</h2>
              <p className="cfg-section-hint">{CFG_TEXT.recommendedSchemeHint}</p>
              <div className="bp-nav">
                <button type="button" className="bp-btn pri" onClick={() => void applySuggestion()}>Применить рекомендуемую схему</button>
                <button type="button" className="bp-btn" onClick={() => setManualMode(true)}>Настроить вручную</button>
              </div>
              <Disclosure title={CFG_TEXT.recommendedByRoom((suggestion.roomAssignments || []).length)}>
                {(() => {
                  const list: EngineeringRoomAssignment[] = suggestion.roomAssignments || [];
                  const fams = systemsCatalog?.systemFamilies || [];
                  const shared = Object.fromEntries(requested.map((service) => [service, sharedRoomSource(list.map((item) => roomTerminalView(item, service, fams)))])) as Record<'heating' | 'cooling', RoomTerminalView['source']>;
                  return (
                <div className="eq-scheme-list">
                  {requested.some((service) => shared[service]) && (
                    <div className="eq-shared">
                      <div className="eq-shared-title">Общий источник объекта</div>
                      {requested.map((service) => shared[service] && <SharedSourceLine key={service} service={service} source={shared[service]!} />)}
                      <div className="bp-muted">Одна установка на весь объект — в помещениях ниже показаны только комнатные приборы.</div>
                    </div>
                  )}
                  {list.slice(0, 8).map((item) => (
                    <div key={item.roomId} className="eq-scheme-row">
                      <RoomHeading icon={<RoomGlyph roomType={item.roomPurpose} size={22} />} name={item.roomName} />
                      {requested.map((service) => (
                        <ServiceSummaryLine key={service} service={service} summary={roomRowSummary(roomTerminalView(item, service, fams), shared[service])} />
                      ))}
                    </div>
                  ))}
                  {list.length > 8 && (
                    <div className="bp-muted">… и ещё {list.length - 8} пом.</div>
                  )}
                </div>
                  );
                })()}
              </Disclosure>
            </div>
          )}

          {(manualMode || assignments.some((a) => a.heatingSystems.length || a.coolingSystems.length)) && (
            <div className="eq-scope eq-systems">
              <div className="cfg-workspace-head">
                <h2 className="cfg-section-title">Оборудование по помещениям</h2>
                <p className="cfg-section-hint">Выберите помещение и отметьте приборы отопления и охлаждения. Изменения сохраняются сразу.</p>
              </div>
              <div className="eq-layout">
              <div className="bp-card">
                <RoomNavigator
                  activeId={openRoomId || rooms[0]?.id || null}
                  onSelect={(roomId) => { setOpenRoomId(roomId); setBulkSourceId(roomId); }}
                  rooms={rooms.map((room) => {
                    const a = assignments.find((item) => item.roomId === room.id);
                    return {
                      id: room.id,
                      name: room.name,
                      icon: <RoomGlyph roomType={room.roomType} size={20} />,
                      areaM2: room.areaM2,
                      summaries: Object.fromEntries(requested.map((service) => [service, roomTerminalView(a, service, systemsCatalog?.systemFamilies || [])])),
                    };
                  })}
                />
              </div>
              <div className="bp-grid eq-main">
                {sourceRoom && (
                  <RoomEditor
                    room={sourceRoom}
                    assignment={sourceAssignment || emptyAssignment(sourceRoom, requested)}
                    requested={requested}
                    families={systemsCatalog?.systemFamilies || []}
                    catalog={systemsCatalog}
                    onToggle={toggleRoomFamily}
                    onNotRequired={setNotRequired}
                    onTowel={setTowelPreference}
                    towel={resolveTowelWarmer({
                      room: sourceRoom,
                      assignment: sourceAssignment ?? undefined,
                      requestedServices: requested,
                      projectHeatingSourceId: architecture?.spaceHeatingSourceId ?? architecture?.spaceCombinedSourceId ?? null,
                      override: towelOverrides[sourceRoom.id],
                    })}
                    onTowelChange={updateTowelOverride}
                    fanCoilMounting={fanCoilMountingOf(eqChoices, sourceRoom.id)}
                    onFanCoilMounting={(m) => setFanCoilMounting([sourceRoom.id], m)}
                    fanCoilRoomsToSync={(() => {
                      const m = fanCoilMountingOf(eqChoices, sourceRoom.id);
                      return assignments.filter((a) => a.roomId !== sourceRoom.id && roomUsesFanCoils(a) && fanCoilMountingOf(eqChoices, a.roomId) !== m).map((a) => a.roomId);
                    })()}
                    onFanCoilApplyAll={(ids) => { const m = fanCoilMountingOf(eqChoices, sourceRoom.id); if (m) setFanCoilMounting(ids, m); }}
                    recommended={suggestion && !selectedFamilies.some((f) => f.external)
                      ? recommendedForRoom(suggestion.roomAssignments || [], sourceRoom.id, systemsCatalog)
                      : undefined}
                  />
                )}
                <div className="bp-card">
                  <strong>Массовое назначение</strong>
                  <div className="bp-muted">Копируется схема комнаты «{sourceRoom ? sourceRoom.name : '—'}»{sourceAssignment ? ':' : ' — не выбрана'}</div>
                  {sourceAssignment && requested.map((service) => (
                    <ServiceSummaryLine key={service} service={service} summary={roomServiceSummary(sourceAssignment, service, systemsCatalog?.systemFamilies || [])} />
                  ))}
                  <div className="eq-actions">
                    <button type="button" className="bp-btn" onClick={() => void applyBulk('bedrooms')}>Ко всем спальням</button>
                    <button type="button" className="bp-btn" onClick={() => void applyBulk('living_rooms')}>Ко всем жилым</button>
                    <button type="button" className="bp-btn" onClick={() => void applyBulk('wet_rooms')}>Ко всем влажным</button>
                    <button type="button" className="bp-btn" onClick={() => void applyBulk('all_rooms')}>Ко всем комнатам</button>
                    {undoState && project.systemsRevision === undoState.validRevision && <button type="button" className="bp-btn" onClick={() => void undoBulk()}>Отменить</button>}
                  </div>
                  {bulkMessage && <div className="bp-ok" role="status">{bulkMessage}</div>}
                </div>
              </div>
              </div>
            </div>
          )}

          {archSummary?.twoPipe && requested.length > 0 && (
            <Notice tone="info" title="Ограничение схемы">2-трубный контур работает сезонно: нельзя одновременно отапливать одно помещение и охлаждать другое.</Notice>
          )}
          <ValidationPanel validation={validation} rooms={rooms} />

          {requested.length > 0 && (archSummary || hydronic) && (
            <Disclosure title={CFG_TEXT.engineeringDetails} meta={CFG_TEXT.engineeringDetailsMeta}>
              {archSummary && architecture && (
                <div className="bp-grid">
                  <strong>Рекомендуемая архитектура</strong>
                  <dl className="bp-kv cfg-facts">
                    {architecture.spaceCombinedSourceId ? (
                      <><dt>Источник</dt><dd className="bp-kv-wrap">{systemIcon(architecture.spaceCombinedSourceId)}{archSummary.sourceLabel}</dd></>
                    ) : (
                      <>
                        {requested.includes('heating') && <><dt>Источник отопления</dt><dd className="bp-kv-wrap">{systemIcon(archSummary.heatingSourceId || '')}{archSummary.heatingSourceLabel}</dd></>}
                        {requested.includes('cooling') && <><dt>Источник охлаждения</dt><dd className="bp-kv-wrap">{systemIcon(archSummary.coolingSourceId || '')}{archSummary.coolingLocalOnly ? 'Локальные системы по помещениям' : archSummary.coolingSourceLabel}</dd></>}
                      </>
                    )}
                    <dt>Распределение</dt><dd className="bp-kv-wrap">{archSummary.distributionLabel}</dd>
                    <dt>ГВС</dt><dd className="bp-kv-wrap">{archSummary.hasDhw ? 'настроено' : 'не настроено'}</dd>
                  </dl>
                  {archSummary.roomTerminals.length > 0 && (
                    <div className="bp-grid" style={{ gap: 6 }}>
                      <div className="bp-muted">Комнатные приборы</div>
                      {archSummary.roomTerminals.slice(0, 6).map((item) => (
                        <div key={item.room.id} style={{ fontSize: 15 }}>
                          {roomIcon(item.room.roomType)}{item.room.name} → {systemIcon(item.terminal.familyId)}{item.terminal.label}
                        </div>
                      ))}
                      {archSummary.roomTerminals.length > 6 && (
                        <div className="bp-muted">… и {archSummary.roomTerminals.length - 6} помещений</div>
                      )}
                    </div>
                  )}
                </div>
              )}
              {hydronic && (
                <HydronicRequirementsBlock req={hydronic} />
              )}
              {project && (
                <EquipmentSpecPanel compact project={project} loads={null} towelWarmers={resolveProjectTowelWarmers(project, towelOverrides)} />
              )}
            </Disclosure>
          )}

          <div className="cfg-next">
            <button type="button" className="bp-btn pri" disabled={!requested.length} onClick={() => setStep('review')}>{CFG_TEXT.nextToReview}</button>
          </div>
        </section>
      )}

      {!focusedRoom && project && step === 'review' && (
        <section className="bp-grid">
          <div className="bp-card">
            <h2 className="cfg-section-title">{project.name}</h2>
            <dl className="bp-kv cfg-facts">
              <dt>Что проектируем</dt>
              <dd className="bp-kv-wrap">{serviceChoice === 'heating_and_cooling' ? 'Отопление + охлаждение' : serviceChoice === 'cooling' ? 'Охлаждение' : 'Отопление'}</dd>
              {isHouseObject && topology && <><dt>Этажей</dt><dd>{topology.floorCount}</dd></>}
              {architecture && requested.length > 0 && (architecture.spaceCombinedSourceId ? (
                <><dt>Источник</dt><dd className="bp-kv-wrap">{systemIcon(architecture.spaceCombinedSourceId)}{archSummary?.sourceLabel}</dd></>
              ) : (
                <>
                  {requested.includes('heating') && <><dt>Источник отопления</dt><dd className="bp-kv-wrap">{systemIcon(archSummary?.heatingSourceId || '')}{archSummary?.heatingSourceLabel}</dd></>}
                  {requested.includes('cooling') && <><dt>Источник охлаждения</dt><dd className="bp-kv-wrap">{systemIcon(archSummary?.coolingSourceId || '')}{archSummary?.coolingLocalOnly ? 'Локальные системы по помещениям' : archSummary?.coolingSourceLabel}</dd></>}
                </>
              ))}
              {architecture && requested.length > 0 && <><dt>Распределение</dt><dd className="bp-kv-wrap">{archSummary?.distributionLabel}</dd><dt>ГВС</dt><dd className="bp-kv-wrap">{archSummary?.hasDhw ? 'настроено' : 'не настроено'}</dd></>}
            </dl>
            <div className="bp-sum">
              <AreaConsistencySummary totalArea={totalArea} sumArea={sumArea} />
            </div>
            <AreaOverWarning totalArea={totalArea} sumArea={sumArea} />
          </div>

          <div className="bp-card">
            <h2 className="cfg-section-title">Помещения и оборудование</h2>
            <div className="cfg-room-rows">
              {(isHouseObject && floors.length > 1 ? floors : [null]).map((floor) => {
                const list = floor ? rooms.filter((r) => r.floorId === floor.id) : rooms;
                if (!list.length) return null;
                return (
                  <Fragment key={floor?.id || 'all'}>
                    {floor && <div className="cfg-floor-title">{floor.label}</div>}
                    {list.map((room) => {
                      const a = assignments.find((item) => item.roomId === room.id);
                      return (
                        <div key={room.id} className="cfg-room-row">
                          <RoomHeading icon={<RoomGlyph roomType={room.roomType} size={22} />} name={room.name} meta={`${room.areaM2 ?? '—'} м²`} />
                          <div className="bp-muted">
                            {requested.includes('heating') && <div>{HEAT_MARK}{compactRoomLabel(a, 'heating', systemsCatalog, architecture)}</div>}
                            {requested.includes('cooling') && <div>{COOL_MARK}{compactRoomLabel(a, 'cooling', systemsCatalog, architecture)}</div>}
                          </div>
                        </div>
                      );
                    })}
                  </Fragment>
                );
              })}
            </div>
          </div>

          <ValidationPanel validation={validation} rooms={rooms} />
          {(() => {
            const unset = assignments.filter((a) => roomUsesFanCoils(a) && !fanCoilMountingOf(eqChoices, a.roomId));
            return unset.length > 0 ? (
              <Notice tone="warn" title={`Не выбран тип установки фанкойла (${unset.length})`}>
                <div>Без типа установки модель фанкойла не подбирается, и итоговый PDF будет недоступен. Выберите тип в карточке помещения на шаге «Системы».</div>
                <div className="bp-muted">{unset.map((a) => rooms.find((r) => r.id === a.roomId)?.name ?? a.roomName).join(', ')}</div>
              </Notice>
            ) : null;
          })()}
          {hydronic && (
            <Disclosure title={CFG_TEXT.engineeringDetails} meta="необходимая гидравлическая обвязка">
              <HydronicRequirementsBlock req={hydronic} />
            </Disclosure>
          )}
          <LoadsSummary project={project} loadState={loadState} onOpen={() => setStep('loads')} />
          <div className="cfg-next">
            {(project.status !== 'systems_configured') && (
              <button type="button" className="bp-btn pri" disabled={!requested.length || blockers.length > 0 || isLoading} onClick={() => void confirmSystemsConfiguration()}>Подтвердить системы</button>
            )}
            <div className="eq-actions">
              {project.status !== 'draft' && <button type="button" className="bp-btn" onClick={() => reopenObject()}>Изменить объект</button>}
              <button type="button" className="bp-btn" onClick={() => setStep('systems')}>Изменить системы</button>
            </div>
          </div>
        </section>
      )}

      {!focusedRoom && project && step === 'loads' && (
        <LoadsPanel
          project={project}
          loadState={loadState}
          loadMode={loadMode}
          setLoadMode={setLoadMode}
          onCalculate={(mode) => void calculateLoads(mode)}
          onOpenMissing={openMissingInput}
          towelOverrides={towelOverrides}
        />
      )}
    </div>
  );
}

const ROOM_EDITOR_SECTION_ORDER: RoomEditorSectionKey[] = ['main', 'envelope', 'windows', 'air', 'internal', 'advanced'];

function roomEditorSectionForMissing(key: string | null): RoomEditorSectionKey | null {
  if (key === 'area') return 'main';
  if (key === 'envelope' || key === 'windows' || key === 'air' || key === 'internal') return key;
  return null;
}

function FocusedRoomEditor(props: {
  project: BuildingProject;
  room: BuildingRoom;
  readiness: SteadyStateReadiness;
  requestedServices: Array<'heating' | 'cooling'>;
  disabled: boolean;
  saving: boolean;
  catalog: BuildingCatalog | null;
  missingEdit: MissingEditTarget | null;
  focusSectionKey: string | null;
  doneMessage: string | null;
  onPatch: (patch: BuildingRoomInput) => void;
  onPropagate?: (patches: RoomPatch[]) => void;
  onBack: () => void;
  onDone: () => void;
  onFocusConsumed: () => void;
}) {
  const {
    project,
    room,
    readiness,
    requestedServices,
    disabled,
    saving,
    catalog,
    missingEdit,
    focusSectionKey,
    doneMessage,
    onPatch,
    onPropagate,
    onBack,
    onDone,
    onFocusConsumed,
  } = props;
  const defaultOpenSection = roomEditorSectionForMissing(firstMissingSection(readiness)) ?? 'main';
  const [openSection, setOpenSection] = useState<RoomEditorSectionKey | null>(
    roomEditorSectionForMissing(focusSectionKey) ?? defaultOpenSection,
  );
  const [heightEdit, setHeightEdit] = useState(false);
  const requiredMissingCount = roomEditorMissingCount(readiness);
  const engineeringFocusKey = focusSectionKey && ['envelope', 'windows', 'air', 'internal'].includes(focusSectionKey)
    ? focusSectionKey
    : null;

  useEffect(() => {
    const target = roomEditorSectionForMissing(focusSectionKey);
    if (!target) return;
    setOpenSection(target);
    if (target === 'main') onFocusConsumed();
  }, [focusSectionKey, onFocusConsumed]);

  const toggleSection = (key: RoomEditorSectionKey) => setOpenSection((current) => current === key ? null : key);
  const requiredItems = roomEditorReadinessItems(readiness).filter((item) => item.status === 'missing');
  const missingSections = requiredItems
    .map((item) => roomEditorSectionForMissing(item.sectionKey))
    .filter((section): section is RoomEditorSectionKey => section !== null);
  const sectionIsMissing = (section: RoomEditorSectionKey) => missingSections.includes(section);
  const nextRequiredSection = (current: RoomEditorSectionKey): RoomEditorSectionKey | null => {
    const currentIndex = ROOM_EDITOR_SECTION_ORDER.indexOf(current);
    return missingSections.find((section) => ROOM_EDITOR_SECTION_ORDER.indexOf(section) > currentIndex)
      ?? missingSections.find((section) => section !== current)
      ?? null;
  };
  const canAdvanceSection = (current: RoomEditorSectionKey) => !saving && !sectionIsMissing(current);
  const goNext = (current: RoomEditorSectionKey) => {
    if (!canAdvanceSection(current)) return;
    const next = nextRequiredSection(current);
    if (next) {
      setOpenSection(next);
      return;
    }
    onDone();
  };
  const height = room.extras?.geometry?.ceilingHeightM ?? project.defaultCeilingHeightM;
  const roomAreaItem = readiness.items.find((item) => item.key === 'area');

  return (
    <div className="bp-card" data-bp-focused-room={room.id} style={{ gap: 10 }}>
      <div className="bp-editor-head">
        <div className="bp-editor-title">
          <button type="button" className="bp-chip" style={{ minHeight: 32 }} onClick={onBack}>← Помещения</button>
          <strong>{roomIcon(room.roomType)} {room.name}</strong>
          {room.areaM2 != null && <span className="bp-muted">{room.areaM2} м²</span>}
          <span className={requiredMissingCount ? 'bp-alert' : 'bp-ok'}>
            {requiredMissingCount ? `⚠ Не заполнено ${requiredMissingCount}` : '✓ Готово'}
          </span>
        </div>
        <button type="button" className="bp-btn pri" style={{ minHeight: 32 }} disabled={saving} onClick={onDone}>
          {saving ? 'Сохранение…' : missingEdit ? 'Готово — вернуться к расчёту' : 'Готово'}
        </button>
      </div>

      <div className="bp-card" style={{ gap: 6, borderColor: requiredMissingCount ? '#ffd43b' : '#69db7c' }}>
        <div><strong>Осталось заполнить: {requiredMissingCount}</strong></div>
        {requiredMissingCount > 0 && (
          <button type="button" className="bp-btn" onClick={() => {
            const first = roomEditorSectionForMissing(firstMissingSection(readiness));
            if (first) setOpenSection(first);
          }}>Перейти к следующему</button>
        )}
        {doneMessage && <div className="bp-alert" role="status">{doneMessage}</div>}
      </div>

      <FocusedEditorSection
        title="Основное"
        status={readinessStatusLabel(roomAreaItem, requestedServices)}
        open={openSection === 'main'}
        onToggle={() => toggleSection('main')}
        onNext={canAdvanceSection('main') ? () => goNext('main') : undefined}
      >
        <label className="bp-muted">Название
          <input className="bp-input" defaultValue={room.name} disabled={disabled}
            onBlur={(e) => { if (e.target.value.trim() && e.target.value !== room.name) onPatch({ name: e.target.value }); }} />
        </label>
        <label className="bp-muted">Площадь, м² *
          <input className="bp-input" type="number" min={0.1} step={0.1} disabled={disabled} defaultValue={room.areaM2 ?? ''}
            onBlur={(e) => onPatch({ areaM2: e.target.value === '' ? null : Number(e.target.value) })} />
        </label>
        <div className="bp-muted">Высота
          {room.extras?.geometry?.ceilingHeightM == null && !heightEdit ? (
            <div className="bp-ok" style={{ fontSize: 13 }}>
              {height} м — как у объекта
              {!disabled && <button type="button" className="bp-chip" style={{ marginLeft: 8, minHeight: 30 }} onClick={() => setHeightEdit(true)}>Изменить</button>}
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="bp-input" type="number" step={0.1} min={1.8} max={8} placeholder={`${project.defaultCeilingHeightM} — как у объекта`}
                defaultValue={room.extras?.geometry?.ceilingHeightM ?? ''} disabled={disabled}
                onBlur={(e) => {
                  setHeightEdit(false);
                  const next = e.target.value === '' ? null : Number(e.target.value);
                  if (next !== (room.extras?.geometry?.ceilingHeightM ?? null)) {
                    onPatch({ extras: { ...room.extras, geometry: { ...room.extras.geometry, ceilingHeightM: next } } });
                  }
                }} />
              {!disabled && <button type="button" className="bp-chip" style={{ minHeight: 30 }} onClick={() => {
                setHeightEdit(false);
                onPatch({ extras: { ...room.extras, geometry: { ...room.extras.geometry, ceilingHeightM: null } } });
              }}>Как у объекта</button>}
            </div>
          )}
        </div>
        <label className="bp-muted">Остекление
          <select className="bp-input" disabled={disabled}
            value={room.extras?.windows?.glazingType === 'standard' ? '' : (room.extras?.windows?.glazingType ?? '')}
            onChange={(e) => onPatch({ extras: { ...room.extras, windows: { ...room.extras.windows, glazingType: parseWindowGlazingType(e.target.value, catalog?.windowTypes || []) } } })}>
            <option value="">Обычное</option>
            {(catalog?.windowTypes || []).filter((w) => w.value !== 'standard').map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </label>
        <label className="bp-muted">Теплоизоляция
          <select className="bp-input" disabled={disabled} value={room.extras?.insulationOverride ?? ''}
            onChange={(e) => onPatch({ extras: { ...room.extras, insulationOverride: parseInsulationLevel(e.target.value, catalog?.insulationLevels || []) } })}>
            <option value="">Как у объекта</option>
            {(catalog?.insulationLevels || []).map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
          </select>
        </label>
        <div className="bp-muted">Условия помещения
          <div className="bp-nav">
            {(catalog?.roomConditions || []).map((condition) => {
              const active = (room.extras?.conditions || []).includes(condition.value);
              return <button key={condition.value} type="button" className={`bp-chip${active ? ' on' : ''}`} disabled={disabled}
                onClick={() => onPatch({ extras: { ...room.extras, conditions: active ? (room.extras?.conditions || []).filter((v) => v !== condition.value) : [...(room.extras?.conditions || []), condition.value] } })}>{condition.label}</button>;
            })}
          </div>
        </div>
        <label className="bp-muted">Заметки
          <input className="bp-input" defaultValue={room.extras?.notes || ''} disabled={disabled}
            onBlur={(e) => onPatch({ extras: { ...room.extras, notes: e.target.value } })} />
        </label>
      </FocusedEditorSection>

      <RoomEngineeringPanel
        project={project}
        room={room}
        disabled={disabled}
        objectType={project.objectType}
        defaultCeilingHeightM={project.defaultCeilingHeightM}
        onPatch={onPatch}
        onPropagate={onPropagate}
        readiness={readiness}
        requestedServices={requestedServices}
        openSection={openSection === 'main' ? null : openSection}
        onSectionToggle={(key) => toggleSection(key)}
        onNext={(key) => goNext(key)}
        canNext={(key) => canAdvanceSection(key)}
        focusSectionKey={engineeringFocusKey}
        onFocusConsumed={onFocusConsumed}
      />
    </div>
  );
}

function FocusedEditorSection(props: {
  title: string;
  status: string;
  open: boolean;
  onToggle: () => void;
  onNext?: () => void;
  children: ReactNode;
}) {
  const { title, status, open, onToggle, onNext, children } = props;
  return (
    <div className="bp-card" style={{ padding: 0, gap: 0 }}>
      <button type="button" className="bp-accordion-trigger" onClick={onToggle} aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer', padding: '8px 10px', minHeight: 40, textAlign: 'left' }}>
        <span style={{ fontWeight: 700 }}>{title}</span>
        <span style={{ flex: 1 }} />
        <span className={status.startsWith('✓') ? 'bp-ok' : status.startsWith('⚠') ? 'bp-alert' : 'bp-muted'} style={{ whiteSpace: 'nowrap', fontSize: 14 }}>{status}</span>
        <span aria-hidden style={{ color: '#12b886' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className="bp-grid" style={{ padding: '8px 10px 10px' }}>{children}{onNext && <button type="button" className="bp-btn" onClick={onNext}>Далее</button>}</div>}
    </div>
  );
}

/** − N + counter with large touch targets. */
function Stepper({ value, min, max, label, onChange }: { value: number; min: number; max: number; label: string; onChange: (n: number) => void }) {
  return (
    <span className="bp-stepper">
      <button type="button" aria-label={`Меньше: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>−</button>
      <output aria-live="polite">{value}</output>
      <button type="button" aria-label={`Больше: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>+</button>
    </span>
  );
}

/**
 * Large numeric field for fast entry. Accepts "12,5", "3,5×4", "12+4,5".
 * Saves on blur / Enter (Enter jumps to the next empty field). An empty field
 * is saved as «не указано» (null) — never as 0. Invalid input is shown inline
 * and NOT saved.
 */
function QuickNumberField({ value, unit, label, required, disabled, onCommit }: {
  value: number | null;
  unit: string;
  label: string;
  required?: boolean;
  disabled?: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(formatQuickNumber(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(formatQuickNumber(value)); }, [value, focused]);
  const parsed = parseQuickNumber(text);
  const commit = () => {
    setFocused(false);
    if (parsed.status === 'invalid') return;
    const next = parsed.status === 'ok' ? parsed.value : null;
    if (next !== (value ?? null)) onCommit(next);
    setText(formatQuickNumber(next));
  };
  return (
    <span className="bp-qn">
      <span className="bp-unit-wrap">
        <input
          className="bp-input bp-num"
          type="text"
          inputMode="decimal"
          enterKeyHint="next"
          autoComplete="off"
          aria-label={label}
          aria-required={required || undefined}
          aria-invalid={parsed.status === 'invalid' || undefined}
          placeholder="—"
          disabled={disabled}
          value={text}
          {...{ [QUICK_ENTRY_ATTR]: '' }}
          onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); focusNextEntry(e.currentTarget); }
            if (e.key === 'Escape') { setText(formatQuickNumber(value)); e.currentTarget.blur(); }
          }}
        />
        <span className="bp-unit">{unit}</span>
      </span>
      {parsed.status === 'invalid' && <span className="bp-alert bp-qn-msg" role="alert">{parsed.message}</span>}
      {parsed.status === 'ok' && parsed.expression && <span className="bp-ok bp-qn-msg">= {formatQuickNumber(parsed.value)} {unit}</span>}
    </span>
  );
}

/** Completion indicator for the mandatory step (room areas). */
function EntryProgress({ rooms }: { rooms: BuildingRoom[] }) {
  const p = areaProgress(rooms);
  if (!p.total) return null;
  const done = p.filled === p.total;
  return (
    <div className="bp-progress" role="status" aria-live="polite">
      <div className={done ? 'bp-ok' : 'bp-muted'} style={{ fontSize: 13 }}>
        {done ? '✓ Все площади введены — можно переходить к системам' : `Площади: ${p.filled} из ${p.total} (осталось ${p.total - p.filled})`}
      </div>
      <div className="bp-progress-bar"><span style={{ width: `${p.percent}%` }} /></div>
    </div>
  );
}

function HydronicRequirementsBlock({ req }: { req: HydronicSystemRequirements }) {
  const hydronic = req.hydronicCircuitPresent !== false && (
    req.fanCoilCount > 0 || req.hydronicFloorHeatingPresent || (req.towelRadiatorsRequired || 0) > 0 || (req.towelRadiatorsRecommended || 0) > 0
  );
  const rows: Array<{ label: string; value: string }> = [];
  if (req.fanCoilCount > 0) rows.push({ label: 'Фанкойлы', value: String(req.fanCoilCount) });
  if (req.fanCoilCount > 0) {
    rows.push({
      label: 'Распределение фанкойлов',
      value: req.fanCoilDistribution === 'home_run_manifold'
        ? 'home-run коллектор'
        : req.fanCoilDistribution === 'branch_riser'
          ? 'стояки / ветки'
          : 'будет определено при проектировании',
    });
  }
  if (req.fanCoilManifoldRequired) {
    rows.push({ label: 'Распределительный коллектор', value: `требуется минимум ${req.fanCoilManifoldPortsRequired} подключений` });
  }
  if (req.fanCoilValveSetsRequired > 0) rows.push({ label: 'Комплекты регулирующей арматуры фанкойлов', value: String(req.fanCoilValveSetsRequired) });
  if (req.actuatorCountRequired > 0) rows.push({ label: 'Сервоприводы', value: String(req.actuatorCountRequired) });
  if (req.fanCoilHeatingCircuit?.present) rows.push({ label: 'Контур фанкойлов (отопление)', value: `${req.fanCoilHeatingCircuit.valveSetsRequired} комплектов` });
  if (req.fanCoilCoolingCircuit?.present) rows.push({ label: 'Контур фанкойлов (охлаждение)', value: `${req.fanCoilCoolingCircuit.valveSetsRequired} комплектов` });
  if ((req.towelRadiatorsRequired || 0) > 0) rows.push({ label: 'Полотенцесушители (обязательные)', value: String(req.towelRadiatorsRequired) });
  if ((req.towelRadiatorsRecommended || 0) > 0) rows.push({ label: 'Полотенцесушители (рекомендация)', value: String(req.towelRadiatorsRecommended) });
  if (req.hydronicFloorHeatingPresent) rows.push({ label: 'Водяной тёплый пол', value: 'есть' });
  if (req.floorHeatingManifoldRequired) rows.push({ label: 'Коллектор тёплого пола', value: 'требуется' });
  if (req.hydronicFloorHeatingPresent) {
    const circuits = req.floorHeatingCircuits;
    rows.push({
      label: 'Количество контуров',
      value: circuits?.status === 'known' && circuits.count != null
        ? String(circuits.count)
        : 'будет определено после расчёта',
    });
  }
  if (req.mixingUnitStatus === 'pending_design') rows.push({ label: 'Смесительно-насосный узел', value: hydronicValueText('pending_design') });
  else if (req.mixingUnitRequired) rows.push({ label: 'Смесительно-насосный узел', value: 'требуется' });
  if (req.circulationPumpStatus === 'pending_design') rows.push({ label: 'Циркуляционный насос смесительного узла', value: hydronicValueText('pending_design') });
  else if (req.circulationPumpRequired) rows.push({ label: 'Циркуляционный насос смесительного узла', value: 'требуется' });
  if (req.fanCoilCount > 0) {
    rows.push({
      label: 'Подключение фанкойлов',
      value: req.fanCoilCircuitKind === '4pipe' ? '4-трубное (независимые контуры)' : '2-трубное (сезонное переключение)',
    });
  }
  if (hydronic && (req.unresolvedRequirements || []).some((item) => item.startsWith('pumpGroups:'))) {
    rows.push({ label: 'Насосные группы', value: 'будут определены гидравлическим расчётом' });
  }

  if (!rows.length && !req.byFloor?.length) return null;
  return (
    <div className="bp-card">
      <strong>Необходимая гидравлическая обвязка</strong>
      {req.byFloor && req.byFloor.length > 0 && (
        <div className="bp-grid" style={{ marginTop: 4 }}>
          {req.byFloor.map((floor) => {
            const fRows: Array<{ label: string; value: string }> = [];
            if (floor.fanCoilCount > 0) fRows.push({ label: 'Фанкойлы', value: String(floor.fanCoilCount) });
            if (floor.fanCoilCount > 0) fRows.push({ label: 'Распределение', value: `минимум ${floor.fanCoilManifoldPortsRequired} подключений` });
            if (floor.towelRadiatorsRequired > 0) fRows.push({ label: 'Полотенцесушители (обязательные)', value: String(floor.towelRadiatorsRequired) });
            if ((floor.towelRadiatorsRecommended || 0) > 0) fRows.push({ label: 'Полотенцесушители (рекомендация)', value: String(floor.towelRadiatorsRecommended) });
            if (floor.hydronicFloorHeatingPresent) {
              fRows.push({ label: 'Тёплый пол', value: 'есть' });
              fRows.push({ label: 'Контуры тёплого пола', value: 'будут определены расчётом' });
            } else {
              fRows.push({ label: 'Тёплый пол', value: 'нет' });
            }
            return (
              <div key={floor.floorId} className="bp-grid" style={{ gap: 6 }}>
                <div className="cfg-floor-title">{floor.floorLabel}</div>
                <dl className="bp-kv cfg-facts">
                  {fRows.map((r) => (
                    <Fragment key={r.label}><dt>{r.label}</dt><dd className="bp-kv-wrap">{r.value}</dd></Fragment>
                  ))}
                </dl>
              </div>
            );
          })}
        </div>
      )}
      {rows.length > 0 && (
        <dl className="bp-kv cfg-facts">
          {rows.map((row) => (
            <Fragment key={row.label}><dt>{row.label}</dt><dd className="bp-kv-wrap">{row.value}</dd></Fragment>
          ))}
        </dl>
      )}
      <div className="bp-muted">
        Требования к гидравлической схеме, не подбор товаров. Расчёт мощности, расхода, напора и диаметров — в следующей фазе.
      </div>
    </div>
  );
}

function RoomEditor(props: {
  room: BuildingRoom;
  assignment: EngineeringRoomAssignment;
  requested: Array<'heating' | 'cooling'>;
  families: EngineeringSystemFamily[];
  catalog: BuildingSystemsCatalog | null;
  onToggle: (roomId: string, service: 'heating' | 'cooling', family: EngineeringSystemFamily, role: 'source' | 'terminal') => void;
  onNotRequired: (roomId: string, service: 'heating' | 'cooling') => void;
  onTowel: (roomId: string, preference: ServicePreference) => void;
  towel: TowelWarmerSelection | null;
  onTowelChange: (roomId: string, patch: TowelWarmerOverride) => void;
  fanCoilMounting?: FanCoilMounting | null;
  onFanCoilMounting?: (mounting: FanCoilMounting) => void;
  fanCoilRoomsToSync?: string[];
  onFanCoilApplyAll?: (roomIds: string[]) => void;
  recommended?: Partial<Record<'heating' | 'cooling', string[]>>;
}) {
  const { room, assignment, requested, families, catalog, onToggle, onNotRequired, onTowel, towel, onTowelChange } = props;
  const wetTowel = room.roomType === 'bathroom' || room.roomType === 'shower';
  const catalogFamilies = catalog?.systemFamilies || families;
  return (
    <div className="bp-card eq-editor">
      <div className="eq-editor-head">
        <RoomGlyph roomType={room.roomType} size={28} />
        <h3 className="eq-editor-title" style={{ margin: 0 }}>{room.name}</h3>
        <span className="bp-muted">{room.areaM2 ?? '—'} м²</span>
      </div>
      <RoomEquipmentSelector
        roomId={room.id}
        assignment={assignment}
        requested={requested}
        families={families}
        summaries={{
          heating: roomServiceSummary(assignment, 'heating', catalogFamilies),
          cooling: roomServiceSummary(assignment, 'cooling', catalogFamilies),
        }}
        onToggle={onToggle}
        onNotRequired={onNotRequired}
        recommended={props.recommended}
      />
      {roomUsesFanCoils(assignment) && props.onFanCoilMounting && (
        <div className="eq-scope">
          <FanCoilMountingPanel
            value={props.fanCoilMounting ?? null}
            service={assignment.coolingSystems.some((x) => x.familyId === 'fan_coils') ? 'cooling' : 'heating'}
            counts={fanCoilCountByMounting()}
            onChange={props.onFanCoilMounting}
            onApplyAll={props.fanCoilRoomsToSync?.length && props.onFanCoilApplyAll ? () => props.onFanCoilApplyAll!(props.fanCoilRoomsToSync!) : undefined}
            applyAllLabel={props.fanCoilRoomsToSync?.length ? `Применить ко всем помещениям с фанкойлами (ещё ${props.fanCoilRoomsToSync.length})` : undefined}
          />
        </div>
      )}
      {wetTowel && requested.includes('heating') && assignment.servicePreferences.heating !== 'not_required' && (
        <div className="eq-scope">
          <TowelWarmerPanel
            roomName={room.name}
            selection={towel}
            onKind={(kind: TowelWarmerKind) => onTowelChange(room.id, { kind })}
            onRemove={() => onTowel(room.id, 'not_required')}
            onAdd={() => onTowel(room.id, 'required')}
            quantityControl={<Stepper value={towel?.quantity ?? 1} min={1} max={TOWEL_WARMER_MAX_QUANTITY} label="Количество полотенцесушителей" onChange={(quantity) => onTowelChange(room.id, { quantity })} />}
            note={towel?.kindSource === 'default'
              ? <div className="bp-muted">Тип выбран по умолчанию — система отопления его не определяет. Можно изменить.</div>
              : towel?.kindSource === 'heating_system'
                ? <div className="bp-muted">Тип подобран по системе отопления помещения.</div>
                : null}
          />
        </div>
      )}
    </div>
  );
}

function ValidationPanel({ validation, rooms }: { validation: SystemsValidationResult | null; rooms: BuildingRoom[] }) {
  if (!validation) return null;
  const { blockers, warnings } = validation;
  if (!blockers.length && !warnings.length) return null;
  const serviceText = (service?: 'heating' | 'cooling') => (service ? ` · ${service === 'heating' ? 'отопление' : 'охлаждение'}` : '');
  const blockerGroups = groupValidationIssues(blockers, rooms);
  const warningGroups = groupValidationIssues(warnings, rooms);
  return (
    <section className="bp-grid" aria-label={CFG_TEXT.readiness}>
      {blockerGroups.length > 0 && (
        <Notice tone="danger" title={`${CFG_TEXT.blockers} (${blockers.length})`}>
          <ul>
            {blockerGroups.map((item, index) => (
              <li key={`b-${item.code}-${index}`}>
                Блокер{serviceText(item.service)}: {item.message}
                {item.rooms.length > 0 && <div className="bp-muted">{item.rooms.join(', ')}</div>}
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {warningGroups.length > 0 && (
        <Notice tone="warn" title={`${CFG_TEXT.warnings} (${warnings.length})`}>
          <ul>
            {warningGroups.map((item, index) => (
              <li key={`w-${item.code}-${index}`}>
                {item.message}{serviceText(item.service)}
                {item.rooms.length > 0 && <div className="bp-muted">Помещения: {item.rooms.join(', ')}</div>}
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </section>
  );
}

// ---------- Phase 3 — Loads UI (display only; backend is the authority) ----------

function loadStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    calculated: 'рассчитано',
    limited: 'ограничено',
    incomplete: 'неполно',
    stale: 'устарело',
  };
  return labels[status] || status;
}

function servicePreferenceLabel(preference: ServicePreference): string {
  if (preference === 'required') return 'нужно';
  if (preference === 'optional') return 'по желанию';
  return 'не требуется';
}

function ruCount(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

function serviceStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    calculated: 'рассчитано',
    not_requested: 'не запрошено',
    not_required: 'не требуется',
    missing_input: 'не хватает данных',
    limited: 'ограничено',
  };
  return labels[status] || status;
}

/**
 * Single presentation formatter for ALL Loads values (room central demand,
 * indicative range min/max, object totals). Rounding happens ONLY here, in
 * the UI — raw engineering values (demandW, ranges, totals) are never
 * mutated by this helper.
 *
 * Rules:
 *   < 1000 W  -> whole W (Math.round), e.g. 915.705 -> 916 Вт
 *   >= 1000 W -> kW with at most 2 decimals, e.g. 13560 -> 13.56 кВт
 */
function demandDisplay(demandW: number | null | undefined, _status?: string): string {
  // null NEVER means 0 W — show an honest dash instead of a fabricated zero.
  return formatPower(demandW);
}

/** Range presentation: normal spaces around the dash (916 Вт – 1.70 кВт). */
function rangeDisplay(range: { min: number; max: number } | null | undefined): string {
  if (!range) return '';
  return `${demandDisplay(range.min)} – ${demandDisplay(range.max)}`;
}

/** Small Phase 3 summary card in the Review step. */
function LoadsSummary({
  project,
  loadState,
  onOpen,
}: {
  project: BuildingProject;
  loadState: BuildingLoadState | null;
  onOpen: () => void;
}) {
  const loads = loadState?.loads || project.loads || null;
  const status = loads ? (loadState?.isStale ? 'stale' : loads.status) : 'not_calculated';
  const label =
    status === 'not_calculated'
      ? 'не рассчитаны'
      : status === 'stale'
        ? 'устарели (требуется перерасчёт)'
        : loadStatusLabel(status);
  return (
    <div className="bp-card">
      <div className="bp-sum">
        <strong>Нагрузки</strong>
        <span>{label}</span>
        {loads ? (
          <span style={{ fontSize: 14 }}>
            {HEAT_MARK}{demandDisplay(heatingCapacity(loads.heatingDemandW, heatingReserveRatio(loads.mode))?.requiredW, status)}
            {heatingReserveRatio(loads.mode) > 0 && loads.heatingDemandW != null ? ` (с запасом ${Math.round(heatingReserveRatio(loads.mode) * 100)}%)` : ''}
            {' · '}{COOL_MARK}{demandDisplay(loads.coolingDemandW, status)}
            {' · '}{loadModeRussianLabel(loads.mode)}
          </span>
        ) : (
          <span className="bp-muted" style={{ fontSize: 14 }}>Тепловая и холодильная нагрузка объекта ещё не рассчитаны.</span>
        )}
      </div>
      {project.status === 'systems_configured' && (
        <button type="button" className="bp-btn" onClick={onOpen}>Нагрузки</button>
      )}
    </div>
  );
}

/** Full Loads stage: mode choice, honest method status, calculation, room cards. */
function LoadsPanel({
  project,
  loadState,
  loadMode,
  setLoadMode,
  onCalculate,
  onOpenMissing,
  towelOverrides,
}: {
  project: BuildingProject;
  loadState: BuildingLoadState | null;
  loadMode: BuildingLoadMode;
  setLoadMode: (mode: BuildingLoadMode) => void;
  onCalculate: (mode: BuildingLoadMode) => void;
  onOpenMissing: (roomId: string, sectionKey: string) => void;
  towelOverrides: TowelWarmerOverrides;
}) {
  if (!loadState) {
    return (
      <section className="bp-grid">
        <div className="bp-card">
          <strong>Нагрузки</strong>
          <div className="bp-muted">Загрузка…</div>
        </div>
      </section>
    );
  }

  const { prerequisites, gate, loads, isStale, methodStatus } = loadState;

  if (!prerequisites.objectConfirmed || !prerequisites.systemsConfirmed) {
    return (
      <section className="bp-grid">
        <div className="bp-card">
          <strong>Нагрузки</strong>
          <div className="bp-alert">
            Расчёт нагрузок доступен после подтверждения объекта и инженерных систем.
            Сначала подтвердите системы на этапе «Проверка».
          </div>
        </div>
      </section>
    );
  }

  if (prerequisites.systemsStale) {
    return (
      <section className="bp-grid">
        <div className="bp-card">
          <strong>Нагрузки</strong>
          <div className="bp-alert">
            Системы были изменены после подтверждения. Подтвердите системы заново, чтобы рассчитать нагрузки.
          </div>
          {loads && (
            <div className="bp-muted" style={{ marginTop: 8 }}>
              Предыдущий расчёт сохранён как исторический: {HEAT_MARK}{demandDisplay(loads.heatingDemandW, loads.status)} · {COOL_MARK}{demandDisplay(loads.coolingDemandW, loads.status)} · {loadStatusLabel(loads.status)} ({loads.calculatedAt ? new Date(loads.calculatedAt).toLocaleString() : ''})
            </div>
          )}
        </div>
      </section>
    );
  }

  const svcChoice = choiceFromServices(project.systemsConfiguration?.requestedServices ?? []);
  const requestedServices = project.systemsConfiguration?.requestedServices ?? [];
  const steadyStateMissing = buildProjectMissingSummary(project, { requestedServices });
  const physicalInputsReady = loadMode !== 'steady_state' || steadyStateMissing.totalMissing === 0;
  const storedLoadPhysicallyComplete = loads?.mode !== 'steady_state' || steadyStateMissing.totalMissing === 0;
  const method = loadMode === 'steady_state' ? methodStatus.steadyState : methodStatus[loadMode];
  const modeLabel = loadModeRussianLabel(loadMode);
  const modeHint =
    loadMode === 'quick'
      ? 'Предварительная инженерная оценка нагрузки. Не заменяет полный теплотехнический расчёт и не является подбором мощности конкретного оборудования.'
      : loadMode === 'steady_state'
        ? 'Физический расчёт теплопередачи, воздушной нагрузки, солнечных и внутренних теплопритоков с утверждёнными профилями.'
        : 'Профессиональный расчёт — ограничен.';

  return (
    <section className="bp-grid">
      <div className="bp-card">
        <h2 className="cfg-section-title">Нагрузки</h2>
        <div className="bp-muted">Проектируем: {serviceChoiceLabel(svcChoice)}</div>

        <div className="bp-nav" style={{ marginTop: 6 }}>
          <div className="cfg-seg" role="group" aria-label="Метод расчёта" style={{ flex: '1 1 100%' }}>
            {primaryLoadModes(loadState.availableModes).map((m) => (
              <button key={m} type="button" className="cfg-seg-btn" aria-pressed={loadMode === m} onClick={() => setLoadMode(m)}>{loadModePrimaryLabel(m)}</button>
            ))}
          </div>
          {legacyLoadModes(loadState.availableModes).length > 0 && (
            <details>
              <summary className="bp-muted" style={{ cursor: 'pointer', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Другие методы расчёта (устаревшие)</summary>
              <div className="bp-nav" style={{ marginTop: 4 }}>
                {legacyLoadModes(loadState.availableModes).map((m) => (
                  <button key={m} type="button" className={`bp-chip${loadMode === m ? ' on' : ''}`} onClick={() => setLoadMode(m)}>{loadModePrimaryLabel(m)}</button>
                ))}
              </div>
            </details>
          )}
        </div>

        {loadMode === 'steady_state' && (
          <MissingInputSummary
            project={project}
            requestedServices={requestedServices}
            onNavigate={onOpenMissing}
          />
        )}

        <div className="bp-nav" style={{ marginTop: 8 }}>
          <button type="button" className="bp-btn pri" disabled={!gate.ok || !physicalInputsReady} onClick={() => onCalculate(loadMode)}>
            {loads ? 'Пересчитать' : 'Рассчитать нагрузки'}
          </button>
        </div>
        {!gate.ok && gate.message && <div className="bp-muted" style={{ fontSize: 14 }}>{gate.message}</div>}
        {gate.ok && !physicalInputsReady && <div className="bp-alert" style={{ fontSize: 14 }}>Нужно уточнить данные помещения перед профессиональным расчётом.</div>}

        {loads && storedLoadPhysicallyComplete && <PrimaryLoadResult loads={loads} />}
        {loads && storedLoadPhysicallyComplete && (
          <RoomResultsList loads={loads} towelWarmers={resolveProjectTowelWarmers(project, towelOverrides)} />
        )}
        <EquipmentSpecPanel
          project={project}
          loads={loads && storedLoadPhysicallyComplete && !isStale ? loads : null}
          towelWarmers={resolveProjectTowelWarmers(project, towelOverrides)}
          onAddToCart={(items) => {
            // loaded on use: the cart store touches localStorage at import time (keeps this module importable in tests)
            void import('../../../store/useStore').then(({ useStore }) => {
              const addToCart = useStore.getState().addToCart;
              for (const { quantity, ...item } of items) addToCart(item, quantity);
            });
          }}
        />
        {loads && !storedLoadPhysicallyComplete && (
          <div className="bp-alert" style={{ marginTop: 8 }}>
            <strong>Сохранённый результат — исторический и физически неполный.</strong>
            <div>{HEAT_MARK}{demandDisplay(loads.heatingDemandW, loads.status)} · {COOL_MARK}{demandDisplay(loads.coolingDemandW, loads.status)}. После уточнения границ помещения выполните перерасчёт.</div>
          </div>
        )}
        {/* Shown only when the server actually returned a quality assessment
            (the running server does not produce it yet). */}
        {loads?.engineeringQuality && <EngineeringQualityPanel loads={loads} rooms={project.rooms} />}

        {/* diagnostic dump — collapsed so the decision/action stays on top */}
        <details className="bp-more" style={{ marginTop: 8 }}>
          <summary>Технические подробности расчёта</summary>
          <div className="bp-grid" style={{ marginTop: 6 }}>
            <div><strong>{modeLabel}</strong> — {modeHint}</div>

            {method?.status === 'limited' && (
              <div className="bp-alert">
                <div><strong>Метод численного расчёта ещё не утверждён.</strong></div>
                <div style={{ fontSize: 14, opacity: 0.9 }}>{method.reason}</div>
                {method.missingInputs?.length > 0 && (
                  <details style={{ marginTop: 4 }}>
                    <summary className="bp-muted" style={{ cursor: 'pointer', fontSize: 14 }}>Подробности</summary>
                    <ul style={{ fontSize: 14, margin: '6px 0 0', paddingLeft: 18 }}>
                      {friendlyMissingList(method.missingInputs).map((item) => <li key={item.title}>{item.title} <span style={{ opacity: 0.72 }}>— {item.action}</span></li>)}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {method?.status === 'active' && loadMode === 'quick' && (
              <div style={{ fontSize: 14 }}>
                Климат подтверждён по официальному нормативу ՀՀՇՆ 22-01-2024 для регионов:{' '}
                {(method as { supportedRegions?: string[] }).supportedRegions?.length
                  ? (method as { supportedRegions?: string[] }).supportedRegions!.join(', ')
                  : '—'}
                . Для остальных регионов численный результат недоступен (нет однозначного официального климатического пункта).
              </div>
            )}

            {isStale && loads && (
              <div className="bp-alert">
                <strong>Расчёт устарел</strong> — объект или системы были изменены. Выполните перерасчёт.
                <div className="bp-muted" style={{ fontSize: 14 }}>
                  Предыдущий результат (исторический): {HEAT_MARK}{demandDisplay(loads.heatingDemandW, loads.status)} · {COOL_MARK}{demandDisplay(loads.coolingDemandW, loads.status)} · {loadStatusLabel(loads.status)}
                </div>
              </div>
            )}

            {loads && (
              <>
                <div className="bp-sum">
                  <span>Статус: <strong className={loads.status === 'calculated' ? 'text-ok' : undefined}>{loadStatusLabel(loads.status)}</strong></span>
                  <span>Метод: <strong className="text-primary/80">{methodDisplayName(loads.methodId)}</strong> <span className="text-fg-muted">({technicalDetailsKey(loads.methodId, loads.methodVersion)})</span></span>
                  <span>Ревизия объекта: <strong>{loads.buildingRevisionAtCalculation}</strong> · Систем: <strong>{loads.systemsRevisionAtCalculation}</strong></span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 24px', fontSize: 13 }}>
                  <div>
                    {HEAT_MARK}Отопление (без запаса): <strong className="text-primary">{demandDisplay(loads.heatingDemandW, loads.status)}</strong>
                    {loads.heatingRangeW && <div className="text-fg-muted" style={{ paddingLeft: 14 }}>ориентир {rangeDisplay(loads.heatingRangeW)}</div>}
                  </div>
                  <div>
                    {COOL_MARK}Охлаждение: <strong className="text-sky-300">{demandDisplay(loads.coolingDemandW, loads.status)}</strong>
                    {loads.coolingRangeW && <div className="text-fg-muted" style={{ paddingLeft: 14 }}>ориентир {rangeDisplay(loads.coolingRangeW)}</div>}
                  </div>
                </div>
                {loads.climateLocationLabel && (
                  <div style={{ fontSize: 14 }}>
                    <div>Климатический пункт: {loads.climateLocationLabel}</div>
                    {loads.climateDatasetId && <div className="text-fg-muted">Набор данных: {loads.climateDatasetId} v{loads.climateDatasetVersion}</div>}
                  </div>
                )}
                {(loads.partialHeatingDemandW != null || loads.partialCoolingDemandW != null) && (
                  <div style={{ fontSize: 14, marginTop: 4 }}>
                    Частичная сумма (не является полной расчётной нагрузкой): {HEAT_MARK}{demandDisplay(loads.partialHeatingDemandW, 'calculated')} · {COOL_MARK}{demandDisplay(loads.partialCoolingDemandW, 'calculated')}
                  </div>
                )}
                {loads.warnings?.length > 0 && (
                  <div className="bp-muted text-warn" style={{ marginTop: 6 }}>
                    {loads.warnings.map((w, i) => <div key={`lw-${i}`} style={{ fontSize: 14 }}>⚠ {unmaskTechnicalString(w)}</div>)}
                  </div>
                )}
                {loads.missingInputs?.length > 0 && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 14 }}>Подробности (не хватает для численного расчёта)</summary>
                    <ul style={{ fontSize: 14, margin: '4px 0 0', paddingLeft: 18 }}>
                      {friendlyMissingList(loads.missingInputs).map((item) => (
                        <li key={item.debugCode}>{item.title} <span style={{ opacity: 0.72 }}>— {item.action}</span></li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}

function MissingInputSummary({ project, requestedServices, onNavigate }: {
  project: BuildingProject;
  requestedServices: Array<'heating' | 'cooling'>;
  onNavigate: (roomId: string, sectionKey: string) => void;
}) {
  const summary = buildProjectMissingSummary(project, { requestedServices });
  if (summary.totalMissing === 0) {
    return (
      <div className="bp-card" style={{ marginTop: 8 }}>
        <div className="bp-ok">✓ Данных достаточно для выполнения расчёта</div>
      </div>
    );
  }
  return (
    <div className="bp-card" style={{ marginTop: 8 }}>
      <strong>Нужно уточнить данные помещения</strong>
      <div className="bp-muted">Не хватает {summary.totalMissing} {ruCount(summary.totalMissing, 'параметр', 'параметра', 'параметров')} для физически полного профессионального расчёта.</div>
      <div className="bp-grid">
        {summary.rooms.map((r) => (
          <details key={r.roomId}>
            <summary style={{ cursor: 'pointer' }}>{roomIcon(r.roomType)} {r.roomName} — {r.count}</summary>
            <div className="bp-grid" style={{ marginTop: 4 }}>
              {r.items.map((item) => (
                <button key={`${item.key}-${item.roomId}`} type="button" className="bp-chip" style={{ textAlign: 'left', width: '100%', minHeight: 36 }}
                  onClick={() => onNavigate(r.roomId, item.sectionKey)}>
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  {item.action ? <span className="bp-muted" style={{ display: 'block' }}>{item.action}</span> : null}
                </button>
              ))}
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}

function loadMethodNumber(room: RoomLoadResult, service: 'heating' | 'cooling', key: string): number | null {
  const value = room[service].methodInputs?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sumObjectComponent(
  loads: BuildingLoadCalculation,
  service: 'heating' | 'cooling',
  read: (room: RoomLoadResult) => number | null | undefined,
): number | null {
  const eligible = loads.roomResults.filter((room) => room[service].status === 'calculated');
  if (eligible.length === 0) return null;
  const values = eligible.map(read);
  return values.every((value) => typeof value === 'number' && Number.isFinite(value))
    ? values.reduce<number>((sum, value) => sum + Number(value), 0)
    : null;
}

export function PrimaryLoadResult({ loads }: { loads: BuildingLoadCalculation }) {
  const heating = {
    transmission: sumObjectComponent(loads, 'heating', (room) => loadMethodNumber(room, 'heating', 'transmissionHeatingW')),
    air: sumObjectComponent(loads, 'heating', (room) => loadMethodNumber(room, 'heating', 'airHeatingW')),
  };
  const cooling = {
    transmission: sumObjectComponent(loads, 'cooling', (room) => loadMethodNumber(room, 'cooling', 'transmissionCoolingW')),
    air: sumObjectComponent(loads, 'cooling', (room) => loadMethodNumber(room, 'cooling', 'airCoolingW')),
    solar: sumObjectComponent(loads, 'cooling', (room) => loadMethodNumber(room, 'cooling', 'solarCoolingW')),
    internal: sumObjectComponent(loads, 'cooling', (room) => loadMethodNumber(room, 'cooling', 'internalCoolingW')),
  };
  const hasBreakdown = [...Object.values(heating), ...Object.values(cooling)].some((value) => value != null);
  const summary = buildLoadResultSummary(loads);
  const reservePct = Math.round(summary.reserveRatio * 100);
  return (
    <div className="bp-card" style={{ marginTop: 8 }}>
      <div className={loads.status === 'calculated' ? 'bp-ok' : 'bp-muted'} style={{ marginBottom: 5 }}>
        {loads.status === 'calculated' ? '✓ Расчёт выполнен' : 'Численный расчёт выполнен частично'}
      </div>
      <dl className="bp-kv">
        <dt>Общая площадь</dt>
        <dd>{summary.totalAreaM2 != null ? `${formatArea(summary.totalAreaM2)} м²` : '—'}</dd>
        {summary.showHeating && (
          <>
            <dt>{HEAT_MARK}Требуемая мощность отопления</dt>
            <dd className="text-primary">{demandDisplay(summary.heating?.requiredW, loads.status)}</dd>
            {summary.heating && summary.reserveRatio > 0 && (
              <>
                <dt className="bp-kv-sub">в том числе запас {reservePct}%</dt>
                <dd className="bp-kv-sub">{demandDisplay(summary.heating.reserveW)}</dd>
              </>
            )}
          </>
        )}
        {summary.showCooling && (
          <>
            <dt>{COOL_MARK}Требуемая мощность охлаждения</dt>
            <dd className="text-sky-300">{demandDisplay(summary.coolingW, loads.status)}</dd>
          </>
        )}
        <dt>Количество помещений</dt>
        <dd>{summary.roomCount}</dd>
      </dl>
      {summary.heating && summary.reserveRatio > 0 && (
        <div className="bp-muted" style={{ fontSize: 14 }}>
          Расчётная потребность в тепле {demandDisplay(summary.heating.baseW)} + запас {reservePct}% на неточность исходных данных
          предварительного расчёта. Запас — рекомендация OhmX, а не требование норматива. К охлаждению запас не добавляется.
        </div>
      )}
      {hasBreakdown && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, opacity: 0.9 }}>Как получен результат</summary>
          <div className="bp-grid" style={{ marginTop: 6 }}>
            {heating.transmission != null && heating.air != null && (
              <div style={{ fontSize: 14 }}>
                <strong>Отопление</strong>
                <div>Ограждения {demandDisplay(heating.transmission)} + Воздух {demandDisplay(heating.air)} = <strong>{demandDisplay(loads.heatingDemandW, loads.status)}</strong></div>
              </div>
            )}
            {cooling.transmission != null && cooling.air != null && cooling.solar != null && cooling.internal != null && (
              <div style={{ fontSize: 14 }}>
                <strong>Охлаждение</strong>
                <div>Ограждения {demandDisplay(cooling.transmission)} + Воздух {demandDisplay(cooling.air)} + Солнце {demandDisplay(cooling.solar)} + Внутренние теплопритоки {demandDisplay(cooling.internal)} = <strong>{demandDisplay(loads.coolingDemandW, loads.status)}</strong></div>
              </div>
            )}
          </div>
        </details>
      )}
      <div className="bp-muted" style={{ fontSize: 14 }}>
        {loadModeRussianLabel(loads.mode)}
      </div>
    </div>
  );
}

function formatArea(m2: number): string {
  return String(Number(m2.toFixed(1)));
}

function ExplanationBlock({ title, explanation }: { title: string; explanation: RoomExplanation }) {
  return (
    <div className="bp-explain">
      <strong>{title}</strong>
      <ol>
        {explanation.steps.map((step, i) => <li key={i}>{step}</li>)}
      </ol>
      {explanation.refine.length > 0 && (
        <div className="bp-muted">Для более точного результата укажите: {explanation.refine.join('; ')}.</div>
      )}
      {explanation.note && <div className="bp-muted">{explanation.note}</div>}
    </div>
  );
}

/** Customer room list: every room collapsed, expandable independently. */
export function RoomResultsList({ loads, towelWarmers }: { loads: BuildingLoadCalculation; towelWarmers: TowelWarmerSelection[] }) {
  const summary = buildLoadResultSummary(loads);
  const byId = new Map(loads.roomResults.map((room) => [room.roomId, room]));
  const totals = towelWarmerTotals(towelWarmers);
  return (
    <div className="bp-card bp-room-results">
      <strong>Помещения</strong>
      {summary.rooms.map((item) => {
        const room = byId.get(item.roomId)!;
        const heatingExplanation = summary.showHeating ? explainRoomHeating(room, loads.mode) : null;
        const coolingRaw = summary.showCooling ? explainRoomCooling(room, loads.mode) : null;
        // Same "what to specify" hints are listed once per room.
        const coolingExplanation = coolingRaw && heatingExplanation
          ? { ...coolingRaw, refine: coolingRaw.refine.filter((hint) => !heatingExplanation.refine.includes(hint)) }
          : coolingRaw;
        const towel = towelWarmers.find((t) => t.roomId === item.roomId) || null;
        const head = [
          item.roomName,
          item.areaM2 != null ? `${formatArea(item.areaM2)} м²` : null,
          summary.showHeating ? `Отопление: ${item.heating ? demandDisplay(item.heating.requiredW) : serviceStatusLabel(item.heatingStatus)}` : null,
          summary.showCooling && item.coolingW != null ? `Охлаждение: ${demandDisplay(item.coolingW)}` : null,
        ].filter(Boolean).join(' — ');
        return (
          <details key={item.roomId} className="bp-room-result">
            <summary>
              {item.floorLabel ? <span className="bp-muted">{item.floorLabel} · </span> : null}
              {roomIcon(item.roomType)} {head}
            </summary>
            <div className="bp-grid" style={{ marginTop: 6 }}>
              {heatingExplanation && <ExplanationBlock title="Как рассчитана мощность отопления" explanation={heatingExplanation} />}
              {summary.showHeating && !heatingExplanation && (
                <div className="bp-muted">Отопление: {serviceStatusLabel(item.heatingStatus)}.</div>
              )}
              {coolingExplanation && <ExplanationBlock title="Как рассчитана мощность охлаждения" explanation={coolingExplanation} />}
              {towel && (
                <div className="bp-explain">
                  <strong>Полотенцесушитель</strong>
                  <div>{towelWarmerKindLabel(towel.kind)[0].toUpperCase() + towelWarmerKindLabel(towel.kind).slice(1)}, {towel.quantity} шт.{towel.kindSource === 'default' ? ' Тип выбран по умолчанию.' : ''}</div>
                  <div className="bp-muted">
                    Это оборудование, а не дополнительные теплопотери: расчётная мощность помещения из-за него не меняется.
                    Мощность конкретной модели пока не известна, поэтому она не вычитается из нагрузки основных приборов отопления.
                    Изменить тип, количество или убрать можно на шаге «Системы».
                  </div>
                </div>
              )}
            </div>
          </details>
        );
      })}
      {towelWarmers.length > 0 && (
        <div className="bp-explain">
          <strong>Оборудование (предварительно)</strong>
          <ul>
            {totals.water > 0 && <li>Полотенцесушитель водяной — {totals.water} шт.</li>}
            {totals.electric > 0 && <li>Полотенцесушитель электрический — {totals.electric} шт.</li>}
          </ul>
          <div className="bp-muted">{towelWarmers.map((t) => `${t.roomName}: ${towelWarmerKindLabel(t.kind)} × ${t.quantity}`).join(' · ')}</div>
        </div>
      )}
      {loads.climateLocationLabel && (
        <div className="bp-muted" style={{ fontSize: 14 }}>Климат: {climateLabelRu(loads.climateLocationLabel)}</div>
      )}
    </div>
  );
}
