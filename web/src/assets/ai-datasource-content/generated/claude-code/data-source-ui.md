---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: Claude Code
  tagline: Trace every Claude Code conversation turn, no code changes.
  runtime: CLI agent
  setup_time: ~2 min
  logo: logo.svg
  tone: "#d97757"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` is the fallback;
# with `stream_input` (below) the card's input drives both the install command's
# {stream} placeholder (--traces-stream) and the stream listened on, so the OTel
# config written into Claude Code's settings.json and detection stay in lockstep.
detect:
  stream_type: traces
  stream: default
  # confirmed on ingest: Claude Code sets service_name = 'claude-code'
  filter: "service_name = 'claude-code'"

doc_url: https://openobserve.ai/docs/integration/ai/claude-code-tracing/
slack_url: https://short.openobserve.ai/community

# Optional stream-name input rendered on the card. When present the card
# shows a text field (default below); the value flows BOTH into the install
# command's {stream} placeholder AND the live detection below, so the stream
# the installer writes to and the stream the card listens on stay in lockstep.
stream_input:
  label: Traces Stream Name
  default: default
  placeholder: default
  help: Leave as "default" or set a dedicated stream for these traces.

steps:
  - title: Run The Installer
    description: "One command registers a `Stop` hook and writes the OpenObserve OTel config into Claude Code's `settings.json`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/agents/claude-code/install.sh | bash -s -- \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}" \
          --scope=global

  - title: Use Claude Code
    description: "Just use Claude Code normally — start a session and run a turn in any project. The `Stop` hook ships a trace automatically each turn."
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true

  - title: Check OpenObserve
    description: "Open **Traces** and filter `service.name = claude-code`. You'll see a span tree per turn:"
    chip: { kind: traces, label: Traces }
    complete_on: detect
    pills:
      - service.name
      - tool calls
      - model usage


fix_title: "Re-run The Installer And Restart Claude Code"
fix_body: "Traces come from a Stop hook in settings.json. If turns aren't traced, confirm the hook is registered, then start a fresh session:"
fix_lang: bash
fix_snippet: |
  # confirm the Stop hook + OpenObserve env are present
  cat ~/.claude/settings.json | grep -A3 openobserve_hooks

  # if missing, re-run the installer (safe to re-run), then start a new session
troubleshooting:
  - q: "Turns run but no traces appear"
    a: "Start a fresh Claude Code session after installing — the Stop hook is read at session start."
  - q: "The hook isn't in settings.json"
    a: "Re-run the installer (idempotent). Use `--scope=project` to write to the project's `.claude/settings.local.json` instead."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# Claude Code

Trace every Claude Code conversation turn, no code changes. The OpenObserve Data
Sources panel renders the stepped setup card from the frontmatter above.
