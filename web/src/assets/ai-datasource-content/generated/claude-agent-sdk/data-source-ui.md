---
# Rich, stepped setup card for the OpenObserve Data Sources panel.
# The frontmatter below IS the card (provider + steps + live detection). Adding a
# `card:` + `detect:` block is what turns this integration into the rich card.
card:
  name: Claude Agent SDK
  logo: logo.svg
  tagline: Trace every agent run — token usage, turn counts, error status.
  runtime: Python 3.10–3.13
  setup_time: ~2 min
  tone: "#d97757"

# Live detection — "listening for the first span". The card polls a cheap COUNT
# over this stream/filter (windowed to listen-time). `stream` MUST match the
# stream the install command writes to. With `stream_input` (below) the card's
# input drives this and the command's {stream} placeholder together.
detect:
  stream_type: traces
  stream: default
  # reliable by construction: the span name is set manually in this card's own
  # snippet (start_as_current_span("claude_agent.query")), and OpenObserve maps
  # span name → operation_name (confirmed via crewai/google-adk/openai-agents).
  filter: "operation_name = 'claude_agent.query'"

doc_url: https://openobserve.ai/docs/integration/ai/frameworks/claude-agent-sdk/
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
    description: "One command installs the SDK + telemetry packages and writes your `.env`. Safe to re-run."
    chip: { kind: terminal, label: Terminal }
    complete_on: copy
    code:
      lang: bash
      download_env: true
      text: |
        curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
          --integration=claude-agent-sdk \
          --url={url} \
          --org={org} \
          --traces-stream={stream} \
          --token="Basic {token}"
    note: "You also need the Claude Code CLI on PATH — the SDK runs it as a subprocess: `npm install -g @anthropic-ai/claude-code`."

  - title: Add These Lines To Your App
    description: "Required — paste at the top of your entrypoint, **before** importing the SDK, then wrap each `query()` call in a manual span."
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

        from openobserve import openobserve_init
        openobserve_init()

        from opentelemetry import trace
        from claude_agent_sdk import query, ClaudeAgentOptions, ResultMessage

        tracer = trace.get_tracer(__name__)

        # Wrap each query() call in a manual span:
        async def run_agent(prompt):
            options = ClaudeAgentOptions(max_turns=1, allowed_tools=[])
            with tracer.start_as_current_span("claude_agent.query") as span:
                span.set_attribute("claude_agent.prompt", prompt[:100])
                async for message in query(prompt=prompt, options=options):
                    if isinstance(message, ResultMessage):
                        span.set_attribute("claude_agent.num_turns", message.num_turns)
                        span.set_attribute("claude_agent.is_error", message.is_error)
                        if message.usage:
                            span.set_attribute("claude_agent.input_tokens",
                                               message.usage.get("input_tokens", 0))
                            span.set_attribute("claude_agent.output_tokens",
                                               message.usage.get("output_tokens", 0))

  - title: Run Your App
    description: "Run a query through the Claude Agent SDK — your app already has its `ANTHROPIC_API_KEY` configured:"
    chip: { kind: run, label: Run }
    complete_on: detect
    detection_anchor: true
    code:
      lang: python
      filename: main.py
      text: |
        import asyncio

        asyncio.run(run_agent("In one sentence, what is OpenObserve?"))

  - title: Check OpenObserve
    description: "Open **Traces** and filter `operation_name = claude_agent.query`. You'll see a span per query with the agent's turns/tool calls:"
    chip: { kind: traces, label: Traces }
    complete_on: detect
    pills:
      - claude_agent.num_turns
      - claude_agent.is_error
      - claude_agent.input_tokens
      - claude_agent.output_tokens

extras:
  installs:
    - openobserve-telemetry-sdk
    - claude-agent-sdk
    - python-dotenv
  env_vars:
    - OPENOBSERVE_URL
    - OPENOBSERVE_ORG
    - OPENOBSERVE_AUTH_TOKEN

fix_title: "Init Before Wrapping query() In A Span"
fix_body: "This integration records manual spans. If nothing appears, make sure openobserve_init() runs before your traced code and that each query() call is wrapped in a span:"
fix_snippet: |
  # init FIRST
  from openobserve import openobserve_init
  openobserve_init()

  # then wrap each query() call in a span
  from opentelemetry import trace
  tracer = trace.get_tracer(__name__)
  with tracer.start_as_current_span("claude_agent.query"):
      async for message in query(prompt=prompt, options=options):
          ...
troubleshooting:
  - q: "Agent runs but no spans appear"
    a: "Ensure `openobserve_init()` runs before the traced code, and that `query()` is called inside `tracer.start_as_current_span(...)`."
  - q: "Spans appear but the filter matches nothing"
    a: "Manual spans use `operation_name = claude_agent.query` (the span name in the snippet). Adjust the filter if you renamed it."
  - q: "pip complains about an externally-managed environment"
    a: "The installer auto-retries with `--break-system-packages --user`. No action needed."
  - q: "Auth errors in the OpenObserve logs"
    a: "The token must be `Basic <base64>` or `Bearer <token>`. Re-copy it from Manage Tokens above."


---

# Claude Agent SDK

Trace every agent run — token usage, turn counts, error status. The OpenObserve
Data Sources panel renders the stepped setup card from the frontmatter above.
