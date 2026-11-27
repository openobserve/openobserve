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

//! Its own binary: it turns on the process-wide super cluster config.
#![cfg(feature = "enterprise")]

use std::{sync::Arc, time::Duration};

use config::meta::ai::memory::{Author, MemorySettings};
use db::ai_memory::{self, Submission, Submitted};
use infra::table::ai_memory::{Change, MemoryKey, Outcome};

#[tokio::test]
async fn on_a_super_cluster_a_put_a_delete_and_a_resync_send_nothing() {
    // SAFETY: the only test of this binary, before anything reads the config.
    unsafe {
        std::env::set_var("O2_SUPER_CLUSTER_ENABLED", "true");
        std::env::set_var("ZO_NATS_ADDR", "127.0.0.1:1");
    }
    if config::get_config().common.meta_store != "sqlite" {
        eprintln!("skipped: writes only to a SQLite meta store");
        return;
    }
    infra::db_init().await.unwrap();
    infra::table::migrate().await.unwrap();
    infra::table::cipher::boot(None).await.unwrap();

    let mut cfg = config::Config::init().unwrap();
    cfg.common.local_mode = false;
    cfg.common.meta_store = "sqlite".to_string();
    // Nothing listens there, so a regression fails here instead of reaching a real queue.
    cfg.nats.addr = "127.0.0.1:1".to_string();
    config::CONFIG.store(Arc::new(cfg));
    assert!(
        o2_enterprise::enterprise::common::config::get_config()
            .super_cluster
            .enabled
    );

    let key = MemoryKey::org(&format!("memory_off_{}", config::ider::uuid()));
    let writes = async {
        let put = ai_memory::submit(Submission {
            key: key.clone(),
            toolset_id: None,
            base_rev: 0,
            change: Change::Content("a\n".to_string()),
            settings: MemorySettings::default(),
            author: Author::User("u1".to_string()),
            is_memory_admin: true,
            reason: None,
            evidence: None,
        })
        .await
        .unwrap();
        assert!(matches!(
            put,
            Submitted::Written(Outcome::Applied { rev: 1, .. })
        ));
        let now = config::utils::time::now_micros();
        let sent = db::ai_memory_replication::resync(&key.org, now)
            .await
            .unwrap();
        assert_eq!(sent, 0);
        ai_memory::delete(&key).await.unwrap();
        let conn = infra::db::get_orm_client_rw().await;
        let kept = infra::table::ai_memory::live_tombstones_with(conn, &key.org, 0).await;
        assert!(kept.unwrap().is_empty());
    };
    tokio::time::timeout(Duration::from_secs(30), writes)
        .await
        .expect("a write waited for the queue");
}
