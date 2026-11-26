// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

use config::meta::alerts::what_changed::WhatChanged;
use openobserve_core::alerts::what_changed::{
    self, CHANGE_LOOKBACK_US, ChangeScope, ChangeWindow, PreparedRead,
};

use super::{HiddenSection, Onset};

pub(super) async fn prepare(
    org: &str,
    viewer: &str,
    scope: &ChangeScope,
    services: &[String],
    onset: &Onset,
    now: i64,
) -> PreparedRead {
    let window = ChangeWindow {
        start_us: onset.at.saturating_sub(CHANGE_LOOKBACK_US),
        end_us: now,
        onset_us: onset.at,
        evaluation_period_secs: onset.precision_secs.saturating_sub(60),
    };
    what_changed::prepare(org, viewer, window, services, scope).await
}

pub(super) async fn read(prepared: PreparedRead, hidden: &mut Vec<HiddenSection>) -> WhatChanged {
    let changes = prepared.read().await;
    hidden.extend(
        changes
            .coverage
            .unreadable_streams
            .iter()
            .filter_map(|source| {
                let (stream_type, stream) = source.split_once('/')?;
                Some(HiddenSection {
                    section: "changes",
                    stream_type: stream_type.to_string(),
                    stream: stream.to_string(),
                })
            }),
    );
    changes
}
