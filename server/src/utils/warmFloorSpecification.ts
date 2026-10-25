/**
 * Specification builders + packing (engineering qty vs purchase qty).
 */
import type {
  ConsolidatedBomLine,
  PackingSource,
  PriceStatus,
  QuantityScope,
  RoomInput,
  RoomSelectionResult,
  SpecLineItem,
} from './warmFloorProjectTypes.js';

function money(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function lineTotal(unitPrice: number | null, qty: number): number | null {
  if (unitPrice == null) return null;
  return Math.round(unitPrice * qty * 100) / 100;
}

function productKey(product: any): string {
  const id = Number(product?.id || 0);
  if (id > 0) return `id:${id}`;
  const sku = String(product?.sku || product?.article || '').trim().toLowerCase();
  if (sku) return `sku:${sku}`;
  return `name:${String(product?.name || '').trim().toLowerCase()}`;
}

function priceStatusOf(product: any, unitPrice: number | null): PriceStatus {
  if (product?.isManualLineItem) return 'manual_no_price';
  if (unitPrice == null) return 'missing';
  return 'ok';
}

export interface PackingResult {
  requiredQuantity: number;
  packageSize: number | null;
  packageCount: number | null;
  purchaseQuantity: number;
  surplus: number;
  packingSource: PackingSource;
  packingNote?: string;
  unit: string;
}

/**
 * Convert engineering requirement into purchase packages without silent invention.
 */
export function resolvePacking(product: any, requiredQuantity: number, role: string): PackingResult {
  const required = Math.max(0, Number(requiredQuantity) || 0);
  const group = String(product?.accessoryGroup || product?.productType || role || '');

  // Explicit structured package length (preferred)
  const explicitLen = Number(product?.lengthPerUnitM || product?.packageLengthMeters || product?.measurement?.packageLengthMeters || 0);
  if (group === 'mounting_tape' || role.includes('mounting_tape')) {
    const requiredMeters = Number(product?.requiredLengthMeters || product?.measurement?.requiredLengthMeters || required);
    if (explicitLen > 0) {
      const packages = Math.ceil(requiredMeters / explicitLen);
      const purchasedMeters = packages * explicitLen;
      return {
        requiredQuantity: requiredMeters,
        packageSize: explicitLen,
        packageCount: packages,
        purchaseQuantity: packages,
        surplus: Math.round((purchasedMeters - requiredMeters) * 1000) / 1000,
        packingSource: product?.measurement?.packageLengthMeters || product?.lengthPerUnitM ? 'explicit' : 'name_inferred',
        packingNote: `нужно ${requiredMeters} м; упаковка ${explicitLen} m; купить ${packages} уп.`,
        unit: 'pack',
      };
    }
    // Name-inferred length already applied upstream as packageCount quantity of packs
    const inferredPacks = Number(product?.packageCount || product?.measurement?.packageCount || 0);
    const inferredLen = Number(product?.packageLengthMeters || product?.measurement?.packageLengthMeters || 0);
    if (inferredPacks > 0) {
      return {
        requiredQuantity: requiredMeters || required,
        packageSize: inferredLen || null,
        packageCount: inferredPacks,
        purchaseQuantity: inferredPacks,
        surplus: inferredLen > 0 ? Math.max(0, inferredPacks * inferredLen - (requiredMeters || required)) : 0,
        packingSource: 'name_inferred',
        packingNote: 'длина упаковки выведена из названия; lengthPerUnitM в каталоге отсутствует',
        unit: 'pack',
      };
    }
    return {
      requiredQuantity: requiredMeters || required,
      packageSize: null,
      packageCount: null,
      purchaseQuantity: Math.max(1, Math.ceil(requiredMeters || required || 1)),
      surplus: 0,
      packingSource: 'none',
      packingNote: 'нет данных об упаковке ленты; qty = оценка требуемых единиц',
      unit: 'm_est',
    };
  }

  // Discrete products (mats, cables, thermostats, protection): one sales unit = one piece
  const qty = Math.max(role === 'missing_main' ? 0 : 1, Math.ceil(required));
  return {
    requiredQuantity: required,
    packageSize: 1,
    packageCount: qty,
    purchaseQuantity: qty,
    surplus: Math.max(0, qty - required),
    packingSource: 'unit_is_package',
    packingNote: '1 позиция каталога = 1 продаваемая единица',
    unit: 'pcs',
  };
}

function toSpecLine(
  room: RoomInput,
  product: any,
  role: string,
  requiredQty: number,
  reasonCodes: string[],
  selectedTierRole: string | null | undefined,
  quantityScope: QuantityScope,
): SpecLineItem {
  const unitPrice = money(product?.price);
  const packing = resolvePacking(product, requiredQty, role);
  const purchaseQuantity = packing.purchaseQuantity;
  const status = priceStatusOf(product, unitPrice);
  return {
    lineId: `${room.id}:${productKey(product)}:${role}`,
    roomId: room.id,
    roomName: room.name,
    productId: Number(product?.id) > 0 ? Number(product.id) : null,
    sku: String(product?.sku || product?.article || ''),
    article: String(product?.article || product?.sku || ''),
    name: String(
      product?.name
      || (product?.nameCode === 'manualItems.sensorConduit' ? 'Гофра для датчика пола (оценка)' : '')
      || product?.nameCode
      || role
    ),
    brand: String(product?.brand || ''),
    role,
    accessoryGroup: product?.accessoryGroup || product?.productType || null,
    requiredQuantity: packing.requiredQuantity,
    quantity: purchaseQuantity,
    unit: packing.unit,
    packageSize: packing.packageSize,
    packageCount: packing.packageCount,
    purchaseQuantity,
    surplus: packing.surplus,
    packingSource: packing.packingSource,
    packingNote: packing.packingNote,
    quantityScope,
    engineeringReasonCodes: reasonCodes,
    isManualLineItem: Boolean(product?.isManualLineItem),
    selectedTierRole: selectedTierRole || null,
    unitPrice,
    currency: String(product?.currency || 'AMD'),
    lineTotal: status === 'ok' ? lineTotal(unitPrice, purchaseQuantity) : null,
    priceStatus: status,
    productType: product?.productType || null,
  };
}

export function buildRoomSpecification(
  room: RoomInput,
  selection: RoomSelectionResult,
): SpecLineItem[] {
  const lines: SpecLineItem[] = [];
  const selected = selection.selectedVariant;
  if (!selected?.mainProduct) {
    lines.push({
      lineId: `${room.id}:missing:main`,
      roomId: room.id,
      roomName: room.name,
      productId: null,
      sku: '',
      article: '',
      name: 'Heating element not selected',
      brand: '',
      role: 'missing_main',
      accessoryGroup: 'heating_element',
      requiredQuantity: 0,
      quantity: 0,
      unit: 'pcs',
      packageSize: null,
      packageCount: null,
      purchaseQuantity: 0,
      surplus: 0,
      packingSource: 'none',
      quantityScope: 'per_heating_kit',
      engineeringReasonCodes: selection.selectionReasons.map((r) => r.code),
      isManualLineItem: true,
      selectedTierRole: null,
      unitPrice: null,
      currency: 'AMD',
      lineTotal: null,
      priceStatus: 'manual_no_price',
      productType: null,
    });
    return lines;
  }

  const mainQty = Math.max(
    1,
    Number(selected.mainProduct.quantity || selection.multiUnit?.unitCount || 1),
  );
  lines.push(toSpecLine(
    room,
    {
      ...selected.mainProduct,
      // expose unit power metadata if present
    },
    'heating_element',
    mainQty,
    [
      'spec.mainFromSelection',
      ...(selection.multiUnit && selection.multiUnit.unitCount > 1 ? ['spec.multiUnit'] : []),
      `spec.tier.${selected.brandTier || selected.role}`,
      'spec.scope.per_heating_kit',
    ],
    selected.role,
    'per_heating_kit',
  ));

  for (const acc of selection.accessories || []) {
    if (!acc) continue;
    const scope = (acc.quantityScope || 'per_room') as QuantityScope;
    const reqQty = Number(acc.quantity || 1);
    const product = {
      ...acc,
      requiredLengthMeters: acc.requiredLengthMeters || acc.measurement?.requiredLengthMeters,
      packageLengthMeters: acc.packageLengthMeters || acc.measurement?.packageLengthMeters,
      packageCount: acc.packageCount || acc.measurement?.packageCount,
      lengthPerUnitM: acc.lengthPerUnitM,
    };
    lines.push(toSpecLine(
      room,
      product,
      String(acc.role || acc.accessoryGroup || 'accessory'),
      reqQty,
      [
        acc.selectionReasonCode || 'spec.accessory',
        acc.required ? 'spec.required' : 'spec.optional',
        `spec.scope.${scope}`,
      ].filter(Boolean),
      selected.role,
      scope,
    ));
  }

  return lines;
}

export function consolidateBom(lines: SpecLineItem[]): ConsolidatedBomLine[] {
  const map = new Map<string, ConsolidatedBomLine>();

  for (const line of lines) {
    if (line.role === 'missing_main') continue;
    const purchaseKey = line.productId != null
      ? `id:${line.productId}`
      : `sku:${String(line.sku || line.article || line.name).toLowerCase()}`;

    const existing = map.get(purchaseKey);
    const addQty = line.purchaseQuantity;
    if (!existing) {
      map.set(purchaseKey, {
        key: purchaseKey,
        productId: line.productId,
        sku: line.sku,
        article: line.article,
        name: line.name,
        brand: line.brand,
        role: line.role,
        quantity: addQty,
        requiredQuantity: line.requiredQuantity,
        purchaseQuantity: addQty,
        surplus: line.surplus,
        unit: line.unit,
        unitPrice: line.unitPrice,
        currency: line.currency,
        lineTotal: line.lineTotal,
        priceStatus: line.priceStatus,
        isManualLineItem: line.isManualLineItem,
        quantityScope: line.quantityScope,
        packingSource: line.packingSource,
        roomDistribution: [{
          roomId: line.roomId,
          roomName: line.roomName,
          quantity: addQty,
        }],
      });
      continue;
    }

    existing.quantity += addQty;
    existing.purchaseQuantity += addQty;
    existing.requiredQuantity += line.requiredQuantity;
    existing.surplus += line.surplus;
    const dist = existing.roomDistribution.find((d) => d.roomId === line.roomId);
    if (dist) dist.quantity += addQty;
    else {
      existing.roomDistribution.push({
        roomId: line.roomId,
        roomName: line.roomName,
        quantity: addQty,
      });
    }

    const existingOk = existing.priceStatus === 'ok' && existing.unitPrice != null;
    const lineOk = line.priceStatus === 'ok' && line.unitPrice != null;
    if (existingOk && lineOk) {
      existing.lineTotal = Math.round(Number(existing.unitPrice) * existing.purchaseQuantity * 100) / 100;
    } else if (!lineOk) {
      // Keep first non-ok status if any line lacks price
      if (existing.priceStatus === 'ok') existing.priceStatus = line.priceStatus;
      existing.unitPrice = existing.unitPrice ?? line.unitPrice;
      if (existing.priceStatus !== 'ok') existing.lineTotal = null;
    } else {
      existing.unitPrice = existing.unitPrice ?? line.unitPrice;
      existing.lineTotal = existing.unitPrice != null
        ? Math.round(Number(existing.unitPrice) * existing.purchaseQuantity * 100) / 100
        : null;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** Invariant: sum(roomDistribution.qty) === purchaseQuantity */
export function assertBomRoomDistributionInvariant(bom: ConsolidatedBomLine[]): {
  ok: boolean;
  violations: Array<{ key: string; bomQty: number; distSum: number }>;
} {
  const violations: Array<{ key: string; bomQty: number; distSum: number }> = [];
  for (const line of bom) {
    const distSum = (line.roomDistribution || []).reduce((s, d) => s + Number(d.quantity || 0), 0);
    if (Math.abs(distSum - Number(line.purchaseQuantity || line.quantity || 0)) > 1e-9) {
      violations.push({ key: line.key, bomQty: line.purchaseQuantity || line.quantity, distSum });
    }
  }
  return { ok: violations.length === 0, violations };
}
