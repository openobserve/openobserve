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

use std::{collections::HashMap, future::Future};

use config::meta::oncall::{Response, ResponseState};
use sea_orm::{
    ColumnTrait, DatabaseTransaction, DbErr, EntityTrait, QueryFilter, QueryOrder, QuerySelect,
    sea_query::{LockType, Query},
};

use super::{get_locked, incident_recovery_checks};
use crate::table::{
    entity::{alert_acks, alert_incident_alerts, alert_incidents::Model, oncall_responses::Column},
    oncall_responses,
};

tokio::task_local! {
    static REPAGE: RelapseRepageFence;
}

#[derive(Clone)]
pub struct RelapseRepageFence {
    pub org: String,
    pub incident_id: String,
    pub committed_at: i64,
    pub reopen_count: i32,
    pub check_id: String,
    pub attempt_id: String,
    pub generation: i64,
    pub after_resolve: bool,
    pub acknowledgements: RelapseAcknowledgements,
}

impl RelapseRepageFence {
    pub async fn run<T>(self, effect: impl Future<Output = T>) -> T {
        REPAGE.scope(self, effect).await
    }

    pub async fn check(&self, txn: &DatabaseTransaction, row: &Model) -> Result<(), RepageSkip> {
        let expected_attempt = (!self.after_resolve).then_some(self.attempt_id.as_str());
        if row.reopen_count != self.reopen_count
            || row.fix_attempt_id.as_deref() != expected_attempt
            || !matches!(row.status.as_str(), "open" | "acknowledged")
            || row.merged_into_id.is_some()
            || row.security_case
        {
            return Err(RepageSkip::OldEpisode);
        }
        if row.acknowledged_at.is_some_and(|at| at > self.committed_at) {
            return Err(RepageSkip::NewerAck);
        }
        let current = incident_recovery_checks::get(txn, &self.org, &self.check_id).await?;
        if !current.is_some_and(|row| {
            row.incident_id == self.incident_id
                && row.attempt_id == self.attempt_id
                && row.generation == self.generation
        }) {
            return Err(RepageSkip::OldEpisode);
        }
        Ok(())
    }

    pub async fn locked_pages(
        &self,
        txn: &DatabaseTransaction,
    ) -> Result<Vec<Response>, RepageSkip> {
        let pages = lock_open_pages(txn, &self.org, &self.incident_id).await?;
        if pages.iter().any(|page| {
            page.state == ResponseState::Acknowledged && !self.acknowledgements.holds_page(page)
        }) || lock_firing_acks(txn, &self.org, &self.incident_id)
            .await?
            .iter()
            .any(|ack| {
                self.acknowledgements.firing_revision(
                    &ack.alert_id,
                    &ack.group_key,
                    ack.firing_started_at,
                ) != Some(ack.updated_at)
            })
        {
            return Err(RepageSkip::NewerAck);
        }
        Ok(pages)
    }

    pub(crate) async fn lock_current(&self, txn: &DatabaseTransaction) -> Result<bool, DbErr> {
        let Some(row) = get_locked(txn, &self.org, &self.incident_id).await? else {
            return Ok(false);
        };
        self.allows(txn, &row).await
    }

    pub(crate) async fn lock_current_page_ack(
        &self,
        txn: &DatabaseTransaction,
        response_id: &str,
    ) -> Result<Option<Response>, DbErr> {
        let Some(row) = get_locked(txn, &self.org, &self.incident_id).await? else {
            return Ok(None);
        };
        Ok(self.allowed_pages(txn, &row).await?.and_then(|pages| {
            pages
                .into_iter()
                .find(|page| page.id == response_id && page.state == ResponseState::Acknowledged)
        }))
    }

    pub(crate) async fn allows(
        &self,
        txn: &DatabaseTransaction,
        row: &Model,
    ) -> Result<bool, DbErr> {
        Ok(self.allowed_pages(txn, row).await?.is_some())
    }

    async fn allowed_pages(
        &self,
        txn: &DatabaseTransaction,
        row: &Model,
    ) -> Result<Option<Vec<Response>>, DbErr> {
        let check = match self.check(txn, row).await {
            Ok(()) => self.locked_pages(txn).await,
            Err(reason) => Err(reason),
        };
        match check {
            Ok(pages) => Ok(Some(pages)),
            Err(RepageSkip::Database(error)) => Err(error),
            Err(reason) => {
                log::info!(
                    "[INCIDENT RECOVERY] repage {}/{} {reason}",
                    self.org,
                    self.incident_id
                );
                Ok(None)
            }
        }
    }
}

#[derive(Clone)]
pub struct RelapseAcknowledgements {
    pages: HashMap<String, PageAcknowledgement>,
    firings: HashMap<(String, String), FiringAcknowledgement>,
}

impl RelapseAcknowledgements {
    pub(crate) fn firing_revision(
        &self,
        alert_id: &str,
        group_key: &str,
        firing_started_at: i64,
    ) -> Option<i64> {
        let ack = self
            .firings
            .get(&(alert_id.to_owned(), group_key.to_owned()))?;
        (ack.firing_started_at == firing_started_at).then_some(ack.revision)
    }

    fn holds_page(&self, page: &Response) -> bool {
        self.pages.get(&page.id).is_some_and(|ack| {
            ack.holder == page.acked_by && ack.at == page.acked_at && ack.run == page.current_run()
        })
    }
}

#[derive(Clone)]
struct PageAcknowledgement {
    holder: Option<String>,
    at: Option<i64>,
    run: i32,
}

#[derive(Clone)]
struct FiringAcknowledgement {
    firing_started_at: i64,
    revision: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum RepageSkip {
    #[error("old episode")]
    OldEpisode,
    #[error("skipped: newer ack")]
    NewerAck,
    #[error(transparent)]
    Database(#[from] DbErr),
}

pub async fn capture_acks(
    txn: &DatabaseTransaction,
    org: &str,
    incident_id: &str,
) -> Result<RelapseAcknowledgements, DbErr> {
    // Row locks order this snapshot against acknowledgements waiting to commit.
    let pages = lock_open_pages(txn, org, incident_id)
        .await?
        .into_iter()
        .filter(|page| page.state == ResponseState::Acknowledged)
        .map(|page| {
            let ack = PageAcknowledgement {
                run: page.current_run(),
                holder: page.acked_by,
                at: page.acked_at,
            };
            (page.id, ack)
        })
        .collect();
    let firings = lock_firing_acks(txn, org, incident_id)
        .await?
        .into_iter()
        .map(|row| {
            let ack = FiringAcknowledgement {
                firing_started_at: row.firing_started_at,
                revision: row.updated_at,
            };
            ((row.alert_id, row.group_key), ack)
        })
        .collect();
    Ok(RelapseAcknowledgements { pages, firings })
}

pub fn is_recovery_repage(org: &str, incident_id: &str) -> bool {
    REPAGE
        .try_with(|fence| fence.org == org && fence.incident_id == incident_id)
        .unwrap_or(false)
}

pub(crate) fn current(org: &str) -> Option<RelapseRepageFence> {
    REPAGE
        .try_with(|fence| (fence.org == org).then(|| fence.clone()))
        .ok()
        .flatten()
}

async fn lock_open_pages(
    txn: &DatabaseTransaction,
    org: &str,
    incident_id: &str,
) -> Result<Vec<Response>, DbErr> {
    Ok(
        oncall_responses::open_pages(oncall_responses::pages_held_by_incident(org, incident_id))
            .order_by_asc(Column::Id)
            .lock(LockType::Update)
            .all(txn)
            .await?
            .into_iter()
            .filter_map(oncall_responses::to_response)
            .collect(),
    )
}

async fn lock_firing_acks(
    txn: &DatabaseTransaction,
    org: &str,
    incident_id: &str,
) -> Result<Vec<alert_acks::Model>, DbErr> {
    use alert_acks::Column as Ack;
    use alert_incident_alerts::Column as Link;

    let alerts = Query::select()
        .column(Link::AlertId)
        .from(alert_incident_alerts::Entity)
        .and_where(Link::IncidentId.eq(incident_id))
        .to_owned();
    alert_acks::Entity::find()
        .filter(Ack::OrgId.eq(org))
        .filter(Ack::AlertId.in_subquery(alerts))
        .filter(Ack::UnackedAt.is_null())
        .order_by_asc(Ack::AlertId)
        .order_by_asc(Ack::GroupKey)
        .lock(LockType::Update)
        .all(txn)
        .await
}
