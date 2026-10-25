/**
 * Room equipment selection on top of matchWarmFloorProductsV3.
 * Hard compatibility is never bypassed.
 * Multi-unit path rebuilds accessories from combined electrical load.
 */
import { matchWarmFloorProductsV3 } from './warmFloorMatcherV3.js';
import { buildProfessionalAccessories } from './warmFloorAccessories.js';
import {
  calculateWarmFloorV3,
  evaluateProductCompatibility,
  resolveDesignTargets,
  scoreWarmFloorCandidate,
  brandTier,
  normalizeWarmFloorInputV3,
  getWarmFloorConfigV3,
} from './warmFloorEngineV3.js';
import { bindInstalledPower, roomInputToEngineRaw } from './warmFloorRoomEngineering.js';
import { warmFloorProductRows } from './warmFloorProducts.js';
import type {
  EngineeringIssue,
  EngineeringStatus,
  QuantityScope,
  RoomEngineeringResult,
  RoomInput,
  RoomSelectionResult,
} from './warmFloorProjectTypes.js';

function worstStatus(statuses: EngineeringStatus[]): EngineeringStatus {
  if (statuses.includes('BLOCKED')) return 'BLOCKED';
  if (statuses.includes('WARNING')) return 'WARNING';
  return 'PASS';
}

function pickVariant(variants: any[], preferredRole: string | null | undefined) {
  if (!variants.length) return null;
  if (preferredRole) {
    const exact = variants.find((v) => v.role === preferredRole || v.bundleType === preferredRole);
    if (exact) return exact;
    if (preferredRole === 'standard') {
      return variants.find((v) => v.role === 'replacement_standard' || v.brandTier === 'standard') || variants[0];
    }
    if (preferredRole === 'economy') {
      return variants.find((v) => v.role === 'replacement_economy' || v.brandTier === 'economy') || variants[0];
    }
  }
  return variants.find((v) => v.isPrimary) || variants[0];
}

function cloneProduct(product: any, qty: number) {
  return {
    ...product,
    quantity: qty,
    powerW: Number(product.powerW || 0) * qty,
    matAreaM2: product.matAreaM2 != null ? Number(product.matAreaM2) * qty : product.matAreaM2,
    cableLengthM: product.cableLengthM != null ? Number(product.cableLengthM) * qty : product.cableLengthM,
    _unitCount: qty,
    _unitPowerW: Number(product.powerW || 0),
  };
}

function tryMultiUnitPacking(inputNorm: any, design: any, products: any[], maxUnits = 6) {
  const mains = products.filter((p) => p.productType === 'heating_mat' || p.productType === 'heating_cable');
  const candidates: any[] = [];

  for (const product of mains) {
    for (let n = 2; n <= maxUnits; n++) {
      const combined = cloneProduct(product, n);
      const gate = evaluateProductCompatibility(combined, inputNorm, design);
      if (!gate.ok) continue;
      const calc = calculateWarmFloorV3(inputNorm, combined, design);
      calc.unitCount = n;
      calc.unitPowerW = Number(product.powerW || 0);
      candidates.push({
        product: combined,
        baseProduct: product,
        calc,
        engineeringScore: scoreWarmFloorCandidate(combined, inputNorm, design, calc),
        tier: brandTier(`${product.brand} ${product.name}`),
        unitCount: n,
        strategy: product.productType === 'heating_mat' ? 'multi_mat' : 'multi_cable',
      });
    }
  }

  candidates.sort((a, b) => a.engineeringScore - b.engineeringScore);
  return candidates;
}

function scopeForGroup(group: string): QuantityScope {
  switch (group) {
    case 'thermostat':
    case 'mounting_box':
    case 'floor_sensor':
    case 'corrugated_tube':
      return 'per_control_zone';
    case 'circuit_breaker':
    case 'rcd':
    case 'rcbo':
    case 'contactor':
      return 'per_room_circuit';
    case 'mounting_tape':
      return 'length_based';
    case 'heating_mat':
    case 'heating_cable':
    case 'heating_element':
      return 'per_heating_kit';
    default:
      return 'per_room';
  }
}

function annotateAccessories(accessories: any[], controlZones: number) {
  return (accessories || []).map((item) => {
    const group = String(item.accessoryGroup || item.productType || '');
    const scope = scopeForGroup(group);
    // Do not multiply thermostat/box by heating kit count — only by control zones (default 1).
    let quantity = Number(item.quantity || 1);
    if (scope === 'per_control_zone') {
      quantity = Math.max(1, controlZones) * Math.max(1, Number(item.quantity || 1) === 0 ? 1 : 1);
      // base accessory builders already emit qty=1 per zone path; keep 1 zone default
      quantity = Math.max(1, controlZones);
      if (group === 'mounting_tape') quantity = Number(item.quantity || 1);
    }
    if (group === 'mounting_tape') {
      quantity = Number(item.quantity || 1);
    }
    return {
      ...item,
      quantity,
      quantityScope: group === 'mounting_tape' ? 'length_based' : scope,
      controlZones,
    };
  });
}

function buildKitForLoad(allProducts: any[], calc: any, mainProductType: string) {
  const config = getWarmFloorConfigV3();
  const actualCurrentA = Number(calc?.actualCurrentA || 0);
  const kit = buildProfessionalAccessories(allProducts, {
    mainProductType,
    actualCurrentA,
    mountingTapeLengthM: calc?.mountingTapeLengthM || null,
  }, config);
  return kit;
}

export function selectRoomEquipment(
  room: RoomInput,
  engineering: RoomEngineeringResult,
  options: {
    preferredBundleRole?: string | null;
    products?: any[];
    allowMultiUnit?: boolean;
    /** Explicit user-chosen variant role after review */
    lockedVariantRole?: string | null;
    /** Control zones in room; default 1 (one thermostat zone) */
    controlZones?: number;
  } = {},
): RoomSelectionResult {
  const issues: EngineeringIssue[] = [];
  const selectionReasons: EngineeringIssue[] = [];
  const controlZones = Math.max(1, Number(options.controlZones || 1));

  if (!engineering.validation.valid) {
    return {
      roomId: room.id,
      status: 'BLOCKED',
      issues: [...engineering.issues, { code: 'selection.skippedInvalidInput', severity: 'block' }],
      matcherStatus: 'invalid_input',
      selectedRole: null,
      variants: [],
      selectedVariant: null,
      accessories: [],
      accessoryReplacements: [],
      missingAccessoryRequirements: [],
      multiUnit: null,
      selectionReasons: [{ code: 'selection.blockedByEngineering', severity: 'block' }],
      controlZones,
      circuitSummary: null,
    };
  }

  if (engineering.power.preferredSystem === 'blocked' && engineering.status === 'BLOCKED') {
    return {
      roomId: room.id,
      status: 'BLOCKED',
      issues: [...engineering.issues],
      matcherStatus: 'no_match',
      selectedRole: null,
      variants: [],
      selectedVariant: null,
      accessories: [],
      accessoryReplacements: [],
      missingAccessoryRequirements: [],
      multiUnit: null,
      selectionReasons: [{
        code: 'selection.noSafeSystemForSubstrate',
        severity: 'block',
        params: { preferredSystem: engineering.power.preferredSystem },
      }],
      controlZones,
      circuitSummary: null,
    };
  }

  const raw = roomInputToEngineRaw(room);
  const products = Array.isArray(options.products) ? options.products : warmFloorProductRows();
  const matchOptions = { products };
  const matcher = matchWarmFloorProductsV3(raw, matchOptions);
  let variants = Array.isArray(matcher.variants) ? [...matcher.variants] : [];
  let multiUnit: RoomSelectionResult['multiUnit'] = {
    strategy: 'single',
    unitCount: 1,
    reasonCodes: [],
  };
  let matcherStatus = matcher.status;
  let accessories = matcher.accessories || [];
  let accessoryReplacements = matcher.accessoryReplacements || [];
  let missing = matcher.missingAccessoryRequirements || [];

  // Annotate single-unit kits with quantity scope + rebuild protection from selected calc when needed
  if (variants[0]?.calculation) {
    const kit = buildKitForLoad(products, variants[0].calculation, variants[0].mainProduct?.productType);
    accessories = kit.accessories;
    accessoryReplacements = kit.accessoryReplacements;
    missing = kit.missingAccessoryRequirements;
    variants = variants.map((v, idx) => {
      if (idx !== 0) return v;
      return { ...v, accessories, accessoryReplacements };
    });
  }

  if ((!variants.length || matcher.status === 'no_match') && options.allowMultiUnit !== false) {
    const config = getWarmFloorConfigV3();
    const inputNorm = normalizeWarmFloorInputV3(raw);
    const design = resolveDesignTargets(inputNorm, config);
    const packed = tryMultiUnitPacking(inputNorm, design, products);
    if (packed.length) {
      const byTier: Record<string, any[]> = { premium: [], standard: [], economy: [] };
      for (const item of packed) byTier[item.tier]?.push(item);
      const firstTier = ['premium', 'standard', 'economy'].find((t) => byTier[t].length) || 'economy';
      const primary = byTier[firstTier][0];
      const draft: any[] = [];
      const pushV = (item: any, role: string, isPrimary = false) => {
        if (!item) return;
        if (draft.some((d) => d.mainProduct?.id === item.baseProduct.id && d.mainProduct?.quantity === item.unitCount)) return;
        const kit = buildKitForLoad(products, item.calc, item.baseProduct.productType);
        draft.push({
          bundleType: role,
          role,
          labelCode: `variantRoles.${role}`,
          isPrimary,
          brandTier: item.tier,
          mainProduct: {
            ...item.baseProduct,
            brandTier: item.tier,
            quantity: item.unitCount,
            unitPowerW: item.baseProduct.powerW,
            combinedPowerW: item.calc.selectedProductTotalPowerW,
          },
          calculation: item.calc,
          explanation: {
            whyCode: 'explanations.multiUnit',
            whyParams: {
              unitCount: item.unitCount,
              requiredPowerW: design.requiredTotalPowerW,
              unitPowerW: item.baseProduct.powerW,
              combinedPowerW: item.calc.selectedProductTotalPowerW,
            },
          },
          warnings: [{
            code: 'warnings.multiUnitPack',
            params: { unitCount: item.unitCount, strategy: item.strategy },
          }],
          engineeringScore: item.engineeringScore,
          accessories: kit.accessories,
          accessoryReplacements: kit.accessoryReplacements,
          missingAccessoryRequirements: kit.missingAccessoryRequirements,
          multiUnitMeta: {
            strategy: item.strategy,
            unitCount: item.unitCount,
          },
        });
      };

      pushV(primary, firstTier === 'premium' ? 'premium' : firstTier === 'standard' ? 'standard' : 'economy', true);
      if (firstTier === 'premium') {
        pushV(byTier.standard[0], 'replacement_standard');
        pushV(byTier.economy[0], 'replacement_economy');
      } else if (firstTier === 'standard') {
        pushV(byTier.economy[0], 'replacement_economy');
      }

      variants = draft;
      const primaryVariant = draft[0];
      accessories = primaryVariant.accessories;
      accessoryReplacements = primaryVariant.accessoryReplacements;
      missing = primaryVariant.missingAccessoryRequirements || [];
      multiUnit = {
        strategy: primary.strategy,
        unitCount: primary.unitCount,
        reasonCodes: ['selection.multiUnitRequired'],
      };
      matcherStatus = 'ok_multi_unit';
      selectionReasons.push({
        code: 'selection.multiUnitRequired',
        severity: 'warning',
        params: {
          unitCount: primary.unitCount,
          strategy: primary.strategy,
          unitSku: primary.baseProduct.sku,
          unitPowerW: primary.baseProduct.powerW,
          combinedPowerW: primary.calc.selectedProductTotalPowerW,
          note: 'Accessories sized from combined circuit load, not multiplied per heating kit',
        },
      });
      issues.push({
        code: 'selection.multiUnitPackUsed',
        severity: 'warning',
        params: { unitCount: primary.unitCount, strategy: primary.strategy },
      });
    }
  }

  const preferred = options.lockedVariantRole || options.preferredBundleRole;
  const selected = pickVariant(variants, preferred);
  if (selected) {
    accessories = annotateAccessories(selected.accessories || accessories, controlZones);
    accessoryReplacements = selected.accessoryReplacements || accessoryReplacements;
    missing = selected.missingAccessoryRequirements || missing;
    if (selected.multiUnitMeta) {
      multiUnit = {
        strategy: selected.multiUnitMeta.strategy,
        unitCount: selected.multiUnitMeta.unitCount,
        reasonCodes: multiUnit?.reasonCodes || ['selection.multiUnitRequired'],
      };
    } else if (!multiUnit || matcherStatus !== 'ok_multi_unit') {
      multiUnit = {
        strategy: 'single',
        unitCount: Math.max(1, Number(selected.mainProduct?.quantity || 1)),
        reasonCodes: [],
      };
    }
  } else {
    accessories = annotateAccessories(accessories, controlZones);
  }

  if (!selected) {
    selectionReasons.push({
      code: 'selection.noCompatibleProduct',
      severity: 'block',
      params: {
        requiredPowerW: engineering.power.requiredPowerW,
        targetWm2: engineering.power.targetWm2,
        coveringMaxWm2: engineering.power.coveringMaxWm2,
        preferredSystem: engineering.power.preferredSystem,
        rejectedByCode: matcher.selectionMeta?.rejectedByCode || {},
        requiredCharacteristics: matcher.fallback?.requiredCharacteristics || null,
      },
    });
    issues.push({
      code: 'selection.noMatch',
      severity: 'block',
      params: { matcherStatus, fallback: matcher.fallback || null },
    });
  } else {
    selectionReasons.push({
      code: 'selection.variantChosen',
      severity: 'info',
      params: {
        role: selected.role,
        brandTier: selected.brandTier,
        productId: selected.mainProduct?.id,
        sku: selected.mainProduct?.sku,
        heatingKits: multiUnit?.unitCount || 1,
        powerW: selected.calculation?.selectedProductTotalPowerW
          ?? selected.calculation?.selectedPowerW,
      },
    });
    selectionReasons.push({
      code: 'selection.accessoryQuantityPolicy',
      severity: 'info',
      params: {
        controlZones,
        heatingKits: multiUnit?.unitCount || 1,
        policy: {
          thermostat: 'per_control_zone',
          mounting_box: 'per_control_zone',
          corrugated_tube: 'per_control_zone',
          protection: 'per_room_circuit_from_combined_current',
          mounting_tape: 'length_based_on_installation_area',
          heating_element: 'per_heating_kit',
        },
      },
    });
  }

  if (missing.length) {
    issues.push({
      code: 'selection.missingRequiredAccessories',
      severity: 'warning',
      params: { count: missing.length, groups: missing.map((m: any) => m.group) },
    });
  }

  const actualCurrentA = Number(selected?.calculation?.actualCurrentA || 0);
  const circuitSummary = selected ? {
    heatingKits: multiUnit?.unitCount || 1,
    controlZones,
    installedPowerW: Number(selected.calculation?.selectedProductTotalPowerW || selected.calculation?.selectedPowerW || 0),
    actualCurrentA,
    voltageV: Number(selected.calculation?.voltageV || engineering.power.voltageV || 230),
    protectionScheme: (accessories.find((a: any) => a.protectionScheme)?.protectionScheme) || null,
  } : null;

  const status = worstStatus([
    selected ? 'PASS' : 'BLOCKED',
    issues.some((i) => i.severity === 'block') ? 'BLOCKED' : 'PASS',
    issues.some((i) => i.severity === 'warning') || engineering.status === 'WARNING' ? 'WARNING' : 'PASS',
  ]);

  return {
    roomId: room.id,
    status,
    issues,
    matcherStatus,
    selectedRole: selected?.role || null,
    variants,
    selectedVariant: selected,
    accessories,
    accessoryReplacements,
    missingAccessoryRequirements: missing,
    multiUnit: selected ? multiUnit : null,
    selectionReasons,
    controlZones,
    circuitSummary,
  };
}

export function applySelectionToEngineering(
  engineering: RoomEngineeringResult,
  selection: RoomSelectionResult,
): RoomEngineeringResult {
  const installed = Number(
    selection.selectedVariant?.calculation?.selectedProductTotalPowerW
    ?? selection.selectedVariant?.calculation?.selectedPowerW
    ?? 0,
  );
  if (!installed) return engineering;
  return bindInstalledPower(engineering, installed);
}
