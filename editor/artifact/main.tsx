/**
 * Entry point for the single-file demo bundle (Claude artifact / offline demo).
 * Proprietary and confidential. © Partners Real Estate.
 *
 * Renders the full editor without the Next.js shell. The extraction API is not
 * present on this static host, so the import dialog degrades to its
 * extraction-unavailable path; PDF rasterization is stubbed out (see
 * `pdfjs-stub.ts`) because the sandboxed host cannot start module workers.
 */
import { createRoot } from 'react-dom/client';
import '../src/app/globals.css';
import EditorShell from '../src/ui/EditorShell';

createRoot(document.getElementById('root')!).render(<EditorShell />);
