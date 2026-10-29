#!/usr/bin/env python3
# Copyright 2026 OpenObserve Inc.
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Wait for an instrumented app's first GenAI spans in OpenObserve, print the
first trace link, then run the OpenObserve AI data health checks.

Only spans with gen_ai.operation.name count: HTTP or database spans alone mean
the LLM client is not instrumented.

Python 3 standard library only. Credentials come from the project's .env (or
the process environment); the script prints variable names, never values.

Exit codes:
  0  GenAI spans arrived and no health check is in error
  1  GenAI spans arrived but at least one health check is in error
  2  configuration problem, no GenAI span arrived before the timeout, or the server
     has no data health API (upgrade OpenObserve)
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

REQUIRED_VARS = ("OPENOBSERVE_URL", "OPENOBSERVE_ORG", "OPENOBSERVE_AUTH_TOKEN")
STREAM_VARS = ("OPENOBSERVE_TRACES_STREAM_NAME", "OPENOBSERVE_STREAM")
DOCS_URL = "https://openobserve.ai/docs/integration/ai/"

CHECK_ORDER = (
    "missing_agent_identity",
    "missing_session_id",
    "zero_duration_spans",
    "unpriced_models",
)
CHECK_LABELS = {
    "missing_agent_identity": "Missing agent identity",
    "missing_session_id": "Spans without session id",
    "zero_duration_spans": "Zero-duration spans",
    "unpriced_models": "Unpriced models",
}
STATUS_MARKS = {"pass": "✓", "warning": "!", "error": "✗"}


def parse_env_file(path):
    """Parse KEY=VALUE lines (optional `export`, quotes and comments)."""
    values = {}
    with open(path, encoding="utf-8") as fh:
        for raw_line in fh:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            if line.startswith("export "):
                line = line[len("export ") :].lstrip()
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            elif " #" in value:
                value = value.split(" #", 1)[0].rstrip()
            values[key] = value
    return values


def load_config(env_file):
    file_values = {}
    if os.path.isfile(env_file):
        file_values = parse_env_file(env_file)
        found = [k for k in REQUIRED_VARS + STREAM_VARS + ("OPENOBSERVE_UI_URL",) if k in file_values]
        print(f"  .env found ({env_file}): {', '.join(found) if found else 'no OPENOBSERVE_* variables'}")
    else:
        print(f"  No .env at {env_file}; using the process environment")

    def get(name):
        return os.environ.get(name) or file_values.get(name) or ""

    missing = [name for name in REQUIRED_VARS if not get(name)]
    if missing:
        print(f"✗ Missing {', '.join(missing)}. Download the .env from the AI integration card.")
        sys.exit(2)
    return get


def auth_header(token):
    token = token.strip()
    if token.split(" ", 1)[0] in ("Basic", "Bearer"):
        return token
    return f"Basic {token}"


class Client:
    def __init__(self, base_url, org, token):
        self.base_url = base_url.rstrip("/")
        self.org = org
        self.auth = auth_header(token)

    def request(self, method, path, query=None, body=None):
        url = f"{self.base_url}/api/{urllib.parse.quote(self.org, safe='')}/{path}"
        if query:
            url += "?" + urllib.parse.urlencode(query)
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Authorization", self.auth)
        req.add_header("Accept", "application/json")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8") or "{}")

    def search_traces(self, sql, start_us, end_us, size):
        body = {
            "query": {
                "sql": sql,
                "start_time": start_us,
                "end_time": end_us,
                "from": 0,
                "size": size,
            }
        }
        return self.request("POST", "_search", {"type": "traces"}, body).get("hits", [])


def sql_string(value):
    return "'" + value.replace("'", "''") + "'"


def first_trace(client, stream, service, start_us, end_us):
    """Return (span_count, first_trace_id) for GenAI spans in the window, or (0, None)."""
    where = " WHERE gen_ai_operation_name IS NOT NULL"
    if service:
        where += f" AND service_name = {sql_string(service)}"
    table = '"' + stream.replace('"', '""') + '"'
    count_hits = client.search_traces(
        f"SELECT count(*) AS spans FROM {table}{where}", start_us, end_us, 1
    )
    spans = int(count_hits[0].get("spans", 0)) if count_hits else 0
    if spans == 0:
        return 0, None
    trace_hits = client.search_traces(
        f"SELECT trace_id, min(_timestamp) AS first_ts FROM {table}{where} "
        "GROUP BY trace_id ORDER BY first_ts ASC LIMIT 1",
        start_us,
        end_us,
        1,
    )
    return spans, (trace_hits[0].get("trace_id") if trace_hits else None)


def wait_for_spans(client, stream, service, start_us, timeout_s):
    started = time.monotonic()
    last_error = None
    while True:
        end_us = int(time.time() * 1_000_000)
        try:
            spans, trace_id = first_trace(client, stream, service, start_us, end_us)
            if spans and trace_id:
                return spans, trace_id, time.monotonic() - started
        except urllib.error.HTTPError as err:
            # 401/403 never heal; anything else (e.g. the stream does not exist yet) may.
            if err.code in (401, 403):
                print(f"✗ OpenObserve rejected the credentials (HTTP {err.code}). Check OPENOBSERVE_AUTH_TOKEN.")
                sys.exit(2)
            last_error = f"HTTP {err.code}"
        except urllib.error.URLError as err:
            last_error = str(err.reason)
        if time.monotonic() - started >= timeout_s:
            reason = f" (last error: {last_error})" if last_error else ""
            print(f"✗ No GenAI spans on stream '{stream}' after {timeout_s:.0f} s{reason}.")
            print("  Only spans with gen_ai.operation.name count. Check that the OpenAI/Anthropic")
            print("  instrumentor is installed, that the init lines run before the LLM client is")
            print("  imported, and that the process exits cleanly or calls openobserve_flush().")
            sys.exit(2)
        time.sleep(3)


def trace_url(ui_url, org, stream, trace_id, start_us, end_us):
    query = urllib.parse.urlencode(
        {
            "stream": stream,
            "trace_id": trace_id,
            "from": start_us,
            "to": end_us,
            "org_identifier": org,
        }
    )
    return f"{ui_url}/web/traces/trace-details?{query}"


def fix_link(check_id, ui_url, org, stream):
    org_q = urllib.parse.quote(org, safe="")
    if check_id == "unpriced_models":
        stream_q = urllib.parse.quote(stream, safe="")
        return (
            "Fix in LLM Model Pricing",
            f"{ui_url}/web/settings/model_pricing?tab=unpriced&stream={stream_q}&org_identifier={org_q}",
        )
    if check_id == "missing_agent_identity":
        return (
            "Fix in GenAI Agent Mapping",
            f"{ui_url}/web/settings/gen_ai_agent_mapping?org_identifier={org_q}",
        )
    return ("See", DOCS_URL)


def describe(check):
    check_id = check.get("id", "")
    affected = int(check.get("affected", 0))
    total = int(check.get("total", 0))
    if check_id == "unpriced_models" and check.get("models"):
        parts = [
            f"{m.get('model') or '(no model name)'} · {int(m.get('tokens', 0)):,} tokens counted as $0"
            for m in check["models"]
        ]
        if check.get("models_truncated"):
            # The server lists the models with the most tokens; the totals cover all of them.
            parts.append(
                f"top {len(check['models'])} of {int(check.get('model_count', 0)):,} models, "
                f"{int(check.get('unpriced_tokens', 0)):,} tokens in all"
            )
        return ", ".join(parts)
    return f"{affected:,} of {plural(total, 'span')}"


def plural(count, noun):
    return f"{count:,} {noun}" + ("" if count == 1 else "s")


def run_health(client, ui_url, org, stream, start_us, end_us, agent):
    query = {
        "stream_name": stream,
        "start_time": start_us,
        "end_time": end_us,
        "refresh": "true",
        # The script prints a sample trace per failing check.
        "include_samples": "true",
    }
    if agent:
        query["agent"] = agent
    try:
        result = client.request("GET", "gen_ai/data_health", query)
    except urllib.error.HTTPError as err:
        if err.code == 404:
            print("✗ This OpenObserve server has no AI data health API yet; upgrade it to run the checks.")
            return 2
        print(f"✗ Data health request failed (HTTP {err.code}).")
        return 2
    except urllib.error.URLError as err:
        print(f"✗ Data health request failed ({err.reason}).")
        return 2

    checks = {c.get("id"): c for c in result.get("checks", [])}
    if not any(int(c.get("total", 0)) for c in checks.values()):
        scope = f" for agent '{agent}'" if agent else ""
        print(f"✗ No GenAI spans on stream '{stream}'{scope} in this window: every check covered 0 spans.")
        if agent:
            print("  Check the agent name and time window, or omit --agent to inspect the whole stream.")
        else:
            print("  No span carries gen_ai.operation.name, so the LLM client is not instrumented.")
            print(f"  Install the OpenAI/Anthropic instrumentor: {DOCS_URL}")
        return 2
    ordered = [checks[i] for i in CHECK_ORDER if i in checks]
    ordered += [c for i, c in checks.items() if i not in CHECK_ORDER]
    width = max(len(CHECK_LABELS.get(c.get("id"), c.get("id", ""))) for c in ordered) if ordered else 0
    passed = 0
    has_error = False
    for check in ordered:
        check_id = check.get("id", "")
        status = check.get("status", "pass")
        label = CHECK_LABELS.get(check_id, check_id)
        print(f"    {STATUS_MARKS.get(status, '?')} {label.ljust(width)}  {describe(check)}")
        if status == "pass":
            passed += 1
            continue
        has_error = has_error or status == "error"
        text, link = fix_link(check_id, ui_url, org, stream)
        print(f"      {' ' * width}  {text}: {link}")
        samples = check.get("samples") or []
        if samples:
            print(f"      {' ' * width}  Sample trace: {trace_url(ui_url, org, stream, samples[0], start_us, end_us)}")

    print()
    if passed == len(ordered):
        print(f"  All {len(ordered)} checks pass.")
    else:
        print(f"  {passed} of {len(ordered)} checks pass. Fix the items above, then run the checks again.")
    return 1 if has_error else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--env-file", default=".env", help="path to the project .env (default: ./.env)")
    parser.add_argument("--stream", help="traces stream (default: OPENOBSERVE_TRACES_STREAM_NAME, OPENOBSERVE_STREAM, then 'default')")
    parser.add_argument("--since", type=float, help="Unix seconds the sample run started (default: 15 minutes ago)")
    parser.add_argument("--timeout", type=float, default=120, help="seconds to wait for spans (default: 120)")
    parser.add_argument("--service", help="only count spans whose service.name is this value")
    parser.add_argument("--agent", help="scope the health checks to this agent name")
    parser.add_argument("--ui-url", help="OpenObserve web URL when it differs from OPENOBSERVE_URL (or set OPENOBSERVE_UI_URL)")
    parser.add_argument("--health-only", action="store_true", help="skip waiting for spans and rerun the health checks")
    args = parser.parse_args()

    get = load_config(args.env_file)
    base_url = get("OPENOBSERVE_URL").rstrip("/")
    org = get("OPENOBSERVE_ORG")
    stream = args.stream or next((get(v) for v in STREAM_VARS if get(v)), "") or "default"
    ui_url = (args.ui_url or get("OPENOBSERVE_UI_URL") or base_url).rstrip("/")
    client = Client(base_url, org, get("OPENOBSERVE_AUTH_TOKEN"))

    since = args.since if args.since is not None else time.time() - 15 * 60
    # One minute of slack covers clock skew between this machine and the server.
    start_us = int((since - 60) * 1_000_000)
    print(f"  Org {org} · stream {stream}")

    if not args.health_only:
        print(f"  Waiting for GenAI spans on '{stream}' (up to {args.timeout:.0f} s)…")
        spans, trace_id, elapsed = wait_for_spans(client, stream, args.service, start_us, args.timeout)
        # Give the exporter's trailing batch a moment, then recount so the
        # printed total and the checks cover the whole run.
        time.sleep(3)
        end_us = int((time.time() + 60) * 1_000_000)
        spans = first_trace(client, stream, args.service, start_us, end_us)[0] or spans
        print(f"    ✓ {plural(spans, 'span')} arrived in {elapsed:.1f} s")
        print()
        print("  First trace")
        print(f"    {trace_url(ui_url, org, stream, trace_id, start_us, end_us)}")
        print()
    else:
        end_us = int((time.time() + 60) * 1_000_000)

    print("  Data health")
    return run_health(client, ui_url, org, stream, start_us, end_us, args.agent)


if __name__ == "__main__":
    sys.exit(main())
