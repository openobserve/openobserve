---
name: openobserve-instrument
description: Instrument an LLM or AI-agent app to send OpenTelemetry traces to OpenObserve, run one sample request, print the link to the first trace, and run the OpenObserve AI data health checks. Use when the user asks to instrument, trace, or connect an AI app to OpenObserve, or to check that its AI telemetry is complete.
---

# Instrument an AI app for OpenObserve and verify the data

You edit the user's project so every LLM call is traced to OpenObserve, prove it with one real
request, and report what is still missing. Work in the project root. Print what you change at each
step; leave the diff for the user to review and commit.

Helper script: `scripts/verify.py` next to this file (Python 3 standard library only). If you
fetched this file by URL, fetch the script from the same directory:
`https://raw.githubusercontent.com/openobserve/openobserve/main/skills/openobserve-instrument/scripts/verify.py`
and save it outside the project (for example `/tmp/openobserve-verify.py`).

## Rules

- Never print, echo, log or paste a secret value. Mention variable **names** only. Do not `cat` the
  `.env`; read it with code that prints names, or let `verify.py` read it.
- Never put the token in source code, the chat, or a command line you show. The app reads it from
  the environment (`load_dotenv()`).
- Do not commit. Do not change unrelated code.
- The org and stream named in the user's prompt win over values in `.env`.

## 1. Read the configuration

The user downloads a `.env` from the OpenObserve AI integration card into the project root. It holds:

| Variable | Required | Meaning |
|---|---|---|
| `OPENOBSERVE_URL` | yes | OpenObserve API base URL, e.g. `https://api.openobserve.ai` |
| `OPENOBSERVE_ORG` | yes | Organization identifier |
| `OPENOBSERVE_AUTH_TOKEN` | yes | `Basic <base64>` (or `Bearer <token>`) |
| `OPENOBSERVE_TRACES_STREAM_NAME` | no | Traces stream; `OPENOBSERVE_STREAM` is accepted too. Default `default` |
| `OPENOBSERVE_UI_URL` | no | Web UI root when it differs from `OPENOBSERVE_URL`, used for links only (links are `<root>/web/…`) |

Check which names exist, for example:

```bash
python3 -c "import re;print(', '.join(m.group(1) for l in open('.env') if (m:=re.match(r'\s*(?:export\s+)?(OPENOBSERVE_\w+)\s*=',l))))"
```

Print `✓ .env found: <names>`. If a required name is missing, stop and tell the user to download
the `.env` from the integration card (Data Sources → AI Integrations → *their SDK* → *With a coding
agent*). If the user named a stream, add `OPENOBSERVE_TRACES_STREAM_NAME=<stream>` to `.env` (the
SDK reads this name). Make sure `.env` is listed in `.gitignore`; add it if not.

## 2. Read the project

Find and print one line, e.g. `Python 3.12 · openai 1.54 · entry point app/main.py · agent name "research-agent"`:

- **Language and runtime**: `pyproject.toml`, `requirements*.txt`, `setup.py`, `package.json`, `go.mod`, …
- **LLM SDK / framework** in use: imports and dependencies (`openai`, `anthropic`, `google-genai`,
  `langchain`, `crewai`, `google-adk`, `openai-agents`, `litellm`, `claude-agent-sdk`, OpenRouter
  via the `openai` client, …).
- **Entry point**: the module that starts the app (`__main__`, `main.py`, CLI script in
  `pyproject.toml`, server startup file).
- **Agent name**: the project or service name (`[project].name`, package name, directory name).
- **Version source**: `[project].version`, `__version__`, `package.json` `version`, or the git
  short SHA (`git rev-parse --short HEAD`) when nothing else exists.
- **Session id**: whatever identifies one conversation or request in the app (chat/thread/session
  id, request id). If the app has none, generate one per run with `uuid.uuid4()`.

## 3. Install

### Python, supported SDK — use the OpenObserve installer

Run the same installer the integration card uses. It installs the packages into the interpreter it
finds and merges `.env`; it does not print the token. Read the values from `.env` inside the
command so they never appear in what you show. Do not `source` the `.env`: the token value
`Basic <base64>` contains an unquoted space, which a shell reads as a command.

```bash
env_get() { python3 -c 'import sys
for l in open(".env"):
    k, _, v = l.strip().removeprefix("export ").partition("=")
    if k.strip() == sys.argv[1]: print(v.strip().strip("\"'\''")); break' "$1"; }
curl -fsSL https://raw.githubusercontent.com/openobserve/o2-datasource/main/ai/frameworks/setup.sh | bash -s -- \
  --integration=<integration> \
  --url="$(env_get OPENOBSERVE_URL)" \
  --org=<org> \
  --traces-stream=<stream> \
  --token="$(env_get OPENOBSERVE_AUTH_TOKEN)" \
  --quiet
```

`<integration>` is one of `openai`, `anthropic`, `gemini`, `langchain`, `crewai`, `google-adk`,
`claude-agent-sdk`, `openai-agents`, `openrouter`, `litellm`. If the project uses a virtualenv,
uv, poetry or pipenv, install into that environment instead and add the packages to the project's
dependency file. Packages and init lines per integration:

| Integration | Packages (plus `openobserve-telemetry-sdk python-dotenv`) | Instrumentor |
|---|---|---|
| openai | `opentelemetry-instrumentation-openai` | `from opentelemetry.instrumentation.openai import OpenAIInstrumentor` |
| anthropic | `opentelemetry-instrumentation-anthropic` | `from opentelemetry.instrumentation.anthropic import AnthropicInstrumentor` |
| gemini | `opentelemetry-instrumentation-google-generativeai` | `from opentelemetry.instrumentation.google_generativeai import GoogleGenerativeAiInstrumentor` |
| langchain | `opentelemetry-instrumentation-langchain` | `from opentelemetry.instrumentation.langchain import LangchainInstrumentor` |
| crewai | `openinference-instrumentation-crewai` | `from openinference.instrumentation.crewai import CrewAIInstrumentor` (set `CREWAI_TELEMETRY_OPT_OUT=true`; call `openobserve_init()` first) |
| google-adk | `openinference-instrumentation-google-adk` | `from openinference.instrumentation.google_adk import GoogleADKInstrumentor` |
| openai-agents | `openinference-instrumentation-openai-agents` | `from openinference.instrumentation.openai_agents import OpenAIAgentsInstrumentor` |
| openrouter | `openinference-instrumentation-openai` | `from openinference.instrumentation.openai import OpenAIInstrumentor` |
| litellm | `openinference-instrumentation-litellm` | `from openinference.instrumentation.litellm import LiteLLMInstrumentor` |
| claude-agent-sdk | — | wrap each `query()` in a span (see the installer's printed snippet) |

Print `✓ setup.sh --integration=<integration> --org=<org> --traces-stream=<stream>` (no token).

### Anything else — plain OTLP/HTTP

For other languages or SDKs without an instrumentor, use the standard OpenTelemetry SDK with the
OTLP/HTTP exporter and an OpenInference or OpenTelemetry GenAI instrumentor where one exists:

- Endpoint: `<OPENOBSERVE_URL>/api/<org>/v1/traces` (protobuf or JSON over HTTP).
- Headers: `Authorization: <OPENOBSERVE_AUTH_TOKEN>` and `stream-name: <stream>`.
- Environment form, read by every OpenTelemetry SDK:
  `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=<url>/api/<org>/v1/traces`,
  `OTEL_EXPORTER_OTLP_TRACES_HEADERS=Authorization=Basic%20<base64>,stream-name=<stream>`
  (write these into `.env` from the existing values; do not print them).
- If no instrumentor exists, wrap each LLM call in a span named `chat <model>` with
  `gen_ai.operation.name=chat`, `gen_ai.provider.name`, `gen_ai.request.model`,
  `gen_ai.response.model`, `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens`.

## 4. Edit the entry point

Put the init lines at the very top of the entry point, **before** any import of the LLM client
(instrumentors patch the client at import time). Python with the OpenAI SDK:

```python
import os
import uuid
from contextlib import contextmanager

from dotenv import load_dotenv
load_dotenv()  # openobserve_init() reads OPENOBSERVE_* from the environment

from opentelemetry import baggage, context
from opentelemetry.sdk.trace import SpanProcessor
from opentelemetry.instrumentation.openai import OpenAIInstrumentor
from openobserve import get_tracer_provider, openobserve_init

AGENT_NAME = "research-agent"          # from step 2
AGENT_VERSION = "1.4.0"                # from step 2 (read it at runtime when you can)


class ConversationIdProcessor(SpanProcessor):
    """Copy the request's conversation id onto every span started inside it."""

    def on_start(self, span, parent_context=None):
        conversation_id = baggage.get_baggage("gen_ai.conversation.id", parent_context)
        if conversation_id:
            span.set_attribute("gen_ai.conversation.id", str(conversation_id))


OpenAIInstrumentor().instrument()
openobserve_init(
    agent_name=AGENT_NAME,
    resource_attributes={
        "service.name": AGENT_NAME,
        "gen_ai.agent.name": AGENT_NAME,
        "gen_ai.agent.version": AGENT_VERSION,
    },
)
get_tracer_provider().add_span_processor(ConversationIdProcessor())


@contextmanager
def conversation(conversation_id: str | None = None):
    """Wrap one request / chat turn: `with conversation(session_id): ...`."""
    token = context.attach(
        baggage.set_baggage("gen_ai.conversation.id", conversation_id or str(uuid.uuid4()))
    )
    try:
        yield
    finally:
        context.detach(token)


from openai import OpenAI  # client imports come after the init lines
```

Then wrap the code that handles one request or conversation turn in `with conversation(<the app's
session id>):`. These three attributes are what two of the data health checks look for:
`gen_ai.agent.name` (missing agent identity), `gen_ai.agent.version`, and
`gen_ai.conversation.id` (spans without session id). Short-lived scripts must exit normally (the
SDK flushes at exit) or call `openobserve_flush()` before exiting.

Print each edit, e.g.:

```
✓ OpenAIInstrumentor().instrument() and openobserve_init() above "from openai import"
✓ gen_ai.agent.name = research-agent, version from pyproject.toml
✓ gen_ai.conversation.id = the request's session id
```

## 5. Run one sample request

Record the start time, then run the smallest real request the app supports (a CLI flag, a test
script, or one HTTP call to the running server). Use the app's own credentials (`OPENAI_API_KEY`
etc.); never ask for them in chat.

```bash
START=$(date +%s)
python -m app.main --once "Summarize the EU AI Act disclosure rules"
```

If the app cannot make a real call (no API key), tell the user and stop; do not fake spans.
`load_dotenv()` never overrides a variable that is already set, even to an empty string; if the
app reports a missing key that `.env` has, `unset` the empty variable in the shell first.

## 6. Verify: first trace and data health

```bash
python3 <skill dir>/scripts/verify.py --env-file .env --stream <stream> --since "$START" --service <agent name>
```

The script waits up to 120 s for spans, prints the span count and the link to the first trace, then
calls `GET <url>/api/<org>/gen_ai/data_health?stream_name=…&start_time=…&end_time=…&refresh=true`
and prints each check with the page that fixes it. Show its output to the user as is:

```
    ✓ 14 spans arrived in 6.2 s

  First trace
    https://<openobserve>/web/traces/trace-details?stream=default&trace_id=4e0c91d7…&from=…&to=…&org_identifier=default

  Data health
    ✓ Missing agent identity    0 of 14 spans
    ✓ Spans without session id  0 of 14 spans
    ✓ Zero-duration spans       0 of 14 spans
    ! Unpriced models           acme-internal-llm · 3,420 tokens counted as $0
                                Fix in LLM Model Pricing: https://<openobserve>/web/settings/model_pricing?tab=unpriced&stream=default&org_identifier=default

  3 of 4 checks pass. Fix the items above, then run the checks again.
```

Exit codes: `0` spans arrived and no check is in error, `1` a check is in error, `2` configuration
problem or no spans before the timeout. On `2` with no spans: confirm the init lines run before the
client import, the process exits cleanly, and the stream name matches.

What each failed check means and where to fix it:

| Check | Fix |
|---|---|
| Missing agent identity | Set `gen_ai.agent.name` (step 4) or map an existing attribute in Settings → GenAI Agent Mapping |
| Spans without session id | Wrap each request in `conversation(...)` (step 4) |
| Zero-duration spans | Spans ended before the work did — usually a span closed before a streamed response was consumed. See the AI integration docs |
| Unpriced models | Add the model's price in Settings → LLM Model Pricing (the link opens the unpriced list) |

When the user fixes something and asks to check again, rerun only the checks:

```bash
python3 <skill dir>/scripts/verify.py --env-file .env --stream <stream> --health-only
```

## 7. Report

End with: the files you changed, the first trace link, the health summary line, and the fixes left
for the user.
