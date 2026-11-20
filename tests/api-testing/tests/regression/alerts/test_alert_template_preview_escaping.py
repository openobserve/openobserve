"""o2-enterprise#3431 B40, B9, B10 (openobserve#16705): template previews render links and operators safely per channel."""
from __future__ import annotations

from support.client import OpenObserveClient

RENDER_DRAFT = {
    "title": "{alert_operator} 80 CPU on {alert_name}",
    "body": "Usage >= 80 at {alert_trigger_time_str} [bad](javascript:alert(1)) [good](https://example.com/runbook)",
    "fields": [{"label": ">= 80 load", "value": "{alert_operator} 80"}],
}


def _preview(client: OpenObserveClient, channel: str) -> dict:
    resp = client.post(
        "alerts/templates/preview", json={"definition": RENDER_DRAFT, "channel": channel}, raise_for_status=False
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_preview_body_links_drop_unsafe_schemes(client: OpenObserveClient):
    """B40: a javascript: link in the body renders as '#', a https link stays."""
    body = _preview(client, "email")
    for html in (body["preview_model"]["body_html"], body["payload"]["html"]):
        assert "javascript:" not in html, html
        assert '<a href="#">bad</a>' in html, html
        assert '<a href="https://example.com/runbook">good</a>' in html, html


def test_plain_text_platform_bodies_carry_no_markdown_escapes(client: OpenObserveClient):
    """B9: PagerDuty and Opsgenie get raw values, not `2026\\-08\\-01T10\\:10`."""
    pagerduty = _preview(client, "pagerduty")["payload"]["payload"]["custom_details"]["body"]
    opsgenie = _preview(client, "opsgenie")["payload"]["description"]
    for text in (pagerduty, opsgenie):
        assert text.startswith("Usage >= 80 at 20"), text
        assert "\\" not in text, text


def test_teams_adaptive_card_keeps_operators_as_written(client: OpenObserveClient):
    """B10: the card no longer parses raw surfaces as markdown, so `>= 80` keeps its `>`."""
    card = _preview(client, "teams_adaptivecard")["payload"]["attachments"][0]["content"]
    title = card["body"][0]["text"]
    facts = next(block["facts"] for block in card["body"] if block["type"] == "FactSet")
    assert title == ">= 80 CPU on Sample CPU alert", title
    assert facts == [{"title": ">= 80 load", "value": ">= 80"}], facts
