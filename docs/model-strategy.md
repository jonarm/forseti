# Model and advisor strategy

Planning is Opus work; execution is Sonnet work. Three mechanisms implement
that, and they are not interchangeable. CLAUDE.md carries only the rule that
follows from this — *consult the advisor before acting* on the five cases listed
below; the reasoning lives here, which is where a reason belongs.

Planning is Opus work; execution is Sonnet work. Three mechanisms implement that
and they are not interchangeable.

**Session model.** `claude --model opusplan`, or `/model opusplan` in-session:
Opus during plan mode, Sonnet for execution. Switching does not clear the
conversation, so Sonnet sees everything Opus planned. This is a human action —
nothing in this file can change the running model.

**Advisor.** `advisorModel` is `opus` in `.claude/settings.json`, so a session can
consult a stronger model mid-task without switching. An Opus 4.7+ main model
accepts only an Opus 4.7+ advisor, so the cost-saving pairing is **Sonnet main +
Opus advisor**; on an Opus session the advisor is a second opinion, not a saving.
Experimental, and Anthropic API only.

**Consult the advisor before acting** when the task:

- moves the tenant boundary — `session.ts`, an `ai-store.ts` signature, join-table scoping;
- touches authorization, the prompt-injection defence, or upload hardening;
- alters an already-applied migration or `_journal.json`;
- changes how readiness, coverage or a risk rating is derived;
- has failed the same build or test step twice.

The last one matters most: two failures on the same step means the model of the
problem is wrong, and a third attempt at the same fix is waste.

**Sub-agent routing.** A sub-agent's model comes from `model:` in
`.claude/agents/<name>.md` frontmatter or the per-invocation `model` parameter —
there is no `--model` flag on a spawn, that sets the session. Resolution order is
`CLAUDE_CODE_SUBAGENT_MODEL`, then the parameter, then frontmatter.

- `model: opus` — threat modelling, multi-file refactor design, migration risk,
  anything crossing the tenant boundary.
- `model: sonnet` — search, test authoring, established-pattern edits, CLI runs.

Sub-agents inherit the configured advisor and re-check the pairing against their
own model, so a Sonnet sub-agent can use the Opus advisor an Opus parent cannot.
A sub-agent does not inherit this context — name the doc or skill it needs in the
spawn prompt.
