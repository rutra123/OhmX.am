import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import ExcelJS, { type Workbook as ExcelWorkbook } from "exceljs";
import { ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES } from "../utils/buildingProjectConfiguratorAdapter/types.js";
import { SERVICE_APPLICABILITY } from "../utils/catalogMatcher/policy.js";
import type { CanonicalEquipmentType, CanonicalParameterCode } from "../utils/catalogMatcher/types.js";

export const REQUIRED_SHEET_NAMES = [
  "Summary",
  "Products",
  "Missing Required",
  "Missing Compatibility",
  "Engineering Values",
  "Operating Points",
  "Sources",
] as const;

const REQUIREMENT_LEVELS = [
  "REQUIRED_FOR_SELECTION",
  "REQUIRED_FOR_COMPATIBILITY",
  "RECOMMENDED",
  "INFORMATIONAL",
] as const;
const VALUE_STATUSES = ["KNOWN", "UNKNOWN", "CONFLICT", "REVIEW_REQUIRED"] as const;
const MANUAL_COLUMNS = ["VALUE_TO_FILL", "SOURCE_DOCUMENT", "SOURCE_PAGE", "NOTE"] as const;
const MATCHER_SCOPE = new Set<string>(ENGINEERING_CATALOG_SCOPE_EQUIPMENT_TYPES);
const WRITE_SQL = /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|REPLACE|VACUUM|REINDEX|MERGE|TRUNCATE|ATTACH|DETACH)\b/i;
const WRITE_PRAGMA = /^\s*PRAGMA\s+(writable_schema|journal_mode|wal_checkpoint|user_version|application_id)\b/i;

export type RequirementLevel = (typeof REQUIREMENT_LEVELS)[number];
export type ValueStatus = (typeof VALUE_STATUSES)[number];
export type EngineeringStatus =
  | "ENGINEERING_READY"
  | "ENGINEERING_INCOMPLETE"
  | "NO_ENGINEERING_PROFILE"
  | "EQUIPMENT_TYPE_UNKNOWN"
  | "NOT_ENGINEERING_EQUIPMENT";
export type ConditionScope = "VALUE_OPERATING_POINT" | "PRODUCT_ANY";
export type CellValue = string | number | boolean | null;
export type ExportRow = Record<string, CellValue>;

export interface InventoryProductSourceRow {
  product_id: number;
  sku: string;
  name_ru: string;
  name_hy: string | null;
  name_en: string | null;
  brand_id: number | null;
  brand: string | null;
  category_id: number | null;
  category: string | null;
  is_active: number;
}

export interface EquipmentTypeSourceRow {
  equipment_type: string;
  description: string | null;
}

export interface ParameterSourceRow {
  parameter_id: number;
  equipment_type: string;
  code: string;
  canonical_name: string;
  value_type: string;
  canonical_unit: string | null;
  requirement_level: RequirementLevel;
  description: string | null;
}

export interface ProfileSourceRow {
  product_id: number;
  equipment_type: string;
  series: string | null;
  model: string | null;
  identity_status: string;
  data_completeness: string;
  source_verification: string;
  schema_id: string;
  schema_version: string;
}

export interface ValueSourceRow {
  value_id: number;
  product_id: number;
  parameter_id: number;
  value_numeric: number | null;
  value_text: string | null;
  value_boolean: number | boolean | null;
  unit: string | null;
  condition_set_id: number | null;
  source_id: number | null;
  value_status: ValueStatus;
  confidence: number | null;
}

export interface ConditionSetSourceRow {
  condition_set_id: number;
  code: string;
  description: string | null;
}

export interface ConditionKeySourceRow {
  condition_key: string;
  value_type: string;
  unit: string | null;
  description: string | null;
}

export interface ConditionEntrySourceRow {
  condition_entry_id: number;
  condition_set_id: number;
  condition_key: string;
  value_numeric: number | null;
  value_text: string | null;
  value_boolean: number | boolean | null;
}

export interface SourceTypeSourceRow {
  source_type: string;
  verification_tier: string;
  description: string | null;
}

export interface EngineeringSourceRow {
  source_id: number;
  source_type: string;
  manufacturer: string | null;
  document_title: string | null;
  document_version: string | null;
  url: string | null;
  page: string | null;
  table_name: string | null;
  retrieved_at: string | null;
  audited_at: string | null;
  notes: string | null;
}

export interface InventorySourceData {
  products: InventoryProductSourceRow[];
  equipmentTypes: EquipmentTypeSourceRow[];
  parameters: ParameterSourceRow[];
  profiles: ProfileSourceRow[];
  values: ValueSourceRow[];
  conditionSets: ConditionSetSourceRow[];
  conditionKeys: ConditionKeySourceRow[];
  conditionEntries: ConditionEntrySourceRow[];
  sourceTypes: SourceTypeSourceRow[];
  sources: EngineeringSourceRow[];
}

export interface MissingFactRow extends ExportRow {
  product_id: number;
  sku: string;
  product_name: string;
  brand: string | null;
  category: string | null;
  equipment_type: string;
  parameter_code: string;
  parameter_name: string;
  requirement_level: RequirementLevel;
  requirement_source: string;
  value_type: string;
  unit: string | null;
  condition_scope: ConditionScope;
  condition_set_code: string | null;
  operating_point_requirement: string | null;
  missing_status: "MISSING" | "UNKNOWN" | "CONFLICT" | "REVIEW_REQUIRED";
  reason: string;
  VALUE_TO_FILL: "";
  SOURCE_DOCUMENT: "";
  SOURCE_PAGE: "";
  NOTE: "";
}

export interface ProductInventoryRow extends ExportRow {
  product_id: number;
  sku: string;
  name_ru: string;
  name_hy: string | null;
  name_en: string | null;
  brand_id: number | null;
  brand: string | null;
  category_id: number | null;
  category: string | null;
  is_active: boolean;
  engineering_profile_present: boolean;
  equipment_type: string | null;
  matcher_selection_contract: "CURRENT_MATCHER_SUPPORTED" | "SELECTION_CONTRACT_NOT_IMPLEMENTED" | "NO_PROFILE" | "EQUIPMENT_TYPE_UNKNOWN";
  engineering_status: EngineeringStatus;
  selection_ready: boolean;
  compatibility_ready: boolean;
  identity_status: string | null;
  data_completeness: string | null;
  source_verification: string | null;
  engineering_values_count: number;
  missing_required_count: number;
  missing_compatibility_count: number;
  operating_point_values_count: number;
  missing_operating_point_count: number;
  source_count: number;
  values_without_source_count: number;
  status_reason: string;
}

export interface EngineeringInventory {
  summary: {
    total_products: number;
    products_with_engineering_profile: number;
    products_without_engineering_profile: number;
    engineering_ready_products: number;
    engineering_incomplete_products: number;
    equipment_type_unknown_products: number;
    not_engineering_equipment_products: number;
    missing_required_for_selection_count: number;
    missing_required_for_compatibility_count: number;
  };
  products: ProductInventoryRow[];
  missingRequired: MissingFactRow[];
  missingCompatibility: MissingFactRow[];
  engineeringValues: ExportRow[];
  operatingPoints: ExportRow[];
  sources: ExportRow[];
  conditionKeyColumns: string[];
  equipmentTypeCounts: Array<{ equipment_type: string; product_count: number }>;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullableText(a: string | null, b: string | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return -1;
  if (b == null) return 1;
  return compareText(a, b);
}

function booleanValue(value: number | boolean | null): boolean | null {
  if (value == null) return null;
  return typeof value === "boolean" ? value : value !== 0;
}

function hasExactlyOneValue(row: Pick<ValueSourceRow, "value_numeric" | "value_text" | "value_boolean">): boolean {
  return [row.value_numeric, row.value_text, row.value_boolean].filter((value) => value != null).length === 1;
}

function valueDisplay(row: Pick<ValueSourceRow, "value_numeric" | "value_text" | "value_boolean">): CellValue {
  if (row.value_numeric != null) return row.value_numeric;
  if (row.value_text != null) return row.value_text;
  return booleanValue(row.value_boolean);
}

function conditionDisplay(row: ConditionEntrySourceRow): CellValue {
  if (row.value_numeric != null) return row.value_numeric;
  if (row.value_text != null) return row.value_text;
  return booleanValue(row.value_boolean);
}

function sourceReference(source: EngineeringSourceRow | undefined): string | null {
  if (!source) return null;
  const parts = [
    source.document_title,
    source.document_version ? `version ${source.document_version}` : null,
    source.page ? `page ${source.page}` : null,
    source.table_name ? `table ${source.table_name}` : null,
    source.url,
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" | ") : null;
}

function requirementScope(equipmentType: string, parameterCode: string): ConditionScope {
  const byService = SERVICE_APPLICABILITY[equipmentType as CanonicalEquipmentType] ?? {};
  for (const applicability of Object.values(byService)) {
    if (applicability?.requiredForSelectionOperatingPoint.includes(parameterCode as CanonicalParameterCode)) {
      return "VALUE_OPERATING_POINT";
    }
  }
  return "PRODUCT_ANY";
}

interface EffectiveRequiredParameter {
  parameter: ParameterSourceRow;
  requirementSource: "ENGINEERING_PARAMETER" | "MATCHER_SERVICE_APPLICABILITY" | "ENGINEERING_PARAMETER+MATCHER_SERVICE_APPLICABILITY";
}

function effectiveRequiredParameters(
  equipmentType: string,
  parameters: ParameterSourceRow[],
): EffectiveRequiredParameter[] {
  const required = new Map<string, EffectiveRequiredParameter>();
  for (const parameter of parameters) {
    if (parameter.requirement_level === "REQUIRED_FOR_SELECTION" || parameter.requirement_level === "REQUIRED_FOR_COMPATIBILITY") {
      required.set(`${parameter.requirement_level}:${parameter.code}`, {
        parameter,
        requirementSource: "ENGINEERING_PARAMETER",
      });
    }
  }

  if (MATCHER_SCOPE.has(equipmentType)) {
    const policyCodes = new Set<string>();
    const byService = SERVICE_APPLICABILITY[equipmentType as CanonicalEquipmentType] ?? {};
    for (const applicability of Object.values(byService)) {
      if (!applicability) continue;
      for (const code of applicability.requiredForSelectionOperatingPoint) policyCodes.add(code);
      for (const code of applicability.requiredForSelectionProductLevel) policyCodes.add(code);
    }
    for (const code of policyCodes) {
      const definition = parameters.find((parameter) => parameter.code === code);
      if (!definition) continue;
      const key = `REQUIRED_FOR_SELECTION:${code}`;
      const existing = required.get(key);
      required.set(key, {
        parameter: { ...definition, requirement_level: "REQUIRED_FOR_SELECTION" },
        requirementSource: existing
          ? "ENGINEERING_PARAMETER+MATCHER_SERVICE_APPLICABILITY"
          : "MATCHER_SERVICE_APPLICABILITY",
      });
    }
  }

  return Array.from(required.values()).sort((a, b) =>
    compareText(a.parameter.requirement_level, b.parameter.requirement_level) ||
    compareText(a.parameter.code, b.parameter.code),
  );
}

function valuesAtScope(values: ValueSourceRow[], scope: ConditionScope): ValueSourceRow[] {
  return values.filter((value) =>
    scope === "VALUE_OPERATING_POINT" ? value.condition_set_id != null : value.condition_set_id == null,
  );
}

function valueSignature(value: ValueSourceRow): string {
  return JSON.stringify([value.value_numeric, value.value_text, booleanValue(value.value_boolean), value.unit]);
}

function hasConflictingKnownValues(values: ValueSourceRow[], scope: ConditionScope): boolean {
  const known = values.filter((value) => value.value_status === "KNOWN" && hasExactlyOneValue(value));
  if (scope === "PRODUCT_ANY") return new Set(known.map(valueSignature)).size > 1;
  const byCondition = new Map<number, Set<string>>();
  for (const value of known) {
    if (value.condition_set_id == null) continue;
    const signatures = byCondition.get(value.condition_set_id) ?? new Set<string>();
    signatures.add(valueSignature(value));
    byCondition.set(value.condition_set_id, signatures);
  }
  return Array.from(byCondition.values()).some((signatures) => signatures.size > 1);
}

function missingState(
  parameter: ParameterSourceRow,
  parameterValues: ValueSourceRow[],
): { status: MissingFactRow["missing_status"]; reason: string; scope: ConditionScope } | null {
  const scope = parameter.requirement_level === "REQUIRED_FOR_SELECTION"
    ? requirementScope(parameter.equipment_type, parameter.code)
    : "PRODUCT_ANY";
  const scoped = valuesAtScope(parameterValues, scope);

  if (hasConflictingKnownValues(scoped, scope) || scoped.some((value) => value.value_status === "CONFLICT")) {
    return { status: "CONFLICT", reason: "DATA_CONFLICT", scope };
  }
  if (scoped.some((value) => value.value_status === "REVIEW_REQUIRED")) {
    return { status: "REVIEW_REQUIRED", reason: "REQUIRED_PARAMETER_REVIEW_REQUIRED", scope };
  }
  if (scoped.some((value) => value.value_status === "KNOWN" && hasExactlyOneValue(value))) return null;
  if (scoped.some((value) => value.value_status === "UNKNOWN") || parameterValues.some((value) => value.value_status === "UNKNOWN")) {
    return { status: "UNKNOWN", reason: "REQUIRED_PARAMETER_UNKNOWN", scope };
  }
  if (scope === "VALUE_OPERATING_POINT" && parameterValues.some((value) => value.value_status === "KNOWN")) {
    return { status: "MISSING", reason: "CAPACITY_VALUE_MISSING_AT_REQUIRED_OPERATING_POINT", scope };
  }
  return { status: "MISSING", reason: "REQUIRED_PARAMETER_MISSING", scope };
}

function assertVocabulary(data: InventorySourceData): void {
  const requirementSet = new Set<string>(REQUIREMENT_LEVELS);
  const valueStatusSet = new Set<string>(VALUE_STATUSES);
  for (const parameter of data.parameters) {
    if (!requirementSet.has(parameter.requirement_level)) {
      throw new Error(`Unsupported engineering requirement level: ${parameter.requirement_level}`);
    }
  }
  for (const value of data.values) {
    if (!valueStatusSet.has(value.value_status)) {
      throw new Error(`Unsupported engineering value status: ${value.value_status}`);
    }
  }
}

function buildMissingFact(
  product: InventoryProductSourceRow,
  profile: ProfileSourceRow,
  parameter: ParameterSourceRow,
  state: NonNullable<ReturnType<typeof missingState>>,
  requirementSource: EffectiveRequiredParameter["requirementSource"],
): MissingFactRow {
  return {
    product_id: product.product_id,
    sku: product.sku,
    product_name: product.name_ru,
    brand: product.brand,
    category: product.category,
    equipment_type: profile.equipment_type,
    parameter_code: parameter.code,
    parameter_name: parameter.canonical_name,
    requirement_level: parameter.requirement_level,
    requirement_source: requirementSource,
    value_type: parameter.value_type,
    unit: parameter.canonical_unit,
    condition_scope: state.scope,
    condition_set_code: null,
    operating_point_requirement: state.scope === "VALUE_OPERATING_POINT" ? "EXACT_REQUEST_CONDITIONS" : null,
    missing_status: state.status,
    reason: state.reason,
    VALUE_TO_FILL: "",
    SOURCE_DOCUMENT: "",
    SOURCE_PAGE: "",
    NOTE: "",
  };
}

export function buildEngineeringDataInventory(sourceData: InventorySourceData): EngineeringInventory {
  const data = structuredClone(sourceData);
  assertVocabulary(data);

  data.products.sort((a, b) => a.product_id - b.product_id);
  data.equipmentTypes.sort((a, b) => compareText(a.equipment_type, b.equipment_type));
  data.parameters.sort((a, b) =>
    compareText(a.equipment_type, b.equipment_type) ||
    compareText(a.requirement_level, b.requirement_level) ||
    compareText(a.code, b.code) ||
    a.parameter_id - b.parameter_id,
  );
  data.profiles.sort((a, b) => a.product_id - b.product_id);
  data.values.sort((a, b) =>
    a.product_id - b.product_id ||
    a.parameter_id - b.parameter_id ||
    (a.condition_set_id ?? -1) - (b.condition_set_id ?? -1) ||
    (a.source_id ?? -1) - (b.source_id ?? -1) ||
    a.value_id - b.value_id,
  );
  data.conditionSets.sort((a, b) => compareText(a.code, b.code) || a.condition_set_id - b.condition_set_id);
  data.conditionKeys.sort((a, b) => compareText(a.condition_key, b.condition_key));
  data.conditionEntries.sort((a, b) =>
    a.condition_set_id - b.condition_set_id || compareText(a.condition_key, b.condition_key),
  );
  data.sourceTypes.sort((a, b) => compareText(a.source_type, b.source_type));
  data.sources.sort((a, b) => a.source_id - b.source_id);

  const equipmentTypes = new Set(data.equipmentTypes.map((row) => row.equipment_type));
  const profilesByProduct = new Map(data.profiles.map((row) => [row.product_id, row]));
  const parametersById = new Map(data.parameters.map((row) => [row.parameter_id, row]));
  const parametersByEquipment = new Map<string, ParameterSourceRow[]>();
  for (const parameter of data.parameters) {
    const list = parametersByEquipment.get(parameter.equipment_type) ?? [];
    list.push(parameter);
    parametersByEquipment.set(parameter.equipment_type, list);
  }
  const valuesByProduct = new Map<number, ValueSourceRow[]>();
  for (const value of data.values) {
    if (!parametersById.has(value.parameter_id)) {
      throw new Error(`engineering_value ${value.value_id} has no engineering_parameter ${value.parameter_id}`);
    }
    const list = valuesByProduct.get(value.product_id) ?? [];
    list.push(value);
    valuesByProduct.set(value.product_id, list);
  }
  const conditionSetsById = new Map(data.conditionSets.map((row) => [row.condition_set_id, row]));
  const entriesByConditionSet = new Map<number, ConditionEntrySourceRow[]>();
  for (const entry of data.conditionEntries) {
    const list = entriesByConditionSet.get(entry.condition_set_id) ?? [];
    list.push(entry);
    entriesByConditionSet.set(entry.condition_set_id, list);
  }
  const sourceTypesByCode = new Map(data.sourceTypes.map((row) => [row.source_type, row]));
  const sourcesById = new Map(data.sources.map((row) => [row.source_id, row]));

  const engineeringValues: ExportRow[] = data.values.map((value) => {
    const parameter = parametersById.get(value.parameter_id)!;
    const profile = profilesByProduct.get(value.product_id);
    const conditionSet = value.condition_set_id == null ? undefined : conditionSetsById.get(value.condition_set_id);
    const conditionEntries = value.condition_set_id == null ? [] : entriesByConditionSet.get(value.condition_set_id) ?? [];
    const engineeringSource = value.source_id == null ? undefined : sourcesById.get(value.source_id);
    const sourceType = engineeringSource ? sourceTypesByCode.get(engineeringSource.source_type) : undefined;
    return {
      value_id: value.value_id,
      product_id: value.product_id,
      sku: data.products.find((product) => product.product_id === value.product_id)?.sku ?? null,
      equipment_type: profile?.equipment_type ?? parameter.equipment_type,
      parameter_id: parameter.parameter_id,
      parameter_code: parameter.code,
      parameter_name: parameter.canonical_name,
      requirement_level: parameter.requirement_level,
      parameter_value_type: parameter.value_type,
      value_numeric: value.value_numeric,
      value_text: value.value_text,
      value_boolean: booleanValue(value.value_boolean),
      unit: value.unit,
      canonical_unit: parameter.canonical_unit,
      condition_set_id: value.condition_set_id,
      condition_set_code: conditionSet?.code ?? null,
      condition_entries: conditionEntries.length > 0
        ? JSON.stringify(Object.fromEntries(conditionEntries.map((entry) => [entry.condition_key, conditionDisplay(entry)])))
        : null,
      status: value.value_status,
      confidence: value.confidence,
      source_id: value.source_id,
      source_type: engineeringSource?.source_type ?? null,
      source_reference: sourceReference(engineeringSource),
      verification_tier: sourceType?.verification_tier ?? null,
      profile_source_verification: profile?.source_verification ?? null,
    };
  });

  const conditionKeyColumns = data.conditionKeys.map((row) => row.condition_key);
  const operatingPoints: ExportRow[] = data.values
    .filter((value) => value.condition_set_id != null)
    .map((value) => {
      const parameter = parametersById.get(value.parameter_id)!;
      const product = data.products.find((row) => row.product_id === value.product_id);
      const profile = profilesByProduct.get(value.product_id);
      const conditionSet = conditionSetsById.get(value.condition_set_id!);
      const entries = entriesByConditionSet.get(value.condition_set_id!) ?? [];
      const engineeringSource = value.source_id == null ? undefined : sourcesById.get(value.source_id);
      const row: ExportRow = {
        product_id: value.product_id,
        sku: product?.sku ?? null,
        product_name: product?.name_ru ?? null,
        equipment_type: profile?.equipment_type ?? parameter.equipment_type,
        value_id: value.value_id,
        parameter_code: parameter.code,
        parameter_name: parameter.canonical_name,
        condition_set_id: value.condition_set_id,
        condition_set_code: conditionSet?.code ?? null,
        condition_set_description: conditionSet?.description ?? null,
        value_numeric: value.value_numeric,
        value_text: value.value_text,
        value_boolean: booleanValue(value.value_boolean),
        value: valueDisplay(value),
        unit: value.unit,
        status: value.value_status,
        confidence: value.confidence,
        source_id: value.source_id,
        source_type: engineeringSource?.source_type ?? null,
        source_reference: sourceReference(engineeringSource),
      };
      for (const key of conditionKeyColumns) row[key] = null;
      for (const entry of entries) row[entry.condition_key] = conditionDisplay(entry);
      return row;
    });

  const sourceUsage = new Map<number, { valueIds: number[]; productIds: Set<number>; parameterCodes: Set<string>; skus: Set<string> }>();
  for (const value of data.values) {
    if (value.source_id == null) continue;
    const usage = sourceUsage.get(value.source_id) ?? {
      valueIds: [],
      productIds: new Set<number>(),
      parameterCodes: new Set<string>(),
      skus: new Set<string>(),
    };
    usage.valueIds.push(value.value_id);
    usage.productIds.add(value.product_id);
    usage.parameterCodes.add(parametersById.get(value.parameter_id)!.code);
    const sku = data.products.find((product) => product.product_id === value.product_id)?.sku;
    if (sku) usage.skus.add(sku);
    sourceUsage.set(value.source_id, usage);
  }
  const sources: ExportRow[] = data.sources.map((source) => {
    const type = sourceTypesByCode.get(source.source_type);
    const usage = sourceUsage.get(source.source_id);
    return {
      source_id: source.source_id,
      source_type: source.source_type,
      verification_tier: type?.verification_tier ?? null,
      source_type_description: type?.description ?? null,
      manufacturer: source.manufacturer,
      document_title: source.document_title,
      document_version: source.document_version,
      url: source.url,
      page: source.page,
      table_name: source.table_name,
      retrieved_at: source.retrieved_at,
      audited_at: source.audited_at,
      notes: source.notes,
      source_reference: sourceReference(source),
      values_using_source: usage?.valueIds.length ?? 0,
      products_using_source: usage?.productIds.size ?? 0,
      product_ids: usage ? Array.from(usage.productIds).sort((a, b) => a - b).join("|") : "",
      product_skus: usage ? Array.from(usage.skus).sort(compareText).join("|") : "",
      parameter_codes: usage ? Array.from(usage.parameterCodes).sort(compareText).join("|") : "",
    };
  });

  const missingRequired: MissingFactRow[] = [];
  const missingCompatibility: MissingFactRow[] = [];
  const products: ProductInventoryRow[] = [];

  for (const product of data.products) {
    const profile = profilesByProduct.get(product.product_id);
    const productValues = valuesByProduct.get(product.product_id) ?? [];
    if (!profile) {
      products.push({
        ...product,
        is_active: product.is_active !== 0,
        engineering_profile_present: false,
        equipment_type: null,
        matcher_selection_contract: "NO_PROFILE",
        engineering_status: "NO_ENGINEERING_PROFILE",
        selection_ready: false,
        compatibility_ready: false,
        identity_status: null,
        data_completeness: null,
        source_verification: null,
        engineering_values_count: productValues.length,
        missing_required_count: 0,
        missing_compatibility_count: 0,
        operating_point_values_count: productValues.filter((value) => value.condition_set_id != null).length,
        missing_operating_point_count: 0,
        source_count: new Set(productValues.flatMap((value) => value.source_id == null ? [] : [value.source_id])).size,
        values_without_source_count: productValues.filter((value) => value.source_id == null).length,
        status_reason: "NO_ENGINEERING_PROFILE",
      });
      continue;
    }

    const registeredEquipmentType = equipmentTypes.has(profile.equipment_type);
    const parameters = parametersByEquipment.get(profile.equipment_type) ?? [];
    const unknownEquipmentType = !registeredEquipmentType || parameters.length === 0;
    const productMissingRequired: MissingFactRow[] = [];
    const productMissingCompatibility: MissingFactRow[] = [];

    if (!unknownEquipmentType) {
      for (const { parameter, requirementSource } of effectiveRequiredParameters(profile.equipment_type, parameters)) {
        const parameterValues = productValues.filter((value) => value.parameter_id === parameter.parameter_id);
        const state = missingState(parameter, parameterValues);
        if (!state) continue;
        const fact = buildMissingFact(product, profile, parameter, state, requirementSource);
        if (parameter.requirement_level === "REQUIRED_FOR_SELECTION") productMissingRequired.push(fact);
        else productMissingCompatibility.push(fact);
      }
    }

    missingRequired.push(...productMissingRequired);
    missingCompatibility.push(...productMissingCompatibility);

    const matcherSupported = MATCHER_SCOPE.has(profile.equipment_type);
    const selectionReady =
      !unknownEquipmentType &&
      matcherSupported &&
      profile.identity_status !== "IDENTITY_UNCERTAIN" &&
      profile.data_completeness !== "BLOCKED" &&
      productMissingRequired.length === 0;
    const compatibilityReady = !unknownEquipmentType && productMissingCompatibility.length === 0;
    const engineeringStatus: EngineeringStatus = unknownEquipmentType
      ? "EQUIPMENT_TYPE_UNKNOWN"
      : selectionReady &&
          compatibilityReady &&
          profile.identity_status === "IDENTIFIED" &&
          profile.data_completeness === "COMPLETE"
        ? "ENGINEERING_READY"
        : "ENGINEERING_INCOMPLETE";
    const reasons: string[] = [];
    if (unknownEquipmentType) reasons.push("EQUIPMENT_TYPE_UNKNOWN");
    if (!unknownEquipmentType && !matcherSupported) reasons.push("SELECTION_CONTRACT_NOT_IMPLEMENTED");
    if (profile.identity_status === "IDENTITY_UNCERTAIN") reasons.push("PROFILE_IDENTITY_UNCERTAIN");
    else if (profile.identity_status !== "IDENTIFIED") reasons.push(`IDENTITY_UNVERIFIED:${profile.identity_status}`);
    if (profile.data_completeness !== "COMPLETE") reasons.push(`PROFILE_INCOMPLETE:${profile.data_completeness}`);
    if (productMissingRequired.length > 0) reasons.push(`MISSING_REQUIRED_FOR_SELECTION:${productMissingRequired.length}`);
    if (productMissingCompatibility.length > 0) reasons.push(`MISSING_REQUIRED_FOR_COMPATIBILITY:${productMissingCompatibility.length}`);
    const valuesWithoutSource = productValues.filter((value) => value.source_id == null).length;
    if (valuesWithoutSource > 0) reasons.push(`VALUES_WITHOUT_SOURCE:${valuesWithoutSource}`);
    if (reasons.length === 0) reasons.push("ENGINEERING_CONTRACT_COMPLETE");

    products.push({
      ...product,
      is_active: product.is_active !== 0,
      engineering_profile_present: true,
      equipment_type: profile.equipment_type,
      matcher_selection_contract: unknownEquipmentType
        ? "EQUIPMENT_TYPE_UNKNOWN"
        : matcherSupported
          ? "CURRENT_MATCHER_SUPPORTED"
          : "SELECTION_CONTRACT_NOT_IMPLEMENTED",
      engineering_status: engineeringStatus,
      selection_ready: selectionReady,
      compatibility_ready: compatibilityReady,
      identity_status: profile.identity_status,
      data_completeness: profile.data_completeness,
      source_verification: profile.source_verification,
      engineering_values_count: productValues.length,
      missing_required_count: productMissingRequired.length,
      missing_compatibility_count: productMissingCompatibility.length,
      operating_point_values_count: productValues.filter((value) => value.condition_set_id != null).length,
      missing_operating_point_count: productMissingRequired.filter((row) => row.condition_scope === "VALUE_OPERATING_POINT").length,
      source_count: new Set(productValues.flatMap((value) => value.source_id == null ? [] : [value.source_id])).size,
      values_without_source_count: valuesWithoutSource,
      status_reason: reasons.join(" | "),
    });
  }

  const sortMissing = (a: MissingFactRow, b: MissingFactRow) =>
    a.product_id - b.product_id ||
    compareText(a.requirement_level, b.requirement_level) ||
    compareText(a.parameter_code, b.parameter_code) ||
    compareNullableText(a.condition_set_code, b.condition_set_code);
  missingRequired.sort(sortMissing);
  missingCompatibility.sort(sortMissing);
  engineeringValues.sort((a, b) =>
    Number(a.product_id) - Number(b.product_id) ||
    compareText(String(a.parameter_code), String(b.parameter_code)) ||
    compareNullableText(a.condition_set_code as string | null, b.condition_set_code as string | null) ||
    Number(a.value_id) - Number(b.value_id),
  );
  operatingPoints.sort((a, b) =>
    Number(a.product_id) - Number(b.product_id) ||
    compareText(String(a.parameter_code), String(b.parameter_code)) ||
    compareText(String(a.condition_set_code), String(b.condition_set_code)) ||
    Number(a.value_id) - Number(b.value_id),
  );

  const equipmentTypeCountMap = new Map<string, number>();
  for (const row of products) {
    const type = row.equipment_type ?? "NO_ENGINEERING_PROFILE";
    equipmentTypeCountMap.set(type, (equipmentTypeCountMap.get(type) ?? 0) + 1);
  }
  const equipmentTypeCounts = Array.from(equipmentTypeCountMap.entries())
    .map(([equipment_type, product_count]) => ({ equipment_type, product_count }))
    .sort((a, b) => compareText(a.equipment_type, b.equipment_type));

  const summary = {
    total_products: products.length,
    products_with_engineering_profile: products.filter((row) => row.engineering_profile_present).length,
    products_without_engineering_profile: products.filter((row) => !row.engineering_profile_present).length,
    engineering_ready_products: products.filter((row) => row.engineering_status === "ENGINEERING_READY").length,
    engineering_incomplete_products: products.filter((row) => row.engineering_status === "ENGINEERING_INCOMPLETE").length,
    equipment_type_unknown_products: products.filter((row) => row.engineering_status === "EQUIPMENT_TYPE_UNKNOWN").length,
    not_engineering_equipment_products: products.filter((row) => row.engineering_status === "NOT_ENGINEERING_EQUIPMENT").length,
    missing_required_for_selection_count: missingRequired.length,
    missing_required_for_compatibility_count: missingCompatibility.length,
  };

  if (summary.total_products !== new Set(data.products.map((row) => row.product_id)).size) {
    throw new Error("Inventory did not retain exactly one row for every product_id");
  }

  return {
    summary,
    products,
    missingRequired,
    missingCompatibility,
    engineeringValues,
    operatingPoints,
    sources,
    conditionKeyColumns,
    equipmentTypeCounts,
  };
}

export function assertInventorySqlIsReadOnly(sql: string): void {
  const trimmed = sql.trim();
  if (!/^SELECT\b/i.test(trimmed) || WRITE_SQL.test(trimmed) || WRITE_PRAGMA.test(trimmed)) {
    throw new Error(`Engineering inventory refused non-SELECT SQL: ${trimmed.slice(0, 120)}`);
  }
}

function selectAll<T>(db: Database.Database, sql: string): T[] {
  assertInventorySqlIsReadOnly(sql);
  return db.prepare(sql).all() as T[];
}

export function readInventorySourceData(databasePath: string): InventorySourceData {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    db.pragma("query_only = ON");
    const readSnapshot = db.transaction((): InventorySourceData => ({
      products: selectAll<InventoryProductSourceRow>(db, `
        SELECT
          p.id AS product_id,
          p.sku,
          p.name_ru,
          p.name_hy,
          p.name_en,
          p.brand_id,
          b.name AS brand,
          c.id AS category_id,
          c.name_ru AS category,
          p.is_active
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = COALESCE(
          p.primary_category_id,
          (
            SELECT pc.category_id
            FROM product_categories pc
            WHERE pc.product_id = p.id
            ORDER BY pc.is_primary DESC, pc.category_id ASC
            LIMIT 1
          ),
          p.category_id
        )
      `),
      equipmentTypes: selectAll<EquipmentTypeSourceRow>(db, `
        SELECT equipment_type, description
        FROM engineering_equipment_type
      `),
      parameters: selectAll<ParameterSourceRow>(db, `
        SELECT
          parameter_id,
          equipment_type,
          code,
          canonical_name,
          value_type,
          canonical_unit,
          requirement_level,
          description
        FROM engineering_parameter
      `),
      profiles: selectAll<ProfileSourceRow>(db, `
        SELECT
          product_id,
          equipment_type,
          series,
          model,
          identity_status,
          data_completeness,
          source_verification,
          schema_id,
          schema_version
        FROM engineering_product_profile
      `),
      values: selectAll<ValueSourceRow>(db, `
        SELECT
          value_id,
          product_id,
          parameter_id,
          value_numeric,
          value_text,
          value_boolean,
          unit,
          condition_set_id,
          source_id,
          value_status,
          confidence
        FROM engineering_value
      `),
      conditionSets: selectAll<ConditionSetSourceRow>(db, `
        SELECT condition_set_id, code, description
        FROM engineering_condition_set
      `),
      conditionKeys: selectAll<ConditionKeySourceRow>(db, `
        SELECT condition_key, value_type, unit, description
        FROM engineering_condition_key
      `),
      conditionEntries: selectAll<ConditionEntrySourceRow>(db, `
        SELECT
          condition_entry_id,
          condition_set_id,
          condition_key,
          value_numeric,
          value_text,
          value_boolean
        FROM engineering_condition_entry
      `),
      sourceTypes: selectAll<SourceTypeSourceRow>(db, `
        SELECT source_type, verification_tier, description
        FROM engineering_source_type
      `),
      sources: selectAll<EngineeringSourceRow>(db, `
        SELECT
          source_id,
          source_type,
          manufacturer,
          document_title,
          document_version,
          url,
          page,
          table_name,
          retrieved_at,
          audited_at,
          notes
        FROM engineering_source
      `),
    }));
    return readSnapshot.deferred();
  } finally {
    db.close();
  }
}

const PRODUCT_COLUMNS = [
  "product_id", "sku", "name_ru", "name_hy", "name_en", "brand_id", "brand", "category_id", "category",
  "is_active", "engineering_profile_present", "equipment_type", "matcher_selection_contract", "engineering_status",
  "selection_ready", "compatibility_ready", "identity_status", "data_completeness", "source_verification",
  "engineering_values_count", "missing_required_count", "missing_compatibility_count", "operating_point_values_count",
  "missing_operating_point_count", "source_count", "values_without_source_count", "status_reason",
];
const MISSING_COLUMNS = [
  "product_id", "sku", "product_name", "brand", "category", "equipment_type", "parameter_code", "parameter_name",
  "requirement_level", "requirement_source", "value_type", "unit", "condition_scope", "condition_set_code", "operating_point_requirement",
  "missing_status", "reason", ...MANUAL_COLUMNS,
];
const ENGINEERING_VALUE_COLUMNS = [
  "value_id", "product_id", "sku", "equipment_type", "parameter_id", "parameter_code", "parameter_name",
  "requirement_level", "parameter_value_type", "value_numeric", "value_text", "value_boolean", "unit", "canonical_unit",
  "condition_set_id", "condition_set_code", "condition_entries", "status", "confidence", "source_id", "source_type",
  "source_reference", "verification_tier", "profile_source_verification",
];
const OPERATING_POINT_BASE_COLUMNS = [
  "product_id", "sku", "product_name", "equipment_type", "value_id", "parameter_code", "parameter_name",
  "condition_set_id", "condition_set_code", "condition_set_description", "value_numeric", "value_text", "value_boolean",
  "value", "unit", "status", "confidence", "source_id", "source_type", "source_reference",
];
const SOURCE_COLUMNS = [
  "source_id", "source_type", "verification_tier", "source_type_description", "manufacturer", "document_title",
  "document_version", "url", "page", "table_name", "retrieved_at", "audited_at", "notes", "source_reference",
  "values_using_source", "products_using_source", "product_ids", "product_skus", "parameter_codes",
];

function encodeCsvCell(value: CellValue): string {
  if (value == null) return "";
  const text = typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function renderCsv(rows: readonly ExportRow[], columns: readonly string[]): string {
  const output = [columns.map(encodeCsvCell).join(",")];
  for (const row of rows) output.push(columns.map((column) => encodeCsvCell(row[column] ?? null)).join(","));
  return `${output.join("\n")}\n`;
}

export function buildCsvExports(inventory: EngineeringInventory): Record<string, string> {
  const operatingColumns = [...OPERATING_POINT_BASE_COLUMNS, ...inventory.conditionKeyColumns];
  return {
    "products.csv": renderCsv(inventory.products, PRODUCT_COLUMNS),
    "missing_required.csv": renderCsv(inventory.missingRequired, MISSING_COLUMNS),
    "missing_compatibility.csv": renderCsv(inventory.missingCompatibility, MISSING_COLUMNS),
    "engineering_values.csv": renderCsv(inventory.engineeringValues, ENGINEERING_VALUE_COLUMNS),
    "operating_points.csv": renderCsv(inventory.operatingPoints, operatingColumns),
    "sources.csv": renderCsv(inventory.sources, SOURCE_COLUMNS),
  };
}

function columnWidth(name: string): number {
  if (["product_name", "name_ru", "status_reason", "source_reference", "condition_entries", "notes"].includes(name)) return 42;
  if (["VALUE_TO_FILL", "SOURCE_DOCUMENT", "NOTE", "url"].includes(name)) return 30;
  if (["parameter_name", "condition_set_description", "source_type_description"].includes(name)) return 28;
  return Math.min(24, Math.max(12, name.length + 2));
}

async function addSheet(
  workbook: ExcelWorkbook,
  name: string,
  columns: readonly string[],
  rows: readonly ExportRow[],
  manualColumns: ReadonlySet<string> = new Set(),
): Promise<void> {
  const sheet = workbook.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columns.map((key) => ({ key, header: key, width: columnWidth(key) }));
  for (const row of rows) sheet.addRow(columns.map((column) => row[column] ?? null));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: columns.length } };
  sheet.getRow(1).height = 30;
  sheet.getRow(1).eachCell((cell, columnNumber) => {
    const key = columns[columnNumber - 1];
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: manualColumns.has(key) ? "FFC69214" : "FF1F4E78" },
    };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.protection = { locked: true };
  });
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.alignment = { vertical: "top", wrapText: true };
    for (let columnNumber = 1; columnNumber <= columns.length; columnNumber += 1) {
      const cell = row.getCell(columnNumber);
      const manual = manualColumns.has(columns[columnNumber - 1]);
      cell.protection = { locked: !manual };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: manual ? "FFFFF2CC" : rowNumber % 2 === 0 ? "FFF2F6FA" : "FFFFFFFF" },
      };
    }
  }
  if (manualColumns.size > 0) {
    await sheet.protect("", {
      autoFilter: true,
      sort: true,
      selectLockedCells: true,
      selectUnlockedCells: true,
    });
  }
}

function summaryRows(inventory: EngineeringInventory): ExportRow[] {
  const rows: ExportRow[] = Object.entries(inventory.summary).map(([metric, value]) => ({
    section: "TOTALS",
    metric,
    equipment_type: null,
    value,
  }));
  for (const item of inventory.equipmentTypeCounts) {
    rows.push({
      section: "BY_EQUIPMENT_TYPE",
      metric: "products_by_equipment_type",
      equipment_type: item.equipment_type,
      value: item.product_count,
    });
  }
  return rows;
}

export async function writeEngineeringWorkbook(inventory: EngineeringInventory, outputPath: string): Promise<void> {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.ed1-${process.pid}.tmp`;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OhmX Engineering Data ED1";
  workbook.created = new Date("2000-01-01T00:00:00.000Z");
  workbook.modified = new Date("2000-01-01T00:00:00.000Z");
  workbook.properties.date1904 = false;
  try {
    await addSheet(workbook, "Summary", ["section", "metric", "equipment_type", "value"], summaryRows(inventory));
    await addSheet(workbook, "Products", PRODUCT_COLUMNS, inventory.products);
    await addSheet(workbook, "Missing Required", MISSING_COLUMNS, inventory.missingRequired, new Set(MANUAL_COLUMNS));
    await addSheet(workbook, "Missing Compatibility", MISSING_COLUMNS, inventory.missingCompatibility, new Set(MANUAL_COLUMNS));
    await addSheet(workbook, "Engineering Values", ENGINEERING_VALUE_COLUMNS, inventory.engineeringValues);
    await addSheet(workbook, "Operating Points", [...OPERATING_POINT_BASE_COLUMNS, ...inventory.conditionKeyColumns], inventory.operatingPoints);
    await addSheet(workbook, "Sources", SOURCE_COLUMNS, inventory.sources);
    if (workbook.worksheets.map((sheet) => sheet.name).join("|") !== REQUIRED_SHEET_NAMES.join("|")) {
      throw new Error("Engineering inventory workbook sheet contract mismatch");
    }
    await workbook.xlsx.writeFile(temporaryPath);
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function writeCsvExports(inventory: EngineeringInventory, outputDirectory: string): Promise<void> {
  await mkdir(outputDirectory, { recursive: true });
  const exports = buildCsvExports(inventory);
  for (const [name, content] of Object.entries(exports)) {
    const target = join(outputDirectory, name);
    const temporary = `${target}.ed1-${process.pid}.tmp`;
    try {
      await writeFile(temporary, content, "utf8");
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolveDigest, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveDigest(hash.digest("hex")));
  });
}

export interface EngineeringInventoryExportOptions {
  databasePath: string;
  xlsxPath: string;
  csvDirectory: string;
}

export async function exportEngineeringDataInventory(options: EngineeringInventoryExportOptions): Promise<EngineeringInventory> {
  const beforeHash = await sha256File(options.databasePath);
  const sourceData = readInventorySourceData(options.databasePath);
  const afterReadHash = await sha256File(options.databasePath);
  if (beforeHash !== afterReadHash) throw new Error("Production DB changed during read-only inventory snapshot");

  const inventory = buildEngineeringDataInventory(sourceData);
  const stageRoot = join(dirname(options.xlsxPath), `.ed1-export-stage-${process.pid}`);
  const stageXlsx = join(stageRoot, "OHMX-ENGINEERING-DATA-INVENTORY.xlsx");
  const stageCsv = join(stageRoot, "csv");
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  try {
    await writeEngineeringWorkbook(inventory, stageXlsx);
    await writeCsvExports(inventory, stageCsv);
    const afterGenerationHash = await sha256File(options.databasePath);
    if (beforeHash !== afterGenerationHash) throw new Error("Production DB changed while export artifacts were generated");

    await mkdir(dirname(options.xlsxPath), { recursive: true });
    await mkdir(options.csvDirectory, { recursive: true });
    await rename(stageXlsx, options.xlsxPath);
    for (const name of Object.keys(buildCsvExports(inventory))) {
      await rename(join(stageCsv, name), join(options.csvDirectory, name));
    }
    const finalHash = await sha256File(options.databasePath);
    if (beforeHash !== finalHash) throw new Error("Production DB changed before export publication completed");
    return inventory;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

function defaultPaths(): EngineeringInventoryExportOptions {
  const repositoryRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
  return {
    databasePath: join(repositoryRoot, "data", "electro.db"),
    xlsxPath: join(repositoryRoot, "reports", "engineering-data", "OHMX-ENGINEERING-DATA-INVENTORY.xlsx"),
    csvDirectory: join(repositoryRoot, "reports", "engineering-data", "csv"),
  };
}

async function main(): Promise<void> {
  const options = defaultPaths();
  const inventory = await exportEngineeringDataInventory(options);
  const dbHash = await sha256File(options.databasePath);
  process.stdout.write(`${JSON.stringify({
    status: "PASS",
    databasePath: options.databasePath,
    databaseSha256: dbHash,
    xlsxPath: options.xlsxPath,
    csvDirectory: options.csvDirectory,
    summary: inventory.summary,
    equipmentTypeCounts: inventory.equipmentTypeCounts,
  }, null, 2)}\n`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
