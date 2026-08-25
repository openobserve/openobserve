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

//! Check CRUD, secret handling, run listing, locations and probe tokens.
//!
//! Split out of one 2 100-line file on the way over: it was doing four
//! unrelated jobs and the only thing they shared was a database handle.
//!
//! The private-VPC-agent pieces did not come with it. `create_location`'s
//! private arm and the install command a private location hands back are
//! `#[cfg(feature = "enterprise")]` calls into `o2_enterprise`; an OSS build
//! refuses to create a private location rather than creating one that no agent
//! can ever serve.

use std::collections::HashMap;

use config::meta::{
    folder::{DEFAULT_FOLDER, Folder, FolderType},
    synthetics::{
        ListSyntheticsParams, Synthetic, SyntheticAuth, SyntheticListItem, SyntheticListResponse,
        for_each_string_at_path, take_strings_at_path,
    },
};
use infra::{
    db::ORM_CLIENT,
    table::{
        cipher, folders, synthetics_agents, synthetics_checks, synthetics_jobs,
        synthetics_locations, synthetics_runs,
    },
};
// ── OpenFGA ───────────────────────────────────────────────────────────────────
//
// OpenFGA is an enterprise capability — `o2_openfga` is an optional dependency
// of every OSS crate that touches it, enabled by the `enterprise` feature. The
// shims below keep the call sites identical in both builds rather than dusting
// `#[cfg]` through the middle of nine functions, and `ofga_enabled()` is a
// compile-time `false` in OSS, so nothing downstream of it is ever reached.
#[cfg(feature = "enterprise")]
pub(crate) use o2_openfga::authorizer::authz::{
    get_ofga_type, remove_ownership, remove_parent_relation, set_ownership, set_parent_relation,
};
use serde::{Deserialize, Serialize};

/// Whether ownership tuples need maintaining at all.
pub(crate) fn ofga_enabled() -> bool {
    #[cfg(feature = "enterprise")]
    {
        o2_openfga::config::get_config().enabled
    }
    #[cfg(not(feature = "enterprise"))]
    {
        false
    }
}

#[cfg(not(feature = "enterprise"))]
pub(crate) fn get_ofga_type(_key: &str) -> String {
    String::new()
}

#[cfg(not(feature = "enterprise"))]
pub(crate) async fn set_ownership(_org: &str, _obj: &str, _parent: &str, _parent_type: &str) {}

#[cfg(not(feature = "enterprise"))]
pub(crate) async fn remove_ownership(_org: &str, _obj: &str, _parent: &str, _parent_type: &str) {}

#[cfg(not(feature = "enterprise"))]
pub(crate) async fn set_parent_relation(_id: &str, _ty: &str, _parent: &str, _parent_ty: &str) {}

#[cfg(not(feature = "enterprise"))]
pub(crate) async fn remove_parent_relation(_id: &str, _ty: &str, _parent: &str, _parent_ty: &str) {}

pub mod checks;
pub mod crypto;
pub mod locations;
pub mod runs;
pub mod tokens;

pub use checks::*;
pub use crypto::*;
pub use locations::*;
pub use runs::*;
pub use tokens::*;

// ── DB helper ─────────────────────────────────────────────────────────────────

fn db() -> anyhow::Result<&'static sea_orm::DatabaseConnection> {
    ORM_CLIENT
        .get()
        .ok_or_else(|| anyhow::anyhow!("Database not initialized"))
}

/// Mints this org's default synthetics folder, in THIS region only.
///
/// It deliberately does not broadcast, and broadcasting would not help.
/// `folders::put` upserts on `(org, folder_id, type)` and keeps the row it
/// finds, so a `FolderMessage::Create` carrying this KSUID is *ignored* by any
/// region that has already lazily minted its own `default` — no error, no
/// convergence, and the two primary keys stay different. Which is precisely the
/// case that matters, since this folder is created on demand in whichever
/// region a user first happens to save a check.
///
/// So no cross-region reference may name a folder by primary key: replicated
/// checks carry the folder's public SLUG, and the receiving region resolves it
/// against — or creates it in — its own table.
async fn create_default_synthetics_folder(org_id: &str) -> anyhow::Result<()> {
    let folder = Folder {
        folder_id: DEFAULT_FOLDER.to_owned(),
        name: "default".to_owned(),
        description: "default".to_owned(),
        icon: None,
    };
    folders::put(org_id, None, folder, FolderType::Synthetics)
        .await
        .map_err(|e| anyhow::anyhow!(e.to_string()))?;
    // Register the folder in OpenFGA — writes owningOrg + selfParent so a
    // Type-level "Synthetic Folders" grant cascades to checks in this folder.
    // `folders::put` is the raw table write (no FGA); the OSS folders API goes
    // through `db::folders::save_folder` which does this, but that crate isn't
    // a dep here, so call set_ownership directly (same effect). Mirrors how
    // `create_default_alerts_folder` registers afolder:default.
    if ofga_enabled() {
        let obj = format!("{}:{}", get_ofga_type("synthetic_folder"), DEFAULT_FOLDER);
        set_ownership(org_id, &obj, "", "").await;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    /// Every publish helper on this queue: checks and the two config tables.
    /// Assembled at runtime so the searches below cannot match their own text.
    fn any_publish_prefix() -> String {
        ["queue", "synthetics_"].join("::")
    }

    /// Source with every whitespace character removed, so a guard counts the
    /// same whether rustfmt kept it on one line or wrapped it. The OSS
    /// `get_config()` path is long enough that rustfmt always wraps it, and a
    /// test that matched the formatted text would read zero guards as "nothing
    /// to guard".
    fn squeezed(source: &str) -> String {
        source.chars().filter(|c| !c.is_whitespace()).collect()
    }

    /// Spec test 5, following the file it used to live in. With super cluster
    /// off, behaviour must be byte-identical to before that feature: no queue
    /// lookup, no publish. The guard is easy to forget on the next call site,
    /// so it is counted rather than eyeballed — one config read per publish.
    ///
    /// Walks the split rather than one file. `service.rs` became five modules
    /// on the way into OSS, and counting only one of them would let a publish
    /// added to any of the other four through unguarded.
    #[test]
    fn every_broadcast_is_gated_on_super_cluster_being_enabled() {
        let any = any_publish_prefix();
        // Assembled at runtime, or this line would count as a guard itself.
        let guard = ["super_cluster", "enabled"].join(".");

        let source: String = [
            include_str!("checks.rs"),
            include_str!("crypto.rs"),
            include_str!("locations.rs"),
            include_str!("runs.rs"),
            include_str!("tokens.rs"),
        ]
        .map(squeezed)
        .join("");

        let publishes = source.matches(&any).count();
        let guards = source.matches(&guard).count();

        assert_eq!(
            publishes, 12,
            "expected 6 check publishes (create/update/delete/set_enabled/bulk-delete/move), 3 \
             location publishes (create/update/delete) and 3 probe-token publishes \
             (create/rotate/set_enabled)"
        );
        // `location_entry` reads the same flag without publishing anything — it
        // decides whether a location's missing agent rows are evidence or just
        // this region's blind spot. Counted explicitly so the guard-per-publish
        // assertion stays exact.
        const NON_PUBLISH_READS: usize = 1;
        assert_eq!(
            guards,
            publishes + NON_PUBLISH_READS,
            "every publish needs its own super-cluster guard"
        );
    }

    /// `run_synthetic_now` only resets `next_run_at`, which is region-local
    /// scheduler state. It sits next to code that does publish, so it is
    /// checked on its own — and on the raw source, because this one slices a
    /// function body out by its newlines.
    #[test]
    fn run_synthetic_now_does_not_publish() {
        let checks = include_str!("checks.rs");
        let start = checks
            .find("pub async fn run_synthetic_now")
            .expect("run_synthetic_now moved");
        let body = &checks[start..];
        let end = body[1..]
            .find("\npub ")
            .map(|i| i + 1)
            .unwrap_or(body.len());
        assert!(
            !body[..end].contains(&any_publish_prefix()),
            "run_synthetic_now resets region-local state only"
        );
    }
}
