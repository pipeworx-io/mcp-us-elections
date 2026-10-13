# @pipeworx/us-elections

U.S. election results — candidate-level vote counts for President and U.S.
Senate by state (every state, 1976-2024), plus county- and precinct-level
detail for President, Senate and U.S. House in the 2024 general election for
Pennsylvania, Michigan and Georgia. Fleet #2952.

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1779+ live data sources. This is an independent, unofficial integration — not affiliated with, endorsed by, or published by the upstream provider.

## Tools

- `election_results(state, year, office, level?, county?, limit?, offset?)`
  — candidate-level results for one state/year/office at `state`, `county`,
  or `precinct` granularity (default `county`). Pass `county` to scope a
  county- or precinct-level query to one county. Each row carries candidate,
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
- OpenElections — county- and precinct-level 2024 general-election returns
  for Pennsylvania, Michigan and Georgia.
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
access is the same shape). If a person fills the form by hand and hands the
resulting file to this pack, `scripts/us-elections/load-data.mjs` can load
it directly — the schema already has the right shape (`level = 'county'`,
`office = 'HOUSE'`).

**County/precinct coverage is three states, not fifty.** OpenElections
publishes one repository per state with its own column layout (there is no
single national file at this granularity), so adding a state means writing
that state's column mapping in the loader — PA, MI and GA's mappings are
there as working examples (`oeState()` call sites in
`scripts/us-elections/load-data.mjs`). This was scoped to three states for
the first commit to ship something real rather than nothing while chasing
fifty column layouts; adding more states is mechanical, not research.

**State legislature and Governor races are not loaded.** The task's
suggested scope mentioned them; they are left out of this first commit to
keep the row count and column-mapping work bounded. `U.S. House` is loaded
only for PA/MI/GA (where OpenElections' per-state files include it) and is
not loaded nationally (MEDSL's national House file is the gated one above).

### Refreshing or extending the data

Re-run `node scripts/us-elections/load-data.mjs` (needs `wrangler` logged in
to the Pipeworx Cloudflare account) — it re-fetches every source live and
replaces the `election_results`/`sources` tables (DROP + reload), because
MEDSL and OpenElections both correct historical rows rather than appending
to them. To add a state, add another `oeState({...})` call with that state's
column names (see the PA/MI/GA calls for the two shapes seen so far: a file
with its own `votes` total column vs. one that needs summing several
vote-mode columns).

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

Both URLs reach the same gateway and the same 1779+ data sources. The
only difference is which pack's tools are listed **directly**; `ask_pipeworx`
reaches all of them from either one.

## No MCP client? Call it over HTTP

```bash
curl -X POST https://gateway.pipeworx.io/v1/tools/election_results \
  -H 'Content-Type: application/json' \
  -d '{"state":"PA","year":2024,"office":"president","level":"county"}'
```

No account needed for the first calls. Inspect any tool: `GET https://gateway.pipeworx.io/v1/tools/election_results`. Find one: `POST https://gateway.pipeworx.io/v1/tools/search_packs` with `{"query":"..."}`.

## Standalone (no gateway account)

This package also runs as a local stdio MCP server — no Pipeworx account, no
gateway round-trip:

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

Or run it directly to confirm it starts:

```bash
npx -y @pipeworx/mcp-us-elections
```

It speaks MCP over stdin/stdout and answers `initialize`/`tools/list`/`tools/call`
for **only** this pack's tools — none of the shared meta-tools the gateway
connection above adds. Same source, same tools, no ask_pipeworx routing.

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
