/**
 * Isolated SQLite fixture for CM4 adapter tests. Never opens production electro.db.
 */
import Database from 'better-sqlite3';

export function createCatalogMatcherFixture(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE brands (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT
    );
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      sku TEXT UNIQUE NOT NULL,
      name_ru TEXT NOT NULL,
      brand_id INTEGER,
      price_amd REAL,
      currency TEXT,
      availability_status TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE product_relationships (
      source_product_id INTEGER NOT NULL,
      target_product_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL
    );
    CREATE TABLE engineering_equipment_type (equipment_type TEXT PRIMARY KEY);
    CREATE TABLE engineering_condition_key (
      condition_key TEXT PRIMARY KEY,
      value_type TEXT NOT NULL,
      unit TEXT
    );
    CREATE TABLE engineering_source_type (
      source_type TEXT PRIMARY KEY,
      verification_tier TEXT NOT NULL
    );
    CREATE TABLE engineering_parameter (
      parameter_id INTEGER PRIMARY KEY AUTOINCREMENT,
      equipment_type TEXT NOT NULL,
      code TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      value_type TEXT NOT NULL,
      canonical_unit TEXT,
      requirement_level TEXT NOT NULL,
      UNIQUE (equipment_type, code)
    );
    CREATE TABLE engineering_source (
      source_id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL,
      manufacturer TEXT,
      document_title TEXT,
      document_version TEXT,
      url TEXT
    );
    CREATE TABLE engineering_product_profile (
      product_id INTEGER PRIMARY KEY,
      equipment_type TEXT NOT NULL,
      series TEXT,
      model TEXT,
      identity_status TEXT NOT NULL,
      data_completeness TEXT NOT NULL,
      source_verification TEXT NOT NULL,
      schema_id TEXT NOT NULL,
      schema_version TEXT NOT NULL
    );
    CREATE TABLE engineering_condition_set (
      condition_set_id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE
    );
    CREATE TABLE engineering_condition_entry (
      condition_entry_id INTEGER PRIMARY KEY AUTOINCREMENT,
      condition_set_id INTEGER NOT NULL,
      condition_key TEXT NOT NULL,
      value_numeric REAL,
      value_text TEXT,
      value_boolean INTEGER,
      UNIQUE (condition_set_id, condition_key)
    );
    CREATE TABLE engineering_value (
      value_id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      parameter_id INTEGER NOT NULL,
      value_numeric REAL,
      value_text TEXT,
      value_boolean INTEGER,
      unit TEXT,
      condition_set_id INTEGER,
      source_id INTEGER,
      value_status TEXT NOT NULL,
      confidence REAL
    );
  `);

  db.exec(`
    INSERT INTO brands (id, name, slug) VALUES (1, 'BPS', 'bps'), (2, 'Riello', 'riello'), (3, 'Danfoss', 'danfoss');
    INSERT INTO products (id, sku, name_ru, brand_id, price_amd, currency, availability_status, is_active) VALUES
      (24244, '80022011', 'Фанкойл FC22-OM1 - мощ. охлаждения 2 кВт', 1, 100000, 'AMD', NULL, 1),
      (28761, '20203649', 'Тепловой насос - Riello NXHM - 12 кВт', 2, 200000, 'AMD', NULL, 1),
      (24347, '003Z4004', 'Балансировочный клапан - MSV-BD DN 32', 3, 50000, 'AMD', NULL, 1),
      (25310, '082F1155', 'Термоэлектрический привод - ABN A5', 3, 40000, 'AMD', NULL, 1),
      (24236, '088U1005', 'Термостат комнатный - Danfoss Icon', 3, 30000, 'AMD', NULL, 1);
    INSERT INTO engineering_equipment_type (equipment_type) VALUES
      ('FAN_COIL'), ('HEAT_PUMP'), ('BALANCING_VALVE'), ('ACTUATOR'), ('THERMOSTAT');
    INSERT INTO engineering_source_type (source_type, verification_tier) VALUES
      ('MANUFACTURER_DATASHEET', 'AUTHORITATIVE'),
      ('AUTHORIZED_DISTRIBUTOR', 'VERIFIED_SECONDARY');
    INSERT INTO engineering_condition_key (condition_key, value_type, unit) VALUES
      ('fan_speed', 'TEXT', NULL),
      ('water_in_c', 'NUMERIC', '°C'),
      ('water_out_c', 'NUMERIC', '°C'),
      ('indoor_air_dry_bulb_c', 'NUMERIC', '°C'),
      ('indoor_air_wet_bulb_c', 'NUMERIC', '°C'),
      ('operating_mode', 'TEXT', NULL),
      ('test_standard', 'TEXT', NULL),
      ('water_supply_c', 'NUMERIC', '°C'),
      ('outdoor_air_c', 'NUMERIC', '°C');
  `);

  const insertParam = db.prepare(`
    INSERT INTO engineering_parameter (equipment_type, code, canonical_name, value_type, canonical_unit, requirement_level)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const fcParams: Array<[string, string, string | null, string]> = [
    ['cooling_capacity', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION'],
    ['cooling_capacity_sensible', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION'],
    ['heating_capacity', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION'],
    ['airflow', 'NUMERIC', 'm³/h', 'REQUIRED_FOR_SELECTION'],
    ['water_flow', 'NUMERIC', 'm³/h', 'RECOMMENDED'],
    ['pressure_drop', 'NUMERIC', 'kPa', 'RECOMMENDED'],
    ['fan_power', 'NUMERIC', 'W', 'RECOMMENDED'],
    ['drain_connection', 'NUMERIC', 'mm', 'RECOMMENDED'],
    ['pipe_configuration', 'TEXT', null, 'REQUIRED_FOR_COMPATIBILITY'],
    ['connection_size', 'TEXT', null, 'REQUIRED_FOR_COMPATIBILITY'],
    ['power_supply', 'TEXT', null, 'REQUIRED_FOR_COMPATIBILITY'],
  ];
  for (const [code, vt, unit, level] of fcParams) {
    insertParam.run('FAN_COIL', code, code, vt, unit, level);
  }
  const hpParams: Array<[string, string, string | null, string]> = [
    ['heating_capacity', 'NUMERIC', 'kW', 'REQUIRED_FOR_SELECTION'],
    ['max_water_temperature', 'NUMERIC', '°C', 'REQUIRED_FOR_SELECTION'],
    ['min_water_temperature_cooling', 'NUMERIC', '°C', 'RECOMMENDED'],
    ['scop', 'NUMERIC', null, 'RECOMMENDED'],
    ['sound_power', 'NUMERIC', 'dB(A)', 'RECOMMENDED'],
    ['water_flow_min', 'NUMERIC', 'm³/h', 'RECOMMENDED'],
    ['water_flow_max', 'NUMERIC', 'm³/h', 'RECOMMENDED'],
    ['refrigerant', 'TEXT', null, 'REQUIRED_FOR_COMPATIBILITY'],
    ['weight', 'NUMERIC', 'kg', 'INFORMATIONAL'],
    ['dimensions', 'TEXT', 'mm', 'INFORMATIONAL'],
  ];
  for (const [code, vt, unit, level] of hpParams) {
    insertParam.run('HEAT_PUMP', code, code, vt, unit, level);
  }

  db.prepare(`
    INSERT INTO engineering_source (source_id, source_type, manufacturer, document_title, document_version, url)
    VALUES
      (1, 'AUTHORIZED_DISTRIBUTOR', 'Riello', 'Riello NXHM Datasheet', NULL, 'https://example.invalid/riello'),
      (2, 'MANUFACTURER_DATASHEET', 'BPS Tecnologie (Clima)', 'Technical sheet FC(E)', 'ST_FC_210 8BPS-R00', 'https://example.invalid/bps')
  `).run();

  db.exec(`
    INSERT INTO engineering_product_profile
      (product_id, equipment_type, series, model, identity_status, data_completeness, source_verification, schema_id, schema_version)
    VALUES
      (24244, 'FAN_COIL', 'FC', 'FC22-OM1', 'IDENTIFIED', 'PARTIAL', 'PARTIALLY_VERIFIED', 'ohmx.engineering-product.v1', '1.0.0'),
      (28761, 'HEAT_PUMP', 'NXHM', 'NXHM 12', 'IDENTIFIED', 'BLOCKED', 'PARTIALLY_VERIFIED', 'ohmx.engineering-product.v1', '1.0.0'),
      (24347, 'BALANCING_VALVE', 'MSV-BD', 'MSV-BD DN 32', 'IDENTIFIED', 'COMPLETE', 'UNVERIFIED', 'ohmx.engineering-product.v1', '1.0.0'),
      (25310, 'ACTUATOR', 'ABN', 'ABN A5', 'IDENTIFIED', 'PARTIAL', 'UNVERIFIED', 'ohmx.engineering-product.v1', '1.0.0'),
      (24236, 'THERMOSTAT', 'Icon', 'Danfoss Icon', 'IDENTIFIED', 'BLOCKED', 'UNVERIFIED', 'ohmx.engineering-product.v1', '1.0.0');

    INSERT INTO engineering_condition_set (condition_set_id, code) VALUES
      (1, 'FC22-COOL-HIGH-7/12'),
      (2, 'FC22-HEAT-HIGH-70/60'),
      (3, 'SCOP@35');

    INSERT INTO engineering_condition_entry (condition_set_id, condition_key, value_numeric, value_text, value_boolean) VALUES
      (1, 'fan_speed', NULL, 'HIGH', NULL),
      (1, 'water_in_c', 7, NULL, NULL),
      (1, 'water_out_c', 12, NULL, NULL),
      (1, 'indoor_air_dry_bulb_c', 27, NULL, NULL),
      (1, 'indoor_air_wet_bulb_c', 19, NULL, NULL),
      (1, 'operating_mode', NULL, 'cooling', NULL),
      (1, 'test_standard', NULL, 'EN 1397', NULL),
      (2, 'fan_speed', NULL, 'HIGH', NULL),
      (2, 'water_in_c', 70, NULL, NULL),
      (2, 'water_out_c', 60, NULL, NULL),
      (2, 'indoor_air_dry_bulb_c', 20, NULL, NULL),
      (2, 'operating_mode', NULL, 'heating', NULL),
      (3, 'water_supply_c', 35, NULL, NULL);
  `);

  const paramId = db.prepare('SELECT parameter_id FROM engineering_parameter WHERE equipment_type = ? AND code = ?');
  const insertValue = db.prepare(`
    INSERT INTO engineering_value (product_id, parameter_id, value_numeric, value_text, value_boolean, unit, condition_set_id, source_id, value_status, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'KNOWN', ?)
  `);
  const fc = (code: string) => Number((paramId.get('FAN_COIL', code) as { parameter_id: number }).parameter_id);
  const hp = (code: string) => Number((paramId.get('HEAT_PUMP', code) as { parameter_id: number }).parameter_id);

  insertValue.run(24244, fc('cooling_capacity'), 2.0, null, null, 'kW', 1, 2, 0.95);
  insertValue.run(24244, fc('cooling_capacity_sensible'), 1.62, null, null, 'kW', 1, 2, 0.9);
  insertValue.run(24244, fc('airflow'), 400, null, null, 'm³/h', 1, 2, 0.95);
  insertValue.run(24244, fc('heating_capacity'), 4.91, null, null, 'kW', 2, 2, 0.95);
  insertValue.run(24244, fc('water_flow'), 0.344, null, null, 'm³/h', 1, 2, 0.9);
  insertValue.run(24244, fc('water_flow'), 0.423, null, null, 'm³/h', 2, 2, 0.9);
  insertValue.run(24244, fc('pressure_drop'), 16.3, null, null, 'kPa', 1, 2, 0.9);
  insertValue.run(24244, fc('pressure_drop'), 19.2, null, null, 'kPa', 2, 2, 0.9);
  insertValue.run(24244, fc('fan_power'), 55, null, null, 'W', null, 2, 0.9);
  insertValue.run(24244, fc('drain_connection'), 20, null, null, 'mm', null, 2, 0.9);
  insertValue.run(24244, fc('pipe_configuration'), null, '2-pipe', null, null, null, 2, 0.85);
  insertValue.run(24244, fc('connection_size'), null, '1/2 inch F', null, null, null, 2, 0.95);
  insertValue.run(24244, fc('power_supply'), null, '230/1/50-60', null, null, null, 2, 0.95);

  insertValue.run(28761, hp('max_water_temperature'), 65, null, null, '°C', null, 1, 0.95);
  insertValue.run(28761, hp('min_water_temperature_cooling'), 5, null, null, '°C', null, 1, 0.9);
  insertValue.run(28761, hp('scop'), 4.67, null, null, null, 3, 1, 0.9);
  insertValue.run(28761, hp('sound_power'), 65, null, null, 'dB(A)', null, 1, 0.9);
  insertValue.run(28761, hp('water_flow_min'), 0.7, null, null, 'm³/h', null, 1, 0.85);
  insertValue.run(28761, hp('water_flow_max'), 2.5, null, null, 'm³/h', null, 1, 0.85);
  insertValue.run(28761, hp('refrigerant'), null, 'R32', null, null, null, 1, 0.95);
  insertValue.run(28761, hp('weight'), 144, null, null, 'kg', null, 1, 0.95);
  insertValue.run(28761, hp('dimensions'), null, '945x1385x526', null, 'mm', null, 1, 0.95);

  return db;
}
