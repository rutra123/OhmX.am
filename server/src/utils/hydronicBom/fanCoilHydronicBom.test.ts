import assert from "node:assert/strict";
import test from "node:test";
import {
  relationshipFromRow,
  resolveFanCoilHydronicBom,
  type CatalogComponent,
  type FanCoilBomInput,
  type ProductRelationship,
} from "./fanCoilHydronicBom.js";

const reqs = (over: Partial<FanCoilBomInput["requirements"]> = {}): FanCoilBomInput["requirements"] => ({
  fanCoilCount: 3, fanCoilCircuitKind: "2pipe", fanCoilValveSetsRequired: 3, actuatorCountRequired: 3,
  fanCoilDistribution: "pending_design", fanCoilManifoldRequired: false, fanCoilManifoldPortsRequired: 0,
  mixingUnitStatus: "pending_design", circulationPumpStatus: "pending_design", ...over,
});

const catalog: CatalogComponent[] = [
  { productId: 10, sku: "VZ2-063", role: "CONTROL_VALVE", active: true, ways: 2, kvs: 0.63, dn: 15 },
  { productId: 11, sku: "VZ2-16", role: "CONTROL_VALVE", active: true, ways: 2, kvs: 1.6, dn: 15 },
  { productId: 12, sku: "VZ2-40", role: "CONTROL_VALVE", active: true, ways: 2, kvs: 4.0, dn: 20 },
  { productId: 13, sku: "VZ4-16", role: "CONTROL_VALVE", active: true, ways: 4, kvs: 1.6, dn: 15 },
  { productId: 20, sku: "ACT-24", role: "ACTUATOR", active: true, supply: "24V", cableIncluded: false },
  { productId: 21, sku: "ACT-230", role: "ACTUATOR", active: true, supply: "230V", cableIncluded: true },
  { productId: 30, sku: "CAB-1", role: "ACTUATOR_CABLE", active: true, cableLengthM: 1 },
  { productId: 31, sku: "CAB-5", role: "ACTUATOR_CABLE", active: true, cableLengthM: 5 },
  { productId: 40, sku: "TAE-15", role: "ROOM_CONTROL", active: true },
];
const rel = (id: number, s: number, t: number, type: ProductRelationship["relationType"], status: ProductRelationship["reviewStatus"] = "approved", choiceGroup?: string): ProductRelationship =>
  ({ id, sourceProductId: s, targetProductId: t, relationType: type, reviewStatus: status, evidenceDocumentIds: ["DOC-1"], ...(choiceGroup ? { choiceGroup } : {}) });
const base = (over: Partial<FanCoilBomInput> = {}): FanCoilBomInput => ({
  requirements: reqs(), fanCoilUnits: [{ productId: 900, count: 3 }], requiredKv: 1.0, catalog, relationships: [], ...over,
});
const slot = (r: ReturnType<typeof resolveFanCoilHydronicBom>, s: string) => r.lines.find((l) => l.slot === s);

test("no fan coils -> empty complete BOM", () => {
  const r = resolveFanCoilHydronicBom(base({ requirements: reqs({ fanCoilCount: 0, fanCoilValveSetsRequired: 0, actuatorCountRequired: 0 }), fanCoilUnits: [] }));
  assert.equal(r.complete, true);
  assert.equal(r.lines.length, 0);
});

test("valve duty missing -> PENDING_DESIGN and incomplete", () => {
  const r = resolveFanCoilHydronicBom(base({ requiredKv: null }));
  assert.equal(slot(r, "CONTROL_VALVE_SET")?.status, "PENDING_DESIGN");
  assert.equal(slot(r, "ACTUATOR")?.status, "PENDING_DESIGN");
  assert.equal(r.complete, false);
});

test("valve selection: smallest sufficient Kvs, 4-way excluded, quantity from requirements", () => {
  const r = resolveFanCoilHydronicBom(base({ requiredKv: 1.0 }));
  const v = slot(r, "CONTROL_VALVE_SET");
  assert.equal(v?.productId, 11);
  assert.equal(v?.quantity, 3);
  const none = resolveFanCoilHydronicBom(base({ requiredKv: 9 }));
  assert.equal(slot(none, "CONTROL_VALVE_SET")?.status, "UNRESOLVED_CATALOG_GAP");
});

test("default deny: no approved relationship -> actuator unresolved, BOM incomplete", () => {
  const r = resolveFanCoilHydronicBom(base({ relationships: [rel(1, 11, 20, "optional", "pending_review"), rel(2, 11, 20, "optional", "rejected")] }));
  assert.equal(slot(r, "ACTUATOR")?.status, "UNRESOLVED_NO_APPROVED_RELATIONSHIP");
  assert.equal(r.complete, false);
  assert.ok(r.blockingSlots.includes("ACTUATOR"));
});

test("approved relationship resolves actuator; incompatible link excludes; supply filter applies", () => {
  const rels = [rel(1, 11, 20, "optional"), rel(2, 11, 21, "recommended")];
  const r = resolveFanCoilHydronicBom(base({ relationships: rels }));
  assert.equal(slot(r, "ACTUATOR")?.productId, 21);
  const r24 = resolveFanCoilHydronicBom(base({ relationships: rels, actuatorSupply: "24V" }));
  assert.equal(slot(r24, "ACTUATOR")?.productId, 20);
  const excl = resolveFanCoilHydronicBom(base({ relationships: [...rels, rel(3, 11, 21, "incompatible")] }));
  assert.equal(slot(excl, "ACTUATOR")?.productId, 20);
  assert.deepEqual(slot(r, "ACTUATOR")?.evidenceDocumentIds, ["DOC-1"]);
});

test("cable: required relationship, length is a site decision, included cable is NOT_REQUIRED", () => {
  const rels = [rel(1, 11, 20, "optional"), rel(2, 20, 30, "required", "approved", "CAB"), rel(3, 20, 31, "required", "approved", "CAB")];
  const noLen = resolveFanCoilHydronicBom(base({ relationships: rels, actuatorSupply: "24V" }));
  assert.equal(slot(noLen, "ACTUATOR_CABLE")?.status, "PENDING_DESIGN");
  assert.equal(noLen.complete, false);
  const len5 = resolveFanCoilHydronicBom(base({ relationships: rels, actuatorSupply: "24V", cableLengthM: 5 }));
  assert.equal(slot(len5, "ACTUATOR_CABLE")?.productId, 31);
  assert.equal(slot(len5, "ACTUATOR_CABLE")?.quantity, 3);
  const noRel = resolveFanCoilHydronicBom(base({ relationships: [rel(1, 11, 20, "optional")], actuatorSupply: "24V" }));
  assert.equal(slot(noRel, "ACTUATOR_CABLE")?.status, "UNRESOLVED_NO_APPROVED_RELATIONSHIP");
  const included = resolveFanCoilHydronicBom(base({ relationships: [rel(1, 11, 21, "optional")], actuatorSupply: "230V" }));
  assert.equal(slot(included, "ACTUATOR_CABLE")?.status, "NOT_REQUIRED");
});

test("4-pipe quantities follow requirements; manifold only when home_run; missing catalog parts are gaps", () => {
  const r = resolveFanCoilHydronicBom(base({
    requirements: reqs({ fanCoilCircuitKind: "4pipe", fanCoilValveSetsRequired: 6, actuatorCountRequired: 6, fanCoilDistribution: "home_run_manifold", fanCoilManifoldRequired: true, fanCoilManifoldPortsRequired: 6 }),
  }));
  assert.equal(slot(r, "CONTROL_VALVE_SET")?.quantity, 6);
  assert.equal(slot(r, "ISOLATION_VALVES")?.quantity, 12);
  assert.equal(slot(r, "ISOLATION_VALVES")?.status, "UNRESOLVED_CATALOG_GAP");
  assert.equal(slot(r, "MANIFOLD")?.status, "UNRESOLVED_CATALOG_GAP");
  const pending = resolveFanCoilHydronicBom(base());
  assert.equal(slot(pending, "MANIFOLD")?.status, "PENDING_DESIGN");
  const branch = resolveFanCoilHydronicBom(base({ requirements: reqs({ fanCoilDistribution: "branch_riser" }) }));
  assert.equal(slot(branch, "MANIFOLD")?.status, "NOT_REQUIRED");
});

test("unit count mismatch is a conflict; room control only via approved fan-coil relationships", () => {
  const bad = resolveFanCoilHydronicBom(base({ fanCoilUnits: [{ productId: 900, count: 2 }] }));
  assert.equal(bad.lines[0].status, "BLOCKED_CONFLICT");
  assert.equal(bad.complete, false);
  const withCtl = resolveFanCoilHydronicBom(base({ relationships: [rel(9, 900, 40, "recommended")] }));
  const c = slot(withCtl, "ROOM_CONTROL");
  assert.equal(c?.productId, 40);
  assert.equal(c?.quantity, 3);
  assert.equal(slot(resolveFanCoilHydronicBom(base()), "ROOM_CONTROL")?.status, "UNRESOLVED_NO_APPROVED_RELATIONSHIP");
});

test("determinism: shuffled catalog/relationships give identical output", () => {
  const rels = [rel(1, 11, 20, "optional"), rel(2, 20, 30, "required", "approved", "CAB"), rel(3, 20, 31, "required", "approved", "CAB")];
  const a = resolveFanCoilHydronicBom(base({ relationships: rels, actuatorSupply: "24V", cableLengthM: 1 }));
  const b = resolveFanCoilHydronicBom(base({ relationships: [...rels].reverse(), catalog: [...catalog].reverse(), actuatorSupply: "24V", cableLengthM: 1 }));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test("choice group of three required cables yields ONE line (not three simultaneous requirements)", () => {
  const rels = [rel(1, 11, 20, "optional"), rel(2, 20, 30, "required", "approved", "CAB"), rel(3, 20, 31, "required", "approved", "CAB"), rel(4, 20, 31, "required", "pending_review", "CAB")];
  const r = resolveFanCoilHydronicBom(base({ relationships: rels, actuatorSupply: "24V" }));
  const cableLines = r.lines.filter((l) => l.slot === "ACTUATOR_CABLE");
  assert.equal(cableLines.length, 1);
  assert.equal(cableLines[0].quantity, 3);
  assert.equal(cableLines[0].status, "PENDING_DESIGN");
});

test("ungrouped required items are separate lines; optional accessories never block completeness", () => {
  const rels = [rel(1, 11, 20, "optional"), rel(2, 20, 30, "required"), rel(3, 20, 31, "required")];
  const r = resolveFanCoilHydronicBom(base({ relationships: rels, actuatorSupply: "24V" }));
  const cableLines = r.lines.filter((l) => l.slot === "ACTUATOR_CABLE");
  assert.equal(cableLines.length, 2);
  assert.ok(cableLines.every((l) => l.status === "RESOLVED"));
  const withOptional = resolveFanCoilHydronicBom(base({ relationships: [...rels, rel(9, 900, 40, "optional")], actuatorSupply: "24V" }));
  assert.equal(slot(withOptional, "ROOM_CONTROL")?.status, "RESOLVED");
  assert.equal(withOptional.complete, true);
  const blockedByMissing = resolveFanCoilHydronicBom(base({ relationships: [rel(1, 11, 20, "optional")], actuatorSupply: "24V" }));
  assert.equal(blockedByMissing.complete, false);
  assert.ok(blockedByMissing.blockingSlots.includes("ACTUATOR_CABLE"));
});

test("alternative relation type is not consumed as a companion; incompatible removes only that pair", () => {
  const rels = [rel(1, 11, 20, "alternative"), rel(2, 11, 21, "optional"), rel(3, 11, 21, "incompatible")];
  const r = resolveFanCoilHydronicBom(base({ relationships: rels }));
  assert.equal(slot(r, "ACTUATOR")?.status, "UNRESOLVED_NO_APPROVED_RELATIONSHIP");
});

test("adapter maps choice_group and evidence ids from conditions_json; characteristic is a preference", () => {
  const r = relationshipFromRow({ id: 5, source_product_id: 20, target_product_id: 30, relation_type: "required", review_status: "approved",
    conditions_json: JSON.stringify({ choice_group: "CAB", evidence: [{ document_id: "DAN-ABNM" }, { document_id: "DAN-VZL-2020" }] }) });
  assert.equal(r.choiceGroup, "CAB");
  assert.deepEqual([...r.evidenceDocumentIds], ["DAN-ABNM", "DAN-VZL-2020"]);
  assert.equal(relationshipFromRow({ id: 6, source_product_id: 1, target_product_id: 2, relation_type: "optional", review_status: "approved", conditions_json: "not json" }).evidenceDocumentIds.length, 0);
  const cat2: CatalogComponent[] = [
    ...catalog,
    { productId: 22, sku: "ACT-LIN", role: "ACTUATOR", active: true, supply: "24V", characteristic: "LIN", cableIncluded: true },
    { productId: 23, sku: "ACT-LOG", role: "ACTUATOR", active: true, supply: "24V", characteristic: "LOG", cableIncluded: true },
  ];
  const rels = [rel(1, 11, 22, "optional"), rel(2, 11, 23, "optional")];
  assert.equal(slot(resolveFanCoilHydronicBom(base({ catalog: cat2, relationships: rels })), "ACTUATOR")?.productId, 22);
  assert.equal(slot(resolveFanCoilHydronicBom(base({ catalog: cat2, relationships: rels, preferredCharacteristic: "LOG" })), "ACTUATOR")?.productId, 23);
});

test("required manufacturer accessory is a BOM line: missing adapter blocks completeness, approved adapter resolves it", () => {
  const withPlug = (r: ProductRelationship): ProductRelationship => ({ ...r, requiresAccessory: "stem extension plug" });
  const rels = [withPlug(rel(1, 11, 21, "optional")), rel(2, 21, 30, "required", "approved", "CAB")];
  const noAdapter = resolveFanCoilHydronicBom(base({ relationships: rels, actuatorSupply: "230V" }));
  assert.equal(slot(noAdapter, "VALVE_ADAPTER")?.status, "UNRESOLVED_CATALOG_GAP");
  assert.equal(noAdapter.complete, false);
  assert.ok(noAdapter.blockingSlots.includes("VALVE_ADAPTER"));
  const cat2: CatalogComponent[] = [...catalog, { productId: 50, sku: "PLUG", role: "VALVE_ADAPTER", active: true }];
  const withAdapter = resolveFanCoilHydronicBom(base({ catalog: cat2, relationships: [...rels, rel(3, 11, 50, "required")], actuatorSupply: "230V" }));
  assert.equal(slot(withAdapter, "VALVE_ADAPTER")?.productId, 50);
  assert.equal(slot(withAdapter, "VALVE_ADAPTER")?.status, "RESOLVED");
});

// ---- accessories slot and shared master panel (ceil(n/max))
const ctlCatalog: CatalogComponent[] = [
  ...catalog,
  { productId: 60, sku: "SLAVE", role: "ROOM_CONTROL", active: true, needsMasterControl: true },
  { productId: 61, sku: "ONBOARD", role: "ROOM_CONTROL", active: true },
  { productId: 62, sku: "MASTER", role: "CONTROL_MASTER", active: true },
  { productId: 70, sku: "PAN", role: "ACCESSORY", active: true },
  { productId: 71, sku: "FEET", role: "ACCESSORY", active: true },
  { productId: 72, sku: "KIT-REQ", role: "ACCESSORY", active: false },
];
const withMax = (r: ProductRelationship, max?: number): ProductRelationship => ({ ...r, ...(max ? { maxSourcesPerTarget: max } : {}) });
const masterInput = (n: number, max: number | undefined, over: Partial<FanCoilBomInput> = {}): FanCoilBomInput =>
  base({
    requirements: reqs({ fanCoilCount: n, fanCoilValveSetsRequired: n, actuatorCountRequired: n }),
    fanCoilUnits: [{ productId: 900, count: n }], catalog: ctlCatalog,
    relationships: [rel(1, 900, 60, "optional"), withMax(rel(2, 60, 62, "required"), max)], ...over,
  });

test("master panel quantity is ceil(n/max): boundaries 1, 29, 30, 31, 60, 61", () => {
  const expected: Array<[number, number]> = [[1, 1], [29, 1], [30, 1], [31, 2], [60, 2], [61, 3]];
  for (const [n, qty] of expected) {
    const r = resolveFanCoilHydronicBom(masterInput(n, 30));
    const m = slot(r, "CONTROL_MASTER");
    assert.equal(m?.quantity, qty, `n=${n}`);
    assert.equal(m?.status, "RESOLVED");
    assert.equal(m?.sku, "MASTER");
  }
});

test("master panel: undocumented max -> PENDING_DESIGN; no approved link for a board that needs a master -> blocking; unapproved link ignored", () => {
  const noMax = resolveFanCoilHydronicBom(masterInput(3, undefined));
  assert.equal(slot(noMax, "CONTROL_MASTER")?.status, "PENDING_DESIGN");
  assert.equal(slot(noMax, "CONTROL_MASTER")?.quantity, null);
  const pending = resolveFanCoilHydronicBom(masterInput(3, 30, { relationships: [rel(1, 900, 60, "optional"), withMax(rel(2, 60, 62, "required", "pending_review"), 30)] }));
  const m = slot(pending, "CONTROL_MASTER");
  assert.equal(m?.status, "UNRESOLVED_NO_APPROVED_RELATIONSHIP");
  assert.equal(pending.complete, false);
  assert.ok(pending.blockingSlots.includes("CONTROL_MASTER"));
  const onboard = resolveFanCoilHydronicBom(masterInput(3, 30, { relationships: [rel(1, 900, 61, "optional")] }));
  assert.equal(slot(onboard, "CONTROL_MASTER"), undefined);
});

test("master panel: units of different fan-coil models sharing one board are summed", () => {
  const r = resolveFanCoilHydronicBom(base({
    requirements: reqs({ fanCoilCount: 40, fanCoilValveSetsRequired: 40, actuatorCountRequired: 40 }),
    fanCoilUnits: [{ productId: 900, count: 25 }, { productId: 901, count: 15 }], catalog: ctlCatalog,
    relationships: [rel(1, 900, 60, "optional"), rel(3, 901, 60, "optional"), withMax(rel(2, 60, 62, "required"), 30)],
  }));
  assert.equal(slot(r, "CONTROL_MASTER")?.quantity, 2);
  assert.equal(r.lines.filter((l) => l.slot === "ROOM_CONTROL").length, 2);
});

test("several approved control options need a design choice; an explicit choice resolves it", () => {
  const rels = [rel(1, 900, 60, "optional"), rel(2, 900, 61, "optional")];
  const r = resolveFanCoilHydronicBom(base({ catalog: ctlCatalog, relationships: rels }));
  assert.equal(slot(r, "ROOM_CONTROL")?.status, "PENDING_DESIGN");
  const chosen = resolveFanCoilHydronicBom(base({ catalog: ctlCatalog, relationships: rels, roomControlChoice: { 900: 61 } }));
  assert.equal(slot(chosen, "ROOM_CONTROL")?.productId, 61);
  const bad = resolveFanCoilHydronicBom(base({ catalog: ctlCatalog, relationships: rels, roomControlChoice: { 900: 999 } }));
  assert.equal(slot(bad, "ROOM_CONTROL")?.status, "PENDING_DESIGN");
});

test("accessories: optional lines are listed per unit, scaled by quantity_per_source, and never block completeness", () => {
  const base2 = base({
    catalog: ctlCatalog,
    relationships: [rel(1, 11, 21, "optional"), rel(5, 900, 70, "optional"), { ...rel(6, 900, 71, "recommended"), quantityPerSource: 2, requiredWhen: "floor installation" }],
    actuatorSupply: "230V",
  });
  const r = resolveFanCoilHydronicBom(base2);
  const acc = r.lines.filter((l) => l.slot === "ACCESSORIES");
  assert.equal(acc.length, 2);
  const pan = acc.find((l) => l.sku === "PAN");
  const feet = acc.find((l) => l.sku === "FEET");
  assert.deepEqual([pan?.requirement, pan?.quantity, pan?.status], ["optional", 3, "RESOLVED"]);
  assert.deepEqual([feet?.requirement, feet?.quantity], ["recommended", 6]);
  assert.match(feet?.reason ?? "", /floor installation/);
  assert.ok(!r.blockingSlots.includes("ACCESSORIES"));
  const none = resolveFanCoilHydronicBom(base({ catalog: ctlCatalog, relationships: [rel(5, 900, 70, "optional", "pending_review"), rel(6, 900, 71, "incompatible")] }));
  assert.equal(none.lines.filter((l) => l.slot === "ACCESSORIES").length, 0);
});

test("accessories: an approved REQUIRED companion that is not an active product is a blocking catalog gap", () => {
  const r = resolveFanCoilHydronicBom(base({
    catalog: ctlCatalog,
    relationships: [rel(1, 11, 20, "optional"), rel(2, 20, 30, "required", "approved", "CAB"), rel(8, 900, 72, "required")],
    actuatorSupply: "24V", cableLengthM: 1,
  }));
  const acc = r.lines.find((l) => l.slot === "ACCESSORIES");
  assert.equal(acc?.status, "UNRESOLVED_CATALOG_GAP");
  assert.equal(acc?.requirement, "required");
  assert.ok(r.blockingSlots.includes("ACCESSORIES"));
});

test("adapter maps max_slaves_per_master, quantity_per_source and required_when", () => {
  const a = relationshipFromRow({ id: 1, source_product_id: 1, target_product_id: 2, relation_type: "required", review_status: "approved",
    conditions_json: JSON.stringify({ max_slaves_per_master: 30, quantity_per_source: 2, required_when: "KEV2 not insulated", evidence: [] }) });
  assert.equal(a.maxSourcesPerTarget, 30);
  assert.equal(a.quantityPerSource, 2);
  assert.equal(a.requiredWhen, "KEV2 not insulated");
  const bad = relationshipFromRow({ id: 2, source_product_id: 1, target_product_id: 2, relation_type: "required", review_status: "approved",
    conditions_json: JSON.stringify({ max_slaves_per_master: 0, quantity_per_source: 1.5 }) });
  assert.equal(bad.maxSourcesPerTarget, undefined);
  assert.equal(bad.quantityPerSource, undefined);
});
