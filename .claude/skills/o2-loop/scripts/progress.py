#!/usr/bin/env python3
"""Turn a reviewer event stream (argv[1]: codex|claude) into events.jsonl, a live progress.log, and verdict.json."""
import json
import sys
import time


def stamp(msg: str) -> str:
    return f"{time.strftime('%H:%M:%S')} {msg}"


def clip(text: str, n: int = 160) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1] + "…"


def codex_line(e: dict):
    t = e.get("type")
    item = e.get("item") or {}
    kind = item.get("type")
    if t == "item.started" and kind == "command_execution":
        return f"run: {clip(item.get('command', ''))}"
    if t == "item.completed" and kind == "command_execution":
        code = item.get("exit_code")
        return f"exit {code}: {clip(item.get('command', ''), 80)}" if code not in (0, None) else None
    if t == "item.completed" and kind == "reasoning":
        return f"thinking: {clip(item.get('text') or item.get('summary') or '')}"
    if t == "item.completed" and kind == "agent_message":
        text = item.get("text", "")
        return None if text.lstrip().startswith("{") else f"note: {clip(text)}"
    if t == "turn.completed":
        u = e.get("usage") or {}
        return f"done: tokens in={u.get('input_tokens')} out={u.get('output_tokens')}"
    if t == "error":
        return f"error: {clip(e.get('message', json.dumps(e)))}"
    return None


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
        if out_json and isinstance(doc, dict):
            with open(out_json, "w") as f:
                json.dump(doc, f)
        status = e.get("subtype", "")
        cost = e.get("total_cost_usd")
        extra = "" if isinstance(doc, dict) else " (no structured output)"
        return f"done: {status}, cost ${cost:.2f}, turns {e.get('num_turns')}{extra}" if cost is not None else f"done: {status}{extra}"
    return None


def tag(line: str, prefix):
    if not prefix:
        return line
    if line.startswith("done: "):
        line = "finished: " + line[len("done: "):]
    elif line.startswith("error: "):
        line = "failed: " + line[len("error: "):]
    return f"{prefix} | {line}"


def main():
    backend, events_path, progress_path = sys.argv[1:4]
    out_json = sys.argv[4] if len(sys.argv) > 4 else None
    # With a prefix, this stream is one of two: its end is "finished", and only the caller writes the final "done".
    prefix = sys.argv[5] if len(sys.argv) > 5 and sys.argv[5] else None
    finished = False
    with open(events_path, "a") as events, open(progress_path, "a") as progress:
        for raw in sys.stdin:
            events.write(raw)
            events.flush()
            try:
                e = json.loads(raw)
            except ValueError:
                continue
            line = codex_line(e) if backend == "codex" else claude_line(e, out_json)
            if line:
                finished = finished or line.startswith("done: ")
                for part in line.split("\n"):
                    stamped = stamp(tag(part, prefix))
                    progress.write(stamped + "\n")
                    progress.flush()
                    print(stamped, flush=True)
        if not finished:
            stamped = stamp(tag("error: stream ended without a result", prefix))
            progress.write(stamped + "\n")
            progress.flush()
            print(stamped, flush=True)


if __name__ == "__main__":
    main()
