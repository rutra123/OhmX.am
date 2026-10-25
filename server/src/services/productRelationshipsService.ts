import { db } from '../db.js';
import { productSelect } from '../utils/query.js';
import { toPublicProductCardDto } from '../utils/productDtos.js';

export type ProductRelationType = 'required' | 'recommended' | 'optional' | 'alternative' | 'incompatible';
export type RelationshipConfidence = 'high' | 'medium' | 'low';
export type RelationshipReviewStatus = 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';
export type CompatibilityStatus = 'compatible' | 'compatible_when_conditions_match' | 'requires_manual_review' | 'incompatible' | 'unknown';

export type PublicRelatedProductItem = {
  product: Record<string, any>;
  relationType: ProductRelationType;
  reasonEngineering: string;
  confidence: Exclude<RelationshipConfidence, 'low'>;
  conditions: Record<string, any> | null;
  compatibilityStatus: CompatibilityStatus;
};

export type PublicCompatibilityWarning = Omit<PublicRelatedProductItem, 'product'> & {
  targetProductId: number;
  product?: Record<string, any>;
};

export type GroupedProductRelationships = {
  required: PublicRelatedProductItem[];
  recommended: PublicRelatedProductItem[];
  optional: PublicRelatedProductItem[];
  alternatives: PublicRelatedProductItem[];
};

export type PublicProductRelationships = {
  relatedProducts: GroupedProductRelationships;
  compatibilityWarnings: PublicCompatibilityWarning[];
};

const emptyGroupedRelationships = (): GroupedProductRelationships => ({
  required: [],
  recommended: [],
  optional: [],
  alternatives: [],
});

export function emptyPublicProductRelationships(): PublicProductRelationships {
  return { relatedProducts: emptyGroupedRelationships(), compatibilityWarnings: [] };
}

function tableExists(name: string) {
  const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) as { 1?: number } | undefined;
  return Boolean(row);
}

function parseConditionsJson(value: unknown) {
  if (value == null || value === '') return { ok: true, conditions: null as Record<string, any> | null };
  if (typeof value !== 'string') return { ok: false, conditions: null };
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return { ok: false, conditions: null };
    return { ok: true, conditions: parsed as Record<string, any> };
  } catch {
    return { ok: false, conditions: null };
  }
}

function compatibilityStatusFor(relationType: ProductRelationType, conditions: Record<string, any> | null): CompatibilityStatus {
  if (relationType === 'incompatible') return 'incompatible';
  return conditions && Object.keys(conditions).length ? 'compatible_when_conditions_match' : 'compatible';
}

function getTargetProductForPublic(productId: number) {
  const rows = productSelect('p.is_active = 1 AND p.id = ?', [productId]);
  if (!rows.length) return null;
  return toPublicProductCardDto(rows[0]);
}

export function getPublicProductRelationships(sourceProductId: number): PublicProductRelationships {
  if (!tableExists('product_relationships')) return emptyPublicProductRelationships();

  const rows = db.prepare(`
    SELECT
      id,
      target_product_id,
      relation_type,
      reason_engineering,
      confidence,
      conditions_json
    FROM product_relationships
    WHERE source_product_id = ?
      AND review_status = 'approved'
      AND confidence IN ('high', 'medium')
      AND length(trim(reason_engineering)) >= 20
    ORDER BY
      CASE relation_type
        WHEN 'required' THEN 1
        WHEN 'recommended' THEN 2
        WHEN 'optional' THEN 3
        WHEN 'alternative' THEN 4
        WHEN 'incompatible' THEN 5
        ELSE 99
      END,
      id
  `).all(sourceProductId) as Array<{
    id: number;
    target_product_id: number;
    relation_type: ProductRelationType;
    reason_engineering: string;
    confidence: Exclude<RelationshipConfidence, 'low'>;
    conditions_json: string | null;
  }>;

  const result = emptyPublicProductRelationships();

  for (const row of rows) {
    const parsed = parseConditionsJson(row.conditions_json);
    if (!parsed.ok) continue;

    const targetProduct = getTargetProductForPublic(Number(row.target_product_id));
    if (!targetProduct) continue;

    const item: PublicRelatedProductItem = {
      product: targetProduct,
      relationType: row.relation_type,
      reasonEngineering: row.reason_engineering,
      confidence: row.confidence,
      conditions: parsed.conditions,
      compatibilityStatus: compatibilityStatusFor(row.relation_type, parsed.conditions),
    };

    if (row.relation_type === 'incompatible') {
      result.compatibilityWarnings.push({
        targetProductId: Number(row.target_product_id),
        relationType: row.relation_type,
        reasonEngineering: row.reason_engineering,
        confidence: row.confidence,
        conditions: parsed.conditions,
        compatibilityStatus: 'incompatible',
        product: targetProduct,
      });
      continue;
    }

    if (row.relation_type === 'alternative') {
      result.relatedProducts.alternatives.push(item);
      continue;
    }

    result.relatedProducts[row.relation_type].push(item);
  }

  return result;
}

export type ProductRelationshipValidationInput = {
  sourceProductId: number;
  targetProductId: number;
  relationType: ProductRelationType;
  reviewStatus?: RelationshipReviewStatus;
  confidence?: RelationshipConfidence;
  reasonEngineering?: string;
  conditionsJson?: string | null;
  relationshipId?: number;
};

const positiveRelationTypes: ProductRelationType[] = ['required', 'recommended', 'optional'];

function relationTypesConflict(a: ProductRelationType, b: ProductRelationType) {
  if (a === b) return false;
  if (a === 'incompatible' || b === 'incompatible') return true;
  if (a === 'alternative' || b === 'alternative') return true;
  if ((a === 'required' && ['recommended', 'optional'].includes(b)) || (b === 'required' && ['recommended', 'optional'].includes(a))) return true;
  if (positiveRelationTypes.includes(a) && positiveRelationTypes.includes(b)) return false;
  return false;
}

export function validateProductRelationshipInput(input: ProductRelationshipValidationInput) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sourceId = Number(input.sourceProductId);
  const targetId = Number(input.targetProductId);
  const reviewStatus = input.reviewStatus || 'pending_review';
  const confidence = input.confidence || 'medium';
  const reason = (input.reasonEngineering || '').trim();

  if (!Number.isInteger(sourceId) || sourceId <= 0) errors.push('invalid_source_product_id');
  if (!Number.isInteger(targetId) || targetId <= 0) errors.push('invalid_target_product_id');
  if (sourceId === targetId) errors.push('self_reference_blocked');

  if (!['required', 'recommended', 'optional', 'alternative', 'incompatible'].includes(input.relationType)) errors.push('invalid_relation_type');
  if (!['draft', 'pending_review', 'approved', 'rejected', 'archived'].includes(reviewStatus)) errors.push('invalid_review_status');
  if (!['high', 'medium', 'low'].includes(confidence)) errors.push('invalid_confidence');

  if (input.conditionsJson) {
    const parsed = parseConditionsJson(input.conditionsJson);
    if (!parsed.ok) errors.push('invalid_conditions_json');
  }

  if (reviewStatus === 'approved' && reason.length < 20) errors.push('approved_relation_requires_engineering_reason');
  if (reviewStatus === 'approved' && confidence === 'low') warnings.push('approved_low_confidence_hidden_from_public');

  const source = db.prepare('SELECT id, is_active FROM products WHERE id = ?').get(sourceId) as { id: number; is_active: number } | undefined;
  const target = db.prepare('SELECT id, is_active FROM products WHERE id = ?').get(targetId) as { id: number; is_active: number } | undefined;
  if (!source) errors.push('source_product_not_found');
  if (!target) errors.push('target_product_not_found');
  if (reviewStatus === 'approved' && target && Number(target.is_active) !== 1) errors.push('approved_public_relation_requires_active_target');

  if (tableExists('product_relationships') && sourceId && targetId && input.relationType) {
    const duplicate = db.prepare(`
      SELECT id FROM product_relationships
      WHERE source_product_id = ? AND target_product_id = ? AND relation_type = ?
        AND (? IS NULL OR id <> ?)
      LIMIT 1
    `).get(sourceId, targetId, input.relationType, input.relationshipId || null, input.relationshipId || null) as { id: number } | undefined;
    if (duplicate) errors.push('duplicate_relation_blocked');

    const existingRows = db.prepare(`
      SELECT id, relation_type FROM product_relationships
      WHERE source_product_id = ? AND target_product_id = ?
        AND review_status IN ('draft', 'pending_review', 'approved')
        AND (? IS NULL OR id <> ?)
    `).all(sourceId, targetId, input.relationshipId || null, input.relationshipId || null) as Array<{ id: number; relation_type: ProductRelationType }>;
    if (existingRows.some((row) => relationTypesConflict(input.relationType, row.relation_type))) errors.push('conflicting_relation_blocked');
  }

  return { valid: errors.length === 0, errors, warnings };
}
