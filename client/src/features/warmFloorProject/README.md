# Warm Floor multi-room project — client drop-in

These files are **not** deployed. Copy into production client only after reviewed plan:

```
client/src/features/warmFloorProject/
  types/project.ts
  services/projectApi.ts
  store/useWarmFloorProjectStore.ts
  components/WarmFloorProjectWizard.tsx
```

Wire a route, e.g. `/tools/warm-floor/project`, to `WarmFloorProjectWizard`.

Do **not** remove the existing single-room calculator at `/tools/warm-floor`.

API base (recovery):

- `POST /api/tools/warm-floor/project`
- `POST /api/tools/warm-floor/project/:id/rooms`
- `POST /api/tools/warm-floor/project/:id/recalculate`
- `POST /api/tools/warm-floor/project/:id/confirm`
- `GET  /api/tools/warm-floor/project/:id/specification`
- `GET  /api/tools/warm-floor/project/:id/estimate`
- `GET  /api/tools/warm-floor/project/:id/view`

Existing single-room endpoint unchanged:

- `POST /api/tools/warm-floor/recommendations`
