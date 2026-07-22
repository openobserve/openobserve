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

use std::sync::Arc;

use ::common::infra::wal;
use config::{cache_instance_id, ider};

#[cfg(feature = "enterprise")]
use crate::self_reporting::CoreAuditPublisher;
use crate::{self_reporting::persistence::CoreBatchPublisher, service::db::metas};

pub async fn init() -> Result<(), anyhow::Error> {
    // keeps the first registration instead of failing
    if usage_reporting::set_batch_publisher(Arc::new(CoreBatchPublisher)).is_err() {
        log::warn!("usage batch publisher is already initialized, keeping existing one");
    }
    #[cfg(feature = "enterprise")]
    if audit::set_audit_publisher(Arc::new(CoreAuditPublisher)).is_err() {
        log::warn!("audit publisher is already initialized, keeping existing one");
    }
    let instance_id = match metas::instance::get().await {
        Ok(Some(instance)) => instance,
        Ok(None) | Err(_) => {
            log::info!("Generating new instance id");
            let id = ider::generate();
            let _ = metas::instance::set(&id).await;
            id
        }
    };
    cache_instance_id(&instance_id);

    wal::init()?;
    // because of asynchronous, we need to wait for a while
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    Ok(())
}
