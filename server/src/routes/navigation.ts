import { Router } from 'express';
import { composeCanonicalNavigation, getNavigationLabelMap, NAV_CONTRACT_VERSION } from '../utils/navigationComposer.js';

const router = Router();

router.get('/', (_req, res) => {
  const payload = composeCanonicalNavigation();
  res.json(payload);
});

router.get('/menu', (_req, res) => {
  const payload = composeCanonicalNavigation();
  res.json(payload.items);
});

router.get('/labels', (_req, res) => {
  res.json({
    nav_contract_version: NAV_CONTRACT_VERSION,
    labels: getNavigationLabelMap(),
  });
});

router.get('/version', (_req, res) => {
  res.json({ nav_contract_version: NAV_CONTRACT_VERSION });
});

export default router;
