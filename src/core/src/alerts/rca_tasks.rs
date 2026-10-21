// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! RCA runs registered per incident on this node, detached from the request that started them.

use std::{
    convert::Infallible,
    fmt::Display,
    future::Future,
    sync::{
        Arc, LazyLock,
        atomic::{AtomicU64, Ordering},
    },
};

use bytes::Bytes;
use config::meta::alerts::incidents::{
    AnalysisTriggerType, IncidentEvent, RcaEndedReason, RcaTrigger,
};
use dashmap::{DashMap, mapref::entry::Entry};
use futures::{Stream, StreamExt, future::BoxFuture};
use o2_enterprise::enterprise::alerts::rca_service::{self, RcaStreamRelay};
use tokio::{
    sync::{mpsc, oneshot},
    task::{AbortHandle, JoinHandle},
};

tokio::task_local! {
    // The claim of the registered task running now; deep callees settle through it.
    static RCA_CLAIM: RcaClaim;
}

/// Frames buffered for a slow reader before the run waits for it.
const FRAME_BUFFER: usize = 64;
/// The failure a run records when its request ended between Begin and the spawn.
const REQUEST_ENDED: &str = "The request ended before the analysis started";

static RCA_TASKS: LazyLock<DashMap<String, RcaTask>> = LazyLock::new(DashMap::new);
static RCA_STARTS: LazyLock<DashMap<String, ()>> = LazyLock::new(DashMap::new);
static NEXT_TOKEN: AtomicU64 = AtomicU64::new(1);

/// What `DELETE …/rca` found registered on this node.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LocalRun {
    /// A running task, now aborted
    Aborted,
    /// A run already writing its own terminal event
    Settling,
    /// Nothing here; the run may be on another node
    Absent,
}

/// A registered run's place in the registry; dropping it unregisters the run.
pub struct RcaTaskSlot {
    claim: RcaClaim,
}

impl RcaTaskSlot {
    /// Claims the terminal event for the run; false once `DELETE …/rca` or a callee took it.
    pub fn settle(&self) -> bool {
        self.claim.settle()
    }
}

impl Drop for RcaTaskSlot {
    fn drop(&mut self) {
        let claim = &self.claim;
        RCA_TASKS.remove_if(&claim.key, |_, task| task.token == claim.token);
    }
}

#[derive(Debug, Clone)]
struct RcaClaim {
    key: String,
    token: u64,
}

impl RcaClaim {
    fn settle(&self) -> bool {
        match RCA_TASKS.get_mut(&self.key) {
            Some(mut task) if task.token == self.token && task.handle.is_some() => {
                task.handle = None;
                true
            }
            _ => false,
        }
    }
}

/// A run whose Begin is written but whose task is not spawned yet; dropped armed, it fails.
pub struct BegunRun {
    begin: Option<JoinHandle<()>>,
    write: Option<EventWriter>,
}

impl BegunRun {
    /// Writes the incident's Begin; a request dropped from here on still ends the run.
    pub async fn begin(org_id: &str, incident_id: &str) -> Self {
        let (org, incident) = (org_id.to_string(), incident_id.to_string());
        let begin = write_begin(org.clone(), incident.clone());
        let write: EventWriter = Box::new(move |event| {
            Box::pin(async move {
                if let Err(e) = crate::incidents::append_event(&org, &incident, event).await {
                    log::error!("[INCIDENTS::RCA] end of {incident} not recorded: {e}");
                }
            })
        });
        Self::start(begin, write).await
    }

    /// Ends the run with `event` without waiting; the write cannot be cut short by a drop.
    pub fn fail(mut self, event: IncidentEvent) {
        if let Some(write) = self.write.take() {
            tokio::spawn(write(event));
        }
    }

    /// The spawned task owns the terminal event from now on.
    pub fn hand_off(mut self) {
        self.write = None;
    }

    async fn start(begin: impl Future<Output = ()> + Send + 'static, write: EventWriter) -> Self {
        let mut run = Self {
            begin: Some(tokio::spawn(begin)),
            write: Some(write),
        };
        if let Some(begin) = run.begin.as_mut() {
            let _ = begin.await;
        }
        run.begin = None;
        run
    }
}

impl Drop for BegunRun {
    fn drop(&mut self) {
        let Some(write) = self.write.take() else {
            return;
        };
        let begin = self.begin.take();
        let failed =
            IncidentEvent::ai_analysis_failed(REQUEST_ENDED, AnalysisTriggerType::Manual, None);
        // Begin first, so the failure is the terminal the in-flight check reads.
        tokio::spawn(async move {
            if let Some(begin) = begin {
                let _ = begin.await;
            }
            write(failed).await;
        });
    }
}

type EventWriter = Box<dyn FnOnce(IncidentEvent) -> BoxFuture<'static, ()> + Send>;

/// Holds this node's other starts for the incident off until the run's Begin is written.
pub struct RcaStartGuard {
    key: String,
}

impl Drop for RcaStartGuard {
    fn drop(&mut self) {
        RCA_STARTS.remove(&self.key);
    }
}

/// One item a detached stream hands its HTTP body.
#[derive(Debug)]
pub enum RcaStreamItem {
    Frame(String),
    /// The run sent its own terminal frame
    End,
}

/// What a detached stream does to its incident once the run ends.
pub trait RcaRunEffects: Send + Sync + 'static {
    /// Stores the run's text; returns the report id when it became the current report.
    fn save(&self, report: String, ended: RcaEndedReason) -> BoxFuture<'static, Option<String>>;
    /// Writes the run's one terminal incident event.
    fn end(&self, ended: RcaEndedReason) -> BoxFuture<'static, ()>;
}

/// The incident a user-started run reports into.
#[derive(Debug, Clone)]
pub struct IncidentRun {
    pub org_id: String,
    pub incident_id: String,
    pub trigger: RcaTrigger,
}

impl RcaRunEffects for IncidentRun {
    fn save(&self, report: String, ended: RcaEndedReason) -> BoxFuture<'static, Option<String>> {
        let run = self.clone();
        Box::pin(async move {
            rca_service::save_rca_run(&run.org_id, &run.incident_id, &report, run.trigger, ended)
                .await
                .inspect_err(|e| {
                    log::error!("[RCA::Stream] report of {} not saved: {e}", run.incident_id)
                })
                .ok()
                .flatten()
        })
    }

    fn end(&self, ended: RcaEndedReason) -> BoxFuture<'static, ()> {
        let run = self.clone();
        Box::pin(async move {
            let event = ended.terminal_event();
            if let Err(e) =
                crate::incidents::append_event(&run.org_id, &run.incident_id, event).await
            {
                log::error!("[RCA::Stream] end of {} not recorded: {e}", run.incident_id);
            }
        })
    }
}

struct RcaTask {
    token: u64,
    /// `None` once the run settles, so a late cancel cannot add a second terminal event
    handle: Option<AbortHandle>,
}

/// The relay a run holds; dropped unsettled (aborted or panicked) it still keeps the text.
struct HeldRun<E: RcaRunEffects> {
    relay: RcaStreamRelay,
    effects: Arc<E>,
    settled: bool,
}

impl<E: RcaRunEffects> Drop for HeldRun<E> {
    fn drop(&mut self) {
        if self.settled {
            return;
        }
        let Ok(runtime) = tokio::runtime::Handle::try_current() else {
            return;
        };
        // An abort is a cancel, whose route writes the event; a panic has nobody else to.
        let panicked = std::thread::panicking();
        let ended = if panicked {
            RcaEndedReason::Failed
        } else {
            RcaEndedReason::Cancelled
        };
        let report = std::mem::take(&mut self.relay.report);
        let effects = self.effects.clone();
        runtime.spawn(async move {
            effects.save(report, ended).await;
            if panicked {
                effects.end(ended).await;
            }
        });
    }
}

/// The HTTP body's half of a detached stream; a closed channel is sent on, never awaited.
struct FrameSink(Option<mpsc::Sender<RcaStreamItem>>);

impl FrameSink {
    async fn send(&mut self, frames: Vec<String>) {
        for frame in frames {
            let Some(tx) = &self.0 else {
                return;
            };
            if tx.send(RcaStreamItem::Frame(frame)).await.is_err() {
                self.0 = None;
            }
        }
    }

    async fn end(self) {
        if let Some(tx) = self.0 {
            let _ = tx.send(RcaStreamItem::End).await;
        }
    }
}

/// Spawns `run` registered before its first poll, so a cancel never misses it.
pub fn spawn_rca_task<F, Fut>(org_id: &str, incident_id: &str, run: F) -> JoinHandle<Fut::Output>
where
    F: FnOnce(RcaTaskSlot) -> Fut,
    Fut: Future + Send + 'static,
    Fut::Output: Send + 'static,
{
    let key = rca_task_key(org_id, incident_id);
    let claim = RcaClaim {
        key: key.clone(),
        token: NEXT_TOKEN.fetch_add(1, Ordering::Relaxed),
    };
    let token = claim.token;
    let run = run(RcaTaskSlot {
        claim: claim.clone(),
    });
    let (registered, ready) = oneshot::channel::<()>();
    let handle = tokio::spawn(RCA_CLAIM.scope(claim, async move {
        let _ = ready.await;
        run.await
    }));
    let task = RcaTask {
        token,
        handle: Some(handle.abort_handle()),
    };
    RCA_TASKS.insert(key, task);
    let _ = registered.send(());
    handle
}

/// [`RcaTaskSlot::settle`] for code running inside a registered task; true outside one.
pub fn settle_current_rca_task() -> bool {
    RCA_CLAIM.try_with(RcaClaim::settle).unwrap_or(true)
}

/// One start per incident at a time on this node; across nodes the event log is best-effort.
pub fn reserve_rca_start(org_id: &str, incident_id: &str) -> Option<RcaStartGuard> {
    let key = rca_task_key(org_id, incident_id);
    match RCA_STARTS.entry(key.clone()) {
        Entry::Occupied(_) => None,
        Entry::Vacant(slot) => {
            slot.insert(());
            Some(RcaStartGuard { key })
        }
    }
}

/// Aborts this node's run for the incident, unless it is already settling.
pub fn abort_local_rca_task(org_id: &str, incident_id: &str) -> LocalRun {
    let key = rca_task_key(org_id, incident_id);
    if let Some((_, task)) = RCA_TASKS.remove_if(&key, |_, task| task.handle.is_some()) {
        if let Some(handle) = task.handle {
            handle.abort();
        }
        return LocalRun::Aborted;
    }
    if RCA_TASKS.contains_key(&key) {
        LocalRun::Settling
    } else {
        LocalRun::Absent
    }
}

/// Relays `upstream` as the incident's registered run; dropping the frames never stops it.
pub fn spawn_rca_stream<S, Err, E>(
    org_id: &str,
    incident_id: &str,
    upstream: S,
    effects: E,
) -> impl Stream<Item = Result<String, Infallible>> + Send + 'static
where
    S: Stream<Item = Result<Bytes, Err>> + Send + Unpin + 'static,
    Err: Display + Send + 'static,
    E: RcaRunEffects,
{
    let (tx, rx) = mpsc::channel(FRAME_BUFFER);
    let relay = RcaStreamRelay::new(incident_id);
    let effects = Arc::new(effects);
    spawn_rca_task(org_id, incident_id, move |slot| {
        drive_rca_stream(upstream, relay, effects, slot, tx)
    });
    futures::stream::unfold(Some(rx), |rx| async move {
        let mut rx = rx?;
        match rx.recv().await {
            Some(RcaStreamItem::Frame(frame)) => Some((Ok(frame), Some(rx))),
            Some(RcaStreamItem::End) => None,
            // The run was stopped before its own terminal, so the body still ends with one.
            None => Some((Ok(RcaStreamRelay::stopped_frame()), None)),
        }
    })
}

async fn drive_rca_stream<S, Err, E>(
    mut upstream: S,
    relay: RcaStreamRelay,
    effects: Arc<E>,
    slot: RcaTaskSlot,
    tx: mpsc::Sender<RcaStreamItem>,
) where
    S: Stream<Item = Result<Bytes, Err>> + Send + Unpin + 'static,
    Err: Display + Send + 'static,
    E: RcaRunEffects,
{
    let mut sink = FrameSink(Some(tx));
    let mut run = HeldRun {
        relay,
        effects: effects.clone(),
        settled: false,
    };
    while let Some(chunk) = upstream.next().await {
        match chunk {
            Ok(bytes) => sink.send(run.relay.feed(&bytes)).await,
            Err(e) => {
                log::warn!("[RCA::Stream] upstream broke off: {e}");
                break;
            }
        }
        if run.relay.broken() {
            break;
        }
    }
    sink.send(run.relay.flush()).await;
    let ended = run.relay.ended_reason();
    // Claimed before saving, so a cancel from here on finds the run settling, not abortable.
    if !slot.settle() {
        return;
    }
    run.settled = true;
    let report_id = effects.save(run.relay.report.clone(), ended).await;
    effects.end(ended).await;
    sink.send(run.relay.finish(report_id.as_deref())).await;
    sink.end().await;
}

async fn write_begin(org_id: String, incident_id: String) {
    let begin = IncidentEvent::ai_analysis_begin();
    if let Err(e) = crate::incidents::append_event(&org_id, &incident_id, begin).await {
        log::error!("[INCIDENTS::RCA] Begin of {incident_id} not recorded: {e}");
    }
}

fn rca_task_key(org_id: &str, incident_id: &str) -> String {
    format!("{org_id}/{incident_id}")
}

#[cfg(test)]
mod tests {
    use std::{sync::Mutex, time::Duration};

    use futures::channel::mpsc::{UnboundedSender, unbounded};

    use super::*;

    #[derive(Default)]
    struct Recorder(Mutex<Vec<String>>, Mutex<Option<oneshot::Receiver<()>>>);

    impl Recorder {
        fn calls(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }

        async fn wait_for(&self, call: &str) {
            for _ in 0..200 {
                if self.calls().iter().any(|c| c == call) {
                    return;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            panic!("{call} never happened: {:?}", self.calls());
        }
    }

    impl RcaRunEffects for Arc<Recorder> {
        fn save(
            &self,
            report: String,
            ended: RcaEndedReason,
        ) -> BoxFuture<'static, Option<String>> {
            let me = self.clone();
            Box::pin(async move {
                let current = ended == RcaEndedReason::Completed;
                me.0.lock()
                    .unwrap()
                    .push(format!("save {ended:?} {report}"));
                let gate = me.1.lock().unwrap().take();
                if let Some(gate) = gate {
                    let _ = gate.await;
                }
                current.then(|| "rep_1".to_string())
            })
        }

        fn end(&self, ended: RcaEndedReason) -> BoxFuture<'static, ()> {
            let me = self.clone();
            Box::pin(async move { me.0.lock().unwrap().push(format!("end {ended:?}")) })
        }
    }

    type Upstream = UnboundedSender<Result<Bytes, std::io::Error>>;

    fn frame(json: serde_json::Value) -> Result<Bytes, std::io::Error> {
        Ok(Bytes::from(format!("data: {json}\n\n")))
    }

    fn delta(text: &str) -> Result<Bytes, std::io::Error> {
        frame(serde_json::json!({"type": "message_delta", "content": text}))
    }

    fn start(
        incident: &str,
    ) -> (
        Upstream,
        Arc<Recorder>,
        impl Stream<Item = Result<String, Infallible>> + Send + 'static,
    ) {
        let (tx, rx) = unbounded();
        let recorder = Arc::new(Recorder::default());
        let body = spawn_rca_stream("org_tasks", incident, rx, recorder.clone());
        (tx, recorder, body)
    }

    fn kind(frame: &str) -> String {
        let json: serde_json::Value =
            serde_json::from_str(frame.trim_start_matches("data: ").trim_end()).unwrap();
        json["type"].as_str().unwrap().to_string()
    }

    #[tokio::test]
    async fn a_detached_stream_survives_its_client_and_saves_once() {
        let incident = format!("inc_{}", config::ider::uuid());
        let (tx, recorder, body) = start(&incident);
        tx.unbounded_send(delta("first ")).unwrap();
        let mut body = Box::pin(body);
        assert_eq!(kind(&body.next().await.unwrap().unwrap()), "start");
        drop(body);
        tx.unbounded_send(delta("second")).unwrap();
        tx.unbounded_send(frame(serde_json::json!({"type": "complete"})))
            .unwrap();
        drop(tx);
        recorder.wait_for("end Completed").await;
        assert_eq!(
            recorder.calls(),
            ["save Completed first second", "end Completed"]
        );
        for _ in 0..200 {
            if abort_local_rca_task("org_tasks", &incident) == LocalRun::Absent {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("the run never unregistered");
    }

    #[tokio::test]
    async fn delete_stops_a_detached_stream_and_keeps_its_partial_text() {
        let incident = format!("inc_{}", config::ider::uuid());
        let (tx, recorder, body) = start(&incident);
        tx.unbounded_send(delta("partial")).unwrap();
        let mut body = Box::pin(body);
        assert_eq!(kind(&body.next().await.unwrap().unwrap()), "start");
        assert_eq!(kind(&body.next().await.unwrap().unwrap()), "chunk");
        assert_eq!(
            abort_local_rca_task("org_tasks", &incident),
            LocalRun::Aborted
        );
        let rest: Vec<_> = body.map(|f| kind(&f.unwrap())).collect().await;
        assert_eq!(rest, ["cancelled"]);
        recorder.wait_for("save Cancelled partial").await;
        // The cancel route writes the cancelled event; the run adds no second one.
        assert!(recorder.calls().iter().all(|c| !c.starts_with("end")));
        assert_eq!(
            abort_local_rca_task("org_tasks", &incident),
            LocalRun::Absent
        );
        drop(tx);
    }

    #[tokio::test]
    async fn each_way_a_stream_ends_writes_exactly_one_terminal_event() {
        let error = serde_json::json!({"type": "error", "code": "provider_error", "message": "m"});
        let cases = [
            (
                vec![delta("r"), frame(serde_json::json!({"type": "complete"}))],
                RcaEndedReason::Completed,
            ),
            (
                vec![
                    delta("r"),
                    frame(error),
                    frame(serde_json::json!({"type": "complete"})),
                ],
                RcaEndedReason::Failed,
            ),
            (vec![delta("r")], RcaEndedReason::Interrupted),
            (
                vec![delta("r"), Err(std::io::Error::other("reset"))],
                RcaEndedReason::Interrupted,
            ),
            (
                vec![frame(serde_json::json!({"type": "cancelled"}))],
                RcaEndedReason::Cancelled,
            ),
        ];
        for (chunks, ended) in cases {
            let incident = format!("inc_{}", config::ider::uuid());
            let (tx, recorder, body) = start(&incident);
            for chunk in chunks {
                tx.unbounded_send(chunk).unwrap();
            }
            drop(tx);
            let frames: Vec<_> = body.map(|f| f.unwrap()).collect().await;
            let ends: Vec<_> = recorder
                .calls()
                .into_iter()
                .filter(|c| c.starts_with("end"))
                .collect();
            assert_eq!(ends, [format!("end {ended:?}")]);
            let last: serde_json::Value = serde_json::from_str(
                frames
                    .last()
                    .unwrap()
                    .trim_start_matches("data: ")
                    .trim_end(),
            )
            .unwrap();
            assert_eq!(last["ended_reason"], serde_json::to_value(ended).unwrap());
        }
    }

    #[tokio::test]
    async fn a_settling_run_cannot_be_cancelled_into_a_second_terminal() {
        let incident = format!("inc_{}", config::ider::uuid());
        let (settled_tx, settled_rx) = oneshot::channel();
        let (release_tx, release_rx) = oneshot::channel::<()>();
        let task = spawn_rca_task("org_tasks", &incident, move |slot| async move {
            let _ = settled_tx.send(slot.settle());
            let _ = release_rx.await;
        });
        assert!(settled_rx.await.unwrap());
        assert_eq!(
            abort_local_rca_task("org_tasks", &incident),
            LocalRun::Settling
        );
        release_tx.send(()).unwrap();
        task.await.unwrap();
        assert_eq!(
            abort_local_rca_task("org_tasks", &incident),
            LocalRun::Absent
        );
    }

    #[test]
    fn one_start_at_a_time_per_incident_on_this_node() {
        let incident = format!("inc_{}", config::ider::uuid());
        let first = reserve_rca_start("org_tasks", &incident).unwrap();
        assert!(reserve_rca_start("org_tasks", &incident).is_none());
        assert!(reserve_rca_start("org_tasks", "other").is_some());
        drop(first);
        assert!(reserve_rca_start("org_tasks", &incident).is_some());
    }

    #[tokio::test]
    async fn a_cancel_during_the_save_finds_the_run_settling() {
        let incident = format!("inc_{}", config::ider::uuid());
        let (tx, recorder, body) = start(&incident);
        let (release, gate) = oneshot::channel();
        *recorder.1.lock().unwrap() = Some(gate);
        tx.unbounded_send(delta("report")).unwrap();
        tx.unbounded_send(frame(serde_json::json!({"type": "complete"})))
            .unwrap();
        drop(tx);
        recorder.wait_for("save Completed report").await;
        assert_eq!(
            abort_local_rca_task("org_tasks", &incident),
            LocalRun::Settling
        );
        release.send(()).unwrap();
        let frames: Vec<_> = body.map(|f| f.unwrap()).collect().await;
        assert_eq!(kind(frames.last().unwrap()), "complete");
        assert_eq!(recorder.calls(), ["save Completed report", "end Completed"]);
    }

    #[tokio::test]
    async fn a_callee_settles_through_the_task_it_runs_in() {
        assert!(settle_current_rca_task());
        let incident = format!("inc_{}", config::ider::uuid());
        let (claimed_tx, claimed_rx) = oneshot::channel();
        let (release_tx, release_rx) = oneshot::channel::<()>();
        let task = spawn_rca_task("org_tasks", &incident, move |slot| async move {
            let _slot = slot;
            let first = settle_current_rca_task();
            let _ = claimed_tx.send((first, settle_current_rca_task()));
            let _ = release_rx.await;
        });
        assert_eq!(claimed_rx.await.unwrap(), (true, false));
        assert_eq!(
            abort_local_rca_task("org_tasks", &incident),
            LocalRun::Settling
        );
        release_tx.send(()).unwrap();
        task.await.unwrap();
        assert_eq!(
            abort_local_rca_task("org_tasks", &incident),
            LocalRun::Absent
        );
    }

    fn event_log() -> (Arc<Mutex<Vec<String>>>, EventWriter) {
        let log = Arc::new(Mutex::new(Vec::new()));
        let writes = log.clone();
        let write: EventWriter = Box::new(move |event| {
            Box::pin(async move {
                writes
                    .lock()
                    .unwrap()
                    .push(format!("{:?}", event.event_type));
            })
        });
        (log, write)
    }

    async fn slow_begin(log: Arc<Mutex<Vec<String>>>) {
        tokio::time::sleep(Duration::from_millis(30)).await;
        log.lock().unwrap().push("begin".to_string());
    }

    async fn settled_log(log: &Arc<Mutex<Vec<String>>>, len: usize) -> Vec<String> {
        for _ in 0..200 {
            if log.lock().unwrap().len() >= len {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        log.lock().unwrap().clone()
    }

    #[tokio::test]
    async fn a_request_dropped_after_begin_still_ends_the_run_after_its_begin() {
        let (log, write) = event_log();
        let started = BegunRun::start(slow_begin(log.clone()), write);
        assert!(
            tokio::time::timeout(Duration::from_millis(5), started)
                .await
                .is_err()
        );
        let events = settled_log(&log, 2).await;
        assert_eq!(events.len(), 2, "{events:?}");
        assert_eq!(events[0], "begin");
        assert!(events[1].contains(REQUEST_ENDED), "{events:?}");

        let (log, write) = event_log();
        let begun = BegunRun::start(slow_begin(log.clone()), write).await;
        drop(begun);
        let events = settled_log(&log, 2).await;
        assert!(events[1].contains(REQUEST_ENDED), "{events:?}");
    }

    #[tokio::test]
    async fn a_handed_off_or_failed_run_writes_only_its_own_end() {
        let (log, write) = event_log();
        BegunRun::start(slow_begin(log.clone()), write)
            .await
            .hand_off();
        assert_eq!(settled_log(&log, 2).await, ["begin"]);

        let (log, write) = event_log();
        let failed = IncidentEvent::ai_analysis_failed(
            "Agent unavailable",
            AnalysisTriggerType::Manual,
            None,
        );
        BegunRun::start(slow_begin(log.clone()), write)
            .await
            .fail(failed);
        let events = settled_log(&log, 2).await;
        assert_eq!(events.len(), 2, "{events:?}");
        assert!(events[1].contains("Agent unavailable"), "{events:?}");
    }
}
