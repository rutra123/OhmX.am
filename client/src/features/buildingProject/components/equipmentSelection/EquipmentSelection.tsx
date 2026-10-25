/**
 * Equipment selection UI for the Systems step (presentation only).
 *
 * All state changes go through the callbacks the wizard already used
 * (onToggle / onNotRequired / onSelectRoom); nothing here persists, computes
 * loads or decides compatibility. Option lists come from roomServiceOptions()
 * and the server catalog, unchanged.
 */
import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { roomServiceOptions, type RoomServiceRole } from '../../systemsSourceModes';
import type { EngineeringRoomAssignment, EngineeringSystemFamily, ServicePreference } from '../../types';
import {
  NO_SERVICE_GLYPH,
  equipmentGlyphs,
  equipmentStatusBadge,
  equipmentSubtitle,
  groupEquipmentOptions,
  isRoomOptionSelected,
  roomTerminalView,
  type EquipmentService,
  type RoomServiceSummary,
} from '../../utils/equipmentPresentation';
import { EquipmentGlyph, type EquipmentGlyphKey } from './EquipmentIcon';
import { FAN_COIL_MOUNTINGS, FAN_COIL_MOUNTING_TEXT, type FanCoilMounting } from '../../equipment/fanCoilMounting';

const SERVICE_LABEL: Record<EquipmentService, string> = { heating: 'Отопление', cooling: 'Охлаждение' };
/** Equipment-selection strings in one place (the wizard is Russian-only today). */
export const EQ_TEXT = {
  recommended: 'Рекомендуем',
  saving: 'Сохраняется…',
  showOther: (n: number) => `Показать другие варианты (${n})`,
  hideOther: 'Скрыть другие варианты',
  towelTitle: 'Полотенцесушитель',
  towelWater: 'Водяной',
  towelWaterSub: 'Подключается к системе отопления',
  towelElectric: 'Электрический',
  towelElectricSub: 'Работает от сети, круглый год',
  towelQty: 'Количество',
  towelRemove: 'Убрать полотенцесушитель',
  towelAdd: 'Добавить полотенцесушитель',
  towelNone: 'Не нужен в этом помещении',
  fcMountTitle: 'Фанкойл: тип установки',
  fcMountRequired: 'Выберите тип установки — без него модель фанкойла не подбирается и смета не будет полной.',
  fcMountChosen: 'Подбор фанкойла выполняется только среди моделей выбранного типа.',
  sourceLabel: 'Источник:',
  sourceShared: 'общий для объекта, меняется в блоке «Источник»',
  sharedSource: 'Общий источник объекта',
  sharedSourceHint: 'Одна установка на весь объект — в помещениях ниже показаны только комнатные приборы.',
} as const;
const SERVICE_NONE_HINT: Record<EquipmentService, string> = {
  heating: 'Отопление в этой комнате не нужно',
  cooling: 'Охлаждение в этой комнате не нужно',
};

function preferenceLabel(preference: ServicePreference): string {
  if (preference === 'required') return 'нужно';
  if (preference === 'optional') return 'по желанию';
  return 'не требуется';
}

function CheckMark() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}

export function ServiceGlyph({ service, size = 18 }: { service: EquipmentService; size?: number }) {
  // Service-level marks (not equipment): flame for heating, snowflake for cooling.
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="eq-service-glyph">
      {service === 'heating'
        ? <path d="M12 3c-1 4-6 6.5-6 11.5a6 6 0 0 0 12 0c0-2.6-1.4-4.6-3-6.2-.4 1.7-1.3 2.9-2.6 3.4C13 9 13 6 12 3z" />
        : <path d="M12 2.5v19M4.2 7l15.6 9M4.2 17l15.6-9M9.5 4.5 12 6.8l2.5-2.3M9.5 19.5 12 17.2l2.5 2.3M3.6 10.4l3.2.9-.8 3.3M20.4 10.4l-3.2.9.8 3.3" />}
    </svg>
  );
}

/** One pictogram, or "A + B" for a combined scheme. */
export function EquipmentPictogram({ familyId, size = 32 }: { familyId: string; size?: number }) {
  const glyphs = equipmentGlyphs(familyId);
  if (glyphs.length === 1) return <EquipmentGlyph glyph={glyphs[0]} size={size} />;
  const small = Math.round(size * 0.86);
  return (
    <span className="eq-pair" aria-hidden="true">
      <EquipmentGlyph glyph={glyphs[0]} size={small} />
      <span className="eq-pair-plus">+</span>
      <EquipmentGlyph glyph={glyphs[1]} size={small} />
    </span>
  );
}

/** Compact read-only "icon + label" token used in summaries. */
export function EquipmentTag({ familyId, label, service }: { familyId: string; label: string; service: EquipmentService }) {
  return (
    <span className="eq-tag" data-service={service}>
      <span className="eq-tag-icon"><EquipmentPictogram familyId={familyId} size={18} /></span>
      <span className="eq-tag-label">{label}</span>
    </span>
  );
}

export function EquipmentTagList({ summary, service, emptyText = 'не выбрано' }: { summary: RoomServiceSummary; service: EquipmentService; emptyText?: string }) {
  if (summary.state === 'not_required') return <span className="eq-tag-none">не требуется</span>;
  if (summary.state === 'empty') return <span className="eq-tag-empty">{emptyText}</span>;
  return (
    <span className="eq-tags">
      {summary.items.map((item) => <EquipmentTag key={item.familyId} familyId={item.familyId} label={item.label} service={service} />)}
    </span>
  );
}

/** The one plant shared by all rooms for a service, shown once above room lists. */
export function SharedSourceLine({ service, source }: { service: EquipmentService; source: { familyId: string; label: string } }) {
  return (
    <div className="eq-sumline" data-service={service}>
      <span className="eq-sumline-head"><ServiceGlyph service={service} size={16} /><span>{SERVICE_LABEL[service]}</span></span>
      <span className="eq-tags"><EquipmentTag familyId={source.familyId} label={source.label} service={service} /></span>
    </div>
  );
}

/** One room heading pattern used by every room list in the configurator. */
export function RoomHeading({ icon, name, meta }: { icon: ReactNode; name: string; meta?: ReactNode }) {
  return (
    <div className="eq-room-heading">
      <span className="eq-room-heading-icon" aria-hidden="true">{icon}</span>
      <span className="eq-room-heading-name">{name}</span>
      {meta != null && <span className="eq-room-heading-meta">{meta}</span>}
    </div>
  );
}

/** One service line of a summary: "[service glyph] Отопление  [tags]". */
export function ServiceSummaryLine({ service, summary }: { service: EquipmentService; summary: RoomServiceSummary }) {
  return (
    <div className="eq-sumline" data-service={service}>
      <span className="eq-sumline-head"><ServiceGlyph service={service} size={16} /><span>{SERVICE_LABEL[service]}</span></span>
      <EquipmentTagList summary={summary} service={service} />
    </div>
  );
}

function EquipmentOptionCard(props: {
  family: EngineeringSystemFamily;
  service: EquipmentService;
  checked: boolean;
  onChange: () => void;
  /** The section already states the status (combined schemes). */
  hideBadge?: boolean;
  /** Part of the existing recommended scheme for this room (not a selection). */
  recommended?: boolean;
  /** A save for this option is in flight. */
  pending?: boolean;
  disabled?: boolean;
}) {
  const { family, service, checked, onChange, recommended, pending, disabled } = props;
  const id = useId();
  const subtitle = equipmentSubtitle(family);
  const badge = props.hideBadge ? null : equipmentStatusBadge(family);
  const combined = equipmentGlyphs(family.id).length > 1;
  const state = `${checked ? ' is-on' : ''}${combined ? ' is-combined' : ''}${pending ? ' is-pending' : ''}${disabled ? ' is-disabled' : ''}`;
  return (
    <label className={`eq-card${state}`} data-service={service} data-family={family.id} lang="ru" aria-busy={pending || undefined}>
      <input
        type="checkbox"
        className="eq-sr"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-labelledby={`${id}-name`}
        aria-describedby={subtitle || badge || recommended ? `${id}-desc` : undefined}
      />
      <span className="eq-card-icon"><EquipmentPictogram familyId={family.id} size={36} /></span>
      <span className="eq-card-text">
        <span className="eq-card-name" id={`${id}-name`}>{family.label}</span>
        {(subtitle || badge || recommended) && (
          <span className="eq-card-sub" id={`${id}-desc`}>
            {subtitle}
            {(badge || recommended) && (
              <span className="eq-badges">
                {recommended && <span className="eq-badge eq-badge-rec">{EQ_TEXT.recommended}</span>}
                {badge && <span className="eq-badge">{badge}</span>}
              </span>
            )}
          </span>
        )}
      </span>
      <span className="eq-check" aria-hidden="true">{pending ? <span className="eq-spinner" /> : checked && <CheckMark />}</span>
    </label>
  );
}

/** Exclusive "not required" choice — same action the old «Не требуется» chip ran. */
function NotRequiredCard({ service, pressed, pending, onPress }: { service: EquipmentService; pressed: boolean; pending?: boolean; onPress: () => void }) {
  return (
    <button type="button" className={`eq-card eq-none${pressed ? ' is-on' : ''}${pending ? ' is-pending' : ''}`} data-service={service} aria-pressed={pressed} aria-busy={pending || undefined} onClick={onPress}>
      <span className="eq-card-icon"><EquipmentGlyph glyph={NO_SERVICE_GLYPH[service]} size={28} /></span>
      <span className="eq-card-text">
        <span className="eq-card-name">Не требуется</span>
        <span className="eq-card-sub">{SERVICE_NONE_HINT[service]}</span>
      </span>
      <span className="eq-check" aria-hidden="true">{pending ? <span className="eq-spinner" /> : pressed && <CheckMark />}</span>
    </button>
  );
}

function ServiceEquipmentPanel(props: {
  roomId: string;
  service: EquipmentService;
  assignment: EngineeringRoomAssignment;
  families: EngineeringSystemFamily[];
  onToggle: (roomId: string, service: EquipmentService, family: EngineeringSystemFamily, role: RoomServiceRole) => void | Promise<void>;
  onNotRequired: (roomId: string, service: EquipmentService) => void | Promise<void>;
  recommendedIds?: string[];
  panelId?: string;
  labelledBy?: string;
  showHeading: boolean;
}) {
  const { roomId, service, assignment, families, onToggle, onNotRequired } = props;
  const sections = groupEquipmentOptions(roomServiceOptions(families, service), service);
  const preference = assignment.servicePreferences[service];
  const notRequired = preference === 'not_required';
  const [combinedOpen, setCombinedOpen] = useState<boolean | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const combinedId = useId();
  const run = (key: string, action: () => void | Promise<void>) => {
    setPendingId(key);
    void Promise.resolve(action()).finally(() => setPendingId((current) => (current === key ? null : current)));
  };

  const renderCards = (items: typeof sections[number]['items'], hideBadge = false) => (
    <div className="eq-cards">
      {items.map(({ family, role }) => (
        <EquipmentOptionCard
          key={`${service}-${family.id}`}
          family={family}
          service={service}
          checked={isRoomOptionSelected(assignment, service, family.id, role)}
          onChange={() => run(family.id, () => onToggle(roomId, service, family, role))}
          hideBadge={hideBadge}
          recommended={props.recommendedIds?.includes(family.id)}
          pending={pendingId === family.id}
        />
      ))}
    </div>
  );

  return (
    <div className="eq-panel" data-service={service} id={props.panelId} role={props.labelledBy ? 'tabpanel' : undefined} aria-labelledby={props.labelledBy}>
      <div className="eq-panel-head">
        {props.showHeading && <strong className="eq-panel-title"><ServiceGlyph service={service} />{SERVICE_LABEL[service]}</strong>}
        <span className="eq-pref">{props.showHeading ? '' : `${SERVICE_LABEL[service]} · `}{preferenceLabel(preference)}</span>
      </div>
      {!notRequired && (() => {
        const source = roomTerminalView(assignment, service, families).source;
        return source ? (
          <div className="eq-source-note" data-service={service}>
            <span className="eq-tag-icon"><EquipmentPictogram familyId={source.familyId} size={22} /></span>
            <span><span className="eq-source-note-label">{EQ_TEXT.sourceLabel}</span> {source.label}<span className="eq-source-note-hint"> · {EQ_TEXT.sourceShared}</span></span>
          </div>
        ) : null;
      })()}
      <NotRequiredCard service={service} pressed={notRequired} pending={pendingId === '__none'} onPress={() => run('__none', () => onNotRequired(roomId, service))} />
      {sections.map((section) => {
        const selectedCount = section.items.filter(({ family, role }) => isRoomOptionSelected(assignment, service, family.id, role)).length;
        if (section.group === 'combined') {
          const open = combinedOpen ?? selectedCount > 0;
          return (
            <section key={section.group} className="eq-group eq-group-combined">
              <button type="button" className="eq-disclosure" aria-expanded={open} aria-controls={combinedId} onClick={() => setCombinedOpen(!open)}>
                <span className="eq-disclosure-text">
                  <span className="eq-group-title">{section.label}</span>
                  <span className="eq-group-meta">
                    {section.items.length} {section.items.length === 1 ? 'вариант' : section.items.length < 5 ? 'варианта' : 'вариантов'}
                    {selectedCount > 0 ? ` · выбрано ${selectedCount}` : ''} · расчёт в разработке
                  </span>
                </span>
                <svg className="eq-chevron" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m4 6 4 4 4-4" /></svg>
              </button>
              <div id={combinedId} hidden={!open}>
                <p className="eq-group-note">Схема целиком фиксирует намерение; совместимость и количество приборов инженер уточнит в следующих фазах.</p>
                <fieldset className="eq-fieldset">
                  <legend className="eq-sr">{section.label}</legend>
                  {renderCards(section.items, true)}
                </fieldset>
              </div>
            </section>
          );
        }
        return (
          <fieldset key={section.group} className="eq-group eq-fieldset">
            <legend className="eq-group-title">
              {section.label}
              {selectedCount > 0 && <span className="eq-group-count">выбрано {selectedCount}</span>}
            </legend>
            {renderCards(section.items)}
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * Per-room equipment selector: one tab per requested service (tabs only when
 * both are requested), each tab showing the current choice as pictograms.
 */
export function RoomEquipmentSelector(props: {
  roomId: string;
  assignment: EngineeringRoomAssignment;
  requested: EquipmentService[];
  families: EngineeringSystemFamily[];
  summaries: Record<EquipmentService, RoomServiceSummary>;
  onToggle: (roomId: string, service: EquipmentService, family: EngineeringSystemFamily, role: RoomServiceRole) => void | Promise<void>;
  onNotRequired: (roomId: string, service: EquipmentService) => void | Promise<void>;
  /** Family ids of the existing recommended scheme for this room, per service. */
  recommended?: Partial<Record<EquipmentService, string[]>>;
}) {
  const { requested } = props;
  const services = (['heating', 'cooling'] as EquipmentService[]).filter((s) => requested.includes(s));
  const [activeRaw, setActive] = useState<EquipmentService>(services[0] || 'heating');
  const active = services.includes(activeRaw) ? activeRaw : services[0];
  const baseId = useId();
  if (!services.length || !active) return null;

  if (services.length === 1) {
    return (
      <ServiceEquipmentPanel
        roomId={props.roomId}
        service={active}
        assignment={props.assignment}
        families={props.families}
        onToggle={props.onToggle}
        onNotRequired={props.onNotRequired}
        recommendedIds={props.recommended?.[active]}
        showHeading
      />
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = services.indexOf(active);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? services.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + services.length) % services.length;
    setActive(services[next]);
    const el = document.getElementById(`${baseId}-tab-${services[next]}`);
    el?.focus();
  };

  return (
    <div className="eq-selector">
      <div className="eq-tabs" role="tablist" aria-label="Оборудование комнаты">
        {services.map((service) => {
          const summary = roomTerminalView(props.assignment, service, props.families);
          const selected = service === active;
          return (
            <button
              key={service}
              id={`${baseId}-tab-${service}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${service}`}
              tabIndex={selected ? 0 : -1}
              className={`eq-tab${selected ? ' is-active' : ''}`}
              data-service={service}
              onClick={() => setActive(service)}
              onKeyDown={onKeyDown}
            >
              <span className="eq-tab-title"><ServiceGlyph service={service} />{SERVICE_LABEL[service]}</span>
              <span className="eq-tab-state">
                {summary.state === 'selected'
                  ? (
                    <>
                      <span className="eq-tab-glyphs" aria-hidden="true">
                        {summary.items.slice(0, 3).map((item) => <EquipmentPictogram key={item.familyId} familyId={item.familyId} size={18} />)}
                      </span>
                      <span>{summary.items.length === 1 ? '1 прибор' : `${summary.items.length} ${summary.items.length < 5 ? 'прибора' : 'приборов'}`}</span>
                    </>
                  )
                  : <span className={summary.state === 'empty' ? 'eq-warn-text' : ''}>{summary.state === 'empty' ? 'не выбрано' : 'не требуется'}</span>}
              </span>
            </button>
          );
        })}
      </div>
      <ServiceEquipmentPanel
        key={active}
        roomId={props.roomId}
        service={active}
        assignment={props.assignment}
        families={props.families}
        onToggle={props.onToggle}
        onNotRequired={props.onNotRequired}
        recommendedIds={props.recommended?.[active]}
        panelId={`${baseId}-panel-${active}`}
        labelledBy={`${baseId}-tab-${active}`}
        showHeading={false}
      />
    </div>
  );
}

export type RoomNavItem = {
  id: string;
  name: string;
  icon: ReactNode;
  areaM2: number | null | undefined;
  summaries: Partial<Record<EquipmentService, RoomServiceSummary>>;
};

function navServiceText(service: EquipmentService, summary: RoomServiceSummary): string {
  if (summary.state === 'not_required') return `${SERVICE_LABEL[service]}: не требуется`;
  if (summary.state === 'empty') return `${SERVICE_LABEL[service]}: не выбрано`;
  return `${SERVICE_LABEL[service]}: ${summary.items.map((i) => i.label).join(', ')}`;
}

/**
 * Room navigation: horizontal strip on narrow containers, sidebar list on wide
 * ones (CSS container query). Each room shows its chosen equipment as glyphs.
 */
export function RoomNavigator({ rooms, activeId, onSelect }: { rooms: RoomNavItem[]; activeId: string | null; onSelect: (roomId: string) => void }) {
  const index = Math.max(0, rooms.findIndex((r) => r.id === activeId));
  const go = (delta: number) => {
    const next = rooms[index + delta];
    if (!next) return;
    onSelect(next.id);
    // Keep the newly active pill visible in the horizontal strip.
    requestAnimationFrame(() => {
      document.querySelector(`[data-eq-room="${CSS.escape(next.id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  };
  return (
    <nav className="eq-rooms" aria-label="Комнаты">
      <div className="eq-rooms-head">
        <strong>Комнаты</strong>
        <span className="eq-rooms-pos" aria-live="polite">{rooms.length ? `${index + 1} из ${rooms.length}` : ''}</span>
        <span className="eq-rooms-step">
          <button type="button" className="eq-iconbtn" aria-label="Предыдущая комната" disabled={index <= 0} onClick={() => go(-1)}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m10 3.5-4.5 4.5 4.5 4.5" /></svg>
          </button>
          <button type="button" className="eq-iconbtn" aria-label="Следующая комната" disabled={index >= rooms.length - 1} onClick={() => go(1)}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m6 3.5 4.5 4.5L6 12.5" /></svg>
          </button>
        </span>
      </div>
      <ul className="eq-rooms-list">
        {rooms.map((room) => {
          const active = room.id === activeId;
          const services = (['heating', 'cooling'] as EquipmentService[]).filter((s) => room.summaries[s]);
          const missing = services.some((s) => room.summaries[s]?.state === 'empty');
          return (
            <li key={room.id}>
              <button
                type="button"
                className={`eq-room${active ? ' is-active' : ''}`}
                data-eq-room={room.id}
                aria-current={active ? 'true' : undefined}
                onClick={() => onSelect(room.id)}
              >
                <span className="eq-room-top">
                  <span className="eq-room-icon" aria-hidden="true">{room.icon}</span>
                  <span className="eq-room-name">{room.name}</span>
                  <span className="eq-room-area">{room.areaM2 ?? '—'} м²</span>
                </span>
                <span className="eq-room-eq" aria-hidden="true">
                  {services.map((service) => {
                    const summary = room.summaries[service]!;
                    return (
                      <span key={service} className="eq-room-svc" data-service={service}>
                        <ServiceGlyph service={service} size={13} />
                        {summary.state === 'selected'
                          ? summary.items.slice(0, 3).map((item) => <EquipmentPictogram key={item.familyId} familyId={item.familyId} size={18} />)
                          : <span className={summary.state === 'empty' ? 'eq-warn-text' : 'eq-room-dash'}>{summary.state === 'empty' ? '?' : '—'}</span>}
                        {summary.state === 'selected' && summary.items.length > 3 && <span className="eq-room-more">+{summary.items.length - 3}</span>}
                      </span>
                    );
                  })}
                  {missing && <span className="eq-room-flag">не выбрано</span>}
                </span>
                <span className="eq-sr">{services.map((s) => navServiceText(s, room.summaries[s]!)).join('. ')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Pressed-state card for single-choice source pickers (project / apartment source). */
export function SourceChoiceCard(props: {
  familyId: string | null;
  glyph?: Parameters<typeof EquipmentGlyph>[0]['glyph'];
  label: string;
  subtitle?: string;
  service: EquipmentService;
  pressed: boolean;
  onPress: () => void;
}) {
  return (
    <button type="button" className={`eq-card eq-card-compact${props.pressed ? ' is-on' : ''}`} data-service={props.service} aria-pressed={props.pressed} onClick={props.onPress}>
      <span className="eq-card-icon">
        {props.glyph ? <EquipmentGlyph glyph={props.glyph} size={28} /> : <EquipmentPictogram familyId={props.familyId || ''} size={28} />}
      </span>
      <span className="eq-card-text">
        <span className="eq-card-name">{props.label}</span>
        {props.subtitle && <span className="eq-card-sub">{props.subtitle}</span>}
      </span>
      <span className="eq-check" aria-hidden="true">{props.pressed && <CheckMark />}</span>
    </button>
  );
}

export type SourceOption = {
  key: string;
  familyId: string | null;
  glyph?: Parameters<typeof EquipmentGlyph>[0]['glyph'];
  label: string;
  subtitle?: string;
  pressed: boolean;
  onPress: () => void;
};

/**
 * Single-choice source list with progressive disclosure: once something is
 * chosen only the choice stays visible, the rest sits behind one toggle.
 */
export function SourceChoiceList({ service, options }: { service: EquipmentService; options: SourceOption[] }) {
  // Expanded by default: the customer sees every source option; "Скрыть другие варианты" folds the list to the chosen one.
  const [expanded, setExpanded] = useState(true);
  const listId = useId();
  const chosen = options.filter((o) => o.pressed);
  const collapsed = chosen.length > 0 && !expanded;
  const visible = collapsed ? chosen : options;
  const hiddenCount = options.length - chosen.length;
  return (
    <div className="eq-source">
      <div className={`eq-source-grid${collapsed ? ' is-single' : ''}`} id={listId}>
        {visible.map((o) => (
          <SourceChoiceCard key={o.key} familyId={o.familyId} glyph={o.glyph} label={o.label} subtitle={o.subtitle} service={service} pressed={o.pressed} onPress={o.onPress} />
        ))}
      </div>
      {chosen.length > 0 && hiddenCount > 0 && (
        <button type="button" className="eq-more" aria-expanded={!collapsed} aria-controls={listId} onClick={() => setExpanded(!expanded)}>
          {collapsed ? EQ_TEXT.showOther(hiddenCount) : EQ_TEXT.hideOther}
        </button>
      )}
    </div>
  );
}

/**
 * Towel warmer choice for wet rooms. Kind is exclusive (radio group); the
 * callbacks are the wizard's existing towel handlers.
 */
export function TowelWarmerPanel(props: {
  roomName: string;
  selection: { kind: 'water' | 'electric'; quantity: number; kindSource?: string } | null;
  quantityControl: ReactNode;
  onKind: (kind: 'water' | 'electric') => void;
  onRemove: () => void;
  onAdd: () => void;
  note?: ReactNode;
}) {
  const name = useId();
  const { selection } = props;
  return (
    <fieldset className="eq-group eq-fieldset eq-towel" data-service="heating">
      <legend className="eq-group-title">{EQ_TEXT.towelTitle}</legend>
      {selection ? (
        <>
          <div className="eq-cards" role="radiogroup" aria-label={`${EQ_TEXT.towelTitle}: тип`}>
            {(['water', 'electric'] as const).map((kind) => (
              <label key={kind} className={`eq-card eq-card-compact${selection.kind === kind ? ' is-on' : ''}`} data-service="heating" lang="ru">
                <input type="radio" className="eq-sr" name={name} checked={selection.kind === kind} onChange={() => props.onKind(kind)} />
                <span className="eq-card-icon"><EquipmentGlyph glyph={kind === 'water' ? 'towel_rail_water' : 'towel_rail_electric'} size={30} /></span>
                <span className="eq-card-text">
                  <span className="eq-card-name">{kind === 'water' ? EQ_TEXT.towelWater : EQ_TEXT.towelElectric}</span>
                  <span className="eq-card-sub">{kind === 'water' ? EQ_TEXT.towelWaterSub : EQ_TEXT.towelElectricSub}</span>
                </span>
                <span className="eq-check eq-radio" aria-hidden="true">{selection.kind === kind && <CheckMark />}</span>
              </label>
            ))}
          </div>
          {props.note}
          <div className="eq-towel-row">
            <span className="eq-towel-qty">{EQ_TEXT.towelQty}</span>
            {props.quantityControl}
            <button type="button" className="eq-more eq-towel-remove" onClick={props.onRemove}>{EQ_TEXT.towelRemove}</button>
          </div>
        </>
      ) : (
        <div className="eq-towel-row">
          <span className="eq-pref">{EQ_TEXT.towelNone}</span>
          <button type="button" className="eq-more" onClick={props.onAdd}>{EQ_TEXT.towelAdd}</button>
        </div>
      )}
    </fieldset>
  );
}

const FC_MOUNT_GLYPH: Record<FanCoilMounting, EquipmentGlyphKey> = {
  EXPOSED_FLOOR_WALL: 'fan_coil',
  EXPOSED_CEILING: 'floor_ceiling',
  CONCEALED_WALL: 'column',
  CONCEALED_CEILING: 'ducted',
  CASSETTE: 'cassette',
};

/** Installation type of the room's fan coil (required before a model can be selected). */
export function FanCoilMountingPanel(props: {
  value: FanCoilMounting | null;
  service: EquipmentService;
  counts?: Partial<Record<FanCoilMounting, number>>;
  onChange: (value: FanCoilMounting) => void;
  /** Copies the chosen type to every room with fan coils (shown when other rooms differ). */
  onApplyAll?: () => void;
  applyAllLabel?: string;
}) {
  const name = useId();
  return (
    <fieldset className="eq-group eq-fieldset eq-towel" data-service={props.service} data-fc-mounting={props.value ?? 'unset'}>
      <legend className="eq-group-title">{EQ_TEXT.fcMountTitle}</legend>
      <div className="eq-cards" role="radiogroup" aria-label={EQ_TEXT.fcMountTitle} aria-required="true">
        {FAN_COIL_MOUNTINGS.map((m) => {
          const count = props.counts?.[m];
          const disabled = count === 0;
          return (
            <label key={m} className={`eq-card eq-card-compact${props.value === m ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`} data-service={props.service} lang="ru">
              <input type="radio" className="eq-sr" name={name} checked={props.value === m} disabled={disabled} onChange={() => props.onChange(m)} />
              <span className="eq-card-icon"><EquipmentGlyph glyph={FC_MOUNT_GLYPH[m]} size={30} /></span>
              <span className="eq-card-text">
                <span className="eq-card-name">{FAN_COIL_MOUNTING_TEXT[m].label}</span>
                <span className="eq-card-sub">{FAN_COIL_MOUNTING_TEXT[m].sub}{count != null ? ` · моделей в каталоге: ${count}` : ''}</span>
              </span>
              <span className="eq-check eq-radio" aria-hidden="true">{props.value === m && <CheckMark />}</span>
            </label>
          );
        })}
      </div>
      <div className={props.value ? 'bp-muted' : 'eq-warn-text'} role={props.value ? undefined : 'status'}>{props.value ? EQ_TEXT.fcMountChosen : EQ_TEXT.fcMountRequired}</div>
      {props.value && props.onApplyAll && (
        <div className="eq-towel-row">
          <button type="button" className="eq-more" onClick={props.onApplyAll}>{props.applyAllLabel ?? 'Применить ко всем помещениям с фанкойлами'}</button>
        </div>
      )}
    </fieldset>
  );
}

export const EQUIPMENT_UI_CSS = `
.eq-systems { scroll-margin-top: 72px; }
.eq-scope .bp-btn { min-height: 44px; }
.eq-scope { --eq-heat: var(--bp-heat, 255 128 82); --eq-cool: var(--bp-cool, 56 198 226); --eq-warn: var(--bp-warn, var(--warn)); --eq-info: var(--bp-info, 125 211 252); container-type: inline-size; min-width: 0; }
.eq-scope [data-service='heating'] { --eq-accent: var(--eq-heat); }
.eq-scope [data-service='cooling'] { --eq-accent: var(--eq-cool); }
.eq-sr { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.eq-glyph { display: block; flex: 0 0 auto; }
.eq-pair { display: inline-flex; align-items: center; gap: 1px; }
.eq-pair-plus { font-size: 13px; font-weight: 700; opacity: .75; line-height: 1; }
.eq-warn-text { color: rgb(var(--eq-warn)); }

/* ---- cards ---- */
.eq-cards { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; }
@container (min-width: 560px) { .eq-cards { grid-template-columns: repeat(auto-fill, minmax(min(100%, 268px), 1fr)); } }
@container (min-width: 820px) { .eq-cards { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); } }
.eq-card { position: relative; display: grid; grid-template-columns: auto minmax(0, 1fr) 24px; align-items: center; gap: 14px; width: 100%; min-height: 72px; padding: 12px 14px; border-radius: 16px; border: 1px solid rgb(var(--bp-line, var(--line))); background: rgb(var(--bp-surface-1, var(--card))); color: rgb(var(--fg)); text-align: left; cursor: pointer; font: inherit; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.eq-card-icon { display: grid; place-items: center; min-width: 54px; height: 54px; padding: 0 8px; border-radius: 13px; background: rgb(var(--fg-muted) / .1); color: rgb(var(--fg-soft)); }
.eq-card.is-combined .eq-card-icon { min-width: 84px; }
.eq-card-text { display: grid; gap: 3px; min-width: 0; }
.eq-card-name { font-size: 16px; font-weight: 650; line-height: 1.3; overflow-wrap: break-word; hyphens: auto; }
.eq-card-sub { font-size: 14px; line-height: 1.4; color: rgb(var(--fg-muted)); overflow-wrap: break-word; hyphens: auto; }
.eq-badges { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.eq-badge { display: inline-flex; align-items: center; min-height: 22px; padding: 0 8px; border-radius: 999px; border: 1px solid rgb(var(--eq-warn) / .55); color: rgb(var(--eq-warn)); font-size: 13px; font-weight: 600; line-height: 1.3; white-space: nowrap; }
.eq-badge-rec { border-color: rgb(var(--eq-info) / .6); color: rgb(var(--eq-info)); }
.eq-badge-rec::before { content: ''; width: 6px; height: 6px; margin-right: 6px; border-radius: 50%; background: currentColor; }
.eq-check { display: grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; border: 1.5px solid rgb(var(--fg-muted) / .6); color: rgb(var(--bg)); }
.eq-check.eq-radio { border-radius: 50%; }
.eq-card.is-on { border-color: rgb(var(--eq-accent)); background: linear-gradient(rgb(var(--eq-accent) / .1), rgb(var(--eq-accent) / .1)), rgb(var(--bp-surface-1, var(--card))); box-shadow: inset 0 0 0 1px rgb(var(--eq-accent)); }
.eq-card.is-on .eq-card-icon { background: rgb(var(--eq-accent) / .18); color: rgb(var(--eq-accent)); }
.eq-card.is-on .eq-check { border-color: rgb(var(--eq-accent)); background: rgb(var(--eq-accent)); }
.eq-card.is-pending .eq-check { border-color: transparent; background: transparent; }
.eq-spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgb(var(--fg-muted) / .35); border-top-color: rgb(var(--eq-accent, var(--fg))); }
@media (prefers-reduced-motion: no-preference) { .eq-spinner { animation: eq-spin .8s linear infinite; } }
@keyframes eq-spin { to { transform: rotate(360deg); } }
.eq-card.is-disabled { cursor: not-allowed; opacity: .55; }
.eq-card.is-disabled .eq-card-icon { filter: grayscale(1); }
.eq-card.eq-none { min-height: 56px; padding-block: 8px; }
.eq-card.eq-none .eq-card-icon { height: 40px; min-width: 54px; }
.eq-card.eq-none.is-on { --eq-accent: var(--fg-muted); }
.eq-card.eq-none.is-on .eq-card-icon { color: rgb(var(--fg)); }
.eq-card-compact { min-height: 60px; }
.eq-card-compact .eq-card-icon { height: 44px; min-width: 46px; }
.eq-card:focus-visible, .eq-card:has(input:focus-visible) { outline: 2px solid rgb(var(--eq-accent, var(--fg))); outline-offset: 2px; }
@supports not selector(:has(*)) { .eq-card:focus-within { outline: 2px solid rgb(var(--eq-accent, var(--fg))); outline-offset: 2px; } }
@media (hover: hover) { .eq-card:not(.is-on):not(.is-disabled):hover { border-color: rgb(var(--fg-muted) / .75); } .eq-card:not(.is-on):not(.is-disabled):hover .eq-card-icon { color: rgb(var(--fg)); } }
@media (prefers-reduced-motion: no-preference) { .eq-card, .eq-card-icon, .eq-check, .eq-tab, .eq-room, .eq-chevron { transition: border-color .15s ease, background-color .15s ease, color .15s ease, box-shadow .15s ease, transform .15s ease; } }

/* ---- groups ---- */
.eq-selector, .eq-panel { display: grid; gap: 16px; min-width: 0; }
.eq-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.eq-panel-title { display: inline-flex; align-items: center; gap: 6px; font-size: 17px; color: rgb(var(--eq-accent)); }
.eq-pref { font-size: 14px; color: rgb(var(--fg-muted)); }
.eq-fieldset { position: relative; border: 0; margin: 0; padding: 0; min-width: 0; }
.eq-group { display: grid; gap: 10px; min-width: 0; }
.eq-group-title { display: flex; align-items: center; gap: 8px; padding: 0; margin-bottom: 10px; font-size: 15px; font-weight: 700; color: rgb(var(--fg-soft)); }
.eq-group-count { padding: 1px 8px; border-radius: 999px; background: rgb(var(--eq-accent) / .16); color: rgb(var(--eq-accent)); font-size: 13px; font-weight: 650; white-space: nowrap; }
.eq-group-combined { border-top: 1px solid rgb(var(--bp-line, var(--line))); padding-top: 16px; }
.eq-disclosure { display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; min-height: 56px; padding: 10px 14px; border-radius: 14px; border: 1px dashed rgb(var(--bp-line-strong, var(--line))); background: transparent; color: inherit; text-align: left; cursor: pointer; font: inherit; }
.eq-disclosure:focus-visible { outline: 2px solid rgb(var(--eq-accent)); outline-offset: 2px; }
.eq-disclosure .eq-group-title { margin: 0; color: rgb(var(--fg)); }
.eq-disclosure-text { display: grid; gap: 2px; min-width: 0; }
.eq-group-meta { font-size: 14px; color: rgb(var(--fg-muted)); }
.eq-chevron { flex: 0 0 auto; }
.eq-disclosure[aria-expanded='true'] .eq-chevron { transform: rotate(180deg); }
.eq-group-note { margin: 10px 0; font-size: 14px; color: rgb(var(--fg-muted)); }
.eq-more { justify-self: start; min-height: 44px; padding: 0 14px; border-radius: 10px; border: 1px solid rgb(var(--bp-line-strong, var(--line))); background: transparent; color: rgb(var(--fg)); font: inherit; font-size: 14px; font-weight: 650; cursor: pointer; }
.eq-more:focus-visible { outline: 2px solid rgb(var(--fg)); outline-offset: 2px; }

/* ---- service tabs ---- */
.eq-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border-radius: 16px; background: rgb(var(--fg-muted) / .08); border: 1px solid rgb(var(--bp-line, var(--line))); }
.eq-tab { display: grid; gap: 3px; justify-items: start; min-height: 60px; padding: 8px 12px; border-radius: 12px; border: 1px solid transparent; background: transparent; color: rgb(var(--fg-muted)); text-align: left; cursor: pointer; font: inherit; min-width: 0; }
.eq-tab-title { display: inline-flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 700; color: rgb(var(--fg)); }
.eq-tab-state { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; min-width: 0; flex-wrap: wrap; }
.eq-tab-glyphs { display: inline-flex; gap: 3px; color: rgb(var(--eq-accent)); }
.eq-tab.is-active { background: rgb(var(--bp-surface-1, var(--card))); border-color: rgb(var(--eq-accent)); box-shadow: 0 1px 0 rgb(0 0 0 / .2); }
.eq-tab.is-active .eq-tab-title { color: rgb(var(--eq-accent)); }
.eq-tab:focus-visible { outline: 2px solid rgb(var(--eq-accent)); outline-offset: 2px; }

/* ---- summary tags ---- */
.eq-tags { display: inline-flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.eq-tag { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; min-height: 30px; padding: 2px 10px 2px 6px; border-radius: 8px; border: 1px solid rgb(var(--eq-accent) / .45); background: rgb(var(--eq-accent) / .08); font-size: 14px; line-height: 1.3; }
.eq-tag-icon { color: rgb(var(--eq-accent)); display: inline-flex; }
.eq-tag-label { min-width: 0; overflow-wrap: break-word; }
.eq-tag-none, .eq-tag-empty { font-size: 14px; color: rgb(var(--fg-muted)); }
.eq-tag-empty { color: rgb(var(--eq-warn)); }
.eq-sumline { display: grid; grid-template-columns: minmax(110px, auto) minmax(0, 1fr); gap: 6px 10px; align-items: start; }
.eq-sumline-head { display: inline-flex; align-items: center; gap: 5px; min-height: 30px; font-size: 14px; color: rgb(var(--eq-accent)); font-weight: 650; }
@container (max-width: 379px) { .eq-sumline { grid-template-columns: minmax(0, 1fr); gap: 4px; } }

/* ---- rooms ---- */
.eq-layout { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr); align-items: start; }
.eq-main { container-type: inline-size; min-width: 0; }
@container (min-width: 760px) { .eq-layout { grid-template-columns: 272px minmax(0, 1fr); } }
.eq-rooms { display: grid; gap: 10px; min-width: 0; }
.eq-rooms-head { display: flex; align-items: center; gap: 8px; }
.eq-rooms-head strong { font-size: 17px; }
.eq-rooms-pos { font-size: 14px; color: rgb(var(--fg-muted)); white-space: nowrap; }
.eq-rooms-step { display: inline-flex; gap: 6px; margin-left: auto; }
.eq-iconbtn { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 10px; border: 1px solid rgb(var(--bp-line-strong, var(--line))); background: rgb(var(--bp-surface-1, var(--card))); color: rgb(var(--fg)); cursor: pointer; }
.eq-iconbtn:disabled { opacity: .4; cursor: default; }
.eq-iconbtn:focus-visible { outline: 2px solid rgb(var(--fg)); outline-offset: 2px; }
.eq-rooms-list { position: relative; list-style: none; margin: 0; padding: 2px 2px 8px; display: flex; gap: 8px; overflow-x: auto; scroll-snap-type: x proximity; overscroll-behavior-inline: contain; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
.eq-rooms-list > li { flex: 0 0 auto; scroll-snap-align: start; }
.eq-room { position: relative; display: grid; gap: 8px; width: 184px; min-height: 72px; padding: 10px 12px; border-radius: 14px; border: 1px solid rgb(var(--bp-line, var(--line))); background: rgb(var(--bp-surface-1, var(--card))); color: rgb(var(--fg)); text-align: left; cursor: pointer; font: inherit; }
.eq-room-top { display: flex; align-items: flex-start; gap: 6px; min-width: 0; }
.eq-room-icon { flex: 0 0 auto; display: inline-flex; color: rgb(var(--fg-soft)); }
.eq-room-name { flex: 1 1 auto; min-width: 0; font-weight: 650; font-size: 15px; line-height: 1.25; overflow-wrap: break-word; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
.eq-room-area { flex: 0 0 auto; font-size: 13px; color: rgb(var(--fg-muted)); font-variant-numeric: tabular-nums; }
.eq-room-eq { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; min-height: 20px; }
.eq-room-svc { display: inline-flex; align-items: center; gap: 3px; color: rgb(var(--eq-accent)); }
.eq-room-svc .eq-service-glyph { opacity: .8; }
.eq-room-dash { color: rgb(var(--fg-faint)); font-size: 13px; }
.eq-room-more { font-size: 13px; color: rgb(var(--fg-muted)); }
.eq-room-flag { font-size: 13px; color: rgb(var(--eq-warn)); }
.eq-room.is-active { border-color: rgb(var(--bp-accent, var(--fg-soft))); background: linear-gradient(rgb(var(--bp-accent, var(--fg)) / .08), rgb(var(--bp-accent, var(--fg)) / .08)), rgb(var(--bp-surface-1, var(--card))); box-shadow: inset 0 0 0 1px rgb(var(--bp-accent, var(--fg-soft))); }
.eq-room:focus-visible { outline: 2px solid rgb(var(--fg)); outline-offset: 2px; }
@container (min-width: 760px) {
  .eq-rooms { position: sticky; top: 64px; }
  .eq-rooms-list { flex-direction: column; overflow-x: visible; overflow-y: auto; max-height: calc(100dvh - 180px); padding: 2px; }
  .eq-room { width: 100%; }
}

/* ---- room editor / scheme blocks ---- */
.eq-editor { display: grid; gap: 16px; min-width: 0; }
.eq-editor-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.eq-editor-head .eq-glyph { color: rgb(var(--fg-soft)); }
.eq-editor-title { font-size: 19px; font-weight: 750; line-height: 1.25; }
.eq-editor-head .bp-muted { margin-left: auto; }
.eq-scheme-list { display: grid; gap: 8px; }
.eq-scheme-row { display: grid; gap: 8px; padding: 12px 0; border-top: 1px solid rgb(var(--bp-line, var(--line))); }
.eq-scheme-row:first-child { border-top: 0; padding-top: 2px; }
.eq-scheme-room { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 15px; }
.eq-actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 160px), 1fr)); gap: 8px; }
.eq-actions > button { min-height: 44px; }
.eq-source { display: grid; gap: 10px; }
.eq-source-grid { display: grid; gap: 10px; grid-template-columns: minmax(0, 1fr); }
@container (min-width: 560px) { .eq-source-grid { grid-template-columns: repeat(auto-fill, minmax(min(100%, 268px), 1fr)); } .eq-source-grid.is-single { grid-template-columns: minmax(0, 480px); } }
.eq-source-note { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-radius: 12px; background: rgb(var(--eq-accent) / .07); border: 1px dashed rgb(var(--eq-accent) / .45); font-size: 14px; }
.eq-source-note-label { color: rgb(var(--fg-muted)); }
.eq-source-note-hint { color: rgb(var(--fg-muted)); }
.eq-shared { display: grid; gap: 8px; padding: 12px 14px; border-radius: 14px; border: 1px solid rgb(var(--bp-line, var(--line))); background: rgb(var(--fg-muted) / .05); }
.eq-shared-title { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; }
.eq-room-heading { display: flex; align-items: center; gap: 10px; min-width: 0; }
.eq-room-heading-icon { display: inline-flex; flex: 0 0 auto; color: rgb(var(--fg-soft)); }
.eq-room-heading-name { flex: 1 1 auto; min-width: 0; font-size: 16px; font-weight: 700; line-height: 1.3; overflow-wrap: break-word; }
.eq-room-heading-meta { flex: 0 0 auto; color: rgb(var(--fg-muted)); font-size: 14px; font-variant-numeric: tabular-nums; }
.eq-towel { border-top: 1px solid rgb(var(--bp-line, var(--line))); padding-top: 16px; }
.eq-towel-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.eq-towel-qty { font-size: 14px; color: rgb(var(--fg-muted)); }
.eq-towel-remove { margin-left: auto; }
`;
