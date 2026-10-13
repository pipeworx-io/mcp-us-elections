interface McpToolDefinition {
  name: string;
  description: string;
  /** Human-facing one-liner (fleet #1967). Optional; consumers fall back to
   *  description. Kept in step with shared/src/types.ts — scripts/lib/
   *  check-inlined-types.mjs reports drift at publish time. */
  summary?: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
    anyOf?: Array<{ required: string[] }>;
    oneOf?: Array<{ required: string[] }>;
    allOf?: Array<{ required: string[] }>;
  };
  outputSchema?: Record<string, unknown>;
}

interface McpToolExport {
  tools: McpToolDefinition[];
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  meter?: { credits: number };
  cost?: Record<string, unknown>;
  provider?: string;
}

/**
 * us-elections -- U.S. election results by county and precinct (fleet #2952).
 *
 * Data: MIT Election Data + Science Lab (MEDSL), Harvard Dataverse --
 * STATE-level U.S. President and U.S. Senate returns, 1976-2024, CC0 1.0
 * (doi:10.7910/DVN/42MVDX, doi:10.7910/DVN/PEJ5QU) -- plus OpenElections
 * (github.com/openelections) COUNTY- and PRECINCT-level results for the
 * 2024 general election in Pennsylvania, Michigan and Georgia. The site
 * publishes bulk files only, so this pack builds a copy
 * (scripts/us-elections/load-data.mjs) into a D1 database the gateway hands
 * it as `_d1` (pack-manifest "d1Binding": "US_ELECTIONS_DB"). Design note:
 * this file + store.ts.
 *
 * KNOWN GAP: MEDSL's own county-level presidential file and House
 * district-level file are both gated behind a mandatory Harvard Dataverse
 * guestbook (name/email/institution/position) with no API bypass -- see
 * README.md "Known gaps" and the loader's header comment. County/precinct
 * coverage is OpenElections-only, for three states, until that is resolved.
 *
 * Every response carries `source`, `source_url`, `license` and
 * `data_as_of` per row (election_results) or at the top level
 * (election_race_summary, list_elections).
 */
import {
  attachSource,
  availableLevels,
  countResults,
  dataAsOf,
  findResults,
  getSources,
  listElections,
  raceSummary,
  requireDb,
  resolveOffice,
  resolveState,
  type D1Like,
} from './store.js';

const tools: McpToolExport['tools'] = [
  {
    name: 'election_results',
    description:
      'Candidate-level U.S. election results for one state, year and office, at state, county, or precinct granularity. State-level President and Senate cover every state 1976-2024 (MIT Election Data + Science Lab / MEDSL, Harvard Dataverse, CC0). County- and precinct-level President/Senate/House cover the 2024 general election in Pennsylvania, Michigan and Georgia only (OpenElections) -- this is the current limit of coverage, not a bug. Pass state as a postal code ("PA") or full name ("Pennsylvania"), office as "president", "senate" or "house". Use county to scope a county/precinct query (e.g. county="Allegheny"); omit it at level="county" to get every county in the state. Returns candidate, party, votes, the race total and the share of the vote, plus source/licence/data_as_of on every row. A state/year/office/level combination with no data returns a loud not-found (reason + available_levels hint), never an empty success.',
    summary: 'Candidate-level election results by state/year/office at state, county or precinct granularity.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        state: { type: 'string', description: 'US state, postal code ("PA") or full name ("Pennsylvania").' },
        year: { type: 'number', description: 'Election year, e.g. 2024.' },
        office: { type: 'string', description: '"president", "senate", or "house".' },
        level: { type: 'string', description: 'Granularity: "state", "county", or "precinct". Default "county".' },
        county: { type: 'string', description: 'County name to scope a county- or precinct-level query (case-insensitive). Optional.' },
        limit: { type: 'number', description: 'Max rows, 1-500. Default 50. A truncated response carries truncated:true, total_matching, and a hint for narrowing (county, level="county").' },
        offset: { type: 'number', description: 'Pagination offset. Default 0.' },
      },
      required: ['state', 'year', 'office'],
    },
  },
  {
    name: 'election_race_summary',
    description:
      'Aggregated summary of a U.S. election race -- total votes, each candidate\'s vote share, the winner and the winning margin -- for one state/year/office. Uses the most aggregated level actually available for that race: a statewide number when MEDSL state-level data covers it (President/Senate, every state, 1976-2024), otherwise summed from whatever county/precinct detail exists (OpenElections: PA/MI/GA, 2024 only). For a district office (House) returns one summary per district. Use for "who won the 2024 PA Senate race and by how much" rather than reading every county row yourself.',
    summary: 'Totals, vote shares, winner and margin for a state/year/office race (one entry per district if applicable).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        state: { type: 'string', description: 'US state, postal code ("PA") or full name ("Pennsylvania").' },
        year: { type: 'number', description: 'Election year, e.g. 2024.' },
        office: { type: 'string', description: '"president", "senate", or "house".' },
      },
      required: ['state', 'year', 'office'],
    },
  },
  {
    name: 'list_elections',
    description:
      'List the state/year/office combinations this pack actually holds data for, and at which levels (state/county/precinct). Pass state to scope the listing to one state; omit it to see full coverage. Use this before election_results or election_race_summary to check whether a given state/year/office exists before querying it, or to discover what is covered.',
    summary: 'List available state/year/office/level combinations held in this pack.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        state: { type: 'string', description: 'US state, postal code ("PA") or full name ("Pennsylvania"), to scope the listing. Optional.' },
      },
    },
  },
];

function clampInt(v: unknown, lo: number, hi: number, d: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}
function str(v: unknown): string | null {
  return v != null && v !== '' ? String(v).trim() : null;
}

async function electionResultsTool(db: D1Like, args: Record<string, unknown>) {
  const asOf = await dataAsOf(db);
  const resolvedState = resolveState(args.state);
  if (!resolvedState) {
    return {
      found: false,
      reason: 'unknown_state',
      message: `${JSON.stringify(args.state)} is not a recognized US state (postal code or full name).`,
      data_as_of: asOf,
    };
  }
  const office = resolveOffice(args.office);
  if (!office) {
    return {
      found: false,
      reason: 'unknown_office',
      message: `${JSON.stringify(args.office)} is not a recognized office. Use "president", "senate", or "house".`,
      data_as_of: asOf,
    };
  }
  const year = Math.floor(Number(args.year));
  if (!Number.isFinite(year)) throw new Error('year must be a valid number');
  const level = (str(args.level) ?? 'county').toLowerCase();
  if (!['state', 'county', 'precinct'].includes(level)) {
    return {
      found: false,
      reason: 'unknown_level',
      message: `level must be "state", "county", or "precinct" (got ${JSON.stringify(args.level)}).`,
      data_as_of: asOf,
    };
  }
  const county = str(args.county) ?? undefined;
  const limit = clampInt(args.limit, 1, 500, 50);
  const offset = Math.max(0, Math.floor(Number(args.offset) || 0));

  const filter = { state_po: resolvedState.state_po, year, office, level, county, limit, offset };
  const [rows, total, levels] = await Promise.all([
    findResults(db, filter),
    countResults(db, filter),
    availableLevels(db, resolvedState.state_po, year, office),
  ]);

  if (!levels.length) {
    return {
      found: false,
      reason: 'not_found',
      state: resolvedState.state,
      state_po: resolvedState.state_po,
      year,
      office,
      message: `No ${office} results held for ${resolvedState.state} in ${year}. This pack covers state-level President/Senate nationwide 1976-2024, and county/precinct detail for PA, MI and GA (2024 general) only.`,
      hint: 'Call list_elections to see what is actually covered.',
      data_as_of: asOf,
    };
  }
  if (!rows.length) {
    return {
      found: false,
      reason: level === 'county' || level === 'precinct' ? 'level_not_covered_for_state' : 'no_match',
      state: resolvedState.state,
      state_po: resolvedState.state_po,
      year,
      office,
      level,
      county: county ?? null,
      message: `No ${level}-level ${office} results held for ${resolvedState.state} in ${year}${county ? ` (county=${county})` : ''}. Levels actually available: ${levels.join(', ')}.`,
      available_levels: levels,
      data_as_of: asOf,
    };
  }

  const sources = await getSources(db);
  const truncated = rows.length < total;
  return {
    found: true,
    state: resolvedState.state,
    state_po: resolvedState.state_po,
    year,
    office,
    level,
    county: county ?? null,
    returned: rows.length,
    total_matching: total,
    truncated,
    ...(truncated
      ? { hint: 'More rows exist than were returned. Narrow with county=<name> and/or level="county" (fewer rows than "precinct"), or page with limit/offset.' }
      : {}),
    results: rows.map((r) => attachSource(r, sources)),
    data_as_of: asOf,
  };
}

async function raceSummaryTool(db: D1Like, args: Record<string, unknown>) {
  const asOf = await dataAsOf(db);
  const resolvedState = resolveState(args.state);
  if (!resolvedState) {
    return { found: false, reason: 'unknown_state', message: `${JSON.stringify(args.state)} is not a recognized US state.`, data_as_of: asOf };
  }
  const office = resolveOffice(args.office);
  if (!office) {
    return {
      found: false,
      reason: 'unknown_office',
      message: `${JSON.stringify(args.office)} is not a recognized office. Use "president", "senate", or "house".`,
      data_as_of: asOf,
    };
  }
  const year = Math.floor(Number(args.year));
  if (!Number.isFinite(year)) throw new Error('year must be a valid number');

  const result = await raceSummary(db, resolvedState.state_po, year, office);
  if (!result) {
    return {
      found: false,
      reason: 'not_found',
      state: resolvedState.state,
      state_po: resolvedState.state_po,
      year,
      office,
      message: `No ${office} results held for ${resolvedState.state} in ${year}.`,
      hint: 'Call list_elections to see what is actually covered.',
      data_as_of: asOf,
    };
  }
  return {
    found: true,
    state: resolvedState.state,
    state_po: resolvedState.state_po,
    year,
    office,
    level_used: result.level_used,
    races: result.races,
    data_as_of: asOf,
  };
}

async function listElectionsTool(db: D1Like, args: Record<string, unknown>) {
  const asOf = await dataAsOf(db);
  let state_po: string | undefined;
  if (args.state != null && args.state !== '') {
    const resolved = resolveState(args.state);
    if (!resolved) {
      return { found: false, reason: 'unknown_state', message: `${JSON.stringify(args.state)} is not a recognized US state.`, data_as_of: asOf };
    }
    state_po = resolved.state_po;
  }
  const rows = await listElections(db, state_po);
  return {
    found: rows.length > 0,
    scope: state_po ?? 'all states',
    count: rows.length,
    elections: rows,
    coverage_note:
      'State-level President and Senate cover every state, 1976-2024 (MEDSL, CC0). County/precinct detail currently covers Pennsylvania, Michigan and Georgia, 2024 general election only (OpenElections). More states are a planned extension.',
    data_as_of: asOf,
  };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const bound = requireDb(args._d1);
  switch (name) {
    case 'election_results':
      return electionResultsTool(bound, args);
    case 'election_race_summary':
      return raceSummaryTool(bound, args);
    case 'list_elections':
      return listElectionsTool(bound, args);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export default { tools, callTool, meter: { credits: 1 } } satisfies McpToolExport;
