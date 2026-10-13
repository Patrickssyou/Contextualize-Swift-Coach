# Contextualize + Swift Coach

The Pizza Support QA Desk, a weekly audit tool for Tarro's Pizza Super Agents, and the base for Swift Coaching.

- **Calls and cases.** Each week the tool samples calls per agent from Lightdash, links the related calls, WIRA tasks and Slack threads, and sets voicemail aside. Work that involved several agents is graded once as a team case.
- **Facts, then conclusions.** Claude first writes down what was said and done, then draws conclusions from those facts only, citing them. The reviewer compares Claude's answers with their own.
- **Exports.** Audits export to Excel and Google Drive for the Disaster Class dashboard.

The app ships as a single HTML page published as a claude.ai artifact. It uses the viewer's Lightdash, Slack and Google Drive connectors, and stores its data in the artifact's own database.

## Build and test

```sh
npm install
npm run build   # → dist/pizza-support-qa-desk.html
npm test        # build + Playwright tests against real fixtures in data/
```

The tests need the real fixtures in `data/`, which aren't committed.

## Layout

| Path | What it is |
|---|---|
| `src/template.html` | The page: markup, styles, UI logic |
| `src/core.js` | Shared logic: sampling, call linking, voicemail filter, cases, Claude prompts |
| `src/rubric_v1.json` | The original rubric, kept so old audits still score |
| `tests/` | Playwright suites and the mocked runtime |
| `eval/` | Scripts for checking the facts and conclusions passes |
| `design/` | Mockup rounds |
| `docs/handoff.md` | Product history, rubric, data model, export contract |
| `.claude/agents/` | The lanes: ui-builder, facts-eval, evidence, scribe |
