# The chat brain (WIRA chats) — v1

How Swift Coach audits a Super Agent's WIRA chat: build the context first (Contextualize), then judge and coach (Swift Coach). Calls are parked; this is the build in focus.

Every audit follows one route, in this order, and never skips ahead:

1. **Establish the case facts.**
2. **Analyze the facts:** who is at fault (Tarro, Restaurant, Customer, Shared, Unclear).
3. **Recommend the right solution, then judge the quality of the solution the SA gave.**
4. **Grade the replies and coach the SA.**

## 0. The base: which chats

Same base as the Lightdash chart "Pizza WIRA chats by week — initiators and first response times" (`wira_project_tasks`):

- `restaurants_cuisine_type = pizza`
- `project_name = conversation` (Task Category "conversation")
- **client-initiated** (`conversation_direction = inbound`, the client sent the first message) **or AE-created** (`created_by_title = Account Executive`)
- assigned to a Super Agent on the roster (`assigned_user`)
- grouped by Monday-start Eastern creation week

Volume, week of Oct 5: about 86 chats for the 6 SAs (70 client-initiated, 16 AE-created). The queue lists all of them. Claude pre-grades on demand: 5 per SA by default, or all.

## 1. Turn the chat into a transcript with owners

WIRA stores a chat as one string of comments (`task_comments`, split on ` ## `) and a parallel author list (`task_commentors`).

| Author | Role |
|---|---|
| `client-+1…` | **Client** (the restaurant: owner or manager). Name from their own sign-off when given ("This is Sam") |
| the assigned SA's email (`agent_alias`) | **Support**: the SA being audited |
| another Super Agent on the roster | **Support (other)** |
| AE / CSM (staff directory) | **AE/CSM** |
| leads (staff directory: Howard, Patrick) | **Lead** |
| any other `@wondersco.com` | **Staff** |

Data limits:
- There are no per-message timestamps, only order. Known times: chat opened, first client message, first agent reply, closed.
- There is no internal-note flag. A staff message is an **internal note** when it @mentions staff or speaks to staff ("Client called and yelled at me…"). Every such label is marked *inferred*.

**AE/CSM in the chat ("depends why"):**
- **Bad for the SA:** the client went over the SA's head to the AE, *and* the SA could have prevented it; or the AE had to correct the SA.
- **Neutral:** the AE created the chat for the client, or added commercial context.

The brain labels which case it is and why.

## 2. Contextualize: link everything tied to the chat

The code pulls, then Claude reads:
- **Child tasks** (`parent_wid` = the chat), such as a Compensation Request to Howard.
- **The SA's other tasks** at the same restaurant from 2 h before to 24 h after.
- **The order the chat is about.**
  - Candidates are the restaurant's orders that day, with item subtotal, tax, tip and total.
  - They are matched on ticket numbers, dollar amounts (including amounts that are 30% of an order) and customer names or phones mentioned in the chat or tasks, plus order type and time.
  - A short Claude pass pulls these references out of the chat first.
  - The reviewer can override the match.
- **The order's recordings** (`call_id` and `list_call_ids`), plus other calls from the same customer phone that day, with transcripts.
- **Slack threads** about the restaurant around the chat.

The facts pass then checks **every factual claim the SA made** against this evidence: *supported*, *contradicted* or *can't check*. That is how we know whether the SA actually got to the recording.

## 3. The passes

| Pass | Reads | Writes |
|---|---|---|
| R. References | chat + tasks | tickets, amounts, names, phones, items, order type, times |
| F. Facts | chat transcript, internal notes, tasks, linked orders, call transcripts, Slack | timeline F1… (who said or did what, attributed, no conclusions); SA claims check C1…; promises P1… |
| A. Analysis | facts only + the compensation policy + calibration cases | fault (with citations); the policy row that applies; the ideal resolution; whether escalation was needed; what the SA offered; AE/CSM involvement |
| (code) | analysis + order money | the right compensation amount (base = item subtotal, no tax, no fees; % from the policy row; + delivery fee on self-delivery); the SA's amount; the difference; whether it needs approval (> $25) |
| G. Grade + coach | facts, analysis, the computed amounts, rubric, calibration cases | 0–3 per criterion with reasons, escalation level 0–4, verdict, and the coaching note |

Money is never computed by Claude. Claude picks the policy row and the affected order; the code does the arithmetic and shows the formula.

### Case types

The analysis names the case type first, from what the client asked for (not from linked data). Only **compensation** cases use the policy buckets and the money; for every other type the bucket, affected order and offer stay empty.

| Type | What it covers |
|---|---|
| compensation | an order problem that may be Tarro's mistake, or compensation asked for, offered or promised |
| order_issue | check or correct an order or call (recording request, complaint), no money at stake |
| customer_recovery | the restaurant decides a credit, refund or remake for its own customer; the SA carries it out |
| contact_customer | the restaurant asks Tarro to call or update a customer |
| menu_setup | menu items, prices, modifiers, promos |
| hours_service | hours, closures, call service or delivery on/off |
| device_printer | printers, tablets, POS app, receipts |
| billing_payment | charges, card fees, payouts, statements |
| order_admin | void, mark paid/unpaid, change type, dispatch or driver |
| how_to | how to use Tarro's tools |
| other | anything else |

Week of Oct 5: 85 base chats, of which about 6 (7%) were compensation cases. Order checks, menu setup and contacting customers make up most of the rest.

Fault can also be **none**: nothing went wrong (a plain request). Fault is about who caused the client's problem, not how sure we are and not the SA's own slips in the chat.

### Fair evidence

- Linked tasks, orders and recordings are matched automatically and may belong to another case. The brain uses only what matches this chat and never judges the SA on another case.
- The record is not everything the SA could see (GreenDot tickets, payments, settings, unlinked recordings). A claim we can't check costs the SA nothing; only a contradicted claim counts.
- Chat messages have no times. Calls are labelled as before or after the chat opened, and the SA is never faulted on an order of events the data can't show.

## 4. The chat scorecard (draft, weights sum to 100)

| # | Criterion | Weight | What 3 looks like | N/A when |
|---|---|---|---|---|
| 1 | First response | 10 | Acknowledges the issue, says what they're checking, asks only for what's needed. Does not defend, blame or conclude before checking the evidence. | the SA started the chat |
| 2a | Gathered the evidence | 15 | Checked what the case needed before acting: recording and order for an order problem; setup, settings or account for a request. Every claim holds up. | – |
| 2b | Restated the case correctly | 10 | Told the client what happened, or confirmed the request back, accurately and plainly. | – |
| 3 | Fault attribution | 15 | Correct fault, owned clearly when it's Tarro's, pushed back when it isn't. | nothing went wrong (a plain request) |
| 4a | Resolution path | 15 | The right path for the case type: the policy path for compensation; the right action, team or ticket for a request; the restaurant's decision carried out for a customer credit. | – |
| 4b | Resolution accuracy | 10 | The amount and terms are exactly right wherever the SA recorded them (right base, right %, fees handled; or exactly what the restaurant approved). Recorded nowhere: 0. | no compensation, credit, refund or fee was given, promised or due |
| 4c | Solution explained | 5 | The client understands what they get, why, and when. Explains the math when challenged. | nothing to explain beyond confirming it was done |
| 5 | Escalation (0–4) | 15 | Level 4 (see below). | no escalation was needed |
| 6 | Reply quality | 5 | Clear, warm, professional, owns mistakes, no over-promising. | – |

Marks: 3 right · 2 right with a small gap · 1 attempted but wrong in a way that matters · 0 not done, or the opposite of what was needed. Each flaw is scored once, in the one criterion it belongs to; a slip the SA corrected counts once, where it happened.

**Escalation ladder** (only when escalation was needed):
- **0:** needed and not done.
- **1:** tagged the lead.
- **2:** tagged *and* gave a summary anywhere the lead will read it (chat or ticket).
- **3:** summary *plus* a recommended solution, asking for the lead's opinion.
- **4:** the recommendation is correct, with the logic explained clearly and making sense.

**Verdict** (score shown underneath):

| Verdict | Score |
|---|---|
| Great | ≥ 90 |
| Good | 80–89 |
| Okay | 65–79 |
| Needs work | 50–64 |
| Miss | < 50 |

### The QA lead's standing decisions (Oct 14)

- **Two reads.** The grade pass runs twice (the second asked fresh) and the marks are averaged per criterion. A half mark means the two reads differed by one; N/A stands only when both reads say so. When the two reads are 15+ points apart the audit shows both.
- **Shared chat.** Grade only what the audited SA wrote or did. If another SA answered the client in the chat, credit the audited SA for a clean handoff and mark down only their own gaps.
- **Compensation amount.** It counts wherever the SA recorded it: in the chat, an internal note or a WIRA ticket. The SA doesn't have to tell the client the amount unless the client asks; if asked, the SA must give and explain it. Given or promised but recorded nowhere: Resolution accuracy 0.
- **An earlier agent's promise.** When the SA didn't keep a promise an earlier Tarro agent made, judge how the SA read the situation (noticed it; had a sound reason, such as the restaurant's decision, the policy or a lead's call) under Resolution path, and how the SA managed it with the client under Reply quality.

## 5. The coaching note (Swift Coach)

Inspector-Gadget style, one verdict per step of the route:
- **Facts:** ✓ or ✗, and why.
- **Analysis:** ✓ or ✗, and why.
- **Solution:** ✓, partly or ✗, and why.
- **Escalation:** the level reached, and what the next level looked like.

It ends with *What you did well* (2–3 items) and *What to do next time*. Each "do next time" item quotes what happened, explains why it matters, and gives a model reply the SA could have sent. For escalations, the model reply is a Level 4 message.

## 6. Learning

Each reviewed case can be saved as a **calibration case**: your verdict, your corrections per criterion, and your reasoning in your words. The analysis and grade passes read the most recent calibration cases as "how the QA lead grades". New lessons apply from the next audit, with no code change.

The **compensation policy** is stored in the app (not in code) and edited there, so rule changes apply immediately.

## 7. Storage

| Path | What |
|---|---|
| `chatWeeks/<week>/chats/<sid>` | the week's base chats (the chat itself, messages included), with the pick flag |
| `chatWeeks/<week>/audits/<sid>` | Claude's pre-grade: context, facts, analysis, money, grade, score |
| `chatWeeks/<week>/tx/<sid>` | the linked call transcripts |
| `chatWeeks/<week>/reviews/<sid>` | the QA lead's review: marks, score, verdict, coaching note |
| `chatCalib/<sid>` | calibration cases |
| `settings/chatPolicy`, `settings/staff` | the compensation policy; who's who beyond the SA roster |

Each week is its own set of collections, so the page reads one week at a time. Claude is never asked twice for the same pass: a reply that isn't valid JSON is repaired from its text, and if that fails the chat is marked and the reviewer can re-grade. Re-grade asks Claude fresh (no cached answers).

## Calibration cases

Real calibration cases (names, restaurants, amounts) live in the app's database and in `data/chats/calibration.json` locally. They are never committed: this repository is public.
