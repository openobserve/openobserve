#!/usr/bin/env python3
"""Turn a claude stream-json event stream into events.jsonl, a live progress.log, and verdict.json: argv = <events> <progress> <verdict>."""
import json
import sys
import time


def stamp(msg: str) -> str:
    return f"{time.strftime('%H:%M:%S')} {msg}"


def clip(text: str, n: int = 160) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + "…"


def claude_tool_line(c: dict) -> str:
    name = c.get("name", "?")
    inp = c.get("input") or {}
    if name == "Bash":
        return f"run: {clip(inp.get('command', ''))}"
    if name in ("Read", "Edit", "Write"):
        return f"{name.lower()}: {inp.get('file_path', '')}"
    if name == "Grep":
        return f"grep: {clip(inp.get('pattern', ''), 80)} in {inp.get('path', '.')}"
    if name == "Glob":
        return f"glob: {inp.get('pattern', '')}"
    if name == "Skill":
        return f"skill: {inp.get('skill', '')} {clip(inp.get('args', ''), 80)}"
    if name == "Agent":
        return f"agent: {clip(inp.get('description', ''), 80)}"
    if name == "StructuredOutput":
        return "note: structured output produced"
    return f"tool: {name} {clip(json.dumps(inp), 100)}"


def claude_line(e: dict, out_json):
    t = e.get("type")
    if t == "assistant":
        lines = []
        for c in (e.get("message") or {}).get("content") or []:
            if c.get("type") == "tool_use":
                lines.append(claude_tool_line(c))
            elif c.get("type") == "text" and c.get("text", "").strip():
                lines.append(f"note: {clip(c['text'])}")
        return "\n".join(lines) or None
    if t == "result":
        doc = e.get("structured_output")
        if isinstance(doc, dict):
            with open(out_json, "w") as f:
                json.dump(doc, f)
        status = e.get("subtype", "")
        cost = e.get("total_cost_usd")
        extra = "" if isinstance(doc, dict) else " (no structured output)"
        return f"done: {status}, cost ${cost:.2f}, turns {e.get('num_turns')}{extra}" if cost is not None else f"done: {status}{extra}"
    return None


def main():
    events_path, progress_path, out_json = sys.argv[1:4]
    finished = False
    with open(events_path, "a") as events, open(progress_path, "a") as progress:
        for raw in sys.stdin:
            events.write(raw)
            events.flush()
            try:
                e = json.loads(raw)
            except ValueError:
                continue
            line = claude_line(e, out_json)
            if line:
                finished = finished or line.startswith("done: ")
                for part in line.split("\n"):
                    stamped = stamp(part)
                    progress.write(stamped + "\n")
                    progress.flush()
                    print(stamped, flush=True)
        if not finished:
            stamped = stamp("error: stream ended without a result")
            progress.write(stamped + "\n")
            progress.flush()
            print(stamped, flush=True)


if __name__ == "__main__":
    main()
