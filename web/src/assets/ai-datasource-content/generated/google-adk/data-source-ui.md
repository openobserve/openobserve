---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: Google ADK
  logo: logo.svg
  tagline: Trace every ADK agent run, LLM call, and tool execution.
  runtime: Python 3.10–3.13
  setup_time: ~2 min
  tone: "#4285f4"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` MUST match the
# stream the install command writes to. With `stream_input` (below) the card's
# input drives this and the command's {stream} placeholder together.
detect:
  stream_type: traces
  stream: default
  # confirmed: OpenObserve stores the span name in `operation_name` (not `name`);
  # openinference-instrumentation-google-adk names spans "invocation [<app_name>]"
  filter: "operation_name LIKE 'invocation %'"
  model_label: gemini-2.0-flash

doc_url: https://openobserve.ai/docs/integration/ai/frameworks/google-adk/
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
    description: "One command installs the SDK + Google ADK instrumentor and writes your `.env`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      download_env: true
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
          --integration=google-adk \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"

  - title: Add These Lines To Your App
    description: "Required — paste at the top of your entrypoint, **before** importing the ADK. Spans only flow once your app is instrumented."
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

        from openinference.instrumentation.google_adk import GoogleADKInstrumentor
        from openobserve import openobserve_init

        GoogleADKInstrumentor().instrument()
        openobserve_init()

  - title: Run Your App
    description: "Define an agent and run it — your app already has its `GOOGLE_API_KEY` configured:"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: python
      filename: main.py
      text: |
        from google.adk.agents import Agent
        from google.adk.runners import InMemoryRunner
        from google.genai import types

        agent = Agent(
            name="assistant",
            model="gemini-2.0-flash",
            instruction="You are a helpful assistant.",
        )

        runner = InMemoryRunner(agent=agent, app_name="assistant")
        session = runner.session_service.create_session(app_name="assistant", user_id="user")

        for event in runner.run(
            user_id="user",
            session_id=session.id,
            new_message=types.Content(role="user", parts=[types.Part(text="What is OpenObserve?")]),
        ):
            if event.is_final_response():
                print(event.content.parts[0].text)

  - title: Check OpenObserve
    description: "Open **Traces** and filter for spans named `invocation [<app_name>]`. The agent invocation appears as a span tree:"
    chip: { kind: traces, label: Traces }
    complete_on: detect
    pills:
      - invocation [app_name]
      - model calls
      - tool executions

extras:
  installs:
    - openobserve-telemetry-sdk
    - openinference-instrumentation-google-adk
    - google-adk
    - python-dotenv
  env_vars:
    - OPENOBSERVE_URL
    - OPENOBSERVE_ORG
    - OPENOBSERVE_AUTH_TOKEN

fix_title: "Instrument Before Importing The ADK"
fix_body: "If an agent runs but no spans appear, instrumentation likely loaded after the ADK modules were imported. Re-order so the init runs first:"
fix_snippet: |
  # instrument FIRST — before importing the ADK modules
  GoogleADKInstrumentor().instrument()
  openobserve_init()

  # only then import and run your agent
  from google.adk.agents import Agent
troubleshooting:
  - q: "Agent runs but no spans appear"
    a: "Move the init lines above any `from google.adk… import …`."
  - q: "Spans appear but the filter matches nothing"
    a: "ADK invocation spans are named `invocation …`; filter with `operation_name LIKE 'invocation %'`."
  - q: "pip complains about an externally-managed environment"
    a: "The installer auto-retries with `--break-system-packages --user`. No action needed."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# Google ADK

Trace every ADK agent run, LLM call, and tool execution. The OpenObserve Data
Sources panel renders the stepped setup card from the frontmatter above.
