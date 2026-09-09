#!/usr/bin/env python3
"""Render a `/code-review` pre-run's ReportFindings calls (or its final text) to argv[1] and its cost to argv[2]."""
import json
import sys


def render(findings):
    out = []
    for i, f in enumerate(findings, 1):
        head = f"{i}. {f.get('file', '?')}:{f.get('line', '?')}"
        tags = [t for t in (f.get("verdict"), f.get("category")) if t]
        if tags:
            head += " [" + ", ".join(tags) + "]"
        out.append(f"{head} — {f.get('summary') or f.get('short_summary') or ''}")
        if f.get("failure_scenario"):
            out.append(f"   failure: {f['failure_scenario']}")
    return "\n".join(out) + "\n"


def main():
    text, cost, findings, seen = "", None, [], set()
    for raw in sys.stdin:
        try:
            e = json.loads(raw)
        except ValueError:
            continue
        if e.get("type") == "assistant":
            for c in (e.get("message") or {}).get("content") or []:
                if c.get("type") == "tool_use" and c.get("name") == "ReportFindings" and c.get("id") not in seen:
                    seen.add(c.get("id"))
                    findings.extend((c.get("input") or {}).get("findings") or [])
        elif e.get("type") == "result":
            text = e.get("result") or ""
            cost = float(e.get("total_cost_usd") or 0)
    with open(sys.argv[1], "w") as f:
        f.write(render(findings) if findings else text)
    if cost is not None:
        with open(sys.argv[2], "w") as f:
            f.write(f"{cost:.2f}")


if __name__ == "__main__":
    main()
