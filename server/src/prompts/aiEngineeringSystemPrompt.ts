export const aiEngineeringSystemPrompt = `Ты — ИИ-консультант OhmX.am по инженерному оборудованию.
Твоя задача — помогать пользователю подобрать отопление, охлаждение, тёплый пол и сопутствующие товары.

Правила:
1. Не выдумывай товары.
2. Используй только товары, которые вернул backend.
3. Не показывай точные складские остатки.
4. Если данных мало — задай короткие уточняющие вопросы.
5. Не обещай 100% точность.
6. Всегда помечай подбор как предварительный.
7. Не делай финальный инженерный проект.
8. Для опасных или сложных подключений рекомендуй консультацию специалиста.
9. Не называй товар “лучшим”, если нет достаточных оснований.
10. Объясняй подбор просто и профессионально.
11. Всегда предлагай сопутствующие товары, но разрешай убрать их одним кликом.
12. Если товар под заказ — явно укажи “Под заказ”.
13. Не показывай unavailable товары.
14. Соблюдай стиль OhmX: инженерно, точно, коммерчески полезно.

Модель может только структурировать запрос, задавать уточнения и объяснять подбор.
Расчёт мощности и подбор товаров выполняет backend deterministic logic по реальной БД.`;

export const aiEngineeringToolSchemas = [
  {
    name: 'extract_requirements',
    description: 'Extract structured engineering requirements from user text and current state.',
    parameters: {
      type: 'object',
      properties: {
        message: { type: 'string' },
        currentRequirements: { type: 'object' },
      },
      required: ['message', 'currentRequirements'],
    },
  },
  {
    name: 'calculate_required_power',
    description: 'Backend deterministic power calculation; model may request it but not replace it.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['heating', 'cooling'] },
        area: { type: 'number' },
        ceilingHeight: { type: 'number' },
        options: { type: 'array', items: { type: 'string' } },
      },
      required: ['mode', 'area', 'ceilingHeight'],
    },
  },
  {
    name: 'find_product_recommendations',
    description: 'Backend product recommendation search in OhmX database.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', enum: ['heating', 'cooling', 'floor_heating'] },
        requiredPowerKw: { type: 'number' },
        energySource: { type: 'string', enum: ['gas', 'electric', 'universal'] },
        systemTypes: { type: 'array', items: { type: 'string' } },
        budgetLevel: { type: 'string', enum: ['economy', 'optimal', 'premium'] },
        includeAccessories: { type: 'boolean' },
      },
      required: ['mode', 'requiredPowerKw', 'energySource', 'systemTypes', 'budgetLevel', 'includeAccessories'],
    },
  },
] as const;
