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
use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use openobserve_scheduler::{Trigger, TriggerModule, pull as scheduler_pull};
use tokio::{
    sync::{Mutex, mpsc},
    time,
};

use super::handlers::handle_triggers;

#[derive(Debug, Clone)]
pub struct ScheduledJob {
    pub trace_id: String,
    pub trigger: Trigger,
    pub stop_keep_alive_tx: mpsc::Sender<()>,
}

/// Configuration for the scheduler
#[derive(Clone)]
pub struct SchedulerConfig {
    pub alert_schedule_concurrency: i64,
    pub alert_schedule_timeout: i64,
    pub report_schedule_timeout: i64,
    pub poll_interval_secs: u64,
    pub keep_alive_interval_secs: u64,
}

/// Per-module pull/dispatch settings (A3/A4). Each module runs its own pull loop, cadence,
/// LIMIT budget, channel and worker pool, derived from a base [`SchedulerConfig`].
#[derive(Clone, Debug)]
pub struct ModuleSchedulerConfig {
    pub module: TriggerModule,
    /// LIMIT per pull, channel capacity, and worker-pool size for this module.
    pub concurrency: i64,
    /// Poll cadence for this module's puller, in seconds.
    pub poll_interval_secs: u64,
}

/// Scheduler worker for processing triggers
#[derive(Clone)]
#[allow(dead_code)]
pub struct SchedulerWorker {
    pub id: usize,
    /// Module this worker's lane serves. `None` = shared/legacy pool (all modules).
    pub module: Option<TriggerModule>,
    pub config: SchedulerConfig,
    pub rx: Arc<Mutex<mpsc::Receiver<ScheduledJob>>>,
}

/// Scheduler job puller that fetches jobs from the database
#[derive(Clone)]
pub struct SchedulerJobPuller {
    pub tx: mpsc::Sender<ScheduledJob>,
    /// Module this puller claims. `None` = shared/legacy puller (all modules, global lock).
    pub module: Option<TriggerModule>,
    pub config: SchedulerConfig,
}

/// One isolated pull-loop + worker-pool + channel. The scheduler runs a single lane
/// (`module = None`) in legacy mode, or one lane per module when per-module pullers are on.
struct SchedulerLane {
    workers: Vec<SchedulerWorker>,
    job_puller: SchedulerJobPuller,
}

/// Main scheduler that coordinates workers and the job puller
#[allow(dead_code)]
pub struct Scheduler {
    pub config: SchedulerConfig,
    /// Flattened union of every lane's workers (kept for introspection/tests).
    pub workers: Vec<SchedulerWorker>,
    lanes: Vec<SchedulerLane>,
}

impl SchedulerWorker {
    pub fn new(
        id: usize,
        module: Option<TriggerModule>,
        config: SchedulerConfig,
        rx: Arc<Mutex<mpsc::Receiver<ScheduledJob>>>,
    ) -> Self {
        Self {
            id,
            module,
            config,
            rx,
        }
    }

    pub async fn run(&self) -> Result<()> {
        loop {
            let cfg = config::get_config();
            if cfg.common.print_key_event {
                log::info!("[SCHEDULER][Worker-{}] Waiting for next job", self.id);
            }
            // Try to get next trigger with permit
            let job = {
                let mut rx = self.rx.lock().await;
                rx.recv().await
            };

            match job {
                Some(job) => {
                    let job_id = job.trigger.id;
                    let job_key = job.trigger.module_key.to_string();
                    if cfg.common.print_key_event {
                        log::info!(
                            "[SCHEDULER][Worker-{}] trace_id: {} Processing job[{}], trigger: {}",
                            self.id,
                            job.trace_id,
                            job_id,
                            job_key
                        );
                    }

                    // start a self print task to print the job id and job key every 10 seconds
                    // until the job is done
                    let watch_start = std::time::Instant::now();
                    let (watch_tx, mut watch_rx) = mpsc::channel::<()>(1);
                    if cfg.common.print_key_event {
                        let worker_id = self.id;
                        let job_id = job.trigger.id;
                        let trace_id = job.trace_id.clone();
                        let job_key = job_key.clone();
                        tokio::spawn(async move {
                            loop {
                                tokio::select! {
                                    _ = tokio::time::sleep(tokio::time::Duration::from_secs(10)) => {
                                        log::info!(
                                            "[SCHEDULER][Worker-{worker_id}] trace_id: {trace_id} Processing job[{job_id}], trigger: {job_key}, keep alive"
                                        );
                                    }
                                    _ = watch_rx.recv() => {
                                        break;
                                    }
                                }
                            }
                        });
                    }

                    // Process the trigger
                    let ret = self.handle_trigger(&job.trace_id, job.trigger).await;
                    // stop the watch task
                    drop(watch_tx);
                    if cfg.common.print_key_event {
                        log::info!(
                            "[SCHEDULER][Worker-{}] trace_id: {} Processing job[{job_id}], trigger: {job_key}, took: {} ms",
                            self.id,
                            job.trace_id,
                            watch_start.elapsed().as_millis() as f64
                        );
                    } else {
                        log::debug!(
                            "[SCHEDULER][Worker-{}] trace_id: {} Job[{}], trigger: {} done",
                            self.id,
                            job.trace_id,
                            job_id,
                            job_key
                        );
                    }

                    // Stop the keep alive for the job
                    if let Err(e) = job.stop_keep_alive_tx.send(()).await {
                        log::error!(
                            "[SCHEDULER][Worker-{}] trace_id: {} Error stopping keep alive for job[{}], trigger: {}, error: {}",
                            self.id,
                            job.trace_id,
                            job_id,
                            job_key,
                            e
                        );
                    }
                    if let Err(e) = ret {
                        log::error!(
                            "[SCHEDULER][Worker-{}] trace_id: {} Error handling job[{}], trigger: {}, error: {}",
                            self.id,
                            job.trace_id,
                            job_id,
                            job_key,
                            e
                        );
                    }
                }
                None => {
                    log::info!(
                        "[SCHEDULER][Worker-{}] Channel closed, no more work",
                        self.id
                    );
                    break;
                }
            }
        }
        log::info!("[SCHEDULER][Worker-{}] Exiting", self.id);
        Ok(())
    }

    /// Handles a given trigger
    pub async fn handle_trigger(&self, trace_id: &str, trigger: Trigger) -> Result<()> {
        let trace_id = trace_id.to_owned();
        // If there is any panic, it should not crash the scheduler worker
        let handler_job = tokio::spawn(async move {
            let trigger_key = trigger.module_key.to_string();
            if let Err(e) = handle_triggers(&trace_id, trigger).await {
                log::error!(
                    "[SCHEDULER] trace_id: {trace_id} Error handling trigger key {trigger_key}: {e}"
                );
            }
        });

        if let Err(e) = handler_job.await {
            return Err(anyhow::anyhow!("Error in handler: {}", e));
        }
        Ok(())
    }
}

impl SchedulerJobPuller {
    pub fn new(
        tx: mpsc::Sender<ScheduledJob>,
        module: Option<TriggerModule>,
        config: SchedulerConfig,
    ) -> Self {
        Self { tx, module, config }
    }

    /// Runs the job puller. Pulls jobs from the database and sends them to the workers.
    /// When pulling jobs, it will only pull as many jobs as the number of available workers
    /// which is determined by the semaphore and can have the maximum value of
    /// `alert_schedule_concurrency` The advantage of this approach is that the scheduler does
    /// not need to wait for all the workers to complete the job before pulling more jobs. It
    /// will keep pulling jobs at the configured poll interval. The number of jobs pulled will
    /// be the number of available workers.
    pub async fn run(&self) -> Result<()> {
        let interval = self.config.poll_interval_secs;
        let mut interval = time::interval(time::Duration::from_secs(interval));
        interval.tick().await; // The first tick

        // Label for logs: the module this puller serves, or "all" for the shared/legacy puller.
        let module_label = self
            .module
            .as_ref()
            .map(|m| m.to_string())
            .unwrap_or_else(|| "all".to_string());

        loop {
            let cfg = config::get_config();
            // Check how many workers are available
            let trace_id = config::ider::generate_trace_id();
            if cfg.common.print_key_event {
                log::info!(
                    "[SCHEDULER][JobPuller-{trace_id}][{module_label}] Pulling jobs (interval={}s, budget={})",
                    self.config.poll_interval_secs,
                    self.config.alert_schedule_concurrency
                );
            }

            // Pull only as many jobs as we have workers
            let triggers = match self.pull().await {
                Ok(triggers) => triggers,
                Err(e) => {
                    log::error!("[SCHEDULER][JobPuller-{trace_id}] Error pulling triggers: {e}");
                    continue;
                }
            };

            if cfg.common.print_key_event {
                log::info!(
                    "[SCHEDULER][JobPuller-{trace_id}] Pulled {} jobs from scheduler",
                    triggers.len()
                );
            }

            // Print counts for each module
            if !triggers.is_empty() {
                let mut grouped_triggers: std::collections::HashMap<TriggerModule, Vec<&Trigger>> =
                    HashMap::new();

                // Group triggers by module
                for trigger in &triggers {
                    grouped_triggers
                        .entry(trigger.module.clone())
                        .or_default()
                        .push(trigger);
                }

                // Print counts for each module
                for (module, module_triggers) in &grouped_triggers {
                    log::debug!(
                        "[SCHEDULER] [JobPuller-{trace_id}] Pulled {module:?}: {} jobs",
                        module_triggers.len()
                    );

                    // [ENTERPRISE] Register batch for RCA cross-alert correlation
                    // Only for Alert module
                    // #[cfg(feature = "enterprise")]
                    // if matches!(module, TriggerModule::Alert) && !module_triggers.is_empty() {
                    //     log::debug!(
                    //         "[SCHEDULER][JobPuller-{}] Registering RCA batch with {} alerts",
                    //         trace_id,
                    //         module_triggers.len()
                    //     );
                    //     o2_enterprise::enterprise::ai::rca::register_batch(
                    //         &trace_id,
                    //         module_triggers.len(),
                    //     );
                    // }
                }
            }

            // keep alive the jobs before sending them to the workers
            // but need to release the thread after the job is sent to the worker
            let mut jobs = Vec::with_capacity(triggers.len());
            for trigger in triggers {
                let job_id = trigger.id;
                let job_key = trigger.module_key.clone();
                let (tx, mut rx) = mpsc::channel::<()>(1);
                let scheduled_job = ScheduledJob {
                    trace_id: trace_id.clone(),
                    trigger,
                    stop_keep_alive_tx: tx,
                };
                jobs.push(scheduled_job);

                let trace_id_keep_alive = trace_id.clone();
                let ttl = self.config.keep_alive_interval_secs;
                let alert_timeout = self.config.alert_schedule_timeout;
                let report_timeout = self.config.report_schedule_timeout;
                // Maximum lifetime for keep-alive: use the larger timeout * 3
                let max_lifetime_secs = std::cmp::max(alert_timeout, report_timeout) * 3;
                tokio::task::spawn(async move {
                    let start_time = tokio::time::Instant::now();
                    let max_lifetime = tokio::time::Duration::from_secs(max_lifetime_secs as u64);

                    loop {
                        tokio::select! {
                            _ = tokio::time::sleep(tokio::time::Duration::from_secs(ttl)) => {}
                            _ = rx.recv() => {
                                log::debug!(
                                    "[SCHEDULER][JobPuller-{trace_id_keep_alive}] keep_alive for job[{job_id}] trigger[{job_key}] done"
                                );
                                return;
                            }
                        }

                        // Check if we've exceeded the maximum lifetime
                        if start_time.elapsed() >= max_lifetime {
                            log::warn!(
                                "[SCHEDULER][JobPuller-{trace_id_keep_alive}] keep_alive for job[{job_id}] trigger[{job_key}] exceeded maximum lifetime of {max_lifetime_secs}s, stopping"
                            );
                            return;
                        }

                        if let Err(e) =
                            infra::scheduler::keep_alive(&[job_id], alert_timeout, report_timeout)
                                .await
                        {
                            log::error!(
                                "[SCHEDULER][JobPuller-{trace_id_keep_alive}] keep_alive for job[{job_id}] trigger[{job_key}] failed: {e}"
                            );
                        }
                        log::debug!(
                            "[SCHEDULER][JobPuller-{trace_id_keep_alive}] keep_alive extended for job[{job_id}] trigger[{job_key}]"
                        );
                    }
                });
            }

            // Send all jobs to be processed
            for job in jobs {
                let mut retry_ttl = 1;
                loop {
                    match self.tx.try_send(job.clone()) {
                        Ok(()) => {
                            break;
                        }
                        Err(mpsc::error::TrySendError::Closed(_)) => {
                            log::error!(
                                "[SCHEDULER][JobPuller-{trace_id}] Channel closed, exiting job puller",
                            );
                            return Ok(());
                        }
                        Err(mpsc::error::TrySendError::Full(_)) => {
                            log::warn!(
                                "[SCHEDULER][JobPuller-{trace_id}] Error sending job[{}] trigger[{}] to channel, all the workers are busy, retrying...",
                                job.trigger.id,
                                job.trigger.module_key
                            );
                            tokio::time::sleep(tokio::time::Duration::from_secs(retry_ttl)).await;
                            retry_ttl = std::cmp::min(retry_ttl * 2, 60);
                        }
                    }
                }
            }

            interval.tick().await;

            if self.tx.is_closed() {
                break;
            }
        }
        log::info!("[SCHEDULER] Job puller exiting");
        Ok(())
    }

    pub async fn pull(&self) -> Result<Vec<Trigger>> {
        match scheduler_pull(
            self.config.alert_schedule_concurrency,
            self.config.alert_schedule_timeout,
            self.config.report_schedule_timeout,
            self.module.clone(),
        )
        .await
        {
            Ok(triggers) => Ok(triggers),
            Err(e) => {
                log::error!("[SCHEDULER] Error pulling triggers: {e}");
                Ok(vec![])
            }
        }
    }
}

impl SchedulerLane {
    /// Build one isolated lane (channel + worker pool + puller). `module = None` is the
    /// shared/legacy lane that pulls all modules under the global lock; `Some(m)` pulls only
    /// that module. `concurrency` sizes the channel, the worker pool and the pull LIMIT together.
    fn new(module: Option<TriggerModule>, concurrency: i64, config: SchedulerConfig) -> Self {
        let max_workers = std::cmp::max(1, concurrency) as usize;

        // Channel capacity matches the worker count so back-pressure (channel-full retry in the
        // puller) kicks in exactly when all of this module's workers are busy. The puller owns the
        // sole sender; the channel stays open for the process lifetime because the puller loops
        // forever, so the lane doesn't retain its own copy.
        let (tx, rx) = mpsc::channel(max_workers);
        let rx = Arc::new(Mutex::new(rx));

        let workers = (0..max_workers)
            .map(|id| SchedulerWorker::new(id, module.clone(), config.clone(), rx.clone()))
            .collect();

        let job_puller = SchedulerJobPuller::new(tx, module.clone(), config.clone());

        Self {
            workers,
            job_puller,
        }
    }
}

impl Scheduler {
    /// Build the scheduler from the base config, honoring `ZO_SCHEDULER_PER_MODULE_PULLERS`.
    /// When the flag is off, a single shared lane handles all modules (legacy behavior).
    pub fn new(config: SchedulerConfig) -> Self {
        let cfg = config::get_config();
        let module_configs = if cfg.limit.scheduler_per_module_pullers {
            resolve_module_configs(&cfg, &config)
        } else {
            Vec::new()
        };
        Self::new_with_modules(config, module_configs)
    }

    /// Build the scheduler from an explicit set of per-module configs. An empty `module_configs`
    /// yields the single shared (legacy) lane; otherwise one lane per module. Kept
    /// separate from [`Scheduler::new`] so both paths are unit-testable without env mutation.
    pub fn new_with_modules(
        config: SchedulerConfig,
        module_configs: Vec<ModuleSchedulerConfig>,
    ) -> Self {
        let lanes: Vec<SchedulerLane> = if module_configs.is_empty() {
            vec![SchedulerLane::new(
                None,
                config.alert_schedule_concurrency,
                config.clone(),
            )]
        } else {
            module_configs
                .into_iter()
                .map(|mc| {
                    // Per-module config: override the LIMIT/worker budget and the poll cadence.
                    let mut module_cfg = config.clone();
                    module_cfg.alert_schedule_concurrency = mc.concurrency;
                    module_cfg.poll_interval_secs = mc.poll_interval_secs;
                    SchedulerLane::new(Some(mc.module), mc.concurrency, module_cfg)
                })
                .collect()
        };

        // Flattened view of every lane's workers (introspection/tests).
        let workers = lanes
            .iter()
            .flat_map(|p| p.workers.iter().cloned())
            .collect();

        Self {
            config,
            workers,
            lanes,
        }
    }

    pub async fn run(&self) -> Result<()> {
        log::debug!("Starting scheduler with {} lane(s)", self.lanes.len());

        // Spawn all workers across every lane.
        let worker_handles: Vec<_> = self
            .lanes
            .iter()
            .flat_map(|p| p.workers.iter())
            .map(|worker| {
                let worker = worker.clone();
                tokio::spawn(async move {
                    if let Err(e) = worker.run().await {
                        log::error!("[SCHEDULER][Worker] Error in worker: {e}");
                    }
                })
            })
            .collect();

        // Spawn one puller per lane.
        let puller_handles: Vec<_> = self
            .lanes
            .iter()
            .map(|p| {
                let puller = p.job_puller.clone();
                tokio::spawn(async move {
                    if let Err(e) = puller.run().await {
                        log::error!("[SCHEDULER] Error in job puller: {e}");
                    }
                })
            })
            .collect();

        // Wait for all pullers to complete.
        if let Err(e) = futures::future::try_join_all(puller_handles).await {
            log::error!("[SCHEDULER] Error waiting for puller to complete: {e}");
        }

        // Reaching here means every lane's puller returned, which normally only happens on
        // channel close / error — the scheduler otherwise runs for the process lifetime. We
        // deliberately do NOT try to force-close the worker channels here: the senders live in
        // `self.lanes` (and in each puller clone) behind `&self`, so we can't drop the originals,
        // and dropping a clone is a no-op. We just wait for in-flight workers to drain. A real
        // shutdown path would own those senders and drop them to signal the workers.
        if let Err(e) = futures::future::try_join_all(worker_handles).await {
            log::error!("[SCHEDULER] Error waiting for workers to complete: {e}");
        }

        log::info!("[SCHEDULER] Shutdown complete");
        Ok(())
    }
}

/// Resolve the per-module pull budgets/cadences from config (A4). A per-module concurrency or
/// interval of `0` inherits the shared default — alert concurrency
/// (`ZO_ALERT_SCHEDULE_CONCURRENCY`) and the alert pull frequency (`ZO_ALERT_SCHEDULE_INTERVAL`)
/// respectively. Each non-alert module has its own concurrency AND cadence env var so its puller
/// can poll at its own rate; the alert lane simply reuses those two base vars (no duplicates).
/// Every `TriggerModule` variant gets a lane so no module's rows are ever left unclaimed.
fn resolve_module_configs(
    cfg: &config::Config,
    base: &SchedulerConfig,
) -> Vec<ModuleSchedulerConfig> {
    let default_concurrency = base.alert_schedule_concurrency;
    let default_interval = base.poll_interval_secs;
    let pick_concurrency = |v: i64| if v > 0 { v } else { default_concurrency };
    let pick_interval = |v: i64| if v > 0 { v as u64 } else { default_interval };

    vec![
        ModuleSchedulerConfig {
            module: TriggerModule::Alert,
            // Alert is the base module: its budget and cadence ARE the shared defaults
            // (ZO_ALERT_SCHEDULE_CONCURRENCY / ZO_ALERT_SCHEDULE_INTERVAL), so no dedicated vars.
            concurrency: default_concurrency,
            poll_interval_secs: default_interval,
        },
        ModuleSchedulerConfig {
            module: TriggerModule::Report,
            concurrency: pick_concurrency(cfg.limit.scheduler_report_concurrency),
            poll_interval_secs: pick_interval(cfg.limit.scheduler_report_interval),
        },
        ModuleSchedulerConfig {
            module: TriggerModule::DerivedStream,
            concurrency: pick_concurrency(cfg.limit.scheduler_derived_stream_concurrency),
            poll_interval_secs: pick_interval(cfg.limit.scheduler_derived_stream_interval),
        },
        ModuleSchedulerConfig {
            module: TriggerModule::Backfill,
            // Backfill is bulk/background: smallest budget (default 1), own (typically slower)
            // cadence.
            concurrency: std::cmp::max(1, cfg.limit.scheduler_backfill_concurrency),
            poll_interval_secs: pick_interval(cfg.limit.scheduler_backfill_interval),
        },
        ModuleSchedulerConfig {
            module: TriggerModule::AnomalyDetection,
            concurrency: pick_concurrency(cfg.limit.scheduler_anomaly_concurrency),
            poll_interval_secs: pick_interval(cfg.limit.scheduler_anomaly_interval),
        },
        ModuleSchedulerConfig {
            module: TriggerModule::QueryRecommendations,
            concurrency: pick_concurrency(cfg.limit.scheduler_query_reco_concurrency),
            poll_interval_secs: pick_interval(cfg.limit.scheduler_query_reco_interval),
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_config() -> SchedulerConfig {
        SchedulerConfig {
            alert_schedule_concurrency: 3,
            alert_schedule_timeout: 60,
            report_schedule_timeout: 120,
            poll_interval_secs: 10,
            keep_alive_interval_secs: 30,
        }
    }

    #[test]
    fn test_scheduler_new_creates_correct_worker_count() {
        let cfg = make_config();
        let scheduler = Scheduler::new(cfg.clone());
        assert_eq!(
            scheduler.workers.len(),
            cfg.alert_schedule_concurrency as usize
        );
    }

    #[test]
    fn test_scheduler_new_single_worker() {
        let cfg = SchedulerConfig {
            alert_schedule_concurrency: 1,
            ..make_config()
        };
        let scheduler = Scheduler::new(cfg);
        assert_eq!(scheduler.workers.len(), 1);
    }

    #[test]
    fn test_scheduler_worker_new_stores_id() {
        let (tx, rx) = mpsc::channel(1);
        let rx = Arc::new(Mutex::new(rx));
        drop(tx);
        let worker = SchedulerWorker::new(7, None, make_config(), rx);
        assert_eq!(worker.id, 7);
        assert_eq!(worker.module, None);
    }

    #[test]
    fn test_scheduler_job_puller_new() {
        let (tx, _rx) = mpsc::channel(1);
        let puller = SchedulerJobPuller::new(tx, Some(TriggerModule::Alert), make_config());
        assert_eq!(puller.config.poll_interval_secs, 10);
        assert_eq!(puller.config.alert_schedule_concurrency, 3);
        assert_eq!(puller.module, Some(TriggerModule::Alert));
    }

    #[test]
    fn test_scheduler_new_with_modules_empty_is_legacy_single_lane() {
        // Empty module list => one shared lane with `alert_schedule_concurrency` workers,
        // all module = None (legacy behavior).
        let cfg = make_config();
        let scheduler = Scheduler::new_with_modules(cfg.clone(), vec![]);
        assert_eq!(scheduler.lanes.len(), 1);
        assert_eq!(
            scheduler.workers.len(),
            cfg.alert_schedule_concurrency as usize
        );
        assert!(scheduler.workers.iter().all(|w| w.module.is_none()));
    }

    #[test]
    fn test_scheduler_new_with_modules_builds_one_lane_per_module() {
        let cfg = make_config();
        let module_configs = vec![
            ModuleSchedulerConfig {
                module: TriggerModule::Alert,
                concurrency: 4,
                poll_interval_secs: 10,
            },
            ModuleSchedulerConfig {
                module: TriggerModule::Backfill,
                concurrency: 1,
                poll_interval_secs: 30,
            },
        ];
        let scheduler = Scheduler::new_with_modules(cfg, module_configs);
        // One lane per module config, workers == sum of per-module concurrencies.
        assert_eq!(scheduler.lanes.len(), 2);
        assert_eq!(scheduler.workers.len(), 4 + 1);
        // Each worker is tagged with its module.
        let alert_workers = scheduler
            .workers
            .iter()
            .filter(|w| w.module == Some(TriggerModule::Alert))
            .count();
        let backfill_workers = scheduler
            .workers
            .iter()
            .filter(|w| w.module == Some(TriggerModule::Backfill))
            .count();
        assert_eq!(alert_workers, 4);
        assert_eq!(backfill_workers, 1);
    }

    #[test]
    fn test_scheduler_new_with_modules_concurrency_floor() {
        // A zero/negative module concurrency must still yield at least one worker.
        let cfg = make_config();
        let module_configs = vec![ModuleSchedulerConfig {
            module: TriggerModule::Report,
            concurrency: 0,
            poll_interval_secs: 10,
        }];
        let scheduler = Scheduler::new_with_modules(cfg, module_configs);
        assert_eq!(scheduler.lanes.len(), 1);
        assert_eq!(scheduler.workers.len(), 1);
    }

    fn find_module(
        configs: &[ModuleSchedulerConfig],
        module: TriggerModule,
    ) -> ModuleSchedulerConfig {
        configs
            .iter()
            .find(|c| c.module == module)
            .cloned()
            .unwrap_or_else(|| panic!("module {module:?} missing from resolved configs"))
    }

    #[test]
    fn test_resolve_module_configs_covers_every_module_once() {
        // Every TriggerModule variant must get exactly one lane config, else its rows would
        // never be pulled once per-module pullers are enabled.
        let cfg = config::Config::default();
        let configs = resolve_module_configs(&cfg, &make_config());
        assert_eq!(configs.len(), 6);
        let modules: std::collections::HashSet<_> =
            configs.iter().map(|c| c.module.clone()).collect();
        assert_eq!(modules.len(), 6, "duplicate module in resolved configs");
        for m in [
            TriggerModule::Alert,
            TriggerModule::Report,
            TriggerModule::DerivedStream,
            TriggerModule::Backfill,
            TriggerModule::AnomalyDetection,
            TriggerModule::QueryRecommendations,
        ] {
            assert!(modules.contains(&m), "missing module {m:?}");
        }
    }

    #[test]
    fn test_resolve_module_configs_zero_inherits_base_defaults() {
        // With all per-module vars at 0, every module inherits the base (alert) concurrency and
        // the alert pull frequency (interval) — except backfill, whose concurrency floors to 1.
        let base = make_config(); // concurrency 3, interval 10
        let cfg = config::Config::default();
        let configs = resolve_module_configs(&cfg, &base);

        for m in [
            TriggerModule::Alert,
            TriggerModule::Report,
            TriggerModule::DerivedStream,
            TriggerModule::AnomalyDetection,
            TriggerModule::QueryRecommendations,
        ] {
            let c = find_module(&configs, m.clone());
            assert_eq!(c.concurrency, 3, "{m:?} should inherit base concurrency");
            assert_eq!(
                c.poll_interval_secs, 10,
                "{m:?} should inherit the alert pull frequency"
            );
        }

        let backfill = find_module(&configs, TriggerModule::Backfill);
        assert_eq!(backfill.concurrency, 1, "backfill floors to 1");
        assert_eq!(
            backfill.poll_interval_secs, 10,
            "backfill inherits the alert pull frequency"
        );
    }

    #[test]
    fn test_resolve_module_configs_concurrency_overrides_take_effect() {
        let base = make_config(); // alert concurrency 3
        let mut cfg = config::Config::default();
        cfg.limit.scheduler_report_concurrency = 7;
        cfg.limit.scheduler_derived_stream_concurrency = 8;
        cfg.limit.scheduler_anomaly_concurrency = 4;
        cfg.limit.scheduler_query_reco_concurrency = 2;
        cfg.limit.scheduler_backfill_concurrency = 3;
        let configs = resolve_module_configs(&cfg, &base);

        // Alert has no dedicated var: it reuses the base (ZO_ALERT_SCHEDULE_CONCURRENCY).
        assert_eq!(find_module(&configs, TriggerModule::Alert).concurrency, 3);
        assert_eq!(find_module(&configs, TriggerModule::Report).concurrency, 7);
        assert_eq!(
            find_module(&configs, TriggerModule::DerivedStream).concurrency,
            8
        );
        assert_eq!(
            find_module(&configs, TriggerModule::AnomalyDetection).concurrency,
            4
        );
        assert_eq!(
            find_module(&configs, TriggerModule::QueryRecommendations).concurrency,
            2
        );
        assert_eq!(
            find_module(&configs, TriggerModule::Backfill).concurrency,
            3
        );
    }

    #[test]
    fn test_resolve_module_configs_interval_overrides_are_per_module() {
        // Each module has its own cadence env var; a non-zero value wins, 0 inherits the alert
        // pull frequency. Set a distinct interval per module and verify no cross-talk.
        let base = make_config(); // interval 10
        let mut cfg = config::Config::default();
        cfg.limit.scheduler_report_interval = 15;
        cfg.limit.scheduler_derived_stream_interval = 120;
        cfg.limit.scheduler_backfill_interval = 60;
        cfg.limit.scheduler_anomaly_interval = 30;
        // query_reco left at 0 → inherits the alert pull frequency (10)
        let configs = resolve_module_configs(&cfg, &base);

        // Alert has no dedicated var: it reuses the base (ZO_ALERT_SCHEDULE_INTERVAL).
        assert_eq!(
            find_module(&configs, TriggerModule::Alert).poll_interval_secs,
            10
        );
        assert_eq!(
            find_module(&configs, TriggerModule::Report).poll_interval_secs,
            15
        );
        assert_eq!(
            find_module(&configs, TriggerModule::DerivedStream).poll_interval_secs,
            120
        );
        assert_eq!(
            find_module(&configs, TriggerModule::Backfill).poll_interval_secs,
            60
        );
        assert_eq!(
            find_module(&configs, TriggerModule::AnomalyDetection).poll_interval_secs,
            30
        );
        assert_eq!(
            find_module(&configs, TriggerModule::QueryRecommendations).poll_interval_secs,
            10,
            "query_reco with 0 inherits the alert pull frequency"
        );
    }
}
