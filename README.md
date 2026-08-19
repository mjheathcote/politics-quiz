# UK Party Policy Alignment Quiz — politics.ryetown.uk

Anonymous quiz: rate agreement with 30 policy statements (6 per party × 5 parties)
without knowing which party said what, then see which party you're most (and least)
aligned with. Hosted on GitHub, deployed to Cloudflare Workers (static assets),
data refreshed monthly by a fully automated GitHub Actions job.

**Note on hosting choice:** the original plan was Cloudflare Pages. Mid-build we
looked into whether Pages was being phased out — no official end-of-life, but
Cloudflare's docs now steer new static sites toward Workers + static assets, with
an active Pages→Workers migration guide and no comparable new investment in Pages.
Rather than build on a product that's clearly not where Cloudflare's putting
effort, we re-architected onto Workers before ever going live — see "Hosting" below
for what changed and the one real trade-off it introduces (custom domains need
Cloudflare-managed DNS).

## Status

**Phase 5 (this commit): everything's written, including CI/CD config.** All that
remains is two manual steps only you can do — pushing to a GitHub repo and
connecting Cloudflare — since I don't have GitHub write access or a Cloudflare
deploy credential in this environment. See "Going live" below for exactly what to
do and how long it takes.

## Repo structure

```
politics-quiz/
├── .github/
│   └── workflows/
│       └── update-policies.yml     # monthly cron: runs scripts/fetch-policies.mjs,
│                                    # validates, commits + pushes to main directly
├── data/
│   └── 2026-08/                    # one dir per month, immutable once written
│       ├── labour.json
│       ├── conservative.json
│       ├── reform.json
│       ├── libdem.json
│       └── green.json
├── scripts/
│   ├── schema.json                 # JSON Schema — source of truth for the data shape
│   ├── validate.mjs                # validates a month's 5 files against schema.json
│   ├── fetch-policies.mjs          # calls Anthropic Messages API w/ web_search per
│   │                                # party, parses + validates + writes data/YYYY-MM/*.json,
│   │                                # falls back to the previous month's file per party on
│   │                                # any failure (never writes broken/blank data)
│   └── lib/
│       ├── schema-validate.mjs     # shared ajv validator used by both scripts above
│       └── mock-response.mjs       # canned API responses for `--mock` testing (no key needed)
├── src/
│   ├── layouts/
│   │   └── Base.astro              # HTML shell, imports global.css
│   ├── styles/
│   │   └── global.css              # mobile-first, one-card-per-screen styling
│   ├── lib/
│   │   ├── types.ts                # shared types (Policy, AnswerKey, QuizResults, ...)
│   │   ├── loadPolicies.ts         # build-time only (node:fs): finds latest data/YYYY-MM/,
│   │   │                           # calls buildQuizPool() once per build, cached for both
│   │   │                           # index.astro and answer-key.json.ts to reuse
│   │   ├── scoring.ts              # pure scoring/ranking functions — no I/O, unit-tested
│   │   ├── scoring.test.ts         # node:test suite, run against data/2026-08 sample data
│   │   └── quizApp.ts              # client-side controller: renders questions, collects
│   │                               # answers in memory, fetches /answer-key.json only after
│   │                               # the last question, renders the results view
│   └── pages/
│       ├── index.astro             # the single-page quiz; embeds {id,statement} pool inline,
│       │                           # loads quizApp.ts as a real bundled module (see note below)
│       └── answer-key.json.ts      # static JSON endpoint — prerenders to a plain
│                                   # /answer-key.json file at build time (see Privacy design)
├── public/                         # static assets (currently empty; favicon is inlined)
├── astro.config.mjs
├── tsconfig.json
├── package.json
└── README.md
```

Actual build output (`npm run build` → `dist/`) is just `index.html`, one hashed
`_astro/*.js` bundle, and `answer-key.json` — confirmed by inspection: `index.html`
and the JS bundle contain zero occurrences of `partyId`, `sourceUrl`, or any party
name; only `answer-key.json` does.

**Gotcha worth documenting:** an inline `<script>` tag in an `.astro` file is only
bundled by Vite (so its relative imports actually resolve in the browser) if it has
**no attributes other than `src`** — adding `type="module"` explicitly opts it *out*
of processing and Astro ships it byte-for-byte, imports and all, which is broken in
a browser. `index.astro`'s script deliberately has no `type` attribute for this
reason; see the comment there and
[Astro's client-side scripts docs](https://docs.astro.build/en/guides/client-side-scripts/).

## Data schema

See `scripts/schema.json`. One file per party per month at
`data/YYYY-MM/{partyId}.json`, exactly 6 policies each:

```json
{
  "party": "Green Party",
  "partyId": "green",
  "asOf": "2026-08-19",
  "policies": [
    {
      "id": "green-01",
      "title": "Public ownership of water",
      "statement": "Bring water companies into public ownership to end privatisation failures.",
      "sourceUrl": "https://policy.greenparty.org.uk/..."
    }
  ]
}
```

`partyId` is one of the fixed 5: `labour`, `conservative`, `reform`, `libdem`, `green`
(UK-wide parties only — no SNP).

Sample data for **2026-08** has been hand-written for all 5 parties from each party's
current stated positions (Labour's Plan for Change, the Conservatives' "Plan for
Britain", Reform UK's published policy page, recent Lib Dem growth/care/PR positions,
and Green Party policy areas), for schema-testing purposes. These will be superseded
by live `web_search`-sourced data once the phase-2 pipeline is wired up.

## Privacy design: how `partyId`/`sourceUrl` stay hidden mid-quiz

Because this is a static site with no backend, "hidden in the UI" isn't good enough —
the requirement is that the data never reaches the client until reveal. This is now
actually implemented, not just planned:

1. **`buildQuizPool()`** (`src/lib/scoring.ts`), called once at build time from
   `loadPolicies.ts`, splits the 5 loaded party files into two objects: `quizStatements`
   (`{ id, statement }` only) and `answerKey` (`{ id, partyId, party, title, sourceUrl }`).
   This is the actual data-fetching-layer strip — it happens in a build-time-only module
   that's never imported into the client bundle.
2. **`index.astro`** embeds only `quizStatements` inline in the page (in a
   `<script type="application/json">` block, `<`-escaped so a policy statement can
   never prematurely close the tag) and hands it to `quizApp.ts`. Nothing else about
   the parties is anywhere in the initial HTML or the JS bundle.
3. **`answer-key.json.ts`** prerenders `answerKey` to a plain static file at
   `/answer-key.json` in the build output. It is not linked or preloaded from the
   quiz page.
4. **`quizApp.ts`** only calls `fetch("/answer-key.json")` once, inside `loadResults()`,
   which only runs after the 30th question has been answered (or skipped).

Verified two ways: (a) inspecting `dist/index.html` and `dist/_astro/*.js` after a real
`astro build` shows zero occurrences of `partyId`, `sourceUrl`, or any party name —
grep confirms it, not just code review; (b) an automated headless-browser run
(`npm run test:e2e`, see below) plays through all 30 questions and asserts the network
log shows no request to `answer-key.json` until after the results screen begins
rendering.

The one honest caveat: `answer-key.json` is a normal static file once deployed, so
anyone who guesses/finds the URL can fetch it directly by typing it in, bypassing the
quiz. Per the project's "for fun, not audited" scope that's an acceptable trade-off —
the stronger alternative (serving it from a Cloudflare Worker/Function that requires a
"quiz completed" token) is a possible future hardening step, not something phase 4
needed to solve.

## Validating the sample data

```bash
npm install
npm run validate:data        # validates data/2026-08 (latest month) against schema.json
npm run validate:data 2026-08  # or validate a specific month explicitly
```

Currently: `✓ labour`, `✓ conservative`, `✓ reform`, `✓ libdem`, `✓ green` — all 6
policies each, schema OK.

## The pipeline script (`scripts/fetch-policies.mjs`)

Calls the Anthropic Messages API once per party with the `web_search` tool enabled,
asks for that party's current top 6 policies as strict JSON, and validates the
result before it's allowed to touch disk.

```bash
# Real run (needs your own key — see "Testing before you schedule it" below)
ANTHROPIC_API_KEY=sk-ant-... node scripts/fetch-policies.mjs

# Single party, useful while iterating on the prompt
ANTHROPIC_API_KEY=sk-ant-... node scripts/fetch-policies.mjs --party green

# See what would be written without touching disk
ANTHROPIC_API_KEY=sk-ant-... node scripts/fetch-policies.mjs --dry-run

# No network / no key at all — runs against canned fixtures in
# scripts/lib/mock-response.mjs to exercise parsing + validation + fallback logic
node scripts/fetch-policies.mjs --mock --month 2026-09
```

Env vars: `ANTHROPIC_API_KEY` (required unless `--mock`), `ANTHROPIC_MODEL`
(default `claude-sonnet-4-5-20250929`), `WEB_SEARCH_TOOL_TYPE` (default
`web_search_20250305` — bump this if you want to opt into a newer web-search tool
version later), `WEB_SEARCH_MAX_USES` (default `5`).

**No-manual-review guarantee:** if a party's API call, JSON parse, or schema
validation fails for any reason, that party's *previous* month's file is copied
forward unchanged instead of writing anything broken or blank. The only case that
exits non-zero (and should alert a human) is a party that has **never** had a valid
file at all — everything else is a silent, safe fallback. This was verified with
`--mock`: a deliberately malformed fixture (5 policies instead of 6) triggers the
fallback path and the carried-forward file is byte-identical to the prior month's;
a from-scratch run with no prior data at all for a party exits with code 1.

### Testing before you schedule it

Per the build plan, this script should be run manually with a real key at least
once before the GitHub Actions cron is turned on. To do that:

1. Get an API key from your Anthropic Console account.
2. Run `ANTHROPIC_API_KEY=... node scripts/fetch-policies.mjs --party labour --dry-run`
   for one party first and read the output — check the `sourceUrl`s are real and the
   `statement`s are neutral (no campaign-slogan tone).
3. Once happy, drop `--dry-run` and `--party` to run all 5 and check
   `npm run validate:data` passes on the resulting month.
4. Only then add `ANTHROPIC_API_KEY` as a GitHub Actions repo secret and wire up the
   cron workflow (phase 5).

I don't have an Anthropic API key in this environment, so I validated the script's
logic (fence-stripping, JSON extraction, schema validation, and both fallback paths)
against the mock fixtures above rather than a live call — that's the piece you'll
need to smoke-test yourself with your own key before scheduling it.

## Scoring logic (`src/lib/scoring.ts`)

Pure functions, no I/O — takes the 5 loaded `PartyData` objects and a client-side
`Answers` map (`{ statementId: 1-5 }`) and produces everything the results view
needs. No backend involved; all computable from the embedded JSON, per spec.

- `buildQuizPool(partyDataList)` — flattens 5×6 into the 30-statement pool and
  splits it into the public `quizStatements` (id + statement only) and the private
  `answerKey` (id → partyId, party, title, sourceUrl). Throws `PoolValidationError`
  if a party is missing, has the wrong policy count, or ids collide — this is the
  enforcement point for "exactly 6 policies per party" at runtime, not just at data
  pipeline time.
- `shuffle(items, rng?)` — Fisher-Yates, takes an injectable RNG so tests are
  deterministic (`seededRng(seed)` is a small mulberry32 PRNG for that purpose).
  Production code just calls `shuffle(quizStatements)` and gets `Math.random`.
- `scoreParties(answers, answerKey)` — per party, averages only the statements the
  user actually answered (not the full 6), so answering 2 vs 6 of a party's
  statements is still comparable. A party with zero answers gets `averageScore:
  null`, not 0 — "no opinion given" and "scored 0/5" are different things.
- `rankParties(scores)` — sorts best-first; parties with `null` (unanswered) sort
  to the bottom, since no data isn't the same as "worst".
- `getDrivingStatements(partyId, answers, answerKey, "best"|"worst")` — the 2-3
  statements from that party the user most agreed with (best) or disagreed with
  (worst). Prefers statements that actually crossed the agree/disagree line
  (score ≥4 or ≤2); if too few did (e.g. all neutral answers), falls back to the
  most extreme answers available rather than returning nothing.
- `buildResults(answers, answerKey)` — the full reveal object: `rankings` (all 5,
  ranked), `best`/`secondBest`/`worst` each with their driving statements
  (`partyId` and `sourceUrl` are reintroduced here — this is the one place in the
  codebase that's allowed to combine an answer with a party identity). `worst` is
  `null` if fewer than 2 parties have any answered statements (nothing to
  contrast against). `lowConfidence: true` flags results built from too few
  answers (<10 of 30) so the UI can show a caveat instead of a falsely-precise
  ranking.

### Tests

```bash
npm test    # node --test src/lib/*.test.ts — 21 tests, all against the real
            # data/2026-08 sample files (no fixtures/mocks needed here, since
            # scoring logic doesn't touch the network)
```

Covers: pool validation (missing party, wrong count, duplicate ids, no
party-identifying fields leak into `quizStatements`), shuffle correctness +
determinism + non-mutation, per-party averaging (including the null-vs-zero
distinction), ranking order, driving-statement selection in both directions
including the neutral-answers fallback and the 3-statement cap, and 5 end-to-end
`buildResults` scenarios (clear best/worst, low-confidence flag, single-party-only
edge case, and a fully empty answer set — none of which throw).

Uses Node's built-in `node:test` runner and native TypeScript support (Node 22.6+
strips types with no build step), so there's no test framework or transpiler
dependency yet — worth reconsidering once the Astro build is wired up in phase 4,
since Vitest may end up needed there anyway.

## Frontend (Astro)

```bash
npm install
npm run dev       # http://localhost:4321 — live quiz against data/2026-08
npm run build     # -> dist/ (index.html, one hashed JS bundle, answer-key.json)
npm run preview   # serve the built dist/ locally
```

No React/Vue/etc — the quiz is a single vanilla-TS controller (`quizApp.ts`) doing
plain DOM manipulation, per the "lightweight static site generator" brief. Flow:

- **Intro screen** → **one statement per screen** (mobile-first; a progress bar,
  5 scale buttons, Back to revisit a previous answer, Skip to leave one unanswered)
  → **results screen**.
- Answers are held in an in-memory object (`{ [statementId]: 1-5 }`) inside
  `quizApp.ts`'s closure — never written to `localStorage`/`sessionStorage`/cookies,
  never sent anywhere, gone on page reload. Matches "store answers client-side...
  no backend needed."
- The 30-statement order is shuffled twice: once at build time (deterministic per
  month, breaks up on-disk file-read ordering) and once again in the browser on
  page load (`shuffle(initialStatements)`, real `Math.random()`) — so every visitor
  gets their own order, not one fixed order baked into the HTML.
- Results screen shows best/second-best/worst matches (party name, average
  agreement score, 2-3 driving statements with source links) plus the full 5-party
  ranking table, and a `lowConfidence` caveat banner if fewer than 10 of 30
  statements were answered (straight from `scoring.ts`'s `buildResults()`).

### Tests

```bash
npm test        # 21 unit tests against scoring.ts (fast, offline, no browser)
npm run test:e2e  # scripts/e2e-smoke.mjs — builds the real site, serves it,
                   # drives it with headless Chromium through all 30 questions,
                   # asserts on privacy timing AND on correct scoring end-to-end
```

`test:e2e` answers every Green statement "strongly agree", every Reform statement
"strongly disagree", skips 2 Labour statements, and neutrals the rest — then
asserts the results screen shows Green as best (with genuinely-Green driving
statements), Reform as worst (with genuinely-Reform driving statements), "28 of 30
answered", and zero uncaught page errors. This caught a real bug during development
(see "Gotcha" note above about `type="module"` opting a script out of Astro's
bundling — without this, `quizApp.ts` would have shipped as an unresolvable raw
import and the quiz would have silently done nothing in a real browser, which the
Node-side unit tests had no way to catch).

Playwright needs a Chromium binary; this environment has one preinstalled at
`/opt/pw-browsers/chromium` (set via `PLAYWRIGHT_CHROMIUM_PATH` if yours lives
elsewhere, or run `npx playwright install chromium` first).

## Hosting: Cloudflare Workers (static assets), not Pages

Re-architected from the original Pages plan mid-build (see the note at the top).
The site is still a plain static build — Astro's `output: "static"`, `dist/` is
still just `index.html` + one JS bundle + `answer-key.json` — only *where* it's
deployed changed. Concretely:

- **`wrangler.jsonc`** (repo root) is a minimal assets-only Worker config: no
  `main` entry point, no Worker script at all, just `assets.directory: "./dist"`.
  There's nothing dynamic to run — Cloudflare serves `dist/` straight from the
  edge, same as Pages did. Validated locally with `npx wrangler deploy --dry-run`
  (no Cloudflare account needed for that check — it just confirms the config
  parses and finds the right files).
- **`.github/workflows/deploy.yml`** replaces Pages' own dashboard-driven
  auto-deploy: on every push to `main` (including the monthly data-pipeline bot's
  commits) it validates data, runs the unit tests, builds, and deploys via
  [`cloudflare/wrangler-action`](https://github.com/cloudflare/wrangler-action) —
  all in our own GitHub Actions, not a separate Cloudflare-side build system. This
  is arguably *more* future-proof than the Pages plan was: it's not coupled to
  whichever Cloudflare product currently wraps "connect a Git repo," it's just
  `npm run build` + `wrangler deploy`, portable to any host that speaks Wrangler
  or, worst case, any static host at all if Cloudflare itself ever needed
  replacing.
- **`.github/workflows/ci.yml`** now only runs on pull requests (deploy.yml
  already runs the same validate/test/build sequence on every push to main, so
  there's no need to duplicate it there).

### The one real trade-off: custom domains need Cloudflare-managed DNS

Cloudflare's own docs are explicit about this: **"Unlike Pages, Workers does not
support any domain whose nameservers are not managed by Cloudflare."** Pages could
front a domain hosted anywhere via a plain CNAME; Workers custom domains require
`ryetown.uk`'s nameservers to actually be set to Cloudflare's. If they already are,
this is a non-issue and adding the custom domain is close to instant. If
`ryetown.uk` is on a different registrar/DNS provider, you'll need to either move
its nameservers to Cloudflare (free, but is a real change to how the whole domain
resolves, not just this subdomain) or keep this on Cloudflare's `*.workers.dev`
subdomain instead of `politics.ryetown.uk`. Worth checking before step 2 below —
I don't know which situation `ryetown.uk` is in.

## Going live

What's left needs your own GitHub and Cloudflare accounts, which I can't act on
from here — no GitHub write access, and the Cloudflare connector available to me
exposes Workers/D1/KV/R2 (list/read-ish tools) but nothing that creates a Worker,
deploys one, or binds a custom domain. Two steps on your end, everything else —
including the deploy workflow itself — is already written.

### 1. Push this to GitHub (a few minutes)

```bash
cd politics-quiz
git init
git add .
git commit -m "Initial commit: quiz app, data pipeline, scoring, frontend"
gh repo create politics-quiz --public --source=. --push
# or, without gh CLI: create an empty repo on github.com, then
#   git remote add origin git@github.com:<you>/politics-quiz.git
#   git push -u origin main
```

Then add three repo secrets — **Settings → Secrets and variables → Actions → New
repository secret**:

- `ANTHROPIC_API_KEY` — for the monthly data pipeline (`update-policies.yml`).
- `CLOUDFLARE_API_TOKEN` — for deploys (`deploy.yml`). Create one at
  **dash.cloudflare.com → My Profile → API Tokens → Create Token** using the
  "Edit Cloudflare Workers" template.
- `CLOUDFLARE_ACCOUNT_ID` — found on any Workers page in the dashboard, right-hand
  sidebar ("Account ID").

`update-policies.yml` starts running on the 1st of every month at 06:00 UTC (or
trigger it manually from the Actions tab — "Run workflow"). Per the build plan,
do one manual dry run first (see "Testing before you schedule it" above) before
trusting the schedule. The moment `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`
are in place, `deploy.yml` fires on this very push and the site goes live on a
`*.workers.dev` URL — no dashboard steps needed for that part at all.

### 2. Add the custom domain (a couple of minutes, if `ryetown.uk` is Cloudflare-managed)

1. **dash.cloudflare.com → Workers & Pages → politics-quiz** (the Worker
   `deploy.yml` just created) **→ Settings → Domains & Routes → Add → Custom
   domain** → enter `politics.ryetown.uk`.
2. If `ryetown.uk`'s nameservers are already Cloudflare's, this activates almost
   immediately. If not, see the trade-off note above first.

### Verifying it worked

- Actions tab should show green runs for `deploy` (on this push) and, once you
  trigger or wait for it, `Update party policies`.
- The `deploy` job's log will print the `*.workers.dev` URL it deployed to even
  before the custom domain is attached — good for a first smoke check.
- Visit the live URL, open dev tools → Network tab, and confirm `answer-key.json`
  doesn't appear until you finish the last question — exactly what
  `npm run test:e2e` already checked locally against the build.

## Build order (per project plan)

1. ✅ Finalize JSON schema, hand-write sample files for all 5 parties, validate.
2. ✅ Write `scripts/fetch-policies.mjs` and test it (mocked) — real-key smoke test
   is on you, see above.
3. ✅ Scoring logic (`src/lib/scoring.ts`) written and tested (21/21 passing)
   against the `data/2026-08` sample data.
4. ✅ Astro frontend (quiz + results) built against the same sample data, verified
   with both unit tests and a real headless-browser end-to-end run.
5. ✅ GitHub Actions written (monthly data pipeline + CI + Cloudflare Workers
   deploy) and `wrangler.jsonc` validated locally. Pushing the repo and adding
   the Cloudflare secrets are the two steps only you can do — see "Going live"
   above.

## Notes on source reliability (carried over from project research)

- Green Party: `policy.greenparty.org.uk` is the real policy source (not the
  `greenparty.org.uk/feed/` news RSS).
- Reform UK: `reformparty.uk/policies` is clean and scrape-friendly, but the
  fetch-policies pipeline will still use the `web_search`-enabled API call for
  consistency across all 5 parties.
- Labour: official press page is stale — use Plan for Change / mission pages or
  live web search, not a fixed scrape target.
- Conservative & Lib Dem: no confirmed stable feed — rely on the live web-search
  API call per party.
