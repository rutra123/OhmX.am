#!/usr/bin/env python3
"""
OhmX.am — Engineering Catalog Audit generator (READ-ONLY).

Produces the audit artifacts in reports/engineering-catalog/:
  engineering_catalog_schema.json
  engineering_catalog_audit.csv
  engineering_catalog_missing_fields.csv
  engineering_catalog_identity_uncertain.csv
  engineering_catalog_source_provenance.csv
  engineering_catalog_enrichment_candidates.csv (base, no web data)

Does NOT modify the production database. Read-only sqlite3 access.
"""
import sqlite3, csv, json, re, os, sys, datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get("OHMX_DB_PATH", str(PROJECT_ROOT / "data" / "electro.db"))).expanduser().resolve()
OUTDIR = Path(os.environ.get(
    "OHMX_ENGINEERING_OUTPUT_DIR",
    str(PROJECT_ROOT / "reports" / "engineering-catalog"),
)).expanduser()
OUTDIR.mkdir(parents=True, exist_ok=True)

RUN_TS = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

# ----------------------------------------------------------------------------
# Requirement-level / classification constants
# ----------------------------------------------------------------------------
SEL = "REQUIRED_FOR_SELECTION"
CMP = "REQUIRED_FOR_COMPATIBILITY"
REC = "RECOMMENDED"
INF = "INFORMATIONAL"

def F(parameter, level, classification, unit, aliases=(), note=None, test_condition=None):
    d = {"parameter": parameter, "requirement_level": level,
         "classification": classification, "unit": unit, "aliases": list(aliases)}
    if note: d["note"] = note
    if test_condition: d["test_condition"] = test_condition
    return d

# ----------------------------------------------------------------------------
# Engineering schema per equipment type
# ----------------------------------------------------------------------------
SCHEMA = {
  "HEAT_PUMP": {
    "label": "Тепловой насос",
    "detection_categories": [910017],
    "fields": [
      F("heating_capacity_a7w35_kw", SEL, "selection", "kW", ["тепловая мощность"], test_condition="A7/W35"),
      F("heating_capacity_a2w35_kw", SEL, "selection", "kW", ["тепловая мощность"], test_condition="A2/W35"),
      F("heating_capacity_a7w45_kw", SEL, "selection", "kW", ["тепловая мощность"], test_condition="A7/W45"),
      F("cooling_capacity_kw", SEL, "selection", "kW", ["охлаждающая мощность"]),
      F("cop_a7w35", SEL, "selection", "-", ["cop", "коэффициент"], test_condition="A7/W35"),
      F("eer", SEL, "selection", "-", ["eer"]),
      F("scop", REC, "recommended", "-", ["scop"]),
      F("seer", REC, "recommended", "-", ["seer"]),
      F("capacity_modulation_range_kw", REC, "recommended", "kW", ["диапазон", "модуляц"]),
      F("electrical_phase_voltage", CMP, "compatibility", "V/Ph/Hz", ["электропитание", "напряжение", "фаза"]),
      F("electrical_input_kw", SEL, "selection", "kW", ["потребляемая мощность", "электрическая мощность"]),
      F("refrigerant", CMP, "compatibility", "-", ["хладагент", "фреон", "refrigerant"]),
      F("max_water_temperature_c", SEL, "selection", "°C", ["максимальная температура воды"]),
      F("operating_outdoor_range_c", SEL, "selection", "°C", ["рабочий диапазон", "температура наружного"]),
      F("water_flow_m3h", REC, "recommended", "m³/h", ["расход воды"]),
      F("pressure_drop_kpa", REC, "recommended", "kPa", ["перепад давления", "гидравлическое сопротивление"]),
      F("hydraulic_connections", CMP, "compatibility", "inch/mm", ["присоединение", "резьба"]),
      F("integrated_pump", REC, "recommended", "bool", ["встроенный насос", "циркуляционный насос"]),
      F("backup_heater_kw", REC, "recommended", "kW", ["резервный нагрев", "тэн", "нагреватель"]),
      F("sound_power_db", REC, "recommended", "dB(A)", ["звуковая мощность"]),
      F("sound_pressure_db", INF, "informational", "dB(A)", ["звуковое давление"]),
      F("dhw_support", REC, "recommended", "bool", ["гвс", "горячее водоснабжение"]),
      F("dimensions_mm", INF, "informational", "mm", ["размеры", "длин", "ширин", "высот", "глубин"]),
      F("weight_kg", INF, "informational", "kg", ["вес"]),
    ],
  },
  "FAN_COIL": {
    "label": "Фанкойл",
    "detection_categories": [910069],
    "fields": [
      F("cooling_total_capacity_kw", SEL, "selection", "kW", ["охлаждающая мощность", "мощность охлаждения", "охлаждения"]),
      F("heating_capacity_kw", SEL, "selection", "kW", ["тепловая мощность", "мощность отопления", "отопления"]),
      F("capacity_by_speed", SEL, "selection", "kW (Low/Med/High)", note="Per-fan-speed capacity; a single headline value is insufficient"),
      F("test_conditions", SEL, "selection", "-", note="entering/leaving water temperature + room-air condition/humidity"),
      F("airflow_by_speed_m3h", SEL, "selection", "m³/h", ["расход воздуха"]),
      F("sound_pressure_by_speed_db", REC, "recommended", "dB(A)", ["звуковое давление"]),
      F("sound_power_db", REC, "recommended", "dB(A)", ["звуковая мощность"]),
      F("water_flow_m3h", REC, "recommended", "m³/h", ["расход воды"]),
      F("pressure_drop_kpa", REC, "recommended", "kPa", ["перепад давления", "гидравлическое сопротивление"]),
      F("fan_electrical_power_w", REC, "recommended", "W", ["потребляемая мощность", "мощность вентилятора"]),
      F("supply_voltage_phase", CMP, "compatibility", "V/Ph/Hz", ["электропитание", "напряжение"]),
      F("pipe_config", CMP, "compatibility", "2-pipe/4-pipe", ["трубн"]),
      F("mounting_type", INF, "informational", "-", ["тип", "монтаж"]),
      F("water_connections_size", CMP, "compatibility", "inch/mm", ["присоединение", "резьба", "соединение трубопровода"]),
      F("drain_connection", REC, "recommended", "mm", ["дренаж", "конденсат"]),
      F("dimensions_mm", INF, "informational", "mm", ["длин", "ширин", "высот", "глубин"]),
      F("weight_kg", INF, "informational", "kg", ["вес"]),
    ],
  },
  "CIRCULATION_PUMP": {
    "label": "Циркуляционный насос",
    "detection_categories": [910014],
    "fields": [
      F("max_head_m", SEL, "selection", "m", ["напор", "высота подъема"]),
      F("max_flow_m3h", SEL, "selection", "m³/h", ["расход", "производительность"]),
      F("pump_curve", SEL, "selection", "-", note="head/flow curve or characteristic"),
      F("connection_size_dn", CMP, "compatibility", "DN", ["присоединение", "резьба", "ду"]),
      F("supply_voltage", CMP, "compatibility", "V", ["напряжение", "электропитание"]),
      F("electrical_power_w", REC, "recommended", "W", ["мощность", "потребляемая"]),
      F("speed_control", REC, "recommended", "-", ["скорост", "ступен"]),
      F("max_working_pressure_bar", REC, "recommended", "bar", ["рабочее давление"]),
      F("medium_temperature_range_c", REC, "recommended", "°C", ["рабочая температура", "температура"]),
      F("protection_class", REC, "recommended", "IP", ["степень защиты", "класс защиты"]),
    ],
  },
  "BUFFER_TANK": {
    "label": "Буферная ёмкость / бойлер",
    "detection_categories": [910071],
    "fields": [
      F("volume_l", SEL, "selection", "L", ["объем", "ёмкость", "литр", "вместимость"]),
      F("capacity_kw", REC, "recommended", "kW", ["мощность", "квт"]),
      F("max_pressure_bar", CMP, "compatibility", "bar", ["рабочее давление", "ру"]),
      F("max_temperature_c", SEL, "selection", "°C", ["температура", "тмакс"]),
      F("connections", CMP, "compatibility", "inch", ["присоединение", "резьба"]),
      F("insulation", REC, "recommended", "bool", ["изоляц", "теплоизоляц"]),
      F("material", INF, "informational", "-", ["материал"]),
    ],
  },
  "COLLECTOR": {
    "label": "Коллектор / распределительная гребёнка",
    "detection_categories": [910045, 910066],
    "fields": [
      F("number_of_circuits", SEL, "selection", "int", ["выход", "контур"]),
      F("connection_size", CMP, "compatibility", "inch", ["резьба", "присоединение"]),
      F("max_pressure_bar", REC, "recommended", "bar", ["давление", "ру"]),
      F("max_temperature_c", REC, "recommended", "°C", ["температура"]),
      F("flow_meter", REC, "recommended", "bool", ["расходомер"]),
      F("material", INF, "informational", "-", ["материал"]),
    ],
  },
  "CONTROL_VALVE": {
    "label": "Регулирующий клапан (2/3/4-ходовой)",
    "detection_categories": [910082],
    "fields": [
      F("kvs_m3h", SEL, "selection", "m³/h", ["kvs", "kv-", "kv"]),
      F("dn_size", CMP, "compatibility", "DN mm", ["ду", "dn"]),
      F("number_of_ports", SEL, "selection", "2/3/4-way", ["количество ходов", "ходовой", "трехходовой", "двухходовой"]),
      F("pressure_rating_pn", CMP, "compatibility", "bar", ["ру", "давление", "pn"]),
      F("max_pressure_drop_kpa", CMP, "compatibility", "kPa/bar", ["перепад давление"]),
      F("media_temperature_range_c", REC, "recommended", "°C", ["тмакс", "тмин", "температура"]),
      F("valve_characteristic", REC, "recommended", "-", ["характеристика регулирования", "характеристика смещения"]),
      F("connection_type_size", CMP, "compatibility", "G inch", ["присоединение", "резьба"]),
      F("stroke_mm", REC, "recommended", "mm", ["ход штока"]),
    ],
  },
  "BALANCING_VALVE": {
    "label": "Баласировочный клапан",
    "detection_categories": [910081],
    "fields": [
      F("kvs_m3h", SEL, "selection", "m³/h", ["kvs", "kv"]),
      F("dn_size", CMP, "compatibility", "DN mm", ["ду", "dn"]),
      F("pressure_rating_pn", CMP, "compatibility", "bar", ["ру", "давление"]),
      F("media_temperature_range_c", REC, "recommended", "°C", ["температура"]),
    ],
  },
  "VALVE_ACTUATOR": {
    "label": "Электропривод клапана",
    "detection_categories": [910065],
    "fields": [
      F("control_signal", CMP, "compatibility", "on/off|3-point|0-10V", ["управление", "сигнал", "контроль", "on/off", "0-10v"]),
      F("supply_voltage", CMP, "compatibility", "V", ["напряжение"]),
      F("torque_nm", CMP, "compatibility", "Nm", ["крутящий", "усилие", "torque"]),
      F("stroke_mm", CMP, "compatibility", "mm", ["ход штока", "s/mm"]),
      F("running_time_s", REC, "recommended", "s", ["время перемещения", "время поворота", "s/mm"]),
      F("fail_safe_function", REC, "recommended", "-", ["функция безопасности", "пружина"]),
      F("compatible_valves", CMP, "compatibility", "-", note="future relationship REQUIRED_ACCESSORY/COMPATIBLE_WITH"),
    ],
  },
  "THERMOSTAT": {
    "label": "Термостат / терморегулятор",
    "detection_categories": [910064, 910060],
    "fields": [
      F("control_type", SEL, "selection", "on/off|PI|modulating"),
      F("supply_voltage", CMP, "compatibility", "V", ["напряжение", "питание"]),
      F("max_load_a", CMP, "compatibility", "A", ["нагрузка"]),
      F("sensor_type", REC, "recommended", "-", ["датчик", "sensor"]),
      F("communication", REC, "recommended", "-", ["wifi", "протокол", "bus", "modbus"]),
      F("mounting", INF, "informational", "-", ["накладной", "встраиваемый"]),
    ],
  },
  "CONTROLLER": {
    "label": "Контроллер теплового пункта",
    "detection_categories": [910121],
    "fields": [
      F("input_types", SEL, "selection", "-", ["вход", "датчик"]),
      F("output_types", SEL, "selection", "-", ["выход", "управление"]),
      F("communication_protocol", CMP, "compatibility", "-", ["протокол", "modbus", "bus"]),
      F("control_algorithms", REC, "recommended", "-", ["алгоритм", "регулирование"]),
      F("supply_voltage", CMP, "compatibility", "V", ["напряжение", "питание"]),
    ],
  },
  "MIXING_UNIT": {
    "label": "Смесительный узел",
    "detection_categories": [910127],
    "fields": [
      F("valve_kvs_m3h", SEL, "selection", "m³/h", ["kvs", "kv"]),
      F("pump_included", SEL, "selection", "bool", ["насос"]),
      F("connection_size", CMP, "compatibility", "inch", ["присоединение", "резьба"]),
      F("max_temperature_c", REC, "recommended", "°C", ["температура"]),
    ],
  },
  "HEAT_EXCHANGER": {
    "label": "Теплообменник / гидравлический разделитель",
    "detection_categories": [910018],
    "fields": [
      F("capacity_kw", SEL, "selection", "kW", ["мощность", "квт"]),
      F("number_of_plates", REC, "recommended", "int", ["пластин"]),
      F("max_pressure_bar", CMP, "compatibility", "bar", ["давление", "ру"]),
      F("max_temperature_c", SEL, "selection", "°C", ["температура"]),
      F("connections", CMP, "compatibility", "inch", ["присоединение", "резьба"]),
    ],
  },
  "HVAC_ACCESSORY": {
    "label": "Принадлежности и аксессуары HVAC",
    "detection_categories": [910011, 910063],
    "fields": [
      F("accessory_role", CMP, "compatibility", "-"),
      F("connection_size", CMP, "compatibility", "inch/mm", ["присоединение", "резьба"]),
      F("compatible_equipment", CMP, "compatibility", "-", note="future COMPATIBLE_WITH relationship"),
    ],
  },
}

# ----------------------------------------------------------------------------
# Category -> default equipment type
# ----------------------------------------------------------------------------
CATEGORY_DEFAULT_TYPE = {
  910017: "HEAT_PUMP",
  910069: "FAN_COIL",
  910014: "PUMP_AMBIGUOUS",
  910071: "BUFFER_TANK",
  910018: "HEAT_EXCHANGER",
  910045: "COLLECTOR",
  910066: "COLLECTOR",
  910082: "CONTROL_VALVE",
  910080: "PRESSURE_REGULATOR",
  910081: "BALANCING_VALVE",
  910065: "VALVE_ACTUATOR",
  910064: "THERMOSTAT",
  910060: "THERMOSTAT",
  910121: "CONTROLLER",
  910127: "MIXING_UNIT",
  910011: "HVAC_ACCESSORY",
  910063: "HVAC_ACCESSORY",
}

# Title-based reclassification within loose categories.
def classify_equipment_type(cat, title_lower):
    t = CATEGORY_DEFAULT_TYPE.get(cat, "NOT_RELEVANT")
    if t == "PUMP_AMBIGUOUS":
        if "циркуляцион" in title_lower or "vega" in title_lower:
            return "CIRCULATION_PUMP"
        if "скважин" in title_lower:
            return "BOREHOLE_PUMP"
        return "CIRCULATION_PUMP"  # default within HVAC pumps category
    if cat == 910069:  # fan-coil + accessories mixed category
        if "клапан" in title_lower: return "CONTROL_VALVE"
        if "привод" in title_lower: return "VALVE_ACTUATOR"
        if "поддон" in title_lower or "ножк" in title_lower or "рама" in title_lower or "кабель" in title_lower:
            return "HVAC_ACCESSORY"
        if "термостат" in title_lower or "термоклапан" in title_lower: return "THERMOSTAT"
        if "чиллер" in title_lower: return "CHILLER"
        if "панел" in title_lower or "плата" in title_lower or "блок управлени" in title_lower: return "HVAC_ACCESSORY"
        return "FAN_COIL"
    if cat == 910011:
        if "клапан" in title_lower: return "CONTROL_VALVE"
        return "HVAC_ACCESSORY"
    return t

# Fold automatic pressure regulators into CONTROL_VALVE schema (documented simplification).
CATEGORY_DEFAULT_TYPE[910080] = "CONTROL_VALVE"

NOT_RELEVANT_TYPES = {"NOT_RELEVANT", "BOREHOLE_PUMP", "CHILLER"}

def lower(s):
    return (s or "").lower()

# ----------------------------------------------------------------------------
# Identification: detect series / model from title + brand
# ----------------------------------------------------------------------------
# lower-case set of English/Russian words that are NOT model codes
_STOP_TOKENS = {"wifi","dn","pn","ip","mm","kw","bar","kva","yes","no","kv","kvs","r32","set","eco","led"}

# (lowercase key appearing in title) -> canonical series name
_VALVE_SERIES = [
    ("vzl", "VZL"), ("vfg2", "VFG2"), ("amz", "AMZ"),
    ("msv-bd", "MSV-BD"), ("msv-f2", "MSV-F2"), ("msv-s", "MSV-S"),
    ("asv-pv", "ASV-PV"), ("asv-bd", "ASV-BD"), ("usv-m", "USV-M"),
    ("ab-qm", "AB-QM"), ("avd", "AVD"), ("ra-dv", "RA-DV"), ("ra-c", "RA-C"),
]

def _generic_model(t):
    """Fallback: pull the first Latin token containing a digit as an approximate model code."""
    for c in re.findall(r"(?<![a-zа-я0-9])([A-Za-z]{2,}[0-9][A-Za-z0-9\-/:.]{0,12})", t):
        if c.lower() in _STOP_TOKENS:
            continue
        return c.upper()
    return ""

def identify(title, brand, eqtype):
    t = lower(title)
    series = ""
    model = ""
    if eqtype == "HEAT_PUMP":
        if "family sprint" in t:
            series = "Family Sprint"
            m = re.search(r"(\d{3}m)", t)
            if m: model = m.group(1).upper()
        elif "nxhm" in t:
            series = "NXHM"; model = "NXHM"
        elif "tsca" in t:
            series = "TSCA"
            m = re.search(r"(tsca-\w+)", t)
            if m: model = m.group(1).upper()
    elif eqtype == "FAN_COIL":
        m = re.search(r"\b(fc\d{1,2})\b", t)
        if m:
            series = "FC"; model = m.group(1).upper()
            v = re.search(r"(om|vm|io)\d", t)
            if v: model += "-" + v.group(1).upper()
        else:
            m = re.search(r"\b(ca\d{1,2})\b", t)
            if m: series = "CA"; model = m.group(1).upper()
        if not series:
            m = re.search(r"\b(ivo|mv|mo|uto|utv|ivp|eti|etm)\s*(\d{2,3})", t)
            if m: series = m.group(1).upper(); model = (m.group(1) + " " + m.group(2)).upper()
        if not series:
            m = re.search(r"\b(rk\s*\d{2})\b", t)
            if m: series = "RK"; model = m.group(1).upper()
        if not series:
            if "design inverter" in t: series = "Design Inverter"
            elif "in inverter" in t: series = "In Inverter"
            m = re.search(r"\b(rcm|rci)\s*\d+", t)
            if m: series = m.group(1).upper(); model = m.group(0).upper()
    elif eqtype == "CIRCULATION_PUMP":
        if "vega" in t:
            series = "VegA"
            m = re.search(r"(rm[dya]a\s*\d+-\d+)", t)
            if m: model = m.group(1).upper()
        else:
            m = re.search(r"\b(nr\s*\d+[\d/]*|4sdfm\s*[\d/]+)\b", t)
            if m: series = m.group(1).split()[0].upper(); model = m.group(1).upper()
    elif eqtype in ("CONTROL_VALVE", "BALANCING_VALVE"):
        for key, ser in _VALVE_SERIES:
            if key in t:
                series = ser
                break
        if not series and re.search(r"\bvz\d", t):
            series = "VZ"
        if series:
            m = re.search(r"\b(vz[gl]?\d|vfg2|amz\s*\d+|am[edv]\s*\d+|" + "|".join(re.escape(k) for k, _ in _VALVE_SERIES) + r")\b", t)
            if m: model = m.group(1).upper().replace(" ", "")
    elif eqtype == "VALVE_ACTUATOR":
        m = re.search(r"\b(am[edv]\s*\d+|abn\w*|twa-?\w*)\b", t)
        if m: series = re.sub(r"\d+", "", m.group(1)).upper().strip(); model = m.group(1).upper()
    elif eqtype == "CONTROLLER":
        m = re.search(r"ecl comfort (\d+)", t)
        if m: series = "ECL Comfort"; model = "ECL " + m.group(1)
    elif eqtype == "BUFFER_TANK":
        m = re.search(r"\b(rbc\s*\d+)\b", t)
        if m: series = "RBC"; model = m.group(1).upper()
    elif eqtype == "HEAT_EXCHANGER":
        m = re.search(r"\b(xb\s*\S+)\b", t)
        if m: series = "XB"; model = m.group(1).upper()
    elif eqtype == "THERMOSTAT":
        m = re.search(r"\b(bt\d{2}|mc\d+\w*|comando\s*plus\s*\w+|icon|devireg(?:\s+\w+)?|efet\s*\d+|etr\S*|r7c|ecb\d+|c\d{2}\S*|oj\S*)\b", t)
        if m:
            key = m.group(1).lower()
            name = m.group(1)
            if key.startswith("bt"): series = "BT"; model = name.upper()
            elif key.startswith("mc"): series = "MC"; model = name.upper()
            elif "comando" in key: series = "Comando Plus"; model = "Comando Plus 2T"
            elif key == "icon": series = "Icon"; model = "Danfoss Icon"
            elif key.startswith("devireg"): series = "DEVIreg"; model = name
            elif key.startswith("efet"): series = "EFET"; model = name.upper()
            elif key.startswith("etr") or key.startswith("oj"): series = "OJ"; model = name.upper()
            elif key.startswith("r7c"): series = "R7C"; model = name.upper()
            elif key.startswith("ecb"): series = "ECB"; model = name.upper()
    elif eqtype == "COLLECTOR":
        m = re.search(r"\b(c\d{3}|topway|fhf-\w+)\b", t)
        if m:
            series = re.split(r"[-0-9]", m.group(1))[0].upper(); model = m.group(1).upper()
    if not model and not series:
        model = _generic_model(t)
    if brand and model and series:
        id_status = "IDENTIFIED"
    elif brand and (model or series):
        id_status = "IDENTITY_PARTIAL"
    else:
        id_status = "IDENTITY_UNCERTAIN"
    return series, model, id_status

# ----------------------------------------------------------------------------
# Field presence: does a product's feature set satisfy a schema field?
# ----------------------------------------------------------------------------
def field_present(field, feat_names, feat_pairs):
    aliases = field.get("aliases", [])
    tc = field.get("test_condition")
    if not aliases:
        return False  # structural requirement without textual alias -> never auto-detected
    for fn in feat_names:
        for a in aliases:
            if a in fn:
                if tc:
                    # require the operating point to be stated, not just a nominal value
                    text = fn
                    for fn2, val, _u in feat_pairs:
                        if fn2 == fn and tc.lower() in val.lower():
                            text = val
                    if tc.lower() not in text.lower():
                        continue
                return True
    return False

# ----------------------------------------------------------------------------
# Load data
# ----------------------------------------------------------------------------
conn = sqlite3.connect(f"{DB.as_uri()}?mode=ro", uri=True)
conn.row_factory = sqlite3.Row

cats = list(CATEGORY_DEFAULT_TYPE.keys())
ph = ",".join("?" * len(cats))

rows = conn.execute("""
SELECT p.id, p.sku, p.name_ru, b.name AS brand, c.name_ru AS category,
       p.equipment_type, p.heating_power_kw, p.cooling_power_kw
FROM products p
LEFT JOIN brands b ON b.id = p.brand_id
LEFT JOIN product_categories pc ON pc.product_id = p.id
LEFT JOIN categories c ON c.id = pc.category_id
WHERE pc.category_id IN (%s) AND p.is_active = 1
""" % ph, cats).fetchall()

# de-dup products that appear in several target categories (keep first + join categories)
by_id = {}
for r in rows:
    pid = r["id"]
    if pid not in by_id:
        e = dict(r); e["cats"] = []
        by_id[pid] = e
    by_id[pid]["cats"].append(r["category"])

def load_features(pid):
    f = conn.execute("SELECT feature_name, feature_value, feature_unit FROM product_features WHERE product_id=? ORDER BY sort_order", (pid,)).fetchall()
    return f

def load_attributes(pid):
    a = conn.execute("SELECT attribute_key, value_text, value_number, value_unit, source, confidence FROM product_attributes WHERE product_id=?", (pid,)).fetchall()
    return a

# ----------------------------------------------------------------------------
# Main loop
# ----------------------------------------------------------------------------
audit_rows = []
missing_rows = []
identity_rows = []
provenance_rows = []

for pid, e in by_id.items():
    title = e["name_ru"] or ""
    brand = e["brand"] or ""
    cat_ids = ""  # actual category names joined
    eqtype = None
    # classify by first category (all cats of a product are in scope list anyway)
    # resolve category id for classification
    tlow = lower(title)
    # find the category id from the original rows for this product
    cat_names = e["cats"]

    # We classify using a representative category id. Use the product's primary
    # category membership; fall back to first.
    # Re-query the actual category ids for this product.
    cc = conn.execute("SELECT category_id FROM product_categories WHERE product_id=?", (pid,)).fetchall()
    cat_ids = [x["category_id"] for x in cc]

    eqtype = None
    for cid in cat_ids:
        if cid in CATEGORY_DEFAULT_TYPE:
            eqtype = classify_equipment_type(cid, tlow)
            break
    if eqtype is None:
        eqtype = "NOT_RELEVANT"

    # resolve category name string (first non-null)
    category = cat_names[0] if cat_names else ""

    series, model, id_status = identify(title, brand, eqtype)

    feats = load_features(pid)
    attrs = load_attributes(pid)
    feat_pairs = [(lower(f["feature_name"]), f["feature_value"] or "", f["feature_unit"] or "") for f in feats]
    feat_names = [p[0] for p in feat_pairs]

    if eqtype in NOT_RELEVANT_TYPES or eqtype not in SCHEMA:
        # write audit row with NOT_RELEVANT
        audit_rows.append(dict(
            product_id=pid, article=e["sku"], brand=brand, title=title, category=category,
            equipment_type=eqtype, series=series, model=model, identity_status=id_status if id_status != "IDENTIFIED" else id_status,
            engineering_status="NOT_RELEVANT",
            required_selection_total=0, required_selection_present=0,
            required_compatibility_total=0, required_compatibility_present=0,
            recommended_total=0, recommended_present=0,
            missing_critical_count=0, official_source_found=0,
            notes="out of first-priority engineering scope or unmapped type"))
        if id_status == "IDENTITY_UNCERTAIN":
            identity_rows.append(dict(product_id=pid, article=e["sku"], brand=brand, title=title, equipment_type=eqtype, category=category))
        continue

    fields = SCHEMA[eqtype]["fields"]
    sel_tot = sum(1 for f in fields if f["requirement_level"] == SEL)
    cmp_tot = sum(1 for f in fields if f["requirement_level"] == CMP)
    rec_tot = sum(1 for f in fields if f["requirement_level"] == REC)
    sel_pres = cmp_pres = rec_pres = 0
    for f in fields:
        present = field_present(f, feat_names, feat_pairs)
        lvl = f["requirement_level"]
        if lvl == SEL and present: sel_pres += 1
        elif lvl == CMP and present: cmp_pres += 1
        elif lvl == REC and present: rec_pres += 1
        # missing-fields + provenance
        if present:
            # record provenance: find matching feature/attribute value
            val = un = src = conf = ""
            for fn2, v2, u2 in feat_pairs:
                if any(a in fn2 for a in f.get("aliases", [])) and f.get("aliases"):
                    val, un, src = v2, u2, "PRODUCT_FEATURE"
                    break
            if f.get("aliases"):
                for a in attrs:
                    if any(al in lower(a["attribute_key"]) for al in f.get("aliases", [])):
                        val, un, src, conf = (a["value_text"] or ("" if a["value_number"] is None else str(a["value_number"]))), a["value_unit"], a["source"], a["confidence"]
                        break
            provenance_rows.append(dict(
                product_id=pid, article=e["sku"], equipment_type=eqtype, parameter=f["parameter"],
                value=val, unit=un, source_type=src or "PRODUCT_FEATURE",
                source_reference="legacy-import" if src in ("PRODUCT_FEATURE", "") else src,
                source_document="", page_or_table="", confidence=conf if conf else ("1.0" if src=="PRODUCT_FEATURE" else "0.8"),
                notes=""))
        else:
            lvl = f["requirement_level"]
            missing_rows.append(dict(
                product_id=pid, article=e["sku"], equipment_type=eqtype, parameter=f["parameter"],
                requirement_level=lvl,
                status="MISSING",
                search_needed="yes" if lvl in (SEL, CMP) else "no",
                notes=f.get("note", "")))

    sel_missing = sel_tot - sel_pres
    cmp_missing = cmp_tot - cmp_pres
    missing_critical = sel_missing + cmp_missing

    if id_status == "IDENTITY_UNCERTAIN":
        eng = "IDENTITY_UNCERTAIN"
    elif sel_missing > 0:
        eng = "BLOCKED"
    elif cmp_missing > 0:
        eng = "PARTIAL"
    else:
        eng = "COMPLETE"

    audit_rows.append(dict(
        product_id=pid, article=e["sku"], brand=brand, title=title, category=category,
        equipment_type=eqtype, series=series, model=model, identity_status=id_status,
        engineering_status=eng,
        required_selection_total=sel_tot, required_selection_present=sel_pres,
        required_compatibility_total=cmp_tot, required_compatibility_present=cmp_pres,
        recommended_total=rec_tot, recommended_present=rec_pres,
        missing_critical_count=missing_critical, official_source_found=0,
        notes=""))
    if id_status == "IDENTITY_UNCERTAIN":
        identity_rows.append(dict(product_id=pid, article=e["sku"], brand=brand, title=title, equipment_type=eqtype, category=category))

conn.close()

# ----------------------------------------------------------------------------
# Write schema JSON
# ----------------------------------------------------------------------------
schema_doc = {
    "schema_version": "1.0.0",
    "generated_at": RUN_TS,
    "generated_by": "Hermes engineering catalog audit (read-only)",
    "title": "OhmX.am Engineering Catalog Requirement Schema",
    "notes": [
        "Headline capacity (title or single feature value) is NOT sufficient without test conditions.",
        "Different operating points are stored as separate fields.",
        "sound_pressure and sound_power are distinct.",
        "cooling_total and cooling_sensible are distinct."
    ],
    "relationship_types": ["REQUIRED_ACCESSORY","RECOMMENDED_ACCESSORY","OPTIONAL_ACCESSORY","COMPATIBLE_WITH","ALTERNATIVE_TO","INCOMPATIBLE_WITH"],
    "equipment_types": {k: v for k, v in SCHEMA.items()},
}
with open(os.path.join(OUTDIR, "engineering_catalog_schema.json"), "w", encoding="utf-8") as fh:
    json.dump(schema_doc, fh, ensure_ascii=False, indent=2)

# ----------------------------------------------------------------------------
# Write CSV artifacts
# ----------------------------------------------------------------------------
def write_csv(name, fieldnames, data):
    path = os.path.join(OUTDIR, name)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for d in data:
            w.writerow(d)
    return path

audit_cols = ["product_id","article","brand","title","category","equipment_type","series","model",
              "identity_status","engineering_status","required_selection_total","required_selection_present",
              "required_compatibility_total","required_compatibility_present","recommended_total",
              "recommended_present","missing_critical_count","official_source_found","notes"]
write_csv("engineering_catalog_audit.csv", audit_cols, audit_rows)

write_csv("engineering_catalog_missing_fields.csv",
    ["product_id","article","equipment_type","parameter","requirement_level","status","search_needed","notes"],
    missing_rows)

write_csv("engineering_catalog_identity_uncertain.csv",
    ["product_id","article","brand","title","equipment_type","category"],
    identity_rows)

write_csv("engineering_catalog_source_provenance.csv",
    ["product_id","article","equipment_type","parameter","value","unit","source_type","source_reference",
     "source_document","page_or_table","confidence","notes"],
    provenance_rows)

# enrichment candidates: base header only (web-research proposals appended separately)
write_csv("engineering_catalog_enrichment_candidates.csv",
    ["product_id","article","equipment_type","parameter","value","unit","test_condition","source_type",
     "source_reference","source_document","source_page_or_table","confidence","recommended_action"],
    [])

# ----------------------------------------------------------------------------
# Summary stats (printed for the report)
# ----------------------------------------------------------------------------
from collections import Counter
total = len(audit_rows)
rel = [r for r in audit_rows if r["engineering_status"] != "NOT_RELEVANT"]
st = Counter(r["engineering_status"] for r in rel)
ty = Counter(r["equipment_type"] for r in rel)
print(json.dumps({
    "run_ts": RUN_TS,
    "products_audited": total,
    "engineering_relevant": len(rel),
    "status_counts": dict(st),
    "equipment_type_counts": {k: ty[k] for k in sorted(ty)},
    "missing_field_rows": len(missing_rows),
    "identity_uncertain_rows": len(identity_rows),
    "provenance_rows": len(provenance_rows),
}, ensure_ascii=False, indent=2))