---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: OpenAI Codex
  logo: logo.svg
  tagline: Per-conversation logs from every Codex CLI session.
  runtime: CLI agent
  setup_time: ~2 min
  tone: "#10a37f"

# Live detection — "listening for the first log record". The card polls a cheap
# COUNT over this stream/filter (windowed to listen-time). Codex emits LOGS (not
# traces) in exec mode, so stream_type is logs and we match service_name.
detect:
  stream_type: logs
  stream: default
  # best-effort; confirm on ingest. service_name differs by mode:
  # `codex_exec` (exec mode) vs `codex_cli_rs` (interactive TUI), so match both.
  filter: "service_name IN ('codex_exec', 'codex_cli_rs')"

doc_url: https://openobserve.ai/docs/
slack_url: https://short.openobserve.ai/community

# Optional stream-name input rendered on the card. When present the card
# shows a text field (default below); the value flows BOTH into the install
# command's {stream} placeholder AND the live detection below, so the stream
# the installer writes to and the stream the card listens on stay in lockstep.
stream_input:
  label: Logs Stream Name
  default: default
  placeholder: default
  help: Leave as "default" or set a dedicated stream for these logs.

steps:
  - title: Run The Installer
    description: "One command points Codex at OpenObserve — writes an `[otel.exporter.otlp-http]` block into `~/.codex/config.toml`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/agents/codex/install.sh | bash -s -- \
          --url={url} \
          --org={org} \
          --logs-stream={stream} \
          --token="Basic {token}"

  - title: Use Codex
    description: "Run any Codex command — each session streams a log record to OpenObserve:"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: bash
      text: |
        codex exec "say hi"

  - title: Check OpenObserve
    description: "Open **Logs** and filter `service_name = codex_exec` (or `codex_cli_rs` in interactive mode). You'll see a log record per session."
    chip: { kind: logs, label: Logs }
    complete_on: detect
    pills:
      - service_name

fix_title: "Check Logs, Not Traces"
fix_body: "Codex exports logs (not spans) in exec mode. If nothing shows, query the Logs view and confirm the exporter block was written to config.toml:"
fix_lang: bash
fix_snippet: |
  # confirm Codex points at OpenObserve
  cat ~/.codex/config.toml | grep -A4 'otel.exporter'

  # then run a Codex command and open the LOGS view (not Traces)
troubleshooting:
  - q: "Nothing shows in Traces"
    a: "Codex emits logs, not traces. Open the Logs view and filter `service_name = codex_exec` (or `codex_cli_rs` if you're using interactive mode)."
  - q: "The config block is missing"
    a: "Re-run the installer (idempotent) — it writes `[otel.exporter.otlp-http]` into `~/.codex/config.toml`."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# OpenAI Codex

Per-conversation logs from every Codex CLI session. The OpenObserve Data Sources
panel renders the stepped setup card from the frontmatter above.
