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

//! The producer half of cloud event reporting: the event types and the enqueue path.
//!
//! Enqueuing is just a push onto an in-memory queue, so it has no dependencies of its own and can
//! be called from anywhere -- organization management, log and trace ingestion. Draining the queue
//! is what needs the ingestion service, and that half lives in
//! [`crate::self_reporting::cloud_events`].

use std::sync::LazyLock as Lazy;

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

#[derive(Serialize, Deserialize, Debug, Hash)]
pub enum EventType {
    OrgCreated,
    OrgDeleted,
    OrgCleanupFailed,
    UserJoined,
    CheckoutSessionCreated,
    SubscriptionCreated,
    SubscriptionChanged,
    SubscriptionDeleted,
    StreamCreated,
}

#[derive(Serialize, Deserialize, Debug, Hash)]
pub struct CloudEvent {
    pub org_id: String,
    pub org_name: String,
    pub org_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    pub event: EventType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subscription_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_name: Option<String>,
}

pub(crate) static CLOUD_EVENT_QUEUE: Lazy<Mutex<Vec<CloudEvent>>> =
    Lazy::new(|| Mutex::new(vec![]));

pub async fn enqueue_cloud_event(event: CloudEvent) {
    let mut q = CLOUD_EVENT_QUEUE.lock().await;
    q.push(event);
}
