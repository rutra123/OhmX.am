#!/usr/bin/env python3
"""Read-only export of approved FAN_COIL hydraulic values for the client BOM engine.

Interim until a read-only server endpoint exposes engineering values
(see reports/building-project/equipment-bom-2026-10-13/README.md).
Usage: python3 export_fan_coil_hydraulic_snapshot.py <sqlite-copy.db> <out.json>
Never point it at the live DB file; use a backup copy (sqlite3 .backup).
"""
import hashlib, json, sqlite3, sys
from datetime import datetime, timezone

db, out = sys.argv[1], sys.argv[2]
c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
rows = c.execute("""
  SELECT pr.sku, p.code, v.value_numeric, v.value_text, v.unit, cs.code, v.value_status
  FROM engineering_value v
  JOIN engineering_parameter p ON p.parameter_id = v.parameter_id
  -- staged profiles (data_completeness BLOCKED = pending verification) never reach the client engine
  JOIN engineering_product_profile prof ON prof.product_id = v.product_id AND prof.equipment_type = 'FAN_COIL' AND prof.data_completeness <> 'BLOCKED'
  JOIN products pr ON pr.id = v.product_id AND pr.is_active = 1
  LEFT JOIN engineering_condition_set cs ON cs.condition_set_id = v.condition_set_id
  WHERE p.code IN ('water_flow','pressure_drop','pipe_configuration','connection_size','drain_connection','cooling_capacity','heating_capacity')
  ORDER BY pr.sku, p.code, cs.code
""").fetchall()
units = {}
for sku, code, num, text, unit, cond, status in rows:
    if status not in (None, 'KNOWN'):
        continue
    u = units.setdefault(sku, {})
    if code in ('pipe_configuration', 'connection_size'):
        u[code] = text
    elif code == 'drain_connection':
        u['drain_connection_mm'] = num
    else:
        # the engine sizes at maximum fan speed: only HIGH-speed 7/12 and 70/60 points (LOW/MEDIUM or 45/40, 50 °C sets are ignored)
        mode = 'cooling_7_12' if cond and 'COOL' in cond and 'HIGH' in cond and 'W7-12' in cond.replace('7/12', 'W7-12') else (
            'heating_70_60' if cond and 'HEAT' in cond and 'HIGH' in cond and '70' in cond else None)
        if not mode or num is None:
            continue
        point = u.setdefault(mode, {})
        key = {'water_flow': 'flow_m3h', 'pressure_drop': 'dp_kpa', 'cooling_capacity': 'capacity_kw', 'heating_capacity': 'capacity_kw'}[code]
        # several condition sets (ESP0 / ESP50) may exist: keep the first deterministic one
        point.setdefault(key, num)
body = json.dumps(units, ensure_ascii=False, sort_keys=True)
snapshot = {
    'snapshotId': 'ohmx.fan-coil-hydraulics',
    'exportedAt': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
    'source': 'engineering_value (FAN_COIL profiles, value_status KNOWN), read-only DB copy',
    'sha256': hashlib.sha256(body.encode()).hexdigest(),
    'units': units,
}
json.dump(snapshot, open(out, 'w'), ensure_ascii=False, indent=1, sort_keys=True)
print(len(units), 'units', snapshot['sha256'])
