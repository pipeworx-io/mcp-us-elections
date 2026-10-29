# @pipeworx/us-elections

U.S. election results — candidate-level vote counts for President and U.S.
Senate by state (every state, 1976-2024); official FEC district-by-district
U.S. House results for the 2020 and 2022 general elections nationwide (the
ungated alternative to MEDSL's guestbook-gated House file); and county- (13
states) and precinct-level (Pennsylvania, Michigan) detail for President,
Senate and U.S. House in the 2024 general election. Fleet #2952, extended
fleet #2958.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1857+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `election_results(state, year, office, level?, county?, district?, limit?, offset?)`
  — candidate-level results for one state/year/office at `state`, `county`,
  or `precinct` granularity (default `county`). Pass `county` to scope a
  county- or precinct-level query to one county, or `district` (e.g. `"09"`)
  to scope a House race to one district. Each row carries candidate,
  party, votes, the race total and vote share, plus `source`, `source_url`,
  `license` and `data_as_of`. A combination with no data returns a loud
  not-found naming which levels actually exist, never an empty success.
- `election_race_summary(state, year, office)` — aggregated totals, vote
  share, winner and margin for a race, computed from the most aggregated
  level actually available (statewide when covered, otherwise summed from
  whatever county/precinct detail exists). A district office (House) returns
  one summary per district.
- `list_elections(state?)` — the state/year/office combinations this pack
  actually holds, and at which levels. Call this first to check coverage
  before querying a specific race.

State accepts a postal code (`"PA"`) or full name (`"Pennsylvania"`),
case-insensitive. Office accepts `"president"`, `"senate"`, or `"house"`
(and common synonyms like `"POTUS"`, `"U.S. Senate"`).

## Auth

Keyless. The tools answer only through the Pipeworx gateway, which holds the
data; a standalone `npm install` has no data to read, and every tool throws
a clear "not bound in this runtime" error there instead of returning an
empty list.

## Data sources

- MIT Election Data + Science Lab (MEDSL), Harvard Dataverse — state-level
  U.S. President returns, 1976-2024.
- MIT Election Data + Science Lab (MEDSL), Harvard Dataverse — state-level
  U.S. Senate returns, 1976-2024.
  **Licence: CC0 1.0** (public domain dedication) for both.
- Federal Election Commission (fec.gov) — official "Federal Elections"
  statistical publication: district-by-district U.S. House results, 2020 and
  2022 general elections. (The same publication also has a Senate sheet,
  deliberately not loaded here — MEDSL above already covers Senate
  state-level for those years; loading both would double-count every
  candidate under `election_race_summary`. See load-data.mjs.)
  **Licence:** public domain (U.S. government work, 17 U.S.C. 105). No login,
  key or guestbook — served as a plain xlsx download off fec.gov.
- OpenElections — county-level 2024 general-election returns for Georgia,
  Mississippi, New Mexico, North Dakota, South Dakota, Tennessee, Utah, West
  Virginia, Colorado, Missouri, Oregon, South Carolina and Kentucky (13
  states), plus true precinct-level returns (also rolled up to county) for
  Pennsylvania and Michigan.
  **Licence:** no separate data-reuse licence is published on the data
  repositories; the project's parser codebase (`openelections-core`) is MIT,
  and the underlying figures are county/state election-board certified vote
  counts — public election records. No terms were found forbidding reuse, so
  this pack builds a copy per Pipeworx's rule for a source that only
  publishes bulk files: build it, and flag it, when the terms are silent.

### Known gaps — read before extending this pack

**MEDSL's own county-level and House files are gated, not just unbuilt.**
MEDSL's canonical "County Presidential Election Returns 2000-2024" dataset
and its "U.S. House 1976-2024" dataset (both on Harvard Dataverse) are gated
behind a **mandatory guestbook** (name, email, institution and position all
required) with no documented API bypass — every file-download call for those
two datasets returns *"You may not download this file without the required
Guestbook response for guestbookID 458"*, for anonymous and authenticated
access alike. This is an access wall, not a robots.txt question, so the
loader does not attempt to automate past it (CLAUDE.md "Authentication or
payment walls" is the applicable carve-out, even though no persistent
account is created — a mandatory identity-collection form blocking machine
access is the same shape). **The FEC's own official House-by-district file
(above) is the ungated replacement** for the cycles FEC has published so far
(2020, 2022). If a person fills the MEDSL guestbook form by hand and hands
the resulting file to this pack anyway, `scripts/us-elections/load-data.mjs`
can load it directly — the schema already has the right shape
(`level = 'county'`, `office = 'HOUSE'`).

**FEC has not yet published a compiled "Federal Elections 2024" edition.**
Checked live 2026-10-13: `fec.gov/.../federal-elections-2024/` 404s and 2024
is absent from fec.gov's own year index (2022 is the newest). This is normal
publication lag (the 2022 edition itself was not compiled until 2023), not a
gate — re-run the loader once FEC ships it. The two 2024-specific files FEC
has published today don't substitute: `2024presgeresults.xlsx` is
state-level President only with no party column, and
`2024congressgecands.xlsx` is a House/Senate **candidate roster** with no
vote counts at all.

**County/precinct coverage is 15 states, not fifty.** OpenElections publishes
one repository per state with its own column layout (there is no single
national file at this granularity). Surveyed 2026-10-13 against every
`openelections-data-<st>` repo's `2024/` directory via `gh api`: the 13 new
states above (plus the original PA/MI/GA) are the ones with a single clean
general-election county or precinct CSV matching this loader's column
assumptions (`county,office,district,party,candidate,votes`, optionally with
a `precinct` column). States left out because their 2024 directory splits by
office or by county into many small files, or has no single general-election
file at all: AZ, CT, IN, NH, NJ, NY, RI, TX, WY (checked), and every
`openelections-data-<st>` repo not listed above (not individually checked —
most have no `2024/` directory at all). Adding a clean-shaped state is
mechanical (one more entry in `COUNTY_STATES` or
`PRECINCT_TO_COUNTY_STATES` in the loader); a messier one needs its own
column mapping, same as PA/MI/GA's `oeState()` calls did originally.

**State legislature and Governor races are not loaded.** The task's
suggested scope mentioned them; they are left out to keep the row count and
column-mapping work bounded. `U.S. House` is loaded for FEC's 2020/2022
cycles nationwide, and for 2024 only in the states above (where
OpenElections' per-state files include it) — not nationally for 2024
(MEDSL's national House file is the gated one above, and FEC's 2024 edition
is not out yet).

**CO/MO/OR/SC/KY are county-level only in this pack, despite the source
being precinct-level.** Their raw federal-office precinct rows run
21k-64k each (~218k combined); only the county rollup (<2,500 rows each) is
stored, to keep load volume and default response size bounded. This is a
volume tradeoff, not a parsing limit — extend `load-data.mjs` to also keep
`level === 'precinct'` rows for any of them on request, same as PA/MI.

### Refreshing or extending the data

Re-run `node scripts/us-elections/load-data.mjs` (needs `wrangler` logged in
to the Pipeworx Cloudflare account, and `CLOUDFLARE_ACCOUNT_ID` set when more
than one account is visible) — it re-fetches every source live and replaces
the `election_results`/`sources` tables (DROP + reload), because MEDSL,
FEC and OpenElections all correct historical rows rather than appending to
them. To add an OpenElections state, add an entry to `COUNTY_STATES` (file
already at county level) or `PRECINCT_TO_COUNTY_STATES` (file at precinct
level, rolled up) if its file matches the standard column shape — otherwise
write a direct `oeState({...})` call with that state's own column names (see
the PA/MI/GA calls for the two bespoke shapes seen so far).

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "us-elections": {
      "url": "https://gateway.pipeworx.io/us-elections/mcp"
    }
  }
}
```

### What this endpoint actually serves

`tools/list` at `https://gateway.pipeworx.io/us-elections/mcp` returns the tools in the table
above **plus the shared Pipeworx meta-tools** — `ask_pipeworx`,
`discover_tools`, `search_within`, `remember`/`recall` and the rest of the
gateway-wide set. So the tool count you see is larger than this table: a
single-pack endpoint currently lists roughly 30 shared tools alongside the
pack's own. The connection's `initialize` response states its exact scope, and
is the authoritative answer for a given day.

This is deliberate, not multiplexing by accident. The meta-tools are what let a
scoped connection answer a question this pack does not cover — via
`ask_pipeworx`, which routes across the whole catalog — without you adding a
second MCP server. There is currently no way to mount a pack endpoint without
them; if the extra schemas cost you more context than the routing is worth,
connect to the full gateway once rather than to several pack endpoints.

Or connect to the full Pipeworx gateway to get every pack's tools listed
directly, instead of just this one's:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

Both URLs reach the same gateway and the same 1857+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/election_results \
  -H 'Content-Type: application/json' \
  -d '{"state":"PA","year":2024,"office":"president","level":"county"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/election_results`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Run it from npm

`@pipeworx/mcp-us-elections` is a local stdio bridge to the Pipeworx gateway: your MCP client
starts it with `npx`, and it forwards every call to the same
`https://gateway.pipeworx.io/us-elections/mcp` endpoint shown above. It needs network access;
there is no offline mode.

```json
{
  "mcpServers": {
    "us-elections": {
      "command": "npx",
      "args": ["-y", "@pipeworx/mcp-us-elections"]
    }
  }
}
```

Without a key it calls anonymously, capped at 50 calls a day. A free account
raises that to 200 a day: get a key at https://pipeworx.io/signup and add
`"env": { "PIPEWORX_API_KEY": "<your key>" }` to the server entry.
The key is sent as a Bearer token, the same way a hosted connection sends it,
so calls are metered and billed exactly as they are there.

It lists **only** this pack's tools by default. Set `PIPEWORX_META_TOOLS=1` to
also list `ask_pipeworx` and the other gateway-wide tools.

Behind an HTTPS proxy: Node's built-in `fetch` does not read `HTTPS_PROXY` by
default. Newer Node releases honour it when `NODE_USE_ENV_PROXY=1` is set; check
your Node version's documentation.

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English —
this works on the pack endpoint above as well as on the full gateway:

```
ask_pipeworx({ question: "your question about Us Elections data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
