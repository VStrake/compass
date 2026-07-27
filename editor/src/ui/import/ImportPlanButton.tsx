'use client';

/**
 * Toolbar entry point for plan import (M1.5 — ARCHITECTURE §8).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Owns nothing but the open/closed flag, so the dialog — and, through its
 * dynamic `import('pdfjs-dist')`, the whole PDF stack — stays unmounted and
 * unloaded until someone actually imports a plan.
 */

import { useState } from 'react';

import { Button } from '../primitives';
import { ImportPlanDialog } from './ImportPlanDialog';

export function ImportPlanButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        active={open}
        title="Import a floor plan (PDF or image) as editable geometry and an underlay"
        className="whitespace-nowrap"
      >
        Import Plan
      </Button>
      {open ? <ImportPlanDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export default ImportPlanButton;
