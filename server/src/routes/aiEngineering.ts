import * as crypto from 'node:crypto';
import { Router } from 'express';
import * as nodemailer from 'nodemailer';
import { runEngineeringChatStep, type EngineeringIntent } from '../services/aiEngineeringService.js';
import { calculateRequiredPower, generateEngineeringSelection, type BudgetLevel, type EnergySource, type EngineeringRequirements } from '../services/engineeringSelectionService.js';
import { type UIState, nextQuestion, buildFlowState, flowProgress } from '../services/aiEngineeringFlow.js';
import { ensureUserContextDocument, mergeClientProfileState, updateAssistantSelectionMemory, recordUserActivity, type UserContextDocument } from '../services/userContextDocumentService.js';

const router = Router();

const startIntentMessages: Record<string, string> = {
  heating_selection: 'Отопление',
  cooling_selection: 'Охлаждение',
  floor_heating_selection: 'Тёплый пол',
  boiler_selection: 'Газовый котёл',
  radiator_selection: 'Радиаторы',
  hvac_selection: 'Heat pump',
  electrical_selection: 'Электрика',
  pump_selection: 'Насос',
};

function safeRequirements(body: unknown): EngineeringRequirements {
  const raw = ((body as { requirements?: Partial<EngineeringRequirements> })?.requirements || {}) as Partial<EngineeringRequirements>;
  return normalizeSelectionRequirements(raw as Record<string, unknown>);
}

function normalizeSelectionRequirements(raw: Record<string, unknown>): EngineeringRequirements {
  const allowedRoomTypes = new Set(['apartment', 'house', 'office', 'commercial', 'bathroom', 'kitchen', 'bedroom', 'living_room', 'corridor', 'hallway', 'other', 'unknown']);
  const allowedEnergy = new Set(['gas', 'electric', 'universal', 'unknown']);
  const allowedInsulation = new Set(['good', 'normal', 'poor', 'unknown']);
  const allowedWindows = new Set(['normal', 'large', 'sunny', 'unknown']);
  const mode = String(raw.mode || 'unknown') as EngineeringRequirements['mode'];
  const budget = raw.budgetLevel === 'any' || !raw.budgetLevel || raw.budgetLevel === 'unknown' ? 'optimal' : raw.budgetLevel;
  const roomType = allowedRoomTypes.has(String(raw.roomType)) ? String(raw.roomType) : 'unknown';
  const energySource = allowedEnergy.has(String(raw.energySource)) ? String(raw.energySource) : 'unknown';
  const insulation = allowedInsulation.has(String(raw.insulation)) ? String(raw.insulation) : 'unknown';
  const windows = allowedWindows.has(String(raw.windows)) ? String(raw.windows) : 'unknown';
  const area = typeof raw.area === 'number' ? raw.area : raw.area ? Number(raw.area) : raw.roomAreaM2 ? Number(raw.roomAreaM2) : null;
  const ceilingHeight = typeof raw.ceilingHeight === 'number' ? raw.ceilingHeight : raw.ceilingHeight ? Number(raw.ceilingHeight) : raw.ceilingHeightM ? Number(raw.ceilingHeightM) : 2.7;
  const floorPurpose = ['comfort', 'primary_heating', 'additional_heating', 'unknown'].includes(String(raw.floorHeatingPurpose)) ? String(raw.floorHeatingPurpose) : undefined;
  const floorFinish = ['tile', 'porcelain_tile', 'laminate', 'wood', 'vinyl_spc', 'other', 'unknown'].includes(String(raw.floorFinish)) ? String(raw.floorFinish) : undefined;
  const floorBuildType = ['new_screed', 'tile_adhesive', 'minimal_height', 'existing_floor', 'unknown'].includes(String(raw.floorBuildType)) ? String(raw.floorBuildType) : undefined;
  const preferredHeatingElement = ['heating_cable', 'heating_mat', 'thin_mat', 'auto'].includes(String(raw.preferredHeatingElement)) ? String(raw.preferredHeatingElement) : undefined;
  return {
    mode,
    area,
    roomAreaM2: area,
    ceilingHeight,
    ceilingHeightM: ceilingHeight,
    roomType: roomType as EngineeringRequirements['roomType'],
    hasGas: typeof raw.hasGas === 'boolean' ? raw.hasGas : raw.energySource === 'gas' ? true : raw.energySource === 'electric' ? false : null,
    energySource: energySource as EnergySource,
    preferredSystemTypes: Array.isArray(raw.preferredSystemTypes) ? raw.preferredSystemTypes.map(String) : [],
    insulation: insulation as EngineeringRequirements['insulation'],
    windows: windows as EngineeringRequirements['windows'],
    budgetLevel: budget as BudgetLevel,
    includeAccessories: raw.includeAccessories !== false,
    floorHeatingPurpose: floorPurpose as EngineeringRequirements['floorHeatingPurpose'],
    floorFinish: floorFinish as EngineeringRequirements['floorFinish'],
    floorBuildType: floorBuildType as EngineeringRequirements['floorBuildType'],
    preferredHeatingElement: preferredHeatingElement as EngineeringRequirements['preferredHeatingElement'],
    blockedZones: Array.isArray(raw.blockedZones) ? raw.blockedZones.map(String) : [],
    blockedAreaM2: typeof raw.blockedAreaM2 === 'number' ? raw.blockedAreaM2 : raw.blockedAreaM2 ? Number(raw.blockedAreaM2) : null,
    availableInstallAreaM2: typeof raw.availableInstallAreaM2 === 'number' ? raw.availableInstallAreaM2 : raw.availableInstallAreaM2 ? Number(raw.availableInstallAreaM2) : raw.installationArea ? Number(raw.installationArea) : null,
    requiredHeatingPowerW: typeof raw.requiredHeatingPowerW === 'number' ? raw.requiredHeatingPowerW : raw.requiredHeatingPowerW ? Number(raw.requiredHeatingPowerW) : null,
    stockPolicy: raw.stockPolicy === 'show_availability_only' ? 'show_availability_only' : 'hide_exact_stock',
  };
}

function deriveIntentFromMode(mode: unknown, fallback: EngineeringIntent = 'unknown'): EngineeringIntent {
  if (mode === 'floor_heating') return 'floor_heating_selection';
  if (mode === 'cooling') return 'cooling_selection';
  if (mode === 'heating') return 'heating_selection';
  if (mode === 'electrical') return 'electrical_selection';
  return fallback;
}

function electricHeatingRoomForm(): UIState {
  return {
    type: 'requirements_form',
    form: {
      id: 'electric_heating_room_form',
      title: 'Данные помещения',
      intent: 'electric_heating_selection',
      mode: 'heating',
      fields: [
        { name: 'areaM2', label: 'Площадь помещения, м²', type: 'number', required: true, placeholder: 'Например: 20', min: 1, max: 500, defaultValue: 20 },
        { name: 'ceilingHeightM', label: 'Высота потолка, м', type: 'number', required: true, placeholder: 'Например: 2.7', min: 2, max: 6, step: 0.1, defaultValue: 2.7 },
        {
          name: 'roomType',
          label: 'Тип помещения',
          type: 'select',
          required: true,
          options: [
            { value: 'living_room', label: 'Гостиная' },
            { value: 'bedroom', label: 'Спальня' },
            { value: 'bathroom', label: 'Ванная' },
            { value: 'kitchen', label: 'Кухня' },
            { value: 'hallway', label: 'Коридор' },
            { value: 'office', label: 'Офис' },
            { value: 'other', label: 'Другое' },
          ],
        },
        {
          name: 'insulationLevel',
          label: 'Утепление помещения',
          type: 'select',
          required: true,
          options: [
            { value: 'good', label: 'Хорошее' },
            { value: 'medium', label: 'Среднее' },
            { value: 'poor', label: 'Слабое' },
          ],
        },
        {
          name: 'windows',
          label: 'Окна',
          type: 'select',
          required: false,
          options: [
            { value: 'standard', label: 'Обычные окна' },
            { value: 'large', label: 'Большие окна' },
            { value: 'panoramic', label: 'Панорамные окна' },
            { value: 'none', label: 'Без окон' },
          ],
        },
        {
          name: 'budgetTier',
          label: 'Бюджет',
          type: 'select',
          required: false,
          options: [
            { value: 'economy', label: 'Экономичный' },
            { value: 'optimal', label: 'Оптимальный' },
            { value: 'premium', label: 'Премиум' },
          ],
        },
        { name: 'includeAccessories', label: 'Добавить сопутствующие товары', type: 'checkbox', defaultValue: true },
      ],
      submitLabel: 'Рассчитать',
    },
  };
}

function shouldUseElectricHeatingForm(requirements: Record<string, unknown>, intent: string) {
  const isHeating = intent === 'heating_selection' || intent === 'electric_heating_selection';
  const isElectric = requirements.energySource === 'electric' || requirements.hasGas === false;
  const hasApartmentRoomFlow = requirements.objectType === 'apartment' || (Array.isArray(requirements.roomDetails) && requirements.roomDetails.length > 0);
  return isHeating && isElectric && !hasApartmentRoomFlow;
}

function normalizeElectricHeatingFormValues(formValues: Record<string, unknown>, current: Record<string, unknown>) {
  const insulationRaw = String(formValues.insulationLevel || current.insulation || 'normal');
  const windowsRaw = String(formValues.windows || current.windows || 'normal');
  const budgetRaw = String(formValues.budgetTier || current.budgetLevel || 'optimal');
  const roomTypeRaw = String(formValues.roomType || current.roomType || 'unknown');
  const roomTypeMap: Record<string, EngineeringRequirements['roomType']> = {
    living_room: 'apartment',
    bedroom: 'apartment',
    bathroom: 'bathroom',
    kitchen: 'kitchen',
    hallway: 'apartment',
    office: 'office',
    other: 'unknown',
  };
  return buildFlowState({
    ...current,
    mode: 'heating',
    area: Number(formValues.areaM2 || current.area || 20),
    ceilingHeight: Number(formValues.ceilingHeightM || current.ceilingHeight || 2.7),
    roomType: roomTypeMap[roomTypeRaw] || 'unknown',
    hasGas: false,
    energySource: 'electric',
    insulation: insulationRaw === 'medium' ? 'normal' : insulationRaw,
    windows: windowsRaw === 'standard' || windowsRaw === 'none' ? 'normal' : windowsRaw === 'panoramic' ? 'large' : windowsRaw,
    budgetLevel: budgetRaw === 'unknown' || budgetRaw === 'any' ? 'optimal' : budgetRaw,
    includeAccessories: formValues.includeAccessories !== false,
  }, 'heating_selection');
}

function makeQuestionUi(requirements: Record<string, unknown>, intent: string): { ui: UIState; missingFields: string[]; readyForSelection: boolean } {
  if (shouldUseElectricHeatingForm(requirements, intent)) {
    return {
      ui: electricHeatingRoomForm(),
      missingFields: ['areaM2', 'ceilingHeightM', 'roomType', 'insulationLevel'],
      readyForSelection: false,
    };
  }
  const question = nextQuestion(requirements, intent, []);
  if (!question) return { ui: { type: 'result' }, missingFields: [], readyForSelection: true };
  const progress = flowProgress(intent, question);
  return {
    ui: { type: 'question_flow', ...progress, question },
    missingFields: [question.field],
    readyForSelection: false,
  };
}

function guidedResponse(input: {
  conversationId?: string;
  reply: string;
  intent: string;
  requirements: Record<string, unknown>;
  selection?: ReturnType<typeof generateEngineeringSelection> | null;
}) {
  const flow = makeQuestionUi(input.requirements, input.intent);
  return {
    conversationId: input.conversationId || crypto.randomUUID(),
    reply: input.reply,
    state: {
      intent: input.intent,
      stage: flow.readyForSelection ? 'ready_for_selection' : 'collecting_requirements',
      requirements: input.requirements,
      missingFields: flow.missingFields,
      readyForSelection: flow.readyForSelection,
    },
    selection: input.selection || null,
    ui: flow.ui,
  };
}

function shortStartReply(intent: string) {
  if (intent === 'floor_heating_selection') return 'Подберём тёплый пол. Начнём с параметров помещения.';
  if (intent === 'cooling_selection' || intent === 'hvac_selection') return 'Подберём охлаждение. Сначала уточним объект и помещения.';
  if (intent === 'electrical_selection') return 'Подберём электрику. Сначала уточним задачу.';
  return 'Подберём отопление. Начнём с параметров помещения.';
}


function readUserContextInput(body: Record<string, unknown>) {
  const provided = body.userContextDocument && typeof body.userContextDocument === 'object' ? body.userContextDocument as UserContextDocument : null;
  const context = body.context && typeof body.context === 'object' ? body.context as Record<string, unknown> : {};
  const userId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : provided?.userId || null;
  const registration = body.registration && typeof body.registration === 'object' ? body.registration as Record<string, unknown> : provided?.registration || undefined;
  const preferences = body.preferences && typeof body.preferences === 'object'
    ? body.preferences as Record<string, unknown>
    : context.userPreferences && typeof context.userPreferences === 'object'
      ? context.userPreferences as Record<string, unknown>
      : provided?.preferences || undefined;
  return { userId, registration, preferences, provided };
}

function preferenceRequirementDefaults(preferences?: Record<string, unknown> | null) {
  if (!preferences) return {};
  const defaults: Record<string, unknown> = {};
  if (['economy', 'optimal', 'premium'].includes(String(preferences.budgetLevel))) defaults.budgetLevel = preferences.budgetLevel;
  if (Array.isArray(preferences.preferredBrands) && preferences.preferredBrands.length) defaults.preferredBrands = preferences.preferredBrands;
  if (Array.isArray(preferences.preferredCategories) && preferences.preferredCategories.length) defaults.preferredCategories = preferences.preferredCategories;
  if (Array.isArray(preferences.projectTypes) && preferences.projectTypes.length) defaults.projectTypes = preferences.projectTypes;
  if (typeof preferences.aiNotes === 'string' && preferences.aiNotes.trim()) defaults.userPreferenceNotes = preferences.aiNotes.trim();
  return defaults;
}

function mergeRoomAreaFormAnswer(previous: Record<string, unknown>, value: Record<string, unknown>) {
  const roomDetails = Array.isArray(previous.roomDetails) ? previous.roomDetails.map((room) => ({ ...(room as Record<string, unknown>) })) : [];
  for (const [key, raw] of Object.entries(value)) {
    const [roomId, field] = key.split('.');
    if (field) {
      const target = roomDetails.find((room) => String(room.id) === roomId);
      if (target) target[field] = raw;
    }
  }
  const next: Record<string, unknown> = { ...previous, roomDetails };
  for (const key of ['ceilingHeight', 'sunnySide', 'windowsCount', 'lastFloor', 'largeWindows', 'preferredCoolingSystem']) {
    if (Object.prototype.hasOwnProperty.call(value, key)) next[key] = value[key];
  }
  return next;
}

function coolingCalculation(requirements: Record<string, unknown>) {
  const rooms = Array.isArray(requirements.roomDetails) ? requirements.roomDetails as Array<Record<string, unknown>> : [];
  const roomLoads = rooms.map((room) => {
    const area = Number(room.areaM2 || 0);
    let loadW = area * 100;
    if (requirements.sunnySide === true) loadW *= 1.15;
    if (requirements.lastFloor === true) loadW *= 1.12;
    if (requirements.largeWindows === true) loadW *= 1.15;
    loadW *= 1.1;
    return { id: room.id, label: room.label, areaM2: area, loadW: Math.round(loadW), loadKw: Math.round((loadW / 1000) * 100) / 100 };
  });
  const totalAreaM2 = Math.round(roomLoads.reduce((sum, room) => sum + room.areaM2, 0) * 100) / 100;
  const totalLoadW = roomLoads.reduce((sum, room) => sum + room.loadW, 0);
  const totalLoadKw = Math.round((totalLoadW / 1000) * 100) / 100;
  const preferred = String(requirements.preferredCoolingSystem || 'auto');
  const recommendedSystem = preferred === 'auto'
    ? roomLoads.length > 2 ? 'multi_split' : 'split'
    : preferred;
  return {
    disclaimer: 'Предварительный инженерный подбор. Для финальной спецификации нужен осмотр объекта и проверка трасс/электропитания.',
    totalAreaM2,
    baseRule: '100 Вт/м² + поправки на солнце, последний этаж, большие окна и 10% запас',
    totalLoadW,
    totalLoadKw,
    roomLoads,
    recommendedSystem,
  };
}

function heatingRoomRecommendation(type: string, areaM2: number, requiredPowerKw: number) {
  if (type === 'bathroom') {
    return {
      equipment: 'Электрический тёплый пол + влагозащищённый терморегулятор',
      systemType: 'floor_heating',
      quantity: '1 комплект',
      explanation: 'Для влажной зоны важны комфорт пола, защита датчика и корректное управление температурой.',
    };
  }
  if (type === 'balcony') {
    return {
      equipment: 'Компактный электрический конвектор / инфракрасная панель',
      systemType: 'electric_convector',
      quantity: '1 шт.',
      explanation: 'Для небольшой зоны рационален компактный прибор с быстрым выходом на режим.',
    };
  }
  if (type === 'corridor' || type === 'entryway') {
    return {
      equipment: 'Настенный электрический конвектор компактного класса',
      systemType: 'electric_convector',
      quantity: '1 шт.',
      explanation: 'В проходной зоне нужен компактный прибор без перегруза пространства.',
    };
  }
  if (type === 'kitchen') {
    return {
      equipment: areaM2 <= 14 ? 'Электрический конвектор + опция тёплого пола в рабочей зоне' : 'Электрический конвектор / тёплый пол по свободной зоне',
      systemType: 'electric_convector',
      quantity: requiredPowerKw > 2 ? '2 шт. меньшей мощности или 1 усиленный прибор' : '1 шт.',
      explanation: 'Для кухни важно учитывать мебель и зоны, где нельзя перекрывать теплоотвод.',
    };
  }
  if (type === 'bedroom' || type === 'childRoom') {
    return {
      equipment: 'Электрический конвектор с точным термостатом',
      systemType: 'electric_convector',
      quantity: requiredPowerKw > 2 ? '2 шт. для равномерного прогрева' : '1 шт.',
      explanation: 'Для спальной/детской зоны лучше стабильное тихое отопление с мягким управлением температуры.',
    };
  }
  return {
    equipment: 'Электрический конвектор / тепловой насос как альтернатива',
    systemType: 'electric_convector',
    quantity: requiredPowerKw > 2.5 ? '2 шт. или один прибор повышенной мощности' : '1 шт.',
    explanation: 'Для жилой комнаты расчет делается по площади и объему, затем мощность распределяется по прибору/приборам.',
  };
}

function apartmentHeatingCalculation(requirements: Record<string, unknown>) {
  const rooms = Array.isArray(requirements.roomDetails) ? requirements.roomDetails as Array<Record<string, unknown>> : [];
  const ceilingHeight = Number(requirements.ceilingHeight || requirements.ceilingHeightM || 2.7);
  const roomRecommendations = rooms.map((room) => {
    const areaM2 = Number(room.areaM2 || 0);
    const roomType = String(room.type || 'generic');
    const power = calculateRequiredPower({
      mode: 'heating',
      area: areaM2,
      roomAreaM2: areaM2,
      ceilingHeight,
      ceilingHeightM: ceilingHeight,
      roomType,
      hasGas: false,
      energySource: 'electric',
      preferredSystemTypes: [roomType === 'bathroom' ? 'floor_heating' : 'electric_convector'],
      insulation: 'normal',
      windows: 'normal',
      budgetLevel: 'optimal',
      includeAccessories: true,
      stockPolicy: 'hide_exact_stock',
    });
    const recommendation = heatingRoomRecommendation(roomType, areaM2, power.requiredPowerKw);
    return {
      id: String(room.id || roomType),
      label: String(room.label || 'Помещение').replace(/ 1$/, ''),
      type: roomType,
      areaM2,
      requiredPowerKw: power.requiredPowerKw,
      requiredPowerW: Math.round(power.requiredPowerKw * 1000),
      recommendedEquipment: recommendation.equipment,
      systemType: recommendation.systemType,
      quantity: recommendation.quantity,
      explanation: recommendation.explanation,
    };
  });
  const totalAreaM2 = Math.round(roomRecommendations.reduce((sum, room) => sum + room.areaM2, 0) * 100) / 100;
  const totalPowerKw = Math.round(roomRecommendations.reduce((sum, room) => sum + room.requiredPowerKw, 0) * 100) / 100;
  const equipmentCount = roomRecommendations.reduce((sum, room) => sum + (String(room.quantity).startsWith('2') ? 2 : 1), 0);
  return {
    title: 'Электрическое отопление квартиры по комнатам',
    baseRule: 'Расчет по каждой комнате отдельно: площадь × высота × базовая тепловая нагрузка с инженерным запасом.',
    totalAreaM2,
    totalPowerKw,
    totalPowerW: Math.round(totalPowerKw * 1000),
    equipmentCount,
    preliminaryCostNote: 'Предварительная стоимость считается по выбранным комплектам ниже; финальная смета зависит от конкретных товаров и монтажа.',
    engineerRecommendation: 'Использовать покомнатное управление температурой: отдельный термостат/регулятор для ванной и независимое управление конвекторами в жилых комнатах.',
    roomRecommendations,
  };
}

function preliminaryEquipmentDraft(direction: string, requirements: Record<string, unknown>, calculation: Record<string, unknown>) {
  if (direction === 'cooling') return [
    { type: 'main_equipment', label: calculation.recommendedSystem === 'multi_split' ? 'Мульти-сплит наружный блок + внутренние блоки' : calculation.recommendedSystem === 'ducted' ? 'Канальная система кондиционирования' : calculation.recommendedSystem === 'heat_pump' ? 'Тепловой насос / Heat pump' : 'Отдельные сплит-системы', quantity: 'по помещениям' },
    { type: 'materials', label: 'Медная трасса, дренаж, теплоизоляция, крепёж', quantity: 'по трассам' },
    { type: 'electrical', label: 'Питание и защита кондиционеров', quantity: 'по проекту' },
  ];
  if (direction === 'electrical') return [
    { type: 'protection', label: 'Автоматы / УЗО / дифавтоматы', quantity: 'по линиям' },
    { type: 'cable', label: 'Кабель и кабельная инфраструктура', quantity: 'по трассам' },
    { type: 'panel', label: 'Щит, DIN-рейки, шины, маркировка', quantity: 'по спецификации' },
    { type: 'wiring_devices', label: 'Розетки, выключатели, аксессуары', quantity: 'по помещениям' },
  ];
  return [];
}
router.post('/chat', async (req, res) => {
  const message = String(req.body?.message || '').trim();
  const answer = (req.body as Record<string, unknown> | undefined)?.answer as Record<string, unknown> | undefined;
  const startIntent = typeof req.body?.startIntent === 'string' ? req.body.startIntent : undefined;
  const formValues = ((req.body?.formValues || (answer?.formValues as Record<string, unknown> | undefined)) || null) as Record<string, unknown> | null;
  if (!message && !answer && !startIntent && !formValues) return res.status(400).json({ error: 'message, answer, formValues or startIntent is required' });
  if (!process.env.OPENAI_API_KEY) console.warn('ai_provider_error', 'OPENAI_API_KEY is not set; AI engineering chat runs in graceful fallback mode');

  try {
    const conversationId = typeof req.body?.conversationId === 'string' ? req.body.conversationId : crypto.randomUUID();
    const currentInputRaw = (req.body?.state?.requirements || req.body?.currentRequirements || {}) as Record<string, unknown>;
    const { userId, registration, preferences, provided } = readUserContextInput(req.body || {});
    let userDocument = ensureUserContextDocument({ userId, registration, preferences, conversationId, guestState: currentInputRaw, provided });
    const currentRaw = { ...preferenceRequirementDefaults(userDocument?.preferences || preferences || null), ...currentInputRaw };

    if (formValues) {
      const requirements = normalizeElectricHeatingFormValues(formValues, currentRaw);
      const selectionRequirements = normalizeSelectionRequirements(requirements);
      const selection = generateEngineeringSelection(selectionRequirements);
      const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent: 'electric_heating_selection', requirements, status: 'calculated' });
      res.json({
        conversationId,
        reply: 'Готово. Рассчитал электрическое отопление и подготовил подбор оборудования.',
        state: { intent: 'electric_heating_selection', stage: 'selection_ready', requirements, missingFields: [], readyForSelection: true },
        selection,
        userContextPatch: memory.patch,
        userContextDocument: memory.document,
        ui: { type: 'result' },
      });
      return;
    }

    if (startIntent || (answer?.field === 'intent' && typeof answer.value === 'string')) {
      const intent = startIntent || String(answer?.value);
      const requirements = buildFlowState(currentRaw, intent);
      const reply = shouldUseElectricHeatingForm(requirements, intent)
        ? 'Заполните параметры помещения — после этого я рассчитаю электрическое отопление и подберу оборудование.'
        : shortStartReply(intent);
      const response = guidedResponse({ conversationId, reply, intent, requirements });
      const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent, requirements });
      res.json({ ...response, userContextPatch: memory.patch, userContextDocument: memory.document });
      return;
    }

    if (answer && typeof answer.field === 'string') {
      const previousIntent = typeof req.body?.intent === 'string' ? req.body.intent : deriveIntentFromMode(currentRaw.mode, 'heating_selection');
      const previous = buildFlowState(currentRaw, previousIntent);
      if (answer.field === 'rooms') {
        const next = buildFlowState({ ...previous, rooms: answer.value }, previousIntent);
        const response = guidedResponse({ conversationId, reply: 'Ок, теперь заполните площади всех помещений одним экраном.', intent: previousIntent, requirements: next });
        const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent: previousIntent, requirements: next });
        res.json({ ...response, userContextPatch: memory.patch, userContextDocument: memory.document });
        return;
      }
      if (answer.field === 'roomAreaForm' && answer.value && typeof answer.value === 'object') {
        const merged = mergeRoomAreaFormAnswer(previous, answer.value as Record<string, unknown>);
        const next = buildFlowState(merged, previousIntent);
        const response = guidedResponse({ conversationId, reply: 'Параметры помещений сохранены. Проверьте сводку перед расчётом.', intent: previousIntent, requirements: next });
        const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent: previousIntent, requirements: next });
        res.json({ ...response, userContextPatch: memory.patch, userContextDocument: memory.document });
        return;
      }
      if (answer.field === 'summaryAction') {
        if (answer.value === 'edit_rooms') {
          const reset = buildFlowState({ ...previous, rooms: {}, roomDetails: [], readyForCalculation: false }, previousIntent);
          const response = guidedResponse({ conversationId, reply: 'Ок, заново выберем помещения.', intent: previousIntent, requirements: reset });
          const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent: previousIntent, requirements: reset });
          res.json({ ...response, userContextPatch: memory.patch, userContextDocument: memory.document });
          return;
        }
        const direction = String(previous.direction || previous.mode || 'unknown');
        const calculation = direction === 'cooling'
          ? coolingCalculation(previous)
          : direction === 'heating' && previous.objectType === 'apartment'
            ? apartmentHeatingCalculation(previous)
            : {};
        const equipmentDraft = preliminaryEquipmentDraft(direction, previous, calculation);
        const requirements = buildFlowState({ ...previous, readyForCalculation: true, calculation, equipmentDraft }, previousIntent);
        const selectionRequirements = normalizeSelectionRequirements({
          ...requirements,
          area: (calculation as Record<string, unknown>).totalAreaM2 || requirements.area,
          ceilingHeight: requirements.ceilingHeight || 2.7,
          energySource: direction === 'heating' ? 'electric' : requirements.energySource,
          hasGas: direction === 'heating' ? false : requirements.hasGas,
          preferredSystemTypes: direction === 'cooling'
            ? [String((calculation as Record<string, unknown>).recommendedSystem || 'split')]
            : direction === 'heating'
              ? ['electric_convector', 'floor_heating']
              : requirements.preferredSystemTypes,
        });
        const baseSelection = direction === 'cooling' || direction === 'heating' ? generateEngineeringSelection(selectionRequirements) : null;
        const selection = baseSelection && direction === 'heating' && previous.objectType === 'apartment'
          ? { ...baseSelection, roomHeating: calculation }
          : baseSelection;
        const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent: previousIntent, requirements, calculation, equipmentDraft, status: 'calculated' });
        if (userId) recordUserActivity({ eventType: 'engineering_selection_completed', userId, selectionId: String(requirements.selectionId || `sel_${conversationId}`), direction, payload: { calculation } });
        res.json({
          conversationId,
          reply: direction === 'cooling' ? 'Готово. Рассчитал предварительную холодопроизводительность и подготовил список оборудования.' : 'Готово. Подготовил предварительную спецификацию.',
          requirements,
          userContextPatch: memory.patch,
          userContextDocument: memory.document,
          state: { intent: previousIntent, stage: 'selection_ready', requirements, missingFields: [], readyForSelection: true },
          selection,
          calculation,
          equipmentDraft,
          ui: { type: selection ? 'result' : 'confirmation', progressPercent: 95 },
        });
        return;
      }
      if (answer.field === 'confirmation') {
        if (answer.value === 'edit') {
          const reset = { ...previous, floorCovering: null, floorFinish: null, heatingPurpose: null, floorHeatingPurpose: null, budgetLevel: 'unknown', includeAccessories: undefined };
          res.json(guidedResponse({ conversationId, reply: 'Ок, поправим параметры.', intent: previousIntent, requirements: reset }));
          return;
        }
        if (answer.value === 'edit_install_area') {
          const reset = { ...previous, installAreaMode: undefined, availableInstallAreaM2: null, installationArea: null, blockedAreaM2: null };
          res.json(guidedResponse({ conversationId, reply: 'Ок, уточним площадь укладки.', intent: previousIntent, requirements: reset }));
          return;
        }
        if (answer.value === 'edit_build_type') {
          const reset = { ...previous, floorBuildType: null };
          res.json(guidedResponse({ conversationId, reply: 'Ок, уточним конструкцию пола.', intent: previousIntent, requirements: reset }));
          return;
        }
        if (answer.value === 'edit_finish') {
          const reset = { ...previous, floorFinish: null, floorCovering: null };
          res.json(guidedResponse({ conversationId, reply: 'Ок, уточним покрытие пола.', intent: previousIntent, requirements: reset }));
          return;
        }
        if (answer.value === 'edit_budget') {
          const reset = { ...previous, budgetLevel: 'unknown' };
          res.json(guidedResponse({ conversationId, reply: 'Ок, уточним бюджет.', intent: previousIntent, requirements: reset }));
          return;
        }
        const selectionRequirements = normalizeSelectionRequirements(previous);
        const selection = generateEngineeringSelection(selectionRequirements);
        const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent: previousIntent, requirements: previous, status: 'calculated' });
        res.json({
          conversationId,
          reply: 'Готово. Собрал предварительный подбор.',
          state: { intent: previousIntent, stage: 'selection_ready', requirements: previous, missingFields: [], readyForSelection: true },
          selection,
          userContextPatch: memory.patch,
          userContextDocument: memory.document,
          ui: { type: 'result' },
        });
        return;
      }

      const next = { ...previous, [answer.field]: answer.value };
      if (answer.field === 'preferredSystemTypes' && !Array.isArray(answer.value)) next.preferredSystemTypes = [String(answer.value)];
      if (answer.field === 'conditions' && Array.isArray(answer.value) && answer.value.length === 0) next.conditions = ['none'];
      const built = buildFlowState(next, previousIntent);
      const reply = shouldUseElectricHeatingForm(built, previousIntent)
        ? 'Заполните параметры помещения — после этого я рассчитаю электрическое отопление и подберу оборудование.'
        : 'Ок, продолжим подбор.';
      const response = guidedResponse({ conversationId, reply, intent: previousIntent, requirements: built });
      const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent: previousIntent, requirements: built });
      res.json({ ...response, userContextPatch: memory.patch, userContextDocument: memory.document });
      return;
    }

    const rawStepInput = {
      conversationId,
      message,
      currentRequirements: currentRaw,
    };
    const result = await runEngineeringChatStep(rawStepInput);
    const state = result.state ? { ...result.state, requirements: buildFlowState(result.state.requirements as Record<string, unknown>, result.state.intent as string) } : null;
    const current = (state?.requirements || (result.state?.requirements || {})) as Record<string, unknown>;

    let derivedIntent = state?.intent || result.state?.intent || 'unknown';
    if (derivedIntent === 'unknown') derivedIntent = deriveIntentFromMode(current.mode, 'unknown');

    if (state && derivedIntent !== 'unknown') {
      const built = buildFlowState(current, derivedIntent);
      const flow = makeQuestionUi(built, derivedIntent);
      const shortReply = flow.ui.type === 'requirements_form'
        ? 'Заполните параметры помещения — после этого я рассчитаю электрическое отопление и подберу оборудование.'
        : flow.readyForSelection
          ? 'Параметры собраны.'
          : 'Понял. Продолжим по шагам ниже.';
      const memory = updateAssistantSelectionMemory({ document: userDocument, conversationId, intent: derivedIntent, requirements: built, status: flow.readyForSelection ? 'ready_for_calculation' : 'draft' });
      res.json({ ...result, reply: shortReply, state: { ...state, intent: derivedIntent, requirements: built, missingFields: flow.missingFields, readyForSelection: flow.readyForSelection }, userContextPatch: memory.patch, userContextDocument: memory.document, ui: flow.ui });
      return;
    }

    res.json({ ...result, ui: null });
  } catch (error) {
    console.error('ai_provider_error', error instanceof Error ? error.message : 'chat failed');
    res.status(500).json({
      conversationId: req.body?.conversationId || null,
      reply: 'ИИ-помощник временно недоступен. Вы можете использовать обычные калькуляторы или отправить заявку менеджеру.',
      state: { intent: 'unknown', stage: 'collecting_requirements', requirements: {}, missingFields: [], readyForSelection: false },
      selection: null,
    });
  }
});


router.post('/profile', (req, res) => {
  try {
    const body = req.body || {};
    const userId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : null;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    const registration = body.registration && typeof body.registration === 'object' ? body.registration as Record<string, unknown> : undefined;
    const preferences = body.preferences && typeof body.preferences === 'object' ? body.preferences as Record<string, unknown> : undefined;
    const userContextDocument = mergeClientProfileState({
      userId,
      registration,
      preferences,
      favorites: Array.isArray(body.favorites) ? body.favorites : undefined,
      pinnedItems: Array.isArray(body.pinnedItems) ? body.pinnedItems : undefined,
      viewedProducts: Array.isArray(body.viewedProducts) ? body.viewedProducts : undefined,
      viewedCategories: Array.isArray(body.viewedCategories) ? body.viewedCategories : undefined,
      selectedDirections: Array.isArray(body.selectedDirections) ? body.selectedDirections : undefined,
      provided: body.userContextDocument && typeof body.userContextDocument === 'object' ? body.userContextDocument as UserContextDocument : null,
    });
    res.json({ ok: true, userContextDocument, clientRequirementDocument: userContextDocument?.clientRequirementDocument || null });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'profile sync failed' });
  }
});

router.get('/profile/:userId', (req, res) => {
  try {
    const userContextDocument = ensureUserContextDocument({ userId: req.params.userId });
    res.json({ ok: true, userContextDocument, clientRequirementDocument: userContextDocument?.clientRequirementDocument || null });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'profile read failed' });
  }
});

router.post('/activity', (req, res) => {
  try {
    const body = req.body || {};
    const eventType = String(body.eventType || '').trim();
    if (!eventType) return res.status(400).json({ error: 'eventType is required' });
    const userId = typeof body.userId === 'string' ? body.userId : null;
    const userDocument = ensureUserContextDocument({ userId, conversationId: typeof body.conversationId === 'string' ? body.conversationId : null, provided: body.userContextDocument || null });
    const updated = recordUserActivity({
      eventType,
      userId,
      guestId: typeof body.guestId === 'string' ? body.guestId : null,
      productId: body.productId ?? null,
      categoryId: body.categoryId ?? null,
      brandId: body.brandId ?? null,
      selectionId: typeof body.selectionId === 'string' ? body.selectionId : null,
      direction: typeof body.direction === 'string' ? body.direction : null,
      searchQuery: typeof body.searchQuery === 'string' ? body.searchQuery : null,
      payload: body.payload && typeof body.payload === 'object' ? body.payload : {},
    }) || userDocument;
    res.json({ ok: true, userContextDocument: updated });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : 'activity failed' });
  }
});

router.post('/select', (req, res) => {
  try {
    const requirements = safeRequirements(req.body || {});
    const selection = generateEngineeringSelection(requirements);
    console.info('ai_selection_generated', { mode: requirements.mode, area: requirements.area });
    res.json(selection);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'invalid requirements' });
  }
});

router.post('/email', async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (!email) return res.status(400).json({ error: 'email is required' });
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const fromName = process.env.SMTP_FROM_NAME || 'OhmX.am';
  const fromEmail = process.env.SMTP_FROM || 'noreply@ohmx.am';
  if (!smtpHost || !smtpUser || !smtpPass) return res.status(501).json({ error: 'SMTP не настроен' });
  try {
    const transporter = nodemailer.createTransport({ host: smtpHost, port: smtpPort, secure: smtpPort === 465, auth: { user: smtpUser, pass: smtpPass } });
    const text = String(req.body?.textBody || 'Предварительный инженерный подбор OhmX.am во вложенном контексте заявки.');
    await transporter.sendMail({ from: `"${fromName}" <${fromEmail}>`, to: email, subject: 'ИИ-инженерный подбор оборудования OhmX.am', text });
    res.json({ ok: true, message: 'Подбор отправлен на email' });
  } catch (error) {
    console.error('ai_provider_error', error instanceof Error ? error.message : 'email failed');
    res.status(500).json({ error: 'Ошибка отправки email' });
  }
});

router.post('/manager-request', (req, res) => {
  console.info('ai_selection_sent_to_manager', { conversationId: req.body?.conversationId || null });
  res.json({ ok: true, requestId: `ai-${Date.now()}`, message: 'Заявка менеджеру создана' });
});

export default router;
