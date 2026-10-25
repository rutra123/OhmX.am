import type { BuildingLoadMode, BuildingProject, BuildingRoom } from './buildingProjectTypes.js';

type PhysicalSpaceAbove = 'conditioned_space' | 'outdoors' | 'unheated_attic';
type PhysicalSpaceBelow = 'conditioned_space' | 'ground' | 'unheated_space';

export interface PhysicalCompletenessIssue {
  key: 'external_walls_declaration' | 'external_doors_declaration' | 'windows_declaration' | 'upper_boundary' | 'lower_boundary';
  code: string;
  label: string;
  action: string;
  sectionKey: 'envelope' | 'windows';
}

export interface ProjectPhysicalCompletenessRoom {
  roomId: string;
  roomName: string;
  issues: PhysicalCompletenessIssue[];
}

function explicitAbove(value: string | null | undefined): PhysicalSpaceAbove | null {
  return value === 'conditioned_space' || value === 'outdoors' || value === 'unheated_attic' ? value : null;
}

function explicitBelow(value: string | null | undefined): PhysicalSpaceBelow | null {
  return value === 'conditioned_space' || value === 'ground' || value === 'unheated_space' ? value : null;
}

function boundaries(project: BuildingProject, room: BuildingRoom): { above: PhysicalSpaceAbove | null; below: PhysicalSpaceBelow | null } {
  let above = explicitAbove(room.extras?.geometry?.spaceAbove);
  let below = explicitBelow(room.extras?.geometry?.spaceBelow);
  const topology = project.topology;
  const floor = room.floorId && topology?.floors?.find((candidate) => candidate.id === room.floorId);

  if (project.objectType === 'private_house' && floor && topology?.floors?.length) {
    const levels = topology.floors.map((candidate) => candidate.level);
    const minLevel = Math.min(...levels);
    const maxLevel = Math.max(...levels);
    if (!above) {
      if (floor.level < maxLevel) above = 'conditioned_space';
      else if (topology.topBoundaryType === 'direct_roof') above = 'outdoors';
      else if (topology.topBoundaryType === 'unheated_attic') above = 'unheated_attic';
    }
    if (!below) {
      if (floor.level > minLevel) below = 'conditioned_space';
      else if (topology.basementType === 'heated') below = 'conditioned_space';
      else if (topology.basementType === 'unheated') below = 'unheated_space';
      else if (topology.basementType === 'none') below = 'ground';
    }
  }

  const position = room.extras?.geometry?.floorPosition;
  if (!above) {
    if (position === 'intermediate' || position === 'basement') above = 'conditioned_space';
    else if (position === 'top') above = 'outdoors';
  }
  if (!below) {
    if (position === 'intermediate' || position === 'top') below = 'conditioned_space';
    else if (position === 'ground' || position === 'basement') below = 'ground';
  }
  return { above, below };
}

export function roomPhysicalCompleteness(project: BuildingProject, room: BuildingRoom): PhysicalCompletenessIssue[] {
  const issues: PhysicalCompletenessIssue[] = [];
  const envelope = room.envelope;
  const walls = envelope?.wallElements ?? [];
  const doors = envelope?.doorElements ?? [];
  const windows = envelope?.windowElements ?? [];
  const roof = envelope?.roofElements ?? [];
  const floor = envelope?.floorElements ?? [];
  const externalWallCount = room.extras?.geometry?.externalWallCount ?? null;
  const declaredDoorCount = room.extras?.geometry?.externalDoorCount ?? null;
  const declaredWindowCount = room.extras?.windows?.count ?? null;

  if (externalWallCount == null) {
    issues.push({ key: 'external_walls_declaration', code: 'physical_boundary:external_walls_unknown', label: 'Наружные стены: требуется указать', action: 'Укажите количество наружных сторон помещения и их общую длину.', sectionKey: 'envelope' });
  } else if ((externalWallCount === 0 && walls.length > 0) || (externalWallCount > 0 && walls.length === 0)) {
    issues.push({ key: 'external_walls_declaration', code: 'physical_boundary:external_walls_mismatch', label: 'Наружные стены: декларация не совпадает с геометрией', action: 'Согласуйте количество наружных сторон с введённой площадью стен.', sectionKey: 'envelope' });
  }

  const doorsExplicitNone = declaredDoorCount === 0 && doors.length === 0;
  if (doors.length === 0 && !doorsExplicitNone) {
    issues.push({ key: 'external_doors_declaration', code: 'physical_boundary:external_doors_unknown', label: 'Наружная дверь: не указано, есть дверь или нет', action: 'Добавьте наружную дверь или подтвердите «Нет».', sectionKey: 'envelope' });
  } else if (declaredDoorCount != null && declaredDoorCount !== doors.length) {
    issues.push({ key: 'external_doors_declaration', code: 'physical_boundary:external_doors_count_mismatch', label: 'Наружная дверь: количество не совпадает с описанием', action: 'Согласуйте декларацию с описанными наружными дверями.', sectionKey: 'envelope' });
  }

  const windowsExplicitNone = declaredWindowCount === 0 && windows.length === 0;
  if (windows.length === 0 && !windowsExplicitNone) {
    issues.push({ key: 'windows_declaration', code: 'physical_boundary:windows_unknown', label: 'Окна: не указано, есть окна или нет', action: 'Добавьте окна или подтвердите «Окон нет».', sectionKey: 'windows' });
  } else if (declaredWindowCount != null && declaredWindowCount !== windows.length) {
    issues.push({ key: 'windows_declaration', code: 'physical_boundary:windows_count_mismatch', label: 'Окна: количество не совпадает с описанием', action: 'Добавьте недостающие окна или исправьте декларацию.', sectionKey: 'windows' });
  }

  const resolved = boundaries(project, room);
  if (resolved.above == null) {
    issues.push({ key: 'upper_boundary', code: 'physical_boundary:space_above_unknown', label: 'Верхняя граница: требуется указать', action: 'Укажите: отапливаемое помещение, кровля/улица или неотапливаемый чердак.', sectionKey: 'envelope' });
  } else if (resolved.above !== 'conditioned_space' && roof.length === 0) {
    issues.push({ key: 'upper_boundary', code: 'physical_boundary:roof_missing', label: 'Верхняя граница: не описано ограждение', action: 'Укажите площадь и теплозащиту крыши/перекрытия над помещением.', sectionKey: 'envelope' });
  }

  if (resolved.below == null) {
    issues.push({ key: 'lower_boundary', code: 'physical_boundary:space_below_unknown', label: 'Нижняя граница: требуется указать', action: 'Укажите: отапливаемое помещение, грунт или неотапливаемое пространство.', sectionKey: 'envelope' });
  } else if (resolved.below !== 'conditioned_space' && floor.length === 0) {
    issues.push({ key: 'lower_boundary', code: 'physical_boundary:floor_missing', label: 'Нижняя граница: не описано ограждение', action: 'Укажите площадь и теплозащиту пола/перекрытия под помещением.', sectionKey: 'envelope' });
  }
  return issues;
}

export function projectPhysicalCompleteness(project: BuildingProject): ProjectPhysicalCompletenessRoom[] {
  return project.rooms
    .map((room) => ({ roomId: room.id, roomName: room.name, issues: roomPhysicalCompleteness(project, room) }))
    .filter((entry) => entry.issues.length > 0);
}

export function physicalCompletenessBlocksMode(mode: BuildingLoadMode): boolean {
  return mode === 'steady_state';
}
