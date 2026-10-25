import { useEffect, useMemo, useState } from 'react';
import { useWarmFloorProjectStore } from '../store/useWarmFloorProjectStore';
import type { ProjectRoomInput } from '../types/project';

const ROOM_TYPES = [
  { value: 'bedroom', label: 'Спальня' },
  { value: 'bathroom', label: 'Ванная' },
  { value: 'kitchen', label: 'Кухня' },
  { value: 'living_room', label: 'Гостиная' },
  { value: 'corridor', label: 'Прихожая' },
  { value: 'balcony', label: 'Балкон' },
  { value: 'office', label: 'Кабинет' },
  { value: 'child_room', label: 'Детская' },
  { value: 'other', label: 'Другое' },
];

function roomTypeLabel(type: string) {
  return ROOM_TYPES.find((t) => t.value === type)?.label || type;
}

export function suggestRoomName(roomType: string, existing: Array<{ roomType?: string; name?: string }>) {
  const base = roomTypeLabel(roomType);
  const same = existing.filter((r) => r.roomType === roomType);
  if (same.length === 0) return base;
  const used = new Set<number>();
  for (const r of same) {
    const n = String(r.name || '').trim();
    if (n === base) {
      used.add(1);
      continue;
    }
    if (n.startsWith(`${base} `)) {
      const tail = n.slice(base.length + 1).trim();
      const num = Number(tail);
      if (Number.isFinite(num) && num > 0) used.add(num);
    }
  }
  let i = 1;
  while (used.has(i)) i += 1;
  return `${base} ${i}`;
}

const emptyRoom = (existing: Array<{ roomType?: string; name?: string }> = []): ProjectRoomInput => {
  const roomType = 'bedroom';
  return {
    name: suggestRoomName(roomType, existing),
    roomType,
    roomAreaM2: 12,
    installationAreaM2: 10,
    heatingPurpose: 'comfort_floor',
    floorCovering: 'tile',
    substrateType: 'tile_adhesive',
    insulationLevel: 'standard',
    systemPreference: 'auto',
    wetZone: false,
  };
};

function StatusBadge({ status }: { status?: string | null }) {
  const color = status === 'PASS' ? '#12b886' : status === 'WARNING' ? '#f59f00' : status === 'BLOCKED' ? '#fa5252' : '#868e96';
  return <span style={{ color, fontWeight: 700 }}>{status || '—'}</span>;
}

function money(v: number | null | undefined) {
  if (v == null || Number.isNaN(Number(v))) return '—';
  return `${Math.round(Number(v)).toLocaleString('ru-RU')} AMD`;
}

function prettyName(name?: string | null) {
  if (!name) return '—';
  if (name === 'manualItems.sensorConduit') return 'Гофра для датчика пола (оценка)';
  return name;
}

function prettyPacking(note?: string | null) {
  if (!note) return null;
  if (note.startsWith('each catalog')) return '1 позиция каталога = 1 продаваемая единица';
  if (note.startsWith('required ')) return note.replace('required', 'нужно').replace('package', 'упаковка').replace('buy', 'купить').replace('pack(s)', 'уп.');
  return note;
}

const fieldStyle = {
  display: 'grid' as const,
  gap: 4,
  fontSize: 14,
};

const inputStyle = {
  width: '100%',
  minHeight: 40,
  borderRadius: 8,
  border: '1px solid #495057',
  background: 'transparent',
  color: 'inherit',
  padding: '8px 10px',
};

const btnStyle = {
  minHeight: 40,
  borderRadius: 999,
  border: '1px solid #495057',
  background: 'transparent',
  color: 'inherit',
  padding: '8px 14px',
  cursor: 'pointer',
};

function groupSpecByRoom(lines: any[]) {
  const order: string[] = [];
  const map = new Map<string, { roomId: string; roomName: string; lines: any[] }>();
  for (const line of lines || []) {
    const key = String(line.roomId || line.roomName || 'unknown');
    if (!map.has(key)) {
      order.push(key);
      map.set(key, { roomId: line.roomId, roomName: line.roomName || 'Помещение', lines: [] });
    }
    map.get(key)!.lines.push(line);
  }
  return order.map((k) => map.get(k)!);
}

/**
 * Full multi-room project wizard UI.
 */
export function WarmFloorProjectWizard() {
  const {
    project, view, step, isLoading, error, hydrated,
    hydrateFromStorage, createProject, addRoom, updateRoom, removeRoom,
    recalculate, confirm, setPreferredRole, setStep, startNewProject, updateProjectMeta,
  } = useWarmFloorProjectStore();

  const [draftRoom, setDraftRoom] = useState<ProjectRoomInput>(emptyRoom());
  const [editingRoomId, setEditingRoomId] = useState<string | null>(null);
  const [nameTouched, setNameTouched] = useState(false);
  const [createMeta, setCreateMeta] = useState<{ objectType: string; objectTotalAreaM2: string }>({
    objectType: 'private_house',
    objectTotalAreaM2: '',
  });
  const [expandedBom, setExpandedBom] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void hydrateFromStorage();
  }, [hydrateFromStorage]);

  // Re-sync when returning to this page via SPA navigation (storage id may differ from memory).
  useEffect(() => {
    const onFocus = () => { void hydrateFromStorage(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [hydrateFromStorage]);

  useEffect(() => {
    if (!project) {
      setDraftRoom(emptyRoom());
      return;
    }
    if (!editingRoomId && !nameTouched) {
      setDraftRoom((prev) => ({
        ...prev,
        name: suggestRoomName(prev.roomType, project.rooms),
      }));
    }
  }, [project?.rooms?.length, project?.id]);

  const roomsResult = view?.rooms || project?.draftResult?.rooms || project?.confirmedSnapshot?.rooms || [];
  const bom = view?.consolidatedBom || project?.draftResult?.consolidatedBom || project?.confirmedSnapshot?.consolidatedBom || [];
  const estimate = view?.estimate || project?.draftResult?.estimatePreview || project?.confirmedSnapshot?.estimate || null;
  const overall = view?.overallStatus || project?.draftResult?.overallStatus || project?.confirmedSnapshot?.overallStatus;
  const immutable = project?.status === 'confirmed';
  const specLines = view?.specificationByRoom || project?.draftResult?.specificationByRoom || project?.confirmedSnapshot?.specificationByRoom || [];
  const specGroups = useMemo(() => groupSpecByRoom(specLines), [specLines]);

  const sumRoomArea = useMemo(
    () => (project?.rooms || []).reduce((s, r) => s + Number(r.roomAreaM2 || 0), 0),
    [project?.rooms],
  );
  const objectTotal = project?.objectTotalAreaM2 != null ? Number(project.objectTotalAreaM2) : null;

  const steps = useMemo(() => ([
    { id: 'project', label: 'Проект' },
    { id: 'rooms', label: 'Помещения' },
    { id: 'preview', label: 'Предварительный проект' },
    { id: 'confirm', label: 'Подтверждение' },
    { id: 'specification', label: 'Спецификация' },
    { id: 'estimate', label: 'Смета' },
  ] as const), []);

  const startEdit = (room: any) => {
    if (!room?.id) return;
    setEditingRoomId(room.id);
    setNameTouched(true);
    setDraftRoom({
      name: room.name,
      roomType: room.roomType,
      roomAreaM2: Number(room.roomAreaM2 || 0),
      installationAreaM2: Number(room.installationAreaM2 || 0),
      heatingPurpose: room.heatingPurpose || 'comfort_floor',
      floorCovering: room.floorCovering || 'tile',
      substrateType: room.substrateType || 'concrete_screed',
      insulationLevel: room.insulationLevel || 'standard',
      systemPreference: room.systemPreference || 'auto',
      wetZone: room.wetZone,
      heatLossW: room.heatLossW ?? null,
    });
  };

  const onTypeChange = (type: string) => {
    const next = {
      ...draftRoom,
      roomType: type,
      wetZone: type === 'bathroom' ? true : draftRoom.wetZone,
    };
    if (!nameTouched || !editingRoomId) {
      next.name = suggestRoomName(type, project?.rooms || []);
    }
    setDraftRoom(next);
  };

  const submitRoomForm = async (e: any) => {
    e.preventDefault();
    const payload = {
      ...draftRoom,
      wetZone: draftRoom.roomType === 'bathroom' ? true : draftRoom.wetZone,
    };
    if (editingRoomId) {
      await updateRoom(editingRoomId, payload);
      setEditingRoomId(null);
    } else {
      await addRoom(payload);
    }
    setNameTouched(false);
    const after = useWarmFloorProjectStore.getState().project?.rooms || [];
    setDraftRoom(emptyRoom(after));
  };

  if (!hydrated) {
    return <div style={{ padding: 16 }}>Загрузка проекта…</div>;
  }

  return (
    <div className="wf-project" style={{ maxWidth: 960, margin: '0 auto', padding: '8px 12px 96px', display: 'grid', gap: 16 }}>
      <header>
        <h1 style={{ margin: 0, fontSize: 'clamp(1.25rem, 4vw, 1.75rem)' }}>Проект тёплого пола</h1>
        <p style={{ margin: '8px 0 0', opacity: 0.8, fontSize: 14 }}>
          Несколько помещений → инженерный расчёт → подбор → спецификация по комнатам → закупочная ведомость → смета
        </p>
        {project && (
          <p style={{ margin: '8px 0 0', fontSize: 13, opacity: 0.75 }}>
            {project.name} · <strong>{project.status}</strong>
            {project.objectType ? <> · {project.objectType === 'private_house' ? 'Собственный дом' : project.objectType === 'apartment' ? 'Квартира' : project.objectType}</> : null}
            {overall ? <> · overall <StatusBadge status={overall} /></> : null}
          </p>
        )}
      </header>

      <nav style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} aria-label="Шаги проекта">
        {steps.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStep(s.id as any)}
            disabled={!project && s.id !== 'project'}
            style={{
              ...btnStyle,
              border: step === s.id ? '2px solid #12b886' : '1px solid #495057',
              background: step === s.id ? 'rgba(18,184,134,0.15)' : 'transparent',
              opacity: !project && s.id !== 'project' ? 0.5 : 1,
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {error && (
        <div role="alert" style={{ color: '#ffa8a8', padding: 12, border: '1px solid #fa5252', borderRadius: 8, whiteSpace: 'pre-wrap', fontSize: 14 }}>
          {error}
        </div>
      )}
      {isLoading && <div aria-live="polite">Загрузка…</div>}

      {step === 'project' && (
        <section style={{ display: 'grid', gap: 12 }}>
          {project ? (
            <div style={{ border: '1px solid #495057', borderRadius: 12, padding: 14, display: 'grid', gap: 10 }}>
              <div style={{ fontSize: 14 }}>
                Сохранённый проект: <strong>{project.name}</strong> ({project.status})
                <div style={{ opacity: 0.7, wordBreak: 'break-all', fontSize: 12 }}>id {project.id}</div>
                <div style={{ marginTop: 4, fontSize: 13 }}>Помещений: {project.rooms?.length || 0}</div>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button
                  type="button"
                  style={{ ...btnStyle, borderColor: '#12b886', fontWeight: 700 }}
                  onClick={() => setStep(project.status === 'confirmed' ? 'specification' : (project.draftResult ? 'preview' : 'rooms'))}
                >
                  Продолжить проект
                </button>
                <button type="button" style={btnStyle} onClick={() => startNewProject()}>
                  Новый проект
                </button>
              </div>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
                «Новый проект» убирает текущий из активного экрана. Backend-проект не удаляется. Подтверждённый snapshot сохраняется на сервере.
              </p>
            </div>
          ) : (
            <>
              <label style={fieldStyle}>Тип объекта
                <select
                  style={inputStyle}
                  value={createMeta.objectType}
                  onChange={(e) => setCreateMeta({ ...createMeta, objectType: e.target.value })}
                >
                  <option value="private_house">Собственный дом</option>
                  <option value="apartment">Квартира</option>
                  <option value="other">Другое</option>
                </select>
              </label>
              <label style={fieldStyle}>
                Общая площадь объекта, м² (необязательно)
                <input
                  style={inputStyle}
                  type="number"
                  min={0}
                  step={0.1}
                  placeholder="например 180"
                  value={createMeta.objectTotalAreaM2}
                  onChange={(e) => setCreateMeta({ ...createMeta, objectTotalAreaM2: e.target.value })}
                />
              </label>
              <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
                Общая площадь объекта — характеристика здания. Список помещений и их площади заполняются отдельно; сумма комнат не обязана сразу равняться общей площади.
              </p>
              <button
                type="button"
                style={{ ...btnStyle, borderColor: '#12b886', fontWeight: 700 }}
                onClick={() => createProject('Новый проект тёплого пола', {
                  objectType: createMeta.objectType,
                  objectTotalAreaM2: createMeta.objectTotalAreaM2 === '' ? null : Number(createMeta.objectTotalAreaM2),
                })}
                disabled={isLoading}
              >
                Создать новый проект
              </button>
            </>
          )}
        </section>
      )}

      {project && step === 'rooms' && (
        <section style={{ display: 'grid', gap: 16 }}>
          <h2 style={{ margin: 0 }}>Помещения ({project.rooms.length})</h2>

          {!immutable && (
            <div style={{ display: 'grid', gap: 10, border: '1px solid #343a40', borderRadius: 10, padding: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 10 }}>
                <label style={fieldStyle}>Тип объекта
                  <select
                    style={inputStyle}
                    value={project.objectType || ''}
                    onChange={(e) => updateProjectMeta({ objectType: e.target.value || null })}
                  >
                    <option value="">—</option>
                    <option value="private_house">Собственный дом</option>
                    <option value="apartment">Квартира</option>
                    <option value="other">Другое</option>
                  </select>
                </label>
                <label style={fieldStyle}>Общая площадь объекта, м²
                  <input
                    style={inputStyle}
                    type="number"
                    min={0}
                    step={0.1}
                    value={project.objectTotalAreaM2 ?? ''}
                    placeholder="необязательно"
                    onChange={(e) => updateProjectMeta({
                      objectTotalAreaM2: e.target.value === '' ? null : Number(e.target.value),
                    })}
                  />
                </label>
              </div>
              <div style={{ fontSize: 13, opacity: 0.85 }}>
                Сумма введённых помещений: <strong>{sumRoomArea.toFixed(1)} м²</strong>
                {objectTotal != null ? <> из общей площади объекта <strong>{objectTotal.toFixed(1)} м²</strong></> : null}
                . Это контроль, а не блокировка — можно считать поэтапно.
              </div>
            </div>
          )}

          {immutable && (
            <p style={{ color: '#f59f00', margin: 0 }}>
              Проект подтверждён и зафиксирован. Изменение помещений недоступно. Чтобы изменить — «Новый проект».
            </p>
          )}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {project.rooms.map((room) => (
              <li key={room.id} style={{ border: '1px solid #495057', borderRadius: 10, padding: 12 }}>
                <strong>{room.name}</strong>
                <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
                  тип: {roomTypeLabel(room.roomType)} · укладка {room.installationAreaM2} / {room.roomAreaM2} м² · {room.heatingPurpose}
                </div>
                {!immutable && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    <button type="button" style={btnStyle} onClick={() => startEdit(room)}>Изменить</button>
                    <button type="button" style={btnStyle} onClick={() => room.id && removeRoom(room.id)}>Удалить</button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {!immutable && (
            <form
              style={{ display: 'grid', gap: 10, border: '1px dashed #868e96', borderRadius: 10, padding: 12 }}
              onSubmit={submitRoomForm}
            >
              <h3 style={{ margin: 0 }}>{editingRoomId ? 'Редактировать помещение' : 'Добавить помещение'}</h3>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>
                Один тип можно добавить несколько раз (Спальня 1, Спальня 2…). Инженерный тип остаётся отдельным полем; название можно переименовать вручную.
              </p>
              <label style={fieldStyle}>Название
                <input
                  style={inputStyle}
                  value={draftRoom.name}
                  onChange={(e) => { setNameTouched(true); setDraftRoom({ ...draftRoom, name: e.target.value }); }}
                  required
                />
              </label>
              <label style={fieldStyle}>Тип (roomPurpose)
                <select style={inputStyle} value={draftRoom.roomType} onChange={(e) => onTypeChange(e.target.value)}>
                  {ROOM_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))', gap: 10 }}>
                <label style={fieldStyle}>Площадь помещения, м²
                  <input style={inputStyle} type="number" step="0.1" min="0.1" value={draftRoom.roomAreaM2}
                    onChange={(e) => setDraftRoom({ ...draftRoom, roomAreaM2: Number(e.target.value) })} required />
                </label>
                <label style={fieldStyle}>Площадь укладки, м²
                  <input style={inputStyle} type="number" step="0.1" min="0.1" value={draftRoom.installationAreaM2}
                    onChange={(e) => setDraftRoom({ ...draftRoom, installationAreaM2: Number(e.target.value) })} required />
                </label>
              </div>
              <label style={fieldStyle}>Режим
                <select style={inputStyle} value={draftRoom.heatingPurpose} onChange={(e) => setDraftRoom({ ...draftRoom, heatingPurpose: e.target.value })}>
                  <option value="comfort_floor">Комфортный подогрев</option>
                  <option value="additional_heating">Дополнительный</option>
                  <option value="main_heating">Основной обогрев</option>
                </select>
              </label>
              {draftRoom.heatingPurpose === 'main_heating' && (
                <label style={fieldStyle}>Теплопотери, Вт (для ENGINEERING / heat-loss)
                  <input style={inputStyle} type="number" step="1" min="0"
                    value={draftRoom.heatLossW ?? ''}
                    placeholder="если нет — режим QUICK/estimate + WARNING"
                    onChange={(e) => setDraftRoom({
                      ...draftRoom,
                      heatLossW: e.target.value === '' ? null : Number(e.target.value),
                    })}
                  />
                </label>
              )}
              <label style={fieldStyle}>Покрытие
                <select style={inputStyle} value={draftRoom.floorCovering} onChange={(e) => setDraftRoom({ ...draftRoom, floorCovering: e.target.value })}>
                  <option value="tile">Плитка</option>
                  <option value="porcelain">Керамогранит</option>
                  <option value="laminate">Ламинат</option>
                  <option value="vinyl">Винил</option>
                  <option value="engineered_wood">Инженерная доска</option>
                </select>
              </label>
              <label style={fieldStyle}>Основание
                <select style={inputStyle} value={draftRoom.substrateType} onChange={(e) => setDraftRoom({ ...draftRoom, substrateType: e.target.value })}>
                  <option value="tile_adhesive">Плиточный клей</option>
                  <option value="concrete_screed">Стяжка</option>
                  <option value="old_tile">Старая плитка</option>
                  <option value="wood">Дерево</option>
                </select>
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button type="submit" style={{ ...btnStyle, borderColor: '#12b886' }}>
                  {editingRoomId ? 'Сохранить помещение' : 'Добавить помещение'}
                </button>
                {editingRoomId && (
                  <button type="button" style={btnStyle} onClick={() => { setEditingRoomId(null); setNameTouched(false); setDraftRoom(emptyRoom(project.rooms)); }}>
                    Отмена
                  </button>
                )}
              </div>
            </form>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <label style={fieldStyle}>Вариант комплектации
              <select
                style={inputStyle}
                disabled={immutable}
                value={project.preferredBundleRole || 'premium'}
                onChange={(e) => setPreferredRole(e.target.value)}
              >
                <option value="premium">Premium</option>
                <option value="standard">Standard</option>
                <option value="economy">Economy</option>
              </select>
            </label>
            {!immutable && (
              <button type="button" style={{ ...btnStyle, borderColor: '#12b886', fontWeight: 700 }}
                onClick={() => recalculate()} disabled={!project.rooms.length || isLoading}>
                Инженерный расчёт и подбор
              </button>
            )}
          </div>
        </section>
      )}

      {project && (step === 'preview' || step === 'confirm') && (
        <section style={{ display: 'grid', gap: 16 }}>
          <h2 style={{ margin: 0 }}>Предварительный проект · статус <StatusBadge status={overall} /></h2>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>
            Heat-loss mode: LIMITED. Без введённых теплопотерь используется QUICK / estimate (preset W/m²).
          </p>
          {roomsResult.map((item: any) => {
            const room = item.room || item;
            const eng = item.engineering;
            const sel = item.selection;
            const power = eng?.power;
            const main = sel?.selectedVariant?.mainProduct;
            const variants = sel?.variants || [];
            return (
              <article key={room.id || room.name} style={{ border: '1px solid #495057', borderRadius: 12, padding: 12 }}>
                <h3 style={{ marginTop: 0 }}>{room.name}</h3>
                <div>Инженерия: <StatusBadge status={eng?.status} /> · Подбор: <StatusBadge status={sel?.status} /></div>
                {power && (
                  <ul style={{ paddingLeft: 18, fontSize: 14 }}>
                    <li>Общая площадь: {power.roomAreaM2} м²</li>
                    <li>Обогреваемая: {power.heatedAreaM2} м²</li>
                    <li>Режим расчёта: {power.calculationMode === 'heat_loss' ? 'ENGINEERING / heat-loss' : 'QUICK / estimate (preset W/m²)'}</li>
                    <li>Требуемая мощность: {power.requiredPowerW} Вт</li>
                    <li>Design power: {power.designPowerW ?? power.requiredPowerW} Вт</li>
                    <li>Установленная: {power.installedPowerW ?? '—'} Вт</li>
                    <li>Удельная: {power.installedWm2 ?? power.targetWm2} Вт/м²</li>
                    <li>Запас/дефицит: +{power.powerReserveW ?? 0} / −{power.powerDeficitW ?? 0} Вт</li>
                    <li>Покрытие max {power.coveringMaxWm2} Вт/м²</li>
                    {sel?.circuitSummary && (
                      <li>Контуры: kits={sel.circuitSummary.heatingKits}, zones={sel.circuitSummary.controlZones}, I={sel.circuitSummary.actualCurrentA} A</li>
                    )}
                  </ul>
                )}
                {main ? (
                  <div style={{ fontSize: 14 }}>
                    <strong>Нагрев:</strong> {main.brand} {prettyName(main.name)} ({main.sku || main.article}) × {main.quantity || sel?.multiUnit?.unitCount || 1}
                    <div style={{ fontSize: 13, opacity: 0.85 }}>роль: {sel?.selectedRole} · tier: {sel?.selectedVariant?.brandTier}</div>
                  </div>
                ) : (
                  <div style={{ color: '#fa5252' }}>Подходящий нагревательный элемент не найден</div>
                )}
                {variants.length > 1 && (
                  <div style={{ marginTop: 8, fontSize: 13 }}>
                    <strong>Варианты Premium/Standard/Economy:</strong>
                    <ul style={{ paddingLeft: 18 }}>
                      {variants.slice(0, 5).map((v: any) => (
                        <li key={`${v.role}-${v.mainProduct?.id}`}>
                          {v.role} · {v.brandTier} · {v.mainProduct?.sku || v.mainProduct?.name} · {v.isPrimary ? 'primary' : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 14 }}>
                  <strong>Комплектация:</strong>
                  <ul style={{ paddingLeft: 18 }}>
                    {(sel?.accessories || []).map((a: any) => (
                      <li key={`${a.id}-${a.role}`}>{prettyName(a.name || a.sku)} · {a.accessoryGroup || a.role} × {a.quantity || 1}</li>
                    ))}
                  </ul>
                </div>
                {(eng?.issues || []).concat(sel?.issues || []).filter((i: any) => i.severity !== 'info').length > 0 && (
                  <div style={{ fontSize: 13 }}>
                    <strong>Замечания:</strong>
                    <ul style={{ paddingLeft: 18 }}>
                      {(eng?.issues || []).concat(sel?.issues || []).filter((i: any) => i.severity !== 'info').map((i: any, idx: number) => (
                        <li key={idx}>{i.severity}: {i.code}{i.message ? ` — ${i.message}` : ''}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </article>
            );
          })}

          {!immutable && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={btnStyle} onClick={() => setStep('rooms')}>Изменить помещения</button>
              <button type="button" style={btnStyle} onClick={() => recalculate()}>Пересчитать проект</button>
              <button
                type="button"
                disabled={overall === 'BLOCKED' || isLoading}
                onClick={() => confirm()}
                style={{ ...btnStyle, fontWeight: 700, borderColor: overall === 'BLOCKED' ? '#fa5252' : '#12b886' }}
              >
                Подтвердить проект
              </button>
            </div>
          )}
          {overall === 'BLOCKED' && (
            <p style={{ color: '#fa5252' }}>Подтверждение недоступно, пока есть BLOCKED-помещения.</p>
          )}
          {immutable && (
            <p style={{ color: '#12b886' }}>Проект подтверждён. Snapshot зафиксирован и восстанавливается при возврате на страницу.</p>
          )}
        </section>
      )}

      {project && (step === 'specification' || step === 'estimate' || (immutable && step !== 'rooms' && step !== 'project' && step !== 'preview' && step !== 'confirm')) && (
        <section style={{ display: 'grid', gap: 20 }}>
          <h2 style={{ margin: 0 }}>{immutable ? 'Подтверждённый проект' : 'Спецификация / смета'} · <StatusBadge status={overall} /></h2>

          <div>
            <h3 style={{ marginTop: 0 }}>СПЕЦИФИКАЦИЯ ПО ПОМЕЩЕНИЯМ</h3>
            <div style={{ display: 'grid', gap: 14 }}>
              {specGroups.length === 0 && <p style={{ opacity: 0.7 }}>Нет строк спецификации — выполните расчёт.</p>}
              {specGroups.map((group) => (
                <article key={group.roomId || group.roomName} style={{ border: '1px solid #495057', borderRadius: 12, padding: 12 }}>
                  <h4 style={{ margin: '0 0 8px' }}>{group.roomName}</h4>
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560, fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th align="left">Артикул</th>
                          <th align="left">Оборудование</th>
                          <th align="right">Кол-во</th>
                          <th align="left">Роль</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.lines.map((line: any) => (
                          <tr key={line.lineId}>
                            <td style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>{line.article || line.sku || '—'}</td>
                            <td style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>
                              {prettyName(line.name)}
                              {line.packingNote ? <div style={{ fontSize: 12, opacity: 0.75 }}>{prettyPacking(line.packingNote)}</div> : null}
                            </td>
                            <td align="right" style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>{line.purchaseQuantity ?? line.quantity}</td>
                            <td style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>{line.role}{line.quantityScope ? ` · ${line.quantityScope}` : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div>
            <h3>ОБЩАЯ ЗАКУПОЧНАЯ ВЕДОМОСТЬ</h3>
            <p style={{ fontSize: 13, opacity: 0.75, marginTop: 0 }}>
              Одинаковые SKU объединены. Распределение по комнатам сохранено (roomDistribution).
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {bom.map((line: any) => {
                const key = line.key || line.sku || line.article || line.name;
                const open = expandedBom[key];
                return (
                  <li key={key} style={{ border: '1px solid #343a40', borderRadius: 10, padding: 12 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <strong>{prettyName(line.name)}</strong>
                      <span style={{ fontSize: 14 }}>{line.purchaseQuantity ?? line.quantity} {line.unit || 'шт.'}</span>
                    </div>
                    <div style={{ fontSize: 13, opacity: 0.8 }}>{line.article || line.sku || '—'}</div>
                    {(line.requiredQuantity != null && line.purchaseQuantity != null && line.requiredQuantity !== line.purchaseQuantity) && (
                      <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                        требуется {line.requiredQuantity}
                        {line.packageSize ? ` · упаковка ${line.packageSize}` : ''}
                        {` · покупается ${line.purchaseQuantity}`}
                        {line.surplus ? ` · остаток ${line.surplus}` : ''}
                      </div>
                    )}
                    <button
                      type="button"
                      style={{ ...btnStyle, marginTop: 8, minHeight: 32, fontSize: 12 }}
                      onClick={() => setExpandedBom((p) => ({ ...p, [key]: !open }))}
                    >
                      {open ? 'Скрыть распределение' : 'Показать по комнатам'}
                    </button>
                    {open && (
                      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
                        {(line.roomDistribution || []).map((d: any) => (
                          <li key={`${d.roomId}-${d.roomName}`}>{d.roomName} — {d.quantity}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          {(step === 'estimate' || step === 'specification' || immutable) && (
            <div>
              <h3>ИТОГОВАЯ СМЕТА</h3>
              {!estimate ? <p>Смета появится после расчёта/подтверждения.</p> : (
                <>
                  <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640, fontSize: 13 }}>
                      <thead>
                        <tr>
                          <th align="left">Артикул</th>
                          <th align="left">Товар</th>
                          <th align="right">Закупка</th>
                          <th align="right">Цена</th>
                          <th align="right">Сумма</th>
                        </tr>
                      </thead>
                      <tbody>
                        {estimate.lines?.map((line: any, idx: number) => (
                          <tr key={idx}>
                            <td style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>{line.article || line.sku || '—'}</td>
                            <td style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>
                              {prettyName(line.name)}
                              {(line.requiredQuantity != null && line.packageSize) ? (
                                <div style={{ fontSize: 11, opacity: 0.75 }}>
                                  требуется {line.requiredQuantity}
                                  {line.packageSize ? ` · уп. ${line.packageSize}` : ''}
                                  {` · покупка ${line.purchaseQuantity}`}
                                  {line.surplus ? ` · остаток ${line.surplus}` : ''}
                                </div>
                              ) : null}
                              {(line.roomDistribution || []).length > 0 && (
                                <div style={{ fontSize: 11, opacity: 0.7 }}>
                                  {(line.roomDistribution || []).map((d: any) => `${d.roomName}: ${d.quantity}`).join('; ')}
                                </div>
                              )}
                            </td>
                            <td align="right" style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>{line.purchaseQuantity ?? line.quantity}</td>
                            <td align="right" style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>
                              {line.priceMissing || line.unitPrice == null ? 'цена отсутствует / уточняется' : money(line.unitPrice)}
                            </td>
                            <td align="right" style={{ padding: '6px 4px', borderBottom: '1px solid #343a40' }}>
                              {line.priceMissing || line.lineTotal == null ? '—' : money(line.lineTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p><strong>Итого оборудование:</strong> {estimate.incompleteCommercial && estimate.equipmentSubtotal == null ? 'неполная (есть позиции без цены)' : money(estimate.equipmentSubtotal)}</p>
                  <p><strong>Итого проект:</strong> {estimate.incompleteCommercial && estimate.projectTotal == null ? 'неполная коммерческая сумма' : money(estimate.projectTotal)}</p>
                  {estimate.incompleteCommercial && (
                    <p style={{ color: '#f59f00' }}>
                      Коммерческие данные неполны (нет цены у {estimate.missingPriceCount} позиций). Общая сумма помечена как неполная. Инженерная спецификация остаётся валидной.
                    </p>
                  )}
                </>
              )}
            </div>
          )}

          {immutable && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button type="button" style={btnStyle} onClick={() => startNewProject()}>Создать новый проект</button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default WarmFloorProjectWizard;
