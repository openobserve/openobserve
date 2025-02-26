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
use std::sync::Arc;

use anyhow::Result;
use tokio::sync::{mpsc, Mutex, Semaphore};

use crate::service::db::scheduler::Trigger;

/// Configuration for the scheduler
#[derive(Clone)]
pub struct SchedulerConfig {
    pub alert_schedule_concurrency: usize,
    pub alert_schedule_timeout: i64,
    pub report_schedule_timeout: i64,
    pub poll_interval_secs: u64,
}

/// Scheduler worker for processing triggers
#[derive(Clone)]
pub struct SchedulerWorker {
    pub id: usize,
    pub rx: Arc<Mutex<mpsc::Receiver<Trigger>>>,
    pub available_workers: Arc<Semaphore>,
}

/// Scheduler job puller that fetches jobs from the database
#[derive(Clone)]
pub struct SchedulerJobPuller {
    pub tx: mpsc::Sender<Trigger>,
    pub available_workers: Arc<Semaphore>,
    pub config: SchedulerConfig,
}

/// Main scheduler that coordinates workers and the job puller
pub struct Scheduler {
    pub config: SchedulerConfig,
    pub workers: Vec<SchedulerWorker>,
    pub job_puller: SchedulerJobPuller,
    pub tx: mpsc::Sender<Trigger>,
    pub rx: Arc<Mutex<mpsc::Receiver<Trigger>>>,
    pub available_workers: Arc<Semaphore>,
}

impl SchedulerWorker {
    pub fn new(
        id: usize,
        rx: Arc<Mutex<mpsc::Receiver<Trigger>>>,
        available_workers: Arc<Semaphore>,
    ) -> Self {
        Self {
            id,
            rx,
            available_workers,
        }
    }

    pub async fn run(&self) -> Result<()> {
        loop {
            // Try to get next trigger
            let trigger = {
                let mut rx = self.rx.lock().await;
                rx.recv().await
            };

            match trigger {
                Some(trigger) => {
                    // Acquire permit before processing
                    let _permit = self.available_workers.acquire().await?;

                    // Process the trigger
                    if let Err(e) = self.handle_trigger(trigger).await {
                        log::error!(
                            "[SCHEDULER][Worker-{}] Error handling trigger: {}",
                            self.id,
                            e
                        );
                    }

                    // Permit is automatically released when _permit is dropped
                }
                None => {
                    // Channel closed, no more work
                    break;
                }
            }
        }
        Ok(())
    }

    pub async fn handle_trigger(&self, trigger: Trigger) -> Result<()> {
        // Implementation of handle_triggers function
        handle_triggers(trigger).await
    }
}

impl SchedulerJobPuller {
    pub fn new(
        tx: mpsc::Sender<Trigger>,
        available_workers: Arc<Semaphore>,
        config: SchedulerConfig,
    ) -> Self {
        Self {
            tx,
            available_workers,
            config,
        }
    }

    pub async fn run(&self) -> Result<()> {
        loop {
            // Check how many workers are available
            let available_count = self.available_workers.available_permits();

            if available_count > 0 {
                // Pull only as many jobs as we have available workers
                let triggers = self.pull_triggers(available_count).await?;

                log::info!("Pulled {} jobs from scheduler", triggers.len());

                // Send all triggers to be processed
                for trigger in triggers {
                    if self.tx.send(trigger).await.is_err() {
                        // Channel closed, exit loop
                        return Ok(());
                    }
                }
            }

            // Wait a bit before checking again
            tokio::time::sleep(tokio::time::Duration::from_secs(
                self.config.poll_interval_secs,
            ))
            .await;

            // Check if channel is closed
            if self.tx.is_closed() {
                break;
            }
        }
        Ok(())
    }

    pub async fn pull(&self, limit: usize) -> Result<Vec<Trigger>> {
        match db::scheduler::pull(
            limit,
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
        let max_workers = config.alert_schedule_concurrency;

        // Create a channel for work distribution with capacity for max workers
        let (tx, rx) = mpsc::channel(max_workers);

        // Share receiver between workers
        let rx = Arc::new(Mutex::new(rx));

        // Track available workers with a semaphore
        let available_workers = Arc::new(Semaphore::new(max_workers));

        // Create workers
        let workers = (0..max_workers)
            .map(|id| Worker::new(id, rx.clone(), available_workers.clone()))
            .collect();

        // Create job puller
        let job_puller = JobPuller::new(tx.clone(), available_workers.clone(), config.clone());

        Self {
            config,
            workers,
            job_puller,
            tx,
            rx,
            available_workers,
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

        // Wait for shutdown signal (implement based on your needs)
        // ...

        // When shutting down:
        drop(self.tx.clone()); // Signal no more work

        // Wait for workers to complete
        if let Err(e) = futures::future::try_join_all(worker_handles).await {
            log::error!("[SCHEDULER] Error waiting for workers to complete: {}", e);
        }

        // Wait for puller to complete
        if let Err(e) = puller_handle.await {
            log::error!("[SCHEDULER] Error waiting for puller to complete: {}", e);
        }

        log::info!("[SCHEDULER] Shutdown complete");
        Ok(())
    }
}

// The main function that creates and runs the scheduler
pub async fn run() -> Result<()> {
    // Get configuration
    let cfg = get_config();

    // Create scheduler config
    let scheduler_config = SchedulerConfig {
        alert_schedule_concurrency: cfg.limit.alert_schedule_concurrency,
        alert_schedule_timeout: cfg.limit.alert_schedule_timeout,
        report_schedule_timeout: cfg.limit.report_schedule_timeout,
        poll_interval_secs: 1, // Can be configurable
    };

    // Create and run scheduler
    let scheduler = Scheduler::new(scheduler_config);
    scheduler.run().await
}
