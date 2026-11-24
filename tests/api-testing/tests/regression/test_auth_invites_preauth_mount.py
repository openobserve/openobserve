"""`/auth/invites` is no longer served outside the auth middleware  [#16363].

The invites routes were also mounted under `/auth`, which skips authentication, so a request carrying only a
forged `user_id` header reached the invite handlers. The fix drops that mount; `/api/invites` is the one left.
"""

import os

import pytest
import requests

from support.client import OpenObserveClient

FORGED_IDENTITY = {"user_id": os.environ.get("ZO_ROOT_USER_EMAIL", "root@example.com")}


@pytest.mark.parametrize(
    ("method", "path"),
    [("GET", "auth/invites"), ("DELETE", "auth/invites/forged-token")],
    ids=["list", "decline"],
)
@pytest.mark.parametrize("headers", [{}, FORGED_IDENTITY], ids=["no-header", "forged-user-id"])
def test_auth_invites_is_not_served_without_credentials(
    client: OpenObserveClient, method: str, path: str, headers: dict
):
    resp = requests.request(method, client.url(path, prefix=""), headers=headers, timeout=30)
    # The fix only unmounts the route: the server's unmatched-path layer answers 401, the bare router 404.
    assert resp.status_code in (401, 404), f"{method} /{path} {headers}: {resp.status_code} {resp.text[:200]}"
    if resp.status_code == 401:
        assert resp.json().get("message") == "Unauthorized Access", resp.text[:200]


def test_api_invites_needs_credentials_and_still_answers_a_signed_in_user(client: OpenObserveClient):
    """`/api/invites` is refused without auth and handled with it (cloud-only, so 403 here)."""
    anonymous = requests.get(client.url("api/invites", prefix=""), headers=FORGED_IDENTITY, timeout=30)
    assert anonymous.status_code == 401, f"{anonymous.status_code} {anonymous.text[:200]}"

    signed_in = client.get("api/invites", prefix="")
    assert (signed_in.status_code, signed_in.json()) == (403, "Not Supported"), signed_in.text[:200]
