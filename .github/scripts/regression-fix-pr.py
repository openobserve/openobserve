#!/usr/bin/env python3
# Usage (env REPO, GH_TOKEN): regression-fix-pr.py <issue> <event>; prints "CLOSER_OK PICK SOURCE BY_WRITER STATE REASON CLOSED_AT".
# Both council callers use it, so they agree on which merged PR fixed a bug and only one of them dispatches.
import json, os, subprocess, sys

PR_FIELDS = "... on PullRequest { number merged mergedAt baseRefName repository { nameWithOwner } }"
QUERY = """
query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $n) {
    state stateReason closedAt
    timelineItems(last: 100, itemTypes: [CLOSED_EVENT, CONNECTED_EVENT, DISCONNECTED_EVENT, CROSS_REFERENCED_EVENT]) { nodes {
      __typename
      ... on ClosedEvent { actor { login } closer { %(pr)s } }
      ... on ConnectedEvent { subject { %(pr)s } }
      ... on DisconnectedEvent { subject { ... on PullRequest { number } } }
      ... on CrossReferencedEvent { source { %(pr)s } }
    } } } } }""" % {"pr": PR_FIELDS}


def gh(*args):
    return subprocess.run(["gh", "api", *args], check=True, capture_output=True, text=True).stdout


def write_level(repo, actor):
    try:
        return gh(f"repos/{repo}/collaborators/{actor}/permission", "--jq", ".permission").strip()
    except subprocess.CalledProcessError as e:
        # 404 means the closer is a bot or deleted account; any other error must not read as "no write access".
        if "HTTP 404" in e.stderr:
            return "none"
        sys.exit(f"could not read @{actor}'s permission on {repo}: {e.stderr.strip()}")


def main():
    issue, event = sys.argv[1], sys.argv[2]
    repo = os.environ["REPO"]
    owner, name = repo.split("/")
    data = json.loads(gh("graphql", "-F", f"owner={owner}", "-F", f"name={name}", "-F", f"n={issue}", "-f", f"query={QUERY}"))
    node = data["data"]["repository"]["issue"]
    nodes = node["timelineItems"]["nodes"]
    closed_at = node.get("closedAt")
    ok = lambda p: bool(p and p.get("number") and p.get("merged") and p.get("baseRefName") == "main"
                        and p["repository"]["nameWithOwner"] == repo)
    # On the automatic door a PR merged after a hand close is never the fix, so both doors decide the same way however late either runs.
    in_time = lambda p: event != "issues" or bool(closed_at and p["mergedAt"] <= closed_at)
    closed = [n for n in nodes if n.get("__typename") == "ClosedEvent"]
    closer = closed[-1].get("closer") if closed else None
    newest = lambda ps: max(ps, key=lambda p: p["mergedAt"])["number"] if ps else None
    linked = {}
    for n in nodes:
        kind, subject = n.get("__typename"), n.get("subject") or {}
        if kind == "ConnectedEvent" and subject.get("number"):
            linked[subject["number"]] = subject
        elif kind == "DisconnectedEvent" and subject.get("number"):
            linked.pop(subject["number"], None)
    connected = newest([p for p in linked.values() if ok(p) and in_time(p)])
    mentioned = newest([n["source"] for n in nodes if n.get("__typename") == "CrossReferencedEvent" and ok(n.get("source")) and in_time(n["source"])])
    if ok(closer):
        pick, src = closer["number"], "closer"
    elif connected:
        pick, src = connected, "connected"
    elif mentioned and event == "workflow_dispatch":
        pick, src = mentioned, "mention"
    else:
        pick, src = "-", "none"
    # A reporter can close their own issue, so a close not made by a merged PR counts only from someone with write access.
    by_writer = "no"
    actor = ((closed[-1].get("actor") or {}).get("login") if closed else "") or ""
    if actor and not ok(closer):
        by_writer = "yes" if write_level(repo, actor) in ("admin", "maintain", "write") else "no"
    print("yes" if ok(closer) else "no", pick, src, by_writer, node["state"], node.get("stateReason") or "NONE", closed_at or "-")


if __name__ == "__main__":
    main()
