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

use std::sync::Arc;

use config::get_config;
use once_cell::sync::Lazy;
use tokio::runtime::Runtime;

pub static DATAFUSION_RUNTIME: Lazy<Arc<Runtime>> = Lazy::new(|| {
    Arc::new(
        tokio::runtime::Builder::new_multi_thread()
            .thread_name("datafusion_runtime")
            .worker_threads(get_config().limit.cpu_num)
            .thread_stack_size(16 * 1024 * 1024)
            .enable_all()
            .build()
            .unwrap(),
    )
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
        .worker_threads(thread_num)
        .thread_stack_size(16 * 1024 * 1024)
        .enable_all()
        .build()
        .ok()
        .map(Arc::new)
});
