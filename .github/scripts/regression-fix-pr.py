#!/usr/bin/env python3
# Usage (env REPO, GH_TOKEN): regression-fix-pr.py <issue> <event>; prints "CLOSER_OK PICK SOURCE TRUSTED STATE REASON CLOSED_AT".
# Both council callers use it, so they agree on which merged PR fixed a bug and only one of them dispatches.
import json, os, subprocess, sys

QUERY = """
query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $n) {
    state stateReason closedAt
    timelineItems(last: 100, itemTypes: [CLOSED_EVENT, CONNECTED_EVENT, CROSS_REFERENCED_EVENT]) { nodes {
      __typename
      ... on ClosedEvent { actor { login } closer { ... on PullRequest { number merged mergedAt baseRefName repository { nameWithOwner } } } }
      ... on ConnectedEvent { subject { ... on PullRequest { number merged mergedAt baseRefName repository { nameWithOwner } } } }
      ... on CrossReferencedEvent { source { ... on PullRequest { number merged mergedAt baseRefName repository { nameWithOwner } } } }
    } } } } }"""


def gh(*args):
    return subprocess.run(["gh", "api", *args], check=True, capture_output=True, text=True).stdout


def main():
    issue, event = sys.argv[1], sys.argv[2]
    repo = os.environ["REPO"]
    owner, name = repo.split("/")
    data = json.loads(gh("graphql", "-F", f"owner={owner}", "-F", f"name={name}", "-F", f"n={issue}", "-f", f"query={QUERY}"))
    node = data["data"]["repository"]["issue"]
    nodes = node["timelineItems"]["nodes"]
    ok = lambda p: bool(p and p.get("number") and p.get("merged") and p.get("baseRefName") == "main"
                        and p["repository"]["nameWithOwner"] == repo)
    closed = [n for n in nodes if n.get("__typename") == "ClosedEvent"]
    closer = closed[-1].get("closer") if closed else None
    newest = lambda ps: max(ps, key=lambda p: p["mergedAt"])["number"] if ps else None
    connected = newest([n["subject"] for n in nodes if n.get("__typename") == "ConnectedEvent" and ok(n.get("subject"))])
    mentioned = newest([n["source"] for n in nodes if n.get("__typename") == "CrossReferencedEvent" and ok(n.get("source"))])
    if ok(closer):
        pick, src = closer["number"], "closer"
    elif connected:
        pick, src = connected, "connected"
    elif mentioned and event == "workflow_dispatch":
        pick, src = mentioned, "mention"
    else:
        pick, src = "-", "none"
    # A reporter can close their own issue, so a close not made by a merged PR counts only from someone with write access.
    trusted = "no"
    actor = ((closed[-1].get("actor") or {}).get("login") if closed else "") or ""
    if actor and not ok(closer):
        try:
            level = gh(f"repos/{repo}/collaborators/{actor}/permission", "--jq", ".permission").strip()
        except subprocess.CalledProcessError:
            level = "none"
        trusted = "yes" if level in ("admin", "maintain", "write") else "no"
    print("yes" if ok(closer) else "no", pick, src, trusted, node["state"], node.get("stateReason") or "NONE", node.get("closedAt") or "-")


if __name__ == "__main__":
    main()
