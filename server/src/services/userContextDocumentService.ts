import * as crypto from 'node:crypto';
import { db } from '../db.js';

export type ClientRequirementDocument = {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  clientType: 'installer' | 'consumer' | 'unknown';
  selectedDirections: string[];
  rooms: Array<Record<string, unknown>>;
  roomAreas: Array<Record<string, unknown>>;
  selectionHistory: Array<Record<string, unknown>>;
  viewedCategories: unknown[];
  viewedProducts: unknown[];
  favoriteProductIds: unknown[];
  pinnedItems: unknown[];
  calculations: Array<Record<string, unknown>>;
  finalAiRecommendations: unknown[];
  updatedAt: string;
};

export type UserContextDocument = {
  userId: string;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  registration: Record<string, unknown>;
  preferences: Record<string, unknown>;
  activity: Record<string, unknown[]>;
  assistantMemory: Record<string, unknown>;
  engineeringSelections: Array<Record<string, unknown>>;
  clientRequirementDocument: ClientRequirementDocument;
};

type EventPayload = {
  eventType: string;
  userId?: string | null;
  guestId?: string | null;
  productId?: string | number | null;
  categoryId?: string | number | null;
  brandId?: string | number | null;
  selectionId?: string | null;
  direction?: string | null;
  searchQuery?: string | null;
  payload?: Record<string, unknown>;
};

const emptyActivity = (): Record<string, unknown[]> => ({
  viewedProducts: [], viewedCategories: [], viewedBrands: [], searchQueries: [], clickedProducts: [], pinnedItems: [], favoriteProducts: [], cartHistory: [], openedDocuments: [], engineeringEvents: [],
});

function uniqueCompact(values: unknown[]) {
  const seen = new Set<string>();
  const result: unknown[] = [];
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const key = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function cleanPreferenceInput(preferences?: Record<string, unknown> | null) {
  if (!preferences) return {};
  const cleanList = (value: unknown) => Array.isArray(value)
    ? value.map(String).map((item) => item.trim()).filter(Boolean)
    : typeof value === 'string'
      ? value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean)
      : undefined;
  const next: Record<string, unknown> = {};
  const preferredBrands = cleanList(preferences.preferredBrands);
  const preferredCategories = cleanList(preferences.preferredCategories);
  const projectTypes = cleanList(preferences.projectTypes);
  if (preferredBrands) next.preferredBrands = preferredBrands;
  if (preferredCategories) next.preferredCategories = preferredCategories;
  if (projectTypes) next.projectTypes = projectTypes;
  if (['unknown', 'economy', 'optimal', 'premium'].includes(String(preferences.budgetLevel))) next.budgetLevel = preferences.budgetLevel;
  if (typeof preferences.aiNotes === 'string') next.aiNotes = preferences.aiNotes.trim();
  if (typeof preferences.rememberAiHistory === 'boolean') next.rememberAiHistory = preferences.rememberAiHistory;
  if (['any', 'phone', 'email', 'telegram', 'whatsapp'].includes(String(preferences.communicationChannel))) next.communicationChannel = preferences.communicationChannel;
  if (typeof preferences.language === 'string') next.language = preferences.language;
  if (typeof preferences.theme === 'string') next.theme = preferences.theme;
  return next;
}

function selectionRooms(selection: Record<string, unknown>) {
  const requirements = selection.requirements && typeof selection.requirements === 'object' ? selection.requirements as Record<string, unknown> : {};
  return Array.isArray(requirements.roomDetails) ? requirements.roomDetails as Array<Record<string, unknown>> : [];
}

function selectionCalculation(selection: Record<string, unknown>) {
  return selection.calculation && typeof selection.calculation === 'object' ? selection.calculation as Record<string, unknown> : {};
}

function createClientRequirementDocument(document: Omit<UserContextDocument, 'clientRequirementDocument'> & { clientRequirementDocument?: ClientRequirementDocument }): ClientRequirementDocument {
  const registration = document.registration || {};
  const activity = document.activity || emptyActivity();
  const selections = Array.isArray(document.engineeringSelections) ? document.engineeringSelections : [];
  const rooms = selections.flatMap(selectionRooms);
  const roomAreas = rooms.map((room) => ({ id: room.id, label: room.label, type: room.type, areaM2: room.areaM2 })).filter((room) => room.areaM2 !== undefined && room.areaM2 !== null);
  const selectedDirections = uniqueCompact([
    ...(Array.isArray(registration.selectedDirections) ? registration.selectedDirections : []),
    ...(Array.isArray(registration.installerSpecializations) ? registration.installerSpecializations : []),
    ...selections.map((selection) => selection.direction),
  ]).map(String);
  const calculations = selections.map(selectionCalculation).filter((calculation) => Object.keys(calculation).length);
  const finalAiRecommendations = uniqueCompact([
    ...calculations.map((calculation) => calculation.engineerRecommendation),
    ...calculations.flatMap((calculation) => Array.isArray(calculation.roomRecommendations) ? calculation.roomRecommendations : []),
  ]);
  return {
    userId: document.userId,
    name: typeof registration.name === 'string' ? registration.name : null,
    phone: typeof registration.phone === 'string' ? registration.phone : null,
    email: typeof registration.email === 'string' ? registration.email : null,
    clientType: registration.clientType === 'installer' || registration.clientType === 'consumer' ? registration.clientType : 'unknown',
    selectedDirections,
    rooms,
    roomAreas,
    selectionHistory: selections,
    viewedCategories: Array.isArray(activity.viewedCategories) ? activity.viewedCategories : [],
    viewedProducts: Array.isArray(activity.viewedProducts) ? activity.viewedProducts : [],
    favoriteProductIds: Array.isArray(activity.favoriteProducts) ? activity.favoriteProducts : [],
    pinnedItems: Array.isArray(activity.pinnedItems) ? activity.pinnedItems : [],
    calculations,
    finalAiRecommendations,
    updatedAt: document.updatedAt,
  };
}

function normalizeUserContextDocument(document: UserContextDocument): UserContextDocument {
  document.activity = { ...emptyActivity(), ...(document.activity || {}) };
  document.engineeringSelections = Array.isArray(document.engineeringSelections) ? document.engineeringSelections : [];
  document.clientRequirementDocument = createClientRequirementDocument(document);
  return document;
}

export function createDefaultUserContextDocument(input: {
  userId: string;
  registration?: Record<string, unknown>;
  conversationId?: string | null;
  guestState?: Record<string, unknown> | null;
}): UserContextDocument {
  const now = new Date().toISOString();
  const selection = input.guestState && Object.keys(input.guestState).length ? {
    selectionId: String(input.guestState.selectionId || `sel_${crypto.randomUUID()}`),
    conversationId: String(input.conversationId || input.guestState.conversationId || crypto.randomUUID()),
    direction: String(input.guestState.direction || input.guestState.mode || 'unknown'),
    status: input.guestState.readyForCalculation ? 'ready_for_calculation' : 'draft',
    requirements: input.guestState,
    calculation: {},
    equipmentDraft: [],
    createdAt: now,
    updatedAt: now,
  } : null;
  const base = {
    userId: input.userId,
    documentId: `ucd_${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    registration: input.registration || {},
    preferences: { language: 'ru', theme: 'dark', preferredBrands: [], preferredCategories: [], projectTypes: [], budgetLevel: 'optimal', aiNotes: '', rememberAiHistory: true, communicationChannel: 'any' },
    activity: emptyActivity(),
    assistantMemory: {
      activeConversationId: input.conversationId || null,
      lastIntent: null,
      lastDirection: selection?.direction || 'unknown',
      activeEngineeringSelection: selection || {},
      completedSelections: [],
      notesForAssistant: [],
    },
    engineeringSelections: selection ? [selection] : [],
  } as Omit<UserContextDocument, 'clientRequirementDocument'> & { clientRequirementDocument?: ClientRequirementDocument };
  return normalizeUserContextDocument(base as UserContextDocument);
}

function parseDoc(raw: string | null | undefined): UserContextDocument | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as UserContextDocument; } catch { return null; }
}

export function getUserContextDocument(userId: string): UserContextDocument | null {
  const row = db.prepare('SELECT document_json FROM user_context_documents WHERE user_id = ?').get(userId) as { document_json?: string } | undefined;
  const document = parseDoc(row?.document_json);
  return document ? normalizeUserContextDocument(document) : null;
}

export function saveUserContextDocument(document: UserContextDocument) {
  document.updatedAt = new Date().toISOString();
  const normalized = normalizeUserContextDocument(document);
  db.prepare(`INSERT INTO user_context_documents (user_id, document_id, document_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET document_json = excluded.document_json, updated_at = excluded.updated_at`).run(
    normalized.userId,
    normalized.documentId,
    JSON.stringify(normalized),
    normalized.createdAt,
    normalized.updatedAt,
  );
  return normalized;
}

export function ensureUserContextDocument(input: { userId?: string | null; registration?: Record<string, unknown>; preferences?: Record<string, unknown>; conversationId?: string | null; guestState?: Record<string, unknown> | null; provided?: UserContextDocument | null }) {
  if (!input.userId) return input.provided || null;
  const existing = getUserContextDocument(input.userId) || input.provided || createDefaultUserContextDocument({ userId: input.userId, registration: input.registration, conversationId: input.conversationId, guestState: input.guestState });
  existing.registration = { ...(existing.registration || {}), ...(input.registration || {}) };
  existing.preferences = { ...(existing.preferences || {}), ...cleanPreferenceInput(input.preferences) };
  if (input.conversationId) existing.assistantMemory.activeConversationId = input.conversationId;
  return saveUserContextDocument(existing);
}

export function mergeClientProfileState(input: {
  userId: string;
  registration?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
  favorites?: unknown[];
  pinnedItems?: unknown[];
  viewedProducts?: unknown[];
  viewedCategories?: unknown[];
  selectedDirections?: unknown[];
  provided?: UserContextDocument | null;
}) {
  const document = ensureUserContextDocument({ userId: input.userId, registration: input.registration, preferences: input.preferences, provided: input.provided });
  if (!document) return null;
  const activity = { ...emptyActivity(), ...(document.activity || {}) };
  if (Array.isArray(input.favorites)) activity.favoriteProducts = input.favorites;
  if (Array.isArray(input.pinnedItems)) activity.pinnedItems = input.pinnedItems;
  if (Array.isArray(input.viewedProducts)) activity.viewedProducts = input.viewedProducts;
  if (Array.isArray(input.viewedCategories)) activity.viewedCategories = input.viewedCategories;
  document.activity = activity;
  if (Array.isArray(input.selectedDirections)) {
    document.registration = { ...(document.registration || {}), selectedDirections: input.selectedDirections };
  }
  return saveUserContextDocument(document);
}

export function updateAssistantSelectionMemory(input: { document: UserContextDocument | null; conversationId: string; intent: string; requirements: Record<string, unknown>; calculation?: Record<string, unknown>; equipmentDraft?: unknown[]; status?: string }) {
  if (!input.document) return { document: null, patch: {} };
  const now = new Date().toISOString();
  const direction = String(input.requirements.direction || input.requirements.mode || 'unknown');
  const selectionId = String(input.requirements.selectionId || `sel_${input.conversationId}`);
  const selection = {
    selectionId,
    conversationId: input.conversationId,
    direction,
    status: input.status || (input.requirements.readyForCalculation ? 'ready_for_calculation' : 'draft'),
    requirements: input.requirements,
    calculation: input.calculation || {},
    equipmentDraft: input.equipmentDraft || [],
    createdAt: now,
    updatedAt: now,
  };
  const existingIndex = input.document.engineeringSelections.findIndex((item) => item.conversationId === input.conversationId || item.selectionId === selectionId);
  if (existingIndex >= 0) input.document.engineeringSelections[existingIndex] = { ...input.document.engineeringSelections[existingIndex], ...selection, updatedAt: now };
  else input.document.engineeringSelections.push(selection);
  input.document.assistantMemory = {
    ...(input.document.assistantMemory || {}),
    activeConversationId: input.conversationId,
    lastIntent: input.intent,
    lastDirection: direction,
    activeEngineeringSelection: selection,
  };
  saveUserContextDocument(input.document);
  return { document: input.document, patch: { assistantMemory: input.document.assistantMemory, engineeringSelection: selection } };
}

export function recordUserActivity(event: EventPayload) {
  const createdAt = new Date().toISOString();
  db.prepare(`INSERT INTO user_activity_events (event_type, user_id, guest_id, product_id, category_id, brand_id, selection_id, direction, search_query, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    event.eventType, event.userId || null, event.guestId || null, event.productId || null, event.categoryId || null,
    event.brandId || null, event.selectionId || null, event.direction || null, event.searchQuery || null, JSON.stringify(event.payload || {}), createdAt,
  );
  if (!event.userId) return null;
  const document = getUserContextDocument(event.userId);
  if (!document) return null;
  const activity = document.activity || emptyActivity();
  const append = (key: keyof ReturnType<typeof emptyActivity>, value: unknown) => {
    const current = Array.isArray(activity[key]) ? activity[key] : [];
    activity[key] = [...current.slice(-49), value];
  };
  const payload = { ...event, createdAt };
  if (event.eventType === 'product_view') append('viewedProducts', payload);
  if (event.eventType === 'category_view') append('viewedCategories', payload);
  if (event.eventType === 'brand_view') append('viewedBrands', payload);
  if (event.eventType === 'search_query') append('searchQueries', payload);
  if (event.eventType === 'cart_add') append('cartHistory', payload);
  if (event.eventType === 'pin_item') append('pinnedItems', payload);
  if (event.eventType === 'favorite_product') append('favoriteProducts', payload);
  if (event.eventType === 'product_document_open') append('openedDocuments', payload);
  if (event.eventType.startsWith('engineering_selection')) append('engineeringEvents', payload);
  document.activity = activity;
  return saveUserContextDocument(document);
}
