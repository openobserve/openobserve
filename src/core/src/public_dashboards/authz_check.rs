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

//! The 15-minute authorization deadline on every served file, against its manifest (4.3 step 6).

use std::{sync::Arc, time::Duration};

use config::{
    get_config,
    meta::public_dashboards::{NotAvailableReason, ResultBody, WithheldPanel},
};
use infra::table::entity::public_dashboards::Model as PublicDashboard;

use super::{
    AuthorizerProbe,
    flight::{Built, Failure, Flights, Kind, Outcome, Start, Wait},
    materialize::Engine,
    store::{self, Header, ManifestPanel, PanelOutcome, Stored},
};

pub const AUTH_DEADLINE_MICROS: i64 = 15 * 60 * 1_000_000;

/// What the deadline check left a reader to serve.
#[derive(Debug)]
pub enum Checked {
    /// The rewritten header; serve from the file under it.
    Passed(Header),
    /// The file is gone; follow the miss path.
    Missing,
    /// The rewrite failed or a build holds the key: serve this masked result once.
    Once(Built),
    /// Membership or authorization could not be read: fail closed with 503.
    Unavailable,
    /// The publisher left: the link is paused and its file evicted.
    NotServable,
}

/// Runs the check under the key's flight; while a build holds the key, checks without a rewrite.
pub async fn under_flight(
    engine: &'static dyn Engine,
    flights: &'static Flights,
    key: &str,
    link: &PublicDashboard,
    now: i64,
) -> Checked {
    let timeout = Duration::from_secs(u64::from(get_config().public_dashboards.query_timeout_secs));
    let (task_key, task_link) = (key.to_string(), link.clone());
    let start = flights.start(key, &link.org_id, Kind::AuthCheck, move |_| async move {
        check(engine, &task_key, &task_link, now).await
    });
    match start {
        Start::Leader(f) => from_wait(f.wait(timeout, u32::MAX).await),
        Start::Follower(f) if f.kind == Kind::AuthCheck => {
            from_wait(f.wait(timeout, u32::MAX).await)
        }
        Start::Follower(_) | Start::Capacity => {
            let Some(stored) = read_own(key, link).await else {
                return Checked::Missing;
            };
            match recheck(engine, link, &stored, now).await {
                Ok(header) => Checked::Once(Built {
                    body: decode_body(&stored),
                    header,
                    stored: false,
                }),
                Err(Failure::NotServable) => {
                    store::evict(key).await;
                    Checked::NotServable
                }
                Err(_) => Checked::Unavailable,
            }
        }
    }
}

/// Rechecks and rewrites the header; a failed rewrite evicts the file and serves the result once.
pub async fn check(
    engine: &'static dyn Engine,
    key: &str,
    link: &PublicDashboard,
    now: i64,
) -> Outcome {
    let Some(stored) = read_own(key, link).await else {
        return Ok(Built {
            header: Header::default(),
            body: None,
            stored: true,
        });
    };
    let mut header = match recheck(engine, link, &stored, now).await {
        Ok(header) => header,
        Err(Failure::NotServable) => {
            store::evict(key).await;
            return Err(Failure::NotServable);
        }
        Err(e) => return Err(e),
    };
    match store::write_raw(key, &mut header, &stored.manifest, stored.body_zst.clone()).await {
        Ok(_) => Ok(Built {
            header,
            body: None,
            stored: true,
        }),
        Err(e) => {
            log::error!("public dashboard file {key} header rewrite failed, evicting: {e}");
            store::evict(key).await;
            Ok(Built {
                body: decode_body(&stored),
                header,
                stored: false,
            })
        }
    }
}

/// Membership, then each panel re-authorized from its manifest; a restored panel makes it due.
pub async fn recheck(
    engine: &'static dyn Engine,
    link: &PublicDashboard,
    stored: &Stored,
    now: i64,
) -> Result<Header, Failure> {
    let (org, publisher) = (link.org_id.as_str(), link.published_by.as_str());
    match engine.is_member(org, publisher).await {
        Ok(true) => {}
        Ok(false) => {
            engine.pause_departed(link).await;
            return Err(Failure::NotServable);
        }
        Err(e) => {
            log::error!("public dashboard membership read failed: {e}");
            return Err(Failure::Unavailable);
        }
    }
    let probe = AuthorizerProbe::default();
    let mut header = stored.header.clone();
    let mut restored = false;
    for (id, panel) in &stored.manifest.panels {
        let withheld = header.is_withheld(id);
        let served = matches!(
            panel.outcome,
            PanelOutcome::Fresh
                | PanelOutcome::Retained
                | PanelOutcome::Partial
                | PanelOutcome::Truncated
        );
        // A dependency without streams came from an unparseable values query: nothing to prove.
        let provable = !panel.unparsed
            && (!panel.sources.is_empty() || !panel.values_dependencies.is_empty())
            && panel
                .values_dependencies
                .iter()
                .all(|d| !d.sources.is_empty());
        if !(served && !withheld) && !(withheld && provable) {
            continue;
        }
        let allowed = engine
            .authorize(org, publisher, panel, &probe)
            .await
            .map_err(|e| {
                log::error!("public dashboard authorization failed: {e}");
                Failure::Unavailable
            })?;
        match (allowed, withheld) {
            (false, false) => header.withheld_panels.push(WithheldPanel {
                panel_id: id.clone(),
                reason: NotAvailableReason::Unauthorized,
            }),
            (true, true) => {
                header.withheld_panels.retain(|w| &w.panel_id != id);
                restored = true;
            }
            _ => {}
        }
    }
    restored |= recheck_variables(engine, org, publisher, stored, &mut header, &probe).await?;
    if restored {
        header.incomplete_count = header.incomplete_count.max(1);
        header.next_retry_at = Some(now);
    }
    header.auth_checked_at = now;
    Ok(header)
}

/// Nulls a variable whose values query reads a stream the publisher lost; true when one returns.
async fn recheck_variables(
    engine: &'static dyn Engine,
    org: &str,
    publisher: &str,
    stored: &Stored,
    header: &mut Header,
    probe: &AuthorizerProbe,
) -> Result<bool, Failure> {
    let mut restored = false;
    for dep in &stored.manifest.variables {
        let dep_panel = ManifestPanel {
            values_dependencies: vec![dep.clone()],
            ..Default::default()
        };
        let allowed = engine
            .authorize(org, publisher, &dep_panel, probe)
            .await
            .map_err(|e| {
                log::error!("public dashboard authorization failed: {e}");
                Failure::Unavailable
            })?;
        let withheld = header.withheld_variables.contains(&dep.variable);
        if !allowed && !withheld {
            header.withheld_variables.push(dep.variable.clone());
        } else if allowed && withheld {
            header.withheld_variables.retain(|v| v != &dep.variable);
            restored = true;
        }
    }
    Ok(restored)
}

/// The file only when the link's current publisher built it; any other publisher's file is evicted.
async fn read_own(key: &str, link: &PublicDashboard) -> Option<Stored> {
    let stored = store::read(key).await?;
    if stored.header.published_by != link.published_by {
        store::evict(key).await;
        return None;
    }
    Some(stored)
}

fn from_wait(wait: Wait) -> Checked {
    let Wait::Done(outcome) = wait else {
        return Checked::Unavailable;
    };
    match *outcome {
        Ok(built) if !built.stored => Checked::Once(built),
        Ok(built) if built.header.has_body() => Checked::Passed(built.header),
        Ok(_) => Checked::Missing,
        Err(Failure::NotServable) => Checked::NotServable,
        Err(_) => Checked::Unavailable,
    }
}

fn decode_body(stored: &Stored) -> Option<Arc<ResultBody>> {
    let json = store::decompress_body(&stored.body_zst).ok()?;
    serde_json::from_slice(&json).ok().map(Arc::new)
}
