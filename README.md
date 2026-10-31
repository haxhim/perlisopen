# Perlis Open Taekwondo Championship 2026

Independent Perlis edition of the SSKL / PTPJ / PSAS / RSB operations system. Event: **31 October 2026**. Original supplied PDFs and the reproducible import report are in `source/`.

## Run locally

```sh
docker compose -f compose.yaml -f compose.local.yaml up -d --build
```

Public: http://127.0.0.1:3005/live  
Admin: http://127.0.0.1:3005/admin  
Results: http://127.0.0.1:3005/results

Use `ADMIN_PASSWORD` from this directory's private `.env` file. Select any ring at login and enter the admin password for lead access. Under Staff PIN, the lead admin can set a shared six-digit PIN; staff then select their ring or the awards desk. Credentials, PostgreSQL database, Docker networks, volume and browser sessions are separate from the other events. The local preview binds to localhost only. Dokploy uses `compose.yaml` with its own environment values and the `perlis` service on port 3000.

## Imported competition

| Ring / format | Entries | Categories |
| --- | ---: | ---: |
| A–E · Kyorugi | 404 | 81 |
| F · knockout Poomsae | 207 | 59 |
| G033–G127 · knockout Poomsae | 130 | 35 |
| G001–G032 · scored Poomsae performances | 97 | 30 |

Total: **838 competition entries**, **566 scheduled contests** and **3 automatic BYE records** (569 bracket records in the interface). Pair/team entries count as one entry, with all member names preserved. The 32 scored performance numbers contain 30 medal categories because pair/team performances in the same age division share a category. The importer checks team-manager totals, entries, category counts, draw names and bout routes. Kyorugi names are recovered from the matching draw where a full name is available; 101 remain shortened in the supplied sources. Original source JUNIOR/SENIOR category text stays intact; displayed age divisions and overall awards follow the organizer's 9–11 / 12–14 / 15–17 rules.

## Ring G: simultaneous scores, then knockouts

**G001–G032 are scored performances.** The live card shows every participant in the current performance together. Under Poomsae scores, enter all scores (0–10) in the category and click **Save all scores** once. The server validates every score before changing any result, saves the whole group together, marks the participants performed, calculates highest-score-first placings and advances the public performance queue. Equal scores require referee-confirmed placings in the tie-break fields. Manual referee placings remain available for corrections.

**G033 onward uses knockout bouts, exactly like Kyorugi.** Record a blue/red winner through Bout queue; winners advance to semifinals/finals. The Live page shows scored G performances first, then switches to G033 when the scored performance queue is complete. Schedule and Brackets show scored groups before knockouts. Ring F is entirely knockout Poomsae. Three single-entry F categories advance automatically as printed BYEs.

Scored entry IDs are internal and separate from their original performance numbers. Public cards and referee forms show the supplied G001–G032 performance labels. Every route retains its original bout code, including Kyorugi qualifying suffixes such as C31a. Bulk transfer offers separate Knockout bouts and Scored Poomsae queues so overlapping G codes cannot move the wrong records.

## Overall awards

Results provides eight groups, with combined genders determining trophies:

- Kyorugi: Super Cadet (9–11), Cadet (12–14), Junior (15–17), and Overall Kyorugi.
- Poomsae: Super Cadet (9–11), Cadet (12–14), Junior (15–17), and Overall Poomsae.

Each group identifies **Champion · Trophy**, **1st Runner Up · Trophy**, and **2nd Runner Up · Trophy**. All positions remain visible. PDF export includes all eight groups and the top three trophy positions.

Ranking uses gold, then silver, then bronze, following the existing systems. Identical medal totals share a rank and are marked Joint; team name only orders tied rows for display. Standings update from completed categories and remain live until competition finishes. Poomsae totals combine knockout and scored medals, including pairs/teams. Age-specific trophies use only their specified age band. Below 8 Poomsae is excluded from overall trophies and the overall PDF; its individual category results and awards remain available. Gender filters are medal-analysis views; trophy labels and PDF use combined genders. Team names are compared without case or punctuation, while branches such as Central Perlis (Muslim) and Central Perlis (Mohd Khair) remain separate.

## Retained operations

Public live queues, ring schedules, bracket paths, team/player search, result corrections, awards desk and delivery history, CSV results, overall PDF, shared staff PINs, qualifiers, empty categories, extra athletes, tournament import/reset, JSON backups and PostgreSQL persistence are retained. All completed disciplines use the awards desk for calling, medal delivery and absence recording. Result changes invalidate previous category delivery records.

## Verification and rebuilding the roster

```sh
npm ci
npm run check
npm test
python3 import_perlis_pdfs.py  # requires PyMuPDF
```

The importer rebuilds CSVs and the fresh-install SQL seed only; it does not overwrite live PostgreSQL results. The test suite completes every elimination bracket, checks score validation and ties, transfers, awards, mixed Ring G views, age/event isolation, combined Poomsae medals and the eight-page trophy PDF. Tests use in-memory fixtures and do not write live competition results.
# perlisopen
