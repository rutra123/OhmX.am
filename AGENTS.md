# OhmX.am Agent Guidance

This is the canonical agent instruction file for this repository. Keep project-specific completion reporting policy here; do not duplicate it in handoff/state files.

## Completion Status and Next Actions Policy

After every task, the final report must:

1. State exactly one status: `PASS`, `PARTIAL`, or `FAIL`.
2. Separate what is complete, what is incomplete, checks performed, checks not performed, and blockers/risks.
3. Propose only the 1–3 most important concrete next actions, ordered by priority and tied to the current project state.
4. For `PASS`, identify one recommended next action and briefly explain why it has the highest priority.
5. For `PARTIAL` or `FAIL`, explicitly say the work is not complete and list:
   - exact remaining steps;
   - affected files;
   - required commands/checks;
   - the criterion that will allow the task to become `PASS`.
6. Never report `PASS` when any of the following is true:
   - staging was not verified;
   - the live runtime was not verified;
   - an application error remains open;
   - mandatory scope verification was not completed;
   - temporary processes remain active;
   - the live runtime does not byte-match the verified candidate.
7. Do not start the proposed next task without explicit user approval.

## Delegation and Review Policy

Use independent review for substantial cross-layer, security-sensitive, architectural, or multi-module work. Keep the primary agent responsible for reconciling findings and deciding actions; delegated findings are evidence, not authorization. Avoid delegating trivial mechanical work.

