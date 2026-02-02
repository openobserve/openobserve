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
use std::{collections::HashMap, sync::Arc};

use anyhow::Result;
use tokio::{
    sync::{Mutex, mpsc},
    time,
};

use super::handlers::handle_triggers;
use crate::service::db::scheduler::{Trigger, TriggerModule, pull as scheduler_pull};

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

/// Scheduler worker for processing triggers
#[derive(Clone)]
pub struct SchedulerWorker {
    pub id: usize,
    pub config: SchedulerConfig,
    pub rx: Arc<Mutex<mpsc::Receiver<ScheduledJob>>>,
}

/// Scheduler job puller that fetches jobs from the database
#[derive(Clone)]
pub struct SchedulerJobPuller {
    pub tx: mpsc::Sender<ScheduledJob>,
    pub config: SchedulerConfig,
}

/// Main scheduler that coordinates workers and the job puller
pub struct Scheduler {
    pub config: SchedulerConfig,
    pub workers: Vec<SchedulerWorker>,
    pub job_puller: SchedulerJobPuller,
    pub tx: mpsc::Sender<ScheduledJob>,
    pub rx: Arc<Mutex<mpsc::Receiver<ScheduledJob>>>,
}

impl SchedulerWorker {
    pub fn new(
        id: usize,
        config: SchedulerConfig,
        rx: Arc<Mutex<mpsc::Receiver<ScheduledJob>>>,
    ) -> Self {
        Self { id, config, rx }
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
    pub fn new(tx: mpsc::Sender<ScheduledJob>, config: SchedulerConfig) -> Self {
        Self { tx, config }
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

        loop {
            let cfg = config::get_config();
            // Check how many workers are available
            let trace_id = config::ider::generate_trace_id();
            if cfg.common.print_key_event {
                log::info!("[SCHEDULER][JobPuller-{trace_id}] Pulling jobs");
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
            let mut retry_ttl = 1;
            for job in jobs {
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

impl Scheduler {
    pub fn new(config: SchedulerConfig) -> Self {
        let max_workers = config.alert_schedule_concurrency as usize;

        // Create a channel for work distribution with capacity for max workers
        let (tx, rx) = mpsc::channel(1);

        // Share receiver between workers
        let rx = Arc::new(Mutex::new(rx));

        // Create workers
        let workers = (0..max_workers)
            .map(|id| SchedulerWorker::new(id, config.clone(), rx.clone()))
            .collect();

        // Create job puller
        let job_puller = SchedulerJobPuller::new(tx.clone(), config.clone());

        Self {
            config,
            workers,
            job_puller,
            tx,
            rx,
        }
    }

    pub async fn run(&self) -> Result<()> {
        log::debug!("Starting scheduler");

        // Spawn worker tasks
        let worker_handles: Vec<_> = self
            .workers
            .iter()
            .map(|worker| {
                let worker = worker.clone();
                tokio::spawn(async move {
                    if let Err(e) = worker.run().await {
                        log::error!("[SCHEDULER][Worker] Error in worker: {e}");
                    }
                })
            })
            .collect();

        // Spawn job puller task
        let puller_handle = {
            let puller = self.job_puller.clone();
            tokio::spawn(async move {
                if let Err(e) = puller.run().await {
                    log::error!("[SCHEDULER] Error in job puller: {e}");
                }
            })
        };

        // Wait for shutdown signal
        // ...

        // Wait for puller to complete
        if let Err(e) = puller_handle.await {
            log::error!("[SCHEDULER] Error waiting for puller to complete: {e}");
        }

        // When shutting down:
        drop(self.tx.clone()); // Signal no more work

        // Wait for workers to complete
        if let Err(e) = futures::future::try_join_all(worker_handles).await {
            log::error!("[SCHEDULER] Error waiting for workers to complete: {e}");
        }

        // Ideally should never reach here
        log::info!("[SCHEDULER] Shutdown complete");
        Ok(())
    }
}
