# Campaign Log Agent Handoff

Use this contract whenever another agent may continue the run. Keep it platform-neutral so Codex, Claude, or another capable agent can resume without reconstructing history.

## Take over a run

1. Parse the latest `CAMP-LOG HANDOFF` record and retain the original objective, user constraints, and reporting window.
2. Re-fetch every mutable target named in the handoff before editing. Prefer stable page IDs and repository paths over temporary asset URLs.
3. Compare `completed`, `remaining`, and `verification`. Do not redo completed work unless the current source contradicts the record.
4. Search Notion using the idempotency key before creating anything. If more than one matching page exists, stop and ask which page is canonical.
5. Resume from `next_action`. If it is no longer valid, record why and choose the smallest safe alternative within the original scope.
6. Never inherit secrets, authenticated cookies, passwords, or tokens through a handoff. Require the receiving agent's own authorized connection.

## Produce a handoff

Emit this exact structure in an agent message or final response. Omit no field; use `none` or an empty list when appropriate.

```markdown
## CAMP-LOG HANDOFF

- **Status:** not_started | collecting | drafted | published | verified | blocked
- **Objective:** <original user outcome>
- **Idempotency key:** <daily|weekly> | <YYYY-MM-DD..YYYY-MM-DD> | cutoff <YYYY-MM-DD> | <CZSK|US|All>
- **Reporting window:** <exact dates, timezone, and whether complete days only>
- **User constraints:** <tone, format, requested context, and prohibited actions>
- **Sources checked:** <source + freshness + result for each>
- **Notion target:** <database ID/URL and page ID/URL, or none>
- **Artifacts:** <stable repository paths or final URLs; never expiring signed URLs>
- **Completed:**
  - <verified completed step>
- **Remaining:**
  - <required unfinished step>
- **Blockers:** <none or exact blocker and required authority/input>
- **Human actions/context:** <user-provided actions or plans; distinguish them from agent actions>
- **Agent actions:** <writes performed by agents; explicitly state that no campaign changes were made>
- **Verification:** <checks passed, failed, or not yet run>
- **Next action:** <one concrete first step for the receiving agent>
```

## State rules

- Use `published` only after Notion accepts the intended write.
- Use `verified` only after re-fetching the page and confirming the title, dates, visuals, currencies, market separation, executive-summary callout, blank changelogs, and absence of invented execution claims.
- Use `blocked` only when required access, authority, or user input prevents safe progress; name the precise blocker.
- Record recommendations separately from executed actions. Never convert a recommendation into a claimed campaign change.
- Keep the handoff out of the published Campaign Log page unless the user explicitly asks to store it there.
