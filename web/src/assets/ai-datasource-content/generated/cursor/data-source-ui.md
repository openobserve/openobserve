---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: Cursor
  logo: logo.png
  logo_dark: dark-logo.png
  tagline: "Trace Cursor Agent activity: tool calls, file ops, prompt context."
  runtime: CLI agent
  setup_time: ~2 min
  tone: "#6b7280"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` MUST match the
# stream the install command writes to. With `stream_input` (below) the card's
# input drives this and the command's {stream} placeholder together.
detect:
  stream_type: traces
  stream: default
  # reliable by construction: install.sh writes OTEL_SERVICE_NAME=cursor into the
  # hook config, and OpenObserve maps OTEL service name → service_name (confirmed
  # via codex/claude-code real ingest).
  filter: "service_name = 'cursor'"

doc_url: https://openobserve.ai/docs/
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
    description: "One command bootstraps the OTel hook and writes the OpenObserve config to `~/.cursor/hooks/otel_config.json`. **Restart Cursor** afterward. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    note: "Already have the hook installed? Add `--skip-bootstrap` to the command."
    code:
      lang: bash
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/agents/cursor/install.sh | bash -s -- \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Use Cursor
    description: "Run any prompt in the Cursor IDE as you normally would — the OTel hook ships a trace per request automatically. **Requires the Cursor desktop app.**"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true

  - title: Check OpenObserve
    description: "Open **Traces** and filter `service_name = cursor`. You'll see a span per Cursor request."
    chip: { kind: traces, label: Traces }
    complete_on: detect

fix_title: "Restart Cursor (Desktop App Required)"
fix_body: "The OTel hook loads when the Cursor desktop app starts, and tracing only works in the desktop app. Confirm the hook config, then fully quit and reopen Cursor:"
fix_lang: bash
fix_snippet: |
  # confirm the hook config exists
  cat ~/.cursor/hooks/otel_config.json

  # fully quit Cursor, reopen it, run a prompt, then Test again
troubleshooting:
  - q: "No spans after running prompts"
    a: "Fully quit and reopen the Cursor desktop app — the hook is registered at startup. Tracing requires the desktop app, not the CLI."
  - q: "The hook is already installed"
    a: "Re-run with `--skip-bootstrap` to skip the upstream hook setup."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# Cursor

Trace Cursor Agent activity: tool calls, file ops, prompt context. The OpenObserve
Data Sources panel renders the stepped setup card from the frontmatter above.
