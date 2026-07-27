'use client';

/**
 * Toolbar entry point for rent-roll import (M2 Slice B).
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * Owns nothing but the open/closed flag, mirroring `ImportPlanButton`, so the
 * dialog stays unmounted until someone actually imports a roll.
 */

import { useState } from 'react';

import { Button } from '../primitives';
import { RentRollDialog } from './RentRollDialog';

export function RentRollButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        active={open}
        title="Import a rent roll — tenants, suites and lease expiries — in one undoable step"
        className="whitespace-nowrap"
      >
        Rent Roll
      </Button>
      {open ? <RentRollDialog onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export default RentRollButton;
