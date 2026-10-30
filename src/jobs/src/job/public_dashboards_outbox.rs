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

//! Resends public dashboard link rows whose super-cluster emit failed.

use config::{cluster::LOCAL_NODE, spawn_pausable_job};
use openobserve_core::public_dashboards::replication;

/// Runs on compactors, beside the super-cluster consumers; a duplicate send is applied once.
pub fn run() {
    if !LOCAL_NODE.is_compactor() {
        return;
    }
    spawn_pausable_job!(
        "public_dashboards_outbox",
        replication::OUTBOX_RETRY_SECS,
        {
            replication::retry_outbox().await;
        },
        pause_if: !replication::enabled()
    );
}
