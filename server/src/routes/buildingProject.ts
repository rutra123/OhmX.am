/**
 * Unified Building Project API — Phase 1 (object + rooms).
 * Additive. Does not replace warm-floor or power calculator routes.
 */
import { Router } from 'express';
import {
  addRoom,
  calculateLoads,
  confirmObject,
  confirmSystemsConfiguration,
  createProject,
  deleteProject,
  getBuildingProjectCatalog,
  getBuildingProjectSystemsCatalog,
  getLoadState,
  getProjectView,
  listProjects,
  loadProject,
  previewSuggestedSystemsConfiguration,
  applySuggestedSystemsConfiguration,
  removeRoom,
  reopenObject,
  setRoomTypeCount,
  updateProjectMeta,
  updateRoom,
  updateSystemsConfiguration,
} from '../utils/buildingProjectService.js';
import { EquipmentChoicesError, createEquipmentChoicesStore } from '../utils/buildingProjectEquipmentChoices.js';

const equipmentChoices = createEquipmentChoicesStore();

const router = Router();

function sendError(res: any, err: any) {
  const code = err?.code || 'building.error';
  const status = code === 'building.not_found' || code === 'building.room_not_found'
    ? 404
    : code === 'building.object_confirmed_immutable' || code === 'building.no_rooms' || code === 'building.object_not_confirmed' || code.startsWith('building.systems_') || code === 'building.floor_occupied'
      ? 409
      : 400;
  res.status(status).json({
    error: err?.message || 'Building project error',
    code,
    details: err?.details || undefined,
  });
}

router.get('/catalog', (_req, res) => {
  res.json(getBuildingProjectCatalog());
});

router.get('/systems-catalog', (_req, res) => {
  res.json(getBuildingProjectSystemsCatalog());
});

router.get('/', (_req, res) => {
  res.json({ projects: listProjects() });
});

router.post('/', (req, res) => {
  try {
    const project = createProject({
      name: req.body?.name,
      objectType: req.body?.objectType,
      regionCode: req.body?.regionCode ?? req.body?.region?.code,
      totalAreaM2: req.body?.totalAreaM2,
      defaultCeilingHeightM: req.body?.defaultCeilingHeightM,
      insulationLevel: req.body?.insulationLevel,
      floorCount: req.body?.floorCount,
      basementType: req.body?.basementType,
      topBoundaryType: req.body?.topBoundaryType,
      plantLocation: req.body?.plantLocation,
      rooms: Array.isArray(req.body?.rooms) ? req.body.rooms : [],
    });
    res.status(201).json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id', (req, res) => {
  try {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found', code: 'building.not_found' });
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/:id/view', (req, res) => {
  try {
    res.json(getProjectView(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/:id', (req, res) => {
  try {
    res.json(updateProjectMeta(req.params.id, {
      name: req.body?.name,
      objectType: req.body?.objectType,
      regionCode: req.body?.regionCode ?? req.body?.region?.code,
      totalAreaM2: req.body?.totalAreaM2,
      defaultCeilingHeightM: req.body?.defaultCeilingHeightM,
      insulationLevel: req.body?.insulationLevel,
      floorCount: req.body?.floorCount,
      basementType: req.body?.basementType,
      topBoundaryType: req.body?.topBoundaryType,
      plantLocation: req.body?.plantLocation,
    }));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/rooms', (req, res) => {
  try {
    res.status(201).json(addRoom(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/:id/room-counts', (req, res) => {
  try {
    res.json(setRoomTypeCount(req.params.id, String(req.body?.roomType || ''), Number(req.body?.count), req.body?.floorId));
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/:id/rooms/:roomId', (req, res) => {
  try {
    res.json(updateRoom(req.params.id, req.params.roomId, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/:id/rooms/:roomId', (req, res) => {
  try {
    res.json(removeRoom(req.params.id, req.params.roomId));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/confirm-object', (req, res) => {
  try {
    res.json(confirmObject(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/:id/systems', (req, res) => {
  try {
    res.json(updateSystemsConfiguration(req.params.id, req.body || {}));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/systems/suggest', (req, res) => {
  try {
    const requested = req.body?.requestedServices ?? req.body?.requestedService;
    const selected = Array.isArray(req.body?.selectedFamilyIds) ? req.body.selectedFamilyIds.map(String) : [];
    if (req.body?.apply) {
      res.json(applySuggestedSystemsConfiguration(req.params.id, requested, selected));
      return;
    }
    res.json({ suggestion: previewSuggestedSystemsConfiguration(req.params.id, requested, selected) });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/systems/confirm', (req, res) => {
  try {
    res.json(confirmSystemsConfiguration(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// Phase 3 — Loads (heating/cooling demand only; no equipment sizing).
router.get('/:id/loads', (req, res) => {
  try {
    res.json(getLoadState(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/loads/calculate', (req, res) => {
  try {
    res.json(calculateLoads(req.params.id, req.body?.mode));
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/:id/reopen-object', (req, res) => {
  try {
    res.json(reopenObject(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

// Customer equipment choices (fan-coil installation type, specification selections) — stored beside the project.
router.get('/:id/equipment-choices', (req, res) => {
  try {
    const doc = equipmentChoices.read(req.params.id);
    if (!loadProject(req.params.id)) return res.status(404).json({ error: 'Project not found', code: 'building.not_found' });
    res.json(doc);
  } catch (err) {
    sendError(res, err);
  }
});

router.put('/:id/equipment-choices', (req, res) => {
  try {
    equipmentChoices.read(req.params.id); // validates the id format before touching the project store
    if (!loadProject(req.params.id)) return res.status(404).json({ error: 'Project not found', code: 'building.not_found' });
    res.json(equipmentChoices.write(req.params.id, req.body?.choices));
  } catch (err) {
    if (err instanceof EquipmentChoicesError && err.code === 'building.choices_invalid') return res.status(400).json({ error: err.message, code: err.code });
    sendError(res, err);
  }
});

router.delete('/:id', (req, res) => {
  try {
    const ok = deleteProject(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Project not found', code: 'building.not_found' });
    try { equipmentChoices.remove(req.params.id); } catch { /* choices are optional companions of the project */ }
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
