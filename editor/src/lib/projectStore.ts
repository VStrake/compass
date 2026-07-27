/**
 * Local project persistence (IndexedDB).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Projects live in the browser between sessions so a real building is a named
 * document, not a page reload away from nothing. IndexedDB rather than
 * localStorage: a floor with an imported plan underlay carries a multi-MB data
 * URL, and 46 of those blow past the 5 MB localStorage ceiling immediately.
 *
 * ## Layout
 * Database `compass-studio`, version 1, two object stores:
 *
 *   `projects`   keyed by project id — `{ id, updatedAt, doc }`, index
 *                `by-updatedAt`. Holds the full `ProjectDoc`.
 *   `summaries`  keyed by project id — the small `ProjectSummary` record, index
 *                `by-updatedAt`.
 *
 * The summary is written **alongside** the document in the same transaction, so
 * `listProjects()` never reads (and never deserializes) the underlay data URLs
 * buried in the documents. The two stores cannot drift: every write and delete
 * touches both inside one transaction.
 *
 * ## SSR
 * Next.js prerenders these routes in Node, where `indexedDB` does not exist.
 * Every exported function checks for it and degrades to an empty result — no
 * throw, no `window` access at module scope, safe to import from a server
 * component's dependency graph.
 *
 * No third-party dependencies: raw `IDBRequest` wrapped in promises.
 */

import type { ProjectDoc } from '@/core/model/types';

export const DB_NAME = 'compass-studio';
export const DB_VERSION = 1;
export const PROJECTS_STORE = 'projects';
export const SUMMARIES_STORE = 'summaries';
const UPDATED_AT_INDEX = 'by-updatedAt';

/** Cheap metadata for a project picker — never carries geometry or images. */
export interface ProjectSummary {
  id: string;
  /** Document name (what the user typed in the project menu). */
  name: string;
  /** `building.name` — often the same as `name`, not always. */
  buildingName: string;
  floorCount: number;
  /** ISO 8601, stamped by `saveProject`. Sorts correctly as a string. */
  updatedAt: string;
}

interface ProjectRecord {
  id: string;
  updatedAt: string;
  doc: ProjectDoc;
}

// —— environment ————————————————————————————————————————————————
/** False during SSR/prerender and in any runtime without IndexedDB. */
export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

// —— promise plumbing ————————————————————————————————————————————
function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Open (and migrate) the database. Resolves `null` — never rejects — when
 * IndexedDB is missing or blocked, so callers can treat "no persistence" as an
 * ordinary empty state rather than an error path.
 */
function openDatabase(): Promise<IDBDatabase | null> {
  if (!isPersistenceAvailable()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROJECTS_STORE)) {
        const store = db.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
        store.createIndex(UPDATED_AT_INDEX, 'updatedAt');
      }
      if (!db.objectStoreNames.contains(SUMMARIES_STORE)) {
        const store = db.createObjectStore(SUMMARIES_STORE, { keyPath: 'id' });
        store.createIndex(UPDATED_AT_INDEX, 'updatedAt');
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // A newer tab upgrading the schema closes this handle; drop the cache so
      // the next call reopens instead of using a dead connection.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => {
        dbPromise = null;
      };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      resolve(null);
    };

    // Another tab holds an older version open — give up quietly rather than
    // hanging the caller forever.
    request.onblocked = () => {
      dbPromise = null;
      resolve(null);
    };
  });

  return dbPromise;
}

function summaryOf(doc: ProjectDoc, updatedAt: string): ProjectSummary {
  return {
    id: doc.id,
    name: doc.name,
    buildingName: doc.building?.name ?? '',
    floorCount: doc.building?.floors?.length ?? 0,
    updatedAt,
  };
}

// —— API ————————————————————————————————————————————————————————
/**
 * Every saved project's metadata, most recently updated first.
 * Reads only the `summaries` store, so a library of 46-floor towers with plan
 * underlays lists instantly.
 *
 * @returns `[]` when persistence is unavailable or nothing is saved.
 */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const tx = db.transaction(SUMMARIES_STORE, 'readonly');
    const rows = await requestToPromise<ProjectSummary[]>(
      tx.objectStore(SUMMARIES_STORE).index(UPDATED_AT_INDEX).getAll() as IDBRequest<
        ProjectSummary[]
      >,
    );
    await transactionDone(tx);
    // The index sorts ascending; newest-first is what a picker wants.
    return rows.slice().reverse();
  } catch {
    return [];
  }
}

/**
 * Upsert a project, stamping `updatedAt` on the stored copy. The document and
 * its summary are written in one transaction so the picker can never show stale
 * metadata for a document that saved.
 *
 * The passed document is not mutated. Rejects only on a genuine write failure
 * (most often `QuotaExceededError`) so an autosave indicator can report it; a
 * runtime with no IndexedDB resolves as a silent no-op.
 */
export async function saveProject(doc: ProjectDoc): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  const updatedAt = new Date().toISOString();
  const record: ProjectRecord = { id: doc.id, updatedAt, doc: { ...doc, updatedAt } };

  const tx = db.transaction([PROJECTS_STORE, SUMMARIES_STORE], 'readwrite');
  tx.objectStore(PROJECTS_STORE).put(record);
  tx.objectStore(SUMMARIES_STORE).put(summaryOf(doc, updatedAt));
  await transactionDone(tx);
}

/**
 * Load one project by id.
 *
 * @returns the document, or `null` when it is not saved / persistence is off.
 */
export async function getProject(id: string): Promise<ProjectDoc | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const tx = db.transaction(PROJECTS_STORE, 'readonly');
    const record = await requestToPromise<ProjectRecord | undefined>(
      tx.objectStore(PROJECTS_STORE).get(id) as IDBRequest<ProjectRecord | undefined>,
    );
    await transactionDone(tx);
    return record?.doc ?? null;
  } catch {
    return null;
  }
}

/** Delete a project and its summary. Deleting a missing id is a no-op. */
export async function deleteProject(id: string): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  const tx = db.transaction([PROJECTS_STORE, SUMMARIES_STORE], 'readwrite');
  tx.objectStore(PROJECTS_STORE).delete(id);
  tx.objectStore(SUMMARIES_STORE).delete(id);
  await transactionDone(tx);
}

/**
 * Rough origin storage usage, for a "you are using 42 MB" hint next to the
 * project list. Underlay images dominate this number.
 *
 * @returns `null` when the Storage API is unavailable (Safari < 17, SSR).
 */
export async function estimateUsage(): Promise<{ bytes: number; quotaBytes: number | null } | null> {
  if (typeof navigator === 'undefined') return null;
  const storage = navigator.storage;
  if (!storage || typeof storage.estimate !== 'function') return null;
  try {
    const estimate = await storage.estimate();
    return {
      bytes: estimate.usage ?? 0,
      quotaBytes: estimate.quota ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Drop the cached connection. Tests and the "clear local data" path call this;
 * the next request reopens the database.
 */
export function closeDatabase(): void {
  const pending = dbPromise;
  dbPromise = null;
  void pending?.then((db) => db?.close()).catch(() => undefined);
}
