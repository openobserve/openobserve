#!/usr/bin/env python3
"""Collect one GitHub user's open PR workload across an org as JSON for the o2-pr-brief skill (read-only)."""
import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone

BOT_LOGINS = {"CLAassistant", "github-actions", "dependabot", "copilot-pull-request-reviewer", "coderabbitai"}
FAILING = {"FAILURE", "TIMED_OUT", "STARTUP_FAILURE", "ACTION_REQUIRED", "ERROR"}
PENDING = {"PENDING", "EXPECTED", "QUEUED", "IN_PROGRESS", "WAITING", "REQUESTED"}
EXCERPT_CHARS = 200
GATE_CHECKS = {"ci-gate"}
CI_LABEL = "ready-for-ci"
CI_LABEL_REPOS = {"openobserve/openobserve", "openobserve/o2-enterprise"}

ACTOR = "__typename login"
REVIEWER = "__typename ... on User { login } ... on Team { slug }"
PR_FIELDS = f"""
number title url isDraft createdAt headRefName headRefOid isCrossRepository
additions deletions changedFiles mergeable mergeStateStatus reviewDecision
repository {{ nameWithOwner }}
author {{ {ACTOR} }}
autoMergeRequest {{ enabledAt }}
labels(first: 20) {{ nodes {{ name }} }}
assignees(first: 10) {{ nodes {{ login }} }}
reviewRequests(first: 20) {{ nodes {{ requestedReviewer {{ {REVIEWER} }} }} }}
latestOpinionatedReviews(first: 20) {{ nodes {{ author {{ {ACTOR} }} state submittedAt }} }}
reviews(last: 30) {{ nodes {{ author {{ {ACTOR} }} state submittedAt body }} }}
comments(last: 30) {{ nodes {{ author {{ {ACTOR} }} createdAt body }} }}
commits(last: 10) {{ nodes {{ commit {{ committedDate messageHeadline author {{ user {{ login }} }} }} }} }}
last: commits(last: 1) {{ nodes {{ commit {{ statusCheckRollup {{ state
  contexts(first: 100) {{ totalCount nodes {{ __typename
    ... on CheckRun {{ name status conclusion }}
    ... on StatusContext {{ context state }} }} }} }} }} }} }}
timelineItems(last: 50, itemTypes: [REVIEW_REQUESTED_EVENT, ASSIGNED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT]) {{ nodes {{ __typename
  ... on ReviewRequestedEvent {{ createdAt requestedReviewer {{ {REVIEWER} }} }}
  ... on AssignedEvent {{ createdAt assignee {{ ... on User {{ login }} }} }}
  ... on HeadRefForcePushedEvent {{ createdAt actor {{ login }} }} }} }}
"""
SEARCH = (
    "query($q: String!, $endCursor: String) { search(type: ISSUE, query: $q, first: 10, after: $endCursor) "
    "{ pageInfo { hasNextPage endCursor } nodes { ... on PullRequest { " + PR_FIELDS + " } } } }"
)


def gh_graphql(query: str, **variables) -> dict:
    cmd = ["gh", "api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        cmd += ["-F", f"{key}={'null' if value is None else value}"]
    out = subprocess.run(cmd, capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit(f"gh api graphql failed: {out.stderr.strip()}")
    data = json.loads(out.stdout)
    if data.get("errors"):
        sys.exit(f"GraphQL errors: {json.dumps(data['errors'])}")
    return data["data"]


def fork_runs_awaiting_approval(pr: dict) -> int:
    """Workflow runs on the head commit that a maintainer must approve before they start (fork PRs only)."""
    if not pr["isCrossRepository"]:
        return 0
    path = f"repos/{pr['repository']['nameWithOwner']}/actions/runs?head_sha={pr['headRefOid']}&status=action_required&per_page=1"
    out = subprocess.run(["gh", "api", path, "--jq", ".total_count"], capture_output=True, text=True)
    return int(out.stdout.strip()) if out.returncode == 0 and out.stdout.strip().isdigit() else 0


def search_prs(query: str) -> list:
    nodes, cursor = [], None
    while True:
        page = gh_graphql(SEARCH, q=query, endCursor=cursor)["search"]
        nodes += [n for n in page["nodes"] if n]
        if not page["pageInfo"]["hasNextPage"]:
            return nodes
        cursor = page["pageInfo"]["endCursor"]


def parse_ts(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def days_since(moment, now):
    return round((now - moment).total_seconds() / 86400, 1) if moment else None


def iso(moment):
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ") if moment else None


def excerpt(text: str) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= EXCERPT_CHARS else text[: EXCERPT_CHARS - 1] + "…"


def is_bot(actor) -> bool:
    if not actor:
        return True
    login = actor.get("login", "")
    return actor.get("__typename") == "Bot" or login in BOT_LOGINS or login.endswith("[bot]")


def reviewer_name(reviewer) -> str:
    if not reviewer:
        return "?"
    return reviewer.get("login") or f"team:{reviewer.get('slug')}"


def author_login(pr: dict) -> str:
    return (pr["author"] or {}).get("login", "ghost")


def ci_summary(pr: dict) -> dict:
    commits = pr["last"]["nodes"]
    rollup = commits[0]["commit"]["statusCheckRollup"] if commits else None
    if not rollup:
        return {"state": "NONE", "failing": [], "pending": 0, "total": 0, "awaiting_approval": fork_runs_awaiting_approval(pr)}
    contexts = rollup["contexts"]
    failing, pending = [], 0
    for check in contexts["nodes"]:
        if check["__typename"] == "CheckRun":
            name, result = check["name"], check["conclusion"] or check["status"]
        else:
            name, result = check["context"], check["state"]
        if result in FAILING and name not in failing:
            failing.append(name)
        elif result in PENDING and name not in GATE_CHECKS:
            pending += 1
    summary = {
        "state": rollup["state"],
        "failing": failing,
        "pending": pending,
        "total": contexts["totalCount"],
        "awaiting_approval": fork_runs_awaiting_approval(pr),
    }
    if contexts["totalCount"] > len(contexts["nodes"]):
        summary["checks_not_listed"] = contexts["totalCount"] - len(contexts["nodes"])
    return summary


def human_activity(pr: dict) -> list:
    """Non-bot comments and reviews, oldest first."""
    events = [
        {"login": c["author"]["login"], "kind": "comment", "at": parse_ts(c["createdAt"]), "body": c["body"]}
        for c in pr["comments"]["nodes"]
        if not is_bot(c["author"])
    ]
    events += [
        {"login": r["author"]["login"], "kind": f"review:{r['state']}", "at": parse_ts(r["submittedAt"]), "body": r["body"]}
        for r in pr["reviews"]["nodes"]
        if not is_bot(r["author"]) and r["submittedAt"]
    ]
    return sorted(events, key=lambda e: e["at"])


def is_base_sync(commit: dict) -> bool:
    return commit["messageHeadline"].startswith(("Merge branch", "Merge remote-tracking branch"))


def commit_login(commit: dict):
    return ((commit["author"] or {}).get("user") or {}).get("login")


def pushes(pr: dict, by=None, code_only=False) -> list:
    """Commit and force-push times, optionally only by one login (unlinked commits count) or only code changes."""
    times = [
        parse_ts(c["commit"]["committedDate"])
        for c in pr["commits"]["nodes"]
        if (by is None or commit_login(c["commit"]) in (by, None))
        and not (code_only and is_base_sync(c["commit"]))
    ]
    times += [
        parse_ts(e["createdAt"])
        for e in pr["timelineItems"]["nodes"]
        if e["__typename"] == "HeadRefForcePushedEvent" and (by is None or (e["actor"] or {}).get("login") == by)
    ]
    return times


def last_activity_of(pr: dict, login: str, code_only=False):
    """Latest push, comment or review by one login, or None; code_only ignores merges of the base branch."""
    times = pushes(pr, by=login, code_only=code_only) + [e["at"] for e in human_activity(pr) if e["login"] == login]
    return max(times, default=None)


def base_item(pr: dict, now) -> dict:
    last_human = max(pushes(pr) + [e["at"] for e in human_activity(pr)] + [parse_ts(pr["createdAt"])])
    return {
        "repo": pr["repository"]["nameWithOwner"],
        "number": pr["number"],
        "title": pr["title"],
        "url": pr["url"],
        "author": author_login(pr),
        "fork": pr["isCrossRepository"],
        "draft": pr["isDraft"],
        "branch": pr["headRefName"],
        "size": f"+{pr['additions']}/-{pr['deletions']}, {pr['changedFiles']} files",
        "age_days": days_since(parse_ts(pr["createdAt"]), now),
        "idle_days": days_since(last_human, now),
        "labels": [label["name"] for label in pr["labels"]["nodes"]],
        "ci": ci_summary(pr),
        "review_decision": pr["reviewDecision"],
        "reviews": {
            r["author"]["login"]: r["state"]
            for r in pr["latestOpinionatedReviews"]["nodes"]
            if r["author"] and not is_bot(r["author"])
        },
        "pending_reviewers": [reviewer_name(r["requestedReviewer"]) for r in pr["reviewRequests"]["nodes"]],
        "mergeable": pr["mergeable"],
        "merge_state": pr["mergeStateStatus"],
        "auto_merge": pr["autoMergeRequest"] is not None,
    }


def blockers(item: dict) -> list:
    """Why an open PR is not merged yet; empty when nothing but a merge click is missing."""
    found = []
    if item["draft"]:
        found.append("draft")
    if item["mergeable"] == "CONFLICTING":
        found.append("merge conflicts with base")
    if item["repo"] in CI_LABEL_REPOS and CI_LABEL not in item["labels"] and not item["draft"]:
        found.append(f"no {CI_LABEL} label, so CI has not run")
    if item["ci"]["awaiting_approval"]:
        found.append(f"{item['ci']['awaiting_approval']} workflow runs wait for a maintainer to approve them (fork PR)")
    if item["ci"]["failing"]:
        found.append("failing checks: " + ", ".join(item["ci"]["failing"]))
    elif item["ci"]["pending"]:
        found.append(f"{item['ci']['pending']} checks still running")
    if item["review_decision"] == "CHANGES_REQUESTED":
        who = [login for login, state in item["reviews"].items() if state == "CHANGES_REQUESTED"]
        found.append("changes requested by " + ", ".join(who or ["a reviewer"]))
    elif item["review_decision"] == "REVIEW_REQUIRED":
        found.append("needs an approving review" + (f" (pending: {', '.join(item['pending_reviewers'])})" if item["pending_reviewers"] else ""))
    return found


def authored_item(pr: dict, me: str, now) -> dict:
    item = base_item(pr, now)
    my_last = last_activity_of(pr, me) or parse_ts(pr["createdAt"])
    item["my_last_activity"] = iso(my_last)
    item["unanswered"] = [
        {"login": e["login"], "kind": e["kind"], "at": iso(e["at"]), "excerpt": excerpt(e["body"])}
        for e in human_activity(pr)
        if e["login"] != me and e["at"] > my_last and e["kind"] != "review:APPROVED"
    ]
    return item


def my_opinion(pr: dict, me: str):
    return next(
        (r for r in pr["latestOpinionatedReviews"]["nodes"] if r["author"] and r["author"]["login"] == me), None
    )


def add_engagement(item: dict, pr: dict, me: str, now):
    """Who moves next between you (comments/reviews) and the PR author (pushes/comments/reviews)."""
    mine = [e for e in human_activity(pr) if e["login"] == me]
    if not mine:
        item["engagement"] = None
        return
    last_mine = mine[-1]
    opinion = my_opinion(pr, me)
    approved_at = parse_ts(opinion["submittedAt"]) if opinion and opinion["state"] == "APPROVED" else None
    author_last = last_activity_of(pr, author_login(pr), code_only=True)
    since = approved_at or last_mine["at"]
    author_moved = author_last is not None and author_last > since
    if approved_at:
        ball = "you:re-review-after-approval" if author_moved else "merge"
    else:
        ball = "you:author-responded" if author_moved else "author"
    item["engagement"] = {
        "my_last": {"kind": last_mine["kind"], "at": iso(last_mine["at"]), "excerpt": excerpt(last_mine["body"])},
        "my_opinion": {"state": opinion["state"], "at": opinion["submittedAt"]} if opinion else None,
        "author_last_activity": iso(author_last),
        "ball": ball,
        "waiting_on_author_days": days_since(last_mine["at"], now) if ball == "author" else None,
        "approved_not_merged_days": days_since(approved_at, now) if ball == "merge" else None,
    }


def review_item(pr: dict, me: str, now) -> dict:
    item = base_item(pr, now)
    requests = [r["requestedReviewer"] for r in pr["reviewRequests"]["nodes"]]
    direct = any(r and r.get("login") == me for r in requests)
    teams = [r["slug"] for r in requests if r and r.get("__typename") == "Team"]
    item["via"] = "you" if direct else ("team:" + ",".join(teams) if teams else "unknown")
    wanted = {me} if direct else set(teams)
    asked = [
        parse_ts(e["createdAt"])
        for e in pr["timelineItems"]["nodes"]
        if e["__typename"] == "ReviewRequestedEvent"
        and e["requestedReviewer"]
        and (e["requestedReviewer"].get("login") or e["requestedReviewer"].get("slug")) in wanted
    ]
    requested_at = max(asked) if asked else parse_ts(pr["createdAt"])
    item["requested_at"] = iso(requested_at)
    item["requested_at_is_pr_creation"] = not asked
    item["waiting_days"] = days_since(requested_at, now)
    add_engagement(item, pr, me, now)
    if item["engagement"] and parse_ts(item["engagement"]["my_last"]["at"]) < requested_at:
        item["engagement"].update(ball="you:re-requested", waiting_on_author_days=None, approved_not_merged_days=None)
    return item


def engaged_item(pr: dict, me: str, now):
    item = base_item(pr, now)
    add_engagement(item, pr, me, now)
    return item if item["engagement"] else None


def assigned_item(pr: dict, me: str, now) -> dict:
    item = base_item(pr, now)
    assigned = [
        parse_ts(e["createdAt"])
        for e in pr["timelineItems"]["nodes"]
        if e["__typename"] == "AssignedEvent" and (e["assignee"] or {}).get("login") == me
    ]
    assigned_at = max(assigned) if assigned else parse_ts(pr["createdAt"])
    item["assigned_at"] = iso(assigned_at)
    item["assigned_days"] = days_since(assigned_at, now)
    add_engagement(item, pr, me, now)
    return item


def collect(me: str, scope: str, now) -> dict:
    base = f"is:pr is:open archived:false {scope}"
    searches = {
        "authored": search_prs(f"{base} author:{me}"),
        "review_requested": search_prs(f"{base} review-requested:{me}"),
        "engaged": search_prs(f"{base} reviewed-by:{me} -author:{me}")
        + search_prs(f"{base} commenter:{me} -author:{me}"),
        "assigned": search_prs(f"{base} assignee:{me}"),
    }
    build = {
        "authored": authored_item,
        "review_requested": review_item,
        "engaged": engaged_item,
        "assigned": assigned_item,
    }
    seen, out = set(), {}
    for bucket, prs in searches.items():
        items = []
        for pr in prs:
            if pr["url"] in seen:
                continue
            seen.add(pr["url"])
            item = build[bucket](pr, me, now)
            if item:
                item["blockers"] = blockers(item)
                item["merge_ready"] = not item["blockers"]
                items.append(item)
        out[bucket] = sorted(items, key=lambda i: -i["idle_days"])
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user", help="GitHub login to brief (default: the logged-in gh user)")
    parser.add_argument("--scope", default="org:openobserve", help="search qualifier, e.g. 'repo:openobserve/openobserve'")
    parser.add_argument("--stale-days", type=float, default=7)
    args = parser.parse_args()

    me = args.user or gh_graphql("query { viewer { login } }")["viewer"]["login"]
    now = datetime.now(timezone.utc)
    result = {"user": me, "scope": args.scope, "generated_at": iso(now), "stale_days": args.stale_days}
    result.update(collect(me, args.scope, now))
    json.dump(result, sys.stdout, ensure_ascii=False, indent=1)
    print()


if __name__ == "__main__":
    main()
