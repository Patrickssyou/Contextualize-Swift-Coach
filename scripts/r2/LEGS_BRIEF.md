# Brief: audit the same agent's follow-up calls, then regrade the case on v5

Read `BRIEF.md` first (rules, file shapes, scorecard). This brief adds one thing: after the audited call, the **same agent** made or took more calls on the same case (callbacks to the store, the customer or the driver). Patrick wants those in the audit and in the grade. Only these legs: they are all the same agent's own calls with real talk. Calls by anyone else (the order taker before, another SA) are not part of it and you must not add them.

## Inputs per case (`<id8>` = the audited call)

- The audited call as before: `raw/<id8>.json`, `q/ld-<full id>.json`, and your existing audit `audits/<id8>.json` (its `grade` is the v5 grade of the audited call alone).
- `legs.json`: `{<full main call id>: [{id, dir, sec, at, who}]}`: the follow-up legs, in time order (`at` is when the leg started).
- Each leg's extract: `rawlegs/<leg id8>.json` (same shape as raw/: captions, voice, screen timeline; times are seconds from that leg's own audio start).
- Scorecard text: `rubric_call_v4.json` (holds the v5 text). Lessons: `call_lessons.json` (v5 text wins on conflict, as before).

## What to write

Rewrite `audits/<id8>.json` keeping every existing field, and:

1. Move the current `grade` to `gradeSolo` unchanged (that is the v5 grade of the audited call alone; `gradeV4` stays too).
2. Add `legs`: one entry per leg, in time order:
   `{"id":"<full leg id>","alias":"…","agentLines":[…],"otherLines":[…],"flags":{…},"summary":"1-2 sentences","findings":[{"t":<sec in the leg>,"src":"voice"|"screen","text":"…","crit":"<row label or empty>","tone":"good"|"bad"|"note"}]}`, 2-5 findings each. Same speaker rules as BRIEF.md (mono: decide who spoke from the content; the agent is the same person as on the audited call).
3. A new `grade` for the **whole case as this agent handled it** (audited call + their follow-ups), on the v5 text: `{"scores":{…all 10 rows…},"reasons":{…every row, cite times as "m:ss" for the audited call and "Leg 2 m:ss" for a leg…},"rubric":"v5","withLegs":true}`.
   - Opening spiel and First response: the audited call's opening only (it's the opening for the line).
   - Ownership, Documentation, Long-term, Immediate resolution: the follow-ups count. A promised callback that happened is evidence; one that went to voicemail or never happened isn't.
   - Grade what the evidence shows. Don't move a row just because there is more material.
4. Update `audit.summary` / `audit.crit` notes only where the follow-ups change them. Don't rewrite findings on the audited call unless the raw data shows one is wrong.

Write nowhere else, don't touch the database, don't publish. Reply with one line per case: `<id8> <agent> rows changed vs solo: <row a→b, …> | legs: <n>`, then any judgment calls worth a grader's look.
