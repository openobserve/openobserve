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

//! The canonical webhook envelope (§5.2/§5.3).
//!
//! **This is a stable, versioned, documented contract.** Other systems parse
//! it. `version` is `1`; adding a key is backwards compatible, changing or
//! removing one is not and requires a version bump.
//!
//! Escaping is `serde_json`'s job here — values go in RAW and serialization
//! guarantees a parseable document. Entity-encoding them would corrupt the
//! data for the machine consumer.
//!
//! # Contract: `links[].url` is passed through UNFILTERED — deliberate
//!
//! Every human-facing renderer either substitutes a hostile URL scheme
//! ([`safe_url`], for email/SNS) or drops the link outright
//! ([`dispatchable_url`], for Slack/Teams/Discord/PagerDuty). This envelope
//! does NEITHER, for the same reason it does not entity-encode: rewriting a
//! URL to `#` would hand the consumer corrupted data where it expects the
//! authored value, and this is a versioned contract other systems parse.
//!
//! **The consumer owns presentation and MUST treat `links[].url` as
//! untrusted.** Save-time validation (`ContentSpec::validate`) rejects a
//! hostile scheme written literally into a template, but a URL assembled by
//! variable substitution at send time can still carry one here.
//!
//! [`safe_url`]: super::safe_url
//! [`dispatchable_url`]: super::dispatchable_url
//!
//! # Contract: an empty `links[].label` means "no label authored"
//!
//! `resolve` appends the alert URL as a link with an EMPTY label. That empty
//! string is carried through to this envelope VERBATIM and is part of the
//! contract: it means *the user authored no label; the consumer supplies its
//! own presentation*. It does not mean "blank label" and must not be rendered
//! as one.
//!
//! The human-facing formats (Slack, both Teams cards, Email) substitute a
//! display default ([`DEFAULT_LINK_LABEL`], currently `"View in OpenObserve"`) —
//! this envelope deliberately does NOT. Two reasons:
//!
//! * The label is i18n-seeded and user-editable (design §4.2), so baking the English literal into a
//!   versioned machine contract would leak English into non-English orgs' integration payloads.
//! * A consumer receiving the default label could not distinguish a label the user actually
//!   authored from one this renderer defaulted. The empty string is the unambiguous signal.
//!
//! [`DEFAULT_LINK_LABEL`]: super::DEFAULT_LINK_LABEL

use serde_json::{Map, Value, json};

use crate::alerts::notifications::{context::NotificationContext, resolve::RenderedContent};

pub fn render_webhook(c: &RenderedContent, ctx: &NotificationContext) -> Value {
    let fields: Map<String, Value> = c
        .fields
        .iter()
        .map(|(k, v)| (k.clone(), Value::String(v.clone())))
        .collect();

    // `label` is passed through VERBATIM — an empty one is a meaningful
    // signal, not a value to be defaulted. See this module's contract docs.
    let links: Vec<Value> = c
        .links
        .iter()
        .map(|(label, url)| json!({"label": label, "url": url}))
        .collect();

    json!({
        "version": 1,
        "title": c.title,
        "body_markdown": c.body_markdown,
        "fields": fields,
        "rows": ctx.rows,
        "links": links,
        "severity": ctx.level.map(|l| l.as_str()),
        // The stateless signed chart-render URL when this template enables
        // the chart; null otherwise (the key was reserved-null in Phase 1a,
        // so consumers could already rely on its shape).
        "chart_url": ctx.chart_url.as_deref().map(Value::from).unwrap_or(Value::Null),
        "context": context_object(ctx),
    })
}

/// Every variable a template could have referenced, as typed JSON.
///
/// §5.3: an empty scalar becomes `null`, NOT `""` — a machine consumer wants
/// typed absence it can test with `== null` rather than having to distinguish
/// "not set" from "set to the empty string".
pub fn context_object(ctx: &NotificationContext) -> Value {
    let mut out = Map::new();

    for (name, value) in crate::alerts::notifications::resolve::scalar_vars(ctx) {
        out.insert(name.to_string(), str_or_null(value));
    }

    // Row columns: the multi-value form, as arrays (the scalar `", "`-joined
    // form is a template convenience; a machine consumer wants the list).
    for (key, values) in &ctx.row_columns {
        out.entry(key.clone())
            .or_insert_with(|| Value::Array(values.iter().map(|v| json!(v)).collect()));
    }

    for (key, value) in &ctx.context_attributes {
        out.entry(key.clone()).or_insert_with(|| str_or_null(value));
    }

    for (key, value) in &ctx.metadata {
        out.entry(key.clone()).or_insert_with(|| str_or_null(value));
    }

    if let Some(labels) = &ctx.group_labels {
        for (name, value) in config::meta::alerts::grouping::group_template_vars(labels) {
            out.entry(name).or_insert_with(|| str_or_null(&value));
        }
    }

    Value::Object(out)
}

fn str_or_null(s: &str) -> Value {
    if s.is_empty() {
        Value::Null
    } else {
        Value::String(s.to_string())
    }
}
