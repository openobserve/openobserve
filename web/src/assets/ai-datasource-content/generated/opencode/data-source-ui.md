---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: OpenCode
  logo: logo.png
  logo_dark: dark-logo.png
  tagline: "Trace every OpenCode session: agent steps, tool calls, file ops."
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
  # reliable by construction: install.sh sets OTEL_SERVICE_NAME="opencode", and
  # OpenObserve maps OTEL service name → service_name (confirmed via
  # codex/claude-code real ingest).
  filter: "service_name = 'opencode'"

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
    description: "One command installs the OpenCode OTel telemetry plugin and writes its config. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/agents/opencode/install.sh | bash -s -- \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Use OpenCode
    description: "Run any OpenCode command, e.g.:"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: bash
      text: |
        opencode run "say hi"

  - title: Check OpenObserve
    description: "Open **Traces** and filter `service_name = opencode`. You'll see a span per OpenCode run."
    chip: { kind: traces, label: Traces }
    complete_on: detect

extras:
  installs:
    - opencode-otel-telemetry-plugin
  env_vars:
    - OTEL_EXPORTER_OTLP_ENDPOINT
    - OTEL_EXPORTER_OTLP_HEADERS

fix_title: "Load The OTel Env Before Running"
fix_body: "OpenCode reads its OTel config from environment variables. Source the env file the installer wrote in the same shell that runs opencode:"
fix_lang: bash
fix_snippet: |
  # load the OTel env the installer wrote, then run opencode
  source ~/.config/opencode/.env
  opencode
troubleshooting:
  - q: "No spans after running opencode"
    a: "Source the installer's env file in the shell before running `opencode` (the snippet above)."
  - q: "The plugin isn't loading"
    a: "Re-run the installer (idempotent) — the telemetry plugin is installed globally via npm."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# OpenCode

Trace every OpenCode session: agent steps, tool calls, file ops. The OpenObserve
Data Sources panel renders the stepped setup card from the frontmatter above.
