// RECOVERY: parity-first TypeScript source reconstructed from verified production runtime JavaScript.
import fs from 'node:fs';
import path from 'node:path';
import { serverSrcRoot } from '../paths.js';

type AnyRecord = Record<string, any>;

const CONFIG_PATH = path.join(serverSrcRoot, 'data', 'warmFloorConfigV3.json');
let configV3: any = null;

export function getWarmFloorConfigV3() {
    if (!configV3) {
        configV3 = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    }
    return configV3;
}

export function reloadWarmFloorConfigV3() {
    configV3 = null;
    return getWarmFloorConfigV3();
}

function round(value: any, digits = 2) {
    const f = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * f) / f;
}

function clean(value: any) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

/** Normalize client/legacy aliases to config keys. */
export function normalizeWarmFloorInputV3(raw: AnyRecord = {}) {
    const coveringMap: Record<string, string> = {
        tile: 'tile',
        porcelain: 'porcelain',
        porcelain_tile: 'porcelain',
        stone: 'stone',
        laminate: 'laminate',
        vinyl: 'vinyl',
        vinyl_lvt: 'vinyl',
        lvt: 'vinyl',
        vinyl_spc: 'vinyl',
        engineered_wood: 'engineered_wood',
        wood: 'engineered_wood',
        other: 'other',
    };
    const substrateMap: Record<string, string> = {
        concrete_screed: 'concrete_screed',
        screed: 'concrete_screed',
        tile_adhesive: 'tile_adhesive',
        adhesive: 'tile_adhesive',
        old_tile: 'old_tile',
        wood: 'wood',
        insulation_board: 'insulation_board',
        other: 'other',
    };
    const purposeMap: Record<string, string> = {
        comfort_floor: 'comfort_floor',
        comfort: 'comfort_floor',
        additional_heating: 'additional_heating',
        additional: 'additional_heating',
        main_heating: 'main_heating',
        primary: 'main_heating',
        local_zone: 'comfort_floor',
    };
    const insulationMap: Record<string, string> = {
        poor: 'poor',
        bad: 'poor',
        low: 'poor',
        standard: 'standard',
        normal: 'standard',
        medium: 'standard',
        good: 'good',
        high: 'good',
        excellent: 'excellent',
    };

    const roomAreaM2 = Math.max(0, Number(raw.roomAreaM2 ?? raw.totalAreaM2 ?? 0));
    const explicitHeatedArea = raw.installationAreaM2 ?? raw.heatedAreaM2;
    const excludedAreaM2 = Math.max(0, Number(raw.excludedAreaM2 ?? 0));
    const installationAreaM2 = explicitHeatedArea !== undefined && explicitHeatedArea !== null && explicitHeatedArea !== ''
        ? Math.max(0, Number(explicitHeatedArea))
        : (roomAreaM2 > 0 && excludedAreaM2 > 0 ? Math.max(0, roomAreaM2 - excludedAreaM2) : 0);

    return {
        roomType: raw.roomType || raw.roomPurpose || 'other',
        roomAreaM2: round(roomAreaM2, 2),
        excludedAreaM2: round(Math.max(excludedAreaM2, roomAreaM2 - installationAreaM2), 2),
        installationAreaM2: round(installationAreaM2, 2),
        substrateType: substrateMap[raw.substrateType] || 'concrete_screed',
        floorCovering: coveringMap[raw.floorCovering] || 'tile',
        heatingPurpose: purposeMap[raw.heatingPurpose || raw.heatingGoal] || 'comfort_floor',
        insulationLevel: insulationMap[raw.insulationLevel] || 'standard',
        budgetLevel: raw.budgetLevel || 'premium',
        includeAccessories: raw.includeAccessories !== false,
        systemPreference: ['mat', 'cable', 'auto'].includes(raw.systemPreference) ? raw.systemPreference : 'auto',
        wetZone: Boolean(raw.wetZone),
        preferredBrands: Array.isArray(raw.preferredBrands) ? raw.preferredBrands.map(String).filter(Boolean) : [],
        heatLossW: Number.isFinite(Number(raw.heatLossW)) ? Number(raw.heatLossW) : null,
        regionProfile: String(raw.regionProfile || 'AM').toUpperCase(),
    };
}

export function validateWarmFloorInputV3(input: AnyRecord, config: any = getWarmFloorConfigV3()) {
    const errors: AnyRecord[] = [];
    const warnings: AnyRecord[] = [];
    const rules = config.validationRules || {};
    if (!Number.isFinite(input.roomAreaM2) || input.roomAreaM2 < Number(rules.roomAreaM2?.min || 1))
        errors.push({ code: 'validation.roomArea', params: { min: Number(rules.roomAreaM2?.min || 1) } });
    if (!Number.isFinite(input.installationAreaM2) || input.installationAreaM2 < Number(rules.installationAreaM2?.min || 0.5))
        errors.push({ code: 'validation.heatedArea', params: { min: Number(rules.installationAreaM2?.min || 0.5) } });
    if (input.installationAreaM2 > input.roomAreaM2)
        errors.push({ code: 'validation.heatedAreaExceedsRoom', params: { roomAreaM2: input.roomAreaM2, installationAreaM2: input.installationAreaM2 } });
    const ratio = input.roomAreaM2 > 0 ? input.installationAreaM2 / input.roomAreaM2 : 0;
    const suspicious = Number(rules.installationAreaM2?.suspiciousRatioWarningAbove || 0.9);
    if (ratio > suspicious && input.roomAreaM2 >= 3)
        warnings.push({ code: 'warnings.heatedAreaSuspicious', params: { percent: round(ratio * 100, 0) } });
    return { valid: errors.length === 0, errors, warnings };
}

export function brandTier(brandOrName: any) {
    const text = clean(brandOrName);
    if (['devi', 'danfoss', 'legrand'].some((b) => text.includes(b)))
        return 'premium';
    if (['fenix', 'oj electronics', 'oj ', 'nvent'].some((b) => text.includes(b)))
        return 'standard';
    if (['hif', 'eftm', 'longwell'].some((b) => text.includes(b)))
        return 'economy';
    return 'economy';
}

export function brandTierRank(tier: any) {
    if (tier === 'premium')
        return 0;
    if (tier === 'standard')
        return 1;
    return 2;
}

/**
 * Design target density q [W/m²]:
 * q = room_profile_default * insulation_factor
 * q = min(q, covering.maxInstalledPowerWm2)
 *
 * Required power:
 * comfort/additional: P = A_install * q
 * main heating: P = max(A_install * q_fallback, heatLossW * margin) when heat loss known
 */
export function resolveDesignTargets(input: AnyRecord, config: any = getWarmFloorConfigV3()) {
    const room = config.roomPowerProfilesWm2[input.roomType] || config.roomPowerProfilesWm2.other;
    const purposeKey = input.heatingPurpose in (room || {}) ? input.heatingPurpose : 'comfort_floor';
    const purpose = room[purposeKey] || room.comfort_floor || { default: 140, range: [100, 160] };
    const covering = config.floorCoverings[input.floorCovering] || config.floorCoverings.other;
    const substrate = config.substrates[input.substrateType] || config.substrates.other;

    const insulationFactors = config.insulationFactors || {
        poor: 1.15,
        standard: 1.0,
        good: 0.92,
        excellent: 0.88,
    };
    const insulationFactor = Number(insulationFactors[input.insulationLevel] || 1);

    let rawTargetWm2 = Number(purpose.default || 140) * insulationFactor;
    // Balcony / wet rooms already have higher defaults; keep within the configured purpose range.
    if (Array.isArray(purpose.range) && purpose.range.length === 2) {
        const [minQ, maxQ] = purpose.range;
        rawTargetWm2 = Math.min(Math.max(rawTargetWm2, minQ * Math.min(insulationFactor, 1)), maxQ * Math.max(insulationFactor, 1));
    }

    const coveringMax = Number(covering.maxInstalledPowerWm2 || 220);
    const coveringLimited = rawTargetWm2 > coveringMax;
    rawTargetWm2 = Math.min(rawTargetWm2, coveringMax);

    let rawRequiredTotalPowerW = input.installationAreaM2 * rawTargetWm2;
    let mainHeatingMode = 'area_fallback';
    if (input.heatingPurpose === 'main_heating') {
        if (input.heatLossW && input.heatLossW > 0) {
            const margin = (config.designRules?.heatingPurpose?.main_heating?.designMarginRange || [1.15, 1.25])[1];
            rawRequiredTotalPowerW = Math.max(rawRequiredTotalPowerW, input.heatLossW * margin);
            rawTargetWm2 = input.installationAreaM2 > 0 ? rawRequiredTotalPowerW / input.installationAreaM2 : rawTargetWm2;
            mainHeatingMode = 'heat_loss';
        }
        else {
            mainHeatingMode = 'area_fallback_needs_heat_loss';
        }
    }
    const targetWm2 = round(rawTargetWm2, 1);
    const requiredTotalPowerW = round(rawRequiredTotalPowerW, 0);

    // Preferred system by substrate / covering (standards-oriented defaults).
    let preferredSystem = 'auto';
    if (substrate.preferredSystem === 'mat' || substrate.preferredSystem === 'cable')
        preferredSystem = substrate.preferredSystem;
    if (covering.standardWetMatAllowed && !covering.standardWetCableAllowed)
        preferredSystem = 'mat';
    if (!covering.standardWetMatAllowed && covering.standardWetCableAllowed)
        preferredSystem = 'cable';
    if (substrate.blockStandardWetSelection)
        preferredSystem = 'blocked';

    // Indoor floor cables: typical linear power 10–20 W/m. >22 W/m treated as high-output / outdoor class.
    const indoorCableLinearPowerMaxWm = Number(config.cableDesign?.indoorMaxLinearPowerWm || 20);
    const idealSpacing = config.cableDesign?.designSpacingCm || { minimum: 7.5, maximum: 15, hardMinimum: 5, preferredMax: 12.5 };

    return {
        targetInstalledPowerWm2: targetWm2,
        requiredTotalPowerW,
        internalTargetInstalledPowerWm2: rawTargetWm2,
        internalRequiredTotalPowerW: rawRequiredTotalPowerW,
        coveringMaxWm2: coveringMax,
        coveringLimited,
        floorTemperatureLimitC: Number(covering.defaultFloorTemperatureLimitC || 27),
        covering,
        substrate,
        purpose,
        insulationFactor,
        preferredSystem,
        mainHeatingMode,
        indoorCableLinearPowerMaxWm,
        spacingRules: {
            hardMin: Number(idealSpacing.hardMinimum || 5),
            warnMin: Number(idealSpacing.minimum || 7.5),
            idealMax: Number(idealSpacing.preferredMax || idealSpacing.maximum || 12.5),
            hardMax: Number(config.validationRules?.cableSpacingCm?.warnAbove || idealSpacing.maximum || 20),
        },
        regionProfile: input.regionProfile,
        voltageV: Number(config.regionProfiles?.[input.regionProfile]?.nominalVoltageV || config.electricalSystem?.nominalVoltageV || 230),
        mountingTape: config.mountingTape || { rowSpacingM: 0.5, wasteFactor: 1.1, minimumLengthM: 2 },
        protection: config.electricalProtection || {},
        validationWarnings: validateWarmFloorInputV3(input, config).warnings,
    };
}

export function estimateMountingTapeLengthM(installationAreaM2: number, mountingTape: AnyRecord) {
    const row = Number(mountingTape.rowSpacingM || 0.5);
    const waste = Number(mountingTape.wasteFactor || 1.1);
    const minM = Number(mountingTape.minimumLengthM || 2);
    const raw = installationAreaM2 > 0 && row > 0 ? (installationAreaM2 / row) * waste : minM;
    return Math.max(minM, Math.ceil(raw));
}

/**
 * Recalculate engineering result for a concrete selected product.
 * Standards:
 * - I = P / U
 * - q_actual = P / A_install
 * - cable spacing C_cm = A_m2 * 100 / L_m
 * - mat coverage = A_mat / A_install
 */
export function calculateWarmFloorV3(input: AnyRecord, product: AnyRecord, design: any = null) {
    const config = getWarmFloorConfigV3();
    const resolvedInput = input.installationAreaM2 != null ? input : normalizeWarmFloorInputV3(input);
    const targets = design || resolveDesignTargets(resolvedInput, config);
    const voltageV = targets.voltageV;

    const actualPowerW = Number(product.powerW || (product.powerKw ? product.powerKw * 1000 : 0)) || 0;
    const actualCurrentA = round(actualPowerW / voltageV, config.electricalSystem?.currentCalculation?.displayDecimals || 2);
    const actualWm2 = resolvedInput.installationAreaM2 > 0
        ? round(actualPowerW / resolvedInput.installationAreaM2, 1)
        : 0;

    const result: AnyRecord = {
        roomAreaM2: resolvedInput.roomAreaM2,
        excludedAreaM2: resolvedInput.excludedAreaM2,
        installationAreaM2: resolvedInput.installationAreaM2,
        heatingPurpose: resolvedInput.heatingPurpose,
        insulationLevel: resolvedInput.insulationLevel,
        insulationFactor: targets.insulationFactor,
        targetInstalledPowerWm2: targets.targetInstalledPowerWm2,
        requiredTotalPowerW: targets.requiredTotalPowerW,
        selectedProductTotalPowerW: Math.round(actualPowerW),
        actualInstalledPowerWm2: actualWm2,
        actualCurrentA,
        floorTemperatureLimitC: targets.floorTemperatureLimitC,
        voltageV,
        powerFitPercent: targets.requiredTotalPowerW > 0
            ? round((actualPowerW / targets.requiredTotalPowerW) * 100, 1)
            : 0,
        mainHeatingMode: targets.mainHeatingMode,
        // aliases used by older UI
        selectedPowerW: Math.round(actualPowerW),
        actualPowerWm2: actualWm2,
    };

    if (product.productType === 'heating_cable') {
        const cableLength = Number(product.cableLengthM || 0) || null;
        const linearPowerWm = Number(product.linearPowerWm || 0)
            || (cableLength && actualPowerW ? round(actualPowerW / cableLength, 2) : null);
        result.cableLengthM = cableLength;
        result.linearPowerWm = linearPowerWm;
        if (cableLength && resolvedInput.installationAreaM2 > 0) {
            result.spacingCm = round((resolvedInput.installationAreaM2 * 100) / cableLength, 1);
            // Theoretical spacing for target density: C = p_linear * 100 / q_target
            if (linearPowerWm && targets.targetInstalledPowerWm2 > 0)
                result.designSpacingCm = round((linearPowerWm * 100) / targets.targetInstalledPowerWm2, 1);
        }
        result.mountingTapeLengthM = estimateMountingTapeLengthM(resolvedInput.installationAreaM2, targets.mountingTape);
    }
    else if (product.productType === 'heating_mat') {
        const matArea = Number(product.matAreaM2 || 0) || null;
        result.totalMatAreaM2 = matArea;
        result.matPowerDensityWm2 = matArea && actualPowerW ? round(actualPowerW / matArea, 1) : null;
        if (resolvedInput.installationAreaM2 > 0 && matArea != null) {
            result.coveragePercent = round((matArea / resolvedInput.installationAreaM2) * 100, 1);
        }
        result.coveredAreaM2 = matArea;
    }

    return result;
}

export function getWarningsV3(input: AnyRecord, result: AnyRecord, product: AnyRecord, design: any = null) {
    const config = getWarmFloorConfigV3();
    const resolvedInput = input.installationAreaM2 != null ? input : normalizeWarmFloorInputV3(input);
    const targets = design || resolveDesignTargets(resolvedInput, config);
    const warnings: AnyRecord[] = [...(targets.validationWarnings || [])];
    const add = (code: string, params: AnyRecord = {}) => warnings.push({ code, params });

    add('warnings.noShorten');
    add('warnings.noFixedFurniture');
    add('warnings.noCrossing');
    add('warnings.rcdRequired');
    add('warnings.qualifiedElectrician');
    add('warnings.sensorRequired');

    if (resolvedInput.heatingPurpose === 'main_heating' && targets.mainHeatingMode !== 'heat_loss')
        add('warnings.heatLossRequired');
    if (targets.coveringLimited || result.actualInstalledPowerWm2 > targets.coveringMaxWm2)
        add('warnings.coveringLimit', { maxWm2: targets.coveringMaxWm2, maxFloorTempC: targets.floorTemperatureLimitC });
    if (targets.covering.requiresManufacturerApproval)
        add('warnings.coveringManufacturerApproval', { maxFloorTempC: targets.floorTemperatureLimitC });
    if (targets.covering.requiresFloorSensorAndLimit)
        add('warnings.coveringTemperatureLimit', { maxFloorTempC: targets.floorTemperatureLimitC });
    if (targets.substrate?.blockStandardWetSelection && !product.isSpecialDrySystem)
        add('warnings.specialDrySystemRequired');
    if (resolvedInput.insulationLevel === 'poor' || resolvedInput.roomType === 'balcony' || resolvedInput.heatingPurpose === 'main_heating')
        add('warnings.insulationRecommended');

    if (result.spacingCm != null) {
        const s = targets.spacingRules;
        if (result.spacingCm < s.hardMin || result.spacingCm > s.hardMax)
            add('warnings.cableSpacingOutOfRange', { spacingCm: result.spacingCm, minCm: s.hardMin, maxCm: s.hardMax });
        else if (result.spacingCm < s.warnMin)
            add('warnings.cableSpacingLow', { spacingCm: result.spacingCm, preferredMinCm: s.warnMin });
        else if (result.spacingCm > s.idealMax)
            add('warnings.cableSpacingHigh', { spacingCm: result.spacingCm, preferredMaxCm: s.idealMax });
    }
    if (product.productType === 'heating_cable' && result.linearPowerWm > targets.indoorCableLinearPowerMaxWm)
        add('warnings.linearPowerTooHigh', { linearPowerWm: result.linearPowerWm, maxLinearPowerWm: targets.indoorCableLinearPowerMaxWm });
    if (product.productType === 'heating_mat' && result.coveragePercent != null && result.coveragePercent < 80)
        add('warnings.matCoverageLow', { coveragePercent: result.coveragePercent });
    if (result.powerFitPercent && result.powerFitPercent < 85)
        add('warnings.powerUnder', { powerFitPercent: result.powerFitPercent });
    if (result.powerFitPercent && result.powerFitPercent > 120)
        add('warnings.powerOver', { powerFitPercent: result.powerFitPercent });

    const relay = Number(config.electricalProtection?.thermostatRelay?.defaultMaxResistiveLoadA || 16);
    const threshold = Number(config.electricalProtection?.thermostatRelay?.recommendedContactorUtilizationThreshold || 0.8);
    if (result.actualCurrentA > relay * threshold)
        add('warnings.thermostatRelayLimit', { currentA: result.actualCurrentA, relayA: relay, thresholdPercent: round(threshold * 100, 0) });

    const seen = new Set<string>();
    return warnings.filter((item) => {
        const key = `${item.code}:${JSON.stringify(item.params || {})}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizedList(values: any): string[] {
    return Array.isArray(values) ? values.map((value) => clean(value).replace(/[\s-]+/g, '_')) : [];
}

/** Phase A: hard engineering compatibility only. No brand/price ranking here. */
export function evaluateProductCompatibility(product: AnyRecord, input: AnyRecord, design: AnyRecord) {
    const reasons: AnyRecord[] = [];
    const reject = (code: string, params: AnyRecord = {}) => reasons.push({ code, params });
    const covering = design.covering;
    const substrate = design.substrate;
    const productCoverings = normalizedList(product.floorCoverings);
    const productSubstrates = normalizedList(product.substrateTypes);
    const productRooms = normalizedList(product.roomTypes);
    const coveringKey = clean(input.floorCovering).replace(/[\s-]+/g, '_');
    const substrateKey = clean(input.substrateType).replace(/[\s-]+/g, '_');
    const roomKey = clean(input.roomType).replace(/[\s-]+/g, '_');

    if (productCoverings.length && !productCoverings.includes(coveringKey))
        reject('compatibility.productCoveringMismatch', { covering: coveringKey });
    if (covering.requireExplicitProductApproval && !productCoverings.includes(coveringKey))
        reject('compatibility.explicitCoveringApprovalRequired', { covering: coveringKey });
    if (productSubstrates.length && !productSubstrates.includes(substrateKey))
        reject('compatibility.productSubstrateMismatch', { substrate: substrateKey });
    if (productRooms.length && !productRooms.includes(roomKey))
        reject('compatibility.productRoomMismatch', { room: roomKey });

    if (product.productType === 'heating_mat') {
        if (['tile_adhesive', 'old_tile'].includes(substrateKey) && product.approvedForThinLayer !== true)
            reject('compatibility.thinLayerManufacturerApprovalMissing', { substrate: substrateKey });
        const wetMatAllowed = covering.standardWetMatAllowed === true;
        const specialDryAllowed = covering.specialDrySystemAllowed === true && product.isSpecialDrySystem === true;
        if (!wetMatAllowed && !specialDryAllowed)
            reject('compatibility.matNotAllowedForCovering', { covering: coveringKey });
        if (substrate.standardMatAllowed !== true && !(substrate.blockStandardWetSelection && product.isSpecialDrySystem === true))
            reject('compatibility.matNotAllowedForSubstrate', { substrate: substrateKey });
        const matArea = Number(product.matAreaM2 || 0);
        if (!matArea)
            reject('compatibility.matAreaMissing');
        else if (matArea > input.installationAreaM2 + 1e-6)
            reject('compatibility.matAreaExceedsHeatedArea', { matAreaM2: matArea, heatedAreaM2: input.installationAreaM2 });
        else if ((matArea / input.installationAreaM2) < 0.55)
            reject('compatibility.matCoverageTooLow', { coveragePercent: round((matArea / input.installationAreaM2) * 100, 1) });
    } else if (product.productType === 'heating_cable') {
        const wetCableAllowed = covering.standardWetCableAllowed === true;
        const specialDryAllowed = covering.specialDrySystemAllowed === true && product.isSpecialDrySystem === true;
        if (!wetCableAllowed && !specialDryAllowed)
            reject('compatibility.cableNotAllowedForCovering', { covering: coveringKey });
        if (substrate.standardCableAllowed !== true && !(substrate.thinCableAllowedIfProductApproved && product.approvedForThinLayer === true))
            reject('compatibility.cableNotAllowedForSubstrate', { substrate: substrateKey });
        if (substrate.blockStandardWetSelection && product.isSpecialDrySystem !== true)
            reject('compatibility.standardWetSystemBlocked', { substrate: substrateKey });
        const length = Number(product.cableLengthM || 0);
        const powerW = Number(product.powerW || 0);
        const linear = Number(product.linearPowerWm || 0) || (length && powerW ? powerW / length : 0);
        if (!length)
            reject('compatibility.cableLengthMissing');
        if (!linear)
            reject('compatibility.linearPowerMissing');
        if (linear > design.indoorCableLinearPowerMaxWm + 1e-9)
            reject('compatibility.linearPowerTooHigh', { linearPowerWm: round(linear, 1), maxLinearPowerWm: design.indoorCableLinearPowerMaxWm });
        if (length > 0 && input.installationAreaM2 > 0) {
            const spacing = (input.installationAreaM2 * 100) / length;
            const minSpacing = Number(product.minSpacingCm || design.spacingRules.hardMin);
            const maxSpacing = Number(product.maxSpacingCm || design.spacingRules.hardMax);
            if (spacing < minSpacing || spacing > maxSpacing)
                reject('compatibility.cableSpacingOutOfRange', { spacingCm: round(spacing, 1), minCm: minSpacing, maxCm: maxSpacing });
        }
    } else {
        reject('compatibility.unsupportedMainProductType');
    }

    const actualWm2 = input.installationAreaM2 > 0 ? Number(product.powerW || 0) / input.installationAreaM2 : 0;
    if (!product.powerW || product.powerW < 50)
        reject('compatibility.powerMissing');
    if (actualWm2 > design.coveringMaxWm2 + 1e-9)
        reject('compatibility.coveringPowerExceeded', { actualWm2: round(actualWm2, 1), maxWm2: design.coveringMaxWm2 });
    const powerFit = design.requiredTotalPowerW > 0 ? Number(product.powerW || 0) / design.requiredTotalPowerW : 0;
    const minimumFit = input.heatingPurpose === 'main_heating' ? 1.0 : 0.85;
    if (powerFit < minimumFit)
        reject('compatibility.powerTooLow', { powerFitPercent: round(powerFit * 100, 1), minimumPercent: round(minimumFit * 100, 0) });
    if (powerFit > 1.2)
        reject('compatibility.powerTooHigh', { powerFitPercent: round(powerFit * 100, 1), maximumPercent: 120 });
    if (input.wetZone && product.wetZoneAllowed !== true)
        reject(product.wetZoneAllowed === false ? 'compatibility.wetZoneNotAllowed' : 'compatibility.wetZoneApprovalMissing');
    if (product.availabilityStatus === 'unavailable')
        reject('compatibility.unavailable');

    return { ok: reasons.length === 0, reasons };
}

/** Phase A engineering-fit score. Commercial tier/price/brand are intentionally excluded. */
export function scoreWarmFloorCandidate(product: AnyRecord, input: AnyRecord, design: AnyRecord, calc: AnyRecord) {
    let score = Math.abs((product.powerW || 0) - design.requiredTotalPowerW) / Math.max(design.requiredTotalPowerW, 1) * 120;
    if (product.productType === 'heating_mat') {
        const coverage = Number(calc.coveragePercent || 0);
        score += Math.abs(100 - coverage) * 0.8;
        if (coverage >= 90 && coverage <= 100) score -= 20;
        const density = Number(calc.matPowerDensityWm2 || 0);
        if (density) score += Math.abs(density - design.targetInstalledPowerWm2) * 0.15;
    }
    if (product.productType === 'heating_cable') {
        const spacing = Number(calc.spacingCm || 0);
        const ideal = (design.spacingRules.warnMin + design.spacingRules.idealMax) / 2;
        score += Math.abs(spacing - ideal) * 3;
        if (spacing >= design.spacingRules.warnMin && spacing <= design.spacingRules.idealMax) score -= 15;
    }
    if (design.preferredSystem === 'mat' && product.productType !== 'heating_mat') score += 35;
    if (design.preferredSystem === 'cable' && product.productType !== 'heating_cable') score += 15;
    return round(score, 3);
}

