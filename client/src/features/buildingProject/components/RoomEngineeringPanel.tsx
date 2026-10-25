/**
 * Phase 3.2g/3.2K — Room-level smart engineering input collection.
 *
 * Consumer-language inputs (no U-value / ACH / SHGC jargon in the main flow).
 * Resolution order REUSE → DERIVE → PROFILE → QUESTION → ADVANCED → MISSING:
 *   - constructionTier / airtightnessClass / shadingProfile are stored as ENUM
 *     choices — the backend engine resolves them to numbers from the approved
 *     Phase 3.2B profiles (CONSTRUCTION_U_VALUES / AIRTIGHTNESS_ACH_BASE / SHGC /
 *     shading) with provenance. The client never hardcodes a value.
 *   - "Не знаю" leaves the enum null → the engine reports missing (never a
 *     fabricated default).
 *   - Advanced panel carries explicit numbers (U, SHGC, ACH50, …) which take
 *     precedence over the profile enums on the backend.
 *
 * Phase 3.2K — progressive disclosure: the panel is split into collapsible
 * sections (Ограждения / Окна / Воздух / Люди / Расширенные). Collapsed
 * sections show a compact summary; Advanced is collapsed by default. Chip
 * state transitions are delegated to pure helpers in `engineeringSelections.ts`
 * so the exact `updateRoom` payload is unit-testable without a renderer.
 */
import { useEffect, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import type {
  AirtightnessClass,
  BuildingProject,
  BuildingRoom,
  BuildingRoomInput,
  ConstructionTier,
  EnvelopeElement,
  ShadingProfile,
  VentilationBalance,
  WindowOrientation,
} from '../types';
import {
  getRoomOccupancySuggestion,
  readinessItemForSection,
  readinessStatusLabel,
  type SteadyStateReadiness,
} from '../utils/smartLoadUx';
import {
  EMPTY_AIR,
  EMPTY_ENVELOPE,
  EMPTY_GAINS,
  baseElement,
  selectAirtightnessClass,
  selectAirNumber,
  selectDoor,
  selectFloorTier,
  selectGainNumber,
  selectOccupancyCount,
  selectRoofTier,
  selectVentilationBalance,
  selectWallTier,
  selectWallUValue,
  selectWindowOrientation,
  selectWindowShading,
  selectWindowTier,
  sparseAirPatch,
  sparseEnvelopePatch,
  sparseGainsPatch,
} from '../utils/engineeringSelections';
import {
  resolveRoomPhysicalBoundaries,
  type PhysicalSpaceAbove,
  type PhysicalSpaceBelow,
} from '../utils/professionalCompleteness';
import { focusNextEntry, formatQuickNumber, parseQuickNumber, QUICK_ENTRY_ATTR } from '../utils/quickEntry';
import {
  propagateAirtightness,
  propagateBoundaryTier,
  propagateSpaceAbove,
  propagateSpaceBelow,
  propagateWallTier,
  type RoomPatch,
} from '../utils/roomPropagation';

const TIER_LABEL: Record<ConstructionTier, string> = { poor: 'Слабое', average: 'Обычное', good: 'Хорошее', high_performance: 'Пассивное' };
const TIERS: ConstructionTier[] = ['poor', 'average', 'good', 'high_performance'];
const TIER_HINT = 'Слабое — без утепления, старый дом · Обычное — типовое утепление · Хорошее — утеплённый фасад, современный дом · Пассивное — энергоэффективный (пассивный) дом';
const SHADING_LABEL: Record<ShadingProfile, string> = { none: 'Нет', interior: 'Шторы/жалюзи', exterior: 'Наружные' };
const SHADINGS: ShadingProfile[] = ['none', 'interior', 'exterior'];
const VENT_LABEL: Record<VentilationBalance, string> = { none: 'Нет', natural: 'Естественная', supply_only: 'Приточная', exhaust_only: 'Вытяжная', balanced: 'Приточно-вытяжная', unknown: 'Не знаю' };
const VENTILATIONS: VentilationBalance[] = ['natural', 'supply_only', 'exhaust_only', 'balanced', 'none'];
const AIR_LABEL: Record<AirtightnessClass, string> = { poor: 'Старое', average: 'Обычное', good: 'Новое герметичное', high: 'Очень герметичное' };
const AIRS: AirtightnessClass[] = ['poor', 'average', 'good', 'high'];
const ORIENTATION_LABEL: Record<WindowOrientation, string> = { N: 'Север (С)', NE: 'СВ', E: 'Восток (В)', SE: 'ЮВ', S: 'Юг (Ю)', SW: 'ЮЗ', W: 'Запад (З)', NW: 'СЗ' };
const ORIENTATIONS: WindowOrientation[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const ABOVE_LABEL: Record<PhysicalSpaceAbove, string> = {
  conditioned_space: 'отапливаемый этаж', outdoors: 'кровля/улица', unheated_attic: 'неотапливаемый чердак',
};
const BELOW_LABEL: Record<PhysicalSpaceBelow, string> = {
  conditioned_space: 'отапливаемый этаж', ground: 'грунт', unheated_space: 'неотапливаемое пространство',
};

// Accepts "2,5", "2.5" and simple sums/products ("4,2+3,6"). Empty → null
// (never 0); anything unparseable → null, exactly like the previous Number().
function num(v: string): number | null {
  const r = parseQuickNumber(v, { allowZero: true });
  return r.status === 'ok' ? r.value : null;
}

// Large decimal keyboard on phones; Enter jumps to the next empty field.
const QUICK_INPUT_PROPS = {
  type: 'text',
  inputMode: 'decimal',
  enterKeyHint: 'next',
  autoComplete: 'off',
  [QUICK_ENTRY_ATTR]: '',
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); focusNextEntry(e.currentTarget); }
  },
} as const;

// Inline validation for uncontrolled numeric inputs: an invalid entry is
// flagged and NOT saved (the stored value stays as it was).
function numberBlur(commit: (v: string) => void) {
  return (e: FocusEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    const r = parseQuickNumber(el.value, { allowZero: true });
    if (r.status === 'invalid') {
      el.setAttribute('aria-invalid', 'true');
      el.title = r.message;
      return;
    }
    el.removeAttribute('aria-invalid');
    el.title = '';
    if (r.status === 'ok' && r.expression) el.value = formatQuickNumber(r.value);
    commit(el.value);
  };
}
function countNum(v: string): number | null {
  const n = num(v);
  return n != null && Number.isInteger(n) ? n : null;
}
function numStr(v: number | null): string { return formatQuickNumber(v); }

// Mirrors the backend outdoor-air model: fans (supply/exhaust/balanced) need an
// explicit ventilation flow (m³/h); natural/none resolve from airtightness only.
function airFlowRequiredByMode(balance: VentilationBalance | null): boolean {
  return balance === 'supply_only' || balance === 'exhaust_only' || balance === 'balanced' || balance === 'unknown';
}

export type PanelSectionKey = 'envelope' | 'windows' | 'air' | 'internal' | 'advanced';

function sectionSummary(project: BuildingProject, room: BuildingRoom, objectType: string): Record<PanelSectionKey, string> {
  const env = room.envelope ?? EMPTY_ENVELOPE;
  const air = room.air ?? EMPTY_AIR;
  const gains = room.internalGains ?? EMPTY_GAINS;
  const wall = env.wallElements[0];
  const boundaries = resolveRoomPhysicalBoundaries(project, room);

  const envParts: string[] = [];
  const externalWallCount = room.extras?.geometry?.externalWallCount;
  if (externalWallCount == null) envParts.push('Наружные стороны · не указано');
  else envParts.push(`Наружные стороны · ${externalWallCount}`);
  if (wall?.constructionTier) envParts.push(`Стены · ${TIER_LABEL[wall.constructionTier]}`);
  else if (wall) envParts.push('Стены · не задано');
  envParts.push(`Сверху · ${boundaries.above ? ABOVE_LABEL[boundaries.above] : 'не указано'}`);
  envParts.push(`Снизу · ${boundaries.below ? BELOW_LABEL[boundaries.below] : 'не указано'}`);
  if (env.doorElements.length) envParts.push('Наружная дверь · есть');
  else if (room.extras?.geometry?.externalDoorCount === 0) envParts.push('Наружная дверь · нет');
  else envParts.push('Наружная дверь · не указано');

  const windows = env.windowElements;
  const orients = [...new Set(windows.map((w) => (w.orientation ? ORIENTATION_LABEL[w.orientation] : null)).filter(Boolean))] as string[];
  const windowsSummary = windows.length
    ? `${windows.length} · ${orients.length ? orients.join('/') : 'сторона не задана'}`
    : room.extras?.windows?.count === 0
      ? 'Окон нет · подтверждено'
      : 'Не указано, есть окна или нет';

  const airSummary = air.ventilationBalance ? `${VENT_LABEL[air.ventilationBalance]}` : 'Не задано';
  const occ = gains.occupancy;
  let peopleSummary = 'Не задано';
  if (occ != null) {
    peopleSummary = `Обычно ${occ}`;
  } else {
    const s = getRoomOccupancySuggestion(room.roomType, objectType);
    if (s) peopleSummary = s.zeroOccupancy ? 'Обычно 0' : `Обычно ${s.suggestedPeople}`;
  }

  return {
    envelope: envParts.join(' · ') || 'Не задано',
    windows: windowsSummary,
    air: airSummary,
    internal: peopleSummary,
    advanced: '',
  };
}

interface Props {
  project: BuildingProject;
  room: BuildingRoom;
  disabled: boolean;
  objectType: string;
  defaultCeilingHeightM: number;
  onPatch: (patch: BuildingRoomInput) => void;
  /** Saves building-wide answers into other rooms (only fields that are still empty there). */
  onPropagate?: (patches: RoomPatch[]) => void;
  readiness?: SteadyStateReadiness | null;
  requestedServices?: Array<'heating' | 'cooling'>;
  openSection?: PanelSectionKey | null;
  onSectionToggle?: (key: PanelSectionKey) => void;
  onNext?: (key: PanelSectionKey) => void;
  canNext?: (key: PanelSectionKey) => boolean;
  focusSectionKey?: string | null;
  onFocusConsumed?: () => void;
}

export function RoomEngineeringPanel({
  project,
  room,
  disabled,
  objectType,
  defaultCeilingHeightM,
  onPatch,
  onPropagate,
  readiness,
  requestedServices = [],
  openSection,
  onSectionToggle,
  onNext,
  canNext,
  focusSectionKey,
  onFocusConsumed,
}: Props) {
  const envelope = room.envelope ?? EMPTY_ENVELOPE;
  const air = room.air ?? EMPTY_AIR;
  const gains = room.internalGains ?? EMPTY_GAINS;
  const height = room.extras?.geometry?.ceilingHeightM ?? defaultCeilingHeightM;
  const boundaries = resolveRoomPhysicalBoundaries(project, room);

  // Auto-fill of other rooms: done automatically when they are on the same level, otherwise offered as a button.
  const [shareNote, setShareNote] = useState<{ section: PanelSectionKey; text: string; pending: RoomPatch[] | null } | null>(null);
  useEffect(() => { setShareNote(null); }, [room.id]);
  const share = (section: PanelSectionKey, what: string, patches: RoomPatch[], certain = true) => {
    if (!onPropagate || !patches.length) return;
    if (certain) {
      onPropagate(patches);
      setShareNote({ section, text: `${what}: также заполнено в ${patches.length} ${roomsWord(patches.length)}, где не было указано.`, pending: null });
    } else {
      setShareNote({ section, text: `${what}: этаж помещений не указан — применить ещё к ${patches.length} ${roomsWordDative(patches.length)} без данных?`, pending: patches });
    }
  };
  const [internalOpenSection, setInternalOpenSection] = useState<PanelSectionKey | null>('envelope');
  const sectionRefs = useRef<Record<PanelSectionKey, HTMLDivElement | null>>({ envelope: null, windows: null, air: null, internal: null, advanced: null });
  const currentOpenSection = openSection === undefined ? internalOpenSection : openSection;

  const patchEnvelope = (next: typeof envelope) => {
    const patch = sparseEnvelopePatch(envelope, next);
    if (Object.keys(patch).length > 0) onPatch({ envelope: patch });
  };
  const patchAir = (next: typeof air) => {
    const patch = sparseAirPatch(air, next);
    if (Object.keys(patch).length > 0) onPatch({ air: patch as BuildingRoomInput['air'] });
  };
  const patchGains = (next: typeof gains) => {
    const patch = sparseGainsPatch(gains, next);
    if (Object.keys(patch).length > 0) onPatch({ internalGains: patch as BuildingRoomInput['internalGains'] });
  };

  // Single-element categories.
  const wall = envelope.wallElements[0] ?? null;
  const door = envelope.doorElements[0] ?? null;
  const roof = envelope.roofElements[0] ?? null;
  const floor = envelope.floorElements[0] ?? null;

  const setWall = (tier: ConstructionTier | null) => {
    patchEnvelope(selectWallTier(envelope, tier));
    share('envelope', 'Утепление стен', propagateWallTier(project, room, tier));
  };
  const setExternalWallCount = (value: string) => {
    const count = countNum(value);
    onPatch({
      extras: { ...room.extras, geometry: { ...room.extras.geometry, externalWallCount: count } },
      ...(count === 0 ? { envelope: { wallElements: [] } } : {}),
    });
  };
  const setWallLength = (lengthM: string) => {
    const w = wall ?? baseElement('wall');
    const len = num(lengthM);
    patchEnvelope({ ...envelope, wallElements: [{ ...w, widthM: len, heightM: len != null ? height : null, areaM2: len != null && height ? Math.round(len * height * 100) / 100 : null }] });
  };
  const setWallU = (u: string) => patchEnvelope(selectWallUValue(envelope, num(u)));
  const setDoor = (on: boolean) => {
    const nextEnvelope = selectDoor(envelope, on);
    const envelopePatch = sparseEnvelopePatch(envelope, nextEnvelope);
    onPatch({
      envelope: envelopePatch,
      extras: { ...room.extras, geometry: { ...room.extras.geometry, externalDoorCount: on ? 1 : 0 } },
    });
  };
  const setRoof = (tier: ConstructionTier | null) => {
    patchEnvelope(selectRoofTier(envelope, tier, room.areaM2));
    share('envelope', 'Теплозащита крыши/перекрытия', propagateBoundaryTier(project, room, 'roof', tier));
  };
  const setFloor = (tier: ConstructionTier | null) => {
    patchEnvelope(selectFloorTier(envelope, tier, room.areaM2));
    share('envelope', 'Теплозащита пола', propagateBoundaryTier(project, room, 'floor', tier));
  };
  const setSpaceAbove = (value: PhysicalSpaceAbove | null) => {
    const nextEnvelope = value === 'conditioned_space' ? { ...envelope, roofElements: [] } : envelope;
    const envelopePatch = sparseEnvelopePatch(envelope, nextEnvelope);
    onPatch({
      extras: { ...room.extras, geometry: { ...room.extras.geometry, spaceAbove: value } },
      ...(Object.keys(envelopePatch).length ? { envelope: envelopePatch } : {}),
    });
    const shared = propagateSpaceAbove(project, room, value);
    share('envelope', 'Что над помещением', shared.patches, shared.certain);
  };
  const setSpaceBelow = (value: PhysicalSpaceBelow | null) => {
    const nextEnvelope = value === 'conditioned_space' ? { ...envelope, floorElements: [] } : envelope;
    const envelopePatch = sparseEnvelopePatch(envelope, nextEnvelope);
    onPatch({
      extras: { ...room.extras, geometry: { ...room.extras.geometry, spaceBelow: value } },
      ...(Object.keys(envelopePatch).length ? { envelope: envelopePatch } : {}),
    });
    const shared = propagateSpaceBelow(project, room, value);
    share('envelope', 'Что под помещением', shared.patches, shared.certain);
  };

  const addWindow = () => {
    const next = [...envelope.windowElements, baseElement('window')];
    onPatch({
      envelope: { windowElements: next },
      extras: { ...room.extras, windows: { ...room.extras.windows, count: next.length } },
    });
  };
  const removeWindow = (id: string) => {
    const next = envelope.windowElements.filter((w) => w.elementId !== id);
    onPatch({
      envelope: { windowElements: next },
      extras: { ...room.extras, windows: { ...room.extras.windows, count: next.length > 0 ? next.length : null } },
    });
  };
  const declareNoWindows = () => {
    const explicitNone = room.extras?.windows?.count === 0 && envelope.windowElements.length === 0;
    onPatch({
      envelope: { windowElements: [] },
      extras: {
        ...room.extras,
        windows: {
          ...room.extras.windows,
          count: explicitNone ? null : 0,
          areaM2: explicitNone ? null : 0,
        },
      },
    });
  };

  const setOrientation = (id: string, o: WindowOrientation | null) => patchEnvelope(selectWindowOrientation(envelope, id, o));
  const setWindowTier = (id: string, tier: ConstructionTier | null) => patchEnvelope(selectWindowTier(envelope, id, tier));
  const setWindowShading = (id: string, s: ShadingProfile | null) => patchEnvelope(selectWindowShading(envelope, id, s));
  const setWindowSize = (id: string, field: 'widthM' | 'heightM', v: string) => {
    patchEnvelope({ ...envelope, windowElements: envelope.windowElements.map((x) => (x.elementId === id ? { ...x, [field]: num(v) } : x)) });
  };
  const glazedHint = (w: EnvelopeElement) => (w.widthM && w.heightM ? `≈ ${(w.widthM * w.heightM * 0.8).toFixed(1)} м² остекления` : '');

  const setVent = (b: VentilationBalance | null) => patchAir(selectVentilationBalance(air, b));
  const setAirClass = (c: AirtightnessClass | null) => {
    patchAir(selectAirtightnessClass(air, c));
    share('air', 'Герметичность здания', propagateAirtightness(project, room, c));
  };
  const setOccupancy = (o: string) => patchGains(selectOccupancyCount(gains, num(o)));
  const setGain = (field: 'peopleW' | 'lightingGainW' | 'equipmentGainW' | 'occupantSensibleWPerPerson', v: string) => patchGains(selectGainNumber(gains, field, num(v)));
  const setAirNum = (field: 'ach50' | 'airChangesPerHour' | 'ventilationFlowM3h' | 'infiltrationFlowM3h', v: string) => patchAir(selectAirNumber(air, field, num(v)));

  // Deep-link: open the requested section when a missing-input item is tapped.
  useEffect(() => {
    if (!focusSectionKey) return;
    const map: Record<string, PanelSectionKey> = { envelope: 'envelope', windows: 'windows', air: 'air', internal: 'internal', area: 'envelope', climate: 'envelope' };
    const target = map[focusSectionKey] ?? null;
    if (target) {
      if (onSectionToggle) onSectionToggle(target);
      else setInternalOpenSection(target);
      requestAnimationFrame(() => sectionRefs.current[target]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
    onFocusConsumed?.();
  }, [focusSectionKey, onFocusConsumed, onSectionToggle]);

  const summary = sectionSummary(project, room, objectType);
  const applyPending = () => {
    if (!shareNote?.pending || !onPropagate) return;
    onPropagate(shareNote.pending);
    setShareNote({ ...shareNote, text: `Применено к ${shareNote.pending.length} ${roomsWordDative(shareNote.pending.length)}.`, pending: null });
  };

  const toggle = (key: PanelSectionKey) => {
    const next = currentOpenSection === key ? null : key;
    if (onSectionToggle) onSectionToggle(key);
    else setInternalOpenSection(next);
  };
  const status = (key: PanelSectionKey) => readinessStatusLabel(
    readinessItemForSection(readiness, key === 'advanced' ? 'envelope' : key),
    requestedServices,
  );
  const nextAction = (key: PanelSectionKey) => onNext && (!canNext || canNext(key)) ? () => onNext(key) : undefined;

  return (
    <div className="bp-card" style={{ gap: 8 }}>
      <Section
        sectionKey="envelope"
        title="Ограждения"
        summary={summary.envelope}
        status={status('envelope')}
        open={currentOpenSection === 'envelope'}
        onToggle={() => toggle('envelope')}
        onNext={nextAction('envelope')}
        refCb={(el) => { sectionRefs.current.envelope = el; }}
      >
        <div className="bp-muted">Наружные стены{wall && wall.widthM && height ? ` · ${wall.areaM2 ?? ''} м²` : ''}</div>
        <label className="bp-muted">Сколько сторон помещения выходит наружу?
          <select className="bp-input" disabled={disabled} value={room.extras?.geometry?.externalWallCount ?? ''}
            onChange={(e) => setExternalWallCount(e.target.value)}>
            <option value="">Не указано</option>
            <option value="0">Ни одной</option>
            <option value="1">1 сторона</option>
            <option value="2">2 стороны</option>
            <option value="3">3 стороны</option>
            <option value="4">4 и более</option>
          </select>
        </label>
        {(room.extras?.geometry?.externalWallCount !== 0 || wall) && (
          <>
            <label className="bp-muted">Общая длина наружных стен, м
              <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={0.1} disabled={disabled} defaultValue={numStr(wall?.widthM)}
                onBlur={numberBlur((v) => setWallLength(v))} />
            </label>
            <div className="bp-muted">Утепление наружных стен</div>
            <Chips disabled={disabled} value={wall?.constructionTier ?? null}
              options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))} onSelect={(v) => setWall(v as ConstructionTier | null)} />
            <div className="bp-muted" style={{ fontSize: 14 }}>{TIER_HINT}</div>
          </>
        )}

        <label className="bp-muted">Что находится над помещением?
          <select className="bp-input" disabled={disabled} value={boundaries.above ?? ''}
            onChange={(e) => setSpaceAbove((e.target.value || null) as PhysicalSpaceAbove | null)}>
            <option value="">Не указано</option>
            <option value="conditioned_space">Отапливаемое помещение / этаж</option>
            <option value="outdoors">Кровля непосредственно над помещением</option>
            <option value="unheated_attic">Неотапливаемый чердак</option>
          </select>
        </label>
        {boundaries.above && boundaries.above !== 'conditioned_space' && (
          <>
            <div className="bp-muted">Теплозащита верхнего ограждения</div>
            <Chips disabled={disabled} value={roof?.constructionTier ?? null}
              options={TIERS.map((t) => ({ value: t, label: `Крыша/перекрытие · ${TIER_LABEL[t]}` }))}
              onSelect={(v) => setRoof(v as ConstructionTier | null)} />
          </>
        )}

        <label className="bp-muted">Что находится под помещением?
          <select className="bp-input" disabled={disabled} value={boundaries.below ?? ''}
            onChange={(e) => setSpaceBelow((e.target.value || null) as PhysicalSpaceBelow | null)}>
            <option value="">Не указано</option>
            <option value="conditioned_space">Отапливаемое помещение / этаж</option>
            <option value="ground">Грунт</option>
            <option value="unheated_space">Неотапливаемый подвал / пространство</option>
          </select>
        </label>
        {boundaries.below && boundaries.below !== 'conditioned_space' && (
          <>
            <div className="bp-muted">Теплозащита нижнего ограждения</div>
            <Chips disabled={disabled} value={floor?.constructionTier ?? null}
              options={TIERS.map((t) => ({ value: t, label: `Пол/перекрытие · ${TIER_LABEL[t]}` }))}
              onSelect={(v) => setFloor(v as ConstructionTier | null)} />
          </>
        )}

        <div className="bp-muted">Наружная дверь</div>
        <Chips disabled={disabled} value={door ? 'door' : room.extras?.geometry?.externalDoorCount === 0 ? '__none' : null}
          options={[{ value: '__none', label: 'Нет' }, { value: 'door', label: 'Есть (≈1.9 м²)' }]}
          onSelect={(v) => setDoor(v === 'door')} />
        <ShareNote note={shareNote} section="envelope" disabled={disabled} onApply={applyPending} onDismiss={() => setShareNote(null)} />
      </Section>

      <Section
        sectionKey="windows"
        title="Окна"
        summary={summary.windows}
        status={status('windows')}
        open={currentOpenSection === 'windows'}
        onToggle={() => toggle('windows')}
        onNext={nextAction('windows')}
        refCb={(el) => { sectionRefs.current.windows = el; }}
      >
        <div className="bp-nav">
          {!disabled && <button type="button" className="bp-chip" onClick={addWindow}>+ окно</button>}
          {!disabled && envelope.windowElements.length === 0 && (
            <button type="button"
              className={`bp-chip${room.extras?.windows?.count === 0 ? ' on' : ''}`}
              aria-pressed={room.extras?.windows?.count === 0}
              onClick={declareNoWindows}>Окон нет</button>
          )}
        </div>
        {envelope.windowElements.length === 0 && room.extras?.windows?.count !== 0 && (
          <div className="bp-alert">Не указано, есть окна или нет. Пустой список не считается подтверждением отсутствия окон.</div>
        )}
        {envelope.windowElements.length === 0 && room.extras?.windows?.count === 0 && (
          <div className="bp-ok">Подтверждено: окон в помещении нет.</div>
        )}
        {envelope.windowElements.map((w) => (
          <div key={w.elementId} className="bp-card" style={{ padding: 8, gap: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="bp-muted">Куда выходят окна?</span>
              {!disabled && <button type="button" className="bp-chip" onClick={() => removeWindow(w.elementId)}>✕</button>}
            </div>
            <select className="bp-input" disabled={disabled} value={w.orientation ?? ''} onChange={(e) => setOrientation(w.elementId, (e.target.value || null) as WindowOrientation | null)}>
              <option value="">Не знаю</option>
              {ORIENTATIONS.map((o) => <option key={o} value={o}>{ORIENTATION_LABEL[o]}</option>)}
            </select>
            <div className="bp-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={0.1} placeholder="Ширина, м" disabled={disabled}
                defaultValue={numStr(w.widthM)} onBlur={numberBlur((v) => setWindowSize(w.elementId, 'widthM', v))} />
              <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={0.1} placeholder="Высота, м" disabled={disabled}
                defaultValue={numStr(w.heightM)} onBlur={numberBlur((v) => setWindowSize(w.elementId, 'heightM', v))} />
            </div>
            <span className="bp-muted">{glazedHint(w)}</span>
            <Chips disabled={disabled} value={w.constructionTier ?? null}
              options={TIERS.map((t) => ({ value: t, label: `Окно · ${TIER_LABEL[t]}` }))} onSelect={(v) => setWindowTier(w.elementId, v as ConstructionTier | null)} />
            <Chips disabled={disabled} value={w.shadingProfile ?? null}
              options={SHADINGS.map((s) => ({ value: s, label: SHADING_LABEL[s] }))} onSelect={(v) => setWindowShading(w.elementId, v as ShadingProfile | null)} />
          </div>
        ))}
      </Section>

      <Section
        sectionKey="air"
        title="Воздух"
        summary={summary.air}
        status={status('air')}
        open={currentOpenSection === 'air'}
        onToggle={() => toggle('air')}
        onNext={nextAction('air')}
        refCb={(el) => { sectionRefs.current.air = el; }}
      >
        <div className="bp-muted">Какая вентиляция?</div>
        <Chips disabled={disabled} value={air.ventilationBalance ?? null}
          options={VENTILATIONS.map((v) => ({ value: v, label: VENT_LABEL[v] }))} onSelect={(v) => setVent(v as VentilationBalance | null)} />
        {airFlowRequiredByMode(air.ventilationBalance) && (
          <label className="bp-muted">Производительность вентиляции, м³/ч
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={1} disabled={disabled} defaultValue={numStr(air.ventilationFlowM3h)}
              onBlur={numberBlur((v) => setAirNum('ventilationFlowM3h', v))} />
          </label>
        )}
        <div className="bp-muted">Насколько здание герметичное?</div>
        <Chips disabled={disabled} value={air.airtightnessClass ?? null}
          options={AIRS.map((c) => ({ value: c, label: AIR_LABEL[c] }))} onSelect={(v) => setAirClass(v as AirtightnessClass | null)} />
        <ShareNote note={shareNote} section="air" disabled={disabled} onApply={applyPending} onDismiss={() => setShareNote(null)} />
      </Section>

      <Section
        sectionKey="internal"
        title="Люди"
        summary={summary.internal}
        status={status('internal')}
        open={currentOpenSection === 'internal'}
        onToggle={() => toggle('internal')}
        onNext={nextAction('internal')}
        refCb={(el) => { sectionRefs.current.internal = el; }}
      >
        <label className="bp-muted">Сколько человек обычно в комнате?
          <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={1} disabled={disabled} defaultValue={numStr(gains.occupancy)}
            onBlur={numberBlur((v) => setOccupancy(v))} />
        </label>
        {gains.occupancy == null && (() => {
          const s = getRoomOccupancySuggestion(room.roomType, objectType);
          if (!s) return null;
          if (s.userConfirmationRequired) {
            return (
              <div className="bp-muted">
                Обычно: {s.suggestedPeople} чел.
                {!disabled && <button type="button" className="bp-chip" onClick={() => setOccupancy(String(s.suggestedPeople))}>подтвердить</button>}
                <span> — иначе не учитывается.</span>
              </div>
            );
          }
          if (s.zeroOccupancy) return <span className="bp-muted">Обычно: 0 — нет постоянного пребывания.</span>;
          return <span className="bp-muted">Обычно: {s.suggestedPeople} чел. — типовое значение, если оставить пустым.</span>;
        })()}
        <span className="bp-muted">Освещение/оборудование — в «Расширенных параметрах» (типовые значения подставляет инженерный профиль на сервере).</span>
      </Section>

      <Section
        sectionKey="advanced"
        title="Расширенные"
        summary={summary.advanced}
        status="— Не требуется"
        open={currentOpenSection === 'advanced'}
        onToggle={() => toggle('advanced')}
        refCb={(el) => { sectionRefs.current.advanced = el; }}
      >
        <div className="bp-grid" style={{ marginTop: 6 }}>
          <label className="bp-muted">U наружной стены, Вт/(м²·К)
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={0.01} disabled={disabled} defaultValue={numStr(wall?.uValue ?? null)} onBlur={numberBlur((v) => setWallU(v))} />
          </label>
          <label className="bp-muted">Герметичность ACH50 (бловер-дор)
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={0.1} disabled={disabled} defaultValue={numStr(air.ach50)} onBlur={numberBlur((v) => setAirNum('ach50', v))} />
          </label>
          <label className="bp-muted">Приточная вентиляция, м³/ч
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={1} disabled={disabled} defaultValue={numStr(air.ventilationFlowM3h)} onBlur={numberBlur((v) => setAirNum('ventilationFlowM3h', v))} />
          </label>
          <label className="bp-muted">Инфильтрация (измеренная), м³/ч
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={1} disabled={disabled} defaultValue={numStr(air.infiltrationFlowM3h)} onBlur={numberBlur((v) => setAirNum('infiltrationFlowM3h', v))} />
          </label>
          <label className="bp-muted">Эффективная кратность ACH, 1/ч
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={0.1} disabled={disabled} defaultValue={numStr(air.airChangesPerHour)} onBlur={numberBlur((v) => setAirNum('airChangesPerHour', v))} />
          </label>
          <label className="bp-muted">Люди, суммарно Вт
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={1} disabled={disabled} defaultValue={numStr(gains.peopleW)} onBlur={numberBlur((v) => setGain('peopleW', v))} />
          </label>
          <label className="bp-muted">Освещение, Вт
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={1} disabled={disabled} defaultValue={numStr(gains.lightingGainW)} onBlur={numberBlur((v) => setGain('lightingGainW', v))} />
          </label>
          <label className="bp-muted">Оборудование, Вт
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={1} disabled={disabled} defaultValue={numStr(gains.equipmentGainW)} onBlur={numberBlur((v) => setGain('equipmentGainW', v))} />
          </label>
          <label className="bp-muted">Вт/чел. (явное тепло)
            <input className="bp-input" {...QUICK_INPUT_PROPS} min={0} step={1} disabled={disabled} defaultValue={numStr(gains.occupantSensibleWPerPerson)} onBlur={numberBlur((v) => setGain('occupantSensibleWPerPerson', v))} />
          </label>
        </div>
      </Section>
    </div>
  );
}

function Section(props: {
  sectionKey: PanelSectionKey;
  title: string;
  summary: string;
  status?: string;
  open: boolean;
  onToggle: () => void;
  onNext?: () => void;
  refCb: (el: HTMLDivElement | null) => void;
  children: ReactNode;
}) {
  const { title, summary, status, open, onToggle, onNext, refCb, children } = props;
  return (
    <div ref={refCb} style={{ border: '1px solid #343a40', borderRadius: 10, overflow: 'hidden' }}>
      <button
        type="button"
        className="bp-accordion-trigger"
        onClick={onToggle}
        aria-expanded={open}
        style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', color: 'inherit', border: 'none', cursor: 'pointer', padding: '8px 10px', minHeight: 40, textAlign: 'left' }}
      >
        <span style={{ flex: '0 0 auto', fontWeight: 700, whiteSpace: 'nowrap' }}>{title}</span>
        {!open && summary ? <span className="bp-muted bp-accordion-summary" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{summary}</span> : <span className="bp-accordion-summary" />}
        {status && <span className={status.startsWith('✓') ? 'bp-ok' : status.startsWith('⚠') ? 'bp-alert' : 'bp-muted'} style={{ flex: '0 0 auto', whiteSpace: 'nowrap', fontSize: 14 }}>{status}</span>}
        <span aria-hidden style={{ color: '#12b886' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="bp-grid" style={{ padding: '8px 10px 10px' }}>
          {children}
          {onNext && <button type="button" className="bp-btn" onClick={() => onNext?.()}>Далее</button>}
        </div>
      )}
    </div>
  );
}

function Chips(props: { disabled: boolean; value: string | null; options: Array<{ value: string; label: string }>; onSelect: (v: string | null) => void }) {
  const { disabled, value, options, onSelect } = props;
  return (
    <div className="bp-chips" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" disabled={disabled}
          aria-pressed={value === o.value}
          className={`bp-chip${value === o.value ? ' on' : ''}`}
          onClick={() => onSelect(value === o.value ? null : o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

function roomsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'помещении';
  return 'помещениях';
}

function roomsWordDative(n: number): string {
  return n % 10 === 1 && n % 100 !== 11 ? 'помещению' : 'помещениям';
}

function ShareNote({ note, section, disabled, onApply, onDismiss }: {
  note: { section: PanelSectionKey; text: string; pending: RoomPatch[] | null } | null;
  section: PanelSectionKey;
  disabled: boolean;
  onApply: () => void;
  onDismiss: () => void;
}) {
  if (!note || note.section !== section) return null;
  return (
    <div className={note.pending ? 'bp-alert' : 'bp-ok'} role="status" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
      <span>{note.text}</span>
      {note.pending && !disabled ? <button type="button" className="bp-chip" onClick={onApply}>Применить ко всем</button> : null}
      <button type="button" className="bp-chip" onClick={onDismiss} aria-label="Скрыть">✕</button>
    </div>
  );
}
