# AI Usage

AI was used as an engineering collaborator, not as an unreviewed code generator.
I used several tools rather than one, settling on each for the kind of work it
was best at: framing the problem, seeing it, building it, and attacking it. The
split was not a rigid pipeline — planning in particular happened continuously
rather than once up front — but keeping the tools separate did mean the code was
reviewed by a model that had not written it.

## The toolchain, and what each was for

| Tool | Used for | What survives in the repo |
| --- | --- | --- |
| **Kiro IDE** | Spec-driven development: turning an open-ended brief into durable requirements, a technical design, and a task breakdown | [`.kiro/specs/realtime-ops-dashboard/`](.kiro/specs/realtime-ops-dashboard/) — requirements, design, tasks |
| **CodeSwim IDE** | Thinking through the pipeline visually with Mermaid diagrams — producer/consumer flow, failure paths, what happens on replay and restart | [`overview.md`](overview.md) — a Mermaid architecture diagram whose nodes link into the source, plus an annotated index of every file |
| **Claude Code** | Most of the planning-as-you-go and the bulk of the implementation: the dashboard UX pass, authentication, the test suites, filter behaviour, and the loading/transition work | Most of `apps/dashboard` and `services/api` |
| **Codex** | Adversarial review of code it had not written — a second opinion whose job was to find what the builder missed | The six issues in ["Robustness fixes from an external audit"](README.md#robustness-fixes-from-an-external-audit) |

## How that division actually paid off

**Two kinds of planning, and they are not interchangeable.** The brief is
deliberately underspecified, so the first real task was deciding what to build.
Kiro was the right tool for that: writing requirements and a technical design as
documents forced the assumptions into the open, where they could be argued with
instead of staying implicit in the code. Those documents are the reason there is
something to check the implementation against.

They were not, however, the whole plan. Most of the day-to-day planning happened
in Claude Code, next to the code — deciding how to split filter state, how far
to take authentication, what the loading behaviour should do when a scope
changes. That kind of decision only becomes visible once something is running,
and trying to settle it in a spec beforehand would have been guesswork.

The honest version is that the Kiro specs framed the problem and set the
acceptance criteria, and the detailed design emerged iteratively while building.
Where the two disagreed, the specs were updated rather than quietly abandoned —
they are checked in at their current state, not as a historical artifact.

**Diagrams to find the failure cases.** Drawing the pipeline in CodeSwim was
what surfaced the questions that mattered: what happens between the insert and
the offset commit, what a restart replays, where backpressure could reach the
authorization path. Those are much easier to see on a diagram than in prose,
and they set the agenda for what to test later. The diagram did not stay a
sketch — [`overview.md`](overview.md) is checked in as a navigable map of the
system, where each node in the flowchart links to the file that implements it.
It is the fastest way into this repository for someone seeing it for the first
time.

**A reviewer that did not write the code.** This is the part I would repeat.
Asking the model that built something to review it tends to produce agreement.
Running Codex over the finished prototype produced six concrete defects instead
— including Kafka replay duplicating rows (199 duplicate groups in the live
database), unbounded in-flight produce calls, SSE query amplification, and a
single malformed message being able to halt ingestion indefinitely. All six are
documented and fixed rather than argued with.

## Human judgment and verification

I made the scope and architecture decisions, reviewed each change, and treated
the running system and compiler output as the source of truth rather than the
model's confidence. AI suggestions were challenged with failure cases rather
than accepted because they looked plausible.

Verification was deliberately empirical, not assumed:

- Tenant scoping was tested by attempting the escalation — a tenant token
  sending `role=global` and another tenant's id still returns only its own rows.
- The two tenant-scoping tests were checked by deliberately reintroducing each
  bug and confirming the suite goes red, rather than trusting a green run.
- Crash-and-replay was tested by actually killing the consumer mid-write five
  times and diffing row counts.
- Dependency failure was tested by stopping Postgres under a live API instance,
  which is how an unhandled `pg.Pool` error event — a process-killer that no
  amount of reading would have surfaced — was found.

Where I could not verify something, it is stated as a limitation rather than
presented as done. The remaining prototype/production gaps are listed explicitly
in the README's "Known simplifications" and in the Kiro design.

## Data handling

AI had no access to Nymbus production systems or customer data. All traffic,
tenants and credentials in this repository are synthetic, generated locally by
`services/generator`. No transaction data was sent to any external service — a
constraint the design itself also has to satisfy, since the brief rules out
third-party SaaS for the real-time view.
