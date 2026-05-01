import { openDB, type IDBPDatabase, type DBSchema } from 'idb';

export interface RoomBoundary {
  label: string;
  type: string;
  polygon: { x: number; y: number }[];
}

export interface PlanData {
  /** Rectified PNG dataURL of the floor plan, ready to render. */
  imageDataUrl: string;
  /** Source pixel corners in the captured photo, top-left, top-right, bottom-right, bottom-left. */
  sourceCorners: { x: number; y: number }[];
  /** Rectified plan dimensions. */
  rectifiedSize: { w: number; h: number };
  /** Detected rooms (in rectified plan coordinates). */
  rooms: RoomBoundary[];
}

export interface PathPoint {
  x: number;          // plan-pixel coords
  y: number;
  t: number;          // ms since epoch
  heading: number;    // degrees CW from north (smoothed)
  confidence: number; // 0..1
}

export interface PausePoint {
  x: number;
  y: number;
  startedAt: number;
  duration: number; // ms
  nearestRoom?: string;
}

export interface PhotoRecord {
  id: string;
  takenAt: number;
  /** Plan-pixel position when photo was taken. */
  position?: { x: number; y: number };
  nearestRoom?: string;
  /** Compressed JPEG blob. */
  blob: Blob;
}

export interface TranscriptSegment {
  startedAt: number;
  endedAt: number;
  text: string;
}

export type TourStatus = 'pending' | 'active' | 'complete';

export interface PropertyDefaults {
  name: string;
  address?: string;
  askingRent?: string;
  parking?: string;
  ceilingHeight?: string;
  rsf?: string;
}

export interface TourRecord {
  id: string;
  status: TourStatus;
  property: PropertyDefaults;
  prospectName?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  plan?: PlanData;
  path: PathPoint[];
  pauses: PausePoint[];
  transcript: TranscriptSegment[];
  recap?: RecapData;
}

export interface RecapData {
  narrativeSummary: string;
  highlights: { roomLabel: string; durationSeconds: number; photoIds: string[] }[];
  questionsAndAnswers: { question: string; answer: string | null }[];
  nextSteps: string[];
  specs: PropertyDefaults;
}

interface CompassDB extends DBSchema {
  tours: {
    key: string;
    value: TourRecord;
    indexes: { 'by-status': TourStatus; 'by-createdAt': number };
  };
  photos: {
    key: string; // photo id
    value: PhotoRecord;
    indexes: { 'by-tour': string };
  };
  properties: {
    key: string; // slug
    value: PropertyDefaults & { slug: string };
  };
}

let dbPromise: Promise<IDBPDatabase<CompassDB>> | null = null;

function db(): Promise<IDBPDatabase<CompassDB>> {
  if (!dbPromise) {
    dbPromise = openDB<CompassDB>('compass', 1, {
      upgrade(db) {
        const tours = db.createObjectStore('tours', { keyPath: 'id' });
        tours.createIndex('by-status',    'status');
        tours.createIndex('by-createdAt', 'createdAt');

        const photos = db.createObjectStore('photos', { keyPath: 'id' });
        photos.createIndex('by-tour', 'id');

        db.createObjectStore('properties', { keyPath: 'slug' });
      }
    });
  }
  return dbPromise;
}

// ---- tours ----
export async function saveTour(tour: TourRecord): Promise<void> {
  const d = await db();
  await d.put('tours', tour);
}

export async function getTour(id: string): Promise<TourRecord | undefined> {
  const d = await db();
  return d.get('tours', id);
}

export async function listTours(): Promise<TourRecord[]> {
  const d = await db();
  const all = await d.getAll('tours');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteTour(id: string): Promise<void> {
  const d = await db();
  await d.delete('tours', id);
  // Best-effort cleanup of photos
  const tx = d.transaction('photos', 'readwrite');
  for await (const cursor of tx.store) {
    if ((cursor.value as PhotoRecord).id.startsWith(id + ':')) await cursor.delete();
  }
  await tx.done;
}

// ---- photos ----
export async function savePhoto(p: PhotoRecord): Promise<void> {
  const d = await db();
  await d.put('photos', p);
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
  const d = await db();
  return d.get('photos', id);
}

export async function listPhotosForTour(tourId: string): Promise<PhotoRecord[]> {
  const d = await db();
  const all = await d.getAll('photos');
  return all.filter(p => p.id.startsWith(tourId + ':'));
}

// ---- property defaults ----
export async function saveProperty(p: PropertyDefaults & { slug: string }): Promise<void> {
  const d = await db();
  await d.put('properties', p);
}

export async function listProperties(): Promise<(PropertyDefaults & { slug: string })[]> {
  const d = await db();
  return d.getAll('properties');
}

// ---- helpers ----
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // skip ambiguous chars
export function newTourId(): string {
  let id = '';
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  for (let i = 0; i < 8; i++) id += ALPHABET[buf[i] % ALPHABET.length];
  return id;
}
