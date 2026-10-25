import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ShoppingCart } from '../../../components/Icons';
import { ServiceGlyph } from './equipmentSelection/EquipmentSelection';
import { EquipmentGlyph, type EquipmentGlyphKey } from './equipmentSelection/EquipmentIcon';
import { Notice } from './configurator/ConfiguratorUi';
import { ProductChoicePicker } from './equipmentSelection/ProductChoicePicker';
import { cartItemsFromSpec, downloadSpecPdf, lineStatuses, type SpecCartItem } from '../equipment/specExport';
import type { BuildingLoadCalculation, BuildingProject } from '../types';
import type { TowelWarmerSelection } from '../utils/towelWarmer';
import {
  DEFAULT_DESIGN_INPUTS,
  buildEquipmentSpec,
  type BomLine,
  type CatalogProduct,
  type DesignInputs,
  type EquipmentSpec,
  type FanCoilPick,
  type LineGroup,
} from '../equipment/equipmentEngine';
import { lookupCompanions, lookupSkusBatched, pickFanCoil } from '../equipment/catalogClient';
import { catalogIndex } from '../equipment/selection/catalogIndex';
import { MATCH_CLASS_LABEL, type MatchClass, type ScreeningRecord } from '../equipment/selection/types';
import { selectedOption } from '../equipment/selection/choices';
import { EQUIPMENT_CHOICES_EVENT, loadEquipmentChoices, saveEquipmentChoices, syncEquipmentChoices, withChoice, type EquipmentChoices } from '../utils/equipmentChoices';
import { EVIDENCE } from '../equipment/catalogFacts';

const GROUP_TITLE: Record<LineGroup, string> = {
  main: '1. Тепловой источник и терминальные приборы',
  distribution: '2. Гидравлическое распределение',
  pumps: '3. Циркуляция, разделение и безопасность',
  automation: '4. Автоматика и управление',
  fittings: '5. Трубы, арматура и принадлежности',
};

/** Pictogram per BOM group (presentation only). */
const GROUP_GLYPH: Record<LineGroup, EquipmentGlyphKey> = {
  main: 'hp_air_water',
  distribution: 'manifold',
  pumps: 'circ_pump',
  automation: 'controller',
  fittings: 'pipe_valve',
};

const QTY_LABEL: Record<BomLine['qtyStatus'], string> = {
  confirmed: '',
  estimated: 'ориентировочно',
  by_installer: 'по месту',
};

export function formatAmd(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} драм`;
}

function designKey(projectId: string) { return `ohmx.bp.equipmentDesign.${projectId}`; }

export function loadDesignInputs(projectId: string | null | undefined): DesignInputs {
  if (!projectId) return { ...DEFAULT_DESIGN_INPUTS };
  try {
    const raw = globalThis.localStorage?.getItem(designKey(projectId));
    return raw ? { ...DEFAULT_DESIGN_INPUTS, ...(JSON.parse(raw) as Partial<DesignInputs>) } : { ...DEFAULT_DESIGN_INPUTS };
  } catch {
    return { ...DEFAULT_DESIGN_INPUTS };
  }
}

function saveDesignInputs(projectId: string, value: DesignInputs) {
  try { globalThis.localStorage?.setItem(designKey(projectId), JSON.stringify(value)); } catch { /* storage unavailable */ }
}

interface AsyncData {
  signature: string;
  picks?: Record<string, FanCoilPick>;
  catalog?: Map<string, CatalogProduct | null>;
  companions?: Record<string, { required: CatalogProduct[]; optional: CatalogProduct[] }>;
  error?: string;
}

/** Live specification: recomputed from scratch whenever project/loads/towels/inputs change. */
export function useEquipmentSpec(project: BuildingProject, loads: BuildingLoadCalculation | null, towelWarmers: TowelWarmerSelection[], design: DesignInputs, choices: EquipmentChoices = {}) {
  // Stable identity: callers may rebuild arrays on every render.
  const baseKey = JSON.stringify([project.id, project.updatedAt, project.systemsConfiguration?.systemsRevision, project.rooms, loads?.calculatedAt, loads?.mode, towelWarmers, design, choices]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => ({ project, loads, towelWarmers, design, choices }), [baseKey]);
  const phase1 = useMemo(() => buildEquipmentSpec(base), [base]);
  const requestSignature = JSON.stringify(phase1.fanCoilRequests);
  const [data, setData] = useState<AsyncData>({ signature: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const picks: Record<string, FanCoilPick> = {};
        for (const r of phase1.fanCoilRequests) picks[r.roomId] = await pickFanCoil(r);
        const phase2 = buildEquipmentSpec({ ...base, fanCoilPicks: picks });
        const index = catalogIndex();
        const catalog = await lookupSkusBatched(phase2.skus, (sku) => index.get(sku)?.cat || undefined);
        const companions: AsyncData['companions'] = {};
        for (const p of Object.values(picks)) {
          const product = p.sku ? catalog.get(p.sku) : null;
          if (product && p.sku) companions[p.sku] = await lookupCompanions(product);
        }
        // Approved companions become choice options: their public cards (price, availability) join the catalog map.
        for (const group of Object.values(companions)) {
          for (const c of [...group.required, ...group.optional]) if (!catalog.has(c.sku)) catalog.set(c.sku, c);
        }
        if (!cancelled) setData({ signature: `${requestSignature}|${phase2.skus.join(',')}`, picks, catalog, companions });
      } catch (err) {
        if (!cancelled) setData({ signature: '', error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return () => { cancelled = true; };
    // phase1 changes with every input; the signature keeps network calls cached and ordered.
  }, [base, phase1, requestSignature]);

  const spec: EquipmentSpec = useMemo(
    () => (data.catalog ? buildEquipmentSpec({ ...base, fanCoilPicks: data.picks, catalog: data.catalog, companions: data.companions }) : phase1),
    [base, data, phase1],
  );
  return { spec, loading: !data.catalog && !data.error, error: data.error ?? null, catalog: data.catalog ?? null };
}

function LineRow({ line }: { line: BomLine }) {
  const price = line.product?.priceAmd ?? null;
  const total = price != null && line.quantity != null ? price * line.quantity : null;
  const qty = line.quantity != null ? `${line.quantity} ${line.unit}` : '—';
  const hasDetails = line.tech.length > 0 || line.evidence.length > 0 || line.candidates.length > 0 || line.details.length > 0 || Boolean(line.match);
  return (
    <div className={`bp-bom-line bp-bom-${line.status}`}>
      <div className="bp-bom-name">
        {line.status === 'catalog' ? (line.product?.name ?? line.name) : line.name}
        {line.status === 'choice' && !line.choice && <span className="bp-bom-chip">нужен выбор</span>}
        {line.choice && !selectedOption(line.choice) && <span className="bp-bom-chip warn">нужен выбор</span>}
        {line.choice && selectedOption(line.choice)?.kind === 'exclude' && <span className="bp-bom-chip">не включено</span>}
        {line.choice && selectedOption(line.choice)?.kind === 'confirm' && <span className="bp-bom-chip ok">подтверждено</span>}
        {line.choice && selectedOption(line.choice)?.kind === 'product' && <span className="bp-bom-chip ok">выбрано</span>}
        {line.status === 'missing' && <span className="bp-bom-chip warn">нет в каталоге</span>}
        {line.pending && <span className="bp-bom-chip">проверяем каталог…</span>}
        {line.match && <span className={`bp-bom-chip ${VERIFIED.has(line.match.verdict) ? 'ok' : 'warn'}`} title="Класс соответствия">{MATCH_CLASS_LABEL[line.match.verdict]}</span>}
        {line.engineering === 'preliminary' && !line.match && <span className="bp-bom-chip warn">кандидат · требует проверки</span>}
        {line.status === 'catalog' && line.product?.inStock === true && <span className="bp-bom-chip ok">в наличии</span>}
        {line.status === 'catalog' && line.product?.inStock === false && <span className="bp-bom-chip warn">под заказ</span>}
      </div>
      <div className="bp-bom-meta">
        {line.status === 'catalog' && line.sku && <span>Код: <strong>{line.sku}</strong></span>}
        <span>Кол-во: <strong>{qty}</strong>{QTY_LABEL[line.qtyStatus] ? ` (${QTY_LABEL[line.qtyStatus]})` : ''}</span>
        {line.status === 'catalog' && line.product && (
          price != null
            ? <><span>Цена: {formatAmd(price)}</span>{total != null && <span>Сумма: <strong>{formatAmd(total)}</strong></span>}</>
            : <span>Цена: по запросу</span>
        )}
      </div>
      <div className="bp-muted">{line.reason}</div>
      {line.status === 'catalog' && line.engineering === 'preliminary' && (
        <div className="bp-muted">
          Наличие: {lineStatuses(line).availability} · Цена: {lineStatuses(line).price} · Подбор: {lineStatuses(line).engineering} · Требуется: {lineStatuses(line).required}
        </div>
      )}
      {line.checks.length > 0 && <div className="bp-bom-check">Проверить: {line.checks.join(' ')}</div>}
      {hasDetails && (
        <details>
          <summary className="bp-muted">Подробнее</summary>
          <div className="bp-explain" style={{ marginTop: 4 }}>
            {line.details.length > 0 && <ul>{line.details.map((d, i) => <li key={i}>{d}</li>)}</ul>}
            {line.candidates.length > 0 && (
              <div>Варианты из каталога: <ul>{line.candidates.map((c) => <li key={c.sku}>{c.sku} — {c.name}{c.priceAmd != null ? ` · ${formatAmd(c.priceAmd)}` : ' · цена по запросу'}{c.inStock === true ? ' · в наличии' : c.inStock === false ? ' · под заказ' : ''}</li>)}</ul></div>
            )}
            {line.tech.map((t, i) => <div key={i}>{t}</div>)}
            {line.evidence.length > 0 && <div className="bp-muted">Источник: {line.evidence.map((e) => EVIDENCE[e]?.title ?? e).join('; ')}</div>}
            {line.match && <MatchDetails line={line} />}
          </div>
        </details>
      )}
    </div>
  );
}


const VERIFIED: ReadonlySet<MatchClass> = new Set<MatchClass>(['EXACT_VERIFIED', 'SUBSTITUTE_VERIFIED']);
const SCREEN_LIMIT = 12;

/** Why this product: classification, stock, and every screened catalog candidate with its verdict (no silent drops). */
function MatchDetails({ line }: { line: BomLine }) {
  const m = line.match!;
  const byVerdict = new Map<MatchClass, ScreeningRecord[]>();
  for (const r of m.screening) byVerdict.set(r.verdict, [...(byVerdict.get(r.verdict) ?? []), r]);
  const shown = m.screening.slice(0, SCREEN_LIMIT);
  return (
    <div style={{ marginTop: 6 }}>
      <div><strong>Класс:</strong> {MATCH_CLASS_LABEL[m.verdict]}</div>
      {m.reasons.length > 0 && <ul>{m.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {m.screening.length > 0 && (
        <details>
          <summary className="bp-muted">
            Проверено в каталоге: {m.screening.length} поз. ({[...byVerdict.entries()].map(([v, list]) => `${MATCH_CLASS_LABEL[v]} — ${list.length}`).join('; ')})
          </summary>
          <ul>
            {shown.map((r) => (
              <li key={r.sku}>
                {r.selected ? <strong>выбран · </strong> : null}{r.sku} — {r.name}{r.brand ? ` (${r.brand})` : ''} · {MATCH_CLASS_LABEL[r.verdict]}
                {r.inStock === true ? ' · в наличии' : r.inStock === false ? ' · под заказ' : ''}
                <div className="bp-muted">{r.reasons.slice(0, 3).join('; ')}</div>
              </li>
            ))}
          </ul>
          {m.screening.length > shown.length && <div className="bp-muted">…и ещё {m.screening.length - shown.length} поз. (полный список — в отчёте подбора)</div>}
        </details>
      )}
    </div>
  );
}

const STAGE_CHIP: Record<'done' | 'pending' | 'blocked', { cls: string; text: string }> = {
  done: { cls: 'ok', text: 'выполнено' },
  pending: { cls: '', text: 'выполняется' },
  blocked: { cls: 'warn', text: 'нужны данные' },
};

/** Real selection stages (no invented percentages), control architectures compared, independent audit. */
function SelectionReportBlock({ spec }: { spec: EquipmentSpec }) {
  const r = spec.selection;
  const errors = r.audit.findings.filter((f) => f.severity === 'error');
  return (
    <div className="bp-explain">
      <strong>Как подбиралось оборудование</strong>
      <ol style={{ margin: '4px 0 0', paddingLeft: 20 }}>
        {r.stages.map((st) => (
          <li key={st.id}>
            {st.label} <span className={`bp-bom-chip ${STAGE_CHIP[st.status].cls}`}>{STAGE_CHIP[st.status].text}</span>
            <div className="bp-muted">{st.detail}</div>
          </li>
        ))}
      </ol>
      <div style={{ marginTop: 6 }}>
        <span className={`bp-bom-chip ${r.audit.installationReady ? 'ok' : 'warn'}`}>{r.audit.installationReady ? 'готово к монтажу' : 'не готово к монтажу без проверок'}</span>{' '}
        <span className="bp-muted">{r.stockSource === 'quantity' ? 'Наличие проверено по количеству на складе.' : 'Наличие: только «в наличии / под заказ» — количество перед продажей подтвердить.'}</span>
      </div>
      {errors.length > 0 && <div className="bp-alert" style={{ marginTop: 6 }}><ul>{errors.map((f, i) => <li key={i}>{f.message}</li>)}</ul></div>}
      <details>
        <summary className="bp-muted">Подробно: схемы управления, проверка BOM, охват каталога</summary>
        {r.controlOptions.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <strong>Схемы управления зонами (сравнивались целиком)</strong>
            <ul>
              {r.controlOptions.map((o) => (
                <li key={o.id}>
                  {o.selected ? <strong>выбрана · </strong> : null}{o.label} — {o.complete ? 'все позиции найдены' : `не хватает: ${o.missing.join('; ')}`} · {MATCH_CLASS_LABEL[o.verdict]}
                  {o.notes.length > 0 && <div className="bp-muted">{o.notes.join('; ')}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {r.audit.findings.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <strong>Независимая проверка спецификации</strong>
            <ul>{r.audit.findings.map((f, i) => <li key={i}>{f.severity === 'error' ? 'Ошибка: ' : f.severity === 'warning' ? 'Внимание: ' : ''}{f.message}</li>)}</ul>
          </div>
        )}
        <div style={{ marginTop: 6 }}>
          <strong>Охват каталога по ролям</strong>
          <ul>
            {r.roles.map((role) => (
              <li key={role.role}>
                {role.label}: проверено {role.screening.length} из {role.population} профилей —{' '}
                {(['EXACT_VERIFIED', 'SUBSTITUTE_VERIFIED', 'SUBSTITUTE_CONDITIONAL', 'REQUIRES_ENGINEERING_REVIEW', 'INSUFFICIENT_DATA', 'INCOMPATIBLE', 'UNAVAILABLE'] as MatchClass[])
                  .map((v) => [v, role.screening.filter((x) => x.verdict === v).length] as const).filter(([, n]) => n > 0)
                  .map(([v, n]) => `${MATCH_CLASS_LABEL[v]} ${n}`).join(', ')}
              </li>
            ))}
          </ul>
          <div className="bp-muted">Снимок каталога: {r.snapshot.activeProducts} активных товаров, {r.snapshot.profiles} технических профилей (sha256 {r.snapshot.dbSha256.slice(0, 12)}…). Цены и наличие — из каталога в реальном времени.</div>
        </div>
      </details>
    </div>
  );
}


const kw1 = (w: number) => (w / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function StatusMark({ tone }: { tone: 'ok' | 'warn' }) {
  return tone === 'ok' ? (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><circle cx="8" cy="8" r="6.5" /><path d="m5 8.3 2 2 4-4.3" /></svg>
  ) : (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M8 1.8 15 14H1z" /><path d="M8 6.5v3.3M8 11.8v.2" /></svg>
  );
}

/** Headline results: area and design capacities as stat tiles, the scheme, and the readiness of the estimate. */
function SpecSummary({ spec, project, pending, loading }: { spec: EquipmentSpec; project: BuildingProject; pending: number; loading: boolean }) {
  const s = spec.summary;
  const rooms = project.rooms.length;
  const reservePct = Math.round(s.heatingReserveRatio * 100);
  const tiles: Array<{ key: string; label: string; value: string; unit: string; sub: string; service?: 'heating' | 'cooling' }> = [
    { key: 'area', label: 'Площадь', value: s.totalAreaM2 != null ? Number(s.totalAreaM2.toFixed(1)).toLocaleString('ru-RU') : '—', unit: 'м²', sub: `${rooms} ${rooms % 10 === 1 && rooms % 100 !== 11 ? 'помещение' : rooms % 10 >= 2 && rooms % 10 <= 4 && (rooms % 100 < 10 || rooms % 100 >= 20) ? 'помещения' : 'помещений'}` },
    { key: 'heat', label: 'Отопление', service: 'heating', value: s.heatingRequiredW != null ? kw1(s.heatingRequiredW) : '—', unit: 'кВт', sub: s.heatingRequiredW == null ? 'после расчёта нагрузок' : reservePct > 0 ? `с запасом ${reservePct}% (учтён)` : 'расчётная мощность' },
    ...(s.coolingW != null ? [{ key: 'cool', label: 'Охлаждение', service: 'cooling' as const, value: kw1(s.coolingW), unit: 'кВт', sub: 'расчётная мощность' }] : []),
    { key: 'circuits', label: 'Водяные контуры', value: String(s.circuits), unit: '', sub: s.manifoldText === 'не требуется' ? 'без коллекторов' : `коллекторы: ${s.manifoldText}` },
  ];
  const scheme = s.configuration.split(' + ').filter(Boolean);
  const missing = spec.totals.missingLines;
  return (
    <section className="bp-hero" aria-label="Итоги расчёта">
      <div className="bp-hero-tiles">
        {tiles.map((t) => (
          <div key={t.key} className="bp-stat" data-service={t.service}>
            <div className="bp-stat-label">
              {t.service && <span className="bp-svc" data-service={t.service} aria-hidden="true"><ServiceGlyph service={t.service} size={16} /></span>}
              {t.label}
            </div>
            <div className="bp-stat-value">{t.value}{t.unit && <span className="bp-stat-unit"> {t.unit}</span>}</div>
            <div className="bp-stat-sub">{t.sub}</div>
          </div>
        ))}
      </div>
      <div className="bp-hero-scheme">
        <span className="bp-muted">Схема</span>
        {scheme.map((x) => <span key={x} className="bp-hero-chip">{x}</span>)}
      </div>
      <ul className="bp-hero-status" aria-label="Готовность сметы">
        <li><span className="bp-stat-label">Подтверждённая сумма</span> <strong>{loading ? '…' : formatAmd(spec.totals.pricedSubtotalAmd)}</strong></li>
        <li className={pending ? 'is-warn' : 'is-ok'}>
          <StatusMark tone={pending ? 'warn' : 'ok'} />
          {pending ? <a href="#bp-choices">Нужно выбрать: {pending}</a> : 'Выбор сделан во всех позициях'}
        </li>
        {missing > 0 && <li className="is-warn"><StatusMark tone="warn" />Нет в каталоге: {missing}</li>}
        <li className={pending ? 'is-warn' : 'is-ok'}><StatusMark tone={pending ? 'warn' : 'ok'} />{pending ? 'PDF — после выбора' : 'PDF доступен'}</li>
      </ul>
    </section>
  );
}

/** "Нужно выбрать": every position that needs a customer decision, with the catalog options right here. */
function ChoicesBlock({ spec, catalog, onChoose }: { spec: EquipmentSpec; catalog: Map<string, CatalogProduct | null> | null; onChoose: (key: string, value: string | null) => void }) {
  const items = spec.lines.filter((l) => l.choice && l.choice.options.length > 0);
  if (!items.length) return null;
  const required = items.filter((l) => l.choice!.required);
  const open = required.filter((l) => !selectedOption(l.choice));
  return (
    <section id="bp-choices" className="bp-choices" aria-label="Нужно выбрать">
      <div className="bp-choices-head">
        <strong>Нужно выбрать</strong>
        <span className={`bp-bom-chip ${open.length ? 'warn' : 'ok'}`}>{open.length ? `осталось ${open.length} из ${required.length}` : 'всё выбрано'}</span>
      </div>
      <div className="bp-muted">Выбор сохраняется в этом проекте. PDF со спецификацией доступен, когда выбрано во всех позициях.</div>
      <ol className="bp-choice-list">
        {items.map((l) => {
          const c = l.choice!;
          const sel = selectedOption(c);
          const id = `bp-choice-${c.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
          const products = c.options.filter((o) => o.kind === 'product');
          const decisions = c.options.filter((o) => o.kind !== 'product');
          return (
            <li key={c.key} className={`bp-choice${sel ? ' is-done' : ''}`}>
              <label htmlFor={id} className="bp-choice-label">
                {sel ? <span className="bp-choice-mark is-ok"><StatusMark tone="ok" /></span> : <span className="bp-choice-mark is-warn"><StatusMark tone="warn" /></span>}
                {l.name}
              </label>
              <ProductChoicePicker choice={c} title={l.name} catalog={catalog} formatAmd={formatAmd} selected={sel} triggerId={id} onChoose={(value) => onChoose(c.key, value)} />
              {sel?.detail && <div className="bp-muted">{sel.detail}</div>}
              {!sel && products.length === 0 && decisions.length === 1 && <div className="bp-muted">Подходящих товаров в каталоге нет — подтвердите, что позиция подбирается отдельно.</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function PlantSummaryBlock({ spec }: { spec: EquipmentSpec }) {
  const p = spec.plant;
  const hp = p.heatPump;
  return (
    <div className="bp-explain">
      <div>
        <strong>Статус подбора:</strong>{' '}
        <span className={`bp-bom-chip ${p.status === 'verified' ? 'ok' : 'warn'}`}>{p.status === 'verified' ? 'подтверждён' : 'предварительный'}</span>{' '}
        <span className="bp-muted">Комплектность: из каталога {p.completeness.fromCatalog} из {p.completeness.total} ({p.completeness.percent} %) · кандидатов на проверку {p.completeness.candidatesToVerify} · нет в каталоге {p.completeness.missing} · нужен выбор {p.completeness.choices}</span>
      </div>
      {hp && (
        <div style={{ marginTop: 6 }}>
          <strong>Тепловой насос Riello</strong>
          <div className="bp-muted">
            Требуется: нагрев {hp.requiredHeatingKw != null ? `${hp.requiredHeatingKw.toFixed(2)} кВт` : '—'}, охлаждение {hp.requiredCoolingKw != null ? `${hp.requiredCoolingKw.toFixed(2)} кВт` : '—'} —{' '}
            {hp.basis === 'override' ? 'нагрузка задана инженером' : hp.basis === 'building_load' ? 'предварительный расчёт нагрузок' : hp.basis === 'connected_terminals' ? 'сумма мощностей приборов (это не нагрузка здания)' : 'основание не определено'}.
            {hp.connectedCoolingKw != null && ` Подключено фанкойлов: охлаждение ${hp.connectedCoolingKw} кВт${hp.connectedHeatingKw != null ? `, нагрев ${hp.connectedHeatingKw} кВт` : ''} (паспортные мощности, не расчёт здания).`}
          </div>
          <ul>
            {hp.candidates.map((c) => (
              <li key={c.sku}>
                {c.name} — {c.heatingKw} кВт нагрев / {c.coolingKw} кВт охлаждение · {c.inStock === true ? 'в наличии' : c.inStock === false ? 'под заказ' : 'наличие уточняется'}
                {c.sku === hp.selectedSku ? ' · ВЫБРАН (предварительно)' : ''} · {c.verdict === 'suitable_preliminary' ? 'подходит по номинальным мощностям' : c.verdict === 'insufficient' ? 'мощности недостаточно' : 'не подходит'}
              </li>
            ))}
          </ul>
        </div>
      )}
      {p.topology && (
        <div style={{ marginTop: 6 }}>
          <strong>Гидравлическая схема: {p.topology.label}</strong>
          <ul>{p.topology.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
          {p.topology.minWaterVolumeL != null && <div className="bp-muted">Минимальный объём воды: {p.topology.minWaterVolumeL} л ({p.topology.volumeBasis === 'assumption' ? 'допущение, не данные производителя' : p.topology.volumeBasis === 'override' ? 'задано инженером' : 'производитель'}); при закрытых зонах доступно ≈ {p.topology.availableVolumeWithZonesClosedL} л.</div>}
        </div>
      )}
      {p.statusReasons.length > 0 && (
        <details>
          <summary className="bp-muted">Почему подбор предварительный ({p.statusReasons.length})</summary>
          <ul>{p.statusReasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </details>
      )}
    </div>
  );
}

function DesignInputsForm({ value, onChange }: { value: DesignInputs; onChange: (v: DesignInputs) => void }) {
  const num = (raw: string) => { const n = Number(raw.replace(',', '.')); return raw.trim() === '' || !Number.isFinite(n) || n < 0 ? null : n; };
  return (
    <div className="bp-grid">
      <label className="bp-grid" style={{ gap: 4 }}>
        <span>Подключение фанкойлов</span>
        <select className="bp-input" value={value.fanCoilDistribution} onChange={(e) => onChange({ ...value, fanCoilDistribution: e.target.value as DesignInputs['fanCoilDistribution'] })}>
          <option value="manifold">Через коллектор с приводами (лучевая разводка)</option>
          <option value="branch">Тройниковая разводка, клапан на каждом фанкойле</option>
        </select>
      </label>
      <label className="bp-grid" style={{ gap: 4 }}>
        <span>Длина трубы до самого дальнего прибора, м (в одну сторону)</span>
        <input className="bp-input" inputMode="decimal" defaultValue={value.criticalPathM ?? ''} placeholder="не знаю — оценить" onBlur={(e) => onChange({ ...value, criticalPathM: num(e.target.value) })} />
      </label>
      <label className="bp-grid" style={{ gap: 4 }}>
        <span>Теплоноситель</span>
        <select className="bp-input" value={value.glycolPercent} onChange={(e) => onChange({ ...value, glycolPercent: Number(e.target.value) as DesignInputs['glycolPercent'] })}>
          <option value={0}>Вода</option>
          <option value={20}>Пропиленгликоль 20%</option>
          <option value={30}>Пропиленгликоль 30%</option>
          <option value={40}>Пропиленгликоль 40%</option>
        </select>
      </label>
      <label className="bp-grid" style={{ gap: 4 }}>
        <span>Расчётная нагрузка отопления для источника, кВт (если известна)</span>
        <input className="bp-input" inputMode="decimal" defaultValue={value.designHeatingKw ?? ''} placeholder="не задано — по расчёту / приборам" onBlur={(e) => onChange({ ...value, designHeatingKw: num(e.target.value) })} />
      </label>
      <label className="bp-grid" style={{ gap: 4 }}>
        <span>Расчётная нагрузка охлаждения, кВт (если известна)</span>
        <input className="bp-input" inputMode="decimal" defaultValue={value.designCoolingKw ?? ''} placeholder="не задано" onBlur={(e) => onChange({ ...value, designCoolingKw: num(e.target.value) })} />
      </label>
      <label className="bp-grid" style={{ gap: 4 }}>
        <span>Минимальный объём воды, л на кВт (из документации теплового насоса)</span>
        <input className="bp-input" inputMode="decimal" defaultValue={value.minWaterLPerKw ?? ''} placeholder="не знаю — допущение 10 л/кВт" onBlur={(e) => onChange({ ...value, minWaterLPerKw: num(e.target.value) })} />
      </label>
      <label style={{ display: 'flex', gap: 12, alignItems: 'center', minHeight: 44, cursor: 'pointer' }}>
        <input type="checkbox" style={{ width: 22, height: 22, flex: '0 0 auto', accentColor: 'rgb(var(--bp-accent))' }} checked={value.bypassProvided} onChange={(e) => onChange({ ...value, bypassProvided: e.target.checked })} />
        <span>Перепускной клапан сохраняет минимальный расход</span>
      </label>
      <label className="bp-grid" style={{ gap: 4 }}>
        <span>Свободный напор встроенного насоса источника, кПа (из паспорта)</span>
        <input className="bp-input" inputMode="decimal" defaultValue={value.sourcePumpHeadKPa ?? ''} placeholder="не знаю" onBlur={(e) => onChange({ ...value, sourcePumpHeadKPa: num(e.target.value) })} />
      </label>
    </div>
  );
}

export function EquipmentSpecPanel({ project, loads, towelWarmers, compact = false, onAddToCart }: {
  project: BuildingProject;
  loads: BuildingLoadCalculation | null;
  towelWarmers: TowelWarmerSelection[];
  compact?: boolean;
  /** Puts spec lines into the shop cart (injected by the page: the cart store needs the browser). */
  onAddToCart?: (items: SpecCartItem[]) => void;
}) {
  const [design, setDesign] = useState<DesignInputs>(() => loadDesignInputs(project.id));
  useEffect(() => { setDesign(loadDesignInputs(project.id)); }, [project.id]);
  const updateDesign = (v: DesignInputs) => { setDesign(v); saveDesignInputs(project.id, v); };
  const [choices, setChoices] = useState<EquipmentChoices>(() => loadEquipmentChoices(project.id));
  useEffect(() => {
    const reload = () => setChoices(loadEquipmentChoices(project.id));
    reload();
    void syncEquipmentChoices(project.id).then(reload);
    globalThis.addEventListener?.(EQUIPMENT_CHOICES_EVENT, reload);
    return () => globalThis.removeEventListener?.(EQUIPMENT_CHOICES_EVENT, reload);
  }, [project.id]);
  const setChoice = (key: string, value: string | null) => {
    const next = withChoice(loadEquipmentChoices(project.id), key, value);
    setChoices(next);
    void saveEquipmentChoices(project.id, next);
  };
  const { spec, loading, error, catalog } = useEquipmentSpec(project, loads, towelWarmers, design, choices);
  const pending = spec.pendingChoices;
  const s = spec.summary;
  const [exportState, setExportState] = useState<{ busy: boolean; message: string | null; error: boolean; skipped: string[] }>({ busy: false, message: null, error: false, skipped: [] });
  const cart = useMemo(() => cartItemsFromSpec(spec), [spec]);
  const cartWithCandidates = useMemo(() => cartItemsFromSpec(spec, { includePreliminary: true }), [spec]);
  const exportMeta = { projectName: project.name || 'Проект', serviceLabel: s.configuration, siteUrl: typeof window !== 'undefined' ? window.location.host : undefined };
  const exportPdf = async () => {
    if (spec.pendingChoices.length) {
      setExportState({ busy: false, message: `Сначала сделайте выбор: ${spec.pendingChoices.length} поз. (блок «Нужно выбрать» выше).`, error: true, skipped: [] });
      return;
    }
    setExportState((prev) => ({ ...prev, busy: true, message: null, error: false }));
    try {
      await downloadSpecPdf(spec, exportMeta);
      setExportState({ busy: false, message: 'PDF со спецификацией сохранён.', error: false, skipped: [] });
    } catch (err) {
      setExportState({ busy: false, message: `Не удалось сформировать PDF: ${err instanceof Error ? err.message : String(err)}`, error: true, skipped: [] });
    }
  };
  const addAllToCart = (withCandidates = false) => {
    if (!onAddToCart) return;
    const target = withCandidates ? cartWithCandidates : cart;
    onAddToCart(target.items);
    const skipped = target.skipped.map((l) => `${l.product?.name ?? l.name}${l.product?.inStock === false ? ' — под заказ' : l.product?.priceAmd == null ? ' — цена по запросу' : ''}`);
    setExportState({ busy: false, message: `В корзину добавлено позиций: ${target.items.length}.`, error: false, skipped });
  };
  const requestText = encodeURIComponent([...exportState.skipped, ...spec.lines.filter((l) => l.status !== 'catalog').map((l) => l.name)].slice(0, 30).join('; '));

  if (!spec.lines.length && !spec.groups.length) return null;

  if (compact) {
    const actuators = spec.lines.filter((l) => l.match?.role === 'actuator').reduce((n, l) => n + (l.quantity ?? 0), 0);
    return (
      <div className="bp-card">
        <strong>Предварительная спецификация оборудования</strong>
        <dl className="bp-kv">
          <dt>Схема</dt><dd className="bp-kv-wrap">{s.configuration}</dd>
          <dt>Водяных контуров</dt><dd>{s.circuits}</dd>
          <dt>Коллекторы</dt><dd className="bp-kv-wrap">{s.manifoldText}</dd>
          <dt>Электроприводов</dt><dd>{actuators}</dd>
          <dt>Нет в каталоге</dt><dd>{spec.totals.missingLines}</dd>
        </dl>
        <div className="bp-muted">Мощности приборов и насосы подбираются после расчёта нагрузок. Полная спецификация — на шаге «Нагрузки».</div>
      </div>
    );
  }

  const groups = (Object.keys(GROUP_TITLE) as LineGroup[])
    .map((g) => ({ g, lines: spec.lines.filter((l) => l.group === g && l.status !== 'missing') }))
    .filter((x) => x.lines.length);
  const missing = spec.lines.filter((l) => l.status === 'missing');

  return (
    <div className="bp-card bp-spec">
      <strong>Спецификация оборудования</strong>
      {loading && <div className="bp-muted">Подбираем оборудование по каталогу OhmX…</div>}
      {error && <div className="bp-alert">Каталог временно недоступен: показаны требования без кодов и цен.</div>}
      <SpecSummary spec={spec} project={project} pending={pending.length} loading={loading} />
      <ChoicesBlock spec={spec} catalog={catalog} onChoose={setChoice} />
      {spec.pumps.length > 0 && (
        <div className="bp-explain">
          <strong>Насосы (предварительно)</strong>
          <ul>
            {spec.pumps.map((p) => (
              <li key={p.groupId}>
                {p.label}: {p.flowM3h} м³/ч, напор {p.headKPa} кПа ({(p.headKPa / 9.80665).toFixed(1)} м) —{' '}
                {p.integrated ? `обслуживает ${p.integrated}` : p.selection ? p.selection.name : 'нет подходящего в каталоге'}
              </li>
            ))}
          </ul>
        </div>
      )}
      <PlantSummaryBlock spec={spec} />
      <SelectionReportBlock spec={spec} />
      {spec.warnings.length > 0 && <Notice tone="warn" title="Требует внимания"><ul>{spec.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}

      {groups.map(({ g, lines }) => (
        <section key={g} className="bp-bom-group">
          <div className="bp-h bp-bom-head"><span className="bp-bom-head-icon" aria-hidden="true"><EquipmentGlyph glyph={GROUP_GLYPH[g]} size={26} /></span>{GROUP_TITLE[g]}</div>
          {lines.map((l) => <LineRow key={l.key} line={l} />)}
        </section>
      ))}
      {missing.length > 0 && (
        <section className="bp-bom-group">
          <div className="bp-h bp-bom-head"><span className="bp-bom-head-icon is-missing" aria-hidden="true"><EquipmentGlyph glyph="fallback" size={26} /></span>6. Необходимое оборудование, которого нет в каталоге</div>
          <div className="bp-muted">Эти позиции нужны для монтажа, но их нужно закупить отдельно — код и цена не указываются.</div>
          {missing.map((l) => <LineRow key={l.key} line={l} />)}
        </section>
      )}

      <div className="bp-bom-total">
        <div>Подтверждённая сумма по позициям с ценой: <strong>{formatAmd(spec.totals.pricedSubtotalAmd)}</strong></div>
        {spec.totals.unpricedPositions.length > 0 && (
          <details>
            <summary className="bp-muted">Обязательные позиции без цены — не входят в сумму ({spec.totals.unpricedPositions.length})</summary>
            <ul>{spec.totals.unpricedPositions.map((t, i) => <li key={i}>{t}</li>)}</ul>
          </details>
        )}
        <div className="bp-muted">
          Это не полная стоимость проекта: {spec.totals.unpricedLines} поз. по запросу цены, {spec.totals.choiceLines} поз. требуют выбора, {spec.totals.missingLines} поз. нет в каталоге. Монтажные работы не включены.
        </div>
        <div className="bp-nav" style={{ marginTop: 10, flexWrap: 'wrap' }}>
          <button type="button" className="bp-btn pri" disabled={loading || exportState.busy || cart.items.length === 0 || !onAddToCart} onClick={() => addAllToCart(false)}>
            <ShoppingCart width={18} height={18} aria-hidden="true" style={{ verticalAlign: -3, marginRight: 6 }} />Подтверждённые позиции в корзину{cart.items.length ? ` (${cart.items.length})` : ''}
          </button>
          {cartWithCandidates.items.length > cart.items.length && (
            <button type="button" className="bp-btn" disabled={loading || exportState.busy || !onAddToCart} onClick={() => addAllToCart(true)}
              title="Тепловой насос, насосы без кривой Q–H и разделитель: наличие и цена подтверждены каталогом, инженерный подбор — предварительный. Добавление не является подтверждённым заказом.">
              Добавить предварительные кандидаты на инженерную проверку ({cartWithCandidates.items.length - cart.items.length})
            </button>
          )}
          <button type="button" className="bp-btn" disabled={loading || exportState.busy || pending.length > 0} onClick={() => void exportPdf()}
            title={pending.length ? 'PDF станет доступен после выбора во всех позициях блока «Нужно выбрать»' : undefined}>
            {exportState.busy ? 'Формируем PDF…' : <><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ verticalAlign: -3, marginRight: 6 }}><path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" /></svg>Скачать PDF</>}
          </button>
        </div>
        {loading && <div className="bp-muted">Кнопки станут активны после проверки каталога.</div>}
        {!loading && pending.length > 0 && (
          <div className="bp-bom-check" role="status">PDF будет доступен после выбора: осталось {pending.length} поз. — <a href="#bp-choices">перейти к выбору</a>.</div>
        )}
        {exportState.message && (
          <div className={exportState.error ? 'bp-alert' : 'bp-ok'} role="status">
            {exportState.message}{' '}
            {!exportState.error && cart.items.length > 0 && exportState.message.startsWith('В корзину') ? <Link to="/cart">Перейти в корзину</Link> : null}
            {exportState.skipped.length > 0 && (
              <div className="bp-muted" style={{ marginTop: 4 }}>
                Не добавлены (под заказ / цена по запросу / количество по месту): {exportState.skipped.slice(0, 8).join('; ')}{exportState.skipped.length > 8 ? '…' : ''}.{' '}
                <Link to={`/contacts?intent=price_eta&product=${requestText}`}>Запросить у менеджера</Link>
              </div>
            )}
          </div>
        )}
      </div>

      <details>
        <summary className="bp-muted">Для инженера: допущения, гидравлика, исходные данные</summary>
        <div className="bp-grid" style={{ marginTop: 6 }}>
          <DesignInputsForm value={design} onChange={updateDesign} />
          {spec.missingInputs.length > 0 && <div className="bp-explain"><strong>Не хватает данных</strong><ul>{spec.missingInputs.map((m, i) => <li key={i}>{m}</li>)}</ul></div>}
          <div className="bp-explain"><strong>Допущения</strong><ul>{spec.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></div>
          {spec.groups.map((g) => (
            <div key={g.id} className="bp-explain">
              <strong>{g.label}</strong>
              <div>Расчётные температуры {g.supplyC}/{g.returnC} °C{g.coolingSupplyC != null ? `, охлаждение ${g.coolingSupplyC}/${g.coolingReturnC} °C` : ''}; контуров {g.circuits}; расход {g.flowM3h.toFixed(2)} м³/ч.</div>
              {g.notes.map((n, i) => <div key={i} className="bp-muted">{n}</div>)}
            </div>
          ))}
          {spec.pumps.map((p) => (
            <div key={p.groupId} className="bp-explain">
              <strong>Напор: {p.label}</strong>
              <ul>{p.breakdown.map((b, i) => <li key={i}>{b.label}: {b.kPa.toFixed(1)} кПа{b.assumption ? ' (допущение)' : ''}</li>)}</ul>
              <div>Итого по расчётному (самому нагруженному) кольцу: <strong>{p.headKPa} кПа</strong>. Параллельные ветви не суммируются.</div>
              {p.notes.map((n, i) => <div key={i} className="bp-muted">{n}</div>)}
            </div>
          ))}
          <div className="bp-muted">Результат предварительный: подбор насосов и коллекторов нужно подтвердить по кривым и диаграммам производителя после раскладки труб.</div>
        </div>
      </details>
    </div>
  );
}
