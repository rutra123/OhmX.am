/** CM17 fail-closed validation of the frozen CM16/CM9 identity boundary. */
import type { ConfiguredLiveOrchestrationResult } from "../buildingProjectEngineeringOrchestrator/types.js";
import {
  EQUIPMENT_REQUIREMENT_CONTRACT_ID,
  EQUIPMENT_REQUIREMENT_CONTRACT_VERSION,
  type EquipmentRequirement,
} from "../engineeringConfigurator/equipmentRequirementTypes.js";
import type { PhysicalComponent } from "../engineeringConfigurator/types.js";
import type {
  CatalogMatchingBlocker,
  CatalogMatchingBlockerCode,
} from "./types.js";

export function catalogMatchingBlocker(
  code: CatalogMatchingBlockerCode,
  message: string,
  details: Partial<Omit<CatalogMatchingBlocker, "code" | "message">> = {},
): CatalogMatchingBlocker {
  return {
    code,
    message,
    requirementId: details.requirementId ?? null,
    componentInstanceId: details.componentInstanceId ?? null,
    sourceCode: details.sourceCode ?? null,
    matcherFailureKind: details.matcherFailureKind ?? null,
    expectedEngineeringCatalogStateRevision: details.expectedEngineeringCatalogStateRevision ?? null,
    observedEngineeringCatalogStateRevision: details.observedEngineeringCatalogStateRevision ?? null,
  };
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const aa = [...a].sort();
  const bb = [...b].sort();
  return aa.every((value, index) => value === bb[index]);
}

export interface ValidatedRequirementInventory {
  physicalComponents: readonly PhysicalComponent[];
  equipmentRequirements: readonly EquipmentRequirement[];
}

export function validateConfiguredRequirementInventory(
  cm16: ConfiguredLiveOrchestrationResult,
): CatalogMatchingBlocker | ValidatedRequirementInventory {
  const configured = cm16.configuratorResult as unknown as Record<string, unknown>;
  const rawComponents = configured.physicalComponents;
  const rawRequirements = configured.equipmentRequirements;
  if (!Array.isArray(rawComponents) || !Array.isArray(rawRequirements) || rawComponents.length === 0 || rawRequirements.length === 0) {
    return catalogMatchingBlocker("REQUIREMENT_IDENTITY_INVALID", "CM16 CONFIGURED result must contain physical components and equipment requirements.");
  }

  if (
    configured.projectId !== cm16.projectId ||
    configured.projectRevision !== cm16.projectRevision ||
    configured.systemConfigurationRevision !== cm16.systemRevision ||
    configured.loadCalculationRevision !== cm16.loadCalculationRevision ||
    configured.engineeringCatalogStateRevision !== cm16.engineeringCatalogStateRevision
  ) {
    return catalogMatchingBlocker("REQUIREMENT_IDENTITY_INVALID", "CM16 envelope and Configurator revision identities disagree.");
  }

  const components = rawComponents as PhysicalComponent[];
  const requirements = rawRequirements as EquipmentRequirement[];
  const componentById = new Map<string, PhysicalComponent>();
  for (const component of components) {
    if (
      !component ||
      !nonEmpty(component.componentInstanceId) ||
      !component.scopeReference ||
      componentById.has(component.componentInstanceId)
    ) {
      return catalogMatchingBlocker("COMPONENT_LINKAGE_INVALID", "Physical component identity is missing or duplicated.", {
        componentInstanceId: component?.componentInstanceId ?? null,
      });
    }
    componentById.set(component.componentInstanceId, component);
  }

  const requirementIds = new Set<string>();
  const requirementsByComponent = new Map<string, EquipmentRequirement[]>();
  for (const requirement of requirements) {
    if (!requirement || !nonEmpty(requirement.requirementId)) {
      return catalogMatchingBlocker("REQUIREMENT_IDENTITY_INVALID", "EquipmentRequirement.requirementId is required.");
    }
    if (requirementIds.has(requirement.requirementId)) {
      return catalogMatchingBlocker("DUPLICATE_REQUIREMENT_ID", "Duplicate EquipmentRequirement.requirementId.", {
        requirementId: requirement.requirementId,
      });
    }
    requirementIds.add(requirement.requirementId);

    if (
      requirement.contractId !== EQUIPMENT_REQUIREMENT_CONTRACT_ID ||
      requirement.contractVersion !== EQUIPMENT_REQUIREMENT_CONTRACT_VERSION ||
      requirement.projectId !== cm16.projectId ||
      requirement.revisionStamp?.projectId !== cm16.projectId ||
      requirement.revisionStamp?.projectRevision !== cm16.projectRevision ||
      requirement.revisionStamp?.systemConfigurationRevision !== cm16.systemRevision ||
      requirement.revisionStamp?.loadCalculationRevision !== cm16.loadCalculationRevision ||
      requirement.revisionStamp?.sourceCalculationId !== cm16.sourceCalculationId ||
      requirement.sourceLoadReference?.sourceCalculationId !== cm16.sourceCalculationId ||
      requirement.sourceLoadReference?.sourceRevision?.projectRevision !== cm16.projectRevision ||
      requirement.sourceLoadReference?.sourceRevision?.systemsRevision !== cm16.systemRevision ||
      requirement.sourceLoadReference?.sourceRevision?.loadCalculationRevision !== cm16.loadCalculationRevision
    ) {
      return catalogMatchingBlocker("REQUIREMENT_IDENTITY_INVALID", "EquipmentRequirement contract or revision identity disagrees with CM16.", {
        requirementId: requirement.requirementId,
      });
    }

    const ref = requirement.physicalComponentRef;
    if (!ref || !nonEmpty(ref.componentInstanceId) || ref.selectionConstraint !== "SAME_PRODUCT") {
      return catalogMatchingBlocker("COMPONENT_LINKAGE_INVALID", "CM9 requirement lacks the frozen SAME_PRODUCT physical component reference.", {
        requirementId: requirement.requirementId,
        componentInstanceId: ref?.componentInstanceId ?? null,
      });
    }
    const component = componentById.get(ref.componentInstanceId);
    if (
      !component ||
      !requirement.scopeReference ||
      component.equipmentType !== requirement.equipmentType ||
      component.scope !== requirement.scope ||
      component.scopeReference?.roomId !== requirement.scopeReference?.roomId ||
      !Array.isArray(component.serviceRequirementIds) ||
      !component.serviceRequirementIds.includes(requirement.requirementId)
    ) {
      return catalogMatchingBlocker("COMPONENT_LINKAGE_INVALID", "EquipmentRequirement does not link coherently to its physical component.", {
        requirementId: requirement.requirementId,
        componentInstanceId: ref.componentInstanceId,
      });
    }
    const group = requirementsByComponent.get(ref.componentInstanceId) ?? [];
    group.push(requirement);
    requirementsByComponent.set(ref.componentInstanceId, group);
  }

  for (const component of components) {
    const linked = requirementsByComponent.get(component.componentInstanceId) ?? [];
    const linkedIds = linked.map((row) => row.requirementId);
    const services = linked.map((row) => row.service);
    if (
      linked.length !== 2 ||
      new Set(services).size !== 2 ||
      !services.includes("HEATING") ||
      !services.includes("COOLING") ||
      !sameStrings(linkedIds, component.serviceRequirementIds)
    ) {
      return catalogMatchingBlocker("COMPONENT_LINKAGE_INVALID", "SAME_PRODUCT component must have one HEATING and one COOLING requirement.", {
        componentInstanceId: component.componentInstanceId,
      });
    }
  }

  return { physicalComponents: components, equipmentRequirements: requirements };
}

export function isValidatedRequirementInventory(
  value: CatalogMatchingBlocker | ValidatedRequirementInventory,
): value is ValidatedRequirementInventory {
  return "equipmentRequirements" in value;
}
