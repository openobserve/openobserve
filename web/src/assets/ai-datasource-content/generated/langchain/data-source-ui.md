---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: LangChain / LangGraph
  logo: logo.jpeg
  tagline: Trace every chain, LLM call, tool invocation, and retrieval step.
  runtime: Python 3.10–3.13
  setup_time: ~2 min
  tone: "#1c8a6f"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` MUST match the
# stream the install command writes to. With `stream_input` (below) the card's
# input drives this and the command's {stream} placeholder together.
detect:
  stream_type: traces
  stream: default
  # confirmed: opentelemetry-instrumentation-langchain (v0.61) sets
  # traceloop.span.kind on WORKFLOW/TASK spans (verified via console exporter).
  # NOTE: only CHAINS get this attr — a bare ChatOpenAI(...).invoke() does NOT,
  # so the "Run Your App" step below must invoke an actual chain to trip detection.
  filter: "traceloop_span_kind IS NOT NULL"
  model_label: gpt-4o-mini

doc_url: https://openobserve.ai/docs/integration/ai/frameworks/langchain/
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
    description: "One command installs the SDK + LangChain instrumentor and writes your `.env`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      download_env: true
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
          --integration=langchain \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Add These Lines To Your App
    description: "Required — paste at the top of your entrypoint, **before** importing LangChain."
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

        from opentelemetry.instrumentation.langchain import LangchainInstrumentor
        from openobserve import openobserve_init

        LangchainInstrumentor().instrument()
        openobserve_init()

  - title: Run Your App
    description: "Invoke an actual LangChain/LangGraph **chain** (not a bare model call — only chains emit the `traceloop_span_kind` span the card detects on). Your app already has the underlying model's API key configured (e.g. `OPENAI_API_KEY`):"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: python
      filename: main.py
      text: |
        from langchain_openai import ChatOpenAI
        from langchain_core.prompts import ChatPromptTemplate

        chain = ChatPromptTemplate.from_template("say {x}") | ChatOpenAI(model="gpt-4o-mini")
        chain.invoke({"x": "hi"})

  - title: Check OpenObserve
    description: "Open **Traces** and look for the chain's span tree — a top-level `<Chain>.workflow` span (e.g. `RunnableSequence.workflow`) with child spans like `ChatOpenAI.chat`. Filter with the `traceloop_span_kind` attribute:"
    chip: { kind: traces, label: Traces }
    complete_on: detect
    pills:
      - traceloop_span_kind
      - workflow
      - task
      - llm

extras:
  installs:
    - openobserve-telemetry-sdk
    - opentelemetry-instrumentation>=0.51b0
    - opentelemetry-instrumentation-langchain
    - langchain-core
    - wrapt>=1.16,<2
    - python-dotenv
  env_vars:
    - OPENOBSERVE_URL
    - OPENOBSERVE_ORG
    - OPENOBSERVE_AUTH_TOKEN

fix_title: "Instrument Before Importing Your Chains"
fix_body: "If a chain runs but no spans appear, instrumentation likely loaded after the LangChain modules were imported. Re-order so the init runs first:"
fix_snippet: |
  # instrument FIRST — before any langchain import
  LangchainInstrumentor().instrument()
  openobserve_init()

  # only then import and build your chains
  from langchain_openai import ChatOpenAI
troubleshooting:
  - q: "Chain runs but no spans appear"
    a: "Move the init lines above any `from langchain… import …`."
  - q: "Spans appear but the filter matches nothing"
    a: "LangChain spans are tagged with `traceloop_span_kind`; filter on that (e.g. `traceloop_span_kind IS NOT NULL`)."
  - q: "pip complains about an externally-managed environment"
    a: "The installer auto-retries with `--break-system-packages --user`. No action needed."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# LangChain / LangGraph

Trace every chain, LLM call, tool invocation, and retrieval step. The OpenObserve
Data Sources panel renders the stepped setup card from the frontmatter above.
