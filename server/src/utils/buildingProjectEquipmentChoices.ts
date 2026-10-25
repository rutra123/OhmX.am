/**
 * Customer equipment choices of a Building Project (fan-coil installation type per room,
 * selections in the specification). Stored next to — not inside — the project JSON:
 *   data/building-project-choices/<projectId>.json
 * so the project normalisation never strips them and project listing never sees them.
 *
 * Values are opaque short strings chosen in the client (catalog SKU, "exclude", "confirm",
 * an installation type); engineering meaning is resolved by the client engine against the
 * live catalog, never trusted from storage.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataRoot } from '../paths.js';

export type EquipmentChoices = Record<string, string>;

export interface EquipmentChoicesDocument {
  projectId: string;
  choices: EquipmentChoices;
  updatedAt: string | null;
}

export const EQUIPMENT_CHOICES_DIR = path.join(dataRoot, 'building-project-choices');

const ID_RE = /^[A-Za-z0-9-]{1,64}$/;
const KEY_RE = /^[A-Za-z0-9:_.\-]{1,96}$/;
const MAX_ENTRIES = 400;
const MAX_VALUE = 96;

export class EquipmentChoicesError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

/** Validates and normalises an incoming choices object (unknown shapes are rejected, not repaired). */
export function normalizeEquipmentChoices(input: unknown): EquipmentChoices {
  if (input == null) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new EquipmentChoicesError('building.choices_invalid', 'choices must be an object');
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_ENTRIES) throw new EquipmentChoicesError('building.choices_invalid', `too many choices (max ${MAX_ENTRIES})`);
  const out: EquipmentChoices = {};
  for (const [key, value] of entries) {
    if (!KEY_RE.test(key)) throw new EquipmentChoicesError('building.choices_invalid', `invalid choice key: ${key.slice(0, 40)}`);
    if (value == null || value === '') continue;
    if (typeof value !== 'string' || value.length > MAX_VALUE || /[\u0000-\u001f]/.test(value)) {
      throw new EquipmentChoicesError('building.choices_invalid', `invalid value for ${key}`);
    }
    out[key] = value;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

export function createEquipmentChoicesStore(dir: string = EQUIPMENT_CHOICES_DIR) {
  const file = (projectId: string) => {
    if (!ID_RE.test(projectId)) throw new EquipmentChoicesError('building.not_found', 'Project not found');
    return path.join(dir, `${projectId}.json`);
  };
  return {
    read(projectId: string): EquipmentChoicesDocument {
      const f = file(projectId);
      if (!fs.existsSync(f)) return { projectId, choices: {}, updatedAt: null };
      try {
        const raw = JSON.parse(fs.readFileSync(f, 'utf8')) as Partial<EquipmentChoicesDocument>;
        return { projectId, choices: normalizeEquipmentChoices(raw.choices), updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null };
      } catch {
        return { projectId, choices: {}, updatedAt: null };
      }
    },
    write(projectId: string, choices: unknown): EquipmentChoicesDocument {
      const f = file(projectId);
      const doc: EquipmentChoicesDocument = { projectId, choices: normalizeEquipmentChoices(choices), updatedAt: new Date().toISOString() };
      fs.mkdirSync(dir, { recursive: true });
      const tmp = `${f}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(doc, null, 2));
      fs.renameSync(tmp, f);
      return doc;
    },
    remove(projectId: string): void {
      const f = file(projectId);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    },
  };
}
