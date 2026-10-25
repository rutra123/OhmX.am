/**
 * Warm-floor multi-room project API.
 * Additive endpoints — does not replace POST /warm-floor/recommendations.
 */
import { Router } from 'express';
import {
  addRoom,
  confirmProject,
  createProject,
  deleteProject,
  getProjectView,
  listProjects,
  loadProject,
  lockRoomVariant,
  recalculateProject,
  removeRoom,
  setPreferredBundleRole,
  updateProjectMeta,
  updateRoom,
} from '../utils/warmFloorProjectService.js';

const router = Router();

function sendError(res: any, err: any) {
  const code = err?.code || 'project.error';
  const status = code === 'project.not_found' || code === 'project.room_not_found'
    ? 404
    : code === 'project.blocked' || code === 'project.confirmed_immutable' || code === 'project.no_rooms'
      ? 409
      : 400;
  res.status(status).json({
    error: err?.message || 'Project error',
    code,
    details: err?.details || undefined,
  });
}

router.get('/project', (_req, res) => {
  res.json({ projects: listProjects() });
});

router.post('/project', (req, res) => {
  try {
    const project = createProject({
      name: req.body?.name,
      regionProfile: req.body?.regionProfile,
      preferredBundleRole: req.body?.preferredBundleRole,
      objectType: req.body?.objectType ?? null,
      objectTotalAreaM2: req.body?.objectTotalAreaM2 ?? null,
      rooms: Array.isArray(req.body?.rooms) ? req.body.rooms : [],
    });
    res.status(201).json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/project/:id', (req, res) => {
  try {
    const project = updateProjectMeta(req.params.id, {
      name: req.body?.name,
      objectType: req.body?.objectType,
      objectTotalAreaM2: req.body?.objectTotalAreaM2,
      preferredBundleRole: req.body?.preferredBundleRole,
    });
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/project/:id', (req, res) => {
  try {
    const project = loadProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found', code: 'project.not_found' });
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/project/:id/view', (req, res) => {
  try {
    res.json(getProjectView(req.params.id));
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/project/:id', (req, res) => {
  try {
    const ok = deleteProject(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Project not found', code: 'project.not_found' });
    res.json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/project/:id/rooms', (req, res) => {
  try {
    const project = addRoom(req.params.id, req.body || {});
    res.status(201).json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.patch('/project/:id/rooms/:roomId', (req, res) => {
  try {
    const project = updateRoom(req.params.id, req.params.roomId, req.body || {});
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.delete('/project/:id/rooms/:roomId', (req, res) => {
  try {
    const project = removeRoom(req.params.id, req.params.roomId);
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/project/:id/recalculate', (req, res) => {
  try {
    const project = recalculateProject(req.params.id, {
      roomId: req.body?.roomId || undefined,
    });
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/project/:id/preferred-role', (req, res) => {
  try {
    const project = setPreferredBundleRole(req.params.id, String(req.body?.role || 'premium'));
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/project/:id/rooms/:roomId/lock-variant', (req, res) => {
  try {
    const role = req.body?.role == null || req.body?.role === '' ? null : String(req.body.role);
    const project = lockRoomVariant(req.params.id, req.params.roomId, role);
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.post('/project/:id/confirm', (req, res) => {
  try {
    const project = confirmProject(req.params.id);
    res.json(project);
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/project/:id/specification', (req, res) => {
  try {
    const view = getProjectView(req.params.id);
    res.json({
      status: view.status,
      overallStatus: view.overallStatus,
      specificationByRoom: view.specificationByRoom,
      consolidatedBom: view.consolidatedBom,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.get('/project/:id/estimate', (req, res) => {
  try {
    const view = getProjectView(req.params.id);
    res.json({
      status: view.status,
      overallStatus: view.overallStatus,
      estimate: view.estimate,
      immutable: view.immutable,
    });
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
