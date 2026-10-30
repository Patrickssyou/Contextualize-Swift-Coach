# Learning: how Claude's progress is measured

Written Oct 30, 2026, when Round 1 was archived and Round 2 (Oct 23–30) started. These rules are Patrick's and are not up for reinterpretation by later sessions.

## Rounds

- **Round 1 (archived):** the settled items only. Settled means the team (Pat, Howard, Li Qi) locked an agreed score. That is 15 items, all from the first SA-candidate pool (14 calls, 1 chat). Everything that was never settled (the Oct 5–11 SA round, the Oct 12 calls, the rest of the candidate pool, Patrick's solo chat lesson and calibration case) is hidden, not deleted. The round docs carry `archived: "r1"`. The two solo brain items were moved to `archive/` in the db.
- **Round 2:** Oct 23–30, 2 chats + 4 calls per person. Current SAs (`calibRounds/2026-10-23`) and SA candidates (`calibRounds/2026-11-09`) stay separate. Calls are ranked CL, CL, DE, MGR, then by line priority CL > DE > MGR, with solo calls before team cases.

## Claude's grade history (`gradeHistory/<itemKey>`)

1. **Version 1 is Claude's grade before the team settled.** It is written when the item is locked, from the grade Claude gave at the time. For Round 1 it was seeded from `callGrades` and the chat audit, all of which predate their locks.
2. **Versions are only ever added.** No session, script or page code may edit or delete an earlier version, and no one may "fix" a score after the fact. If a version is wrong, add a note in a new version; never rewrite history.
3. **A regrade is blind.** The grader gets the call or chat and the newest brain (rubric, policy, lessons), with every lesson and calibration case that came from that same item left out. It never sees the team's marks, notes or agreed score for that item. Nothing in the prompt may hint at the answer.
4. **No anchoring to the team either way.** Claude grades what the evidence shows. It must not drift toward the team's scores because it knows they exist, and it must not hold its old marks out of consistency. Agreement has to come from lessons learned on other items.
5. **Report it straight.** The Learning tab shows, per version: items, average gap to the agreed score, whether Claude runs high or low, rows that match exactly, rows within one mark, and verdict matches. The newest regrade is compared with the original on the same items and labelled Closer, Further or No real change (a 1-point band). A regression is shown as a regression.

## Where it starts (Round 1, original grades)

15 items, average gap 21.3 pts, Claude 20.6 pts below the team on average, 28% of rows exact, 68% within one mark, verdict matched on 5 of 15. Claude graded much harder than the team.

## Regrade 1 (Oct 30, in the desk, transcript brain, blind)

Same 15 items: average gap **23.5 pts** (original 21.3), Claude 21.5 pts below the team, 25% of rows exact (was 28%), 64% within one mark (was 68%), verdicts 4 of 15 (was 5). **Further.** The in-page call grader did not move toward the team even with the 32 Round 1 lessons in its prompt; it still marks low by habit.

Round 2's screen + voice grades were written with the same lessons by a different grader (this session), and they run much higher (most calls 70–90). Whether that is closer to the team is unknown until Round 2 settles; it will show as Round 2's "Original" in Learning.

## Scorecard text v5 (Oct 30)

Patrick replaced the level descriptions with v5. Rows, weights, the 0–4 raw scale and N/A rules did not change. Round 2 only was regraded on v5; Round 1 history stays as it was.

- Each Round 2 screen + voice audit keeps its earlier grade as `gradeV4` next to the new `grade` (`text: "v5"`). Nothing was overwritten.
- Where a Round 1 lesson and the v5 text disagree, the v5 text wins (e.g. a manager-line opening without the agent's name is now raw 3, not 4).
- Round 2 calls moved from an average of 77.7 to 73.9 under v5 (48 calls). The main drivers: openings missing the name, Gathering 5 now needs a check of what else is affected, Composure 5 needs the other side settled, and order remarks count as the right record on MGR/DE calls.
