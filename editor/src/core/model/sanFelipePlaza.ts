/**
 * Seeded real building — "San Felipe Plaza", Houston, TX.
 * Proprietary and confidential. © Partners Real Estate. All rights reserved.
 *
 * A 45-story Class A tower at 5847 San Felipe Street, built 1984, owned by
 * SF Plaza LLC. Unlike the Meridian Tower demo, the tenancy here is *real*:
 * every suite, tenant of record, RSF and lease expiration below is transcribed
 * from the leasing team's own stacking workbook.
 *
 * ## Provenance
 * Source: `SFP - Master Vacancy.xlsx`, SharePoint →
 * `/landlord/San Felipe Plaza/Leasing/Stack & Master Vacancy/MASTER STACK/`,
 * as of **2026-07-23**. The same rows live in
 * `tests/fixtures/san-felipe-plaza.rentroll.tsv`; the TSV is duplicated here as
 * a module constant on purpose — the seed has to build in the browser with no
 * file I/O, and a bundler-inlined fixture would be a build-graph surprise.
 * The two copies are byte-identical and the smoke test compares their totals.
 *
 * ## What is authoritative and what is not
 * **Authoritative:** floor list, suite numbers, tenant names, RSF, lease
 * expirations, vacancy condition notes, and therefore every area/occupancy/
 * rollover number the editor reports.
 * **Schematic:** the geometry. Each floor's plate is a plain rectangle whose
 * *area equals that floor's rent-roll RSF*, subdivided into proportional suite
 * strips. That makes the model reconcile against the sheet by construction, but
 * it is not the real floor plate — the actual demising lines arrive one floor at
 * a time as Control Book pages are imported and calibrated. Importing a plan
 * replaces the strips for that floor only.
 *
 * ## Determinism
 * No `Math.random`, no `Date.now`. Tenant status (`leased` vs `expiring`) is
 * derived against the **fixed reference date below**, not the wall clock, so the
 * document renders identically whenever it is opened — a seeded building whose
 * colors drifted over time would be useless for screenshots and regression
 * tests. Entity ids still come from `newId` (like `createEmptyProject`), so ids
 * differ between calls; nothing in the document's shape does.
 *
 * Floors: 1–46 **skipping 13** (45 levels). Level 1 is the lobby at 5.5 m
 * floor-to-floor; every other level is 3.9 m.
 */

import {
  applyRentRollToProject,
  parseRentRoll,
  plateOutlineForRsf,
  summarizeRentRoll,
} from '@/core/import/rentRoll';
import { createEmptyProject, createFloor, createSlab, recomputeElevations } from './factories';
import type { Floor, ProjectDoc } from './types';

/** Building / rent-roll facts, quotable by the UI and the docs. */
export const SAN_FELIPE_PLAZA_FACTS = {
  totalRsf: 963_341,
  leasedRsf: 833_135,
  vacantRsf: 130_206,
  floorCount: 45,
  sourceFile: 'SFP - Master Vacancy.xlsx',
  sourceDate: '2026-07-23',
} as const;

export const SAN_FELIPE_PLAZA_NAME = 'San Felipe Plaza';
export const SAN_FELIPE_PLAZA_ADDRESS = '5847 San Felipe Street, Houston, TX 77057';

/**
 * The as-of date of the source workbook, used as "now" when deriving lease
 * status. Fixed on purpose — see the determinism note above.
 */
export const SAN_FELIPE_PLAZA_AS_OF = '2026-07-23T00:00:00.000Z';
const REFERENCE_NOW = Date.parse(SAN_FELIPE_PLAZA_AS_OF);

/** Level 1 carries the banking hall and lobby volume. */
const LOBBY_HEIGHT = 5.5;
/** Typical floor-to-floor for every tower level. */
const TYPICAL_HEIGHT = 3.9;
/** Plate proportion (width : depth). The real tower plate is roughly 1.45 : 1. */
const PLATE_ASPECT = 1.45;

/** Floor numbers as leased: 1–46, no 13. */
export const SAN_FELIPE_PLAZA_FLOOR_NUMBERS: readonly number[] = Array.from(
  { length: 46 },
  (_, i) => i + 1,
).filter((n) => n !== 13);

/**
 * The rent roll, verbatim from `SFP - Master Vacancy.xlsx` (as of 2026-07-23).
 * Tab separated, 101 suite rows across 45 floors:
 * 963,341 RSF total / 833,135 leased / 130,206 vacant (86.48% occupied).
 */
export const SAN_FELIPE_PLAZA_RENT_ROLL_TSV: string = [
  "floor\tsuite\ttenant\trsf\texpiration\tnotes",
  "46\t4600\tSUNBELT EXIM, INC.\t10809\t2032-01-31",
  "46\t4650\tVACANT\t2453",
  "46\t4675\tSS AMERICAN HOLDING, INC.\t2432\t2028-03-31",
  "46\t4680\tFRONTERA RESOURCES CORP\t3680\t2027-08-31\tMarketed as available in 30 days",
  "45\t4500\tVACANT\t19985",
  "44\t4400\tVACANT\t12121\t\tHighest vacancy; southern views; non-elevator exposure",
  "44\t4450\tSMALL VENTURES USA, LP\t7857\t2029-03-31",
  "43\t4300\tVACANT\t19980\t\tFull floor; office-intensive layout",
  "42\t4200\tMOBIUS RISK GROUP LLC\t13824\t2034-08-31",
  "42\t4250\tMOBIUS RISK GROUP LLC\t6249\t2034-08-31",
  "41\t4100\tFIRST AMERICAN TITLE INSURANCE COMPANY\t8706\t2033-12-31",
  "41\t4120\tCOX FAMILY PROPERTIES, LTD\t2193\t2028-11-30",
  "41\t4150\tHEXL CRUDE OIL & LOGISTICS LLC\t4242\t2031-01-31",
  "41\t4125\tBRENNIG & ASSOCIATES, PC\t2191\t2031-06-30",
  "41\t4160\tSTRAKE FOUNDATION\t2073\t2033-03-31",
  "40\t4000\tRAYMOND JAMES & ASSOCIATES, INC.\t20073\t2033-05-31\tTermination option 7/31/29",
  "39\t3900\tRAYMOND JAMES & ASSOCIATES, INC.\t20073\t2033-05-31\tTermination option 7/31/29",
  "38\t3800\tRAYMOND JAMES & ASSOCIATES, INC.\t20073\t2033-05-31\tTermination option 7/31/29",
  "37\t3700\tSUMMER ENERGY HOLDINGS, INC.\t20073\t2028-10-31\tOn sublease market",
  "36\t3600\tENSCO INTERNATIONAL\t20073\t2030-12-31",
  "35\t3500\tENSCO INTERNATIONAL\t21628\t2030-12-31",
  "34\t3400\tENSCO INTERNATIONAL\t21070\t2030-12-31",
  "33\t3300\tENSCO INTERNATIONAL\t21445\t2030-12-31",
  "32\t3200\tP.O.&G RESOURCES, LP\t14603\t2029-07-31",
  "32\t3250\tGABLES RESIDENTIAL\t6535\t2027-07-31",
  "31\t3100\tFIRST RESERVE CORPORATION, LLC\t14166\t2027-11-30",
  "31\t3150\tVACANT\t7329\t\tWhite box; elevator exposure; western views",
  "30\t3000\tGRSM\t21495\t2037-10-31",
  "29\t2900\tLOVELESS ENTERPRISES, LTD.\t6039\t2028-08-31",
  "29\t2925\tVACANT\t9235\t\tEastern views; office-intensive",
  "29\t2950\tHARRY GEE & ASSOCIATES\t6165\t2030-04-30",
  "28\t2800\tBKV UPSTREAM MIDSTREAM, LLC\t21331\t2037-07-31",
  "27\t2700\tPANNELL KERR FORSTER\t21323\t2027-01-31",
  "26\t2600\tPANNELL KERR FORSTER\t11385\t2027-01-31",
  "26\t2650\tVACANT\t9941\t\tWhite box; western views",
  "25\t2500\tDEUSTER\t10395\t2033-06-30",
  "25\t2502\tSTREAM OIL\t4371\t2030-07-31",
  "25\t2599\tCLIFTON LARSON\t6411\t2033-01-31",
  "24\t2400\tJOSEPHSON DUNLAP, LLP\t12268\t2037-03-31",
  "24\t2450\tVACANT\t10736\t\tWhite-box half floor; new corridor and restrooms",
  "23\t2300\tTOYOTA TSUSHO AMERICA, INC.\t5047\t2031-08-31",
  "23\t2325\tAMERICAN LEBANESE SYRIAN ASSOCIATED\t4993\t2028-11-30",
  "23\t2375\tJEROLD B. KATZ INTERESTS, CO\t8061\t2026-06-30\tMoving out",
  "23\t2370\tVACANT\t1057\t\tMarketed with 2380 as 3,753 RSF combined",
  "23\t2380\tVACANT\t2696",
  "23\t2350\tGULF COAST MIDSTREAM PARTNERS, LLC\t1150\t2028-12-31",
  "23\t2355\tE1 CORPORATION\t398\t2028-12-31",
  "22\t2200\tNAVITAS PETROLEUM HOLDINGS, LLC\t6587\t2030-09-30",
  "22\t2275\tEZPADA U.S., LLC\t3111\t2031-06-30",
  "22\t2250\tDAIKIN COMFORT TECH NORTH AMERICA, INC.\t13088\t2030-12-31",
  "21\t2100\tWORLDVUE CONNECT, INC.\t21525\t2034-11-30",
  "20\t2000\tFABRE KRAMER\t4248\t2030-03-31",
  "20\t2020\tONE USA SMART TRADING, INC.\t3954\t2029-02-28",
  "20\t2030\tBCS CAPITAL GROUP, LLC\t5142\t2035-06-30",
  "20\t2050\tTHE LAW OFFICES OF KANNER & PINTALUGA, P.A.\t8083\t2030-03-31",
  "20\t2099\tLeased Storage\t597",
  "19\t1900\tROTHSCHILD & CO. NORTH AMERICA, INC.\t6235\t2031-07-31",
  "19\t1905\tGAILLE, PLLC\t6670\t2031-12-31",
  "19\t1910\tGLASSRATNER ADVISORY & CAPITAL GROUP, LLC\t4121\t2032-02-29",
  "19\t1925\tRENEGADE INFRASTRUCTURE, LLC\t5663\t2030-07-31",
  "18\t1800\tRIVIANA FOODS, INC.\t22689\t2043-12-31",
  "17\t1700\tGALLAGHER INSURANCE\t13890\t2036-12-31",
  "17\t1710\tVACANT\t8799\t\tElevator exposure; dense office; southern views",
  "16\t1600\tGALLAGHER INSURANCE\t22689\t2036-12-31",
  "15\t1500\tWILLIS JOHNSON & ASSOCIATES, INC.\t8240\t2027-04-30",
  "15\t1540\tPARTNERS\t2118\t2026-12-31",
  "15\t1550\tTHE EDWARDS FITZPATRICK GROUP, LLC\t4321\t2033-10-31",
  "15\t1560\tGENT COMMODITY USA INCORPORATED\t6017\t2028-09-30",
  "15\t1525\tVACANT\t1903\t\tNot listed",
  "14\t1400\tPARTNERS REAL ESTATE\t22689\t2036-02-29",
  "12\t1200\tAMERICAN INFOSOURCE\t5420\t2026-01-31\tRelocating",
  "12\t1245\tGAILLE, PLLC\t2954\t2026-06-30\tRelocating; sheet also lists this SF as available Suite 1254",
  "12\t1250\tPARTNERS REAL ESTATE\t11399\t2036-02-29",
  "12\t1212\tJ. GLOBAL ENERGY, INC.\t3057\t2028-06-30",
  "11\t1100\tWOOD MACKENZIE\t22933\t2034-04-30\tTermination option 4/30/29",
  "10\t1000\tWOOD MACKENZIE\t22934\t2034-04-30\tTermination option 4/30/29",
  "9\t930\tRIDGEMAR ENERGY OPERATING, LLC\t12078\t2029-01-31\tTermination option 1/31/27",
  "9\t950\tCLEAR TRAIL ADVISORS, LLC\t4219\t2034-08-31",
  "9\t970\tVACANT\t6498\t\tSpec suite; new carpet, lights, paint",
  "9\t995\tVACANT\t137\t\tStorage",
  "8\t800\tCRESA, LLC\t14024\t2037-10-31",
  "8\t875\tVACANT\t5757\t2027-04-30\tGut and redo; southern views",
  "8\t850\tVACANT\t3114\t\tWhite box",
  "7\t700\tSTEWARD PARTNERS GLOBAL ADVISORY\t8383\t2029-11-30",
  "7\t720\tTHE LAW OFFICES OF KANNER & PINTALUGA, P.A.\t11189\t2034-05-31",
  "7\t750\tESENTIA GAS, LLC\t3360\t2027-05-31",
  "6\t600\tVACANT\t8465\t\tOpen plan; glass double-door vestibule",
  "6\t620\tIKON GROUP INVESTMENTS LLC\t7173\t2027-01-31",
  "6\t650\tGALLARDO LAW OFFICES, PA\t7122\t2030-11-30",
  "6\t640\tDeutser Storage\t141",
  "5\t500\tENCINO\t22903\t2030-06-30\tOn sublease market",
  "4\t400\tENCINO\t22902\t2030-06-30\tOn sublease market",
  "3\t300\tNEWMARK & COMPANY REAL ESTATE, INC.\t22902\t2029-06-30\tNewly signed lease",
  "2\t200\tPROPERTY MANAGEMENT\t1603\t2026-07-31",
  "2\t210\tENCINO\t7701\t2030-06-30",
  "2\t220A\tCONFERENCE CENTER\t698",
  "2\t220G\tLeased Storage\t416",
  "2\t220E\tLeased Storage\t162",
  "2\t295\tALLIED RISER - Storage\t410",
  "2\t299\tCONFERENCE CENTER\t6684\t2026-07-31",
  "1\t100\tJP MORGAN CHASE BANK\t13791\t2029-08-31\tLobby banking",].join('\n');

/** Floor label: Level 1 is the lobby, the rest are named after their number. */
function floorLabel(floorNumber: number): string {
  return floorNumber === 1 ? 'Lobby' : `Level ${floorNumber}`;
}

/**
 * Build the San Felipe Plaza project.
 *
 * Order matters: the roll is parsed first so each floor's plate can be sized to
 * that floor's own RSF, then `applyRentRollToProject` demises those plates into
 * suite strips. Because the plates are pre-sized, no floor is created by the
 * import and the building's gross area equals the roll's total RSF exactly.
 *
 * @throws Error when the embedded TSV fails to parse — it is our own data, so a
 *   fatal issue means the constant above was edited badly, not that a user
 *   pasted something odd.
 */
export function createSanFelipePlazaProject(): ProjectDoc {
  const { rows, issues } = parseRentRoll(SAN_FELIPE_PLAZA_RENT_ROLL_TSV);
  const fatal = issues.filter((issue) => issue.severity === 'fatal');
  if (fatal.length > 0) {
    throw new Error(
      `createSanFelipePlazaProject: the embedded San Felipe Plaza rent roll is unreadable — ` +
        fatal.map((issue) => `line ${issue.line ?? '?'}: ${issue.message}`).join('; '),
    );
  }
  if (rows.length === 0) {
    throw new Error('createSanFelipePlazaProject: the embedded rent roll produced no rows.');
  }

  const summary = summarizeRentRoll(rows);
  const rsfByFloor = new Map<number, number>();
  for (const entry of summary.byFloor) rsfByFloor.set(entry.floor, entry.totalRsf);

  const project = createEmptyProject(SAN_FELIPE_PLAZA_NAME);
  project.createdAt = SAN_FELIPE_PLAZA_AS_OF;
  project.updatedAt = SAN_FELIPE_PLAZA_AS_OF;
  project.building.name = SAN_FELIPE_PLAZA_NAME;
  project.building.address = SAN_FELIPE_PLAZA_ADDRESS;
  project.building.buildingClass = 'A';

  // —— plates: one rectangle per leased floor, area = that floor's RSF ——
  const floors: Floor[] = SAN_FELIPE_PLAZA_FLOOR_NUMBERS.map((floorNumber) => {
    const index = floorNumber - 1;
    const height = floorNumber === 1 ? LOBBY_HEIGHT : TYPICAL_HEIGHT;
    const floor = createFloor(index, 0, height, { name: floorLabel(floorNumber) });
    const rsf = rsfByFloor.get(floorNumber);
    if (rsf !== undefined && rsf > 0) {
      floor.slabs = [createSlab(plateOutlineForRsf(rsf, PLATE_ASPECT))];
    }
    return floor;
  });
  recomputeElevations(floors);
  project.building.floors = floors;

  // —— tenancy: real suites, real tenants, real expirations ——
  applyRentRollToProject(project, rows, { now: REFERENCE_NOW, plateAspect: PLATE_ASPECT });

  return project;
}

/**
 * The parsed rent roll on its own — for a reconciliation panel that wants to
 * show the source numbers next to the model's computed ones without rebuilding
 * the whole project.
 */
export function sanFelipePlazaRentRoll() {
  return parseRentRoll(SAN_FELIPE_PLAZA_RENT_ROLL_TSV);
}
