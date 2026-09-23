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

use config::{cluster::LOCAL_NODE, get_config};
use tokio::sync::Mutex;

use super::{CPU_FREQUENCY_HZ, convert, sample, sink};

/// Start the self-profiles background loop when enabled and timing is valid.
pub async fn run() {
    let cfg = get_config();
    if !cfg.self_profiles.enabled {
        log::info!("[SELF-PROFILES] disabled (ZO_SELF_PROFILES_ENABLED=false)");
        return;
    }
    if cfg.self_profiles.interval_secs == 0 {
        log::info!("[SELF-PROFILES] background loop disabled (ZO_SELF_PROFILES_INTERVAL_SECS=0)");
        return;
    }
    if let Err(reason) = cfg.self_profiles.validate_loop_timing() {
        log::warn!("[SELF-PROFILES] {reason}; not starting background loop");
        return;
    }

    // Local in-process ingest needs an ingester; remote URL works from any role.
    if cfg.self_profiles.url.trim().is_empty() && !LOCAL_NODE.is_ingester() {
        log::info!(
            "[SELF-PROFILES] local sink requires ingester role; skipping on this node (set ZO_SELF_PROFILES_URL to forward)"
        );
        return;
    }

    let interval = std::time::Duration::from_secs(cfg.self_profiles.interval_secs);
    let cpu_secs = cfg.self_profiles.cpu_secs;
    let lock = Arc::new(Mutex::new(()));
    log::info!(
        "[SELF-PROFILES] starting background loop: interval={}s cpu={}s url={}",
        cfg.self_profiles.interval_secs,
        cpu_secs,
        if cfg.self_profiles.url.is_empty() {
            "local"
        } else {
            "remote"
        }
    );

    loop {
        let cycle_start = std::time::Instant::now();
        {
            let _guard = lock.lock().await;
            if let Err(e) = run_cycle(cpu_secs).await {
                log::error!("[SELF-PROFILES] cycle failed: {e}");
            }
        }
        let elapsed = cycle_start.elapsed();
        let sleep_for = interval.saturating_sub(elapsed);
        tokio::time::sleep(sleep_for).await;
    }
}

async fn run_cycle(cpu_secs: u64) -> Result<(), String> {
    let host = config::get_config().common.instance_name.clone();
    let extra = [("host.name", host.as_str())];

    match sample::dump_cpu_profile(cpu_secs, CPU_FREQUENCY_HZ).await {
        Ok(bytes) => match convert::pprof_bytes_to_otlp(&bytes, &extra) {
            Ok(req) => {
                if let Err(e) = sink::ingest(req).await {
                    log::error!("[SELF-PROFILES] CPU ingest failed: {e}");
                }
            }
            Err(e) => log::error!("[SELF-PROFILES] CPU convert failed: {e}"),
        },
        Err(e) => log::error!("[SELF-PROFILES] CPU sample failed: {e}"),
    }

    match sample::dump_memory_pprof().await {
        Ok(bytes) => match convert::pprof_bytes_to_otlp(&bytes, &extra) {
            Ok(req) => {
                if let Err(e) = sink::ingest(req).await {
                    log::error!("[SELF-PROFILES] memory ingest failed: {e}");
                }
            }
            Err(e) => log::error!("[SELF-PROFILES] memory convert failed: {e}"),
        },
        Err(e) => log::error!("[SELF-PROFILES] memory sample failed: {e}"),
    }

    Ok(())
}
