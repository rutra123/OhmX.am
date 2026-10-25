/**
 * Pure presentation helpers for the configurator chrome. Display only: they
 * never change validation results, statuses or calculations.
 */
import type { BuildingProject, ValidationIssue } from '../types';

export type GroupedIssue = {
  code: string;
  message: string;
  service?: 'heating' | 'cooling';
  /** Room names in first-seen order; empty for project-level issues. */
  rooms: string[];
  count: number;
};

/**
 * Collapse identical issues (same code + message + service) that differ only
 * by room into one entry listing the rooms. Order follows first occurrence;
 * every input issue is represented (count sums to issues.length).
 */
export function groupValidationIssues(issues: ValidationIssue[], rooms: Array<{ id: string; name: string }>): GroupedIssue[] {
  const out: GroupedIssue[] = [];
  const byKey = new Map<string, GroupedIssue>();
  for (const issue of issues) {
    const key = `${issue.code}\u0000${issue.message}\u0000${issue.service ?? ''}`;
    let group = byKey.get(key);
    if (!group) {
      group = { code: issue.code, message: issue.message, service: issue.service, rooms: [], count: 0 };
      byKey.set(key, group);
      out.push(group);
    }
    group.count += 1;
    if (issue.roomId) {
      const name = rooms.find((r) => r.id === issue.roomId)?.name;
      if (name && !group.rooms.includes(name)) group.rooms.push(name);
    }
  }
  return out;
}

export type WizardStepId = 'object' | 'rooms' | 'systems' | 'review' | 'loads';

/**
 * Step availability (unchanged rules) plus a "done" flag derived from the
 * project's own status — no new state.
 */
export function wizardSteps(project: BuildingProject | null, loadsFresh: boolean): Array<{ id: WizardStepId; label: string; enabled: boolean; done: boolean }> {
  const status = project?.status;
  const confirmed = Boolean(project && status !== 'draft');
  const systemsConfirmed = status === 'systems_configured';
  return [
    { id: 'object', label: 'Объект', enabled: true, done: Boolean(project) },
    { id: 'rooms', label: 'Помещения', enabled: Boolean(project), done: confirmed },
    { id: 'systems', label: 'Системы', enabled: confirmed, done: systemsConfirmed },
    { id: 'review', label: 'Проверка', enabled: confirmed, done: systemsConfirmed },
    { id: 'loads', label: 'Нагрузки', enabled: systemsConfirmed, done: systemsConfirmed && loadsFresh },
  ];
}

const HYDRONIC_VALUE_TEXT: Record<string, string> = {
  pending_design: 'определится при проектировании',
  pending_calculation: 'определится после расчёта',
};

/** Human wording for internal hydronic status codes shown to customers. */
export function hydronicValueText(value: string): string {
  return HYDRONIC_VALUE_TEXT[value] ?? value;
}
