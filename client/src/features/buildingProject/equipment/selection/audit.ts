/**
 * Independent second pass over a finished specification (directive §21).
 *
 * It does not trust the ranking that produced the lines: quantities, stock, classifications,
 * the control chain and the mandatory roles are re-derived from the spec itself.
 * The audit only reports; it never upgrades a classification.
 */
import { catalogIndex, num, type CatalogIndex } from './catalogIndex';
import { stockCheck, type InventoryInput } from './inventory';
import { SELECTABLE, type MatchClass, type StockCheck } from './types';

export interface AuditLine {
  key: string;
  sku: string | null;
  name: string;
  quantity: number | null;
  status: 'catalog' | 'missing' | 'choice';
  group: string;
  optional?: boolean;
  engineering: 'preliminary' | 'verified' | null;
  match?: { verdict: MatchClass; role?: string };
  /** Resolved customer choice "not part of this specification". */
  excluded?: boolean;
  /** Customer choice resolved (product, exclusion or confirmation). */
  choiceResolved?: boolean;
}

export interface AuditInput {
  lines: AuditLine[];
  /** Actuated circuits per zone (UFH loops, fan-coil manifold outlets) the chain must serve. */
  actuatedCircuits: number;
  /** Zones that need a room thermostat (chain). */
  zones: Array<{ id: string; circuits: number }>;
  /** Unused manifold outlets that need plugs (sum over manifolds, both bars). */
  plugOutlets: number;
  /** Mandatory functional roles the design requires (role id → human label). */
  requiredRoles: Array<{ role: string; label: string; satisfiedBy: (l: AuditLine) => boolean }>;
}

export interface AuditFinding {
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export interface AuditResult {
  findings: AuditFinding[];
  /** Per SKU aggregated stock check of the whole BOM. */
  stock: Array<{ sku: string; name: string; required: number; check: StockCheck }>;
  /** True only when nothing is missing, nothing is conditional/under review and stock is confirmed. */
  installationReady: boolean;
  /** Shortages / unconfirmed quantities. */
  stockConfirmed: boolean;
}

export function auditSpecification(input: AuditInput, inv: InventoryInput, index: CatalogIndex = catalogIndex()): AuditResult {
  const findings: AuditFinding[] = [];
  const mandatory = input.lines.filter((l) => !l.optional);

  // 1. Classification integrity: nothing outside the selectable classes may stand as a catalog line.
  for (const l of mandatory) {
    if (l.status === 'catalog' && l.match && !SELECTABLE.has(l.match.verdict) && l.match.verdict !== 'REQUIRES_ENGINEERING_REVIEW') {
      findings.push({ severity: 'error', message: `«${l.name}» стоит в спецификации с классом ${l.match.verdict} — такой товар нельзя выбирать автоматически.` });
    }
    if (l.engineering === 'verified' && l.match && l.match.verdict !== 'EXACT_VERIFIED' && l.match.verdict !== 'SUBSTITUTE_VERIFIED') {
      findings.push({ severity: 'error', message: `«${l.name}» помечен как подтверждённый, но класс ${l.match.verdict}.` });
    }
  }

  // 2. Aggregated stock per SKU (shared items appear once with the summed quantity).
  const need = new Map<string, { name: string; qty: number }>();
  for (const l of mandatory) {
    if (l.status !== 'catalog' || !l.sku || l.quantity == null || l.excluded) continue;
    const cur = need.get(l.sku) ?? { name: l.name, qty: 0 };
    cur.qty += l.quantity;
    need.set(l.sku, cur);
  }
  const stock = [...need.entries()].map(([sku, v]) => ({ sku, name: v.name, required: v.qty, check: stockCheck(sku, v.qty, inv) }));
  for (const s of stock) {
    if (s.check.status === 'INSUFFICIENT') findings.push({ severity: 'warning', message: `«${s.name}»: нужно ${s.required}, на складе ${s.check.available} — не хватает ${s.required - (s.check.available ?? 0)} шт.` });
    if (s.check.status === 'NOT_IN_STOCK') findings.push({ severity: 'info', message: `«${s.name}»: нет на складе — под заказ.` });
  }
  const stockConfirmed = stock.length > 0 && stock.every((s) => s.check.status === 'SUFFICIENT');
  if (stock.some((s) => s.check.status === 'IN_STOCK_QTY_UNVERIFIED')) {
    findings.push({ severity: 'info', message: 'Количество на складе не подтверждено (публичный каталог отдаёт только «в наличии / под заказ»); перед продажей проверить остатки.' });
  }

  // 3. Control chain consistency: actuators = actuated circuits; thermostat outputs cover the actuators.
  const actuatorLines = mandatory.filter((l) => l.match?.role === 'actuator');
  const actuators = actuatorLines.reduce((s, l) => s + (l.quantity ?? 0), 0);
  if (input.actuatedCircuits > 0 && actuators !== input.actuatedCircuits) {
    const missingActuators = mandatory.some((l) => l.status === 'missing' && /привод/i.test(l.name));
    findings.push({
      severity: missingActuators ? 'warning' : 'error',
      message: `Термоприводов ${actuators}, а контуров с регулированием ${input.actuatedCircuits}${missingActuators ? ' (часть приводов — в ненайденных позициях)' : ''}.`,
    });
  }
  for (const l of mandatory.filter((x) => x.match?.role === 'thermostat' && x.sku)) {
    const maxAct = num(index.get(l.sku!), 'max_actuators');
    if (maxAct != null) {
      const worst = input.zones.reduce((m, z) => Math.max(m, z.circuits), 0);
      if (worst > maxAct) findings.push({ severity: 'error', message: `Термостат ${l.sku}: в зоне ${worst} приводов > ${maxAct} по даташиту.` });
    }
  }

  // 4. Plugs for unused outlets
  const plugs = mandatory.filter((l) => l.match?.role === 'plug').reduce((s, l) => s + (l.quantity ?? 0), 0);
  if (input.plugOutlets > 0 && plugs !== input.plugOutlets) {
    findings.push({ severity: 'warning', message: `Неиспользуемых выходов коллекторов ${input.plugOutlets}, заглушек ${plugs}.` });
  }

  // 5. Mandatory roles of the design
  for (const r of input.requiredRoles) {
    if (!input.lines.some(r.satisfiedBy)) findings.push({ severity: 'error', message: `Нет позиции для обязательной функции: ${r.label}.` });
  }

  // 6. Duplicated SKUs as separate lines (shared equipment must be one line)
  // (per-room customer choices may legitimately use the same model in several rooms)
  const seen = new Map<string, number>();
  for (const l of input.lines) if (l.sku && !l.key.startsWith('choice:')) seen.set(l.sku, (seen.get(l.sku) ?? 0) + 1);
  for (const [sku, n] of seen) if (n > 1) findings.push({ severity: 'error', message: `Код ${sku} встречается в ${n} строках — общий элемент должен быть одной строкой.` });

  const open = mandatory.filter((l) => !(l.status === 'choice' && l.choiceResolved) && (l.status !== 'catalog' || l.engineering === 'preliminary')
    || (l.match && l.match.verdict !== 'EXACT_VERIFIED' && l.match.verdict !== 'SUBSTITUTE_VERIFIED'));
  if (open.length) findings.push({ severity: 'info', message: `Позиций, требующих выбора, проверки или поставки: ${open.length} из ${mandatory.length}.` });
  const installationReady = !findings.some((f) => f.severity === 'error') && open.length === 0 && stockConfirmed;
  return { findings, stock, installationReady, stockConfirmed };
}
