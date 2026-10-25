// RECOVERY: parity-first TypeScript source reconstructed from verified production runtime JavaScript.
import {
    getWarmFloorConfigV3,
    normalizeWarmFloorInputV3,
    validateWarmFloorInputV3,
    resolveDesignTargets,
    calculateWarmFloorV3,
    getWarningsV3,
    evaluateProductCompatibility,
    scoreWarmFloorCandidate,
    brandTier,
    brandTierRank,
} from './warmFloorEngineV3.js';
import { warmFloorProductRows } from './warmFloorProducts.js';

type AnyRecord = Record<string, any>;

function cleanText(value: any) {
    return String(value || '').toLowerCase().replace(/ё/g, 'е');
}

function round(value: any, digits = 1) {
    const factor = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function availabilityRank(status: any) {
    return status === 'in_stock' ? 0 : status === 'low_stock' ? 1 : status === 'preorder' ? 2 : 9;
}

function priceOrMax(product: any) {
    return Number.isFinite(Number(product?.price)) ? Number(product.price) : Number.MAX_SAFE_INTEGER;
}

function productIdentity(product: any) {
    return `${Number(product?.id || 0)}:${String(product?.sku || '').trim().toLowerCase()}`;
}

function isSameProduct(a: any, b: any) {
    if (!a || !b) return false;
    if (Number(a.id) > 0 && Number(a.id) === Number(b.id)) return true;
    const aSku = String(a.sku || '').trim().toLowerCase();
    const bSku = String(b.sku || '').trim().toLowerCase();
    return Boolean(aSku && bSku && aSku === bSku);
}

function productMatchesGroup(product: any, group: string) {
    const type = cleanText(product?.productType);
    const accessory = cleanText(product?.accessoryGroup);
    if (group === 'rcd') return type === 'rcd' || accessory === 'rcd';
    if (group === 'rcbo') return type === 'rcbo' || accessory === 'rcbo';
    if (group === 'circuit_breaker') return type === 'circuit_breaker' || accessory === 'circuit_breaker';
    return type === group || accessory === group;
}

function commercialSort(list: any[], preferredBrands: any[] = []) {
    const preferred = preferredBrands.map(cleanText);
    return [...list].sort((a, b) => {
        const aPreferred = preferred.some((name) => cleanText(a.product.brand).includes(name));
        const bPreferred = preferred.some((name) => cleanText(b.product.brand).includes(name));
        return Number(bPreferred) - Number(aPreferred)
            || availabilityRank(a.product.availabilityStatus) - availabilityRank(b.product.availabilityStatus)
            || a.engineeringScore - b.engineeringScore
            || Number(b.product.calculatorPriority || 0) - Number(a.product.calculatorPriority || 0)
            || priceOrMax(a.product) - priceOrMax(b.product);
    });
}

function sortAccessoriesPremiumFirst(list: any[]) {
    return [...list].sort((a, b) => brandTierRank(brandTier(`${a.brand} ${a.name}`)) - brandTierRank(brandTier(`${b.brand} ${b.name}`))
        || availabilityRank(a.availabilityStatus) - availabilityRank(b.availabilityStatus)
        || Number(b.calculatorPriority || 0) - Number(a.calculatorPriority || 0)
        || priceOrMax(a) - priceOrMax(b));
}

function decorateAccessory(product: any, meta: AnyRecord) {
    return {
        ...product,
        role: meta.role,
        accessoryGroup: meta.group,
        groupLabelCode: `accessoryGroups.${meta.group}`,
        required: Boolean(meta.required),
        quantity: Number(meta.quantity || 1),
        noteCode: meta.noteCode || '',
        noteParams: meta.noteParams || {},
        selectionReasonCode: meta.reasonCode || '',
        selectionReasonParams: meta.reasonParams || {},
        replacementFor: meta.replacementFor || null,
        protectionScheme: meta.protectionScheme || null,
        brandTier: brandTier(`${product.brand} ${product.name}`),
        ...(meta.measurement || {}),
    };
}

function standardBreakerOrientation(currentA: any, config: any) {
    const protection = config.electricalProtection?.overcurrentProtection || {};
    const factor = Number(protection.orientationFactor || 1.25);
    const ratings = Array.isArray(protection.standardRatingsA) ? protection.standardRatingsA.map(Number) : [6, 10, 13, 16, 20, 25, 32, 40, 50, 63];
    const designCurrentA = Number(currentA || 0) * factor;
    const ratingA = ratings.find((value: number) => value >= designCurrentA) || ratings[ratings.length - 1];
    return { factor, designCurrentA, ratingA };
}

function pickThermostats(products: any[], currentA: number) {
    return sortAccessoriesPremiumFirst(products.filter((product) => {
        if (!productMatchesGroup(product, 'thermostat') || product.availabilityStatus === 'unavailable') return false;
        const name = cleanText(`${product.name} ${product.categoryName}`);
        if (['охладител', 'бутылок', 'радиатор', 'refriger', 'hvac', 'living connect', 'devireg 850'].some((value) => name.includes(value))) return false;
        const loadA = Number(product.maxResistiveLoadA || 0);
        return loadA > 0 || name.includes('devireg');
    })).sort((a, b) => {
        const aLoad = Number(a.maxResistiveLoadA || 16);
        const bLoad = Number(b.maxResistiveLoadA || 16);
        const aCanSwitch = aLoad >= currentA;
        const bCanSwitch = bLoad >= currentA;
        const aSensor = a.sensorIncluded === true;
        const bSensor = b.sensorIncluded === true;
        return Number(bCanSwitch) - Number(aCanSwitch)
            || Number(bSensor) - Number(aSensor)
            || brandTierRank(brandTier(`${a.brand} ${a.name}`)) - brandTierRank(brandTier(`${b.brand} ${b.name}`))
            || availabilityRank(a.availabilityStatus) - availabilityRank(b.availabilityStatus)
            || priceOrMax(a) - priceOrMax(b);
    });
}

function pickProtection(products: any[], group: string, targetA: number, tripMa: any = null) {
    return products.filter((product) => productMatchesGroup(product, group) && product.availabilityStatus !== 'unavailable')
        .filter((product) => Number(product.ratedCurrentA || 0) >= targetA)
        .filter((product) => tripMa == null || Number(product.tripCurrentMa || 0) === tripMa)
        .sort((a, b) => {
            const aQuality = /legrand|tx³|dx³|rx³|abb|schneider/i.test(`${a.brand} ${a.name}`);
            const bQuality = /legrand|tx³|dx³|rx³|abb|schneider/i.test(`${b.brand} ${b.name}`);
            return Number(bQuality) - Number(aQuality)
                || availabilityRank(a.availabilityStatus) - availabilityRank(b.availabilityStatus)
                || Number(a.ratedCurrentA || 0) - Number(b.ratedCurrentA || 0)
                || priceOrMax(a) - priceOrMax(b);
        });
}

function pickMountingBox(products: any[]) {
    return products.filter((product) => productMatchesGroup(product, 'mounting_box') && product.availabilityStatus !== 'unavailable')
        .sort((a, b) => {
            const score = (product: any) => {
                const text = cleanText(product.name);
                return (text.includes('batibox') ? -20 : 0)
                    + (text.includes('1 пост') || text.includes('1 post') ? -20 : 0)
                    + (text.includes('40 мм') || text.includes('50 мм') ? -8 : 0)
                    + (text.includes('2 пост') || text.includes('3 пост') ? 25 : 0)
                    + availabilityRank(product.availabilityStatus) * 20;
            };
            return score(a) - score(b) || priceOrMax(a) - priceOrMax(b);
        })[0];
}

function buildProfessionalAccessories(allProducts: any[], context: AnyRecord, config: any) {
    const accessories: AnyRecord[] = [];
    const replacements: AnyRecord[] = [];
    const missingRequirements: AnyRecord[] = [];
    const usedIds = new Set<number>();
    const usedSkus = new Set<string>();

    const push = (product: any, meta: AnyRecord, bucket: AnyRecord[] = accessories) => {
        if (!product) return false;
        const id = Number(product.id || 0);
        const sku = String(product.sku || '').trim().toLowerCase();
        if ((id && usedIds.has(id)) || (sku && usedSkus.has(sku))) return false;
        if (id) usedIds.add(id);
        if (sku) usedSkus.add(sku);
        bucket.push(decorateAccessory(product, meta));
        return true;
    };
    const missing = (group: string, specificationCode: string, params: AnyRecord = {}) => missingRequirements.push({ group, specificationCode, params });

    const thermostats = pickThermostats(allProducts, context.actualCurrentA);
    const thermostat = thermostats[0];
    const defaultRelayA = Number(config.electricalProtection?.thermostatRelay?.defaultMaxResistiveLoadA || 16);
    const thermostatLoadA = Number(thermostat?.maxResistiveLoadA || defaultRelayA);
    if (thermostat) {
        push(thermostat, {
            group: 'thermostat', role: 'required_control', required: true,
            noteCode: 'accessoryNotes.thermostat', noteParams: { loadA: thermostatLoadA },
            reasonCode: 'accessoryReasons.control',
        });
        const primaryTier = brandTier(`${thermostat.brand} ${thermostat.name}`);
        const cheaper = thermostats.find((candidate) => !isSameProduct(candidate, thermostat)
            && (brandTierRank(brandTier(`${candidate.brand} ${candidate.name}`)) > brandTierRank(primaryTier)
                || priceOrMax(candidate) < priceOrMax(thermostat) * 0.85));
        push(cheaper, {
            group: 'thermostat', role: 'replacement_control', required: false,
            noteCode: 'accessoryNotes.thermostatReplacement', reasonCode: 'accessoryReasons.replacement',
            replacementFor: thermostat.id,
        }, replacements);
    } else {
        missing('thermostat', 'requirements.thermostat', { minimumLoadA: round(context.actualCurrentA, 2), floorSensorInput: true });
    }

    const sensorIncluded = thermostat?.sensorIncluded === true;
    if (!sensorIncluded) {
        const sensor = sortAccessoriesPremiumFirst(allProducts.filter((product) => productMatchesGroup(product, 'floor_sensor') && product.availabilityStatus !== 'unavailable'))[0];
        if (!push(sensor, {
            group: 'floor_sensor', role: 'required_sensor', required: true,
            noteCode: 'accessoryNotes.floorSensor', reasonCode: 'accessoryReasons.temperatureControl',
        })) missing('floor_sensor', 'requirements.floorSensor');
    }

    const box = pickMountingBox(allProducts);
    if (!push(box, {
        group: 'mounting_box', role: 'required_install', required: true,
        noteCode: 'accessoryNotes.mountingBox', reasonCode: 'accessoryReasons.mounting',
    })) missing('mounting_box', 'requirements.mountingBox');

    const conduit = sortAccessoriesPremiumFirst(allProducts.filter((product) => productMatchesGroup(product, 'corrugated_tube') && product.availabilityStatus !== 'unavailable'))[0];
    if (!push(conduit, {
        group: 'corrugated_tube', role: 'required_sensor_path', required: true,
        noteCode: 'accessoryNotes.sensorConduit', reasonCode: 'accessoryReasons.sensorServicePath',
    })) {
        accessories.push({
            id: -1001,
            slug: '',
            sku: 'WF-SENSOR-CONDUIT',
            name: '',
            nameCode: 'manualItems.sensorConduit',
            brand: '',
            article: 'WF-SENSOR-CONDUIT',
            price: null,
            currency: 'AMD',
            image: '',
            availabilityStatus: 'preorder',
            productType: 'corrugated_tube',
            accessoryGroup: 'corrugated_tube',
            groupLabelCode: 'accessoryGroups.corrugated_tube',
            role: 'required_sensor_path',
            required: true,
            quantity: 1,
            noteCode: 'accessoryNotes.sensorConduitManual',
            noteParams: { diameterMinMm: 10, diameterMaxMm: 16 },
            selectionReasonCode: 'accessoryReasons.sensorServicePath',
            isManualLineItem: true,
            brandTier: 'standard',
        });
    }

    const breaker = standardBreakerOrientation(context.actualCurrentA, config);
    const breakers = pickProtection(allProducts, 'circuit_breaker', breaker.ratingA);
    const rcdTripMa = Number(config.electricalProtection?.rcd?.maximumTripCurrentMa || 30);
    const rcds = pickProtection(allProducts, 'rcd', Math.max(breaker.ratingA, 25), rcdTripMa);
    const rcbos = pickProtection(allProducts, 'rcbo', breaker.ratingA, rcdTripMa);

    if (breakers[0] && rcds[0]) {
        push(breakers[0], {
            group: 'circuit_breaker', role: 'required_protection', required: true, protectionScheme: 'mcb_rcd',
            noteCode: 'accessoryNotes.breakerOrientation',
            noteParams: { currentA: round(context.actualCurrentA, 2), designCurrentA: round(breaker.designCurrentA, 2), orientationFactor: breaker.factor, ratingA: breaker.ratingA },
            reasonCode: 'accessoryReasons.overcurrentProtection',
        });
        push(rcds[0], {
            group: 'rcd', role: 'required_protection', required: true, protectionScheme: 'mcb_rcd',
            noteCode: 'accessoryNotes.rcd', noteParams: { tripMa: rcdTripMa },
            reasonCode: 'accessoryReasons.residualProtection',
        });
        if (rcbos[0]) push(rcbos[0], {
            group: 'rcbo', role: 'replacement_protection_scheme', required: false, protectionScheme: 'rcbo',
            noteCode: 'accessoryNotes.rcboAlternative', noteParams: { tripMa: rcdTripMa, ratingA: rcbos[0].ratedCurrentA },
            reasonCode: 'accessoryReasons.protectionAlternative', replacementFor: `${breakers[0].id}+${rcds[0].id}`,
        }, replacements);
    } else if (rcbos[0]) {
        push(rcbos[0], {
            group: 'rcbo', role: 'required_protection', required: true, protectionScheme: 'rcbo',
            noteCode: 'accessoryNotes.rcbo', noteParams: { tripMa: rcdTripMa, ratingA: rcbos[0].ratedCurrentA },
            reasonCode: 'accessoryReasons.combinedProtection',
        });
    } else {
        if (!breakers[0]) missing('circuit_breaker', 'requirements.breaker', { orientationRatingA: breaker.ratingA });
        if (!rcds[0]) missing('rcd_or_rcbo', 'requirements.residualProtection', { maximumTripMa: rcdTripMa, minimumRatedCurrentA: breaker.ratingA });
    }

    if (breakers[1]) push(breakers[1], {
        group: 'circuit_breaker', role: 'replacement_protection', required: false,
        noteCode: 'accessoryNotes.breakerReplacement', reasonCode: 'accessoryReasons.replacement', replacementFor: breakers[0]?.id,
    }, replacements);
    if (rcds[1]) push(rcds[1], {
        group: 'rcd', role: 'replacement_protection', required: false,
        noteCode: 'accessoryNotes.rcdReplacement', reasonCode: 'accessoryReasons.replacement', replacementFor: rcds[0]?.id,
    }, replacements);

    if (context.mainProductType === 'heating_cable') {
        const requiredLengthMeters = Math.max(1, Number(context.mountingTapeLengthM || 0));
        const tapeCandidates = allProducts.filter((product) => productMatchesGroup(product, 'mounting_tape') && product.availabilityStatus !== 'unavailable')
            .map((product) => {
                const text = cleanText(product.name);
                const match = text.match(/(\d{1,3}(?:[.,]\d+)?)\s*метр/) || text.match(/(\d{1,3}(?:[.,]\d+)?)\s*m\b/);
                const packageLengthMeters = match ? Number(String(match[1]).replace(',', '.')) : 0;
                const packageCount = packageLengthMeters > 0 ? Math.ceil(requiredLengthMeters / packageLengthMeters) : 0;
                return { product, packageLengthMeters, packageCount };
            })
            .filter((item) => item.packageLengthMeters > 0)
            .sort((a, b) => brandTierRank(brandTier(`${a.product.brand} ${a.product.name}`)) - brandTierRank(brandTier(`${b.product.brand} ${b.product.name}`))
                || availabilityRank(a.product.availabilityStatus) - availabilityRank(b.product.availabilityStatus)
                || a.packageCount * priceOrMax(a.product) - b.packageCount * priceOrMax(b.product));
        const tape = tapeCandidates[0];
        if (tape) {
            push(tape.product, {
                group: 'mounting_tape', role: 'required_install', required: true, quantity: tape.packageCount,
                noteCode: 'accessoryNotes.mountingTape',
                noteParams: { requiredLengthMeters, packageLengthMeters: tape.packageLengthMeters, packageCount: tape.packageCount },
                reasonCode: 'accessoryReasons.cableFixing',
                measurement: { requiredLengthMeters, packageLengthMeters: tape.packageLengthMeters, packageCount: tape.packageCount },
            });
        } else {
            missing('mounting_tape', 'requirements.mountingTape', { requiredLengthMeters });
        }
    }

    const threshold = Number(config.electricalProtection?.thermostatRelay?.recommendedContactorUtilizationThreshold || 0.8);
    const utilization = context.actualCurrentA / Math.max(thermostatLoadA, 0.1);
    if (context.actualCurrentA > thermostatLoadA || utilization >= threshold) {
        const contactors = pickProtection(allProducts, 'contactor', Math.max(breaker.ratingA, 20));
        if (!push(contactors[0], {
            group: 'contactor', role: 'conditional_power', required: true,
            noteCode: 'accessoryNotes.contactor',
            noteParams: { currentA: round(context.actualCurrentA, 2), relayA: thermostatLoadA, thresholdPercent: round(threshold * 100, 0) },
            reasonCode: 'accessoryReasons.relayRelief',
        })) missing('contactor_or_zone_split', 'requirements.contactor', { currentA: round(context.actualCurrentA, 2), relayA: thermostatLoadA, thresholdPercent: round(threshold * 100, 0) });
    }

    return { accessories, accessoryReplacements: replacements, missingAccessoryRequirements: missingRequirements, protectionOrientation: breaker };
}

function pushUniqueVariant(list: any[], candidate: any, role: string, isPrimary = false) {
    if (!candidate) return;
    if (list.some((item) => isSameProduct(item.candidate.product, candidate.product))) return;
    list.push({ candidate, role, isPrimary });
}

function primaryRoleForTier(tier: any) {
    return tier === 'premium' ? 'premium' : tier === 'standard' ? 'standard' : 'economy';
}

function labelCodeForRole(role: string) {
    return `variantRoles.${role}`;
}

function recommendationExplanation(candidate: any, input: AnyRecord, design: AnyRecord, role: string) {
    const calc = candidate.calc;
    return {
        whyCode: candidate.product.productType === 'heating_mat' ? 'explanations.whyMat' : 'explanations.whyCable',
        whyParams: { brand: candidate.product.brand, model: candidate.product.name, requiredPowerW: design.requiredTotalPowerW },
        mountingCode: candidate.product.productType === 'heating_mat' ? 'explanations.mountingMat' : 'explanations.mountingCable',
        mountingParams: { substrate: input.substrateType, spacingCm: calc.spacingCm || null },
        performanceCode: candidate.product.productType === 'heating_mat' ? 'explanations.performanceMat' : 'explanations.performanceCable',
        performanceParams: {
            heatedAreaM2: input.installationAreaM2,
            selectedPowerW: calc.selectedProductTotalPowerW,
            actualWm2: calc.actualInstalledPowerWm2,
            coveragePercent: calc.coveragePercent || null,
            spacingCm: calc.spacingCm || null,
        },
        commercialCode: role.startsWith('replacement') ? 'explanations.commercialReplacement' : candidate.tier === 'premium' ? 'explanations.commercialPremium' : 'explanations.commercialBestAvailable',
        commercialParams: { tier: candidate.tier },
    };
}

function baseCalculation(input: AnyRecord, design: AnyRecord) {
    return {
        roomAreaM2: input.roomAreaM2,
        excludedAreaM2: input.excludedAreaM2,
        installationAreaM2: input.installationAreaM2,
        heatingPurpose: input.heatingPurpose,
        insulationLevel: input.insulationLevel,
        insulationFactor: design.insulationFactor,
        targetInstalledPowerWm2: design.targetInstalledPowerWm2,
        requiredTotalPowerW: design.requiredTotalPowerW,
        floorTemperatureLimitC: design.floorTemperatureLimitC,
        voltageV: design.voltageV,
    };
}

/**
 * Phase A: validate + technical compatibility + engineering fit.
 * Phase B: tiered commercial ranking (Premium → Standard → Economy).
 * options.products is test-only injection; production reads the catalog.
 */
export function matchWarmFloorProductsV3(rawInput: AnyRecord, options: AnyRecord = {}) {
    const config = getWarmFloorConfigV3();
    const input = normalizeWarmFloorInputV3(rawInput);
    const validation = validateWarmFloorInputV3(input, config);
    const design = resolveDesignTargets(input, config);
    const allProducts = Array.isArray(options.products) ? options.products : warmFloorProductRows();
    const calculation = baseCalculation(input, design);

    if (!validation.valid) {
        return {
            status: 'invalid_input', variants: [], accessories: [], accessoryReplacements: [],
            missingAccessoryRequirements: [], validation, calculation, design: publicDesign(design), input,
            fallback: { code: 'fallback.invalidInput', requiredCharacteristics: requiredCharacteristics(input, design) },
        };
    }

    const preference = input.systemPreference === 'auto' && ['mat', 'cable'].includes(design.preferredSystem)
        ? design.preferredSystem
        : input.systemPreference;
    const rejectedByCode: Record<string, number> = {};
    const mains = allProducts.filter((product) => ['heating_mat', 'heating_cable'].includes(product.productType));

    const technicalCandidates = mains.map((product) => {
        if (input.systemPreference === 'mat' && product.productType !== 'heating_mat') return null;
        if (input.systemPreference === 'cable' && product.productType !== 'heating_cable') return null;
        const gate = evaluateProductCompatibility(product, input, design);
        if (!gate.ok) {
            for (const reason of gate.reasons) rejectedByCode[reason.code] = (rejectedByCode[reason.code] || 0) + 1;
            return null;
        }
        const calc = calculateWarmFloorV3(input, product, design);
        return {
            product,
            calc,
            engineeringScore: scoreWarmFloorCandidate(product, input, design, calc),
            tier: brandTier(`${product.brand} ${product.name}`),
        };
    }).filter(Boolean) as any[];

    const tiered: Record<string, any[]> = {
        premium: commercialSort(technicalCandidates.filter((candidate) => candidate.tier === 'premium'), input.preferredBrands),
        standard: commercialSort(technicalCandidates.filter((candidate) => candidate.tier === 'standard'), input.preferredBrands),
        economy: commercialSort(technicalCandidates.filter((candidate) => candidate.tier === 'economy'), input.preferredBrands),
    };
    const firstTier = ['premium', 'standard', 'economy'].find((tier) => tiered[tier].length) || null;
    const primary = firstTier ? tiered[firstTier][0] : null;
    const draft: AnyRecord[] = [];
    if (primary) pushUniqueVariant(draft, primary, primaryRoleForTier(firstTier), true);

    if (firstTier === 'premium') {
        pushUniqueVariant(draft, tiered.standard[0], 'replacement_standard');
        pushUniqueVariant(draft, tiered.economy[0], 'replacement_economy');
    } else if (firstTier === 'standard') {
        pushUniqueVariant(draft, tiered.economy[0], 'replacement_economy');
    }
    for (const candidate of firstTier ? tiered[firstTier].slice(1) : []) {
        if (draft.length >= 5) break;
        pushUniqueVariant(draft, candidate, `alternative_${firstTier}`);
    }

    const variants: AnyRecord[] = draft.map(({ candidate, role, isPrimary }) => {
        const warnings = getWarningsV3(input, candidate.calc, candidate.product, design);
        if (role.startsWith('replacement')) warnings.unshift({ code: 'warnings.commercialReplacement', params: { tier: candidate.tier } });
        return {
            bundleType: role,
            role,
            labelCode: labelCodeForRole(role),
            isPrimary,
            brandTier: candidate.tier,
            mainProduct: { ...candidate.product, brandTier: candidate.tier },
            calculation: candidate.calc,
            explanation: recommendationExplanation(candidate, input, design, role),
            warnings,
            engineeringScore: candidate.engineeringScore,
        };
    });

    let kit: AnyRecord = { accessories: [], accessoryReplacements: [], missingAccessoryRequirements: [], protectionOrientation: null };
    if (primary && input.includeAccessories !== false) {
        kit = buildProfessionalAccessories(allProducts, {
            mainProductType: primary.product.productType,
            actualCurrentA: Number(primary.calc.actualCurrentA || 0),
            mountingTapeLengthM: primary.calc.mountingTapeLengthM || null,
        }, config);
        variants[0].accessories = kit.accessories;
        variants[0].accessoryReplacements = kit.accessoryReplacements;
    }

    const status = variants.length ? 'ok' : 'no_match';
    return {
        status,
        variants,
        accessories: kit.accessories,
        accessoryReplacements: kit.accessoryReplacements,
        missingAccessoryRequirements: kit.missingAccessoryRequirements,
        kitSummary: {
            titleCode: 'kitSummary.title',
            policyCode: 'kitSummary.policy',
            requiredGroups: kit.accessories.filter((item: AnyRecord) => item.required).map((item: AnyRecord) => item.accessoryGroup),
            disclaimerCode: 'kitSummary.electricalDisclaimer',
        },
        calculation,
        design: publicDesign(design),
        selectionMeta: {
            phaseACompatibleCount: technicalCandidates.length,
            phaseB: { order: ['premium', 'standard', 'economy'], premiumCount: tiered.premium.length, standardCount: tiered.standard.length, economyCount: tiered.economy.length },
            rejectedByCode,
            resolvedSystemPreference: preference,
            primaryTier: firstTier,
        },
        validation,
        input,
        fallback: status === 'no_match' ? {
            code: 'fallback.noSuitableProduct',
            requiredCharacteristics: requiredCharacteristics(input, design),
            rejectedReasons: Object.entries(rejectedByCode)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([code, count]) => ({ code, count })),
        } : null,
    };
}

function requiredCharacteristics(input: AnyRecord, design: AnyRecord) {
    return {
        systemType: design.preferredSystem === 'blocked' ? 'special_system' : design.preferredSystem,
        heatedAreaM2: input.installationAreaM2,
        requiredPowerW: design.requiredTotalPowerW,
        targetPowerWm2: design.targetInstalledPowerWm2,
        coveringMaxWm2: design.coveringMaxWm2,
        maximumIndoorCableLinearPowerWm: design.indoorCableLinearPowerMaxWm,
        floorTemperatureLimitC: design.floorTemperatureLimitC,
        thermostat: {
            floorSensorInputRequired: true,
            floorTemperatureLimitRequired: true,
            minimumSwitchingLoadA: round(design.requiredTotalPowerW / design.voltageV, 2),
        },
    };
}

function publicDesign(design: AnyRecord) {
    return {
        targetInstalledPowerWm2: design.targetInstalledPowerWm2,
        requiredTotalPowerW: design.requiredTotalPowerW,
        insulationFactor: design.insulationFactor,
        preferredSystem: design.preferredSystem,
        coveringMaxWm2: design.coveringMaxWm2,
        floorTemperatureLimitC: design.floorTemperatureLimitC,
        voltageV: design.voltageV,
        regionProfile: design.regionProfile,
        mainHeatingMode: design.mainHeatingMode,
        formulas: {
            requiredPowerW: 'heatedAreaM2 * targetInstalledPowerWm2',
            currentA: 'selectedProductTotalPowerW / voltageV',
            cableSpacingCm: 'heatedAreaM2 * 100 / cableLengthM',
            matCoveragePercent: 'matAreaM2 / heatedAreaM2 * 100',
            mountingTapeRequiredLengthM: 'ceil(max(minimumLengthM, heatedAreaM2 / rowSpacingM * wasteFactor))',
        },
    };
}
