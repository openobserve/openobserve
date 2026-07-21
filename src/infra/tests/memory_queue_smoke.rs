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

//! Smoke test for `ZO_QUEUE_STORE=memory` through the real backend-selection
//! path (`queue::get_queue()`), with an intentionally unreachable NATS address.
//!
//! The invalid address is a tripwire: the memory path must never touch NATS,
//! so the test must pass without any connection attempt. It runs in its own
//! process (integration test target) and pins the config to its own `.env`
//! file, so a developer's repository `.env` (loaded with override semantics
//! by `dotenvy`) cannot leak into the test.

use std::sync::Arc;

use bytes::Bytes;
use tokio::time::{Duration, timeout};

#[tokio::test]
async fn test_memory_queue_via_backend_selection_with_invalid_nats_addr() {
    let env_dir = tempfile::tempdir().expect("create temp dir");
    let env_file = env_dir.path().join(".env");
    std::fs::write(
        &env_file,
        concat!(
            "ZO_LOCAL_MODE = true\n",
            "ZO_QUEUE_STORE = memory\n",
            "ZO_MEMORY_QUEUE_MAX_SIZE_MB = 8\n",
            // intentionally unreachable: the memory backend must never dial NATS
            "ZO_NATS_ADDR = \"127.0.0.1:1\"\n",
        ),
    )
    .expect("write .env");
    config::config_path_manager::set_config_file_path(env_file).expect("set config file path");
    assert_eq!(config::get_config().common.queue_store, "memory");

    let q = infra::queue::get_queue().await;
    let topic = "memory_smoke_topic";
    q.create(topic).await.expect("create topic");
    q.publish(topic, Bytes::from_static(b"hello"))
        .await
        .expect("publish");

    let mut rx = Arc::try_unwrap(q.consume(topic, None).await.expect("consume"))
        .unwrap_or_else(|_| panic!("receiver Arc has multiple owners"));
    let msg = timeout(Duration::from_secs(5), rx.recv())
        .await
        .expect("message should arrive without any NATS connection")
        .expect("channel unexpectedly closed");
    assert_eq!(msg.message().as_ref(), b"hello");
    msg.ack().await.expect("ack");
}
