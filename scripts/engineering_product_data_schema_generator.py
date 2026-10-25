#!/usr/bin/env python3
"""
OhmX.am — Engineering Product Data Schema v1.1 generator (DESIGN-ONLY, READ-ONLY).

Single source of definitions -> emits three machine artifacts:
  ENGINEERING-PRODUCT-DATA-SCHEMA-V1.sql
  engineering_product_data_schema_v1.json
  engineering_product_data_types_v1.ts

EPD1.1 corrections baked in:
  - is_selection_eligible is DERIVED (removed from the stored model);
  - nominal_size parameter registered (INFORMATIONAL, never a capacity);
  - condition entries support value_boolean with one-of semantics (CHECK);
  - indoor dry-bulb / wet-bulb are canonical (no RH inference as source);
  - source verification tier (AUTHORITATIVE / VERIFIED_SECONDARY / UNVERIFIED);
  - compatibility free-text params are INFORMATIONAL (relationships = SoT);
  - engineering_value: confidence range CHECK + typed one-of CHECK.

Does NOT touch electro.db. DDL is a proposal, never executed.
"""
import json, os, datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.environ.get(
    "OHMX_ENGINEERING_OUTPUT_DIR",
    os.path.join(PROJECT_ROOT, "reports", "engineering-catalog"),
)
os.makedirs(OUT, exist_ok=True)

SCHEMA_ID = "ohmx.engineering-product.v1"
SCHEMA_VERSION = "1.0.0"
RUN_TS = datetime.datetime.utcnow().strftime("%Y-%m-%d")

# ---------------------------------------------------------------------------
# Fixed semantic enums (CHECK-constrained, not extensible without review)
# ---------------------------------------------------------------------------
IDENTITY_STATUS = ["IDENTIFIED", "IDENTITY_PARTIAL", "IDENTITY_UNCERTAIN"]
DATA_COMPLETENESS = ["COMPLETE", "PARTIAL", "BLOCKED"]
SOURCE_VERIFICATION = ["VERIFIED", "PARTIALLY_VERIFIED", "UNVERIFIED"]
VALUE_STATUS = ["KNOWN", "UNKNOWN", "CONFLICT", "REVIEW_REQUIRED"]
REQUIREMENT_LEVEL = ["REQUIRED_FOR_SELECTION", "REQUIRED_FOR_COMPATIBILITY", "RECOMMENDED", "INFORMATIONAL"]
VALUE_TYPE = ["NUMERIC", "TEXT", "BOOLEAN"]
VERIFICATION_TIER = ["AUTHORITATIVE", "VERIFIED_SECONDARY", "UNVERIFIED"]
RELATIONSHIP_TYPES = ["REQUIRED_ACCESSORY", "RECOMMENDED_ACCESSORY", "OPTIONAL_ACCESSORY",
                      "COMPATIBLE_WITH", "ALTERNATIVE_TO", "INCOMPATIBLE_WITH"]

# ---------------------------------------------------------------------------
# Extensible vocabularies (lookup tables: INSERT to extend, no schema change)
# ---------------------------------------------------------------------------
EQUIPMENT_TYPES = [
    ("HEAT_PUMP", "Air-to-water / monobloc / split heat pump"),
    ("FAN_COIL", "Fan coil unit (2-pipe / 4-pipe)"),
    ("CIRCULATION_PUMP", "Circulator / circulation pump"),
    ("BUFFER_TANK", "Buffer / storage tank (incl. tank-in-tank, combi)"),
    ("HYDRAULIC_SEPARATOR", "Hydraulic separator / low-loss header"),
    ("HEAT_EXCHANGER", "Plate / brazed heat exchanger"),
    ("MANIFOLD", "Manifold / distribution header (collector)"),
    ("CONTROL_VALVE", "2/3/4-way control (mixing) valve"),
    ("BALANCING_VALVE", "Balancing / commissioning valve (static, dynamic)"),
    ("ACTUATOR", "Valve actuator (thermal-electric / motorised)"),
    ("THERMOSTAT", "Room / surface thermostat"),
    ("CONTROLLER", "Heating-point / fan-coil controller"),
    ("ACCESSORY", "HVAC accessory / spare part"),
]

CONDITION_KEYS = [
    ("outdoor_air_c", "NUMERIC", "°C", "Outdoor (ambient) air temperature"),
    ("indoor_air_dry_bulb_c", "NUMERIC", "°C", "Indoor air dry-bulb temperature, as stated by source"),
    ("indoor_air_wet_bulb_c", "NUMERIC", "°C", "Indoor air wet-bulb temperature, as stated by source"),
    ("water_in_c", "NUMERIC", "°C", "Water temperature entering the coil/unit"),
    ("water_out_c", "NUMERIC", "°C", "Water temperature leaving the coil/unit"),
    ("water_supply_c", "NUMERIC", "°C", "Water supply temperature (source/supply side)"),
    ("water_return_c", "NUMERIC", "°C", "Water return temperature"),
    ("relative_humidity_pct", "NUMERIC", "%", "Relative humidity — only if EXPLICIT in source (derived RH must be flagged DERIVED)"),
    ("fan_speed", "TEXT", None, "Fan speed: LOW / MEDIUM / HIGH / AUTO / target"),
    ("operating_mode", "TEXT", None, "heating / cooling / dhw"),
    ("frequency_hz", "NUMERIC", "Hz", "Compressor / drive frequency"),
    ("load_percent", "NUMERIC", "%", "Part-load percentage"),
    ("test_standard", "TEXT", None, "Test standard (e.g. EN 14511, ISO 13256)"),
    ("esp_pa", "NUMERIC", "Pa", "External static pressure"),
]

# (code, verification_tier, description)
SOURCE_TYPES = [
    ("MANUFACTURER_DATASHEET", "AUTHORITATIVE", "Official manufacturer datasheet"),
    ("MANUFACTURER_MANUAL", "AUTHORITATIVE", "Official installation/owner manual"),
    ("MANUFACTURER_WEBSITE", "AUTHORITATIVE", "Official manufacturer website"),
    ("AUTHORIZED_DISTRIBUTOR", "VERIFIED_SECONDARY",
     "Authorized distributor document; professional use only if a verbatim re-host of the official manufacturer document"),
    ("MANUAL_VERIFICATION", "VERIFIED_SECONDARY",
     "Manually verified by a qualified engineer; professional use only with audited_at + document reference"),
    ("EXISTING_STRUCTURED_ATTRIBUTE", "UNVERIFIED", "Structured attribute already in DB"),
    ("PRODUCT_DESCRIPTION", "UNVERIFIED", "Free-text product description/card"),
    ("LEGACY_IMPORT", "UNVERIFIED", "Imported legacy value (not independently verified)"),
    ("UNKNOWN", "UNVERIFIED", "Unknown provenance"),
]

# ---------------------------------------------------------------------------
# Parameter registry (per equipment type). value_type: NUMERIC/TEXT/BOOLEAN
# ---------------------------------------------------------------------------
def P(code, name, vt, unit, req, desc=""):
    return {"code": code, "name": name, "value_type": vt, "unit": unit,
            "requirement_level": req, "description": desc}

PARAMETERS = {
 "HEAT_PUMP": [
   P("heating_capacity", "Heating capacity", "NUMERIC", "kW", "REQUIRED_FOR_SELECTION", "At a stated operating point (A7/W35, A2/W35, ...)"),
   P("cooling_capacity", "Cooling capacity", "NUMERIC", "kW", "REQUIRED_FOR_SELECTION", "Total cooling at a stated operating point"),
   P("cop", "Coefficient of performance (heating)", "NUMERIC", None, "REQUIRED_FOR_SELECTION"),
   P("eer", "Energy efficiency ratio (cooling)", "NUMERIC", None, "REQUIRED_FOR_SELECTION"),
   P("scop", "Seasonal coefficient of performance", "NUMERIC", None, "RECOMMENDED"),
   P("seer", "Seasonal energy efficiency ratio", "NUMERIC", None, "RECOMMENDED"),
   P("electrical_input", "Electrical input power", "NUMERIC", "kW", "REQUIRED_FOR_SELECTION"),
   P("electrical_input_current", "Electrical input current", "NUMERIC", "A", "RECOMMENDED"),
   P("max_water_temperature", "Maximum water temperature", "NUMERIC", "°C", "REQUIRED_FOR_SELECTION"),
   P("min_water_temperature_cooling", "Minimum water temperature (cooling)", "NUMERIC", "°C", "RECOMMENDED"),
   P("operating_outdoor_min", "Minimum outdoor operating temp", "NUMERIC", "°C", "REQUIRED_FOR_SELECTION"),
   P("operating_outdoor_max", "Maximum outdoor operating temp", "NUMERIC", "°C", "REQUIRED_FOR_SELECTION"),
   P("water_flow", "Water flow rate", "NUMERIC", "m³/h", "RECOMMENDED"),
   P("water_flow_min", "Minimum water flow rate", "NUMERIC", "m³/h", "RECOMMENDED", "Unit operating limit (minimum flow)"),
   P("water_flow_max", "Maximum water flow rate", "NUMERIC", "m³/h", "RECOMMENDED", "Unit operating limit (maximum flow)"),
   P("available_head", "Available external head", "NUMERIC", "kPa", "RECOMMENDED"),
   P("pressure_drop", "Water-side pressure drop", "NUMERIC", "kPa", "RECOMMENDED"),
   P("sound_power", "Sound power level (Lw)", "NUMERIC", "dB(A)", "RECOMMENDED"),
   P("sound_pressure", "Sound pressure level (Lp @ distance)", "NUMERIC", "dB(A)", "INFORMATIONAL"),
   P("refrigerant", "Refrigerant", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("power_supply", "Power supply (V/Ph/Hz)", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("phase_count", "Number of phases", "NUMERIC", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("capacity_modulation_min", "Minimum modulated capacity", "NUMERIC", "kW", "RECOMMENDED"),
   P("capacity_modulation_max", "Maximum modulated capacity", "NUMERIC", "kW", "RECOMMENDED"),
   P("hydraulic_connection_size", "Hydraulic connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("integrated_pump", "Integrated circulation pump", "BOOLEAN", None, "RECOMMENDED"),
   P("backup_heater", "Backup heater power", "NUMERIC", "kW", "RECOMMENDED"),
   P("dhw_support", "Domestic hot water support", "BOOLEAN", None, "RECOMMENDED"),
   P("weight", "Weight", "NUMERIC", "kg", "INFORMATIONAL"),
   P("dimensions", "Dimensions (HxWxD)", "TEXT", "mm", "INFORMATIONAL"),
 ],
 "FAN_COIL": [
   P("cooling_capacity", "Cooling capacity (total)", "NUMERIC", "kW", "REQUIRED_FOR_SELECTION"),
   P("cooling_capacity_sensible", "Cooling capacity (sensible)", "NUMERIC", "kW", "REQUIRED_FOR_SELECTION"),
   P("heating_capacity", "Heating capacity", "NUMERIC", "kW", "REQUIRED_FOR_SELECTION"),
   P("airflow", "Airflow", "NUMERIC", "m³/h", "REQUIRED_FOR_SELECTION"),
   P("water_flow", "Water flow rate", "NUMERIC", "m³/h", "RECOMMENDED"),
   P("pressure_drop", "Water-side pressure drop", "NUMERIC", "kPa", "RECOMMENDED"),
   P("fan_power", "Fan electrical power", "NUMERIC", "W", "RECOMMENDED"),
   P("fan_current", "Fan electrical current", "NUMERIC", "A", "INFORMATIONAL"),
   P("sound_pressure", "Sound pressure level (Lp)", "NUMERIC", "dB(A)", "RECOMMENDED"),
   P("sound_power", "Sound power level (Lw)", "NUMERIC", "dB(A)", "RECOMMENDED"),
   P("pipe_configuration", "Pipe configuration", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY", "2-pipe / 4-pipe"),
   P("connection_size", "Water connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("drain_connection", "Drain connection diameter", "NUMERIC", "mm", "RECOMMENDED"),
   P("power_supply", "Power supply (V/Ph/Hz)", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("phase_count", "Number of phases", "NUMERIC", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("mounting_type", "Mounting type", "TEXT", None, "INFORMATIONAL"),
   P("coil_water_volume", "Coil water volume", "NUMERIC", "L", "INFORMATIONAL"),
   P("weight", "Weight", "NUMERIC", "kg", "INFORMATIONAL"),
   P("dimensions", "Dimensions (LxSxH)", "TEXT", "mm", "INFORMATIONAL"),
 ],
 "CIRCULATION_PUMP": [
   P("max_head", "Maximum head", "NUMERIC", "m", "REQUIRED_FOR_SELECTION"),
   P("max_flow", "Maximum flow", "NUMERIC", "m³/h", "REQUIRED_FOR_SELECTION"),
   P("pump_curve", "Pump curve reference", "TEXT", None, "REQUIRED_FOR_SELECTION", "Named Q/H curve key; scalar limitation documented"),
   P("connection_size", "Connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("power_supply", "Power supply (V/Ph/Hz)", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("phase_count", "Number of phases", "NUMERIC", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("electrical_power", "Electrical power", "NUMERIC", "W", "RECOMMENDED"),
   P("speed_control", "Speed control", "TEXT", None, "RECOMMENDED"),
   P("max_working_pressure", "Maximum working pressure", "NUMERIC", "kPa", "RECOMMENDED"),
   P("medium_temperature_min", "Minimum fluid temperature", "NUMERIC", "°C", "RECOMMENDED"),
   P("medium_temperature_max", "Maximum fluid temperature", "NUMERIC", "°C", "RECOMMENDED"),
   P("protection_class", "Protection class (IP)", "TEXT", None, "RECOMMENDED"),
 ],
 "BUFFER_TANK": [
   P("volume", "Nominal volume", "NUMERIC", "L", "REQUIRED_FOR_SELECTION"),
   P("capacity", "Heat-exchanger capacity", "NUMERIC", "kW", "RECOMMENDED"),
   P("max_pressure", "Maximum working pressure", "NUMERIC", "bar", "REQUIRED_FOR_COMPATIBILITY"),
   P("max_temperature", "Maximum temperature", "NUMERIC", "°C", "REQUIRED_FOR_SELECTION"),
   P("connection_size", "Connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("insulation", "Insulation", "BOOLEAN", None, "RECOMMENDED"),
   P("material", "Material", "TEXT", None, "INFORMATIONAL"),
 ],
 "HYDRAULIC_SEPARATOR": [
   P("capacity", "Capacity", "NUMERIC", "kW", "REQUIRED_FOR_SELECTION"),
   P("connection_size", "Connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("max_pressure", "Maximum working pressure", "NUMERIC", "bar", "REQUIRED_FOR_COMPATIBILITY"),
   P("max_temperature", "Maximum temperature", "NUMERIC", "°C", "REQUIRED_FOR_SELECTION"),
 ],
 "HEAT_EXCHANGER": [
   P("capacity", "Capacity", "NUMERIC", "kW", "REQUIRED_FOR_SELECTION"),
   P("number_of_plates", "Number of plates", "NUMERIC", None, "RECOMMENDED"),
   P("max_pressure", "Maximum working pressure", "NUMERIC", "bar", "REQUIRED_FOR_COMPATIBILITY"),
   P("max_temperature", "Maximum temperature", "NUMERIC", "°C", "REQUIRED_FOR_SELECTION"),
   P("connection_size", "Connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("plate_material", "Plate material", "TEXT", None, "INFORMATIONAL"),
 ],
 "MANIFOLD": [
   P("number_of_circuits", "Number of circuits", "NUMERIC", None, "REQUIRED_FOR_SELECTION"),
   P("connection_size", "Connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("max_pressure", "Maximum working pressure", "NUMERIC", "bar", "RECOMMENDED"),
   P("max_temperature", "Maximum temperature", "NUMERIC", "°C", "RECOMMENDED"),
   P("flow_meter", "Flow meters included", "BOOLEAN", None, "RECOMMENDED"),
   P("material", "Material", "TEXT", None, "INFORMATIONAL"),
 ],
 "CONTROL_VALVE": [
   P("kvs", "Flow coefficient (Kvs)", "NUMERIC", "m³/h", "REQUIRED_FOR_SELECTION"),
   P("dn", "Nominal diameter (DN)", "NUMERIC", "mm", "REQUIRED_FOR_COMPATIBILITY"),
   P("number_of_ports", "Number of ports", "NUMERIC", None, "REQUIRED_FOR_SELECTION"),
   P("pressure_rating", "Pressure rating (PN)", "NUMERIC", "bar", "REQUIRED_FOR_COMPATIBILITY"),
   P("max_pressure_drop", "Maximum pressure drop", "NUMERIC", "kPa", "REQUIRED_FOR_COMPATIBILITY"),
   P("media_temperature_min", "Minimum medium temperature", "NUMERIC", "°C", "RECOMMENDED"),
   P("media_temperature_max", "Maximum medium temperature", "NUMERIC", "°C", "RECOMMENDED"),
   P("valve_characteristic", "Valve control characteristic", "TEXT", None, "RECOMMENDED"),
   P("connection_size", "Connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("stroke", "Stroke", "NUMERIC", "mm", "RECOMMENDED"),
 ],
 "BALANCING_VALVE": [
   P("kvs", "Flow coefficient (Kvs)", "NUMERIC", "m³/h", "REQUIRED_FOR_SELECTION"),
   P("dn", "Nominal diameter (DN)", "NUMERIC", "mm", "REQUIRED_FOR_COMPATIBILITY"),
   P("pressure_rating", "Pressure rating (PN)", "NUMERIC", "bar", "REQUIRED_FOR_COMPATIBILITY"),
   P("max_pressure_drop", "Maximum pressure drop", "NUMERIC", "kPa", "RECOMMENDED"),
   P("media_temperature_min", "Minimum medium temperature", "NUMERIC", "°C", "RECOMMENDED"),
   P("media_temperature_max", "Maximum medium temperature", "NUMERIC", "°C", "RECOMMENDED"),
   P("flow_range", "Flow range", "TEXT", "m³/h", "RECOMMENDED"),
   P("connection_size", "Connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
 ],
 "ACTUATOR": [
   P("control_signal", "Control signal", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY", "on/off | 0-10V | 3-point"),
   P("supply_voltage", "Supply voltage", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("phase_count", "Number of phases", "NUMERIC", None, "RECOMMENDED"),
   P("torque", "Torque", "NUMERIC", "Nm", "REQUIRED_FOR_COMPATIBILITY"),
   P("stroke", "Stroke", "NUMERIC", "mm", "REQUIRED_FOR_COMPATIBILITY"),
   P("running_time", "Running time (full stroke)", "NUMERIC", "s", "RECOMMENDED"),
   P("fail_safe", "Fail-safe / spring return", "BOOLEAN", None, "RECOMMENDED"),
   P("compatible_valves", "Compatible valve series (legacy hint)", "TEXT", None, "INFORMATIONAL",
     "NOT authoritative; relationships are the compatibility source of truth"),
 ],
 "THERMOSTAT": [
   P("control_type", "Control type", "TEXT", None, "REQUIRED_FOR_SELECTION", "on/off | PI | modulating"),
   P("supply_voltage", "Supply voltage", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("max_load", "Maximum switching load", "NUMERIC", "A", "REQUIRED_FOR_COMPATIBILITY"),
   P("sensor_type", "Sensor type", "TEXT", None, "RECOMMENDED"),
   P("communication", "Communication", "TEXT", None, "RECOMMENDED"),
   P("mounting", "Mounting", "TEXT", None, "INFORMATIONAL"),
   P("setpoint_min", "Minimum setpoint", "NUMERIC", "°C", "INFORMATIONAL"),
   P("setpoint_max", "Maximum setpoint", "NUMERIC", "°C", "INFORMATIONAL"),
 ],
 "CONTROLLER": [
   P("input_types", "Input types", "TEXT", None, "REQUIRED_FOR_SELECTION"),
   P("output_types", "Output types", "TEXT", None, "REQUIRED_FOR_SELECTION"),
   P("communication_protocol", "Communication protocol", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("control_algorithms", "Control algorithms", "TEXT", None, "RECOMMENDED"),
   P("supply_voltage", "Supply voltage", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
 ],
 "ACCESSORY": [
   P("accessory_role", "Accessory role", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("connection_size", "Connection size", "TEXT", None, "REQUIRED_FOR_COMPATIBILITY"),
   P("compatible_equipment", "Compatible equipment (legacy hint)", "TEXT", None, "INFORMATIONAL",
     "NOT authoritative; relationships are the compatibility source of truth"),
 ],
}

# Universal INFORMATIONAL identification parameter (never a selection capacity)
for _et in PARAMETERS:
    PARAMETERS[_et].append(P(
        "nominal_size", "Nominal model size designation", "TEXT", None, "INFORMATIONAL",
        "Commercial/model nominal designation for identification; NEVER a verified capacity"))

# ---------------------------------------------------------------------------
# Emitters
# ---------------------------------------------------------------------------
def emit_sql():
    L = []
    A = L.append
    A("-- ============================================================================")
    A("-- OhmX.am — Engineering Product Data Schema v1.1  (DDL PROPOSAL — DESIGN ONLY)")
    A("-- Schema ID: %s   Version: %s" % (SCHEMA_ID, SCHEMA_VERSION))
    A("-- Generated: %s   (NEVER executed; additive layer, ecommerce tables untouched)" % RUN_TS)
    A("-- Seed vocabularies live in engineering_product_data_schema_v1.json (not here).")
    A("-- is_selection_eligible is DERIVED at query time, NOT stored.")
    A("-- ============================================================================")
    A("")
    A("-- 1. Extensible vocabularies ------------------------------------------------")
    A("CREATE TABLE IF NOT EXISTS engineering_equipment_type (")
    A("  equipment_type TEXT PRIMARY KEY,")
    A("  description    TEXT")
    A(");")
    A("")
    A("CREATE TABLE IF NOT EXISTS engineering_condition_key (")
    A("  condition_key TEXT PRIMARY KEY,")
    A("  value_type    TEXT NOT NULL CHECK (value_type IN ('NUMERIC','TEXT','BOOLEAN')),")
    A("  unit          TEXT,")
    A("  description   TEXT")
    A(");")
    A("")
    A("CREATE TABLE IF NOT EXISTS engineering_source_type (")
    A("  source_type      TEXT PRIMARY KEY,")
    A("  verification_tier TEXT NOT NULL CHECK (verification_tier IN ('AUTHORITATIVE','VERIFIED_SECONDARY','UNVERIFIED')),")
    A("  description      TEXT")
    A(");")
    A("")
    A("CREATE TABLE IF NOT EXISTS engineering_parameter (")
    A("  parameter_id      INTEGER PRIMARY KEY AUTOINCREMENT,")
    A("  equipment_type    TEXT NOT NULL REFERENCES engineering_equipment_type(equipment_type),")
    A("  code              TEXT NOT NULL,")
    A("  canonical_name    TEXT NOT NULL,")
    A("  value_type        TEXT NOT NULL CHECK (value_type IN ('NUMERIC','TEXT','BOOLEAN')),")
    A("  canonical_unit    TEXT,")
    A("  requirement_level TEXT NOT NULL CHECK (requirement_level IN ('REQUIRED_FOR_SELECTION','REQUIRED_FOR_COMPATIBILITY','RECOMMENDED','INFORMATIONAL')),")
    A("  description       TEXT,")
    A("  UNIQUE (equipment_type, code)")
    A(");")
    A("")
    A("-- 2. Provenance --------------------------------------------------------------")
    A("CREATE TABLE IF NOT EXISTS engineering_source (")
    A("  source_id        INTEGER PRIMARY KEY AUTOINCREMENT,")
    A("  source_type      TEXT NOT NULL REFERENCES engineering_source_type(source_type),")
    A("  manufacturer     TEXT,")
    A("  document_title   TEXT,")
    A("  document_version TEXT,")
    A("  url              TEXT,")
    A("  page             TEXT,")
    A("  table_name       TEXT,")
    A("  retrieved_at     TEXT,")
    A("  audited_at       TEXT,")
    A("  notes            TEXT")
    A(");")
    A("")
    A("-- 3. Product engineering profile -------------------------------------------")
    A("CREATE TABLE IF NOT EXISTS engineering_product_profile (")
    A("  product_id          INTEGER PRIMARY KEY REFERENCES products(id),")
    A("  equipment_type      TEXT NOT NULL REFERENCES engineering_equipment_type(equipment_type),")
    A("  series              TEXT,")
    A("  model               TEXT,")
    A("  identity_status     TEXT NOT NULL DEFAULT 'IDENTITY_UNCERTAIN'")
    A("                      CHECK (identity_status IN ('IDENTIFIED','IDENTITY_PARTIAL','IDENTITY_UNCERTAIN')),")
    A("  data_completeness   TEXT NOT NULL DEFAULT 'BLOCKED'")
    A("                      CHECK (data_completeness IN ('COMPLETE','PARTIAL','BLOCKED')),")
    A("  source_verification TEXT NOT NULL DEFAULT 'UNVERIFIED'")
    A("                      CHECK (source_verification IN ('VERIFIED','PARTIALLY_VERIFIED','UNVERIFIED')),")
    A("  schema_id           TEXT NOT NULL DEFAULT '%s'," % SCHEMA_ID)
    A("  schema_version      TEXT NOT NULL DEFAULT '%s'," % SCHEMA_VERSION)
    A("  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,")
    A("  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
    A(");")
    A("")
    A("-- 4. Test-condition model ---------------------------------------------------")
    A("CREATE TABLE IF NOT EXISTS engineering_condition_set (")
    A("  condition_set_id INTEGER PRIMARY KEY AUTOINCREMENT,")
    A("  code             TEXT NOT NULL UNIQUE,  -- e.g. 'A7/W35', 'FC22-COOL-HIGH-7/12'")
    A("  description      TEXT,")
    A("  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")
    A(");")
    A("")
    A("CREATE TABLE IF NOT EXISTS engineering_condition_entry (")
    A("  condition_entry_id INTEGER PRIMARY KEY AUTOINCREMENT,")
    A("  condition_set_id   INTEGER NOT NULL REFERENCES engineering_condition_set(condition_set_id),")
    A("  condition_key      TEXT NOT NULL REFERENCES engineering_condition_key(condition_key),")
    A("  value_numeric      REAL,")
    A("  value_text         TEXT,")
    A("  value_boolean      INTEGER CHECK (value_boolean IN (0,1)),")
    A("  UNIQUE (condition_set_id, condition_key),")
    A("  -- one-of-value semantics: exactly one typed value must be present")
    A("  CHECK ((value_numeric IS NOT NULL) + (value_text IS NOT NULL) + (value_boolean IS NOT NULL) = 1)")
    A(");")
    A("")
    A("-- 5. Engineering values ------------------------------------------------------")
    A("CREATE TABLE IF NOT EXISTS engineering_value (")
    A("  value_id         INTEGER PRIMARY KEY AUTOINCREMENT,")
    A("  product_id       INTEGER NOT NULL REFERENCES products(id),")
    A("  parameter_id     INTEGER NOT NULL REFERENCES engineering_parameter(parameter_id),")
    A("  value_numeric    REAL,")
    A("  value_text       TEXT,")
    A("  value_boolean    INTEGER CHECK (value_boolean IN (0,1)),")
    A("  unit             TEXT,")
    A("  condition_set_id INTEGER REFERENCES engineering_condition_set(condition_set_id),")
    A("  source_id        INTEGER REFERENCES engineering_source(source_id),")
    A("  value_status     TEXT NOT NULL DEFAULT 'KNOWN'")
    A("                   CHECK (value_status IN ('KNOWN','UNKNOWN','CONFLICT','REVIEW_REQUIRED')),")
    A("  confidence       REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),")
    A("  created_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,")
    A("  updated_at       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,")
    A("  -- UNKNOWN => all three typed values NULL; otherwise exactly one typed value")
    A("  CHECK (")
    A("    (value_status = 'UNKNOWN' AND value_numeric IS NULL AND value_text IS NULL AND value_boolean IS NULL)")
    A("    OR")
    A("    (value_status <> 'UNKNOWN' AND (value_numeric IS NOT NULL) + (value_text IS NOT NULL) + (value_boolean IS NOT NULL) = 1)")
    A("  )")
    A(");")
    A("")
    A("-- 6. Indexes for the future matcher ------------------------------------------")
    A("CREATE INDEX IF NOT EXISTS idx_ep_value_product     ON engineering_value(product_id);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_value_parameter   ON engineering_value(parameter_id);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_value_numeric     ON engineering_value(parameter_id, value_numeric);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_value_condition   ON engineering_value(condition_set_id);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_value_source      ON engineering_value(source_id);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_value_status      ON engineering_value(value_status);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_value_composite   ON engineering_value(product_id, parameter_id, condition_set_id);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_profile_type      ON engineering_product_profile(equipment_type);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_profile_readiness ON engineering_product_profile(identity_status, data_completeness, source_verification);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_param_type        ON engineering_parameter(equipment_type);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_cond_entry_set    ON engineering_condition_entry(condition_set_id);")
    A("CREATE INDEX IF NOT EXISTS idx_ep_source_type       ON engineering_source(source_type);")
    A("")
    A("-- Compatibility foundation: reuse existing product_relationships / relationship_rules.")
    A("-- COMPATIBILITY_SOURCE_OF_TRUTH = RELATIONSHIP_LAYER (product_relationships).")
    A("-- Free-text compatible_* parameters are INFORMATIONAL legacy hints only.")
    A("-- product_relationships.relation_type CHECK lacks COMPATIBLE_WITH -> deferred one-line ALTER.")
    A("")
    return "\n".join(L) + "\n"

def emit_json():
    params_flat = []
    for et, plist in PARAMETERS.items():
        for p in plist:
            params_flat.append({"equipment_type": et, **p})
    doc = {
        "schema_id": SCHEMA_ID,
        "schema_version": SCHEMA_VERSION,
        "generated_at": RUN_TS,
        "generated_by": "Hermes — Engineering Catalog EPD1.1 correction pass",
        "scope": "Normalized layer between `products` and the future Catalog Matcher. Design-only; no migration.",
        "selection_eligibility_stored": "NO",
        "selection_eligibility_derived": "YES",
        "compatibility_source_of_truth": "RELATIONSHIP_LAYER",
        "canonical_unit_policy": {
            "thermal_power": "kW",
            "electric_power": "W (fan motor, actuator, auxiliary); electrical_input of heat pump in kW",
            "temperature": "°C",
            "flow": "m³/h",
            "pressure_drop_and_head": "kPa",
            "pressure_rating_and_static_pressure": "bar",
            "sound": "dB(A) — sound_power (Lw) and sound_pressure (Lp) are DISTINCT parameters",
            "dimensions": "mm",
            "mass": "kg",
            "psychrometric": "indoor_air_dry_bulb_c / indoor_air_wet_bulb_c are canonical; relative_humidity_pct only if EXPLICIT in source",
            "note": "total cooling and sensible cooling are DISTINCT parameters; nominal_size is INFORMATIONAL only",
        },
        "enums": {
            "identity_status": IDENTITY_STATUS,
            "data_completeness": DATA_COMPLETENESS,
            "source_verification": SOURCE_VERIFICATION,
            "verification_tier": VERIFICATION_TIER,
            "value_status": VALUE_STATUS,
            "requirement_level": REQUIREMENT_LEVEL,
            "value_type": VALUE_TYPE,
            "relationship_types": RELATIONSHIP_TYPES,
        },
        "equipment_types": [{"code": c, "description": d} for c, d in EQUIPMENT_TYPES],
        "condition_keys": [{"key": k, "value_type": vt, "unit": u, "description": d} for k, vt, u, d in CONDITION_KEYS],
        "source_verification_policy": {
            "PRELIMINARY_SELECTION": {
                "requires": "data_completeness in (COMPLETE, PARTIAL) AND value_status = KNOWN",
                "source_requirement": "none — value present on card is sufficient for preliminary",
            },
            "PROFESSIONAL_SELECTION": {
                "requires": "PRELIMINARY_SELECTION AND source verification_tier in (AUTHORITATIVE, VERIFIED_SECONDARY)",
                "authoritative_types": ["MANUFACTURER_DATASHEET", "MANUFACTURER_MANUAL", "MANUFACTURER_WEBSITE"],
                "verified_secondary_types": ["AUTHORIZED_DISTRIBUTOR", "MANUAL_VERIFICATION"],
                "verified_secondary_conditions": [
                    "AUTHORIZED_DISTRIBUTOR: accepted only when the document is a verbatim re-host of the official manufacturer document and identifies manufacturer + document id",
                    "MANUAL_VERIFICATION: accepted only when recorded by a qualified engineer with audited_at and a document reference (never standalone)",
                ],
                "not_sufficient": ["PRODUCT_DESCRIPTION", "EXISTING_STRUCTURED_ATTRIBUTE", "LEGACY_IMPORT", "UNKNOWN"],
            },
        },
        "source_types": [{"code": c, "verification_tier": t, "description": d} for c, t, d in SOURCE_TYPES],
        "parameters": params_flat,
        "tables": [
            {"name": "engineering_equipment_type", "purpose": "Extensible equipment-type vocabulary"},
            {"name": "engineering_parameter", "purpose": "Controlled parameter registry (per equipment type)"},
            {"name": "engineering_condition_key", "purpose": "Controlled test-condition key vocabulary"},
            {"name": "engineering_source_type", "purpose": "Controlled source-type vocabulary + verification tier"},
            {"name": "engineering_source", "purpose": "Document provenance for each value"},
            {"name": "engineering_product_profile", "purpose": "Links product -> engineering identity + readiness"},
            {"name": "engineering_condition_set", "purpose": "Named operating point (e.g. A7/W35)"},
            {"name": "engineering_condition_entry", "purpose": "Key/value pairs of a set (one-of typed value, incl. value_boolean)"},
            {"name": "engineering_value", "purpose": "One (parameter, value, condition, source) fact; eligibility DERIVED"},
        ],
        "selection_eligibility_derivation": {
            "inputs": ["identity_status", "data_completeness", "value_status", "source_verification", "requirement_level", "selection_policy_version"],
            "PRELIMINARY_SELECTION": "data_completeness in (COMPLETE, PARTIAL) AND value_status = KNOWN AND identity_status <> IDENTITY_UNCERTAIN",
            "PROFESSIONAL_SELECTION": "PRELIMINARY_SELECTION AND value's source verification_tier in (AUTHORITATIVE, VERIFIED_SECONDARY)",
            "note": "derived at query time; never persisted as a boolean flag",
        },
        "typed_value_semantics": {
            "engineering_value": "UNKNOWN => all three typed values NULL; otherwise exactly one of value_numeric / value_text / value_boolean",
            "engineering_condition_entry": "exactly one of value_numeric / value_text / value_boolean",
            "confidence": "NULL or in [0.0, 1.0]",
        },
    }
    return json.dumps(doc, ensure_ascii=False, indent=2)

def emit_ts():
    L = []
    A = L.append
    A("// OhmX.am — Engineering Product Data domain contract v1.1 (DESIGN ONLY, not imported into production)")
    A("// Schema ID: %s   Version: %s   Generated: %s" % (SCHEMA_ID, SCHEMA_VERSION, RUN_TS))
    A("// NOTE: selection eligibility is DERIVED, not stored; see EngineeringSelectionEligibility.")
    A("")
    A("// ---- Fixed semantic enums ----")
    for name, vals in [("IdentityStatus", IDENTITY_STATUS), ("DataCompleteness", DATA_COMPLETENESS),
                       ("SourceVerification", SOURCE_VERIFICATION), ("ValueStatus", VALUE_STATUS),
                       ("RequirementLevel", REQUIREMENT_LEVEL), ("ValueType", VALUE_TYPE),
                       ("VerificationTier", VERIFICATION_TIER)]:
        A("export type %s = %s;" % (name, " | ".join("'%s'" % v for v in vals)))
    A("")
    A("// ---- Extensible vocabularies (string-literal unions generated from seed) ----")
    A("export type EquipmentType = %s;" % " | ".join("'%s'" % c for c, _ in EQUIPMENT_TYPES))
    A("export type ConditionKey = %s;" % " | ".join("'%s'" % k for k, _, _, _ in CONDITION_KEYS))
    A("export type SourceType = %s;" % " | ".join("'%s'" % c for c, _, _ in SOURCE_TYPES))
    A("")
    codes = sorted({p["code"] for pl in PARAMETERS.values() for p in pl})
    A("export type ParameterCode =")
    for c in codes:
        A("  | '%s'" % c)
    A("  ;")
    A("")
    A("export type RelationshipType = 'REQUIRED_ACCESSORY' | 'RECOMMENDED_ACCESSORY' | 'OPTIONAL_ACCESSORY' | 'COMPATIBLE_WITH' | 'ALTERNATIVE_TO' | 'INCOMPATIBLE_WITH';")
    A("")
    A("// ---- Entity interfaces ----")
    A("export interface EquipmentTypeDef { code: EquipmentType; description: string }")
    A("export interface ParameterDef {")
    A("  equipment_type: EquipmentType; code: ParameterCode; canonical_name: string;")
    A("  value_type: ValueType; canonical_unit: string | null;")
    A("  requirement_level: RequirementLevel; description: string;")
    A("}")
    A("export interface ConditionKeyDef { key: ConditionKey; value_type: ValueType; unit: string | null; description: string }")
    A("export interface SourceTypeDef { code: SourceType; verification_tier: VerificationTier; description: string }")
    A("")
    A("export interface EngineeringSource {")
    A("  source_id: number; source_type: SourceType; manufacturer: string | null;")
    A("  document_title: string | null; document_version: string | null; url: string | null;")
    A("  page: string | null; table_name: string | null; retrieved_at: string | null;")
    A("  audited_at: string | null; notes: string | null;")
    A("}")
    A("export interface EngineeringConditionSet { condition_set_id: number; code: string; description: string | null }")
    A("export interface EngineeringConditionEntry {")
    A("  condition_entry_id: number; condition_set_id: number; condition_key: ConditionKey;")
    A("  // one-of: exactly one of the following three is non-null")
    A("  value_numeric: number | null; value_text: string | null; value_boolean: boolean | null;")
    A("}")
    A("export interface EngineeringProductProfile {")
    A("  product_id: number; equipment_type: EquipmentType; series: string | null; model: string | null;")
    A("  identity_status: IdentityStatus; data_completeness: DataCompleteness; source_verification: SourceVerification;")
    A("  schema_id: string; schema_version: string;")
    A("}")
    A("export interface EngineeringValue {")
    A("  value_id: number; product_id: number; parameter_id: number;")
    A("  // one-of: when value_status = 'UNKNOWN' all three are null; otherwise exactly one is non-null")
    A("  value_numeric: number | null; value_text: string | null; value_boolean: boolean | null;")
    A("  unit: string | null; condition_set_id: number | null; source_id: number | null;")
    A("  value_status: ValueStatus; confidence: number | null;")
    A("}")
    A("")
    A("// ---- Derived (NOT stored) selection eligibility ----")
    A("export type SelectionEligibility = 'NOT_ELIGIBLE' | 'PRELIMINARY_SELECTION' | 'PROFESSIONAL_SELECTION';")
    A("export interface SelectionEligibilityInput {")
    A("  identity_status: IdentityStatus; data_completeness: DataCompleteness;")
    A("  value_status: ValueStatus; source_verification: SourceVerification;")
    A("  requirement_level: RequirementLevel; selection_policy_version: string;")
    A("}")
    A("export function deriveSelectionEligibility(i: SelectionEligibilityInput): SelectionEligibility {")
    A("  if (i.value_status !== 'KNOWN') return 'NOT_ELIGIBLE';")
    A("  if (i.identity_status === 'IDENTITY_UNCERTAIN') return 'NOT_ELIGIBLE';")
    A("  if (i.data_completeness === 'BLOCKED') return 'NOT_ELIGIBLE';")
    A("  const preliminary = i.data_completeness === 'COMPLETE' || i.data_completeness === 'PARTIAL';")
    A("  if (!preliminary) return 'NOT_ELIGIBLE';")
    A("  const professional = (i.source_verification === 'VERIFIED' || i.source_verification === 'PARTIALLY_VERIFIED');")
    A("  return professional ? 'PROFESSIONAL_SELECTION' : 'PRELIMINARY_SELECTION';")
    A("}")
    return "\n".join(L) + "\n"

if __name__ == "__main__":
    open(os.path.join(OUT, "ENGINEERING-PRODUCT-DATA-SCHEMA-V1.sql"), "w", encoding="utf-8").write(emit_sql())
    open(os.path.join(OUT, "engineering_product_data_schema_v1.json"), "w", encoding="utf-8").write(emit_json())
    open(os.path.join(OUT, "engineering_product_data_types_v1.ts"), "w", encoding="utf-8").write(emit_ts())
    total_params = sum(len(v) for v in PARAMETERS.values())
    total_codes = len({p["code"] for pl in PARAMETERS.values() for p in pl})
    print(f"emitted 3 artifacts; equipment_types={len(EQUIPMENT_TYPES)} "
          f"param_rows={total_params} unique_param_codes={total_codes} "
          f"condition_keys={len(CONDITION_KEYS)} source_types={len(SOURCE_TYPES)}")