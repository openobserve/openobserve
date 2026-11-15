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

use std::sync::{Arc, LazyLock as Lazy};

use config::get_config;
use tokio::runtime::Runtime;

const THREAD_STACK_SIZE: usize = 16 * 1024 * 1024;

pub fn create_main_runtime() -> std::io::Result<Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .thread_name("main_runtime")
        .thread_stack_size(THREAD_STACK_SIZE)
        .enable_all()
        .build()
}

pub fn create_job_runtime() -> std::io::Result<Runtime> {
    let cfg = get_config();
    tokio::runtime::Builder::new_multi_thread()
        .thread_name("job_runtime")
        .thread_stack_size(THREAD_STACK_SIZE)
        .worker_threads(cfg.limit.job_runtime_worker_num)
        .max_blocking_threads(cfg.limit.job_runtime_blocking_worker_num)
        .enable_all()
        .build()
}

pub fn create_grpc_runtime() -> std::io::Result<Runtime> {
    let cfg = get_config();
    tokio::runtime::Builder::new_multi_thread()
        .thread_name("grpc_runtime")
        .thread_stack_size(THREAD_STACK_SIZE)
        .worker_threads(cfg.limit.grpc_runtime_worker_num)
        .max_blocking_threads(cfg.limit.grpc_runtime_blocking_worker_num)
        .enable_all()
        .build()
}

pub static DATAFUSION_RUNTIME: Lazy<Arc<Runtime>> = Lazy::new(|| {
    Arc::new(
        tokio::runtime::Builder::new_multi_thread()
            .thread_name("datafusion_runtime")
            .thread_stack_size(THREAD_STACK_SIZE)
            .worker_threads(get_config().limit.cpu_num)
            .enable_all()
            .build()
            .unwrap(),
    )
});

/// Blocking-only pool for tantivy index builds. A fixed thread count keeps build garbage in a few
/// reused allocator heaps instead of spreading it over every blocking thread of the caller.
pub static TANTIVY_BUILD_RUNTIME: Lazy<Runtime> = Lazy::new(|| {
    let cfg = get_config();
    tokio::runtime::Builder::new_current_thread()
        .thread_name("tantivy_build")
        .thread_stack_size(THREAD_STACK_SIZE)
        .max_blocking_threads(
            cfg.compact.tantivy_builder_thread_num * cfg.limit.file_merge_thread_num,
        )
        .build()
        .unwrap()
});

pub static WAL_RUNTIME: Lazy<Option<Arc<Runtime>>> = Lazy::new(|| {
    let cfg = get_config();

    if !cfg.common.wal_dedicated_runtime_enabled {
        return None;
    }

    let total_cpus = cfg.limit.cpu_num;
    // Security Check: At least 2 CPU cores are required for isolation (1 for HTTP, 1 for WAL)
    if total_cpus < 2 {
        return None;
    }

    // Worker number strategy for WAL runtime
    let thread_num = if cfg.limit.wal_runtime_worker_num > 0 {
        cfg.limit.wal_runtime_worker_num
    } else {
        cfg.limit.mem_table_bucket_num
    };
    // Ensure the number of worker threads less than the total number of CPU cores
    let thread_num = thread_num.min(total_cpus);

    tokio::runtime::Builder::new_multi_thread()
        .thread_name("wal-runtime")
        .thread_stack_size(THREAD_STACK_SIZE)
        .worker_threads(thread_num)
        .enable_all()
        .build()
        .ok()
        .map(Arc::new)
});

#[cfg(test)]
mod tests {
    use std::{collections::HashSet, time::Duration};

    use super::*;

    #[tokio::test]
    async fn test_tantivy_build_runtime_uses_fixed_thread_count() {
        let cfg = get_config();
        let max_threads = cfg.compact.tantivy_builder_thread_num * cfg.limit.file_merge_thread_num;
        let tasks: Vec<_> = (0..max_threads * 3)
            .map(|_| {
                TANTIVY_BUILD_RUNTIME.spawn_blocking(|| {
                    std::thread::sleep(Duration::from_millis(20));
                    let t = std::thread::current();
                    (t.id(), t.name().map(str::to_string))
                })
            })
            .collect();
        let mut ids = HashSet::new();
        for task in tasks {
            let (id, name) = task.await.unwrap();
            assert_eq!(name.as_deref(), Some("tantivy_build"));
            ids.insert(id);
        }
        assert!(ids.len() <= max_threads, "{} > {max_threads}", ids.len());
    }

    #[tokio::test]
    async fn test_tantivy_build_runtime_propagates_panic() {
        let res = TANTIVY_BUILD_RUNTIME
            .spawn_blocking(|| panic!("build failed"))
            .await;
        assert!(res.unwrap_err().is_panic());
    }
}
