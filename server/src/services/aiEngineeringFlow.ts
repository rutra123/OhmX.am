export type UIOption = { label: string; value: unknown; icon?: string };

export type NumberInputQuestion = {
  type: 'number_input';
  field: string;
  questionId?: string;
  title?: string;
  label: string;
  description?: string;
  unit?: string;
  placeholder?: string;
  min?: number;
  max?: number;
  defaultValue?: number | null;
  required?: boolean;
};

export type SingleChoiceQuestion = {
  type: 'single_choice';
  field: string;
  questionId?: string;
  title?: string;
  label: string;
  description?: string;
  options: UIOption[];
  required?: boolean;
};

export type MultiChoiceQuestion = {
  type: 'multi_choice';
  field: string;
  questionId?: string;
  title?: string;
  label: string;
  description?: string;
  options: UIOption[];
  allowSkip?: boolean;
};

export type DirectionChoiceQuestion = {
  type: 'direction_choice';
  field: 'direction';
  questionId: 'direction_choice';
  title: string;
  label: string;
  options: Array<UIOption & { direction: 'heating' | 'cooling' | 'electrical' }>;
  required?: boolean;
};

export type MultiCounterQuestion = {
  type: 'multi_counter';
  field: 'rooms';
  questionId: string;
  title: string;
  label: string;
  description?: string;
  counters: Array<{ key: string; label: string }>;
  actions: Array<'continue' | 'reset'>;
  required?: boolean;
};

export type RoomAreaFormQuestion = {
  type: 'room_area_form';
  field: 'roomAreaForm';
  questionId: string;
  title: string;
  label: string;
  description?: string;
  fields: Array<{ key: string; label: string; inputType: 'number' | 'select' | 'boolean'; required?: boolean; options?: UIOption[]; min?: number; max?: number; step?: number }>;
  submitLabel?: string;
};

export type SummaryReviewQuestion = {
  type: 'summary_review';
  field: 'summaryAction';
  questionId: string;
  title: string;
  label: string;
  summary: Array<{ label: string; value: string }>;
  options: UIOption[];
};

export type ConfirmationQuestion = {
  type: 'confirmation';
  field: 'confirmation';
  questionId?: string;
  label: string;
  title?: string;
  description?: string;
  summary: Array<{ label: string; value: string }>;
  options: UIOption[];
};

export type StepQuestion = NumberInputQuestion | SingleChoiceQuestion | MultiChoiceQuestion | ConfirmationQuestion | DirectionChoiceQuestion | MultiCounterQuestion | RoomAreaFormQuestion | SummaryReviewQuestion;

export type UIQuestion = {
  type: 'question_flow';
  totalSteps: number;
  currentStep: number;
  progressPercent: number;
  question: StepQuestion;
};

export type UIResult = { type: 'result' };
export type UIConfirmation = { type: 'confirmation'; progressPercent: number };

export type RequirementsFormField = {
  name: string;
  label: string;
  type: 'number' | 'select' | 'checkbox';
  required?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number | boolean | string;
  options?: UIOption[];
};

export type RequirementsFormUI = {
  type: 'requirements_form';
  form: {
    id: string;
    title: string;
    intent: string;
    mode: 'heating' | 'cooling' | 'floor_heating';
    fields: RequirementsFormField[];
    submitLabel: string;
  };
};

export type UIState = UIQuestion | UIResult | UIConfirmation | RequirementsFormUI;

type FlowMeta = { fields: string[]; totalSteps: number };

const intentFlowMeta: Record<string, FlowMeta> = {
  floor_heating_selection: {
    fields: [
      'floorHeatingPurpose',
      'roomType',
      'area',
      'ceilingHeight',
      'insulation',
      'windows',
      'floorFinish',
      'floorBuildType',
      'blockedZones',
      'installAreaMode',
      'blockedAreaM2',
      'availableInstallAreaM2',
      'preferredHeatingElement',
      'budgetLevel',
      'confirmation',
    ],
    totalSteps: 14,
  },
  heating_selection: { fields: ['objectType', 'rooms', 'roomAreaForm', 'summaryAction'], totalSteps: 4 },
  boiler_selection: { fields: ['area', 'ceilingHeight', 'energySource', 'preferredSystemTypes', 'budgetLevel'], totalSteps: 5 },
  radiator_selection: { fields: ['area', 'ceilingHeight', 'energySource', 'preferredSystemTypes', 'budgetLevel'], totalSteps: 5 },
  pump_selection: { fields: ['area', 'ceilingHeight', 'energySource', 'preferredSystemTypes', 'budgetLevel'], totalSteps: 5 },
  cooling_selection: { fields: ['objectType', 'rooms', 'roomAreaForm', 'summaryAction'], totalSteps: 4 },
  hvac_selection: { fields: ['objectType', 'rooms', 'roomAreaForm', 'summaryAction'], totalSteps: 4 },
  electrical_selection: { fields: ['electricalNeed', 'objectType', 'area', 'phaseType', 'summaryAction'], totalSteps: 5 },
};

function hasPositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function displayValue(field: string, value: unknown): string {
  const maps: Record<string, Record<string, string>> = {
    roomType: {
      apartment: 'Квартира', house: 'Дом', bathroom: 'Ванная', kitchen: 'Кухня', bedroom: 'Спальня',
      living_room: 'Гостиная', 'living room': 'Гостиная', hallway: 'Коридор', corridor: 'Коридор', office: 'Офис', commercial: 'Коммерческое', other: 'Другое', unknown: 'Не знаю',
    },
    insulation: { good: 'Хорошее', normal: 'Нормальное', poor: 'Слабое', unknown: 'Не знаю' },
    windows: { normal: 'Обычные', large: 'Большие', sunny: 'Солнечная сторона', unknown: 'Не знаю' },
    floorFinish: { tile: 'Керамическая плитка', porcelain_tile: 'Керамогранит', laminate: 'Ламинат', wood: 'Паркет / инженерная доска', vinyl_spc: 'Винил / SPC', other: 'Другое', unknown: 'Не знаю' },
    floorCovering: { tile: 'Плитка', porcelain: 'Керамогранит', porcelain_tile: 'Керамогранит', laminate: 'Ламинат', other: 'Другое' },
    floorBuildType: { new_screed: 'Новая стяжка', tile_adhesive: 'В плиточный клей', minimal_height: 'Минимальная высота', existing_floor: 'Существующий пол', unknown: 'Не знаю' },
    floorHeatingPurpose: { comfort: 'Комфортный подогрев', primary_heating: 'Основное отопление', additional_heating: 'Дополнительное отопление', unknown: 'Нужна рекомендация' },
    heatingPurpose: { primary: 'Основное отопление', comfort: 'Комфортный подогрев' },
    preferredHeatingElement: { heating_cable: 'Нагревательный кабель', heating_mat: 'Нагревательный мат', thin_mat: 'Тонкий мат', auto: 'Автоматически' },
    budgetLevel: { economy: 'Эконом', optimal: 'Оптимальный', premium: 'Премиум', any: 'Не важно', unknown: 'Не знаю' },
    energySource: { gas: 'Газ', electric: 'Электричество', unknown: 'Не знаю' },
    objectType: { apartment: 'Квартира', private_house: 'Собственный дом', house: 'Собственный дом' },
    blockedZones: { kitchen: 'Кухонный гарнитур', fixed_wardrobe: 'Шкафы без ножек', bath: 'Ванна', shower: 'Душевая', toilet: 'Унитаз / инсталляция', washing_machine: 'Стиральная машина', fixed_furniture: 'Стационарная мебель', heavy_equipment: 'Камин / тяжёлое оборудование', none: 'Таких зон нет', unknown: 'Не знаю' },
  };
  if (['area', 'roomAreaM2', 'installationArea', 'availableInstallAreaM2', 'blockedAreaM2'].includes(field)) return hasPositiveNumber(value) ? `${value} м²` : '—';
  if (['ceilingHeight', 'ceilingHeightM'].includes(field)) return hasPositiveNumber(value) ? `${value} м` : '—';
  if (field === 'includeAccessories') return value === false ? 'Нет, без аксессуаров' : 'Да, добавить';
  if (field === 'requiredHeatingPowerW') return hasPositiveNumber(value) ? `${Math.round(Number(value))} Вт` : '—';
  if (Array.isArray(value)) return value.length ? value.map((v) => displayValue(field, v)).join(', ') : 'Нет';
  return maps[field]?.[String(value)] || String(value || '—');
}

function floorHeatingQuestion(requirements: Record<string, unknown>): StepQuestion | null {
  if (!requirements.floorHeatingPurpose) {
    return {
      type: 'single_choice', field: 'floorHeatingPurpose', label: 'Для чего нужен тёплый пол?',
      description: 'От назначения зависит целевая мощность и проверка достаточности.', required: true,
      options: [
        { label: 'Комфортный подогрев пола', value: 'comfort' },
        { label: 'Основное отопление помещения', value: 'primary_heating' },
        { label: 'Дополнительное отопление к радиаторам / кондиционеру', value: 'additional_heating' },
        { label: 'Не знаю, нужна рекомендация', value: 'unknown' },
      ],
    };
  }
  if (!requirements.roomType || requirements.roomType === 'unknown') {
    return {
      type: 'single_choice', field: 'roomType', label: 'Где нужен тёплый пол?',
      description: 'Тип помещения влияет на мощность, влажную зону и аксессуары.', required: true,
      options: [
        { label: 'Ванная', value: 'bathroom' }, { label: 'Кухня', value: 'kitchen' }, { label: 'Спальня', value: 'bedroom' },
        { label: 'Гостиная', value: 'living_room' }, { label: 'Коридор', value: 'corridor' }, { label: 'Офис', value: 'office' }, { label: 'Другое', value: 'other' },
      ],
    };
  }
  if (!hasPositiveNumber(requirements.area)) {
    return { type: 'number_input', field: 'area', label: 'Сколько квадратных метров помещения?', description: 'Это общая площадь комнаты для расчёта требуемой мощности.', unit: 'м²', placeholder: '30', min: 1, max: 1000, required: true };
  }
  if (!hasPositiveNumber(requirements.ceilingHeight)) {
    return {
      type: 'single_choice', field: 'ceilingHeight', label: 'Высота потолка', description: 'Нужна для расчёта требуемой мощности помещения.', required: true,
      options: [{ label: '2.5 м', value: 2.5 }, { label: '2.7 м', value: 2.7 }, { label: '3.0 м', value: 3.0 }, { label: 'Другое / 2.7 м', value: 2.7 }],
    };
  }
  if (!requirements.insulation || requirements.insulation === 'unknown') {
    return {
      type: 'single_choice', field: 'insulation', label: 'Какое утепление помещения?', description: 'Слабое утепление увеличивает требуемую мощность.', required: true,
      options: [{ label: 'Хорошее', value: 'good' }, { label: 'Нормальное', value: 'normal' }, { label: 'Слабое', value: 'poor' }, { label: 'Не знаю', value: 'unknown' }],
    };
  }
  if (!requirements.windows || requirements.windows === 'unknown') {
    return {
      type: 'single_choice', field: 'windows', label: 'Какие окна и солнечность?', description: 'Большие окна и солнечная сторона влияют на расчёт.', required: true,
      options: [{ label: 'Обычные окна', value: 'normal' }, { label: 'Большие окна', value: 'large' }, { label: 'Солнечная сторона', value: 'sunny' }, { label: 'Не знаю', value: 'unknown' }],
    };
  }
  if (!requirements.floorFinish) {
    return {
      type: 'single_choice', field: 'floorFinish', label: 'Какое будет финишное покрытие пола?',
      description: 'Для плитки доступны маты/тонкие кабели; для чувствительных покрытий нужна проверка ограничения температуры.', required: true,
      options: [
        { label: 'Керамическая плитка', value: 'tile' }, { label: 'Керамогранит', value: 'porcelain_tile' }, { label: 'Ламинат', value: 'laminate' },
        { label: 'Паркет / инженерная доска', value: 'wood' }, { label: 'Винил / SPC', value: 'vinyl_spc' }, { label: 'Другое', value: 'other' }, { label: 'Пока не знаю', value: 'unknown' },
      ],
    };
  }
  if (!requirements.floorBuildType || requirements.floorBuildType === 'unknown') {
    return {
      type: 'single_choice', field: 'floorBuildType', label: 'Есть ли возможность сделать стяжку над нагревательным элементом?',
      description: requirements.floorBuildType === 'unknown'
        ? 'Если есть стяжка — обычно кабель гибче и выгоднее. Если плитка и высоту поднимать нельзя — лучше мат в клей. Для не плитки нужна проверка совместимости.'
        : 'От этого зависит выбор между кабелем в стяжку и матом/тонким кабелем под плитку.',
      required: true,
      options: [
        { label: 'Да, будет новая стяжка', value: 'new_screed' },
        { label: 'Нет, нужно под плитку в клей', value: 'tile_adhesive' },
        { label: 'Пол почти готов, нужна минимальная высота', value: 'minimal_height' },
        { label: 'Не знаю', value: 'unknown' },
      ],
    };
  }
  if (!Array.isArray(requirements.blockedZones) || requirements.blockedZones.length === 0) {
    return {
      type: 'multi_choice', field: 'blockedZones', label: 'Где нельзя укладывать нагревательный элемент?',
      description: 'Нельзя укладывать под зоны без теплоотвода: мебель без ножек, кухню, ванну, технику.', allowSkip: false,
      options: [
        { label: 'Кухонный гарнитур', value: 'kitchen' }, { label: 'Шкафы без ножек', value: 'fixed_wardrobe' }, { label: 'Ванна', value: 'bath' },
        { label: 'Душевая', value: 'shower' }, { label: 'Унитаз / инсталляция', value: 'toilet' }, { label: 'Стиральная машина', value: 'washing_machine' },
        { label: 'Стационарная мебель', value: 'fixed_furniture' }, { label: 'Камин / тяжёлое оборудование', value: 'heavy_equipment' }, { label: 'Таких зон нет', value: 'none' }, { label: 'Не знаю', value: 'unknown' },
      ],
    };
  }
  if (!requirements.installAreaMode && !hasPositiveNumber(requirements.availableInstallAreaM2) && !hasPositiveNumber(requirements.installationArea)) {
    return {
      type: 'single_choice', field: 'installAreaMode', label: 'Какая площадь реально доступна для укладки?',
      description: 'Общую площадь комнаты нельзя автоматически считать площадью укладки.', required: true,
      options: [
        { label: 'Ввести вручную', value: 'manual' }, { label: 'Рассчитать автоматически', value: 'auto' },
        { label: 'Почти вся площадь', value: 'almost_all' }, { label: 'Только зона прохода / рабочая зона', value: 'work_zone' }, { label: 'Пока не знаю', value: 'unknown' },
      ],
    };
  }
  if (requirements.installAreaMode === 'unknown') {
    return {
      type: 'single_choice', field: 'installAreaMode', label: 'Для корректного подбора нужна площадь укладки',
      description: 'Нельзя укладывать нагревательный элемент под стационарную мебель, кухню, ванну, душевую, шкафы без ножек и зоны без теплоотвода.', required: true,
      options: [{ label: 'Ввести вручную', value: 'manual' }, { label: 'Рассчитать автоматически', value: 'auto' }, { label: 'Почти вся площадь', value: 'almost_all' }, { label: 'Только рабочая зона', value: 'work_zone' }],
    };
  }
  if (requirements.installAreaMode === 'manual' && !hasPositiveNumber(requirements.availableInstallAreaM2)) {
    return { type: 'number_input', field: 'availableInstallAreaM2', label: 'Введите доступную площадь укладки', description: 'Укажите только площадь, где реально можно разложить кабель/мат.', unit: 'м²', placeholder: String(requirements.area || 10), min: 0.5, max: Number(requirements.area || 1000), required: true };
  }
  const zonesNeedArea = Array.isArray(requirements.blockedZones) && !requirements.blockedZones.includes('none') && !requirements.blockedZones.includes('unknown');
  if ((requirements.installAreaMode === 'auto' || zonesNeedArea) && !hasPositiveNumber(requirements.blockedAreaM2) && !hasPositiveNumber(requirements.availableInstallAreaM2)) {
    return { type: 'number_input', field: 'blockedAreaM2', label: 'Какая примерная площадь запрещённых зон?', description: 'Мебель без ножек, кухня, ванна, душ, техника и другие зоны без теплоотвода.', unit: 'м²', placeholder: '4', min: 0, max: Number(requirements.area || 1000), required: true };
  }
  if (!hasPositiveNumber(requirements.availableInstallAreaM2) && !hasPositiveNumber(requirements.installationArea)) {
    return { type: 'number_input', field: 'availableInstallAreaM2', label: 'Уточните доступную площадь укладки', description: 'Без этой площади финальный подбор запрещён.', unit: 'м²', placeholder: String(requirements.area || 10), min: 0.5, max: Number(requirements.area || 1000), required: true };
  }
  if (!requirements.preferredHeatingElement) {
    return {
      type: 'single_choice', field: 'preferredHeatingElement', label: 'Какой тип системы предпочитаете?',
      description: 'Если не уверены — выберите автоматический подбор.', required: true,
      options: [
        { label: 'Нагревательный кабель', value: 'heating_cable' }, { label: 'Нагревательный мат', value: 'heating_mat' },
        { label: 'Тонкий мат / минимальная высота', value: 'thin_mat' }, { label: 'Автоматически подобрать', value: 'auto' },
      ],
    };
  }
  if (!requirements.budgetLevel || requirements.budgetLevel === 'unknown') {
    return { type: 'single_choice', field: 'budgetLevel', label: 'Какой подход по бюджету?', required: true, options: [{ label: 'Эконом', value: 'economy' }, { label: 'Оптимальный', value: 'optimal' }, { label: 'Премиум', value: 'premium' }, { label: 'Не важно', value: 'any' }] };
  }
  const powerComment = requirements.floorHeatingPurpose === 'primary_heating'
    ? 'После подбора сравню мощность тёплого пола с теплопотерями помещения.'
    : 'Для комфортного/дополнительного обогрева допустимо, что мощность пола ниже теплопотерь помещения.';
  return {
    type: 'confirmation', field: 'confirmation', label: 'Проверьте параметры перед подбором комплекта',
    description: 'Финальный список оборудования будет сформирован только после подтверждения.',
    summary: [
      { label: 'Помещение', value: displayValue('roomType', requirements.roomType) },
      { label: 'Площадь', value: displayValue('area', requirements.area) },
      { label: 'Высота', value: displayValue('ceilingHeight', requirements.ceilingHeight) },
      { label: 'Назначение', value: displayValue('floorHeatingPurpose', requirements.floorHeatingPurpose) },
      { label: 'Покрытие', value: displayValue('floorFinish', requirements.floorFinish) },
      { label: 'Тип монтажа', value: displayValue('floorBuildType', requirements.floorBuildType) },
      { label: 'Доступная площадь укладки', value: displayValue('availableInstallAreaM2', requirements.availableInstallAreaM2 || requirements.installationArea) },
      { label: 'Запрещённые зоны', value: displayValue('blockedZones', requirements.blockedZones) },
      { label: 'Утепление / окна', value: `${displayValue('insulation', requirements.insulation)} / ${displayValue('windows', requirements.windows)}` },
      { label: 'Рекомендуемый тип', value: displayValue('preferredHeatingElement', requirements.preferredHeatingElement) },
      { label: 'Бюджет', value: displayValue('budgetLevel', requirements.budgetLevel) },
      { label: 'Комментарий по мощности', value: powerComment },
    ],
    options: [
      { label: 'Подобрать комплект', value: 'submit' },
      { label: 'Изменить площадь укладки', value: 'edit_install_area' },
      { label: 'Изменить тип монтажа', value: 'edit_build_type' },
      { label: 'Изменить покрытие', value: 'edit_finish' },
      { label: 'Изменить бюджет', value: 'edit_budget' },
    ],
  };
}

function genericHeatingQuestion(requirements: Record<string, unknown>, intent: string): StepQuestion | null {
  if (intent === 'heating_selection' && (!requirements.objectType || requirements.objectType === 'unknown')) {
    return {
      type: 'single_choice',
      field: 'objectType',
      questionId: 'heating_object_type',
      title: 'Для какого объекта нужно рассчитать отопление?',
      label: 'Начнем с типа объекта. Для чего рассчитываем отопление?',
      description: 'ИИ-инженер построит дальнейший расчет под выбранный тип объекта.',
      required: true,
      options: [{ label: 'Квартира', value: 'apartment' }, { label: 'Собственный дом', value: 'private_house' }],
    };
  }
  if (intent === 'heating_selection' && requirements.objectType === 'apartment') {
    const rooms = roomsFromRequirements(requirements);
    const count = Object.values(rooms).reduce((sum, value) => sum + value, 0);
    if (count === 0 || !Array.isArray(requirements.roomDetails) || (requirements.roomDetails as unknown[]).length !== count) {
      return {
        type: 'multi_counter',
        field: 'rooms',
        questionId: 'heating_apartment_rooms',
        title: 'Выберите комнаты',
        label: 'Выберите комнаты, которые есть в квартире',
        description: 'Нажмите на нужные комнаты, чтобы добавить их в расчет. После выбора укажите площадь каждой комнаты — так я смогу рассчитать отопление точнее и подобрать оборудование по каждому помещению отдельно.',
        counters: [
          { key: 'kitchen', label: 'Кухня' }, { key: 'bedroom', label: 'Спальня' }, { key: 'livingRoom', label: 'Гостиная' },
          { key: 'corridor', label: 'Коридор' }, { key: 'bathroom', label: 'Ванная' }, { key: 'childRoom', label: 'Детская' },
          { key: 'balcony', label: 'Балкон' }, { key: 'entryway', label: 'Прихожая' }, { key: 'office', label: 'Кабинет' },
        ],
        actions: ['continue', 'reset'],
        required: true,
      };
    }
    const missingArea = (requirements.roomDetails as Array<Record<string, unknown>>).some((room) => !hasPositiveNumber(num(room.areaM2)));
    if (missingArea) {
      const fields: RoomAreaFormQuestion['fields'] = (requirements.roomDetails as Array<Record<string, unknown>>).map((room) => {
        const roomLabel = String(room.label || 'Помещение').replace(/ 1$/, '');
        return { key: `${room.id}.areaM2`, label: `${roomLabel} — площадь, м²`, inputType: 'number' as const, required: true, min: 1, max: 200, step: 0.1 };
      });
      return {
        type: 'room_area_form',
        field: 'roomAreaForm',
        questionId: 'heating_apartment_room_areas',
        title: 'Выбранные комнаты',
        label: 'Укажите площадь каждой комнаты в м².',
        description: 'Заполните площадь для всех выбранных комнат, чтобы перейти к следующему шагу.',
        fields,
        submitLabel: 'Далее',
      };
    }
    if (!requirements.readyForCalculation) {
      return {
        type: 'summary_review',
        field: 'summaryAction',
        questionId: 'heating_apartment_summary_review',
        title: 'Проверьте помещения перед расчётом',
        label: 'Проверьте помещения перед расчётом',
        summary: [
          { label: 'Объект', value: 'Квартира' },
          { label: 'Комнат', value: String((requirements.roomDetails as unknown[]).length) },
          { label: 'Общая площадь', value: `${totalRoomArea(requirements.roomDetails)} м²` },
          { label: 'Расчёт', value: 'Электрическое отопление по каждой комнате отдельно' },
        ],
        options: [{ label: 'Рассчитать и подобрать оборудование', value: 'calculate' }, { label: 'Изменить комнаты', value: 'edit_rooms' }],
      };
    }
    return null;
  }
  if (!hasPositiveNumber(requirements.area)) return { type: 'number_input', field: 'area', label: 'Сколько квадратных метров помещения?', description: 'Для расчёта базовой мощности отопления.', unit: 'м²', placeholder: '35', min: 1, max: 1000, required: true };
  if (!hasPositiveNumber(requirements.ceilingHeight)) return { type: 'single_choice', field: 'ceilingHeight', label: 'Высота потолка', description: 'Если неизвестно, используйте ближайший вариант.', required: true, options: [{ label: '2.5 м', value: 2.5 }, { label: '2.7 м', value: 2.7 }, { label: '3.0 м', value: 3.0 }, { label: 'Другое / 2.7 м', value: 2.7 }] };
  if (!requirements.energySource || requirements.energySource === 'unknown') return { type: 'single_choice', field: 'energySource', label: 'Источник энергии', description: 'Выберите доступный источник.', required: true, options: [{ label: 'Да, есть газ', value: 'gas' }, { label: 'Нет, только электричество', value: 'electric' }, { label: 'Не знаю', value: 'unknown' }] };
  if (!requirements.preferredSystemTypes || !Array.isArray(requirements.preferredSystemTypes) || requirements.preferredSystemTypes.length === 0) {
    const options = intent === 'boiler_selection'
      ? [{ label: 'Газовый котёл', value: 'gas_boiler' }, { label: 'Электрический котёл', value: 'electric_boiler' }]
      : intent === 'radiator_selection' ? [{ label: 'Радиаторы', value: 'radiators' }]
        : intent === 'pump_selection' ? [{ label: 'Циркуляционный насос', value: 'circulation_pump' }]
          : String(requirements.energySource) === 'gas'
            ? [{ label: 'Газовый котёл', value: 'gas_boiler' }, { label: 'Heat pump', value: 'heat_pump' }]
            : [{ label: 'Heat pump', value: 'heat_pump' }, { label: 'Электрический конвектор', value: 'electric_convector' }, { label: 'Электрический котёл', value: 'electric_boiler' }, { label: 'Тёплый пол', value: 'floor_heating' }, { label: 'Инфракрасное отопление', value: 'infrared_heating' }];
    return { type: 'single_choice', field: 'preferredSystemTypes', label: 'Тип системы', description: 'Выберите предпочтительный способ отопления.', required: true, options };
  }
  if (!requirements.budgetLevel || requirements.budgetLevel === 'unknown') return { type: 'single_choice', field: 'budgetLevel', label: 'Бюджетный подход', required: true, options: [{ label: 'Эконом', value: 'economy' }, { label: 'Оптимальный', value: 'optimal' }, { label: 'Премиум', value: 'premium' }, { label: 'Не важно', value: 'any' }] };
  return null;
}

const roomLabels: Record<string, string> = {
  generic: 'Комната', bedroom: 'Спальня', livingRoom: 'Гостиная', kitchen: 'Кухня', bathroom: 'Санузел', corridor: 'Коридор',
  childRoom: 'Детская', balcony: 'Балкон', entryway: 'Прихожая', office: 'Кабинет',
};

function roomsFromRequirements(requirements: Record<string, unknown>) {
  const raw = (requirements.rooms && typeof requirements.rooms === 'object') ? requirements.rooms as Record<string, unknown> : {};
  return {
    generic: Math.max(0, Number(raw.generic || 0)),
    bedroom: Math.max(0, Number(raw.bedroom || 0)),
    livingRoom: Math.max(0, Number(raw.livingRoom || 0)),
    kitchen: Math.max(0, Number(raw.kitchen || 0)),
    bathroom: Math.max(0, Number(raw.bathroom || 0)),
    corridor: Math.max(0, Number(raw.corridor || 0)),
    childRoom: Math.max(0, Number(raw.childRoom || 0)),
    balcony: Math.max(0, Number(raw.balcony || 0)),
    entryway: Math.max(0, Number(raw.entryway || 0)),
    office: Math.max(0, Number(raw.office || 0)),
  };
}

function roomDetailsFromCounts(rooms: Record<string, number>, existing: unknown) {
  const existingRows = Array.isArray(existing) ? existing as Array<Record<string, unknown>> : [];
  const byId = new Map(existingRows.map((row) => [String(row.id), row]));
  const details: Array<Record<string, unknown>> = [];
  Object.entries(rooms).forEach(([type, count]) => {
    for (let index = 1; index <= count; index += 1) {
      const id = `${type}_${index}`;
      const previous = byId.get(id) || {};
      details.push({ id, type, label: `${roomLabels[type] || 'Помещение'} ${index}`, areaM2: null, heightM: null, windows: null, sunnySide: null, lastFloor: null, largeWindows: null, ...previous });
    }
  });
  return details;
}

function totalRoomArea(roomDetails: unknown) {
  if (!Array.isArray(roomDetails)) return 0;
  return Math.round(roomDetails.reduce((sum, room) => sum + (num((room as Record<string, unknown>).areaM2) || 0), 0) * 100) / 100;
}

function coolingQuestion(requirements: Record<string, unknown>): StepQuestion | null {
  if (!requirements.objectType || requirements.objectType === 'unknown') {
    return {
      type: 'single_choice', field: 'objectType', questionId: 'cooling_object_type', label: 'Где нужно охлаждение?', title: 'Где нужно охлаждение?', required: true,
      options: [{ label: 'Квартира', value: 'apartment' }, { label: 'Частный дом', value: 'private_house' }, { label: 'Коммерческое помещение', value: 'commercial' }],
    };
  }
  if (requirements.objectType === 'apartment') {
    const rooms = roomsFromRequirements(requirements);
    const count = Object.values(rooms).reduce((sum, value) => sum + value, 0);
    if (count === 0 || !Array.isArray(requirements.roomDetails) || (requirements.roomDetails as unknown[]).length !== count) {
      return {
        type: 'multi_counter', field: 'rooms', questionId: 'cooling_room_counts', title: 'Сколько помещений нужно охладить?', label: 'Сколько помещений нужно охладить?',
        description: 'Нажимайте кнопку несколько раз: каждое нажатие добавляет ещё одно помещение.',
        counters: [
          { key: 'generic', label: 'Комната' }, { key: 'bedroom', label: 'Спальня' }, { key: 'livingRoom', label: 'Гостиная' },
          { key: 'kitchen', label: 'Кухня' }, { key: 'bathroom', label: 'Санузел' }, { key: 'corridor', label: 'Коридор' },
        ],
        actions: ['continue', 'reset'], required: true,
      };
    }
    const missingArea = (requirements.roomDetails as Array<Record<string, unknown>>).some((room) => !hasPositiveNumber(num(room.areaM2)));
    if (missingArea || !hasPositiveNumber(requirements.ceilingHeight)) {
      const fields: RoomAreaFormQuestion['fields'] = (requirements.roomDetails as Array<Record<string, unknown>>).map((room) => ({
        key: `${room.id}.areaM2`, label: `${room.label}, м²`, inputType: 'number' as const, required: true, min: 1, max: 200, step: 0.1,
      }));
      fields.push({ key: 'ceilingHeight', label: 'Высота потолков, м', inputType: 'number' as const, required: true, min: 2, max: 6, step: 0.1 });
      fields.push({ key: 'sunnySide', label: 'Солнечная сторона', inputType: 'select' as const, required: true, options: [{ label: 'Да', value: true }, { label: 'Нет', value: false }, { label: 'Не знаю', value: 'unknown' }] });
      fields.push({ key: 'windowsCount', label: 'Количество окон', inputType: 'number' as const, required: true, min: 0, max: 30, step: 1 });
      fields.push({ key: 'lastFloor', label: 'Последний этаж', inputType: 'select' as const, required: true, options: [{ label: 'Да', value: true }, { label: 'Нет', value: false }] });
      fields.push({ key: 'largeWindows', label: 'Большие окна / витражи', inputType: 'select' as const, required: true, options: [{ label: 'Да', value: true }, { label: 'Нет', value: false }] });
      fields.push({ key: 'preferredCoolingSystem', label: 'Предпочтение по системе', inputType: 'select' as const, required: true, options: [
        { label: 'Отдельные сплит-системы', value: 'split' }, { label: 'Мульти-сплит', value: 'multi_split' }, { label: 'Канальная система', value: 'ducted' }, { label: 'Тепловой насос / Heat pump', value: 'heat_pump' }, { label: 'Не знаю, подобрать автоматически', value: 'auto' },
      ] });
      return { type: 'room_area_form', field: 'roomAreaForm', questionId: 'cooling_room_areas', title: 'Укажите площадь каждого помещения', label: 'Укажите площадь каждого помещения', description: 'Все помещения заполняются на одном экране — без длинной переписки.', fields, submitLabel: 'Продолжить' };
    }
    if (!requirements.readyForCalculation) {
      return {
        type: 'summary_review', field: 'summaryAction', questionId: 'cooling_summary_review', title: 'Проверьте данные перед расчётом', label: 'Проверьте данные перед расчётом',
        summary: [
          { label: 'Направление', value: 'Охлаждение' }, { label: 'Объект', value: 'Квартира' },
          { label: 'Помещений', value: String((requirements.roomDetails as unknown[]).length) }, { label: 'Общая площадь', value: `${totalRoomArea(requirements.roomDetails)} м²` },
          { label: 'Высота', value: `${requirements.ceilingHeight || '—'} м` }, { label: 'Система', value: displayValue('preferredCoolingSystem', requirements.preferredCoolingSystem) },
        ],
        options: [{ label: 'Рассчитать и подобрать оборудование', value: 'calculate' }, { label: 'Изменить помещения', value: 'edit_rooms' }],
      };
    }
    return null;
  }
  if (!hasPositiveNumber(requirements.area)) return { type: 'number_input', field: 'area', questionId: 'cooling_area', label: 'Какая общая площадь охлаждения?', unit: 'м²', placeholder: '60', min: 1, max: 2000, required: true };
  if (!hasPositiveNumber(requirements.ceilingHeight)) return { type: 'single_choice', field: 'ceilingHeight', questionId: 'cooling_ceiling_height', label: 'Высота потолка', required: true, options: [{ label: '2.7 м', value: 2.7 }, { label: '3.0 м', value: 3.0 }, { label: 'Другое / 2.7 м', value: 2.7 }] };
  if (!requirements.preferredCoolingSystem) return { type: 'single_choice', field: 'preferredCoolingSystem', questionId: 'cooling_system_type', label: 'Какой тип системы предпочитаете?', required: true, options: [{ label: 'Сплит-системы', value: 'split' }, { label: 'Мульти-сплит', value: 'multi_split' }, { label: 'Канальная система', value: 'ducted' }, { label: 'Тепловой насос / Heat pump', value: 'heat_pump' }, { label: 'Не знаю, подобрать автоматически', value: 'auto' }] };
  return null;
}

function electricalQuestion(requirements: Record<string, unknown>): StepQuestion | null {
  if (!requirements.electricalNeed) return { type: 'single_choice', field: 'electricalNeed', questionId: 'electrical_need', label: 'Что нужно подобрать?', title: 'Что нужно подобрать?', required: true, options: [
    { label: 'Щит', value: 'panel' }, { label: 'Автоматы', value: 'breakers' }, { label: 'Кабель', value: 'cable' }, { label: 'Розетки/выключатели', value: 'wiring_devices' }, { label: 'Освещение', value: 'lighting' }, { label: 'Защита', value: 'protection' }, { label: 'Другое', value: 'other' },
  ] };
  if (!requirements.objectType || requirements.objectType === 'unknown') return { type: 'single_choice', field: 'objectType', questionId: 'electrical_object_type', label: 'Тип объекта', required: true, options: [{ label: 'Квартира', value: 'apartment' }, { label: 'Частный дом', value: 'private_house' }, { label: 'Коммерческое помещение', value: 'commercial' }] };
  if (!hasPositiveNumber(requirements.area)) return { type: 'number_input', field: 'area', questionId: 'electrical_area', label: 'Площадь объекта', unit: 'м²', min: 1, max: 5000, required: true };
  if (!requirements.phaseType) return { type: 'single_choice', field: 'phaseType', questionId: 'electrical_phase_type', label: 'Сеть однофазная или трёхфазная?', required: true, options: [{ label: 'Однофазная', value: 'single_phase' }, { label: 'Трёхфазная', value: 'three_phase' }, { label: 'Не знаю', value: 'unknown' }] };
  if (!requirements.needSpecification) return { type: 'summary_review', field: 'summaryAction', questionId: 'electrical_summary_review', title: 'Собрать предварительную спецификацию?', label: 'Собрать предварительную спецификацию?', summary: [
    { label: 'Направление', value: 'Электрика' }, { label: 'Задача', value: displayValue('electricalNeed', requirements.electricalNeed) }, { label: 'Объект', value: displayValue('objectType', requirements.objectType) }, { label: 'Площадь', value: `${requirements.area} м²` }, { label: 'Сеть', value: displayValue('phaseType', requirements.phaseType) },
  ], options: [{ label: 'Сформировать список оборудования', value: 'calculate' }, { label: 'Уточнить параметры', value: 'edit' }] };
  return null;
}

function mapRequirementsToQuestion(requirements: Record<string, unknown>, intent: string, missing: string[]): StepQuestion | null {
  if (intent === 'floor_heating_selection') return floorHeatingQuestion(requirements);
  if (intent === 'heating_selection' || intent === 'boiler_selection' || intent === 'radiator_selection' || intent === 'pump_selection') return genericHeatingQuestion(requirements, intent);
  if (intent === 'cooling_selection' || intent === 'hvac_selection') return coolingQuestion(requirements);
  if (intent === 'electrical_selection') return electricalQuestion(requirements);
  if (missing.includes('mode')) return { type: 'single_choice', field: 'mode', label: 'Что нужно подобрать?', description: 'Выберите режим, чтобы продолжить.', required: true, options: [{ label: 'Отопление', value: 'heating' }, { label: 'Охлаждение', value: 'cooling' }, { label: 'Электрика', value: 'electrical' }] };
  return null;
}

export function buildFlowState(requirements: Record<string, unknown>, intent: string) {
  const area = num(requirements.area ?? requirements.roomAreaM2);
  const ceilingHeight = num(requirements.ceilingHeight ?? requirements.ceilingHeightM);
  const blockedArea = num(requirements.blockedAreaM2);
  let availableInstallArea = num(requirements.availableInstallAreaM2 ?? requirements.installationArea);
  const installAreaMode = requirements.installAreaMode ? String(requirements.installAreaMode) : undefined;
  if (!availableInstallArea && installAreaMode === 'almost_all' && area) availableInstallArea = Math.round(area * 0.9 * 100) / 100;
  if (!availableInstallArea && installAreaMode === 'work_zone' && area) availableInstallArea = Math.round(area * 0.5 * 100) / 100;
  if (!availableInstallArea && area && blockedArea !== null && blockedArea >= 0) availableInstallArea = Math.max(0, Math.round((area - blockedArea) * 100) / 100);

  const floorFinish = requirements.floorFinish || requirements.floorCovering || null;
  const floorCovering = floorFinish === 'porcelain_tile' ? 'porcelain' : floorFinish || requirements.floorCovering || null;
  const floorHeatingPurpose = requirements.floorHeatingPurpose || (requirements.heatingPurpose === 'primary' ? 'primary_heating' : requirements.heatingPurpose === 'comfort' ? 'comfort' : null);

  const rooms = roomsFromRequirements(requirements);
  const roomDetails = roomDetailsFromCounts(rooms, requirements.roomDetails);
  const derivedArea = area || totalRoomArea(roomDetails) || null;

  const minimum: Record<string, unknown> = {
    mode: requirements.mode || 'unknown',
    area: derivedArea,
    roomAreaM2: derivedArea,
    ceilingHeight,
    ceilingHeightM: ceilingHeight,
    energySource: requirements.energySource || 'unknown',
    hasGas: requirements.hasGas ?? null,
    preferredSystemTypes: Array.isArray(requirements.preferredSystemTypes) ? requirements.preferredSystemTypes.map(String) : [],
    budgetLevel: requirements.budgetLevel === 'any' ? 'optimal' : requirements.budgetLevel || 'unknown',
    budget: num(requirements.budget),
    direction: requirements.direction || (intent === 'electrical_selection' ? 'electrical' : intent === 'cooling_selection' || intent === 'hvac_selection' ? 'cooling' : intent === 'heating_selection' || intent === 'floor_heating_selection' ? 'heating' : 'unknown'),
    objectType: requirements.objectType || 'unknown',
    rooms,
    roomDetails,
    readyForCalculation: Boolean(requirements.readyForCalculation),
    sunnySide: requirements.sunnySide ?? null,
    windowsCount: num(requirements.windowsCount),
    lastFloor: requirements.lastFloor ?? null,
    largeWindows: requirements.largeWindows ?? null,
    preferredCoolingSystem: requirements.preferredCoolingSystem || null,
    electricalNeed: requirements.electricalNeed || null,
    phaseType: requirements.phaseType || null,
    needSpecification: requirements.needSpecification || null,
    roomType: requirements.roomType || 'unknown',
    floorCovering,
    floorFinish,
    floorBuildType: requirements.floorBuildType || null,
    floorHeatingPurpose,
    heatingPurpose: floorHeatingPurpose === 'primary_heating' ? 'primary' : floorHeatingPurpose === 'comfort' ? 'comfort' : requirements.heatingPurpose || null,
    preferredHeatingElement: requirements.preferredHeatingElement || null,
    installationArea: availableInstallArea,
    availableInstallAreaM2: availableInstallArea,
    blockedAreaM2: blockedArea,
    installAreaMode,
    blockedZones: Array.isArray(requirements.blockedZones) ? requirements.blockedZones.map(String) : [],
    conditions: Array.isArray(requirements.conditions) ? requirements.conditions.map(String) : [],
    includeAccessories: requirements.includeAccessories,
    stockPolicy: requirements.stockPolicy || 'hide_exact_stock',
  };
  if (requirements.insulation) minimum.insulation = requirements.insulation;
  if (requirements.insulationLevel) minimum.insulation = requirements.insulationLevel === 'medium' ? 'normal' : requirements.insulationLevel;
  if (requirements.windows) minimum.windows = requirements.windows;
  if (requirements.windowType) minimum.windows = requirements.windowType;
  if (requirements.requiredHeatingPowerW) minimum.requiredHeatingPowerW = num(requirements.requiredHeatingPowerW);
  if (intent === 'floor_heating_selection') {
    minimum.mode = 'floor_heating';
    if (!Array.isArray(minimum.preferredSystemTypes) || minimum.preferredSystemTypes.length === 0) minimum.preferredSystemTypes = ['floor_heating'];
  }
  if (intent === 'cooling_selection' || intent === 'hvac_selection') { minimum.mode = 'cooling'; minimum.direction = 'cooling'; }
  if (intent === 'electrical_selection') { minimum.mode = 'electrical'; minimum.direction = 'electrical'; }
  if (intent === 'heating_selection' || intent === 'boiler_selection' || intent === 'radiator_selection' || intent === 'pump_selection') { minimum.mode = 'heating'; minimum.direction = 'heating'; }
  if (requirements.hasGas === true) minimum.energySource = 'gas';
  if (requirements.hasGas === false) minimum.energySource = 'electric';
  if (minimum.energySource === 'gas') minimum.hasGas = true;
  if (minimum.energySource === 'electric') minimum.hasGas = false;
  return minimum;
}

export function nextQuestion(requirements: Record<string, unknown>, intent: string, missing: string[]) {
  const question = mapRequirementsToQuestion(requirements, intent, missing);
  if (!question) return null;
  if ('options' in question && question.options.length === 0) return null;
  return question;
}

export function flowProgress(intent: string, question: StepQuestion | null) {
  const meta = intentFlowMeta[intent] || { fields: ['mode', 'area', 'budgetLevel'], totalSteps: 3 };
  const index = question ? meta.fields.indexOf(question.field) : meta.totalSteps - 1;
  const currentStep = Math.max(1, index >= 0 ? Math.min(index + 1, meta.totalSteps) : meta.totalSteps);
  const totalSteps = meta.totalSteps;
  return { totalSteps, currentStep, progressPercent: Math.min(100, Math.max(5, Math.round((currentStep / totalSteps) * 100))) };
}
