---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: LiteLLM
  logo: logo.png
  tagline: Trace LLM calls across 100+ providers via a unified interface.
  runtime: Python 3.10–3.13
  setup_time: ~2 min
  tone: "#7c3aed"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` MUST match the
# stream the install command writes to. With `stream_input` (below) the card's
# input drives this and the command's {stream} placeholder together.
detect:
  stream_type: traces
  stream: default
  # confirmed: openinference-instrumentation-litellm names the span "completion"
  # (verified via console exporter on a live call); OpenObserve maps span name →
  # operation_name. Emits even on auth error, so detection is robust.
  filter: "operation_name = 'completion'"
  model_label: gpt-4o-mini

doc_url: https://openobserve.ai/docs/integration/ai/gateways/litellm-proxy/
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
    description: "One command installs the SDK + LiteLLM instrumentor and writes your `.env`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      download_env: true
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
          --integration=litellm \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Add These Lines To Your App
    description: "Required — the installer sets up packages, but spans only flow once your app is instrumented. Paste at the top of your entrypoint, **before** importing LiteLLM."
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

        from openinference.instrumentation.litellm import LiteLLMInstrumentor
        from openobserve import openobserve_init

        LiteLLMInstrumentor().instrument()
        openobserve_init()

  - title: Run Your App
    description: "Make any LiteLLM call — your app already has the target provider's API key configured (e.g. `OPENAI_API_KEY`):"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: python
      filename: main.py
      text: |
        import litellm
        litellm.completion(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": "hi"}],
        )

  - title: Check OpenObserve
    description: "Open **Traces** and filter `operation_name = completion`. You'll see a span per LiteLLM call carrying:"
    chip: { kind: traces, label: Traces }
    complete_on: detect
    pills:
      - model
      - token usage
      - cost

extras:
  installs:
    - openobserve-telemetry-sdk
    - openinference-instrumentation-litellm
    - litellm
    - python-dotenv
  env_vars:
    - OPENOBSERVE_URL
    - OPENOBSERVE_ORG
    - OPENOBSERVE_AUTH_TOKEN

fix_title: "Instrument Before Your First LiteLLM Call"
fix_body: "If a call runs but no spans appear, instrumentation likely loaded after litellm was first used. Re-order so the init runs first:"
fix_snippet: |
  # instrument FIRST — before importing litellm
  LiteLLMInstrumentor().instrument()
  openobserve_init()

  # only then import and call litellm
  import litellm
  litellm.completion(model="gpt-4o-mini", messages=[{"role": "user", "content": "hi"}])
troubleshooting:
  - q: "Calls run but no spans appear"
    a: "Move the init lines above `import litellm`."
  - q: "Spans appear but the filter matches nothing"
    a: "LiteLLM spans use `operation_name = completion`; filter on that."
  - q: "pip complains about an externally-managed environment"
    a: "The installer auto-retries with `--break-system-packages --user`. No action needed."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# LiteLLM

Trace LLM calls across 100+ providers via a unified interface. The OpenObserve
Data Sources panel renders the stepped setup card from the frontmatter above.
