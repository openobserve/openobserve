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

#[cfg(feature = "cloud")]
use std::sync::{Arc, LazyLock as Lazy};

#[cfg(feature = "cloud")]
use bytes::Bytes;
use config::meta::stream::StreamType;
#[cfg(feature = "cloud")]
use config::{SMTP_CLIENT, get_config, meta::user::UserRole, utils::time::now_micros};
#[cfg(feature = "cloud")]
use dashmap::DashSet;
use infra::schema::is_user_data_stream;
#[cfg(feature = "cloud")]
use infra::table::org_users::OrgUserRecord;
#[cfg(feature = "cloud")]
use lettre::{AsyncTransport, Message, message::SinglePart};

/// Meta key whose presence means the org's first-data email was sent or deliberately skipped.
#[cfg(feature = "cloud")]
pub const FIRST_DATA_KEY_PREFIX: &str = "/onboarding/first_data_email/";
#[cfg(feature = "cloud")]
const OLDER_STREAM_US: i64 = 10 * 60 * 1_000_000;
#[cfg(feature = "cloud")]
const MARKER_SENT: &str = "sent";
#[cfg(feature = "cloud")]
const MARKER_SKIPPED: &str = "skipped";

/// Orgs this process has finished with; checked before any IO.
#[cfg(feature = "cloud")]
pub static FIRST_DATA_SETTLED: Lazy<DashSet<String>> = Lazy::new(DashSet::new);
/// Orgs with a task running on this node, so a batch creating many streams spawns one task.
#[cfg(feature = "cloud")]
pub static FIRST_DATA_IN_FLIGHT: Lazy<DashSet<String>> = Lazy::new(DashSet::new);

#[cfg(feature = "cloud")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Outcome {
    Sent,
    AlreadyMarked,
    HadEarlierData,
    SmtpDisabled,
}

#[cfg(feature = "cloud")]
#[async_trait::async_trait]
trait FirstDataIo: Send + Sync {
    type Guard: Send;

    fn smtp_enabled(&self) -> bool;
    async fn marker_set(&self, org_id: &str) -> anyhow::Result<bool>;
    async fn write_marker(&self, org_id: &str, value: &'static str) -> anyhow::Result<()>;
    /// created_at (µs) of each other user-data stream of the org; None when the schema has none.
    async fn other_streams_created_at(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Vec<Option<i64>>;
    async fn lock(&self, org_id: &str) -> anyhow::Result<Self::Guard>;
    async fn unlock(&self, guard: Self::Guard);
    async fn recipients(&self, org_id: &str) -> anyhow::Result<Vec<String>>;
    async fn send(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        recipients: &[String],
    ) -> anyhow::Result<()>;
}

#[cfg(feature = "cloud")]
struct LiveIo;

#[cfg(feature = "cloud")]
#[async_trait::async_trait]
impl FirstDataIo for LiveIo {
    type Guard = Option<infra::dist_lock::Locker>;

    fn smtp_enabled(&self) -> bool {
        get_config().smtp.smtp_enabled && SMTP_CLIENT.is_some()
    }

    async fn marker_set(&self, org_id: &str) -> anyhow::Result<bool> {
        let db = infra::db::get_db().await;
        Ok(db.get_if_exists(&marker_key(org_id)).await?.is_some())
    }

    async fn write_marker(&self, org_id: &str, value: &'static str) -> anyhow::Result<()> {
        // Straight to the region's meta store: the marker is region-local, never super-cluster.
        let db = infra::db::get_db().await;
        db.put(
            &marker_key(org_id),
            Bytes::from_static(value.as_bytes()),
            infra::db::NO_NEED_WATCH,
            None,
        )
        .await?;
        Ok(())
    }

    async fn other_streams_created_at(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
    ) -> Vec<Option<i64>> {
        let mut created = Vec::new();
        for kind in [StreamType::Logs, StreamType::Metrics, StreamType::Traces] {
            for name in db::schema::list_streams_from_cache(org_id, kind).await {
                if !is_user_data_stream(kind, &name) || (kind == stream_type && name == stream_name)
                {
                    continue;
                }
                if let Ok(schema) = infra::schema::get(org_id, &name, kind).await {
                    created.push(infra::schema::unwrap_stream_created_at(&schema));
                }
            }
        }
        created
    }

    async fn lock(&self, org_id: &str) -> anyhow::Result<Self::Guard> {
        Ok(infra::dist_lock::lock(&format!("{}/lock", marker_key(org_id)), 0).await?)
    }

    async fn unlock(&self, guard: Self::Guard) {
        if let Err(e) = infra::dist_lock::unlock(&guard).await {
            log::error!("[FIRST_DATA] unlock failed: {e}");
        }
    }

    async fn recipients(&self, org_id: &str) -> anyhow::Result<Vec<String>> {
        let users = infra::table::org_users::list_users_by_org(org_id).await?;
        Ok(owner_emails(&users))
    }

    async fn send(
        &self,
        org_id: &str,
        stream_type: StreamType,
        stream_name: &str,
        recipients: &[String],
    ) -> anyhow::Result<()> {
        let cfg = get_config();
        let org_name = crate::organization::get_org(org_id)
            .await
            .map_or_else(|| org_id.to_string(), |org| org.name);
        let mut email = Message::builder()
            .from(cfg.smtp.smtp_from_email.parse()?)
            .subject(email_subject(&org_name));
        for recipient in recipients {
            email = email.to(recipient.parse()?);
        }
        if !cfg.smtp.smtp_reply_to.is_empty() {
            email = email.reply_to(cfg.smtp.smtp_reply_to.parse()?);
        }
        let logs_url = logs_link(
            &format!("{}{}", cfg.common.web_url, cfg.common.base_uri),
            org_id,
            stream_type,
            stream_name,
        );
        let email = email.singlepart(SinglePart::html(email_body(
            &org_name,
            stream_name,
            &logs_url,
        )))?;
        let client = SMTP_CLIENT
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("smtp client not configured"))?;
        client.send(email).await?;
        Ok(())
    }
}

/// Called when a write creates a stream; returns at once and does any IO on a spawned task.
pub fn on_user_stream_created(org_id: &str, stream_type: StreamType, stream_name: &str) {
    if !is_user_data_stream(stream_type, stream_name) {
        return;
    }
    crate::ingestion::rejections::on_user_stream_created(org_id);
    #[cfg(feature = "cloud")]
    spawn_first_data(Arc::new(LiveIo), org_id, stream_type, stream_name);
}

#[cfg(feature = "cloud")]
fn spawn_first_data<I: FirstDataIo + 'static>(
    io: Arc<I>,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> Option<tokio::task::JoinHandle<()>> {
    if !is_user_data_stream(stream_type, stream_name) || FIRST_DATA_SETTLED.contains(org_id) {
        return None;
    }
    if !FIRST_DATA_IN_FLIGHT.insert(org_id.to_string()) {
        return None;
    }
    let trigger_us = now_micros();
    let org_id = org_id.to_string();
    let stream_name = stream_name.to_string();
    Some(tokio::spawn(async move {
        match settle(io.as_ref(), &org_id, stream_type, &stream_name, trigger_us).await {
            Ok(outcome) => {
                log::info!("[FIRST_DATA] org {org_id}: {outcome:?}");
                FIRST_DATA_SETTLED.insert(org_id.clone());
            }
            Err(e) => log::warn!("[FIRST_DATA] org {org_id}: {e}"),
        }
        FIRST_DATA_IN_FLIGHT.remove(&org_id);
    }))
}

#[cfg(feature = "cloud")]
async fn settle<I: FirstDataIo>(
    io: &I,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
    trigger_us: i64,
) -> anyhow::Result<Outcome> {
    if !io.smtp_enabled() {
        return Ok(Outcome::SmtpDisabled);
    }
    if io.marker_set(org_id).await? {
        return Ok(Outcome::AlreadyMarked);
    }
    let others = io
        .other_streams_created_at(org_id, stream_type, stream_name)
        .await;
    if had_earlier_data(&others, trigger_us) {
        io.write_marker(org_id, MARKER_SKIPPED).await?;
        return Ok(Outcome::HadEarlierData);
    }
    let guard = io.lock(org_id).await?;
    let result = send_once(io, org_id, stream_type, stream_name).await;
    io.unlock(guard).await;
    result
}

#[cfg(feature = "cloud")]
async fn send_once<I: FirstDataIo>(
    io: &I,
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> anyhow::Result<Outcome> {
    if io.marker_set(org_id).await? {
        return Ok(Outcome::AlreadyMarked);
    }
    let recipients = io.recipients(org_id).await?;
    if !recipients.is_empty() {
        io.send(org_id, stream_type, stream_name, &recipients)
            .await?;
    }
    io.write_marker(org_id, MARKER_SENT).await?;
    Ok(Outcome::Sent)
}

/// A stream with no created_at predates that metadata, so it counts as earlier data.
#[cfg(feature = "cloud")]
fn had_earlier_data(others: &[Option<i64>], trigger_us: i64) -> bool {
    others
        .iter()
        .any(|created| created.is_none_or(|at| at < trigger_us - OLDER_STREAM_US))
}

#[cfg(feature = "cloud")]
fn owner_emails(users: &[OrgUserRecord]) -> Vec<String> {
    users
        .iter()
        .filter(|user| matches!(user.role, UserRole::Root | UserRole::Admin))
        .map(|user| user.email.clone())
        .collect()
}

#[cfg(feature = "cloud")]
fn marker_key(org_id: &str) -> String {
    format!("{FIRST_DATA_KEY_PREFIX}{org_id}")
}

#[cfg(feature = "cloud")]
fn email_subject(org_name: &str) -> String {
    format!("Your data is flowing in {org_name}")
}

#[cfg(feature = "cloud")]
fn email_body(org_name: &str, stream_name: &str, logs_url: &str) -> String {
    format!(
        "<p>The first data for {org} arrived in the stream <b>{stream}</b>. <a href=\"{url}\">Open it in Logs</a>.</p>",
        org = escape_html(org_name),
        stream = escape_html(stream_name),
        url = escape_html(logs_url),
    )
}

#[cfg(feature = "cloud")]
fn logs_link(web_root: &str, org_id: &str, stream_type: StreamType, stream_name: &str) -> String {
    let encode =
        |value: &str| url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>();
    format!(
        "{}/web/logs?org_identifier={}&stream_type={}&stream={}",
        web_root.trim_end_matches('/'),
        encode(org_id),
        stream_type,
        encode(stream_name),
    )
}

#[cfg(feature = "cloud")]
fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for c in value.chars() {
        match c {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(c),
        }
    }
    escaped
}

#[cfg(all(test, feature = "cloud"))]
mod tests {
    use std::{
        sync::{
            Mutex,
            atomic::{AtomicUsize, Ordering},
        },
        time::Duration,
    };

    use tokio::sync::{Mutex as AsyncMutex, Notify, OwnedMutexGuard};

    use super::*;

    struct StubIo {
        smtp: bool,
        marker: Mutex<Option<&'static str>>,
        others: Vec<Option<i64>>,
        recipients: Vec<String>,
        lock: Arc<AsyncMutex<()>>,
        send_gate: Option<Arc<Notify>>,
        io_calls: AtomicUsize,
        sends: AtomicUsize,
    }

    impl StubIo {
        fn new(others: Vec<Option<i64>>) -> Self {
            Self {
                smtp: true,
                marker: Mutex::new(None),
                others,
                recipients: vec!["owner@acme.test".to_string()],
                lock: Arc::new(AsyncMutex::new(())),
                send_gate: None,
                io_calls: AtomicUsize::new(0),
                sends: AtomicUsize::new(0),
            }
        }

        fn touch(&self) {
            self.io_calls.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[async_trait::async_trait]
    impl FirstDataIo for StubIo {
        type Guard = OwnedMutexGuard<()>;

        fn smtp_enabled(&self) -> bool {
            self.smtp
        }

        async fn marker_set(&self, _org_id: &str) -> anyhow::Result<bool> {
            self.touch();
            tokio::task::yield_now().await;
            Ok(self.marker.lock().unwrap().is_some())
        }

        async fn write_marker(&self, _org_id: &str, value: &'static str) -> anyhow::Result<()> {
            self.touch();
            *self.marker.lock().unwrap() = Some(value);
            Ok(())
        }

        async fn other_streams_created_at(
            &self,
            _org_id: &str,
            _stream_type: StreamType,
            _stream_name: &str,
        ) -> Vec<Option<i64>> {
            self.touch();
            self.others.clone()
        }

        async fn lock(&self, _org_id: &str) -> anyhow::Result<Self::Guard> {
            self.touch();
            Ok(self.lock.clone().lock_owned().await)
        }

        async fn unlock(&self, guard: Self::Guard) {
            drop(guard);
        }

        async fn recipients(&self, _org_id: &str) -> anyhow::Result<Vec<String>> {
            self.touch();
            Ok(self.recipients.clone())
        }

        async fn send(
            &self,
            _org_id: &str,
            _stream_type: StreamType,
            _stream_name: &str,
            _recipients: &[String],
        ) -> anyhow::Result<()> {
            self.touch();
            if let Some(gate) = &self.send_gate {
                gate.notified().await;
            }
            self.sends.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    fn record(email: &str, role: UserRole) -> OrgUserRecord {
        OrgUserRecord {
            email: email.to_string(),
            org_id: "acme".to_string(),
            role,
            token: String::new(),
            rum_token: None,
            created_at: 0,
            allow_static_token: true,
        }
    }

    #[tokio::test]
    async fn test_settled_org_is_skipped_without_io() {
        let org = "first_data_settled";
        FIRST_DATA_SETTLED.insert(org.to_string());
        let io = Arc::new(StubIo::new(vec![]));
        assert!(spawn_first_data(io.clone(), org, StreamType::Logs, "app").is_none());
        assert_eq!(io.io_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_internal_and_non_user_streams_are_skipped_without_io() {
        let io = Arc::new(StubIo::new(vec![]));
        for (stream_type, name) in [
            (StreamType::Logs, "usage"),
            (StreamType::Logs, "_o2_db_stats"),
            (StreamType::Logs, "_anomalies"),
            (StreamType::EnrichmentTables, "geo"),
            (StreamType::Metadata, "app"),
        ] {
            assert!(
                spawn_first_data(io.clone(), "first_data_internal", stream_type, name).is_none()
            );
        }
        assert_eq!(io.io_calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn test_hook_returns_before_a_blocking_mailer_finishes() {
        let org = "first_data_blocking";
        let gate = Arc::new(Notify::new());
        let io = Arc::new(StubIo {
            send_gate: Some(gate.clone()),
            ..StubIo::new(vec![])
        });
        let handle = spawn_first_data(io.clone(), org, StreamType::Logs, "app").unwrap();
        assert!(FIRST_DATA_IN_FLIGHT.contains(org));
        assert!(spawn_first_data(io.clone(), org, StreamType::Logs, "other").is_none());
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert_eq!(io.sends.load(Ordering::SeqCst), 0);
        gate.notify_one();
        handle.await.unwrap();
        assert_eq!(io.sends.load(Ordering::SeqCst), 1);
        assert!(FIRST_DATA_SETTLED.contains(org));
        assert!(!FIRST_DATA_IN_FLIGHT.contains(org));
    }

    #[tokio::test]
    async fn test_two_concurrent_tasks_send_once() {
        let io = StubIo::new(vec![]);
        let now = now_micros();
        let (a, b) = tokio::join!(
            settle(&io, "first_data_race", StreamType::Logs, "a", now),
            settle(&io, "first_data_race", StreamType::Metrics, "b", now),
        );
        let mut outcomes = vec![a.unwrap(), b.unwrap()];
        outcomes.sort_by_key(|o| format!("{o:?}"));
        assert_eq!(outcomes, vec![Outcome::AlreadyMarked, Outcome::Sent]);
        assert_eq!(io.sends.load(Ordering::SeqCst), 1);
        assert_eq!(*io.marker.lock().unwrap(), Some(MARKER_SENT));
    }

    #[tokio::test]
    async fn test_no_send_when_another_stream_predates_the_trigger_by_ten_minutes() {
        let now = now_micros();
        let io = StubIo::new(vec![Some(now - OLDER_STREAM_US - 1)]);
        let outcome = settle(&io, "first_data_old", StreamType::Logs, "app", now)
            .await
            .unwrap();
        assert_eq!(outcome, Outcome::HadEarlierData);
        assert_eq!(io.sends.load(Ordering::SeqCst), 0);
        assert_eq!(*io.marker.lock().unwrap(), Some(MARKER_SKIPPED));
    }

    #[tokio::test]
    async fn test_sibling_streams_from_the_same_batch_still_send_once() {
        let now = now_micros();
        let io = StubIo::new(vec![Some(now - 1_000_000), Some(now), Some(now - 900_000)]);
        let outcome = settle(&io, "first_data_siblings", StreamType::Metrics, "up", now)
            .await
            .unwrap();
        assert_eq!(outcome, Outcome::Sent);
        assert_eq!(io.sends.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn test_no_send_and_no_write_without_smtp() {
        let io = StubIo {
            smtp: false,
            ..StubIo::new(vec![])
        };
        let outcome = settle(
            &io,
            "first_data_no_smtp",
            StreamType::Logs,
            "app",
            now_micros(),
        )
        .await
        .unwrap();
        assert_eq!(outcome, Outcome::SmtpDisabled);
        assert_eq!(io.io_calls.load(Ordering::SeqCst), 0);
        assert_eq!(*io.marker.lock().unwrap(), None);
    }

    #[test]
    fn test_recipients_are_root_and_admin_members() {
        let users = [
            record("root@acme.test", UserRole::Root),
            record("admin@acme.test", UserRole::Admin),
            record("editor@acme.test", UserRole::Editor),
            record("viewer@acme.test", UserRole::Viewer),
            record("sa@acme.test", UserRole::ServiceAccount),
        ];
        assert_eq!(
            owner_emails(&users),
            vec!["root@acme.test".to_string(), "admin@acme.test".to_string()]
        );
    }

    #[test]
    fn test_legacy_stream_without_created_at_counts_as_earlier_data() {
        assert!(had_earlier_data(&[None], now_micros()));
        assert!(!had_earlier_data(&[], now_micros()));
    }

    #[test]
    fn test_email_escapes_names_and_links_to_logs() {
        let link = logs_link("https://cloud.test/", "acme", StreamType::Logs, "a b&c");
        assert_eq!(
            link,
            "https://cloud.test/web/logs?org_identifier=acme&stream_type=logs&stream=a+b%26c"
        );
        let body = email_body("<Acme>", "s\"1", &link);
        assert!(body.contains("&lt;Acme&gt;"));
        assert!(body.contains("s&quot;1"));
        assert!(body.contains("stream=a+b%26c"));
        assert_eq!(email_subject("Acme"), "Your data is flowing in Acme");
    }
}
