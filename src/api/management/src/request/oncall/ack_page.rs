// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! The plain HTML an emailed acknowledge link opens: on a phone, at night, with no session.

use config::meta::{
    alerts::priority::AlertPriority,
    oncall::{Response as Page, ResponseState, Team},
};

/// Every page leads with it, so a link opened cold says whose page it is.
const PRODUCT: &str = "OpenObserve";

/// Shown when a record has no title of its own.
const UNTITLED: &str = "On-call page";

/// What every page says about the record a verified link points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PageFacts<'a> {
    pub title: &'a str,
    pub team: Option<&'a str>,
    pub priority: Option<&'a str>,
    /// The team's zone, so a stop time reads in the hours the team works in.
    pub timezone: &'a str,
}

impl<'a> PageFacts<'a> {
    /// The facts of `record`, named with its team when the team could be read. [pure] [no-fail]
    pub fn of(record: &'a Page, team: Option<&'a Team>) -> Self {
        Self {
            title: record.title.as_deref().unwrap_or(UNTITLED),
            team: team.map(|t| t.name.as_str()),
            priority: AlertPriority::from_i32(record.priority).map(|p| p.as_str()),
            timezone: team.map_or("UTC", |t| t.timezone.as_str()),
        }
    }
}

/// Where a used link left the record it points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AckOutcome {
    /// This click took the page, at this instant.
    AckedNow {
        at: i64,
        /// When the ladder had already run out before this click, so the click stopped nothing.
        ladder_finished_at: Option<i64>,
    },
    AlreadyAcked {
        by: Option<String>,
    },
    Resolved,
    /// Still open with nobody on it, including after an ack that failed.
    NotAcked,
}

impl AckOutcome {
    /// Where `record` stands for `clicker`, given whether their ack just won. [pure] [no-fail]
    pub fn of(record: &Page, clicker: &str, this_click: bool) -> Self {
        match record.state {
            ResponseState::Resolved => Self::Resolved,
            ResponseState::Triggered | ResponseState::Triaged => Self::NotAcked,
            ResponseState::Acknowledged => match (record.acked_by.as_deref(), record.acked_at) {
                (Some(by), Some(at)) if this_click && by.eq_ignore_ascii_case(clicker) => {
                    Self::AckedNow {
                        at,
                        ladder_finished_at: record.exhausted_at.filter(|&e| e <= at),
                    }
                }
                _ => Self::AlreadyAcked {
                    by: record.acked_by.clone(),
                },
            },
        }
    }
}

/// The page a GET shows: what the link is for and the one button that acknowledges. [pure]
pub fn confirm_html(org_id: &str, token: &str, facts: &PageFacts) -> String {
    shell(&format!(
        r#"<h1>{title}</h1>
{facts}
<p class="muted">Acknowledging tells the others you have this. The escalation stops.</p>
<form method="post" action="/api/v2/{org}/oncall/ack">
<input type="hidden" name="token" value="{token}">
<button type="submit">Acknowledge</button>
</form>"#,
        title = esc(facts.title),
        facts = facts_line(facts),
        org = esc(org_id),
        token = esc(token),
    ))
}

/// The page a GET of a verified link shows: the button only while nobody has the page. [pure]
pub fn get_html(
    org_id: &str,
    token: &str,
    facts: &PageFacts,
    record: &Page,
    clicker: &str,
    open_url: &str,
) -> String {
    match AckOutcome::of(record, clicker, false) {
        AckOutcome::NotAcked => confirm_html(org_id, token, facts),
        settled => outcome_html(facts, &settled, open_url),
    }
}

/// The page a POST lands on, saying where the record now stands. [pure]
pub fn outcome_html(facts: &PageFacts, outcome: &AckOutcome, open_url: &str) -> String {
    let (heading, detail) = match outcome {
        AckOutcome::AckedNow {
            ladder_finished_at: Some(finished),
            ..
        } => (
            "Acknowledged".to_string(),
            format!(
                "The ladder had already finished at {}.",
                clock(*finished, facts.timezone)
            ),
        ),
        AckOutcome::AckedNow { at, .. } => (
            "Acknowledged".to_string(),
            format!("Escalation stopped at {}.", clock(*at, facts.timezone)),
        ),
        AckOutcome::AlreadyAcked { by: Some(by) } => (
            format!("Already acknowledged by {by}"),
            "The escalation has stopped.".to_string(),
        ),
        AckOutcome::AlreadyAcked { by: None } => (
            "Already acknowledged".to_string(),
            "The escalation has stopped.".to_string(),
        ),
        AckOutcome::Resolved => (
            "This page is resolved".to_string(),
            "Nothing is escalating.".to_string(),
        ),
        AckOutcome::NotAcked => (
            "Not acknowledged yet.".to_string(),
            "Nobody has this page. Open it to take it.".to_string(),
        ),
    };
    shell(&format!(
        r#"<h1>{heading}</h1>
<p>{detail}</p>
<p class="title">{title}</p>
{facts}
<p><a href="{url}">Open in {PRODUCT}</a></p>"#,
        heading = esc(&heading),
        detail = esc(&detail),
        title = esc(facts.title),
        facts = facts_line(facts),
        url = esc(open_url),
    ))
}

/// The page an untrusted link lands on; it is given no record, so it can show none. [pure]
pub fn broken_link_html(reason: &str, pages_url: &str) -> String {
    shell(&format!(
        r#"<h1>This link no longer works</h1>
<p class="muted">{reason}</p>
<p><a href="{url}">Go to Pages</a></p>"#,
        reason = esc(&as_sentence(reason)),
        url = esc(pages_url),
    ))
}

/// Team and priority on one line, or nothing when neither is known.
fn facts_line(facts: &PageFacts) -> String {
    let parts: Vec<&str> = [facts.team, facts.priority].into_iter().flatten().collect();
    if parts.is_empty() {
        return String::new();
    }
    format!(r#"<p class="muted">{}</p>"#, esc(&parts.join(" · ")))
}

/// `HH:MM` of `at` in `timezone`, or in UTC (and saying so) when the zone cannot be read.
fn clock(at: i64, timezone: &str) -> String {
    let utc = chrono::DateTime::from_timestamp_micros(at).unwrap_or_default();
    match config::utils::time::parse_timezone_to_offset_at(timezone, at)
        .and_then(|secs| chrono::FixedOffset::east_opt(secs as i32))
    {
        Some(offset) => utc.with_timezone(&offset).format("%H:%M").to_string(),
        None => utc.format("%H:%M UTC").to_string(),
    }
}

/// The error strings are lower-case fragments; a page shows them as a sentence.
fn as_sentence(reason: &str) -> String {
    let mut chars = reason.trim().chars();
    let Some(first) = chars.next() else {
        return String::new();
    };
    let mut out: String = first.to_uppercase().chain(chars).collect();
    if !out.ends_with('.') {
        out.push('.');
    }
    out
}

fn esc(v: &str) -> String {
    v.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// No JavaScript and inline CSS only: mail clients open it in a bare in-app browser.
fn shell(body: &str) -> String {
    format!(
        r#"<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>{PRODUCT} on-call</title>
<style>
body{{font-family:system-ui,sans-serif;margin:0;padding:2rem 1rem;text-align:center;background:#fff;color:#111827}}
main{{max-width:32rem;margin:0 auto}}
h1{{font-size:1.25rem}}
h1,p{{overflow-wrap:anywhere}}
.product{{font-weight:600;color:#4f46e5}}
.title{{font-weight:600}}
.muted{{color:#555}}
a{{color:#4f46e5}}
button{{font-size:1rem;padding:0.75rem 1.5rem;border-radius:0.25rem;border:0;background:#4f46e5;color:#fff}}
@media (prefers-color-scheme: dark){{
body{{background:#111827;color:#f3f4f6}}
.muted{{color:#9ca3af}}
.product,a{{color:#a5b4fc}}
}}
</style></head>
<body><main>
<p class="product">{PRODUCT}</p>
{body}
</main></body></html>"#
    )
}

#[cfg(test)]
mod tests {
    use config::meta::oncall::{ResponderRole, SubjectRef, SubjectType};

    use super::*;

    fn page(state: ResponseState, acked_by: Option<&str>, acked_at: Option<i64>) -> Page {
        Page {
            id: "r1".into(),
            org_id: "default".into(),
            subject: SubjectRef::new(SubjectType::Alert, "a1", 1),
            team_id: Some("team_1".into()),
            title: Some("Checkout <5xx> spike".into()),
            cause: None,
            cause_note: None,
            snoozed_until: None,
            ladder_anchor: None,
            ladder_run: None,
            priority: 2,
            responder_role: ResponderRole::Owner,
            exhausted_at: None,
            origin_response_id: None,
            state,
            opened_at: 0,
            acked_by: acked_by.map(str::to_string),
            acked_at,
            closed_at: None,
            incident_id: None,
            updated_at: 0,
        }
    }

    /// A second click shows where the page stands, never an error.
    #[test]
    fn test_outcome_follows_the_record_and_the_click() {
        let at = 1_700_000_000_000_000;
        let cases = [
            (
                page(ResponseState::Acknowledged, Some("ana@o2.ai"), Some(at)),
                true,
                AckOutcome::AckedNow {
                    at,
                    ladder_finished_at: None,
                },
            ),
            (
                page(ResponseState::Acknowledged, Some("ana@o2.ai"), Some(at)),
                false,
                AckOutcome::AlreadyAcked {
                    by: Some("ana@o2.ai".into()),
                },
            ),
            (
                page(ResponseState::Acknowledged, Some("bob@o2.ai"), Some(at)),
                true,
                AckOutcome::AlreadyAcked {
                    by: Some("bob@o2.ai".into()),
                },
            ),
            (
                page(ResponseState::Resolved, None, None),
                true,
                AckOutcome::Resolved,
            ),
            (
                page(ResponseState::Triggered, None, None),
                false,
                AckOutcome::NotAcked,
            ),
        ];
        for (record, this_click, want) in cases {
            assert_eq!(AckOutcome::of(&record, "ana@o2.ai", this_click), want);
        }
    }

    /// A ladder that finished before the click is not stopped by it, so the page says when it
    /// finished.
    #[test]
    fn test_an_ack_after_the_ladder_finished_says_when_it_finished() {
        let at = 1_700_000_000_000_000;
        let finished = at - 50 * 60 * 1_000_000;
        let mut record = page(ResponseState::Acknowledged, Some("ana@o2.ai"), Some(at));
        record.exhausted_at = Some(finished);
        let outcome = AckOutcome::of(&record, "ana@o2.ai", true);
        assert_eq!(
            outcome,
            AckOutcome::AckedNow {
                at,
                ladder_finished_at: Some(finished)
            }
        );
        let facts = PageFacts {
            timezone: "UTC",
            ..PageFacts::of(&record, None)
        };
        let html = outcome_html(&facts, &outcome, "https://o2/r1");
        assert!(html.contains("The ladder had already finished at 21:23."));
        assert!(!html.contains("Escalation stopped"));
    }

    /// A failed ack shows the record as it stands, never a success.
    #[test]
    fn test_a_failed_ack_never_reads_as_success() {
        let record = page(ResponseState::Triggered, None, None);
        let outcome = AckOutcome::of(&record, "ana@o2.ai", false);
        assert_eq!(outcome, AckOutcome::NotAcked);
        let html = outcome_html(&PageFacts::of(&record, None), &outcome, "https://o2/r1");
        assert!(html.contains("<h1>Not acknowledged yet.</h1>"));
        assert!(html.contains("Open in OpenObserve"));
        assert!(!html.contains("Escalation stopped"));
    }

    /// The landing page says when escalation stopped, in the team's hours, and links in.
    #[test]
    fn test_an_acknowledged_page_says_when_escalation_stopped() {
        let record = page(ResponseState::Acknowledged, None, None);
        let facts = PageFacts {
            team: Some("Platform SRE"),
            timezone: "Asia/Kolkata",
            ..PageFacts::of(&record, None)
        };
        // 2023-11-14 22:13:20 UTC is 03:43 in Kolkata.
        let html = outcome_html(
            &facts,
            &AckOutcome::AckedNow {
                at: 1_700_000_000_000_000,
                ladder_finished_at: None,
            },
            "https://o2.example/web/oncall/responses/r1?org_identifier=default",
        );
        for want in [
            "OpenObserve",
            "<h1>Acknowledged</h1>",
            "Escalation stopped at 03:43.",
            "Checkout &lt;5xx&gt; spike",
            "Platform SRE · P2",
            "Open in OpenObserve",
            "overflow-wrap:anywhere",
            "prefers-color-scheme: dark",
        ] {
            assert!(html.contains(want), "missing `{want}`");
        }
    }

    /// Opening a link to a page somebody already has shows its state, not the button.
    #[test]
    fn test_a_get_shows_the_button_only_while_nobody_has_the_page() {
        let at = 1_700_000_000_000_000;
        let cases = [
            (
                page(ResponseState::Acknowledged, Some("bob@o2.ai"), Some(at)),
                Some("Already acknowledged by bob@o2.ai"),
            ),
            (
                page(ResponseState::Acknowledged, Some("ana@o2.ai"), Some(at)),
                Some("Already acknowledged by ana@o2.ai"),
            ),
            (
                page(ResponseState::Resolved, None, None),
                Some("This page is resolved"),
            ),
            (page(ResponseState::Triggered, None, None), None),
        ];
        for (record, settled) in cases {
            let facts = PageFacts::of(&record, None);
            let html = get_html(
                "default",
                "t.k",
                &facts,
                &record,
                "ana@o2.ai",
                "https://o2/r1",
            );
            match settled {
                Some(heading) => {
                    assert!(html.contains(heading), "missing `{heading}`");
                    assert!(
                        !html.contains("<form"),
                        "{heading}: no button once the page is taken"
                    );
                    assert!(html.contains("Open in OpenObserve"));
                }
                None => assert!(html.contains(r#"action="/api/v2/default/oncall/ack""#)),
            }
        }
    }

    /// The button page names the product, the page, its team and priority before a press.
    #[test]
    fn test_the_confirm_page_names_the_page_and_posts_the_token() {
        let record = page(ResponseState::Triggered, None, None);
        let html = confirm_html("default", "t.k", &PageFacts::of(&record, None));
        for want in [
            "OpenObserve",
            "<h1>Checkout &lt;5xx&gt; spike</h1>",
            "P2",
            r#"action="/api/v2/default/oncall/ack""#,
            r#"value="t.k""#,
        ] {
            assert!(html.contains(want), "missing `{want}`");
        }
    }

    /// An untrusted link gets a sentence and a way in, and no record at all.
    #[test]
    fn test_a_broken_link_says_why_and_offers_pages() {
        let html = broken_link_html("acknowledgement link has expired", "https://o2/pages");
        assert!(html.contains("This link no longer works"));
        assert!(html.contains("Acknowledgement link has expired."));
        assert!(html.contains(r#"href="https://o2/pages""#));
    }
}
