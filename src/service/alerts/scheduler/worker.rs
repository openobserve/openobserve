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
            log::debug!("[SCHEDULER][Worker-{}] Waiting for next job", self.id);
            // Try to get next trigger with permit
            let job = {
                let mut rx = self.rx.lock().await;
                rx.recv().await
            };

            match job {
                Some(job) => {
                    let job_id = job.trigger.id;
                    let job_key = job.trigger.module_key.to_string();
                    log::debug!(
                        "[SCHEDULER][Worker-{}] trace_id: {} Processing job[{}], trigger: {}",
                        self.id,
                        job.trace_id,
                        job_id,
                        job_key
                    );

                    // Process the trigger
                    let ret = self.handle_trigger(&job.trace_id, job.trigger).await;
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
        let handler_job = tokio::spawn(async move { handle_triggers(&trace_id, trigger).await });

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
            // Check how many workers are available
            let trace_id = config::ider::uuid();

            log::info!("[SCHEDULER][JobPuller-{}] Pulling jobs", trace_id);

            // Pull only as many jobs as we have workers
            let triggers = match self.pull().await {
                Ok(triggers) => triggers,
                Err(e) => {
                    log::error!(
                        "[SCHEDULER][JobPuller-{}] Error pulling triggers: {}",
                        trace_id,
                        e
                    );
                    continue;
                }
            };

            log::info!(
                "[SCHEDULER][JobPuller-{}] Pulled {} jobs from scheduler",
                trace_id,
                triggers.len()
            );

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
                for (module, triggers) in grouped_triggers {
                    log::info!(
                        "[SCHEDULER] [JobPuller-{}] Pulled {:?}: {} jobs",
                        trace_id,
                        module,
                        triggers.len()
                    );
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
                tokio::task::spawn(async move {
                    loop {
                        tokio::select! {
                            _ = tokio::time::sleep(tokio::time::Duration::from_secs(ttl)) => {}
                            _ = rx.recv() => {
                                log::debug!(
                                    "[SCHEDULER][JobPuller-{}] keep_alive for job[{}] trigger[{}] done",
                                    trace_id_keep_alive,
                                    job_id,
                                    job_key
                                );
                                return;
                            }
                        }
                        if let Err(e) =
                            infra::scheduler::keep_alive(&[job_id], alert_timeout, report_timeout)
                                .await
                        {
                            log::error!(
                                "[SCHEDULER][JobPuller-{}] keep_alive for job[{}] trigger[{}] failed: {}",
                                trace_id_keep_alive,
                                job_id,
                                job_key,
                                e
                            );
                        }
                    }
                });
            }

            // Send all jobs to be processed
            for job in jobs {
                if self.tx.send(job).await.is_err() {
                    log::error!(
                        "[SCHEDULER][JobPuller-{}] Channel closed, exiting job puller",
                        trace_id
                    );
                    return Ok(());
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
                log::error!("[SCHEDULER] Error pulling triggers: {}", e);
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
                        log::error!("[SCHEDULER][Worker] Error in worker: {}", e);
                    }
                })
            })
            .collect();

        // Spawn job puller task
        let puller_handle = {
            let puller = self.job_puller.clone();
            tokio::spawn(async move {
                if let Err(e) = puller.run().await {
                    log::error!("[SCHEDULER] Error in job puller: {}", e);
                }
            })
        };

        // Wait for shutdown signal
        // ...

        // Wait for puller to complete
        if let Err(e) = puller_handle.await {
            log::error!("[SCHEDULER] Error waiting for puller to complete: {}", e);
        }

        // When shutting down:
        drop(self.tx.clone()); // Signal no more work

        // Wait for workers to complete
        if let Err(e) = futures::future::try_join_all(worker_handles).await {
            log::error!("[SCHEDULER] Error waiting for workers to complete: {}", e);
        }

        // Ideally should never reach here
        log::info!("[SCHEDULER] Shutdown complete");
        Ok(())
    }
}
