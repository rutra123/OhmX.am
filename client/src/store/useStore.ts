import { create } from 'zustand';
import { API } from '../api/client';

export type CartItem = {
  productId: number;
  slug: string;
  sku: string;
  name: string;
  price: number;
  image?: string;
  quantity: number;
  /** Measured unit, e.g. 'м'. Absent = pieces. Does not change the order quantity semantics. */
  unit?: string;
  /** BOM group key (calculator specification) — used to keep cart sections consistent with the PDF. */
  group?: string;
};

export { cartBadgeCount } from './cartBadge';

export type CompareItem = {
  productId: number;
  slug: string;
  sku: string;
  name: string;
  price: number;
  brandName?: string;
};

export type UserRole = 'installer' | 'consumer';
export type UserBudgetLevel = 'unknown' | 'economy' | 'optimal' | 'premium';
export type UserPreferences = {
  preferredBrands: string[];
  preferredCategories: string[];
  projectTypes: string[];
  budgetLevel: UserBudgetLevel;
  aiNotes: string;
  rememberAiHistory: boolean;
  communicationChannel: 'any' | 'phone' | 'email' | 'telegram' | 'whatsapp';
};
export type PinTargetType = 'category' | 'subcategory' | 'series' | 'product' | 'brand';

export type ClientRequirementDocument = {
  userId: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  clientType: UserRole | 'unknown';
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

export type UserAssistantProfile = {
  userId: string;
  documentId: string;
  createdAt: string;
  updatedAt: string;
  registration: Record<string, unknown>;
  preferences: Record<string, unknown>;
  activity: Record<string, unknown>;
  assistantMemory: Record<string, unknown>;
  engineeringSelections: Array<Record<string, unknown>>;
  clientRequirementDocument: ClientRequirementDocument;
};

export type User = {
  id: string;
  name: string;
  phone: string;
  email: string;
  role: UserRole;
  specializations?: string[];
  preferences?: UserPreferences;
  createdAt: string;
};

export type PinnedItem = {
  id: string;
  type: PinTargetType;
  title: string;
  imageUrl?: string;
  url: string;
  contextId?: string;
  contextType?: string;
  order: number;
  createdAt: string;
  ownerId?: string | null;
  subtitle?: string;
};

type TogglePinnedPayload = Omit<PinnedItem, 'order' | 'createdAt' | 'ownerId'>;
type ReorderPinnedPayload = {
  type: PinTargetType;
  contextId?: string;
  contextType?: string;
  orderedIds: string[];
};

type State = {
  cart: CartItem[];
  compare: CompareItem[];
  currentUser: User | null;
  userAssistantProfile: UserAssistantProfile | null;
  isAuthenticated: boolean;
  favorites: number[];
  pinnedItems: PinnedItem[];
  pinnedTools: string[];
  recent: string[];
  adminToken: string;
  addToCart: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  toggleCompare: (item: CompareItem) => void;
  clearCompare: () => void;
  quickRegister: (user: Omit<User, 'id' | 'createdAt'>) => void;
  updateUserProfile: (patch: Partial<Omit<User, 'id' | 'createdAt'>>) => void;
  setUserAssistantProfile: (profile: UserAssistantProfile | null) => void;
  logout: () => void;
  updateQty: (productId: number, quantity: number) => void;
  removeFromCart: (productId: number) => void;
  toggleFavorite: (productId: number) => void;
  togglePinnedItem: (item: TogglePinnedPayload) => void;
  reorderPinnedItems: (payload: ReorderPinnedPayload) => void;
  toggleToolPin: (slug: string) => void;
  addRecent: (slug: string) => void;
  setAdminToken: (token: string) => void;
  clearCart: () => void;
};

const PIN_STORAGE_KEY = 'ohmx:pinnedItems';
const GUEST_OWNER = null;

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};

const defaultUserPreferences: UserPreferences = {
  preferredBrands: [],
  preferredCategories: [],
  projectTypes: [],
  budgetLevel: 'optimal',
  aiNotes: '',
  rememberAiHistory: true,
  communicationChannel: 'any',
};

const splitPreferenceList = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === 'string') return value.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean);
  return [];
};

export const normalizeUserPreferences = (preferences?: Partial<UserPreferences> | Record<string, unknown> | null): UserPreferences => {
  const raw = (preferences || {}) as Record<string, unknown>;
  const budget = ['unknown', 'economy', 'optimal', 'premium'].includes(String(raw.budgetLevel)) ? String(raw.budgetLevel) as UserBudgetLevel : defaultUserPreferences.budgetLevel;
  const channel = ['any', 'phone', 'email', 'telegram', 'whatsapp'].includes(String(raw.communicationChannel))
    ? raw.communicationChannel as UserPreferences['communicationChannel']
    : defaultUserPreferences.communicationChannel;
  return {
    preferredBrands: splitPreferenceList(raw.preferredBrands),
    preferredCategories: splitPreferenceList(raw.preferredCategories),
    projectTypes: splitPreferenceList(raw.projectTypes),
    budgetLevel: budget,
    aiNotes: typeof raw.aiNotes === 'string' ? raw.aiNotes.trim() : '',
    rememberAiHistory: raw.rememberAiHistory !== false,
    communicationChannel: channel,
  };
};

const initialCart = readJson<CartItem[]>('ek-cart', []);
const initialCompare = readJson<CompareItem[]>('ek-compare', []);
const rawInitialUser = readJson<User | null>('ohmx-current-user', null);
const initialUser = rawInitialUser ? { ...rawInitialUser, preferences: normalizeUserPreferences(rawInitialUser.preferences) } : null;
const initialUserAssistantProfile = initialUser ? readJson<UserAssistantProfile | null>(`ohmx:user-context:${initialUser.id}`, null) : null;
const initialFav = readJson<number[]>('ek-fav', []);
const legacyPinnedCategories = readJson<string[]>('ek-category-pins', []);
const initialPinnedTools = readJson<string[]>('ek-tool-pins', []);
const initialRecent = readJson<string[]>('ek-recent', []);
const initialToken = localStorage.getItem('ek-admin-token') || '';
const initialPinnedItemsRaw = readJson<PinnedItem[]>(PIN_STORAGE_KEY, []);
const initialPinnedItems: PinnedItem[] = [
  ...initialPinnedItemsRaw,
  ...legacyPinnedCategories.map((slug, index) => ({
    id: slug,
    type: 'category' as const,
    title: slug,
    url: `/catalog/${slug}`,
    contextId: 'catalog-root',
    contextType: 'catalog',
    order: index,
    createdAt: new Date(0).toISOString(),
    ownerId: initialUser?.id ?? GUEST_OWNER,
  })),
].filter((item, index, arr) => arr.findIndex((candidate) => (
  candidate.id === item.id
  && candidate.type === item.type
  && (candidate.contextId || '') === (item.contextId || '')
  && (candidate.contextType || '') === (item.contextType || '')
  && (candidate.ownerId || null) === (item.ownerId || null)
)) === index);

const persistPinnedItems = (items: PinnedItem[]) => {
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(items));
};

const getOwnerId = (state: Pick<State, 'currentUser'>) => state.currentUser?.id ?? GUEST_OWNER;

const matchPinnedItem = (left: Partial<PinnedItem>, right: Partial<PinnedItem>) => (
  left.id === right.id
  && left.type === right.type
  && (left.contextId || '') === (right.contextId || '')
  && (left.contextType || '') === (right.contextType || '')
  && (left.ownerId || null) === (right.ownerId || null)
);

const normalizeScopedOrder = (items: PinnedItem[], ownerId: string | null, type: PinTargetType, contextId?: string, contextType?: string) => {
  const scopeItems = items
    .filter((item) => item.ownerId === ownerId && item.type === type && (item.contextId || '') === (contextId || '') && (item.contextType || '') === (contextType || ''))
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

  let order = 0;
  for (const item of scopeItems) {
    item.order = order;
    order += 1;
  }

  return items;
};

const createUserAssistantProfile = (user: User): UserAssistantProfile => {
  const now = new Date().toISOString();
  const preferences = normalizeUserPreferences(user.preferences);
  const guestRequirements = readJson<Record<string, unknown> | null>('ohmx-ai-engineering-guest', null);
  const activeSelection = guestRequirements ? {
    selectionId: String(guestRequirements.selectionId || `sel_${Date.now()}`),
    conversationId: String(guestRequirements.conversationId || ''),
    direction: String(guestRequirements.direction || guestRequirements.mode || 'unknown'),
    status: guestRequirements.readyForCalculation ? 'ready_for_calculation' : 'draft',
    requirements: guestRequirements,
    calculation: {},
    equipmentDraft: [],
    createdAt: now,
    updatedAt: now,
  } : null;
  const registration = {
    name: user.name,
    phone: user.phone,
    email: user.email,
    clientType: user.role,
    installerSpecializations: user.role === 'installer' ? user.specializations || [] : [],
    selectedDirections: user.role === 'installer' ? user.specializations || [] : preferences.preferredCategories,
  };
  const engineeringSelections = activeSelection ? [activeSelection] : [];
  const roomDetails = guestRequirements && Array.isArray(guestRequirements.roomDetails) ? guestRequirements.roomDetails as Array<Record<string, unknown>> : [];
  return {
    userId: user.id,
    documentId: `ucd_${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    registration,
    preferences: {
      language: 'ru',
      theme: 'dark',
      preferredBrands: preferences.preferredBrands,
      preferredCategories: preferences.preferredCategories,
      projectTypes: preferences.projectTypes,
      budgetLevel: preferences.budgetLevel,
      aiNotes: preferences.aiNotes,
      rememberAiHistory: preferences.rememberAiHistory,
      communicationChannel: preferences.communicationChannel,
    },
    activity: { viewedProducts: [], viewedCategories: [], viewedBrands: [], searchQueries: [], clickedProducts: [], pinnedItems: [], favoriteProducts: [], cartHistory: [] },
    assistantMemory: {
      activeConversationId: activeSelection?.conversationId || null,
      lastIntent: null,
      lastDirection: activeSelection?.direction || 'unknown',
      activeEngineeringSelection: activeSelection || {},
      completedSelections: [],
      notesForAssistant: preferences.aiNotes ? [{ text: preferences.aiNotes, source: 'registration', createdAt: now }] : [],
    },
    engineeringSelections,
    clientRequirementDocument: {
      userId: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      clientType: user.role,
      selectedDirections: registration.selectedDirections,
      rooms: roomDetails,
      roomAreas: roomDetails.map((room) => ({ id: room.id, label: room.label, type: room.type, areaM2: room.areaM2 })).filter((room) => room.areaM2 !== undefined && room.areaM2 !== null),
      selectionHistory: engineeringSelections,
      viewedCategories: [],
      viewedProducts: [],
      favoriteProductIds: [],
      pinnedItems: [],
      calculations: [],
      finalAiRecommendations: [],
      updatedAt: now,
    },
  };
};

const persistUserAssistantProfile = (input: {
  user: User;
  profile: UserAssistantProfile;
  favorites: number[];
  pinnedItems: PinnedItem[];
  recent: string[];
}) => {
  fetch(`${API}/ai-engineering/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: input.user.id,
      registration: input.profile.registration,
      preferences: input.profile.preferences,
      userContextDocument: input.profile,
      favorites: input.favorites,
      pinnedItems: input.pinnedItems.filter((item) => item.ownerId === input.user.id),
      viewedProducts: input.recent,
      selectedDirections: input.user.role === 'installer' ? input.user.specializations || [] : [],
    }),
  })
    .then((response) => response.ok ? response.json() : null)
    .then((data) => {
      if (data?.userContextDocument) localStorage.setItem(`ohmx:user-context:${input.user.id}`, JSON.stringify(data.userContextDocument));
    })
    .catch(() => undefined);
};

export const useStore = create<State>((set, get) => ({
  cart: initialCart,
  compare: initialCompare,
  currentUser: initialUser,
  userAssistantProfile: initialUserAssistantProfile,
  isAuthenticated: Boolean(initialUser),
  favorites: initialFav,
  pinnedItems: initialPinnedItems,
  pinnedTools: initialPinnedTools,
  recent: initialRecent,
  adminToken: initialToken,
  addToCart: (item, quantity = 1) => {
    const amount = Math.max(1, Math.floor(Number(quantity) || 1));
    const cart = [...get().cart];
    const idx = cart.findIndex((x) => x.productId === item.productId);
    if (idx >= 0) cart[idx] = { ...cart[idx], quantity: cart[idx].quantity + amount };
    else cart.push({ ...item, quantity: amount });
    localStorage.setItem('ek-cart', JSON.stringify(cart));
    set({ cart });
  },
  toggleCompare: (item) => {
    const compare = get().compare.some((x) => x.productId === item.productId)
      ? get().compare.filter((x) => x.productId !== item.productId)
      : [...get().compare.slice(-3), item];
    localStorage.setItem('ek-compare', JSON.stringify(compare));
    set({ compare });
  },
  clearCompare: () => {
    localStorage.setItem('ek-compare', '[]');
    set({ compare: [] });
  },
  quickRegister: (user) => {
    const currentUser = {
      ...user,
      preferences: normalizeUserPreferences(user.preferences),
      id: `user_${Date.now()}`,
      createdAt: new Date().toISOString(),
    };
    const migratedPins = get().pinnedItems.map((item) => item.ownerId == null ? { ...item, ownerId: currentUser.id } : item);
    const userAssistantProfile = createUserAssistantProfile(currentUser);
    localStorage.setItem('ohmx-current-user', JSON.stringify(currentUser));
    localStorage.setItem(`ohmx:user-context:${currentUser.id}`, JSON.stringify(userAssistantProfile));
    persistPinnedItems(migratedPins);
    set({ currentUser, userAssistantProfile, isAuthenticated: true, pinnedItems: migratedPins });
    persistUserAssistantProfile({ user: currentUser, profile: userAssistantProfile, favorites: get().favorites, pinnedItems: migratedPins, recent: get().recent });
  },
  updateUserProfile: (patch) => {
    const existing = get().currentUser;
    if (!existing) return;
    const currentUser: User = {
      ...existing,
      ...patch,
      specializations: patch.specializations ?? existing.specializations ?? [],
      preferences: normalizeUserPreferences({ ...(existing.preferences || {}), ...(patch.preferences || {}) }),
    };
    const now = new Date().toISOString();
    const existingProfile = get().userAssistantProfile || createUserAssistantProfile(currentUser);
    const registration = {
      ...(existingProfile.registration || {}),
      name: currentUser.name,
      phone: currentUser.phone,
      email: currentUser.email,
      clientType: currentUser.role,
      installerSpecializations: currentUser.role === 'installer' ? currentUser.specializations || [] : [],
      selectedDirections: currentUser.role === 'installer' ? currentUser.specializations || [] : currentUser.preferences?.preferredCategories || [],
    };
    const preferences = {
      ...(existingProfile.preferences || {}),
      ...(currentUser.preferences || {}),
      language: 'ru',
    };
    const userAssistantProfile = {
      ...existingProfile,
      updatedAt: now,
      registration,
      preferences,
      assistantMemory: {
        ...(existingProfile.assistantMemory || {}),
        notesForAssistant: currentUser.preferences?.aiNotes
          ? [{ text: currentUser.preferences.aiNotes, source: 'profile', updatedAt: now }]
          : (existingProfile.assistantMemory?.notesForAssistant || []),
      },
    };
    localStorage.setItem('ohmx-current-user', JSON.stringify(currentUser));
    localStorage.setItem(`ohmx:user-context:${currentUser.id}`, JSON.stringify(userAssistantProfile));
    set({ currentUser, userAssistantProfile });
    persistUserAssistantProfile({ user: currentUser, profile: userAssistantProfile, favorites: get().favorites, pinnedItems: get().pinnedItems, recent: get().recent });
  },
  logout: () => {
    localStorage.removeItem('ohmx-current-user');
    set({ currentUser: null, userAssistantProfile: null, isAuthenticated: false });
  },
  setUserAssistantProfile: (profile) => {
    const userId = profile?.userId || get().currentUser?.id;
    if (profile && userId) localStorage.setItem(`ohmx:user-context:${userId}`, JSON.stringify(profile));
    set({ userAssistantProfile: profile });
  },
  updateQty: (productId, quantity) => {
    const cart = get().cart.map((x) => (x.productId === productId ? { ...x, quantity: Math.max(1, quantity) } : x));
    localStorage.setItem('ek-cart', JSON.stringify(cart));
    set({ cart });
  },
  removeFromCart: (productId) => {
    const cart = get().cart.filter((x) => x.productId !== productId);
    localStorage.setItem('ek-cart', JSON.stringify(cart));
    set({ cart });
  },
  toggleFavorite: (productId) => {
    const favorites = get().favorites.includes(productId)
      ? get().favorites.filter((x) => x !== productId)
      : [...get().favorites, productId];
    localStorage.setItem('ek-fav', JSON.stringify(favorites));
    set({ favorites });
    const user = get().currentUser;
    const profile = get().userAssistantProfile;
    if (user && profile) persistUserAssistantProfile({ user, profile, favorites, pinnedItems: get().pinnedItems, recent: get().recent });
  },
  togglePinnedItem: (item) => {
    const ownerId = getOwnerId(get());
    const scopedItem = { ...item, ownerId };
    const existing = get().pinnedItems.find((candidate) => matchPinnedItem(candidate, scopedItem));

    if (existing) {
      const pinnedItems = normalizeScopedOrder(
        get().pinnedItems.filter((candidate) => !matchPinnedItem(candidate, scopedItem)),
        ownerId,
        item.type,
        item.contextId,
        item.contextType,
      );
      persistPinnedItems(pinnedItems);
      set({ pinnedItems });
      const user = get().currentUser;
      const profile = get().userAssistantProfile;
      if (user && profile) persistUserAssistantProfile({ user, profile, favorites: get().favorites, pinnedItems, recent: get().recent });
      return;
    }

    const scopeItems = get().pinnedItems.filter((candidate) => (
      candidate.ownerId === ownerId
      && candidate.type === item.type
      && (candidate.contextId || '') === (item.contextId || '')
      && (candidate.contextType || '') === (item.contextType || '')
    ));

    const pinnedItems = normalizeScopedOrder([
      ...get().pinnedItems,
      {
        ...item,
        ownerId,
        order: scopeItems.length,
        createdAt: new Date().toISOString(),
      },
    ], ownerId, item.type, item.contextId, item.contextType);

    persistPinnedItems(pinnedItems);
    set({ pinnedItems });
    const user = get().currentUser;
    const profile = get().userAssistantProfile;
    if (user && profile) persistUserAssistantProfile({ user, profile, favorites: get().favorites, pinnedItems, recent: get().recent });
  },
  reorderPinnedItems: ({ type, contextId, contextType, orderedIds }) => {
    const ownerId = getOwnerId(get());
    const scopeItems = get().pinnedItems
      .filter((item) => item.ownerId === ownerId && item.type === type && (item.contextId || '') === (contextId || '') && (item.contextType || '') === (contextType || ''))
      .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));

    const byId = new Map(scopeItems.map((item) => [item.id, item]));
    const remaining = scopeItems.filter((item) => !orderedIds.includes(item.id));
    const ordered = [
      ...orderedIds.map((id) => byId.get(id)).filter(Boolean),
      ...remaining,
    ].map((item, index) => ({ ...item!, order: index }));

    const pinnedItems = get().pinnedItems.map((item) => {
      if (item.ownerId === ownerId && item.type === type && (item.contextId || '') === (contextId || '') && (item.contextType || '') === (contextType || '')) {
        return ordered.find((candidate) => candidate.id === item.id) || item;
      }
      return item;
    });

    persistPinnedItems(pinnedItems);
    set({ pinnedItems });
    const user = get().currentUser;
    const profile = get().userAssistantProfile;
    if (user && profile) persistUserAssistantProfile({ user, profile, favorites: get().favorites, pinnedItems, recent: get().recent });
  },
  toggleToolPin: (slug) => {
    const pinnedTools = get().pinnedTools.includes(slug)
      ? get().pinnedTools.filter((x) => x !== slug)
      : [...get().pinnedTools, slug];
    localStorage.setItem('ek-tool-pins', JSON.stringify(pinnedTools));
    set({ pinnedTools });
  },
  addRecent: (slug) => {
    const recent = [slug, ...get().recent.filter((x) => x !== slug)].slice(0, 8);
    localStorage.setItem('ek-recent', JSON.stringify(recent));
    set({ recent });
    const user = get().currentUser;
    const profile = get().userAssistantProfile;
    if (user && profile) persistUserAssistantProfile({ user, profile, favorites: get().favorites, pinnedItems: get().pinnedItems, recent });
  },
  setAdminToken: (adminToken) => {
    localStorage.setItem('ek-admin-token', adminToken);
    set({ adminToken });
  },
  clearCart: () => {
    localStorage.setItem('ek-cart', '[]');
    set({ cart: [] });
  },
}));
