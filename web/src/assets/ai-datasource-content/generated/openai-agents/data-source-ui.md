---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: OpenAI Agents SDK
  logo: logo.svg
  logo_dark: dark-logo.svg
  tagline: Trace every agent workflow, handoff, and LLM call.
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
  # confirmed: OpenObserve stores the span name in `operation_name` (not `span_name`);
  # openinference-instrumentation-openai-agents uses the SDK trace name "Agent workflow"
  filter: "operation_name = 'Agent workflow'"

doc_url: https://openobserve.ai/docs/integration/ai/frameworks/openai-agents/
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
    description: "One command installs the SDK + OpenAI Agents instrumentor and writes your `.env`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      download_env: true
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
          --integration=openai-agents \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Add These Lines To Your App
    description: "Required — the installer sets up packages, but spans only flow once your app is instrumented. Paste at the top of your entrypoint, **before** importing the Agents SDK."
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

        from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor
        from openobserve import openobserve_init

        OpenAIAgentsInstrumentor().instrument()
        openobserve_init()

  - title: Run Your App
    description: "Define an agent and run it — your app already has `OPENAI_API_KEY` configured, and every call is traced automatically:"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: python
      filename: main.py
      text: |
        from agents import Agent, Runner

        agent = Agent(name="Assistant", instructions="You are a helpful assistant.")

        result = Runner.run_sync(agent, "hi")
        print(result.final_output)

  - title: Check OpenObserve
    description: "Open **Traces** and filter for spans named `Agent workflow`. You'll see the agent run — model calls, tool calls, handoffs — as a span tree."
    chip: { kind: traces, label: Traces }
    complete_on: detect

extras:
  installs:
    - openobserve-telemetry-sdk
    - openinference-instrumentation-openai-agents
    - openai-agents
    - python-dotenv
  env_vars:
    - OPENOBSERVE_URL
    - OPENOBSERVE_ORG
    - OPENOBSERVE_AUTH_TOKEN

fix_title: "Instrument Before Importing The Agents SDK"
fix_body: "If an agent run produces no spans, instrumentation likely loaded after the Agents SDK was imported. Re-order so the init runs first:"
fix_snippet: |
  # instrument FIRST — before importing the Agents SDK
  OpenAIAgentsInstrumentor().instrument()
  openobserve_init()

  # only then import and run your agent
  from agents import Agent, Runner
troubleshooting:
  - q: "Agent runs but no spans appear"
    a: "Move the init lines above any `from agents import …`."
  - q: "Spans appear but the filter matches nothing"
    a: "Top-level runs are named `Agent workflow`; filter with `operation_name = 'Agent workflow'`."
  - q: "pip complains about an externally-managed environment"
    a: "The installer auto-retries with `--break-system-packages --user`. No action needed."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# OpenAI Agents SDK

Trace every agent workflow, handoff, and LLM call from your Python app. The
OpenObserve Data Sources panel renders the stepped setup card from the
frontmatter above.
