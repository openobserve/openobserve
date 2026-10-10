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

use std::{process::Command, sync::mpsc, time::Duration};

use infra::runtime::{
    DATAFUSION_RUNTIME, WAL_RUNTIME, create_grpc_runtime, create_job_runtime, create_main_runtime,
};
use search::datafusion::vortex::VORTEX_RUNTIME;
use tokio::runtime::Runtime;

fn assert_one_blocking_thread(runtime: &Runtime) {
    let (started_tx, started_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first = runtime.spawn_blocking(move || {
        started_tx.send(()).unwrap();
        release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let (second_tx, second_rx) = mpsc::channel();
    let second = runtime.spawn_blocking(move || second_tx.send(()).unwrap());
    let queued = matches!(
        second_rx.recv_timeout(Duration::from_millis(100)),
        Err(mpsc::RecvTimeoutError::Timeout)
    );
    release_tx.send(()).unwrap();
    runtime.block_on(async {
        first.await.unwrap();
        second.await.unwrap();
    });
    assert!(
        queued,
        "a second blocking task ran before the first finished"
    );
}

#[test]
fn runtime_blocking_limits_are_wired() {
    if let Ok(mode) = std::env::var("O2_RUNTIME_BLOCKING_WIRING_CHILD") {
        if mode == "disabled" {
            assert!(WAL_RUNTIME.is_none());
            return;
        }
        assert_one_blocking_thread(&create_main_runtime().unwrap());
        assert_one_blocking_thread(&create_job_runtime().unwrap());
        assert_one_blocking_thread(&create_grpc_runtime().unwrap());
        assert_one_blocking_thread(&DATAFUSION_RUNTIME);
        assert_one_blocking_thread(&VORTEX_RUNTIME);
        assert_one_blocking_thread(WAL_RUNTIME.as_ref().expect("dedicated WAL runtime"));
        return;
    }
    for mode in ["enabled", "disabled"] {
        let directory = tempfile::tempdir().unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        for (key, _) in std::env::vars().filter(|(key, _)| key.starts_with("ZO_")) {
            command.env_remove(key);
        }
        for runtime in ["MAIN", "JOB", "GRPC", "DATAFUSION", "VORTEX", "WAL"] {
            command.env(format!("ZO_{runtime}_RUNTIME_BLOCKING_WORKER_NUM"), "1");
        }
        let output = command
            .args([
                "--exact",
                "runtime_blocking_limits_are_wired",
                "--nocapture",
            ])
            .current_dir(directory.path())
            .env("O2_RUNTIME_BLOCKING_WIRING_CHILD", mode)
            .env(
                "ZO_WAL_DEDICATED_RUNTIME_ENABLED",
                (mode == "enabled").to_string(),
            )
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
