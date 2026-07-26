/**
 * Proprietary project document serialization (the save format).
 * Proprietary and confidential. © Partners Real Estate.
 *
 * The document itself is the save format — plain JSON, `schemaVersion`-tagged
 * so future migrations have a hook. glTF and other formats are *exports* and
 * never the source of truth (ARCHITECTURE §9).
 */

import type { ProjectDoc } from '../model/types';

export const CURRENT_SCHEMA_VERSION = 1 as const;

/** File extension / mime for the proprietary document format. */
export const PROJECT_FILE_EXTENSION = '.compass.json';
export const PROJECT_MIME_TYPE = 'application/json';

/**
 * Serialize a document to pretty-printed JSON, refreshing `updatedAt`.
 * The input document is not mutated.
 */
export function serializeProject(doc: ProjectDoc): string {
  const out: ProjectDoc = { ...doc, updatedAt: new Date().toISOString() };
  return JSON.stringify(out, null, 2);
}

function fail(message: string): never {
  throw new Error(`parseProject: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse and validate a project document.
 *
 * Validation is structural (not exhaustive per-entity) — enough to reject
 * unrelated JSON, truncated files and future/legacy schema versions with a
 * descriptive error instead of failing deep inside the renderer.
 *
 * @throws Error with a `parseProject: …` message on any invalid input.
 */
export function parseProject(json: string): ProjectDoc {
  if (typeof json !== 'string' || json.trim() === '') {
    fail('input is empty');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    fail(`input is not valid JSON (${(error as Error).message})`);
  }

  if (!isRecord(parsed)) {
    fail('document root must be a JSON object');
  }

  const version = parsed['schemaVersion'];
  if (version === undefined) {
    fail('missing "schemaVersion" — this file is not a Compass Studio project');
  }
  if (version !== CURRENT_SCHEMA_VERSION) {
    fail(
      `unsupported schemaVersion ${String(version)} (this build reads version ${CURRENT_SCHEMA_VERSION})`,
    );
  }

  if (typeof parsed['id'] !== 'string') fail('missing or invalid "id"');
  if (typeof parsed['name'] !== 'string') fail('missing or invalid "name"');
  if (!isRecord(parsed['settings'])) fail('missing or invalid "settings"');
  if (!isRecord(parsed['meta'])) fail('missing or invalid "meta"');
  if (!isRecord(parsed['tenants'])) fail('missing or invalid "tenants"');

  const building = parsed['building'];
  if (!isRecord(building)) fail('missing or invalid "building"');
  if (!Array.isArray(building['floors'])) fail('"building.floors" must be an array');

  const arrayKeys = ['slabs', 'walls', 'columns', 'cores', 'zones', 'furniture'] as const;
  (building['floors'] as unknown[]).forEach((floor, i) => {
    if (!isRecord(floor)) fail(`building.floors[${i}] is not an object`);
    if (typeof floor['id'] !== 'string') fail(`building.floors[${i}].id is missing`);
    if (typeof floor['index'] !== 'number') fail(`building.floors[${i}].index must be a number`);
    if (typeof floor['height'] !== 'number') fail(`building.floors[${i}].height must be a number`);
    if (typeof floor['elevation'] !== 'number') {
      fail(`building.floors[${i}].elevation must be a number`);
    }
    for (const key of arrayKeys) {
      if (!Array.isArray(floor[key])) fail(`building.floors[${i}].${key} must be an array`);
    }
  });

  return parsed as unknown as ProjectDoc;
}

/** Convenience: round-trip clone through the save format (deep, JSON-safe). */
export function cloneProject(doc: ProjectDoc): ProjectDoc {
  return JSON.parse(JSON.stringify(doc)) as ProjectDoc;
}
