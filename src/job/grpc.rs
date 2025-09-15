// Copyright 2025 OpenObserve Inc.
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

// Periodically checks if the grpc_runtime thread is still running.
// On Linux, monitors /proc/self/task for a thread named "grpc_runtime".
// If the thread is not found, logs an error and exits the program.
// On non-Linux platforms, always assumes the thread is running.
pub async fn health_check() {
    tokio::task::spawn(async move {
        loop {
            tokio::time::sleep(tokio::time::Duration::from_secs(60)).await;
            if is_exist_grpc_runtime() {
                log::debug!("grpc_runtime is running");
            } else {
                log::error!("grpc_runtime is not running, exiting");
                std::process::exit(1);
            }
        }
    });
}

#[cfg(not(target_os = "linux"))]
fn is_exist_grpc_runtime() -> bool {
    true
}

#[cfg(target_os = "linux")]
fn is_exist_grpc_runtime() -> bool {
    use std::fs;

    let task_path = "/proc/self/task";
    let Ok(task_entries) = fs::read_dir(task_path) else {
        return false;
    };

    for task_entry in task_entries.flatten() {
        let comm_path = task_entry.path().join("comm");
        if let Ok(comm) = fs::read_to_string(&comm_path) {
            if comm.trim() == "grpc_runtime" {
                return true;
            }
        }
    }

    false
}
