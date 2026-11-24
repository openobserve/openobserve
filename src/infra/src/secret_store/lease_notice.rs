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

use std::future::Future;

use sea_orm::ConnectionTrait;

use super::gate;
use crate::{
    errors::Error,
    table::secret_store_job_markers::{
        self as markers, META_ORG, SYNTHETICS_WRITE_ONLY, TOKENLESS_RECORDER,
    },
};

const BANNER_PERIOD_US: i64 = 7 * 24 * 3_600_000_000;

#[derive(Debug, PartialEq, Eq)]
pub struct RunnerLeaseNotice {
    pub min_runner_version: String,
    pub deadline_us: i64,
    pub public_locations_leased: bool,
}

pub async fn runner_lease_notice<C: ConnectionTrait>(
    conn: &C,
) -> anyhow::Result<Option<RunnerLeaseNotice>> {
    runner_lease_notice_with(
        conn,
        &config::get_config().synthetics,
        gate::durably_latched(),
    )
    .await
}

async fn runner_lease_notice_with<C: ConnectionTrait>(
    conn: &C,
    config: &config::Synthetics,
    durable_latch: impl Future<Output = Result<bool, Error>>,
) -> anyhow::Result<Option<RunnerLeaseNotice>> {
    if config.lease_min_runner_version.is_empty() || !durable_latch.await? {
        return Ok(None);
    }
    let Some(boot) = markers::get_marker_in(conn, META_ORG, TOKENLESS_RECORDER).await? else {
        return Ok(None);
    };
    // Old runners get the full period after write-only values go live, not only after first boot.
    let live = markers::get_marker_in(conn, META_ORG, SYNTHETICS_WRITE_ONLY)
        .await?
        .map_or(boot.done_at, |m| m.done_at);
    Ok(Some(RunnerLeaseNotice {
        min_runner_version: config.lease_min_runner_version.clone(),
        deadline_us: boot.done_at.max(live).saturating_add(BANNER_PERIOD_US),
        public_locations_leased: config.lambda_runner_contract >= 1,
    }))
}

#[cfg(test)]
mod tests {
    use sea_orm::{DatabaseBackend, MockDatabase};

    use super::*;

    #[tokio::test]
    async fn runner_lease_notice_reports_configured_version_deadline_and_public_contract() {
        for contract in [0, 1] {
            let config = config::Synthetics {
                lease_min_runner_version: "v1.3.0-rc1".into(),
                lambda_runner_contract: contract,
                ..Default::default()
            };
            let marker = markers::Model {
                job: TOKENLESS_RECORDER.into(),
                org_id: META_ORG.into(),
                done_at: 100,
            };
            let conn = MockDatabase::new(DatabaseBackend::Postgres)
                .append_query_results([vec![marker]])
                .append_query_results([vec![markers::Model {
                    job: SYNTHETICS_WRITE_ONLY.into(),
                    org_id: META_ORG.into(),
                    done_at: 500,
                }]])
                .append_query_results([Vec::<markers::Model>::new()])
                .into_connection();
            let notice = runner_lease_notice_with(&conn, &config, async { Ok(true) })
                .await
                .unwrap()
                .unwrap();
            assert_eq!(notice.min_runner_version, "v1.3.0-rc1");
            assert_eq!(notice.deadline_us, 500 + 7 * 24 * 3_600_000_000);
            assert_eq!(notice.public_locations_leased, contract >= 1);
            assert!(
                runner_lease_notice_with(&conn, &config, async { Ok(true) })
                    .await
                    .unwrap()
                    .is_none()
            );
        }
    }

    #[tokio::test]
    async fn runner_lease_notice_requires_opt_in_and_durable_latch_without_reading_marker() {
        let conn = MockDatabase::new(DatabaseBackend::Postgres).into_connection();
        let off = config::Synthetics::default();
        assert!(
            runner_lease_notice_with(&conn, &off, async {
                panic!("disabled opt-in must not read the latch")
            })
            .await
            .unwrap()
            .is_none()
        );
        let enabled = config::Synthetics {
            lease_min_runner_version: "v1.3.0-rc1".into(),
            ..Default::default()
        };
        assert!(
            runner_lease_notice_with(&conn, &enabled, async { Ok(false) })
                .await
                .unwrap()
                .is_none()
        );
        assert!(conn.into_transaction_log().is_empty());
    }
}
