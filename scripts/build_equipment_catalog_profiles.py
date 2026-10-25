#!/usr/bin/env python3
"""Offline catalog understanding layer for the Building Project equipment engine.

Reads a SQLite snapshot of the OhmX catalog (never the live database file) and writes:
  1. client/src/features/buildingProject/equipment/selection/catalogProfiles.json
     - normalized technical profiles of every product the BOM roles can use;
  2. <report-dir>/catalog_coverage.csv
     - one row for EVERY active product: functional type or the reason it is out of scope.

Each extracted attribute keeps its source:
  'name'    - parsed from the product designation in the catalog name (discovery quality);
  'feature' - catalog characteristic table (catalog record quality);
  'profile' - approved engineering profile (engineering_product_profile / engineering_value).
Datasheet facts are NOT produced here: they live in reviewed code (selection/datasheetFacts.ts)
with document references. Nothing here is a compatibility decision.

Usage: build_equipment_catalog_profiles.py <snapshot.db> <out.json> <report-dir>
"""
import csv
import hashlib
import json
import os
import re
import sqlite3
import sys
from collections import Counter

HVAC_ROOTS = (910001, 910006, 910008)  # HVAC и теплоснабжение, Трубопроводная арматура, Электрическое отопление

# ---------------------------------------------------------------------------
# Normalization helpers
# ---------------------------------------------------------------------------

THREADS = ['1/2"', '3/4"', '1"', '1 1/4"', '1 1/2"', '2"', '2 1/2"']
DN_TO_THREAD = {15: '1/2"', 20: '3/4"', 25: '1"', 32: '1 1/4"', 40: '1 1/2"', 50: '2"'}


def norm_text(s):
    s = (s or '').replace(' ', ' ').replace('’', "'").replace('″', '"').replace('“', '"').replace('”', '"')
    return re.sub(r"''", '"', s)


def threads_in(text):
    """All inch thread designations in order of appearance, canonical form."""
    t = norm_text(text)
    out = []
    # 1"1/4, 1" 1/4, 1 1/4", 1''1/4 -> 1 1/4"
    for m in re.finditer(r'(\d)\s*"\s*(1/[24])|(\d)\s+(1/[24])\s*"|(?<![\d/])(1/2|3/4|1|2)\s*"', t):
        if m.group(1):
            out.append(f'{m.group(1)} {m.group(2)}"')
        elif m.group(3):
            out.append(f'{m.group(3)} {m.group(4)}"')
        else:
            out.append(f'{m.group(5)}"')
    return [x for x in out if x in THREADS]


def dn_in(text):
    m = re.search(r'\bDN\s*(\d{2,3})\b|Ду\s*(\d{2,3})', text, re.I)
    return int(m.group(1) or m.group(2)) if m else None


def num(text):
    m = re.search(r'-?\d+(?:[.,]\d+)?', text or '')
    return float(m.group(0).replace(',', '.')) if m else None


def voltage_in(text):
    m = re.search(r'(\d{2,3})\s*(?:V|В)\b', text)
    return int(m.group(1)) if m else None


# ---------------------------------------------------------------------------
# Functional classification (first match wins). Returns (type, role_note|None)
# ---------------------------------------------------------------------------

def classify(n, cat_id, in_tree, has_fc_profile):
    if has_fc_profile:
        return 'FAN_COIL'
    rules = [
        ('REFRIGERATION_THERMOSTAT', r'холодил|морозил|охладител'),
        ('HEAT_PUMP', r'тепловой насос'),
        ('FAN_COIL_ACCESSORY', r'(для|к) (напольн\w+ )?фанко[йи]л|управлени\w* фанко[йи]л|коробка для фанкойла|панель.*фанкойл|пульт.*фанкойл|для 3-скоростного термостата'),
        ('FAN_COIL_THERMOSTAT', r'термостат.*фанко[йи]л|термостат для 2 трубн'),
        ('FAN_COIL', r'^фанко[йи]л|кассетн\w+ фанко[йи]л|фанко[йи]л'),
        ('BOILER_SPARE_PUMP', r'насос для котла'),
        ('OTHER_PUMP', r'скважинн\w+ насос|дренажн\w+ насос|насосная станция'),
        ('CIRCULATION_PUMP', r'циркуляционн\w* насос'),
        ('MIXING_UNIT', r'смесительн\w* узел'),
        ('MANIFOLD_PLUG', r'заглушк'),
        ('MANIFOLD_ACCESSORY', r'штуцер|кронштейн|концев\w+ секци'),
        ('HYDRAULIC_SEPARATOR', r'гидравлическ\w* разделител|гидрострел'),
        ('MANIFOLD', r'коллектор'),
        ('THERMAL_ACTUATOR', r'термоэлектрическ\w* привод'),
        ('MOTOR_ACTUATOR', r'электропривод'),
        ('ZONE_CONTROLLER', r'мастер.контроллер|коммутационн\w+ устройство - danfoss icon'),
        ('CONTROL_ACCESSORY', r'icon (expansion|app|repeater|radio)|модуль (расширения|приложения)|радиомодуль|усилитель радиосигнала - danfoss icon'),
        ('FLOOR_SENSOR', r'датчик температуры пола'),
        ('WATER_UFH_THERMOSTAT', r'(термостат|терморегулятор)\w* для водян\w+ тепл'),
        ('ROOM_THERMOSTAT', r'(комнатн\w+|настенн\w+) термостат|термостат комнатный'),
        ('ELECTRIC_UFH_THERMOSTAT', r'(термостат|терморегулятор)\w*.*(электрическ|тепл\w+ пол|16a)'),
        ('PIPE_THERMOSTAT', r'термостат (накладной|погружной)'),
        ('RADIATOR_THERMOSTATIC', r'термостатическ\w+ (головк|элемент)|термостатиеская|радиаторн\w+ терморегулятор'),
        ('THERMOSTAT_OTHER', r'термостат|терморегулятор'),
        ('EXPANSION_VESSEL', r'расширительн\w* бак'),
        ('AIR_VENT', r'воздухоотводчик'),
        ('STRAINER', r'фильтр сетчат|сетчат\w* фильтр'),
        ('CHECK_VALVE', r'обратн\w* клапан'),
        ('SAFETY_VALVE', r'предохранительн\w* клапан'),
        ('BALANCING_VALVE', r'балансировочн|ab-qm|\basv'),
        ('BALL_VALVE', r'кран шаров|шаров\w* кран'),
        ('CONTROL_VALVE', r'регулирующ\w* клапан|зонов\w+ клапан|трехходов|трёхходов|смесительн\w+ клапан'),
        ('TOWEL_WARMER', r'полотенцесуш'),
        ('RADIATOR', r'^радиатор|радиатор (отопления|стальн|алюмин|биметал)|^трубчат\w+ отопительн|^отопительн\w+ регистр'),
        ('ELECTRIC_CONVECTOR', r'электрическ\w+ конвектор'),
        ('CONVECTOR', r'конвектор'),
        ('WATER_HEATER', r'водонагреват'),
        ('BOILER', r'котел|котёл'),
        ('HEAT_EXCHANGER', r'теплообменник'),
        ('PIPE', r'труба'),
        ('FITTING', r'фитинг|муфт|переходник|тройник|угольник|ниппел|сгон|американк'),
        ('THERMOMETER_MANOMETER', r'термометр|манометр'),
    ]
    for t, rx in rules:
        if re.search(rx, n):
            return t
    return 'UNCLASSIFIED_IN_SCOPE' if in_tree else None


# Types the runtime BOM roles evaluate (full profiles are exported for these).
RUNTIME_TYPES = {
    'BOILER', 'FAN_COIL', 'RADIATOR', 'CONVECTOR', 'ELECTRIC_CONVECTOR', 'TOWEL_WARMER',
    'HEAT_PUMP', 'CIRCULATION_PUMP', 'BOILER_SPARE_PUMP', 'OTHER_PUMP', 'MIXING_UNIT', 'MANIFOLD', 'MANIFOLD_PLUG',
    'MANIFOLD_ACCESSORY', 'HYDRAULIC_SEPARATOR', 'THERMAL_ACTUATOR', 'MOTOR_ACTUATOR', 'ZONE_CONTROLLER',
    'CONTROL_ACCESSORY', 'FLOOR_SENSOR', 'WATER_UFH_THERMOSTAT', 'ROOM_THERMOSTAT', 'ELECTRIC_UFH_THERMOSTAT',
    'THERMOSTAT_OTHER', 'EXPANSION_VESSEL', 'AIR_VENT', 'STRAINER', 'CHECK_VALVE', 'SAFETY_VALVE', 'BALL_VALVE',
}


# ---------------------------------------------------------------------------
# Attribute extraction per type
# ---------------------------------------------------------------------------

def description_pairs(html_text):
    """(key, value) pairs from catalog description HTML tables plus 'Key Value' runs of DAB-style text."""
    import html as _html
    t = _html.unescape(html_text or '')
    pairs = []
    for row in re.findall(r'<tr[^>]*>(.*?)</tr>', t, re.S | re.I):
        cells = [re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', c)).strip() for c in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S | re.I)]
        cells = [c for c in cells if c]
        if len(cells) == 2:
            pairs.append((cells[0], cells[1]))
    plain = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', t))
    for key, rx in (('Максимальный напор, м', r'Максимальный напор,? м\s*([\d.,]+)'),
                    ('Максимальный напор, м', r'\bH\s*=\s*([\d.,]+)\s*м'),
                    ('Максимальный расход, м³/ч', r'Максимальный расход(?: воды)?(?:, м³/ч)?:?\s*([\d.,]+)\s*(?:м3/ч|м³/ч)?'),
                    ('Межосевое расстояние, мм', r'Межосевое расстояние, мм\s*(\d+)'),
                    ('Межосевое расстояние, мм', r'DN\s*\d+\s*/\s*(\d{3})\s*мм'),
                    ('Частотное регулирование', r'Частотное регулирование\s*(Да|Нет)'),
                    ('Кол-во скоростей вращения', r'Кол-во скоростей вращения\s*(\d)'),
                    ('Максимальная мощность, Вт', r'Максимальная мощность, Вт\s*(\d+)'),
                    ('Резьба на насосе', r'Резьба на насосе\s*"?F"?\s*([^A-Яа-я]{2,12}?G?)\s+(?:Содержание|Тип|$)'),
                    ('Тип электродвигателя', r'(синхронный двигатель с постоянными магнитами|асинхронный с мокрым ротором|двухполюсный асинхронный)'),
                    ('Максимальная температура жидкости, °С', r'Максимальная температура жидкости, °С\s*(\d+)'),
                    ('Напряжение, В', r'Напряжение, В\s*(\d\s*x\s*\d{3}|\d{3})')):
        m = re.search(rx, plain, re.I)
        if m and not any(k == key for k, _ in pairs):
            pairs.append((key, m.group(1).strip()))
    return pairs


def feature_lookup(features, *names):
    """First matching characteristic. Catalog feature table wins over description text."""
    for want in names:
        for fname, fval, *_ in features:
            if want in fname.lower():
                return fname, fval
    return None, None


def feature_src(features, fname):
    for f in features:
        if f[0] == fname:
            return f[2] if len(f) > 2 else 'feature'
    return 'feature'


def extract(t, name, features):
    a = {}

    def put(key, value, unit, src, raw=None):
        if value is None or value == '':
            return
        a[key] = {'v': value, 'u': unit, 'src': src, **({'raw': raw} if raw else {})}

    n = norm_text(name)
    nl = n.lower()
    thr = threads_in(n)
    dn = dn_in(n)

    if t == 'MANIFOLD':
        m = re.search(r'(\d{1,2})\s*\+\s*\1', n) or re.search(r'(\d{1,2})\s*выход', nl)
        put('outlets', int(m.group(1)) if m else None, None, 'name')
        if 'без настройки' in nl:
            put('presetting', False, None, 'name')
        elif 'с настройкой' in nl:
            put('presetting', True, None, 'name')
        if 'расходомер' in nl:
            put('flowmeters', True, None, 'name')
        if 'с вентилями' in nl:
            put('outlet_valve', 'SHUTOFF', None, 'name')
        mt = re.search(r'(\d(?:\s?\d/\d)?|\d/\d)\s*"\s*x\s*(\d(?:\s?\d/\d)?|\d/\d)\s*"', n)
        if mt:
            put('main_thread', threads_in(mt.group(1) + '"')[0] if threads_in(mt.group(1) + '"') else None, None, 'name')
            put('outlet_thread', threads_in(mt.group(2) + '"')[0] if threads_in(mt.group(2) + '"') else None, None, 'name')
        if re.search(r'\bEK\b', n):
            put('outlet_eurocone', True, None, 'name')
        if 'ssm' in nl:
            put('series', 'SSM-F', None, 'name')
        elif 'danfoss' in nl or 'manifold' in nl:
            put('series', 'FHF-like', None, 'name')
        elif 'topway' in nl:
            put('series', 'Emmeti Topway', None, 'name')
        elif re.search(r'\bc3\d\d', nl):
            put('series', 'Carlo Poletti ' + re.search(r'\b(c3\d\d)', nl).group(1).upper(), None, 'name')
        fn, fv = feature_lookup(features, 'рабочая температура')
        put('max_temp_c', num(fv), '°C', 'feature', fv)
        fn, fv = feature_lookup(features, 'рабочее давление')
        put('max_pressure_bar', num(fv), 'bar', 'feature', fv)
        fn, fv = feature_lookup(features, 'условный проход')
        if fv and threads_in(fv):
            put('main_thread_feature', threads_in(fv)[0], None, 'feature', fv)
    elif t == 'MANIFOLD_PLUG':
        fn, fv = feature_lookup(features, 'диаметр')
        src = 'feature' if fv else 'name'
        tt = threads_in(fv or '') or thr
        put('thread', tt[0] if tt else None, None, src, fv)
        fn, gv = feature_lookup(features, 'резьба')
        if gv:
            put('gender', 'F' if 'внутрен' in gv.lower() else 'M' if 'внешн' in gv.lower() or 'наружн' in gv.lower() else None, None, 'feature', gv)
        if re.search(r'\bEK\b', (fv or '') + ' ' + n):
            put('eurocone', True, None, 'feature' if fv and 'EK' in fv else 'name')
        if 'для коллектора' in nl:
            put('purpose', 'MANIFOLD', None, 'name')
    elif t in ('THERMAL_ACTUATOR', 'MOTOR_ACTUATOR'):
        m = re.search(r'\b(TWA-[A-Z]|ABNM|AMV|AME|AMB|AMD)\b', n)
        put('model', m.group(1) if m else None, None, 'name')
        put('voltage_v', voltage_in(n), 'V', 'name')
        if re.search(r'\bNC\b', n):
            put('function', 'NC', None, 'name')
        elif re.search(r'\bNO\b', n):
            put('function', 'NO', None, 'name')
        if ' DC' in n:
            put('current', 'DC', None, 'name')
        fn, fv = feature_lookup(features, 'потребляемая мощность')
        put('power_w', num(fv), 'W', 'feature', fv)
        fn, fv = feature_lookup(features, 'тип клапана')
        put('valve_interface', fv, None, 'feature')
    elif t in ('WATER_UFH_THERMOSTAT', 'ROOM_THERMOSTAT', 'ELECTRIC_UFH_THERMOSTAT', 'THERMOSTAT_OTHER', 'FAN_COIL_THERMOSTAT'):
        m = re.search(r'(\d{1,2})\s*A\b(?:\s*/\s*(\d{1,2})\s*A)?', n)
        if m:
            put('rated_current_a', float(m.group(2) or m.group(1)), 'A', 'name', m.group(0))
        fn, fv = feature_lookup(features, 'нагрузка')
        put('load_rating', fv, None, 'feature')
        fn, fv = feature_lookup(features, 'питание', 'источник питания', 'напряжение')
        put('supply', fv, None, 'feature')
        if 'wifi' in nl.replace('-', '').replace(' ', ''):
            put('wifi', True, None, 'name')
        if 'icon' in nl:
            put('family', 'Danfoss Icon', None, 'name')
        if 'встраиваем' in nl:
            put('mounting', 'IN_WALL', None, 'name')
        elif 'накладн' in nl:
            put('mounting', 'ON_WALL', None, 'name')
    elif t == 'ZONE_CONTROLLER':
        put('voltage_v', voltage_in(n) or (24 if '24в' in nl.replace(' ', '') else None), 'V', 'name')
        m = re.search(r'(\d{1,2})\s*канал', nl)
        put('channels', int(m.group(1)) if m else None, None, 'name')
    elif t == 'CIRCULATION_PUMP':
        def fput(key, unit, *names, conv=num):
            fn, fv = feature_lookup(features, *names)
            if fv:
                put(key, conv(fv), unit, feature_src(features, fn), f'{fn}: {fv}')
            return fn, fv
        fput('h_max_m', 'm', 'максимальный напор')
        fn, fv = feature_lookup(features, 'максимальный расход', 'максимальная производительность', 'производительность')
        if fv:
            v = num(fv)
            lpm = 'л/м' in (fn + fv).lower()
            put('q_max_m3h', round(v * 0.06, 3) if lpm and v else v, 'm3/h', feature_src(features, fn), f'{fn}: {fv}')
        put('dn', dn, None, 'name')
        fn, fv = feature_lookup(features, 'резьба на насосе')
        tt = threads_in(fv or '') if fv else []
        if tt:
            put('connection_thread', tt[0], None, feature_src(features, fn), fv)
        elif thr:
            put('connection_thread', thr[-1], None, 'name')
        fput('install_length_mm', 'mm', 'межосевое расстояние', 'монтажная длина')
        if 'install_length_mm' in a and a['install_length_mm']['v'] is not None and a['install_length_mm']['v'] < 100:
            del a['install_length_mm']  # catalog data error (e.g. "Монтажная длина, мм | 1.5")
        if 'install_length_mm' not in a:
            m = re.search(r'L\s?(\d{3})\s*мм|/\s*(\d{3})\s*мм|/(\d{3})\b', n)
            if m:
                put('install_length_mm', int(m.group(1) or m.group(2) or m.group(3)), 'mm', 'name', m.group(0))
        fn, fv = feature_lookup(features, 'количество фаз')
        if fv and 'трех' in fv.lower():
            put('phases', 3, None, feature_src(features, fn), fv)
        fput('voltage_v', 'V', 'напряжение', conv=lambda v: 400.0 if '400' in v or '380' in v else 230.0 if re.search(r'2[23]0', v) else num(v))
        fput('speed_count', None, 'кол-во скоростей')
        fput('power_max_w', 'W', 'максимальная мощность', 'мощность, вт')
        fput('fluid_temp_max_c', '°C', 'максимальная температура жидкости', 'температура перекачиваемой')
        fn, fv = feature_lookup(features, 'рабочая температура')
        if fv and 'fluid_temp_max_c' not in a:
            nums = [float(x.replace(',', '.')) for x in re.findall(r'\d+(?:[.,]\d+)?', fv)]
            if nums:
                put('fluid_temp_max_c', max(nums), '°C', feature_src(features, fn), fv)
        fn, fv = feature_lookup(features, 'тип электродвигателя')
        if fv:
            put('motor', 'PERMANENT_MAGNET' if 'магнит' in fv.lower() else 'ASYNCHRONOUS' if 'асинхрон' in fv.lower() else None, None, feature_src(features, fn), fv)
        if 'электронн' in nl:
            put('speed_control', 'ELECTRONIC', None, 'name')
        else:
            fn, fv = feature_lookup(features, 'частотное регулирование')
            if fv:
                put('speed_control', 'ELECTRONIC' if fv.lower().startswith('да') else 'FIXED_SPEEDS', None, feature_src(features, fn), fv)
    elif t == 'MIXING_UNIT':
        m = re.search(r'(UPS|UPM3)[^-]*?(\d{2}-\d{2})', n)
        put('pump', m.group(0) if m else None, None, 'name')
    elif t in ('BALL_VALVE', 'STRAINER', 'AIR_VENT', 'CHECK_VALVE', 'SAFETY_VALVE', 'HYDRAULIC_SEPARATOR'):
        if thr:
            put('thread', thr[0], None, 'name')
        elif dn:
            put('dn', dn, None, 'name')
        if t == 'BALL_VALVE':
            if re.search(r'внутренн\w+ и наружн|наружн\w+ и внутренн', nl):
                put('ends', 'FM', None, 'name')
            elif 'с внутренней резьбой' in nl:
                put('ends', 'FF', None, 'name')
            if 'углов' in nl:
                put('angle', True, None, 'name')
            if 'сливом' in nl:
                put('drain', True, None, 'name')
            if 'комплект' in nl:
                put('kit', True, None, 'name')
        if t == 'SAFETY_VALVE':
            m = re.search(r'(\d+(?:[.,]\d)?)\s*бар', nl)
            put('set_pressure_bar', float(m.group(1).replace(',', '.')) if m else None, 'bar', 'name')
        if t in ('AIR_VENT',):
            m = re.search(r'PN\s?(\d+)', n)
            put('pn', int(m.group(1)) if m else None, 'bar', 'name')
            put('automatic', 'автоматическ' in nl, None, 'name')
    elif t == 'EXPANSION_VESSEL':
        m = re.search(r'(\d+)\s*литр', nl)
        put('volume_l', int(m.group(1)) if m else None, 'l', 'name')
    elif t in ('RADIATOR', 'CONVECTOR', 'TOWEL_WARMER'):
        p_fan = 'вентилятор' in nl or ' vent ' in nl
        # Rated output: catalog characteristic "Мощность ∆t 50C, Вт" / "Мощность при 75/65/20, Δt 50, Вт"
        # (EN 442 rating, Δt = mean water − room air). Highest-priority rating Δt 50, then 60, then 70.
        best = None
        ratings = {}
        for fname, fval, *rest in features:
            fl = fname.lower()
            if not fl.startswith('мощность'):
                continue
            m = re.search(r'[∆δΔ]t\s*(\d{2})', fname, re.I)
            w = num(fval)
            if not m or w is None:
                continue
            if 'max' in fval.lower() and '(min)' in fval.lower():
                w = num(fval.split('/')[1])  # fan-assisted units: max output
            dt = int(m.group(1))
            ratings.setdefault(dt, (w, f'{fname}: {fval}', rest[0] if rest else 'feature'))
            if best is None or abs(dt - 50) < abs(best[1] - 50):
                best = (w, dt, f'{fname}: {fval}', rest[0] if rest else 'feature')
        if best:
            put('rated_w', best[0], 'W', best[3], best[2])
            put('rated_dt', best[1], 'K', best[3])
            # a second rating point of the same product gives its own EN 442 exponent n
            other = sorted((dt for dt in ratings if dt != best[1]), key=lambda dt: abs(dt - best[1]))
            if other and p_fan is False:
                w2, raw2, src2 = ratings[other[0]]
                put('rated2_w', w2, 'W', src2, raw2)
                put('rated2_dt', other[0], 'K', src2)
        else:
            m = re.search(r'(\d{2,4})\s*(?:W\b|Вт)', n)
            if m:
                put('rated_w', int(m.group(1)), 'W', 'name', m.group(0))
                put('rated_dt', 50, 'K', 'name', 'принято Δt 50 (EN 442) — в названии условие не указано')
        if t == 'RADIATOR' and re.search(r'алюмин|биметал', nl):
            put('sectional', True, None, 'name')
        if t == 'TOWEL_WARMER':
            put('medium', 'ELECTRIC' if 'электр' in nl else 'WATER' if 'водян' in nl else None, None, 'name')
        if t == 'CONVECTOR':
            put('mounting', 'INFLOOR' if 'внутрипольн' in nl else 'FLOOR' if 'напольн' in nl else 'WALL' if 'настенн' in nl else None, None, 'name')
            if 'вентилятор' in nl or ' vent ' in nl:
                put('fan_assisted', True, None, 'name')
    elif t == 'BOILER':
        put('fuel', 'ELECTRIC' if 'электрическ' in nl else 'GAS_CONDENSING' if 'конденсац' in nl else 'GAS' if 'газов' in nl else None, None, 'name')
        def fnum(*names):
            fn, fv = feature_lookup(features, *names)
            return (num(fv), fn, fv) if fv and num(fv) is not None else (None, None, None)
        v, fn, fv = fnum('номинальная тепловая производительность', 'номинал. тепловая производительность', 'полезная мощность', 'мощность, квт (при 80°/60°)', 'полезная 80°/60°', 'полезная 80/60')
        if v:
            put('output_kw', v, 'kW', feature_src(features, fn), f'{fn}: {fv}')
        v, fn, fv = fnum('номинальная тепловая мощность')
        if v:
            put('input_kw', v, 'kW', feature_src(features, fn), f'{fn}: {fv}')
        v, fn, fv = fnum('кпд (80-60', 'кпд, % (80°/60°)', 'кпд')
        if v:
            put('efficiency_pct', v, '%', feature_src(features, fn), f'{fn}: {fv}')
        if 'электрическ' in nl:
            v, fn, fv = fnum('номинальная потребляемая мощность', 'максимальная мощность p1')
            if v:
                put('output_kw', v, 'kW', feature_src(features, fn), f'{fn}: {fv} (электрокотёл: тепловая ≈ потребляемой)')
            elif re.search(r'(\d{1,3})\s*кВт', n):
                put('output_kw', int(re.search(r'(\d{1,3})\s*кВт', n).group(1)), 'kW', 'name', 'мощность в названии')
            if re.search(r'400\s*V|400\s*В|трехфазн', n + ' ' + ' '.join(f[1] for f in features if f[1]), re.I):
                put('phases', 3, None, 'name')
        if 'водонагреват' in nl:
            put('fuel', None, None, 'name')
    elif t == 'ELECTRIC_CONVECTOR':
        m = re.search(r'(\d{3,4})\s*(?:W\b|Вт)', n)
        put('electric_w', int(m.group(1)) if m else None, 'W', 'name', m.group(0) if m else None)
    elif t == 'HEAT_PUMP':
        m = re.search(r'(\d{2,3})\s*кВт', n)
        put('nominal_kw_name', int(m.group(1)) if m else None, 'kW', 'name')
    return a


# ---------------------------------------------------------------------------

def main():
    db, out_json, report_dir = sys.argv[1], sys.argv[2], sys.argv[3]
    db_sha = hashlib.sha256(open(db, 'rb').read()).hexdigest()
    c = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
    tree = {r[0] for r in c.execute(
        f"""with recursive t(id) as (select id from categories where id in ({','.join(map(str, HVAC_ROOTS))})
            union all select c.id from categories c join t on c.parent_id=t.id) select id from t""")}
    cat_slug = dict(c.execute('select id, slug from categories'))
    feats = {}
    for pid, fname, fval in c.execute("select product_id, feature_name, feature_value from product_features where feature_name<>'source' order by product_id, sort_order"):
        feats.setdefault(pid, []).append((fname, fval, 'feature'))
    for pid, desc in c.execute("select id, coalesce(description_ru, '') || ' ' || coalesce(short_description_ru, '') from products where is_active"):
        for k, v in description_pairs(desc):
            feats.setdefault(pid, []).append((k, v, 'description'))
    fc_profiles = {r[0] for r in c.execute("select product_id from engineering_product_profile where equipment_type='FAN_COIL'")}
    profiles = dict(c.execute('select product_id, equipment_type from engineering_product_profile'))
    profile_series = {r[0]: (r[1], r[2]) for r in c.execute('select product_id, series, model from engineering_product_profile')}
    rows = c.execute("""select p.id, p.sku, p.name_ru, coalesce(b.name,''), p.category_id, p.is_active
                        from products p left join brands b on b.id=p.brand_id order by p.sku""").fetchall()

    products, coverage = [], []
    counts = Counter()
    for pid, sku, name, brand, cat, active in rows:
        if not active:
            coverage.append([sku, name, brand, cat_slug.get(cat, ''), 'INACTIVE', 'product is inactive in the catalog'])
            counts['INACTIVE'] += 1
            continue
        in_tree = cat in tree
        t = classify(norm_text(name).lower(), cat, in_tree, pid in fc_profiles)
        if t == 'MANIFOLD_PLUG' and not in_tree and not threads_in(name):
            t = None  # electrical blanking plugs (cable trunking, enclosures) are not hydraulic
        if t is None:
            coverage.append([sku, name, brand, cat_slug.get(cat, ''), 'OUT_OF_SCOPE', 'category outside HVAC/hydraulics/electric heating and no HVAC term in the name'])
            counts['OUT_OF_SCOPE'] += 1
            continue
        counts[t] += 1
        note = '' if in_tree else 'cross-category: found by name outside HVAC trees'
        coverage.append([sku, name, brand, cat_slug.get(cat, ''), t, note])
        if t in RUNTIME_TYPES:
            attrs = extract(t, name, feats.get(pid, []))
            if t == 'FAN_COIL' and pid in profile_series:
                series, model = profile_series[pid]
                if series:
                    attrs['series'] = {'v': series, 'u': None, 'src': 'profile'}
                if model:
                    attrs['model'] = {'v': model, 'u': None, 'src': 'profile'}
            brand_clean = re.sub(r'\s*\(.*\)$', '', brand)
            products.append({'sku': sku, 'name': name, 'brand': brand_clean or None, 'cat': cat_slug.get(cat, ''),
                             'type': t, 'profile': profiles.get(pid), 'attrs': attrs,
                             **({'crossCategory': True} if not in_tree else {})})

    meta = {'schema': 'ohmx.equipment-catalog-profiles.v1', 'dbSha256': db_sha,
            'activeProducts': sum(1 for r in rows if r[5]), 'exported': len(products),
            'note': 'Generated by scripts/build_equipment_catalog_profiles.py from a read-only catalog snapshot. '
                    'Technical identity only: price and stock are always read live.'}
    os.makedirs(os.path.dirname(out_json), exist_ok=True)
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump({'meta': meta, 'products': products}, f, ensure_ascii=False, separators=(',', ':'), sort_keys=False)
        f.write('\n')
    os.makedirs(report_dir, exist_ok=True)
    with open(os.path.join(report_dir, 'catalog_coverage.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['sku', 'name', 'brand', 'category_slug', 'functional_type', 'note'])
        w.writerows(coverage)
    total = len(rows)
    assert len(coverage) == total, 'coverage must account for every product'
    print(json.dumps({'products_total': total, 'exported_profiles': len(products), 'counts': counts.most_common()}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
