"""Records ``helpers/o2ai_confirmations.json``: o2-ai's own ``confirmation_required`` frames.

Run from an o2-ai checkout::

    uv run python <openobserve>/tests/api-testing/helpers/recorders/record_o2ai_confirmations.py \
        <openobserve>/tests/api-testing/helpers/o2ai_confirmations.json
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path.cwd()))

from src.opencode.events import _handle_permission_asked, build_delete_confirmation_event  # noqa: E402
from src.server.constants import EventType  # noqa: E402


def main(out: str) -> None:
    # src/agent/clis/handler.py _await_confirmation builds this dict inline, so it is rebuilt the same way.
    tool_name, command = "kubectl-prod", "rollout restart deployment/checkout -n prod-eu"
    cli = {"type": EventType.CONFIRMATION_REQUIRED, "tool": tool_name, "args": {"command": command},
           "message": f"The assistant wants to run: {tool_name} {command}".strip()}
    delete = build_delete_confirmation_event([{"resource_type": "dashboard", "name": "Checkout", "id": "d1", "params": {}}])
    lines = _handle_permission_asked({"id": "per_1", "sessionID": "ses_1", "permission": "bash",
                                      "patterns": ["kubectl get pods"]}, SimpleNamespace(pending_permission=None))
    doc = {
        "_comment": "o2-ai confirmation_required frames: cli = src/agent/clis/handler.py _await_confirmation's dict "
        "(built the same way), o2_delete = src/opencode/events.py build_delete_confirmation_event, permission = "
        "events._handle_permission_asked. Re-record with tests/api-testing/helpers/recorders/"
        "record_o2ai_confirmations.py.",
        "cli": json.loads(json.dumps(cli, default=str)),
        "o2_delete": delete,
        "permission": json.loads(lines[0][len("data: "):].strip()),
    }
    Path(out).write_text(json.dumps(doc) + "\n")


if __name__ == "__main__":
    main(sys.argv[1])
