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

## Suggested spec citations (VERIFIED — ticket #6, 2026-09-11; sources: rpiv-mono packages/rpiv-ask-user-question + pi extension docs)
- **S1 (normative, VERIFIED):** When `extra_ask_user_tool` contains `ask_user_question`, pi-notify SHALL treat each invocation of `ask_user_question` (package `@juicesharp/rpiv-ask-user-question`, constant `ASK_USER_QUESTION_TOOL_NAME` in `ask-user-question.ts`, registered via `registerAskUserQuestionTool`) as an ask-user signal and run `on_ask_user`. Matching SHALL be exact, case-sensitive, full-string equality against `event.toolName` of the `tool_call` / `tool_execution_start` payload (field name verified verbatim in pi docs).
- **S2 (normative, VERIFIED with correction):** The package emits `rpiv:ask-user:prompt` via the shared `pi.events` bus (`pi.events.emit(ASK_USER_PROMPT_EVENT, payload)` in `ask-user-question.ts`), so pi-notify CAN subscribe with `pi.events.on('rpiv:ask-user:prompt', ...)` (bus verified in pi docs; channel stability guaranteed by the package STABILITY POLICY in `events.ts`: names immutable, payloads append-only). CORRECTION: the prompt payload is `{ questions: [{question, header, multiSelect, options: [{label, description, hasPreview}]}] }` — it carries NO `toolCallId`, so dedup keyed by `toolCallId` against the package event alone is impossible. The spec SHALL pick one primary signal (`tool_call` exact-name match, which has `toolCallId`) and, if it also listens to the package event, dedup by arrival window — or listen to exactly one. A companion `rpiv:ask-user:blocked` event (`{ active: boolean }`, set true while awaiting input, cleared in `finally`) exists for blocked-on-human vs working distinction.
- **S3 (normative, VERIFIED + refined):** TTY full questionnaire (BEL via `process.stdout.write('\x07')` gated on `process.stdout.isTTY`, best-effort); RPC/ACP renders via the select/input dialog walker (`rpc-fallback.ts`) with NO side-by-side preview and one dialog per question. Non-interactive removal is active-tool-list filtering: `registerAskUserQuestionReconciler` strips the tool in `before_agent_start` when `!ctx.hasUI` (`pi.setActiveTools`); RPC hosts are NOT stripped. Backstop: a call without UI returns an error result (`error: 'no_ui'`) instead of prompting, and an RPC host without custom UI returns a chat-text-fallback error — both are call-time error edges the spec SHALL document as expected degradation, not notification triggers.
- **S4 (normative, VERIFIED):** Detection at call-start time (`tool_call`, which fires after `tool_execution_start` and before execution), never at result/settlement time; `tool_execution_end` MUST NOT trigger.
- **S5 (standing preferences, unchanged):** All three arrays default empty. Examples MAY show `notify_send`, `mpv`, `ntfy`, `extra_ask_user_tool: ["ask_user_question"]`. Coincident finish+ask fires both hooks.
- **S6 (informative, VERIFIED):** pi-notify SHALL NOT touch `~/.config/rpiv-ask-user-question/config.json` (XDG-resolved via `@juicesharp/rpiv-config`, `loadJsonConfigWithLegacyFallback`); its own config lives under `~/.pi` (exact filename decided by the config-schema grilling).
