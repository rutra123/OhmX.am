import * as crypto from 'node:crypto';
import { aiEngineeringSystemPrompt } from '../prompts/aiEngineeringSystemPrompt.js';
import { generateEngineeringSelection, type BudgetLevel, type EngineeringMode, type EngineeringRequirements } from './engineeringSelectionService.js';

export type EngineeringIntent = 'heating_selection' | 'cooling_selection' | 'floor_heating_selection' | 'boiler_selection' | 'radiator_selection' | 'hvac_selection' | 'electrical_selection' | 'pump_selection' | 'unknown';
export type EngineeringStage = 'collecting_requirements' | 'ready_for_selection' | 'selection_ready';

export type EngineeringState = {
  intent: EngineeringIntent;
  stage: EngineeringStage;
  requirements: EngineeringRequirements;
  missingFields: string[];
  readyForSelection: boolean;
};

const defaultRequirements: EngineeringRequirements = {
  mode: 'unknown',
  area: null,
  ceilingHeight: null,
  roomType: 'unknown',
  hasGas: null,
  energySource: 'unknown',
  preferredSystemTypes: [],
  insulation: 'unknown',
  windows: 'unknown',
  budgetLevel: 'unknown',
  includeAccessories: true,
};

function cleanText(value: unknown) {
  return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function parseArea(message: string) {
  const text = message.replace(',', '.');
  const direct = text.match(/(\d+(?:\.\d+)?)\s*(?:м2|м²|кв\.?\s*м|m2|sqm)/i);
  if (direct) return Number(direct[1]);
  const afterWords = text.match(/(?:площадь|комната|офис|дом|ванная|кухня)[^\d]{0,16}(\d+(?:\.\d+)?)/i);
  if (afterWords) return Number(afterWords[1]);
  return null;
}

function parseHeight(message: string) {
  const text = message.replace(',', '.');
  const match = text.match(/(?:потол(?:ок|ка|ки)?|высот(?:а|ой)?)[^\d]{0,16}(\d+(?:\.\d+)?)/i) || text.match(/(\d+(?:\.\d+)?)\s*м\s*(?:потол|высот)/i);
  const value = match ? Number(match[1]) : null;
  return value && value > 1.8 && value < 8 ? value : null;
}

function inferMode(message: string): EngineeringMode {
  const text = cleanText(message);
  if (['теплый пол', 'тёплый пол', 'нагревательный мат', 'нагревательный кабель', 'ванн'].some((n) => text.includes(n))) return 'floor_heating';
  if (['охлажд', 'кондиционер', 'сплит', 'холод', 'hvac'].some((n) => text.includes(n))) return 'cooling';
  if (['отопл', 'обогрев', 'котел', 'котёл', 'конвектор', 'радиатор', 'газа нет', 'нет газа', 'без газа', 'только электр', 'газ есть', 'есть газ'].some((n) => text.includes(n))) return 'heating';
  return 'unknown';
}

function inferIntent(message: string, mode: EngineeringMode): EngineeringIntent {
  const text = cleanText(message);
  if (text.includes('насос')) return 'pump_selection';
  if (text.includes('радиатор')) return 'radiator_selection';
  if (text.includes('котел') || text.includes('котёл')) return 'boiler_selection';
  if (mode === 'floor_heating') return 'floor_heating_selection';
  if (mode === 'cooling') return text.includes('hvac') ? 'hvac_selection' : 'cooling_selection';
  if (mode === 'heating') return 'heating_selection';
  return 'unknown';
}

function mergeRequirements(current: Partial<EngineeringRequirements> | undefined, message: string): EngineeringRequirements {
  const text = cleanText(message);
  const mode = inferMode(message);
  const area = parseArea(message);
  const ceilingHeight = parseHeight(message);
  const hasGas = text.includes('газа нет') || text.includes('без газа') || text.includes('нет газа') ? false : text.includes('газ есть') || text.includes('есть газ') ? true : undefined;
  const budgetLevel: BudgetLevel | undefined = text.includes('эконом') || text.includes('дешев') ? 'economy' : text.includes('преми') ? 'premium' : text.includes('оптим') || text.includes('баланс') ? 'optimal' : undefined;
  const preferredSystemTypes: string[] = [];
  if (text.includes('тепловой насос') || text.includes('heat pump')) preferredSystemTypes.push('heat_pump');
  if (text.includes('конвектор')) preferredSystemTypes.push('electric_convector');
  if (text.includes('газ') && (text.includes('котел') || text.includes('котёл'))) preferredSystemTypes.push('gas_boiler');
  if (text.includes('электр') && (text.includes('котел') || text.includes('котёл'))) preferredSystemTypes.push('electric_boiler');
  if (text.includes('кондиционер') || text.includes('сплит')) preferredSystemTypes.push('air_conditioner');

  const next = { ...defaultRequirements, ...(current || {}) };
  if (mode !== 'unknown') next.mode = mode;
  if (area !== null) next.area = area;
  if (ceilingHeight !== null) next.ceilingHeight = ceilingHeight;
  if (hasGas !== undefined) next.hasGas = hasGas;
  if (hasGas === true) next.energySource = 'gas';
  if (hasGas === false || text.includes('только электр')) next.energySource = 'electric';
  if (budgetLevel) next.budgetLevel = budgetLevel;
  if (preferredSystemTypes.length) next.preferredSystemTypes = Array.from(new Set([...(next.preferredSystemTypes || []), ...preferredSystemTypes]));
  if (text.includes('плохо утепл')) next.insulation = 'poor';
  if (text.includes('хорошо утепл')) next.insulation = 'good';
  if (text.includes('больш') && text.includes('окн')) next.windows = 'large';
  if (text.includes('солнеч')) next.windows = 'sunny';
  if (text.includes('квартира')) next.roomType = 'apartment';
  if (text.includes('дом')) next.roomType = 'house';
  if (text.includes('офис')) next.roomType = 'office';
  if (text.includes('ванн')) next.roomType = 'bathroom';
  if (text.includes('кухн')) next.roomType = 'kitchen';
  next.includeAccessories = current?.includeAccessories ?? true;
  return next;
}

function missingFields(requirements: EngineeringRequirements) {
  const missing: string[] = [];
  if (requirements.mode === 'unknown') missing.push('mode');
  if (!requirements.area) missing.push('area');
  if (requirements.mode === 'heating' && requirements.hasGas === null) missing.push('hasGas');
  if ((requirements.budgetLevel || 'unknown') === 'unknown') missing.push('budgetLevel');
  return missing;
}

function followupReply(requirements: EngineeringRequirements, missing: string[], aiUnavailable: boolean) {
  if (aiUnavailable) {
    return 'ИИ-подбор временно недоступен. Я могу сохранить предварительно распознанные параметры, но для финального диалога используйте обычные калькуляторы или отправьте заявку менеджеру.';
  }
  if (!missing.length) return 'Понял. Минимальные данные собраны — можно выполнить предварительный инженерный подбор из базы OhmX.am.';
  const questions: string[] = [];
  if (missing.includes('mode')) questions.push('Нужно отопление, охлаждение или тёплый пол?');
  if (missing.includes('area')) questions.push('Какая площадь помещения в м²?');
  if (missing.includes('hasGas')) questions.push('Газ есть или только электричество?');
  if (missing.includes('budgetLevel')) questions.push('Нужен экономичный, оптимальный или премиум вариант?');
  if (!requirements.ceilingHeight) questions.unshift('Высота потолка примерно 2.7 м или другая?');
  return `Понял задачу частично. Уточните, пожалуйста:\n${questions.slice(0, 3).map((q, index) => `${index + 1}. ${q}`).join('\n')}`;
}

async function tryLlmExtraction(message: string, currentRequirements: EngineeringRequirements) {
  if (!process.env.OPENAI_API_KEY) return null;
  const provider = process.env.AI_PROVIDER || 'openai';
  if (provider !== 'openai') return null;
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.AI_FAST_MODEL || process.env.AI_ENGINEERING_MODEL || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0.2,
        max_tokens: 180,
        messages: [
          { role: 'system', content: `${aiEngineeringSystemPrompt}\nПравила вывода JSON:\n- Если пользователь только выбрал режим/шаг, оставь reply коротким: максимум одно предложение; требуемые параметры уже запрашиваются через отдельные карточки.\n- Не перечисляй список вопросов в reply.\n- Строгий формат JSON: {"requirements":{},"reply":""}` },
          { role: 'user', content: JSON.stringify({ message, currentRequirements }) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenAI status ${response.status}`);
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    return JSON.parse(content) as { requirements?: Partial<EngineeringRequirements>; reply?: string };
  } catch (error) {
    console.error('ai_provider_error', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

export async function runEngineeringChatStep(input: { conversationId?: string; message: string; currentRequirements?: Partial<EngineeringRequirements> }) {
  const conversationId = input.conversationId || crypto.randomUUID();
  console.info('ai_engineering_chat_started', { conversationId });
  const deterministic = mergeRequirements(input.currentRequirements, input.message);
  const llm = await tryLlmExtraction(input.message, deterministic);
  const requirements = llm?.requirements ? { ...deterministic, ...llm.requirements } : deterministic;
  const missing = missingFields(requirements);
  const readyForSelection = missing.filter((field) => field !== 'budgetLevel').length === 0;
  const intent = inferIntent(input.message, requirements.mode);
  console.info('ai_requirements_extracted', { conversationId, intent, readyForSelection });
  if (missing.length) console.info('ai_missing_fields', { conversationId, missingFields: missing });
  const state: EngineeringState = {
    intent,
    stage: readyForSelection ? 'ready_for_selection' : 'collecting_requirements',
    requirements,
    missingFields: missing,
    readyForSelection,
  };
  let selection = null;
  if (readyForSelection && process.env.OPENAI_API_KEY) {
    try {
      selection = generateEngineeringSelection({ ...requirements, ceilingHeight: requirements.ceilingHeight || 2.7, budgetLevel: requirements.budgetLevel === 'unknown' ? 'optimal' : requirements.budgetLevel });
      state.stage = 'selection_ready';
      console.info('ai_selection_generated', { conversationId });
    } catch (error) {
      console.error('ai_provider_error', error instanceof Error ? error.message : 'selection failed');
    }
  }
  return {
    conversationId,
    reply: llm?.reply || followupReply(requirements, missing, !process.env.OPENAI_API_KEY),
    state,
    selection,
  };
}

export { missingFields as getMissingEngineeringFields, mergeRequirements as extractEngineeringRequirements };
