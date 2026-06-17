---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: Anthropic
  logo: logo.png
  logo_dark: dark-logo.png
  tagline: Trace every Claude API call from your Python app.
  runtime: Python 3.9+
  setup_time: ~2 min
  tone: "#d97757"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` is the fallback
# stream; when `stream_input` (below) is present the card's input drives both the
# install command's {stream} placeholder and the stream listened on, so they
# always match (the installer accepts --traces-stream / --logs-stream).
detect:
  stream_type: traces
  stream: default
  # confirmed: opentelemetry-instrumentation-anthropic sets gen_ai.provider.name = 'anthropic'
  filter: "gen_ai_provider_name = 'anthropic'"
  model_label: claude-haiku-4-5

doc_url: https://openobserve.ai/docs/integration/ai/providers/anthropic/
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
    description: "One command installs the SDK + Anthropic instrumentor and writes your `.env`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      download_env: true
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
          --integration=anthropic \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Add These Lines To Your App
    description: "Required — the installer sets up packages, but spans only flow once your app is instrumented. Paste at the top of your entrypoint, **before** importing the Anthropic client."
    chip: { kind: editor, label: main.py }
    required: true
    complete_on: copy
    note: "load_dotenv() is required — openobserve_init() reads its settings from environment variables, not from .env directly."
    code:
      lang: python
      filename: main.py
      text: |
        from dotenv import load_dotenv
        load_dotenv()  # loads the OPENOBSERVE_* vars the installer wrote to .env

        from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor
        from openobserve import openobserve_init

        AnthropicInstrumentor().instrument()
        openobserve_init()

  - title: Run Your App
    description: "Make any Claude call — your app already has its `ANTHROPIC_API_KEY` configured:"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: python
      filename: main.py
      text: |
        client.messages.create(
            model="claude-haiku-4-5",
            max_tokens=100,
            messages=[{"role": "user", "content": "hi"}],
        )

  - title: Check OpenObserve
    description: "Open **Traces** and filter `gen_ai_provider_name = anthropic`. Each call appears as a span carrying:"
    chip: { kind: traces, label: Traces }
    complete_on: detect
    pills:
      - gen_ai.request.model
      - gen_ai.usage.input_tokens
      - gen_ai.usage.output_tokens
      - gen_ai.usage.cache_read_input_tokens
      - llm.usage.cost_total

extras:
  installs:
    - openobserve-telemetry-sdk
    - opentelemetry-instrumentation-anthropic
    - anthropic
    - python-dotenv
  env_vars:
    - OPENOBSERVE_URL
    - OPENOBSERVE_ORG
    - OPENOBSERVE_AUTH_TOKEN

fix_snippet: |
  # instrument FIRST — before the client is imported
  AnthropicInstrumentor().instrument()
  openobserve_init()

  # only then import and use the client
  from anthropic import Anthropic
  client = Anthropic()

troubleshooting:
  - q: App runs but no Claude spans appear
    a: "Move the four init lines above any `from anthropic import …` — instrumentation must be installed before the client is imported."
  - q: pip complains about an externally-managed environment
    a: "The installer auto-retries with `--break-system-packages --user`. No action needed."
  - q: Auth errors in the OpenObserve logs
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."
  - q: Streaming responses are missing
    a: "A span closes when its stream is fully consumed — make sure your loop reads the response to completion."
---

# Anthropic

Trace every Claude API call from your Python app. The OpenObserve Data Sources
panel renders the stepped setup card from the frontmatter above.
