/**
 * Reads for us-elections (fleet #2952).
 *
 * Data: MIT Election Data + Science Lab (MEDSL), Harvard Dataverse --
 * STATE-level U.S. President and U.S. Senate returns, 1976-2024 (CC0 1.0,
 * doi:10.7910/DVN/42MVDX and doi:10.7910/DVN/PEJ5QU) -- plus OpenElections
 * (github.com/openelections) county/precinct-level 2024 general-election
 * results for Pennsylvania, Michigan and Georgia. Loaded into a D1 database
 * the gateway hands this pack as `_d1` (pack-manifest "d1Binding":
 * "US_ELECTIONS_DB") by scripts/us-elections/load-data.mjs -- never by a
 * deploy.
 *
 * KNOWN GAP, found 2026-10-12: MEDSL's own COUNTY-level presidential file
 * and its HOUSE district-level file are both gated behind a mandatory
 * Harvard Dataverse guestbook (name/email/institution/position) with no
 * API bypass. County/precinct coverage here comes from OpenElections for
 * three states only (PA, GA, MI) until that is resolved or more states are
 * added -- see README.md "Known gaps" and the loader's header comment.
 */

/** The slice of Cloudflare's D1Database this pack uses, declared here so the
 *  pack needs no workers-types and a test can pass a node:sqlite stub. */
export interface D1Like {
  prepare(sql: string): D1StmtLike;
}
export interface D1StmtLike {
  bind(...values: unknown[]): D1StmtLike;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
}

export class StoreUnavailableError extends Error {
  constructor() {
    super(
      'us-elections: the elections store is not bound in this runtime (no _d1). These tools only answer through the Pipeworx gateway; a standalone install has no data to read.',
    );
    this.name = 'StoreUnavailableError';
  }
}
export function requireDb(d1: unknown): D1Like {
  if (!d1 || typeof (d1 as D1Like).prepare !== 'function') throw new StoreUnavailableError();
  return d1 as D1Like;
}

const STATES: [string, string][] = [
  ['ALABAMA', 'AL'], ['ALASKA', 'AK'], ['ARIZONA', 'AZ'], ['ARKANSAS', 'AR'], ['CALIFORNIA', 'CA'],
  ['COLORADO', 'CO'], ['CONNECTICUT', 'CT'], ['DELAWARE', 'DE'], ['DISTRICT OF COLUMBIA', 'DC'], ['FLORIDA', 'FL'],
  ['GEORGIA', 'GA'], ['HAWAII', 'HI'], ['IDAHO', 'ID'], ['ILLINOIS', 'IL'], ['INDIANA', 'IN'],
  ['IOWA', 'IA'], ['KANSAS', 'KS'], ['KENTUCKY', 'KY'], ['LOUISIANA', 'LA'], ['MAINE', 'ME'],
  ['MARYLAND', 'MD'], ['MASSACHUSETTS', 'MA'], ['MICHIGAN', 'MI'], ['MINNESOTA', 'MN'], ['MISSISSIPPI', 'MS'],
  ['MISSOURI', 'MO'], ['MONTANA', 'MT'], ['NEBRASKA', 'NE'], ['NEVADA', 'NV'], ['NEW HAMPSHIRE', 'NH'],
  ['NEW JERSEY', 'NJ'], ['NEW MEXICO', 'NM'], ['NEW YORK', 'NY'], ['NORTH CAROLINA', 'NC'], ['NORTH DAKOTA', 'ND'],
  ['OHIO', 'OH'], ['OKLAHOMA', 'OK'], ['OREGON', 'OR'], ['PENNSYLVANIA', 'PA'], ['RHODE ISLAND', 'RI'],
  ['SOUTH CAROLINA', 'SC'], ['SOUTH DAKOTA', 'SD'], ['TENNESSEE', 'TN'], ['TEXAS', 'TX'], ['UTAH', 'UT'],
  ['VERMONT', 'VT'], ['VIRGINIA', 'VA'], ['WASHINGTON', 'WA'], ['WEST VIRGINIA', 'WV'], ['WISCONSIN', 'WI'],
  ['WYOMING', 'WY'],
];
const BY_PO = new Map(STATES.map(([name, po]) => [po, name]));
const BY_NAME = new Map(STATES.map(([name, po]) => [name, po]));

/** Resolve free-form state input (postal code or full name, case-insensitive)
 *  to { state, state_po }, or null if it matches nothing we recognize. */
export function resolveState(input: unknown): { state: string; state_po: string } | null {
  if (input == null) return null;
  const s = String(input).trim();
  if (!s) return null;
  if (/^[a-zA-Z]{2}$/.test(s)) {
    const po = s.toUpperCase();
    const name = BY_PO.get(po);
    if (name) return { state: name, state_po: po };
  }
  const upper = s.toUpperCase();
  const po2 = BY_NAME.get(upper);
  if (po2) return { state: upper, state_po: po2 };
  return null;
}

const OFFICE_ALIASES: Record<string, string> = {
  PRESIDENT: 'PRESIDENT', PRESIDENTIAL: 'PRESIDENT', POTUS: 'PRESIDENT', 'US PRESIDENT': 'PRESIDENT', 'U.S. PRESIDENT': 'PRESIDENT',
  SENATE: 'SENATE', 'US SENATE': 'SENATE', 'U.S. SENATE': 'SENATE', 'UNITED STATES SENATE': 'SENATE',
  HOUSE: 'HOUSE', 'US HOUSE': 'HOUSE', 'U.S. HOUSE': 'HOUSE', 'HOUSE OF REPRESENTATIVES': 'HOUSE', CONGRESS: 'HOUSE',
};
/** Resolve free-form office input to one of our canonical office codes
 *  (PRESIDENT, SENATE, HOUSE), or null if unrecognized. */
export function resolveOffice(input: unknown): string | null {
  if (input == null) return null;
  const s = String(input).trim().toUpperCase();
  return OFFICE_ALIASES[s] ?? null;
}

export interface ResultRow {
  state: string;
  state_po: string;
  year: number;
  office: string;
  district: string | null;
  level: string;
  county: string | null;
  precinct: string | null;
  candidate: string;
  party: string | null;
  candidatevotes: number;
  totalvotes: number | null;
  source_key: string;
  data_as_of: string;
}
export interface SourceRow {
  source_key: string;
  source_dataset: string;
  source_url: string;
  license: string;
}

export async function getSources(db: D1Like): Promise<Map<string, SourceRow>> {
  const r = await db.prepare(`SELECT source_key, source_dataset, source_url, license FROM sources`).all<SourceRow>();
  return new Map(r.results.map((s) => [s.source_key, s]));
}

export function attachSource(row: ResultRow, sources: Map<string, SourceRow>) {
  const s = sources.get(row.source_key);
  return {
    candidate: row.candidate,
    party: row.party,
    candidatevotes: row.candidatevotes,
    totalvotes: row.totalvotes,
    state: row.state,
    state_po: row.state_po,
    year: row.year,
    office: row.office,
    district: row.district,
    level: row.level,
    county: row.county,
    precinct: row.precinct,
    source: s?.source_dataset ?? row.source_key,
    source_url: s?.source_url ?? null,
    license: s?.license ?? null,
    data_as_of: row.data_as_of,
  };
}

export interface ResultsFilter {
  state_po: string;
  year: number;
  office: string;
  level: string;
  county?: string;
  limit: number;
  offset: number;
}

export async function findResults(db: D1Like, f: ResultsFilter): Promise<ResultRow[]> {
  const where: string[] = ['state_po = ?', 'year = ?', 'office = ?', 'level = ?'];
  const params: unknown[] = [f.state_po, f.year, f.office, f.level];
  if (f.county) {
    where.push('county = ? COLLATE NOCASE');
    params.push(f.county);
  }
  const sql = `SELECT state, state_po, year, office, district, level, county, precinct, candidate, party, candidatevotes, totalvotes, source_key, data_as_of
    FROM election_results WHERE ${where.join(' AND ')}
    ORDER BY county, precinct, candidatevotes DESC
    LIMIT ? OFFSET ?`;
  params.push(f.limit, f.offset);
  const r = await db.prepare(sql).bind(...params).all<ResultRow>();
  return r.results;
}

export async function countResults(db: D1Like, f: Omit<ResultsFilter, 'limit' | 'offset'>): Promise<number> {
  const where: string[] = ['state_po = ?', 'year = ?', 'office = ?', 'level = ?'];
  const params: unknown[] = [f.state_po, f.year, f.office, f.level];
  if (f.county) {
    where.push('county = ? COLLATE NOCASE');
    params.push(f.county);
  }
  const r = await db
    .prepare(`SELECT COUNT(*) AS n FROM election_results WHERE ${where.join(' AND ')}`)
    .bind(...params)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Which levels exist for a given state/year/office. */
export async function availableLevels(db: D1Like, state_po: string, year: number, office: string): Promise<string[]> {
  const r = await db
    .prepare(`SELECT DISTINCT level FROM election_results WHERE state_po = ? AND year = ? AND office = ?`)
    .bind(state_po, year, office)
    .all<{ level: string }>();
  return r.results.map((x) => x.level);
}

export interface RaceCandidate {
  candidate: string;
  party: string | null;
  votes: number;
  share: number;
}
export interface RaceSummary {
  district: string | null;
  level: string;
  totalvotes: number;
  candidates: RaceCandidate[];
  winner: string | null;
  margin_votes: number | null;
  margin_pct: number | null;
}

/** Summarize a race at the best available level: prefer 'state' (one
 *  statewide number per candidate), else fall back to summing whatever
 *  finer-grained rows exist (county, else precinct), grouped by district
 *  (null for statewide offices like President/Senate). */
export async function raceSummary(db: D1Like, state_po: string, year: number, office: string): Promise<{ level_used: string; races: RaceSummary[] } | null> {
  const levels = await availableLevels(db, state_po, year, office);
  if (!levels.length) return null;
  const levelUsed = levels.includes('state') ? 'state' : levels.includes('county') ? 'county' : 'precinct';

  const r = await db
    .prepare(
      `SELECT district, candidate, party, SUM(candidatevotes) AS votes
       FROM election_results
       WHERE state_po = ? AND year = ? AND office = ? AND level = ?
       GROUP BY district, candidate, party
       ORDER BY district, votes DESC`,
    )
    .bind(state_po, year, office, levelUsed)
    .all<{ district: string | null; candidate: string; party: string | null; votes: number }>();

  const byDistrict = new Map<string | null, { candidate: string; party: string | null; votes: number }[]>();
  for (const row of r.results) {
    const k = row.district ?? null;
    if (!byDistrict.has(k)) byDistrict.set(k, []);
    byDistrict.get(k)!.push({ candidate: row.candidate, party: row.party, votes: row.votes });
  }

  const races: RaceSummary[] = [];
  for (const [district, rows] of byDistrict) {
    const totalvotes = rows.reduce((a, b) => a + b.votes, 0);
    const candidates = rows.map((c) => ({ candidate: c.candidate, party: c.party, votes: c.votes, share: totalvotes > 0 ? c.votes / totalvotes : 0 }));
    const sorted = [...candidates].sort((a, b) => b.votes - a.votes);
    const winner = sorted[0]?.candidate ?? null;
    const margin_votes = sorted.length >= 2 ? sorted[0].votes - sorted[1].votes : sorted.length === 1 ? sorted[0].votes : null;
    const margin_pct = sorted.length >= 2 && totalvotes > 0 ? (sorted[0].votes - sorted[1].votes) / totalvotes : null;
    races.push({ district, level: levelUsed, totalvotes, candidates: sorted, winner, margin_votes, margin_pct });
  }
  races.sort((a, b) => (a.district ?? '').localeCompare(b.district ?? ''));
  return { level_used: levelUsed, races };
}

export interface ElectionListing {
  state: string;
  state_po: string;
  year: number;
  office: string;
  levels: string[];
}

export async function listElections(db: D1Like, state_po?: string): Promise<ElectionListing[]> {
  const where = state_po ? 'WHERE state_po = ?' : '';
  const params = state_po ? [state_po] : [];
  const r = await db
    .prepare(`SELECT DISTINCT state, state_po, year, office, level FROM election_results ${where} ORDER BY state, year DESC, office`)
    .bind(...params)
    .all<{ state: string; state_po: string; year: number; office: string; level: string }>();
  const key = (row: { state_po: string; year: number; office: string }) => `${row.state_po}|${row.year}|${row.office}`;
  const grouped = new Map<string, ElectionListing>();
  for (const row of r.results) {
    const k = key(row);
    if (!grouped.has(k)) grouped.set(k, { state: row.state, state_po: row.state_po, year: row.year, office: row.office, levels: [] });
    grouped.get(k)!.levels.push(row.level);
  }
  return [...grouped.values()];
}

export async function dataAsOf(db: D1Like): Promise<string | null> {
  const r = await db.prepare(`SELECT value FROM elections_meta WHERE key = 'loaded_at'`).first<{ value: string }>();
  return r?.value ?? null;
}
