# Replay LLM proxy

Test infrastructure for the `stack-ee` runs. It is an OpenAI-compatible endpoint that
o2-ai uses as its LLM gateway, so a real OpenObserve and a real o2-ai answer a turn
without a model or a key. It holds no customer data and no keys, and it never records:
every recording is written by hand.

## Run

```bash
REPLAY_PROXY_PORT=5199 node tests/ui-testing/playwright-tests/assistant/stack/replay-proxy/server.mjs
```

Point o2-ai at it through its gateway settings. The key only has to be non-empty:

| o2-ai variable | Value |
|---|---|
| `O2_AI_GATEWAY_ENABLED` | `true` |
| `O2_AI_GATEWAY_URL` | `http://127.0.0.1:5199` (o2-ai appends `/v1`) |
| `O2_AI_MODEL` | `replay` |
| `O2_AI_API_KEY` | any placeholder, for example `replay-not-a-key` |

The proxy listens on `127.0.0.1` unless `REPLAY_PROXY_HOST` says otherwise.

| Route | Answers |
|---|---|
| `POST /v1/chat/completions` | one recorded step, streamed (`chat.completion.chunk` frames, then `[DONE]`) or as one `chat.completion` |
| `GET /v1/models` | the single `replay` model |
| `GET /__replay/served` | `{ scenario, step, stream }` per answer, for the run report (no message text) |

## Scenario selection

A flow puts a scenario tag in its prompt, for example `why 5xx? [replay:complete]`. The
proxy takes the first `[replay:<name>]` in the latest user message, or `complete` when
there is none, so bracketed page context or link text after the prompt never picks a
scenario. An unknown name answers 404 with the scenario's name, so a missing recording
fails loudly. The mock harness does not read this tag: mock flows pick a scenario with
`assistantPage.send(text, scenario)` / `nextScenario`, which stack modes skip.

The step is the number of assistant messages after that user message: step 0 answers
the prompt, step 1 answers after the first tool round, and so on. The last step repeats
if the agent asks for more rounds than the recording has.

## Recording format (`recordings/<scenario>.json`)

```json
{
  "version": 1,
  "scenario": "complete",
  "steps": [
    { "tool_calls": [{ "name": "<an MCP tool o2-ai exposes>", "arguments": {} }] },
    { "content": "## Markdown answer" }
  ]
}
```

- `scenario` matches `[a-z0-9_]{1,40}` and the file name.
- `steps` holds 1 to 20 entries. Each one needs `content`, `tool_calls`, or both.
- A recording that breaks these rules stops the proxy at start-up.

Stack flows assert structure only (states, `data-test` ids, network calls, telemetry),
so the text in a recording can change without breaking a flow.

## Checks

```bash
node --test tests/ui-testing/playwright-tests/assistant/stack/replay-proxy/proxy-check.mjs
```
