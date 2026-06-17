---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: CrewAI
  logo: logo.svg
  tagline: Trace every crew, agent, task, and tool execution.
  runtime: Python 3.10–3.13
  setup_time: ~2 min
  tone: "#ef6c3b"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` MUST match the
# stream the install command writes to. With `stream_input` (below) the card's
# input drives this and the command's {stream} placeholder together.
detect:
  stream_type: traces
  stream: default
  # confirmed: OpenObserve stores the span name in `operation_name` (not `name`);
  # openinference-instrumentation-crewai names the crew span "Crew_<id>.kickoff"
  filter: "operation_name LIKE 'Crew_%.kickoff'"

doc_url: https://openobserve.ai/docs/integration/ai/frameworks/crewai/
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
    description: "One command installs the SDK + CrewAI instrumentor and writes your `.env`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      download_env: true
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
          --integration=crewai \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Add These Lines To Your App
    description: "Required — paste at the top of your entrypoint, **before** importing CrewAI."
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

        import os
        os.environ["CREWAI_TELEMETRY_OPT_OUT"] = "true"

        from openobserve import openobserve_init
        openobserve_init()

        from openinference.instrumentation.crewai import CrewAIInstrumentor
        CrewAIInstrumentor().instrument()

  - title: Run Your App
    description: "Kick off any crew — your app already has the underlying model's API key configured (e.g. `OPENAI_API_KEY`):"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: python
      filename: main.py
      text: |
        crew.kickoff()

  - title: Check OpenObserve
    description: "Open **Traces** and filter for spans named `Crew_<uuid>.kickoff`. You'll see the full crew run — agents, tasks, and tool calls — as a span tree."
    chip: { kind: traces, label: Traces }
    complete_on: detect

extras:
  installs:
    - openobserve-telemetry-sdk
    - openinference-instrumentation-crewai
    - crewai>=1.10.1
    - python-dotenv
  env_vars:
    - OPENOBSERVE_URL
    - OPENOBSERVE_ORG
    - OPENOBSERVE_AUTH_TOKEN

fix_title: "Init And Opt-Out Before Instrumenting"
fix_body: "CrewAI's setup order is reversed from other frameworks. If a crew runs but no spans appear, make sure the telemetry opt-out and openobserve_init() both run before the instrumentor is attached:"
fix_snippet: |
  import os
  os.environ["CREWAI_TELEMETRY_OPT_OUT"] = "true"

  # init FIRST, then attach the instrumentor
  from openobserve import openobserve_init
  openobserve_init()

  from openinference.instrumentation.crewai import CrewAIInstrumentor
  CrewAIInstrumentor().instrument()
troubleshooting:
  - q: "Crew runs but no spans appear"
    a: "Ensure `openobserve_init()` runs before `CrewAIInstrumentor().instrument()` — CrewAI's order is reversed from the other framework cards."
  - q: "CrewAI's own telemetry is interfering"
    a: "Set `CREWAI_TELEMETRY_OPT_OUT=true` before importing crewai (the snippet above does this)."
  - q: "pip complains about an externally-managed environment"
    a: "The installer auto-retries with `--break-system-packages --user`. No action needed."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# CrewAI

Trace every crew, agent, task, and tool execution from your Python app. The
OpenObserve Data Sources panel renders the stepped setup card from the
frontmatter above.
