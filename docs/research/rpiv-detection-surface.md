# Research: rpiv ask-user detection surface

Source: resolution of ticket "rpiv ask-user detection surface" (map: pi-notify extension spec).
Method: conversation context + read-only repo inspection. No network, no pi source, no package source available at research time. pi-API and rpiv-package facts below come from conversation context and are flagged **UNVERIFIED** where they could not be confirmed. Must be verified by the "Verify pi event names against source" ticket before the spec locks.

## Facts

### F0. Repo state (verified by inspection)

Repo contains only `AGENTS.md`, `docs/agents/*.md`, `.gitignore`, `.git/`, `.pi/delegate/…`. No extension source, no manifest. Nothing confirms or contradicts the context facts.

### F1. Canonical third-party detection target

- Package: `@juicesharp/rpiv-ask-user-question`, v2.9.0, MIT; installed via `pi install npm:@juicesharp/rpiv-ask-user-question`; manifest `extensions: ["./index.ts"]`.
- Canonical tool name: **`ask_user_question`** (snake_case). Corroborated by the parent session's own tool-call ledger (`{"calls":2,"name":"ask_user_question"}`). Do NOT cite `ask-user-question` (dashes) as a tool name — that is the package short name in prose.
- Canonical package event: **`rpiv:ask-user:prompt`**.
- Tool shape: one tool; questionnaire up to 4 questions with typed options; appended `Type something.` row; per-option notes via `n`; BEL (`\x07`) on wait in interactive TTY.
- Package's own config (`~/.config/rpiv-ask-user-question/config.json`, keys `collapseKey`, `guidance.*`, malformed-JSON fallback) belongs to the third-party package — pi-notify SHALL NOT read or write it.
- Standing preferences: `on_ask_user` covers native `ctx.ui` prompts AND exact-name `tool_call` matches from `extra_ask_user_tool`; matching exact, case-sensitive, full-string; defaults empty; finish+ask coincidence fires both.

### F2. Host-dependent behavior (spec must account for)

- Interactive TTY: full questionnaire UI; BEL on wait; `n` notes.
- RPC/ACP hosts: degrades to host-native dialogs; do not assume terminal escapes / BEL.
- Non-interactive hosts: tool is **removed from the model's tool list** — no `tool_call` / `tool_execution_start` / `rpiv:ask-user:prompt` ever fires. pi-notify's rpiv path is silently inert there: expected degradation, document it, do not "fix" with polling.
- Consequence: detection is *opportunistic* (fire when observed), never *exhaustive*.

### F3. Exact-name matching

- Events to cite: `tool_call` and `tool_execution_start` (sibling context: `tool_call` per-call and blockable; `tool_execution_start/end` carry `toolCallId`/`toolName`/`args`/`result`).
- Strict equality against each `extra_ask_user_tool` entry; `ask_user_question` matches only `ask_user_question`.
- Timing: match at **call start** (`tool_call` / `tool_execution_start`), before the user answers. `tool_execution_end` is too late for an attention nudge and MUST NOT be the trigger.

## Open questions (for the verification task)

1. Exact payload field name for the tool name (`toolName` vs `name` vs `tool.name`).
2. `tool_call` (blockable middleware?) vs `tool_execution_start` (observer?) — subscribe to one or both; does both double-fire `on_ask_user`?
3. `rpiv:ask-user:prompt` payload/ordering: fires in all hosts exposing the tool (incl. RPC/ACP)? Fields? Does listening to it alone suffice?
4. Non-interactive removal: list-filtering vs call-time rejection (affects "call rejected" edge case).
5. rpiv `collapseKey` / `guidance.*` semantics — only for a "known limitations" spec note.

## Suggested spec citations (copy-ready; UNVERIFIED items must confirm before lock)

- **S1 (normative):** When `extra_ask_user_tool` contains `ask_user_question`, pi-notify SHALL treat each invocation of `ask_user_question` (package `@juicesharp/rpiv-ask-user-question`) as an ask-user signal and run `on_ask_user`. Matching SHALL be exact, case-sensitive, full-string equality against the tool-name field of the `tool_call` / `tool_execution_start` payload [UNVERIFIED: field name — presumed `toolName`].
- **S2 (normative, UNVERIFIED):** The spec SHOULD additionally cite `rpiv:ask-user:prompt` as an equivalent signal where the host delivers third-party package events. If both the package event and the name match fire for one prompt, pi-notify SHALL deduplicate to a single `on_ask_user` run per prompt (e.g. keyed by `toolCallId` [UNVERIFIED]).
- **S3 (normative):** TTY full questionnaire; RPC/ACP native dialogs; non-interactive removes the tool so no signal fires — document as expected degradation, not an error.
- **S4 (normative):** Detection at call-start time, never at result/settlement time; `tool_execution_end` MUST NOT trigger.
- **S5 (standing preferences):** All three arrays default empty. Examples MAY show `notify_send`, `mpv`, `ntfy`, `extra_ask_user_tool: ["ask_user_question"]`. Coincident finish+ask fires both hooks.
- **S6 (informative):** pi-notify SHALL NOT touch `~/.config/rpiv-ask-user-question/config.json`; its own config lives under `~/.pi` (exact filename per pi-events findings).
