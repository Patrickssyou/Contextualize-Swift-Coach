# Contextualize + Swift Coach

The Pizza Support QA Desk: Patrick (Strategic Ops Lead, Tarro) audits Pizza Super Agent calls every week. It is the base for Swift Coaching (post-call coaching) and later Contextualize (live help). Read `docs/handoff.md` for the full product history, rubric and data model.

## What ships

One HTML page, published as a claude.ai artifact: https://claude.ai/artifact/W3z5JbqMoDt3PkA1ckjLuq

- Runtime capabilities (pass the full object on any publish that changes them):
  `{db:{}, user:{}, downloads:{}, sample:{}, mcp:{servers:[{server:"Google Drive",tools:["create_file","update_file"]},{server:"Lightdash",tools:["run_metric_query","get_query_result"]},{server:"Slack",tools:["slack_search_public","slack_read_thread"]}]}}`
- The page reads Lightdash (calls, transcripts, WIRA tasks) and Slack through the viewer's own connectors, stores audits and the weekly queue in the artifact db, and calls Claude through `sample` for the facts and conclusions passes.
- Only a session with the Artifact tool can publish. Lanes never publish; the main session does, after tests pass.

## Build and test

- `npm run build` → `dist/pizza-support-qa-desk.html` (injects `src/core.js` between the PULL-CORE markers and `src/rubric_v1.json` into `src/template.html`, then syntax-checks the script).
- `npm test` → build + Playwright suites in `tests/` against a mocked `window.claude` (`tests/mock.js`) and real fixtures in `data/`.
- Every change ends with `npm test` green. Screenshots go to `shots/`.

## Data rules

- `data/` holds real Tarro data: call transcripts, Slack threads, live db copies. It is git-ignored. Never commit it, never paste it into commits, docs or issues, never move it out of `data/`. This repository is public.
- Never write tokens or keys anywhere. The page uses the viewer's connectors; nothing here needs a key.
- Writes to the live artifact db (ArtifactData) are main-session only, always pinned with `if_version`.

## Product rules (from Patrick)

- Facts before conclusions. Pass 1 records only what was said and done, attributed to who said it. Pass 2 concludes from the facts only and cites fact ids. No "open questions" list.
- Calls vs cases: a call is handled by one SA; a case involves another SA, a pool seat or CRT and is graded once as a team. Voicemail and silent legs are set aside.
- UI copy: plain, short, no helper subtext under controls. Patrick wants direct feedback, not reassurance.

## Studio workflow (lanes)

One main session (Opus) owns the plan, integration, review and publishing. Background lanes take briefs and report back a summary. Lanes stay out of each other's way only because each owns different files:

| Lane | Agent | Owns | Never touches |
|---|---|---|---|
| Main | (main session) | `src/template.html` layout and integration, `CLAUDE.md`, releases | – |
| UI | `ui-builder` | `design/`, `src/ui/` (when split out), `tests/test_ui*.js` | `src/core.js` prompts, `eval/` |
| Facts quality | `facts-eval` | `eval/`, the prompt functions in `src/core.js` (`factsPrompt`, `analysisPrompt`, `cleanFacts`, `cleanAnalysis`, `caseEvidence`) | `src/template.html` |
| Evidence | `evidence` | linking and pull functions in `src/core.js` (`buildChain`, `linkTasks`, `legTalk`, `groupCases`, task and transcript configs), `tests/test_pull.js`, `tests/test_cases.js` | prompt functions, `src/template.html` |
| Helper | `scribe` | `shots/`, test runs, commits on request | source files |

- If a lane needs a change in a file it doesn't own, it stops and says so in its report.
- Lanes work in their own git worktree and branch; the main session reviews and merges.
- Background lanes can't ask questions: briefs must name the files, the acceptance check and what to report.
