---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: OpenAI
  logo: logo.svg
  logo_dark: dark-logo.svg
  tagline: Trace every OpenAI Python SDK call.
  runtime: Python 3.10–3.13
  setup_time: ~2 min
  tone: "#10a37f"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` MUST match the
# stream the install command writes to. With `stream_input` (below) the card's
# input drives this and the command's {stream} placeholder together.
detect:
  stream_type: traces
  stream: default
  # confirmed: opentelemetry-instrumentation-openai sets gen_ai.provider.name (new GenAI semconv)
  filter: "gen_ai_provider_name = 'openai'"
  model_label: gpt-4o-mini

doc_url: https://openobserve.ai/docs/integration/ai/providers/openai/
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
    description: "One command installs the SDK + OpenAI instrumentor and writes your `.env`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      download_env: true
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
          --integration=openai \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Add These Lines To Your App
    description: "Required — paste at the top of your entrypoint, **before** importing the OpenAI client."
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

        from opentelemetry.instrumentation.openai import OpenAIInstrumentor
        from openobserve import openobserve_init

        OpenAIInstrumentor().instrument()
        openobserve_init()

  - title: Run Your App
    description: "Make any OpenAI call — your app already has its `OPENAI_API_KEY` configured:"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: python
      filename: main.py
      text: |
        client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "hi"}],
        )

  - title: Check OpenObserve
    description: "Open **Traces** and filter `gen_ai_provider_name = openai`. Each call appears as a span like `openai.chat` carrying:"
    chip: { kind: traces, label: Traces }
    complete_on: detect
    pills:
      - gen_ai.request.model
      - gen_ai.usage.input_tokens
      - gen_ai.usage.output_tokens
      - llm.usage.cost_total

extras:
  installs:
    - openobserve-telemetry-sdk
    - opentelemetry-instrumentation-openai
    - openai
    - python-dotenv
  env_vars:
    - OPENOBSERVE_URL
    - OPENOBSERVE_ORG
    - OPENOBSERVE_AUTH_TOKEN

fix_title: "Instrument Before Importing The Client"
fix_body: "If your app runs but no spans appear, instrumentation likely loaded after the OpenAI client was imported. Re-order so the init runs first:"
fix_snippet: |
  # instrument FIRST — before the client is imported
  OpenAIInstrumentor().instrument()
  openobserve_init()

  # only then import and use the client
  from openai import OpenAI
  client = OpenAI()
troubleshooting:
  - q: "App runs but no OpenAI spans appear"
    a: "Move the init lines above any `from openai import …` — instrumentation must be installed before the client is imported."
  - q: "pip complains about an externally-managed environment"
    a: "The installer auto-retries with `--break-system-packages --user`. No action needed."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."
  - q: "Streaming responses are missing"
    a: "A span closes when its stream is fully consumed — make sure your loop reads the response to completion."


---

# OpenAI

Trace every OpenAI Python SDK call. The OpenObserve Data Sources panel renders
the stepped setup card from the frontmatter above.
