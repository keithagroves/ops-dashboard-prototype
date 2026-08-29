# AI Usage

AI was used as an engineering collaborator, not as an unreviewed code generator.
The primary tool was OpenAI Codex in the repository workspace.

## Where AI helped

- Turned the open-ended exercise into Kiro-style requirements, a technical design,
  and an implementation task breakdown.
- Compared architecture options (direct database writes, Redis aggregates,
  Postgres, polling, WebSockets, and SSE) against the stated latency, residency,
  scale, and existing-infrastructure constraints.
- Accelerated implementation across the TypeScript workspaces and kept shared
  event/query contracts aligned between the generator, consumer, API, and UI.
- Performed adversarial review and helped design live checks: Kafka replay,
  malformed messages and filters, Redis/Postgres outages, concurrent SSE clients,
  stream pacing, tenant authorization, and dependency auditing.
- Improved the submission documentation by reconciling the running behavior with
  the requirements and recording deliberate prototype/production tradeoffs.

## Human judgment and verification

I made the scope and architecture decisions, reviewed each change, and used the
running system and compiler/build output as the source of truth. AI suggestions
were challenged with failure cases rather than accepted because they looked
plausible; that process found replay duplication, query amplification, stale
cross-scope UI state, silent filter coercion, and dependency error paths.

AI had no access to Nymbus production systems or customer data. All traffic and
credentials in this repository are synthetic, and no transaction data was sent to
an external service. The remaining limitations and production work are called out
explicitly in the README and Kiro design instead of being presented as complete.
