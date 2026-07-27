# San Felipe Plaza — data provenance

**Proprietary and confidential. © Partners Real Estate.**

Compass Studio ships San Felipe Plaza as a real, openable building (ProjectMenu →
Sample buildings). This file records where the data came from, what is
authoritative, what is approximated, and the discrepancies found in the source.

## Source

| | |
|---|---|
| File | `SFP - Master Vacancy.xlsx` |
| Location | `/landlord/San Felipe Plaza/Leasing/Stack & Master Vacancy/MASTER STACK/` |
| As of | 2026-07-23 (file's last-modified date) |
| Building | San Felipe Plaza, 5847 San Felipe Street, Houston, TX 77057 |
| Entity | SF Plaza, LLC · Built 1984 · Class A |
| Sheet totals | 980,473 RSF total · 829,994 leased (84.65%) · 143,222 vacant (14.61%) · 7,257 RSF adjust |
| OpEx | $14.65 ($14.50 NNN on suite rows) |
| Asking rents | $26 low-rise · $28 mid-rise · $30 high-rise, $0.50 annual escalations |
| Elevator banks | Low-rise ≤ 19 · Mid-rise 20–32 · High-rise 33–43 · High-rise express 44–46 |

The transcribed roll lives at `tests/fixtures/san-felipe-plaza.rentroll.tsv` (101
rows) and is embedded verbatim in `src/core/model/sanFelipePlaza.ts` so the seed
works in the browser with no file I/O.

## Authoritative vs. approximated

**Authoritative** — transcribed from the sheet: floor numbering, suite numbers,
tenant names, suite RSF, lease expiration dates, vacancy status, and the
condition/marketing notes on vacant suites.

**Approximated** — geometry. Each floor is a rectangle (1.45 aspect) whose area
equals that floor's total RSF, split into suite strips proportional to each
suite's RSF. Floor-to-floor is 3.9 m with a 5.5 m lobby. This is a *schematic*
stack, correct in area and tenancy but not in shape. Import the matching Control
Book page for a floor (Import Plan → calibrate → extract) to replace the
schematic plate with real geometry; the floor's rent-roll RSF is the cross-check
that the calibration is right.

**Excluded from the model**: the lower-level retail/storage band (LWL, 13,977
RSF) and the garage (462 RSF). The tower model therefore totals **963,341 RSF
over 45 floors** — 0.28% below the sheet's 966,034 RSF tower-only figure, the
remainder being storage rows not transcribed.

**Floor 13 does not exist** in the sheet's stack and is not in the model; floors
run 1–46 with 13 omitted, so the building has 45 floors.

## Control Book

`San Felipe Plaza - Control Book (1.23.2026).pdf`
(`/landlord/San Felipe Plaza/Leasing/Control Book/`, 6.8 MB) holds the occupancy
plans. It is an **image-based PDF** — no extractable text layer — and the
SharePoint connector returns extracted text only, never raw bytes, so the plans
cannot be pulled in automatically. Procedure per floor:

1. Open the Control Book, export or screenshot the floor's occupancy plan page.
2. In Compass Studio: **Import Plan** → drop the image → calibrate against the
   plan's scale bar or a printed dimension → extract.
3. Check the resulting floor's gross area against its rent-roll RSF (this file's
   fixture); within a few percent means the calibration is good.

A future milestone can fetch these pages directly from SharePoint.

## Discrepancies found in the source sheet

These are internal contradictions in `SFP - Master Vacancy.xlsx` itself, found
while transcribing. Each was resolved conservatively as noted — worth a look
independently of this tool, since they affect any report built off the sheet.

1. **Building total disagrees with itself** — the header says RBA 980,427; the
   totals row says 980,473 (46 RSF apart).
2. **Suite 1910 counted twice** — listed as GlassRatner Advisory, 4,121 RSF,
   expiring 2/29/32, *and* as "1910 (INTERNAL ONLY) 10,791 RSF available
   3/1/2026". Modeled as the GlassRatner lease; the 10,791 figure appears to be a
   future-availability projection for a larger block.
3. **Suite 4680 both leased and available** — Frontera Resources to 8/31/27, and
   simultaneously "available in 30 days" on the availability list. Modeled as
   leased with a note.
4. **Suite 875 both vacant and dated** — marked VACANT and carrying a 4/30/27
   expiration. Modeled as vacant with the date retained as a note.
5. **Floor 12 rows don't sum to the floor total** — suites 1200 (5,420) + 1245
   (2,954) + 1250 (11,399) + 1212 (3,057) = 22,830 against a stated floor total
   of 17,410. Suite "1254" (2,954) on the availability list is very likely a typo
   for 1245, which Gaille is vacating; counted once.
6. **Vacancy definition drifts** — the sheet's 143,222 vacant includes spaces
   with future availability dates (1910, 2375). Vacant-today by row is 130,206;
   the difference is entirely future roll.
7. **Stale rows retained** — several expirations are in the past (LWL 25
   7/31/21, Suite 2855 7/31/24, 4400A 8/31/25), and the "Expiration Summary"
   tenant list still carries 2025 expirations.

## Regenerating

The seed is deterministic: tenant status is derived against a fixed reference
date (the sheet's as-of date) rather than the clock, so the model renders
identically whenever it is opened. To refresh from a newer Master Vacancy:
re-transcribe `tests/fixtures/san-felipe-plaza.rentroll.tsv`, update the embedded
constant and `SAN_FELIPE_PLAZA_FACTS` in `src/core/model/sanFelipePlaza.ts`, and
re-run the reconciliation check in the verification steps.
