// Helper script (not part of seed pipeline) — produces prisma/data/matches.json.
// Re-run if the calendar of the FIFA 2026 World Cup needs updating.
//
// Run:  node prisma/data/generate-matches.mjs
//
// Notes:
// - 12 groups (A..L) × 6 matches/group = 72 GROUP matches
// - 16 ROUND_32, 8 ROUND_16, 4 QUARTERS, 2 SEMIS, 1 THIRD_PLACE, 1 FINAL = 104 total
// - kickoffAt is in UTC. predictionsLockAt = kickoffAt - 10 min.
// - Group games: homeTeamId/awayTeamId stay null until the draw; labels use
//   "Eq <Group><N>" placeholders (e.g. "Eq A1" vs "Eq A2").
// - Knockout games reference the bracket by qualifier label.
// - Venue/city/country use the 16 official 2026 host cities, distributed
//   roughly per the published bid documents.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Venues ──────────────────────────────────────────────────────────────
// Distribution intent: USA hosts 78 matches, MEX hosts 13, CAN hosts 13.
const VENUES = [
  // United States
  { venue: 'Mercedes-Benz Stadium', city: 'Atlanta', country: 'USA' },
  { venue: 'Gillette Stadium',      city: 'Boston',  country: 'USA' },
  { venue: 'AT&T Stadium',          city: 'Dallas',  country: 'USA' },
  { venue: 'NRG Stadium',           city: 'Houston', country: 'USA' },
  { venue: 'Arrowhead Stadium',     city: 'Kansas City', country: 'USA' },
  { venue: 'SoFi Stadium',          city: 'Los Angeles', country: 'USA' },
  { venue: 'Hard Rock Stadium',     city: 'Miami',   country: 'USA' },
  { venue: 'MetLife Stadium',       city: 'New York/New Jersey', country: 'USA' },
  { venue: 'Lincoln Financial Field', city: 'Philadelphia', country: 'USA' },
  { venue: "Levi's Stadium",        city: 'San Francisco', country: 'USA' },
  { venue: 'Lumen Field',           city: 'Seattle', country: 'USA' },
  // Mexico
  { venue: 'Estadio Akron',         city: 'Guadalajara', country: 'MEX' },
  { venue: 'Estadio Azteca',        city: 'Mexico City', country: 'MEX' },
  { venue: 'Estadio BBVA',          city: 'Monterrey', country: 'MEX' },
  // Canada
  { venue: 'BMO Field',             city: 'Toronto', country: 'CAN' },
  { venue: 'BC Place',              city: 'Vancouver', country: 'CAN' },
];

function roundRobin(venues) {
  let i = 0;
  return () => venues[i++ % venues.length];
}

// ─── Group stage ─────────────────────────────────────────────────────────
const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// Round-robin pairings for a 4-team group: (home, away) per round
// Rounds 1, 2, 3 — 6 matches per group.
const GROUP_ROUNDS = [
  [[1, 2], [3, 4]], // round 1
  [[1, 3], [2, 4]], // round 2
  [[1, 4], [2, 3]], // round 3
];

// Group stage runs 11 Jun through 27 Jun 2026 inclusive (17 days = 72 slots).
// 4 matches/day at 16:00, 19:00, 22:00, 01:00+1 UTC (the opening day starts
// at 20:00 UTC for the inaugural at Estadio Azteca, then runs the same
// 19:00/22:00/01:00+1 sequence afterwards). We just pre-compute 72 slots.
const GROUP_KICKOFFS_UTC = [];
{
  const slots = ['16:00', '19:00', '22:00']; // last slot is 01:00 next day
  const start = new Date('2026-06-11T00:00:00Z');
  let day = 0;
  while (GROUP_KICKOFFS_UTC.length < 72) {
    const base = new Date(start);
    base.setUTCDate(start.getUTCDate() + day);
    for (const hhmm of slots) {
      if (GROUP_KICKOFFS_UTC.length >= 72) break;
      const [hh, mm] = hhmm.split(':').map(Number);
      const d = new Date(base);
      d.setUTCHours(hh, mm, 0, 0);
      GROUP_KICKOFFS_UTC.push(d.toISOString());
    }
    if (GROUP_KICKOFFS_UTC.length >= 72) break;
    // 01:00 the following day
    const late = new Date(base);
    late.setUTCDate(late.getUTCDate() + 1);
    late.setUTCHours(1, 0, 0, 0);
    GROUP_KICKOFFS_UTC.push(late.toISOString());
    day++;
  }
}

if (GROUP_KICKOFFS_UTC.length !== 72) {
  throw new Error(`Expected 72 group kickoffs, got ${GROUP_KICKOFFS_UTC.length}`);
}

const KO_DATES = {
  // ROUND_32 — 16 matches across 28 Jun – 3 Jul 2026 (3 per day mostly)
  ROUND_32: [
    '2026-06-28T20:00:00Z', '2026-06-28T23:00:00Z',
    '2026-06-29T17:00:00Z', '2026-06-29T20:00:00Z', '2026-06-29T23:00:00Z',
    '2026-06-30T17:00:00Z', '2026-06-30T20:00:00Z', '2026-06-30T23:00:00Z',
    '2026-07-01T20:00:00Z', '2026-07-01T23:00:00Z',
    '2026-07-02T17:00:00Z', '2026-07-02T20:00:00Z', '2026-07-02T23:00:00Z',
    '2026-07-03T17:00:00Z', '2026-07-03T20:00:00Z', '2026-07-03T23:00:00Z',
  ],
  // ROUND_16 — 4–7 Jul (8 matches)
  ROUND_16: [
    '2026-07-04T18:00:00Z', '2026-07-04T22:00:00Z',
    '2026-07-05T18:00:00Z', '2026-07-05T22:00:00Z',
    '2026-07-06T18:00:00Z', '2026-07-06T22:00:00Z',
    '2026-07-07T18:00:00Z', '2026-07-07T22:00:00Z',
  ],
  // QUARTERS — 9–11 Jul (4 matches)
  QUARTERS: [
    '2026-07-09T20:00:00Z', '2026-07-09T23:00:00Z',
    '2026-07-11T20:00:00Z', '2026-07-11T23:00:00Z',
  ],
  // SEMIS — 14–15 Jul (2 matches)
  SEMIS: [
    '2026-07-14T22:00:00Z',
    '2026-07-15T22:00:00Z',
  ],
  // THIRD_PLACE — 18 Jul
  THIRD_PLACE: ['2026-07-18T20:00:00Z'],
  // FINAL — 19 Jul
  FINAL: ['2026-07-19T19:00:00Z'],
};

// Validate KO totals
for (const [phase, expected] of [['ROUND_32', 16], ['ROUND_16', 8], ['QUARTERS', 4], ['SEMIS', 2], ['THIRD_PLACE', 1], ['FINAL', 1]]) {
  if (KO_DATES[phase].length !== expected) {
    throw new Error(`${phase}: expected ${expected}, got ${KO_DATES[phase].length}`);
  }
}

const venuePicker = roundRobin(VENUES);

function lockAt(iso) {
  const d = new Date(iso);
  d.setUTCMinutes(d.getUTCMinutes() - 10);
  return d.toISOString();
}

const matches = [];
let n = 1;

// ─── Group stage matches ─────────────────────────────────────────────────
// 12 groups × 6 matches = 72. Distribute across the 72 GROUP_KICKOFFS slots
// in column-major order so each round (1,2,3) of every group fills before
// moving on.
let kickoffIdx = 0;
for (let round = 0; round < 3; round++) {
  for (const group of GROUPS) {
    for (const [h, a] of GROUP_ROUNDS[round]) {
      const iso = GROUP_KICKOFFS_UTC[kickoffIdx++];
      const v = venuePicker();
      matches.push({
        matchNumber: n++,
        phase: 'GROUPS',
        groupCode: group,
        homeTeamLabel: `Eq ${group}${h}`,
        awayTeamLabel: `Eq ${group}${a}`,
        kickoffAt: iso,
        predictionsLockAt: lockAt(iso),
        venue: v.venue,
        city: v.city,
        country: v.country,
      });
    }
  }
}

// ─── Knockout phases ─────────────────────────────────────────────────────
const KO_LABELS = {
  ROUND_32: Array.from({ length: 16 }, (_, i) => [`Mejor R32 H${i + 1}`, `Mejor R32 V${i + 1}`]),
  ROUND_16: Array.from({ length: 8 }, (_, i) => [`Ganador R32 ${i * 2 + 1}`, `Ganador R32 ${i * 2 + 2}`]),
  QUARTERS: Array.from({ length: 4 }, (_, i) => [`Ganador R16 ${i * 2 + 1}`, `Ganador R16 ${i * 2 + 2}`]),
  SEMIS: [
    ['Ganador QF 1', 'Ganador QF 2'],
    ['Ganador QF 3', 'Ganador QF 4'],
  ],
  THIRD_PLACE: [['Perdedor SF 1', 'Perdedor SF 2']],
  FINAL: [['Ganador SF 1', 'Ganador SF 2']],
};

for (const phase of ['ROUND_32', 'ROUND_16', 'QUARTERS', 'SEMIS', 'THIRD_PLACE', 'FINAL']) {
  KO_DATES[phase].forEach((iso, i) => {
    const [home, away] = KO_LABELS[phase][i];
    // Final at MetLife (NY/NJ); third place at AT&T Stadium (Dallas) per the
    // published 2026 plan. Other knockouts use round-robin distribution.
    let v;
    if (phase === 'FINAL') v = VENUES.find((x) => x.venue === 'MetLife Stadium');
    else if (phase === 'THIRD_PLACE') v = VENUES.find((x) => x.venue === 'AT&T Stadium');
    else if (phase === 'SEMIS') v = VENUES[i === 0 ? 0 : 5]; // Atlanta + LA
    else v = venuePicker();

    matches.push({
      matchNumber: n++,
      phase,
      groupCode: null,
      homeTeamLabel: home,
      awayTeamLabel: away,
      kickoffAt: iso,
      predictionsLockAt: lockAt(iso),
      venue: v.venue,
      city: v.city,
      country: v.country,
    });
  });
}

if (matches.length !== 104) {
  throw new Error(`Expected 104 matches, got ${matches.length}`);
}

const out = join(__dirname, 'matches.json');
writeFileSync(out, JSON.stringify(matches, null, 2) + '\n');
console.log(`Wrote ${matches.length} matches to ${out}`);
