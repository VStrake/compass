'use client';

/**
 * Client-side project file I/O for the editor chrome.
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * The document *is* the save format (ARCHITECTURE §9), so "Save to file" is a
 * `serializeProject` Blob download and "Open file…" is `parseProject` over the
 * file's text. Both live here rather than in a component so the Toolbar's
 * "Export JSON" button and the ProjectMenu's save/open rows share one
 * implementation (and one filename convention).
 */

import {
  PROJECT_FILE_EXTENSION,
  PROJECT_MIME_TYPE,
  parseProject,
  serializeProject,
} from '@/core/export/projectJson';
import type { ProjectDoc } from '@/core/model/types';

/** Accept attribute for the "Open file…" input. */
export const PROJECT_FILE_ACCEPT = `.json,${PROJECT_FILE_EXTENSION},application/json`;

/** `${name}.compass.json`, with the OS-hostile characters stripped. */
export function projectFileName(name: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim();
  return `${base || 'untitled'}${PROJECT_FILE_EXTENSION}`;
}

/** Download a document as pretty-printed proprietary JSON. */
export function downloadProject(doc: ProjectDoc): void {
  const blob = new Blob([serializeProject(doc)], { type: PROJECT_MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = projectFileName(doc.name);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so Safari has committed the navigation.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Read and validate a picked file.
 *
 * @throws the `parseProject: …` Error verbatim so the caller can show the real
 *   reason the file was rejected instead of a generic failure.
 */
export async function readProjectFile(file: File): Promise<ProjectDoc> {
  const text = await file.text();
  return parseProject(text);
}
