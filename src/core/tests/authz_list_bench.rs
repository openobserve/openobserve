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

#![cfg(feature = "enterprise")]

#[path = "common/authz.rs"]
mod common_authz;

use std::{
    borrow::Cow,
    cell::RefCell,
    collections::{HashMap, HashSet, hash_map::Entry},
    env,
    fs::{self, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        Arc, LazyLock, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use common_authz::{add_member, cache_member, connect, declare_deadline, seed_role, user_record};
use config::{
    meta::{
        service_identity::{EnvSource, WhereSummaryRecord},
        service_streams::{RelatedStreams, StreamInfo},
        stream::{SecuritySourceSetting, StreamType},
        user::UserRole,
    },
    metrics::authz::AUTHZ_FALLBACK_CHECKS_TOTAL,
};
use futures::{StreamExt, future::join_all, stream};
use infra::table::service_streams::ServiceRecord;
use o2_dex::meta::auth::{O2EntityAuthorization, Permission};
use o2_openfga::{
    authorizer::{
        accounting::set_call_observer,
        authz::{get_org_creation_tuples, ownership_tuples, update_tuples},
        groups,
    },
    meta::mapping::{NON_OWNING_ORG, OFGA_MODELS},
};
use openobserve_core::{
    authz::{
        Denial, QuerySource, StreamAccessChecker, StreamReadMemo, TypedStream,
        accounting::{CallCounts, CallOp, CallOutcome, REQUEST_CALLS, in_own_scope},
        active_checker, authorize_with,
        list::{
            Bypass, LegacyChecks, ListMode, ObjectRef, ObjectsQuery, OrgWideCheck,
            SITE_AUTOOBSERVE_STREAMS, SITE_DB_MONITORING, SITE_GEN_AI, SITE_SECURITY_SOURCES,
            SITE_SERVICE_EVIDENCE, SITE_SERVICE_GRAPH, SITE_SERVICE_IDENTITY, SITE_SERVICE_STREAMS,
            SITE_SERVICE_STREAMS_CORRELATE, SMALL_REQUEST_OBJECTS, Scope, StreamSet, TodayChecks,
            legacy_readable_streams, objects_in_mode, readable_streams, stream_read_query,
        },
        readable_related_streams, readable_service_records,
    },
    security::{admit_security_sources_once_with, readable_sources_in_mode},
    service_identity::access::{ReadableStreams, RumReads},
    traces::service_graph::api::readable_trace_streams_among,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    net::TcpListener,
    sync::{Notify, oneshot},
    task::JoinSet,
    time::{self, MissedTickBehavior},
};

tokio::task_local! {
    static CALL_TIMINGS: RefCell<[Vec<Duration>; OPS.len()]>;
}

const SECURITY_SCALE: usize = 2_000;
const SECURITY_P95_MS: f64 = 1_500.0;
const S6_SCALE: usize = 1_000;
const S6_OBJECTS: usize = 500;
const S6: &str = "s6_authorize_with";
const NEIGHBOR_PERIOD: Duration = Duration::from_millis(50);
const LIST_LIMIT: Duration = Duration::from_secs(1);
const RUM_STREAM: &str = "_rumdata";
const SCALES: [usize; 5] = [100, S6_SCALE, SECURITY_SCALE, 2_858, 5_000];
const SHAPES: [&str; 5] = ["direct", "group", "type_wide", "none", "editor"];
const MODES: [&str; 3] = ["off", "on", "shadow"];
const TYPES: [StreamType; 3] = [StreamType::Logs, StreamType::Metrics, StreamType::Traces];
const OPS: [CallOp; 4] = [CallOp::Check, CallOp::Role, CallOp::Probe, CallOp::List];
const SMALL: &str = "service_streams_small";
const PATHS: [&str; 10] = [
    SITE_SERVICE_STREAMS,
    SITE_SERVICE_STREAMS_CORRELATE,
    SITE_SERVICE_IDENTITY,
    SITE_SECURITY_SOURCES,
    SITE_DB_MONITORING,
    "autoobserve_streams/logs",
    "autoobserve_streams/metrics",
    "autoobserve_streams/traces",
    SITE_SERVICE_GRAPH,
    SITE_GEN_AI,
];
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static RUNTIME: LazyLock<tokio::runtime::Runtime> = LazyLock::new(|| {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .expect("create bench runtime")
});

struct Settings {
    runs_on: usize,
    runs_off: usize,
    cgroup: Option<PathBuf>,
    metrics_url: Option<String>,
    cpus: Option<f64>,
    out: PathBuf,
    seed_only: bool,
    store_file: Option<PathBuf>,
    cold: bool,
    cold_cells: ColdCells,
    cold_key: Option<String>,
    cold_list: Option<PathBuf>,
    cold_records: HashMap<String, ColdRecord>,
}

impl Settings {
    fn from_env() -> Self {
        Self {
            runs_on: positive_var("O2_BENCH_RUNS_ON", 100),
            runs_off: positive_var("O2_BENCH_RUNS_OFF", 3),
            cgroup: env::var_os("O2_BENCH_FGA_CGROUP").map(PathBuf::from),
            metrics_url: env::var("O2_BENCH_FGA_METRICS_URL").ok(),
            cpus: env::var("O2_BENCH_FGA_CPUS").ok().map(|value| {
                let cpus: f64 = value.parse().expect("O2_BENCH_FGA_CPUS must be numeric");
                assert!(cpus.is_finite() && cpus > 0.0);
                cpus
            }),
            out: env::var_os("O2_BENCH_OUT")
                .map_or_else(|| PathBuf::from("target/authz-bench.jsonl"), PathBuf::from),
            seed_only: env::var("O2_BENCH_SEED_ONLY").as_deref() == Ok("1"),
            store_file: env::var_os("O2_BENCH_STORE_ID_FILE").map(PathBuf::from),
            cold: env::var("O2_BENCH_COLD").as_deref() == Ok("1"),
            cold_cells: ColdCells::from_env(),
            cold_key: env::var("O2_BENCH_COLD_KEY").ok(),
            cold_list: env::var_os("O2_BENCH_COLD_LIST").map(PathBuf::from),
            cold_records: env::var_os("O2_BENCH_COLD_FILE")
                .map_or_else(HashMap::new, |path| read_cold_records(Path::new(&path))),
        }
    }
}

#[derive(Clone, Copy)]
enum ColdCells {
    All,
    Gates,
    None,
}

impl ColdCells {
    fn from_env() -> Self {
        match env::var("O2_BENCH_COLD_CELLS").as_deref() {
            Ok("all") | Err(env::VarError::NotPresent) => Self::All,
            Ok("gates") => Self::Gates,
            Ok("none") => Self::None,
            Ok(value) => panic!("unknown O2_BENCH_COLD_CELLS value {value:?}"),
            Err(error) => panic!("read O2_BENCH_COLD_CELLS: {error}"),
        }
    }

    fn selects(self, cell: Cell, cpus: Option<f64>) -> bool {
        match self {
            Self::All => true,
            Self::Gates => cell.gate(cpus).is_some(),
            Self::None => false,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
struct Cell {
    path: &'static str,
    scale: usize,
    shape: &'static str,
    users: usize,
    mode: &'static str,
}

impl Cell {
    fn selected(self, explicit_modes: bool, cpus: Option<f64>) -> bool {
        if self.path == S6 {
            return (self.scale, self.shape, self.users, self.mode)
                == (S6_SCALE, "direct", 1, "on");
        }
        if self.scale == SECURITY_SCALE {
            return (self.path, self.shape, self.users) == (SITE_SECURITY_SOURCES, "direct", 1)
                && (self.mode == "on" || (explicit_modes && self.mode == "off"));
        }
        if self.path == SMALL && self.scale != 5_000 {
            return false;
        }
        if self.mode == "shadow" && self.scale != 2_858 {
            return false;
        }
        self.mode != "off"
            || self.scale != 5_000
            || self.path == SMALL
            || explicit_modes
            || cpus != Some(0.2)
    }

    fn key(self, cpus: Option<f64>) -> String {
        let cpus = cpus.map_or_else(|| "unset".to_string(), |value| value.to_string());
        let Self {
            path,
            scale,
            shape,
            users,
            mode,
        } = self;
        format!("{path}/{scale}/{shape}/{cpus}/{users}/{mode}")
    }

    fn gate(self, cpus: Option<f64>) -> Option<(&'static str, f64)> {
        if (self.path, self.scale, self.mode) != (SITE_SERVICE_STREAMS, 2_858, "on") {
            return None;
        }
        let shape = match self.shape {
            "direct" | "group" => "subset",
            shape => shape,
        };
        match (shape, cpus?, self.users) {
            ("subset", 1.0, 1) => Some(("G-1", 150.0)),
            ("subset", 1.0, 4) => Some(("G-1b", 250.0)),
            ("subset", 0.2, 4) => Some(("G-2", 2_000.0)),
            ("type_wide", 0.2, 4) => Some(("G-3", 550.0)),
            ("none", 0.2, 1) => Some(("G-4", 600.0)),
            _ => None,
        }
    }

    fn budget(self, types: usize) -> Option<u32> {
        match self.path {
            SITE_SERVICE_STREAMS | SITE_SERVICE_STREAMS_CORRELATE | SMALL => {
                Some(if types > TYPES.len() { 15 } else { 12 })
            }
            SITE_SERVICE_IDENTITY => Some(12),
            SITE_SECURITY_SOURCES => Some(7),
            // The S5 caps count the shared C probe and both B probes (C5-3): prelude + C + 2B +
            // list.
            SITE_DB_MONITORING => Some(5),
            SITE_SERVICE_GRAPH => Some(5),
            path if path.starts_with(SITE_AUTOOBSERVE_STREAMS) => Some(1 + 3 * types as u32),
            _ => None,
        }
    }

    fn peak_limit(self, types: usize) -> usize {
        if self.path == S6 {
            return 16;
        }
        // Each concurrent user can hold T lists plus 16 Checks.
        self.users * (types + 16)
    }

    fn security_p95_gate(self, p95_ms: Option<f64>) -> Option<bool> {
        if (self.path, self.scale, self.mode) == (SITE_SECURITY_SOURCES, SECURITY_SCALE, "on") {
            return p95_ms.map(|p95| p95 <= SECURITY_P95_MS);
        }
        None
    }
}

struct Fixture {
    org: String,
    streams: Vec<(StreamType, String)>,
}

impl Fixture {
    fn new(scale: usize) -> Self {
        let org = format!("bench_{scale}");
        let counts = if scale == SECURITY_SCALE {
            [scale, 0, 0]
        } else {
            let logs = (scale * 93 + 1_429) / 2_858;
            let traces = (scale * 24 + 1_429) / 2_858;
            [logs, scale - logs - traces, traces]
        };
        let streams = TYPES
            .into_iter()
            .zip(counts)
            .flat_map(|(kind, count)| {
                let org = &org;
                (0..count).map(move |index| (kind, format!("{org}_{}_{index:04}", kind.as_str())))
            })
            .collect();
        Self { org, streams }
    }

    fn email(&self, shape: &str) -> String {
        format!("{shape}@{}.example.com", self.org.replace('_', "-"))
    }

    fn cache_members(&self) {
        for shape in SHAPES {
            let email = self.email(shape);
            cache_member(&self.org, &email, user_record(&email), member_role(shape));
        }
    }

    async fn seed(&self) {
        let mut tuples = Vec::new();
        get_org_creation_tuples(
            &self.org,
            &mut tuples,
            OFGA_MODELS.values().map(|model| model.key).collect(),
            NON_OWNING_ORG.to_vec(),
        )
        .await;
        tuples.extend(self.streams.iter().flat_map(|(kind, name)| {
            ownership_tuples(&self.org, &format!("{kind}:{name}"), "", "")
        }));
        tuples.extend(ownership_tuples(
            &self.org,
            &format!("logs:{RUM_STREAM}"),
            "",
            "",
        ));
        update_tuples(tuples, vec![])
            .await
            .expect("write org and stream tuples");
        for shape in SHAPES {
            let email = self.email(shape);
            add_member(&self.org, &email, &email, member_role(shape)).await;
        }
        self.seed_grants().await;
        self.seed_noise().await;
    }

    fn subset_streams(&self) -> impl Iterator<Item = &(StreamType, String)> {
        let count = self.streams.len();
        let granted = (count * 11).div_ceil(100);
        (0..granted).map(move |i| &self.streams[i * count / granted])
    }

    fn configured_sources(&self) -> HashSet<String> {
        let subset: HashSet<_> = self.subset_streams().collect();
        self.streams
            .iter()
            .filter(|stream| stream.0 == StreamType::Logs && !subset.contains(stream))
            .take(2)
            .map(|(_, name)| name.clone())
            .collect()
    }

    async fn seed_grants(&self) {
        let subset: Vec<_> = self
            .subset_streams()
            .map(|(kind, name)| grant(format!("{kind}:{name}"), Permission::AllowGet))
            .chain([grant(format!("logs:{RUM_STREAM}"), Permission::AllowGet)])
            .collect();
        seed_role(
            &self.org,
            "subset",
            &subset,
            HashSet::from([self.email("direct")]),
        )
        .await;
        groups::create_group(
            &self.org,
            "readers",
            HashSet::from([self.email("group")]),
            HashSet::from(["subset".to_string()]),
        )
        .await
        .expect("assign subset role through a group");
        let security = grant(format!("security:_all_{}", self.org), Permission::AllowGet);
        seed_role(
            &self.org,
            "security_reader",
            &[security],
            HashSet::from([self.email("direct")]),
        )
        .await;
        let wide = grant(format!("stream:_all_{}", self.org), Permission::AllowAll);
        seed_role(
            &self.org,
            "wide",
            &[wide],
            HashSet::from([self.email("type_wide")]),
        )
        .await;
    }

    async fn seed_noise(&self) {
        let kind = if self.streams.len() == SECURITY_SCALE {
            StreamType::Logs
        } else {
            StreamType::Metrics
        };
        let targets_of_kind: Vec<_> = self
            .streams
            .iter()
            .filter(|(stream_type, _)| *stream_type == kind)
            .map(|(_, name)| name)
            .collect();
        let admins = [0, 1, 2].map(|i| self.email(&format!("noise_admin_{i}")));
        for email in &admins {
            add_member(&self.org, email, email, UserRole::Admin).await;
        }
        let targets = ["stream", "metrics", "logs", "traces"];
        let mut roles = HashSet::new();
        for i in 0..60 {
            let role = format!("noise_{i:02}");
            let wide = format!("{}:_all_{}", targets[i % targets.len()], self.org);
            let permission = if i % 2 == 0 {
                Permission::AllowGet
            } else {
                Permission::AllowAll
            };
            let mut grants = vec![grant(wide, permission)];
            grants.extend((0..50).map(|j| {
                let name = targets_of_kind[(i * 137 + j * 53) % targets_of_kind.len()];
                grant(format!("{kind}:{name}"), Permission::AllowGet)
            }));
            seed_role(
                &self.org,
                &role,
                &grants,
                HashSet::from([admins[i % admins.len()].clone()]),
            )
            .await;
            roles.insert(role);
        }
        let mut users = HashSet::new();
        for i in 0..5 {
            let email = self.email(&format!("noise_user_{i}"));
            add_member(&self.org, &email, &email, UserRole::User).await;
            users.insert(email);
        }
        groups::create_group(&self.org, "noise", users, roles)
            .await
            .expect("attach noise roles");
    }
}

struct Workload {
    cell: Cell,
    org: String,
    user: String,
    requested: StreamSet,
    types: Vec<StreamType>,
    records: Vec<ServiceRecord>,
    related: Option<RelatedStreams>,
    configured_sources: HashSet<String>,
    summaries: Vec<WhereSummaryRecord>,
    evidence: Vec<String>,
    s6: Option<S6Workload>,
}

impl Workload {
    fn new(cell: Cell, fixture: &Fixture) -> Self {
        let (types, limit) = match cell.path {
            SMALL => (&TYPES[..], 10),
            SITE_SECURITY_SOURCES | "autoobserve_streams/logs" => {
                (&[StreamType::Logs][..], usize::MAX)
            }
            "autoobserve_streams/metrics" => (&[StreamType::Metrics][..], usize::MAX),
            SITE_DB_MONITORING
            | SITE_SERVICE_GRAPH
            | SITE_SERVICE_IDENTITY
            | "autoobserve_streams/traces" => (&[StreamType::Traces][..], usize::MAX),
            SITE_GEN_AI => (&TYPES[..2], usize::MAX),
            _ => (&TYPES[..], usize::MAX),
        };
        let selected = fixture
            .streams
            .iter()
            .filter(|(kind, _)| types.contains(kind));
        let requested: StreamSet = if cell.path == SMALL {
            // Preserve all three query types when the request samples only ten streams.
            types
                .iter()
                .enumerate()
                .flat_map(|(i, ty)| {
                    selected
                        .clone()
                        .filter(move |(kind, _)| kind == ty)
                        .take(limit / types.len() + usize::from(i < limit % types.len()))
                })
                .cloned()
                .collect()
        } else if cell.path == S6 {
            selected.step_by(S6_SCALE / S6_OBJECTS).cloned().collect()
        } else {
            selected.cloned().collect()
        };
        let s6 = (cell.path == S6).then(|| S6Workload::new(fixture, &requested));
        let mut workload = Self {
            cell,
            org: fixture.org.clone(),
            user: fixture.email(cell.shape),
            requested,
            types: types.to_vec(),
            records: Vec::new(),
            related: None,
            configured_sources: HashSet::new(),
            summaries: Vec::new(),
            evidence: Vec::new(),
            s6,
        };
        if cell.path == SITE_SERVICE_STREAMS_CORRELATE {
            workload.related = Some(workload.related_streams());
        }
        if matches!(cell.path, SITE_SERVICE_STREAMS | SMALL) {
            workload.records = service_records(&workload.org, &workload.requested);
        }
        if cell.path == SITE_SECURITY_SOURCES {
            workload.configured_sources = fixture.configured_sources();
            assert!(!workload.configured_sources.is_empty());
        }
        if cell.path == SITE_SERVICE_IDENTITY {
            workload.summaries = workload
                .requested
                .iter()
                .map(|(_, name)| summary(&workload.org, "traces", name))
                .chain([summary(&workload.org, "rum", RUM_STREAM)])
                .collect();
            workload
                .requested
                .insert((StreamType::Logs, RUM_STREAM.to_string()));
            workload.types = TYPES.to_vec();
            workload
                .evidence
                .push(format!("logs/{}_logs_0000", fixture.org));
        }
        workload
    }

    fn related_streams(&self) -> RelatedStreams {
        let of_type = |ty| {
            self.requested
                .iter()
                .filter(|(kind, _)| *kind == ty)
                .map(|(_, name)| StreamInfo::with_type(name.clone(), ty))
                .collect()
        };
        RelatedStreams {
            logs: of_type(StreamType::Logs),
            metrics: of_type(StreamType::Metrics),
            traces: of_type(StreamType::Traces),
            profiles: Vec::new(),
        }
    }

    async fn answer(&self, checker: &dyn StreamAccessChecker) -> Answer {
        let mut evidence_allowed = None;
        let readable = match self.cell.path {
            SITE_SERVICE_IDENTITY => {
                let (streams, evidence) = self.identity().await;
                evidence_allowed = Some(evidence);
                Some(streams)
            }
            SITE_SERVICE_STREAMS | SMALL => Some(self.service_streams(checker).await),
            SITE_SERVICE_STREAMS_CORRELATE => Some(self.correlate(checker).await),
            SITE_SECURITY_SOURCES => self.security_sources(checker).await,
            SITE_SERVICE_GRAPH => {
                let allowed = readable_trace_streams_among(
                    &self.org,
                    &self.user,
                    || async {
                        self.requested
                            .iter()
                            .map(|(_, name)| name.clone())
                            .collect()
                    },
                    None,
                    &Scope::every(),
                )
                .await
                .expect("service graph streams")
                .map(|names| {
                    names
                        .into_iter()
                        .map(|name| (StreamType::Traces, name))
                        .collect()
                });
                return Answer {
                    allowed,
                    evidence_allowed,
                };
            }
            SITE_DB_MONITORING | SITE_GEN_AI => self.objects(checker).await,
            S6 => Some(self.s6_answer(checker).await),
            path if path.starts_with(SITE_AUTOOBSERVE_STREAMS) => readable_streams(
                checker,
                SITE_AUTOOBSERVE_STREAMS,
                &self.user,
                &self.org,
                self.requested.clone(),
                &Scope::every(),
            )
            .await
            .expect("readable streams"),
            path => unreachable!("benchmark workload for {path}"),
        };
        Answer {
            allowed: Some(readable.unwrap_or_else(|| self.requested.clone())),
            evidence_allowed,
        }
    }

    async fn s6_answer(&self, checker: &dyn StreamAccessChecker) -> StreamSet {
        let s6 = self.s6.as_ref().expect("S6 workload");
        let denied = authorize_with(checker, &self.user, &s6.sources)
            .await
            .expect_err("partially granted S6 user must receive denials");
        let mut allowed = self.requested.clone();
        for denial in denied.denials {
            let Denial::Stream(stream) = denial else {
                panic!("S6 supplied only stream sources");
            };
            assert_eq!(stream.org_id, self.org);
            assert!(allowed.remove(&(stream.stream_type, stream.name)));
        }
        assert!(!allowed.is_empty(), "S6 user must have some grants");
        allowed
    }

    async fn identity(&self) -> (StreamSet, bool) {
        let readable =
            ReadableStreams::load(&self.org, &self.user, &self.summaries, RumReads::Summaries)
                .await
                .expect("service identity streams");
        if matches!(self.cell.shape, "direct" | "group") {
            assert!(readable.rum, "subset grant must include the RUM stream");
        }
        let verdict = readable
            .evidence(
                &self.org,
                &self.user,
                &self.evidence,
                false,
                false,
                &StreamReadMemo::default(),
            )
            .await
            .expect("service identity evidence");
        let mut allowed: StreamSet = readable
            .traces
            .into_iter()
            .map(|name| (StreamType::Traces, name))
            .collect();
        if readable.rum {
            allowed.insert((StreamType::Logs, RUM_STREAM.to_string()));
        }
        (allowed, verdict)
    }

    async fn service_streams(&self, checker: &dyn StreamAccessChecker) -> StreamSet {
        let kept = readable_service_records(
            checker,
            SITE_SERVICE_STREAMS,
            &self.user,
            &self.org,
            self.records.clone(),
        )
        .await
        .expect("service records");
        let mut allowed = StreamSet::new();
        for record in kept {
            for (kind, streams) in [
                (StreamType::Logs, record.logs_streams),
                (StreamType::Metrics, record.metrics_streams),
                (StreamType::Traces, record.traces_streams),
                (StreamType::Profiles, record.profiles_streams),
            ] {
                allowed.extend(
                    streams
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|value| (kind, value.as_str().expect("stream name").to_string())),
                );
            }
        }
        allowed
    }

    async fn security_sources(&self, checker: &dyn StreamAccessChecker) -> Option<StreamSet> {
        let configured = &self.configured_sources;
        let readable = readable_sources_in_mode(
            checker,
            &self.org,
            &self.user,
            &self.requested,
            &Scope::every(),
            |requested| self.legacy_security_sources(checker, requested),
            |denied| {
                admit_security_sources_once_with(
                    checker,
                    &self.org,
                    &self.user,
                    denied,
                    true,
                    |name| async move {
                        configured.contains(&name).then(|| SecuritySourceSetting {
                            included: Some(true),
                            ..Default::default()
                        })
                    },
                )
            },
        )
        .await
        .expect("readable security sources");
        if self.cell.shape == "direct" {
            assert!(
                readable.as_ref().is_some_and(|streams| configured
                    .iter()
                    .all(|name| streams.contains(&(StreamType::Logs, name.clone())))),
                "direct user must read the sources admitted by Security"
            );
        }
        readable
    }

    async fn legacy_security_sources(
        &self,
        checker: &dyn StreamAccessChecker,
        requested: StreamSet,
    ) -> Option<StreamSet> {
        let mut readable =
            legacy_readable_streams(checker, &self.user, &self.org, requested.clone()).await?;
        let configured_denials: Vec<_> = requested
            .into_iter()
            .filter(|stream| {
                self.configured_sources.contains(&stream.1) && !readable.contains(stream)
            })
            .collect();
        if !configured_denials.is_empty()
            && TodayChecks
                .org_wide(&self.org, &self.user, &prelude("security"))
                .await
        {
            readable.extend(configured_denials);
        }
        Some(readable)
    }

    async fn correlate(&self, checker: &dyn StreamAccessChecker) -> StreamSet {
        let input = self.related.clone().expect("correlate input");
        let allowed = readable_related_streams(
            checker,
            SITE_SERVICE_STREAMS_CORRELATE,
            &self.user,
            &self.org,
            input,
        )
        .await
        .expect("correlate streams");
        allowed
            .logs
            .into_iter()
            .chain(allowed.metrics)
            .chain(allowed.traces)
            .chain(allowed.profiles)
            .map(|stream| (stream.stream_type, stream.stream_name))
            .collect()
    }

    async fn objects(&self, checker: &dyn StreamAccessChecker) -> Option<StreamSet> {
        let path = self.cell.path;
        let mut query = stream_read_query(path, &self.org, &self.user, &self.types);
        match path {
            SITE_DB_MONITORING => query.prelude = Some(prelude("db_monitoring")),
            SITE_GEN_AI => query.bypass = Bypass::RbacOffOrRoot,
            _ => unreachable!("object query for {path}"),
        }
        let objects: Vec<_> = self
            .requested
            .iter()
            .map(|(kind, name)| {
                if path == SITE_GEN_AI {
                    ObjectRef {
                        id: name,
                        stream_type: *kind,
                        ofga_id: Cow::Borrowed(name),
                    }
                } else {
                    ObjectRef::stream(*kind, name)
                }
            })
            .collect();
        objects_in_mode(checker, &query, &objects, &Scope::every(), |objects| {
            self.legacy_objects(checker, &query, objects)
        })
        .await
        .expect("site stream authorization")
    }

    async fn legacy_objects(
        &self,
        checker: &dyn StreamAccessChecker,
        query: &ObjectsQuery<'_>,
        objects: Vec<ObjectRef<'_>>,
    ) -> Option<StreamSet> {
        if let Some(prelude) = &query.prelude {
            if TodayChecks.org_wide(&self.org, &self.user, prelude).await {
                return None;
            }
            let requested = objects
                .into_iter()
                .map(|object| (object.stream_type, object.id.to_string()))
                .collect();
            return legacy_readable_streams(checker, &self.user, &self.org, requested).await;
        }
        let mut allowed = StreamSet::new();
        for object in &objects {
            if TodayChecks
                .object(&self.org, &self.user, query, object)
                .await
            {
                allowed.insert((object.stream_type, object.id.to_string()));
            }
        }
        Some(allowed)
    }

    fn fallback_checks(&self) -> u64 {
        let site = match self.cell.path {
            SMALL => SITE_SERVICE_STREAMS,
            path if path.starts_with(SITE_AUTOOBSERVE_STREAMS) => SITE_AUTOOBSERVE_STREAMS,
            path => path,
        };
        let count = |site| AUTHZ_FALLBACK_CHECKS_TOTAL.with_label_values(&[site]).get();
        count(site)
            + if site == SITE_SERVICE_IDENTITY {
                count(SITE_SERVICE_EVIDENCE)
            } else {
                0
            }
    }
}

struct S6Workload {
    sources: Vec<QuerySource>,
    neighbor_user: String,
    neighbor_stream: TypedStream,
}

impl S6Workload {
    fn new(fixture: &Fixture, requested: &StreamSet) -> Self {
        let mut ordered: Vec<_> = requested.iter().collect();
        ordered.sort_unstable_by_key(|&entry| (entry.0.as_str(), entry.1.as_str()));
        let sources = ordered
            .into_iter()
            .map(|(kind, name)| QuerySource::Stream {
                org_id: fixture.org.clone(),
                stream_type: *kind,
                name: name.clone(),
            })
            .collect();
        let (kind, name) = &fixture.streams[0];
        Self {
            sources,
            neighbor_user: fixture.email("group"),
            neighbor_stream: TypedStream {
                org_id: fixture.org.clone(),
                stream_type: *kind,
                name: name.clone(),
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Answer {
    allowed: Option<StreamSet>,
    evidence_allowed: Option<bool>,
}

impl Answer {
    fn hash(&self) -> String {
        let Some(allowed) = &self.allowed else {
            return "unscoped".to_string();
        };
        let mut streams: Vec<_> = allowed
            .iter()
            .map(|(kind, name)| (kind.as_str(), name.as_str()))
            .collect();
        streams.sort_unstable();
        let mut digest = Sha256::new();
        for (kind, name) in streams {
            digest.update(kind.as_bytes());
            digest.update([0]);
            digest.update(name.as_bytes());
            digest.update([0]);
        }
        format!("{:x}", digest.finalize())
    }
}

struct Proxy {
    url: String,
    state: Arc<ProxyState>,
    shutdown: Option<tokio::sync::oneshot::Sender<()>>,
}

impl Proxy {
    // Its own runtime thread: a busy bench task must never stall the forwarding of OpenFGA calls.
    async fn start(upstream: String) -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind OpenFGA proxy");
        listener
            .set_nonblocking(true)
            .expect("nonblocking proxy listener");
        let url = format!("http://{}", listener.local_addr().expect("proxy address"));
        let client = reqwest::Client::builder()
            .http1_only()
            .no_proxy()
            .no_gzip()
            .no_brotli()
            .no_deflate()
            .no_zstd()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .build()
            .expect("create proxy client");
        let state = Arc::new(ProxyState {
            upstream: upstream.trim_end_matches('/').to_string(),
            client,
            primary: Arc::default(),
            neighbor: Arc::default(),
            neighbor_marker: Mutex::default(),
            requests: AtomicUsize::new(0),
        });
        let router = Router::new()
            .fallback(forward)
            .with_state(Arc::clone(&state));
        let (shutdown, stop) = tokio::sync::oneshot::channel::<()>();
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .expect("create proxy runtime");
            runtime.block_on(async move {
                let listener = TcpListener::from_std(listener).expect("proxy listener");
                axum::serve(listener, router)
                    .with_graceful_shutdown(async {
                        let _ = stop.await;
                    })
                    .await
                    .expect("serve OpenFGA proxy");
            });
        });
        Self {
            url,
            state,
            shutdown: Some(shutdown),
        }
    }
}

impl Drop for Proxy {
    fn drop(&mut self) {
        if let Some(shutdown) = self.shutdown.take() {
            let _ = shutdown.send(());
        }
    }
}

struct ProxyState {
    upstream: String,
    client: reqwest::Client,
    primary: Arc<FlightCounts>,
    neighbor: Arc<FlightCounts>,
    neighbor_marker: Mutex<Option<String>>,
    requests: AtomicUsize,
}

impl ProxyState {
    fn set_neighbor(&self, user: Option<&str>) {
        *self.neighbor_marker.lock().expect("neighbor marker") =
            user.map(|user| format!("\"user:{user}\""));
    }

    fn counts_for(&self, body: &[u8]) -> &Arc<FlightCounts> {
        let marker = self.neighbor_marker.lock().expect("neighbor marker");
        if marker.as_ref().is_some_and(|marker| {
            body.windows(marker.len())
                .any(|part| part == marker.as_bytes())
        }) {
            &self.neighbor
        } else {
            &self.primary
        }
    }

    async fn wait_idle(&self) {
        self.primary.wait_idle().await;
        self.neighbor.wait_idle().await;
    }
}

#[derive(Default)]
struct FlightCounts {
    active: AtomicUsize,
    peak: AtomicUsize,
    idle: Notify,
}

impl FlightCounts {
    async fn wait_idle(&self) {
        tokio::time::timeout(Duration::from_secs(30), async {
            while self.active.load(Ordering::Acquire) != 0 {
                self.idle.notified().await;
            }
        })
        .await
        .expect("proxy response bodies failed to drain");
    }
}

struct InFlight(Arc<FlightCounts>);

impl InFlight {
    fn enter(state: &ProxyState, body: &[u8]) -> Self {
        let counts = state.counts_for(body);
        let active = counts.active.fetch_add(1, Ordering::AcqRel) + 1;
        counts.peak.fetch_max(active, Ordering::Relaxed);
        state.requests.fetch_add(1, Ordering::Relaxed);
        Self(Arc::clone(counts))
    }
}

impl Drop for InFlight {
    fn drop(&mut self) {
        if self.0.active.fetch_sub(1, Ordering::AcqRel) == 1 {
            self.0.idle.notify_one();
        }
    }
}

#[derive(Default, Serialize)]
struct Latency {
    p50_ms: Option<f64>,
    p95_ms: Option<f64>,
    p99_ms: Option<f64>,
    max_ms: Option<f64>,
}

impl Latency {
    fn wall(samples: &mut [Duration]) -> Self {
        let report_p99 = samples.len() >= 100;
        Self::summarize(samples, report_p99)
    }

    fn summarize(samples: &mut [Duration], report_p99: bool) -> Self {
        if samples.is_empty() {
            return Self::default();
        }
        samples.sort_unstable();
        let percentile = |p: usize| millis(samples[(samples.len() * p).div_ceil(100) - 1]);
        Self {
            p50_ms: Some(percentile(50)),
            p95_ms: Some(percentile(95)),
            p99_ms: report_p99.then(|| percentile(99)),
            max_ms: Some(percentile(100)),
        }
    }
}

struct TaskResult {
    answer: Answer,
    elapsed: Duration,
    calls: u32,
    errors: u32,
    timings: [Vec<Duration>; OPS.len()],
}

#[derive(Default, Serialize)]
struct NeighborResult {
    neighbor_checks: Option<usize>,
    neighbor_due_checks: Option<usize>,
    neighbor_peak_in_flight: Option<usize>,
    neighbor_p95_ms: Option<f64>,
    neighbor_p99_ms: Option<f64>,
}

#[derive(Default)]
struct Samples {
    wall: Vec<Duration>,
    calls: u64,
    max_calls: u32,
    errors: u64,
    timings: [Vec<Duration>; OPS.len()],
}

impl Samples {
    fn add(&mut self, cell: Cell, wave: Vec<TaskResult>, answer: &Answer) {
        let mut wall = Duration::ZERO;
        for result in wave {
            assert_same(cell, answer, cell, &result.answer);
            wall = wall.max(result.elapsed);
            self.calls += u64::from(result.calls);
            self.max_calls = self.max_calls.max(result.calls);
            self.errors += u64::from(result.errors);
            // The observer slot keeps its first registration, so a lost one would zero the per-op
            // split.
            let observed: usize = result.timings.iter().map(Vec::len).sum();
            assert_eq!(
                observed as u64,
                u64::from(result.calls),
                "{cell:?}: call observer missed calls"
            );
            for (samples, observed) in self.timings.iter_mut().zip(result.timings) {
                samples.extend(observed);
            }
        }
        self.wall.push(wall);
    }
}

#[derive(Serialize)]
struct CellResult {
    #[serde(flatten)]
    cell: Cell,
    key: String,
    cpus: Option<f64>,
    requested_objects: usize,
    types: usize,
    runs: usize,
    #[serde(flatten)]
    wall: Latency,
    wall_runs_ms: Option<Vec<f64>>,
    cold_ms: Option<f64>,
    #[serde(skip)]
    cold: bool,
    #[serde(skip)]
    require_cold: bool,
    calls: HashMap<&'static str, u64>,
    calls_total: u64,
    scope_calls: u64,
    scope_errors: u64,
    max_calls_per_user: u32,
    call_budget: Option<u32>,
    security_p95_gate_passed: Option<bool>,
    call_latency: HashMap<&'static str, Latency>,
    list_max_ms: Option<f64>,
    list_calls_over_1s: u64,
    warm_list_max_ms: Option<f64>,
    cold_list_max_ms: Option<f64>,
    cold_list_calls_over_1s: Option<u64>,
    fallback_checks: u64,
    proxy_requests: usize,
    peak_in_flight: usize,
    peak_in_flight_limit: usize,
    #[serde(flatten)]
    neighbor: NeighborResult,
    fga_handled: Option<u64>,
    fga_cpu_seconds: Option<f64>,
    fga_cpu_seconds_per_auth: Option<f64>,
    allowed: usize,
    allowed_hash: String,
    unscoped: bool,
    evidence_allowed: Option<bool>,
}

impl CellResult {
    fn record(&self, out: &mut impl Write) {
        serde_json::to_writer(&mut *out, self).expect("serialize benchmark cell");
        writeln!(out).expect("end benchmark JSON line");
        out.flush().expect("flush benchmark cell");
    }

    fn violations(&self) -> Vec<String> {
        let mut failures = Vec::new();
        let key = &self.key;
        if self.calls_total != self.scope_calls {
            failures.push(format!(
                "{key}: observer counted {} calls, scope counted {}",
                self.calls_total, self.scope_calls
            ));
        }
        let warm_over = (!self.cold).then_some(self.list_calls_over_1s);
        for (phase, max_ms, over) in [
            ("warm", self.warm_list_max_ms, warm_over),
            ("cold", self.cold_list_max_ms, self.cold_list_calls_over_1s),
        ] {
            if list_deadline_exceeded(max_ms, over) {
                failures.push(format!(
                    "{key}: G-6 {phase} list exceeded 1.0 s (longest: {max_ms:?} ms, over: {over:?})"
                ));
            }
        }
        if self.require_cold && self.cold_ms.is_none() {
            failures.push(format!("{key}: has no cold measurement"));
        }
        if self.cell.mode != "on" {
            return failures;
        }
        if let Some(budget) = self.call_budget
            && self.max_calls_per_user > budget
        {
            failures.push(format!(
                "{key}: {} calls exceeded budget {budget}",
                self.max_calls_per_user
            ));
        }
        let peak_limit = self.peak_in_flight_limit;
        if self.peak_in_flight > peak_limit {
            failures.push(format!(
                "{key}: peak {} exceeded in-flight limit {peak_limit}",
                self.peak_in_flight
            ));
        }
        if self.cell.path == S6 && self.scope_errors != 0 {
            failures.push(format!(
                "{key}: {} OpenFGA errors during S6",
                self.scope_errors
            ));
        }
        // The cutoff permits fallback for types left open by probes. Requests above the cutoff
        // exercise the declared list deadline and must complete without fallback.
        if self.requested_objects > SMALL_REQUEST_OBJECTS && self.fallback_checks != 0 {
            failures.push(format!(
                "{key}: {} unexpected per-object fallback Checks",
                self.fallback_checks
            ));
        }
        if let Some((name, limit)) = self.cell.gate(self.cpus) {
            if !self.cold
                && let Some(p95_ms) = self.wall.p95_ms
                && p95_ms > limit
            {
                failures.push(format!(
                    "{key}: {name} warm p95 {p95_ms:.2} ms exceeded {limit} ms"
                ));
            }
            if let Some(cold_ms) = self.cold_ms
                && cold_ms > limit
            {
                failures.push(format!(
                    "{key}: {name} cold {cold_ms:.2} ms exceeded {limit} ms"
                ));
            }
        }
        failures
    }
}

#[derive(Deserialize)]
struct ColdRecord {
    key: String,
    cold_ms: Option<f64>,
    list_max_ms: Option<f64>,
    list_calls_over_1s: Option<u64>,
}

#[test]
#[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
fn list_authz_against_openfga() {
    assert_ne!(
        env::var("CI").as_deref(),
        Ok("true"),
        "local benchmark only"
    );
    RUNTIME.block_on(async {
        let _serial = SERIAL.lock().await;
        let settings = Settings::from_env();
        let mut cells = matrix(settings.cpus);
        if !settings.seed_only {
            cells.retain(|cell| cell.path != S6 || settings.cpus == Some(1.0));
        }
        if let Some(path) = &settings.cold_list {
            let mut out = BufWriter::new(fs::File::create(path).expect("create cold key list"));
            for cell in cells
                .into_iter()
                .filter(|&cell| settings.cold_cells.selects(cell, settings.cpus))
            {
                writeln!(out, "{}", cell.key(settings.cpus)).expect("write cold cell key");
            }
            out.flush().expect("flush cold key list");
            return;
        }
        if settings.cold {
            assert!(
                !settings.seed_only,
                "cold and seed-only are separate invocations"
            );
            let key = settings
                .cold_key
                .as_deref()
                .expect("cold run needs O2_BENCH_COLD_KEY");
            cells.retain(|cell| cell.key(settings.cpus) == key);
            assert_eq!(
                cells.len(),
                1,
                "cold key {key:?} must match one matrix cell"
            );
        }
        if cells.is_empty() {
            return;
        }
        let url = env::var("O2_OPENFGA_IT_URL").expect("set O2_OPENFGA_IT_URL to OpenFGA");
        let proxy = Proxy::start(url).await;
        // The node startup observer aggregates timings into buckets and registration is exclusive.
        set_call_observer(observe_call);
        let fixtures = prepare_fixtures(&settings, &cells, &proxy.url).await;
        if !settings.seed_only {
            run_matrix(&settings, &cells, &fixtures, &proxy.state).await;
        }
    });
}

async fn prepare_fixtures(
    settings: &Settings,
    cells: &[Cell],
    url: &str,
) -> HashMap<usize, Fixture> {
    let seeded = settings
        .store_file
        .as_ref()
        .filter(|_| !settings.seed_only)
        .map(|path| fs::read_to_string(path).expect("read preseeded store id"));
    assert!(
        seeded.is_some() || !settings.cold,
        "cold run needs a preseeded store"
    );
    let store = connect(url, seeded.as_deref().map(str::trim)).await;
    let mut fixtures = HashMap::new();
    for scale in SCALES
        .into_iter()
        .filter(|scale| cells.iter().any(|cell| cell.scale == *scale))
    {
        let fixture = Fixture::new(scale);
        if seeded.is_some() {
            fixture.cache_members();
        } else {
            fixture.seed().await;
        }
        fixtures.insert(scale, fixture);
    }
    if settings.seed_only {
        let file = settings
            .store_file
            .as_ref()
            .expect("seed-only run needs a store ID file");
        fs::write(file, store).expect("save seeded store ID");
    }
    fixtures
}

async fn run_matrix(
    settings: &Settings,
    cells: &[Cell],
    fixtures: &HashMap<usize, Fixture>,
    proxy: &ProxyState,
) {
    if let Some(parent) = settings
        .out
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).expect("create benchmark output directory");
    }
    let mut out = BufWriter::new(
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&settings.out)
            .expect("open benchmark JSONL"),
    );
    let checker = active_checker();
    let mut answers = HashMap::new();
    let mut failures = Vec::new();
    for &cell in cells {
        proxy.wait_idle().await;
        configure_mode(cell.mode);
        let workload = Arc::new(Workload::new(cell, &fixtures[&cell.scale]));
        proxy.set_neighbor(workload.s6.as_ref().map(|s6| s6.neighbor_user.as_str()));
        let (result, answer) = run_cell(settings, proxy, &workload, &checker).await;
        result.record(&mut out);
        failures.extend(result.violations());
        match answers.entry((cell.path, cell.scale, cell.shape)) {
            Entry::Vacant(entry) => {
                entry.insert((cell, answer));
            }
            Entry::Occupied(entry) => {
                let (baseline_cell, baseline) = entry.get();
                if let Some(mismatch) = answer_mismatch(*baseline_cell, baseline, cell, &answer) {
                    failures.push(mismatch);
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "benchmark regressions:\n{}",
        failures.join("\n")
    );
}

async fn run_cell(
    settings: &Settings,
    proxy: &ProxyState,
    workload: &Arc<Workload>,
    checker: &Arc<dyn StreamAccessChecker>,
) -> (CellResult, Answer) {
    let cell = workload.cell;
    let runs = if settings.cold {
        1
    } else if cell.mode == "off" {
        settings.runs_off
    } else {
        settings.runs_on
    };
    let warmup = if settings.cold {
        None
    } else {
        let warmup = run_wave(workload, checker).await;
        proxy.wait_idle().await;
        Some(warmup)
    };
    proxy.primary.peak.store(0, Ordering::Relaxed);
    proxy.neighbor.peak.store(0, Ordering::Relaxed);
    proxy.requests.store(0, Ordering::Relaxed);
    let handled_before = fga_handled(settings.metrics_url.as_deref(), &proxy.client).await;
    let fallback_before = workload.fallback_checks();
    let cpu_before = read_cpu(settings.cgroup.as_deref());
    let mut samples = Samples::default();
    let mut answer = None;
    let neighbor_task = workload.s6.as_ref().map(|_| {
        let (stop, receiver) = oneshot::channel();
        let workload = Arc::clone(workload);
        let checker = Arc::clone(checker);
        let start = time::Instant::now();
        let task = tokio::spawn(async move {
            let s6 = workload.s6.as_ref().expect("S6 workload");
            run_neighbor(s6, &checker, start, receiver).await
        });
        (stop, task)
    });
    for _ in 0..runs {
        let wave = run_wave(workload, checker).await;
        proxy.primary.wait_idle().await;
        let expected = answer.get_or_insert_with(|| wave[0].answer.clone());
        samples.add(cell, wave, expected);
    }
    let neighbor = if let Some((stop, task)) = neighbor_task {
        let _ = stop.send(());
        let mut result = task.await.expect("S6 neighbor task");
        proxy.wait_idle().await;
        result.neighbor_peak_in_flight = Some(proxy.neighbor.peak.load(Ordering::Relaxed));
        result
    } else {
        NeighborResult::default()
    };
    let cpu_after = read_cpu(settings.cgroup.as_deref());
    let handled_after = fga_handled(settings.metrics_url.as_deref(), &proxy.client).await;
    let answer = answer.expect("at least one measured wave");
    if let Some(warmup) = warmup {
        for sample in warmup {
            assert_same(cell, &answer, cell, &sample.answer);
        }
    }

    let cpu_seconds = cpu_after
        .zip(cpu_before)
        .map(|(end, start)| (end - start) as f64 / 1_000_000.0);
    let key = cell.key(settings.cpus);
    let cold_record = settings.cold_records.get(&key);
    let wall_runs_ms =
        (cell.path == S6).then(|| samples.wall.iter().copied().map(millis).collect());
    let operations = OPS.into_iter().zip(&mut samples.timings);
    let mut calls = HashMap::new();
    let mut call_latency = HashMap::new();
    let mut list_calls_over_1s = 0;
    let mut list_max_ms = None;
    for (op, timings) in operations {
        calls.insert(op.as_str(), timings.len() as u64);
        let latency = Latency::summarize(timings, true);
        if op == CallOp::List {
            list_max_ms = latency.max_ms;
            list_calls_over_1s = timings
                .iter()
                .filter(|&&elapsed| elapsed > LIST_LIMIT)
                .count() as u64;
        }
        call_latency.insert(op.as_str(), latency);
    }
    let types = workload.types.len();
    let wall = Latency::wall(&mut samples.wall);
    let (cold_ms, cold_list_max_ms, cold_list_calls_over_1s) = if settings.cold {
        (wall.max_ms, list_max_ms, Some(list_calls_over_1s))
    } else {
        (
            cold_record.and_then(|record| record.cold_ms),
            cold_record.and_then(|record| record.list_max_ms),
            cold_record.and_then(|record| record.list_calls_over_1s),
        )
    };
    let result = CellResult {
        cell,
        key,
        cpus: settings.cpus,
        requested_objects: workload.requested.len(),
        types,
        runs,
        security_p95_gate_passed: if settings.cold {
            None
        } else {
            cell.security_p95_gate(wall.p95_ms)
        },
        wall,
        wall_runs_ms,
        cold_ms,
        cold: settings.cold,
        require_cold: !settings.cold && settings.cold_cells.selects(cell, settings.cpus),
        calls_total: calls.values().sum(),
        calls,
        scope_calls: samples.calls,
        scope_errors: samples.errors,
        max_calls_per_user: samples.max_calls,
        call_budget: cell.budget(types).map(|cap| {
            let requested = workload.requested.len();
            // The base cap covers probes, and each object they leave open can need one Check.
            if requested <= SMALL_REQUEST_OBJECTS {
                cap + requested as u32
            } else {
                cap
            }
        }),
        call_latency,
        list_max_ms,
        list_calls_over_1s,
        warm_list_max_ms: if settings.cold { None } else { list_max_ms },
        cold_list_max_ms,
        cold_list_calls_over_1s,
        fallback_checks: workload.fallback_checks() - fallback_before,
        proxy_requests: proxy.requests.load(Ordering::Relaxed),
        peak_in_flight: proxy.primary.peak.load(Ordering::Relaxed),
        peak_in_flight_limit: cell.peak_limit(types),
        neighbor,
        fga_handled: handled_after.map(|end| end - handled_before.unwrap_or(0)),
        fga_cpu_seconds: cpu_seconds,
        fga_cpu_seconds_per_auth: cpu_seconds.map(|seconds| seconds / (runs * cell.users) as f64),
        allowed: answer
            .allowed
            .as_ref()
            .map_or(workload.requested.len(), StreamSet::len),
        allowed_hash: answer.hash(),
        unscoped: answer.allowed.is_none(),
        evidence_allowed: answer.evidence_allowed,
    };
    (result, answer)
}

async fn run_neighbor(
    s6: &S6Workload,
    checker: &Arc<dyn StreamAccessChecker>,
    start: time::Instant,
    mut stop: oneshot::Receiver<()>,
) -> NeighborResult {
    let mut tick = time::interval_at(start, NEIGHBOR_PERIOD);
    tick.set_missed_tick_behavior(MissedTickBehavior::Burst);
    let mut checks = JoinSet::new();
    loop {
        let due = tokio::select! {
            biased;
            _ = &mut stop => break,
            due = tick.tick() => due,
        };
        let checker = Arc::clone(checker);
        let user = s6.neighbor_user.clone();
        let stream = s6.neighbor_stream.clone();
        checks.spawn(async move { neighbor_check(checker.as_ref(), &user, &stream, due).await });
    }
    let due_checks = checks.len();
    assert!(due_checks > 0, "S6 neighbor must send a measured Check");
    let mut timings = Vec::with_capacity(due_checks);
    let mut failure = None;
    while let Some(result) = checks.join_next().await {
        match result {
            Ok(elapsed) => timings.push(elapsed),
            Err(error) => {
                failure.get_or_insert(error);
            }
        }
    }
    if let Some(error) = failure {
        panic!("S6 neighbor Check task: {error}");
    }
    let latency = Latency::summarize(&mut timings, true);
    NeighborResult {
        neighbor_checks: Some(timings.len()),
        neighbor_due_checks: Some(due_checks),
        neighbor_peak_in_flight: None,
        neighbor_p95_ms: latency.p95_ms,
        neighbor_p99_ms: latency.p99_ms,
    }
}

async fn neighbor_check(
    checker: &dyn StreamAccessChecker,
    user: &str,
    stream: &TypedStream,
    due: time::Instant,
) -> Duration {
    let ((allowed, errors), elapsed, timings) = CALL_TIMINGS
        .scope(RefCell::default(), async {
            let result = in_own_scope(checker.can_read_stream(user, stream)).await;
            (result, due.elapsed(), CALL_TIMINGS.with(RefCell::take))
        })
        .await;
    assert!(allowed && errors == 0, "S6 neighbor's granted Check failed");
    assert!(
        OPS.into_iter()
            .zip(&timings)
            .all(|(op, samples)| samples.len() == usize::from(op == CallOp::Check)),
        "S6 neighbor must send exactly one Check per tick"
    );
    elapsed
}

async fn run_wave(
    workload: &Arc<Workload>,
    checker: &Arc<dyn StreamAccessChecker>,
) -> Vec<TaskResult> {
    let start = Instant::now();
    let tasks = (0..workload.cell.users).map(|_| {
        let workload = Arc::clone(workload);
        let checker = Arc::clone(checker);
        tokio::spawn(async move {
            CALL_TIMINGS
                .scope(RefCell::default(), async {
                    let counts = Arc::new(CallCounts::default());
                    let (answer, errors) = REQUEST_CALLS
                        .scope(
                            Arc::clone(&counts),
                            in_own_scope(workload.answer(checker.as_ref())),
                        )
                        .await;
                    TaskResult {
                        answer,
                        elapsed: start.elapsed(),
                        calls: counts.calls(),
                        errors,
                        timings: CALL_TIMINGS.with(RefCell::take),
                    }
                })
                .await
        })
    });
    join_all(tasks)
        .await
        .into_iter()
        .map(|task| task.expect("authorization task"))
        .collect()
}

fn observe_call(op: CallOp, _outcome: CallOutcome, elapsed: Duration) {
    let index = match op {
        CallOp::Check => 0,
        CallOp::Role => 1,
        CallOp::Probe => 2,
        CallOp::List => 3,
    };
    let _ = CALL_TIMINGS.try_with(|timings| timings.borrow_mut()[index].push(elapsed));
}

async fn forward(State(state): State<Arc<ProxyState>>, request: Request) -> Response {
    let (mut parts, body) = request.into_parts();
    let body = match to_bytes(body, usize::MAX).await {
        Ok(body) => body,
        Err(error) => return (StatusCode::BAD_REQUEST, error.to_string()).into_response(),
    };
    let flight = InFlight::enter(&state, &body);
    let path = parts
        .uri
        .path_and_query()
        .map_or("/", http::uri::PathAndQuery::as_str);
    let url = format!("{}{path}", state.upstream);
    remove_hop_headers(&mut parts.headers);
    parts.headers.remove(header::HOST);
    let upstream = state
        .client
        .request(parts.method, url)
        .headers(parts.headers)
        .body(body)
        .send()
        .await;
    let response = match upstream {
        Ok(response) => response,
        Err(error) => return (StatusCode::BAD_GATEWAY, error.to_string()).into_response(),
    };
    let status = response.status();
    let mut headers = response.headers().clone();
    remove_hop_headers(&mut headers);
    // Retain the counter through EOF or downstream cancellation, including streamed lists.
    let body = stream::unfold(
        (Box::pin(response.bytes_stream()), flight),
        |(mut body, flight)| async { body.next().await.map(|chunk| (chunk, (body, flight))) },
    );
    let mut response = Response::new(Body::from_stream(body));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    response
}

fn remove_hop_headers(headers: &mut HeaderMap) {
    let dynamic: Vec<_> = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|name| header::HeaderName::from_bytes(name.trim().as_bytes()).ok())
        .collect();
    for name in dynamic {
        headers.remove(name);
    }
    for name in [
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    ] {
        headers.remove(name);
    }
}

fn configure_mode(mode: &str) {
    // SAFETY: the serial, current-thread runtime is between cells with no requests running.
    unsafe {
        env::set_var("O2_OPENFGA_LIST_AUTHZ_MODE", mode);
        env::set_var("O2_OPENFGA_LIST_AUTHZ_SHADOW_SAMPLE", "1.0");
        env::set_var("O2_OPENFGA_LIST_FALLBACK_CONCURRENCY", "16");
    }
    declare_deadline("5000");
    let expected = match mode {
        "off" => ListMode::Off,
        "on" => ListMode::On,
        "shadow" => ListMode::Shadow,
        _ => unreachable!("validated mode"),
    };
    assert_eq!(active_checker().list_settings("").mode, expected);
}

fn matrix(cpus: Option<f64>) -> Vec<Cell> {
    let choices: Vec<_> = PATHS.into_iter().chain([SMALL, S6]).collect();
    let paths: Vec<_> = match env::var("O2_BENCH_PATHS") {
        Ok(value) => {
            let mut expanded = HashSet::new();
            for path in value.split(',').map(str::trim) {
                match path {
                    SITE_AUTOOBSERVE_STREAMS | "autoobserve" => expanded.extend(
                        choices
                            .iter()
                            .copied()
                            .filter(|path| path.starts_with(SITE_AUTOOBSERVE_STREAMS)),
                    ),
                    path => {
                        assert!(
                            choices.contains(&path),
                            "unknown O2_BENCH_PATHS value {path:?}"
                        );
                        expanded.insert(path);
                    }
                }
            }
            choices
                .into_iter()
                .filter(|path| expanded.contains(path))
                .collect()
        }
        Err(_) => choices.into_iter().filter(|&path| path != S6).collect(),
    };
    let scales = selected("O2_BENCH_SCALES", &SCALES);
    let shapes = selected("O2_BENCH_SHAPES", &SHAPES);
    let modes = selected("O2_BENCH_MODES", &MODES);
    let users = selected("O2_BENCH_USERS", &[1, 4]);
    let explicit_modes = env::var_os("O2_BENCH_MODES").is_some();
    let mut cells = Vec::new();
    for scale in scales {
        for &path in &paths {
            for &shape in &shapes {
                for &users in &users {
                    for &mode in &modes {
                        let cell = Cell {
                            path,
                            scale,
                            shape,
                            users,
                            mode,
                        };
                        if cell.selected(explicit_modes, cpus) {
                            cells.push(cell);
                        }
                    }
                }
            }
        }
    }
    assert!(!cells.is_empty(), "benchmark filters select no cells");
    cells
}

fn selected<T: Copy + ToString>(var: &str, options: &[T]) -> Vec<T> {
    let Ok(raw) = env::var(var) else {
        return options.to_vec();
    };
    let selected: HashSet<_> = raw.split(',').map(str::trim).collect();
    let options: Vec<_> = options
        .iter()
        .map(|&value| (value, value.to_string()))
        .collect();
    for item in &selected {
        assert!(
            options.iter().any(|(_, name)| name.as_str() == *item),
            "unknown {var} value {item:?}"
        );
    }
    options
        .into_iter()
        .filter_map(|(value, name)| selected.contains(name.as_str()).then_some(value))
        .collect()
}

fn positive_var(var: &str, default: usize) -> usize {
    let value = env::var(var).map_or(default, |value| {
        value.parse().expect("run count must be an integer")
    });
    assert!(value > 0, "{var} must be positive");
    value
}

fn read_cold_records(path: &Path) -> HashMap<String, ColdRecord> {
    fs::read_to_string(path)
        .expect("read cold cell JSONL")
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(|line| serde_json::from_str::<ColdRecord>(line).expect("parse cold cell JSON line"))
        .filter(|record| record.cold_ms.is_some())
        .map(|record| (record.key.clone(), record))
        .collect()
}

fn list_deadline_exceeded(max_ms: Option<f64>, over: Option<u64>) -> bool {
    max_ms.is_some_and(|ms| ms > millis(LIST_LIMIT)) || over.is_some_and(|count| count != 0)
}

fn member_role(shape: &str) -> UserRole {
    if shape == "editor" {
        UserRole::Editor
    } else {
        UserRole::User
    }
}

fn grant(object: String, permission: Permission) -> O2EntityAuthorization {
    O2EntityAuthorization { object, permission }
}

fn prelude(resource: &str) -> OrgWideCheck<'_> {
    OrgWideCheck {
        resource,
        permission: "GET",
        use_all_org: true,
        use_self_context: false,
        use_self_parent: false,
    }
}

fn service_records(org: &str, requested: &StreamSet) -> Vec<ServiceRecord> {
    let streams = TYPES.map(|kind| {
        let mut names: Vec<_> = requested
            .iter()
            .filter(|(stream_type, _)| *stream_type == kind)
            .map(|(_, name)| name)
            .collect();
        names.sort_unstable();
        (kind, names)
    });
    let count = streams
        .iter()
        .map(|(_, names)| names.len())
        .filter(|&size| size > 0)
        .min()
        .unwrap_or(0)
        .max(2)
        .min(requested.len());
    let mut records: Vec<_> = (0..count)
        .map(|i| {
            ServiceRecord::new(
                org,
                &format!("bench_service_{i}"),
                "bench",
                serde_json::json!({}),
            )
        })
        .collect();
    for (kind, names) in streams {
        for (i, name) in names.into_iter().enumerate() {
            let record = &mut records[i % count];
            let list = match kind {
                StreamType::Logs => &mut record.logs_streams,
                StreamType::Metrics => &mut record.metrics_streams,
                StreamType::Traces => &mut record.traces_streams,
                _ => unreachable!("benchmark stream type"),
            };
            list.as_array_mut()
                .expect("service record stream list")
                .push(serde_json::Value::String(name.clone()));
        }
    }
    records
}

fn summary(org: &str, signal: &str, name: &str) -> WhereSummaryRecord {
    WhereSummaryRecord {
        org_id: org.to_string(),
        source_stream: name.to_string(),
        signal: signal.to_string(),
        summary_key: String::new(),
        service_name: String::new(),
        where_key: String::new(),
        scope_key: String::new(),
        k8s_cluster: String::new(),
        k8s_namespace: String::new(),
        env: String::new(),
        env_source: EnvSource::Default,
        env_source_value: String::new(),
        envs: Vec::new(),
        newest_version: String::new(),
        newest_version_key: String::new(),
        newest_first_seen: 0,
        has_version: false,
        first_seen: 0,
        last_seen: 0,
        purged_versions: 0,
        updated_at: 0,
    }
}

fn millis(duration: Duration) -> f64 {
    duration.as_secs_f64() * 1_000.0
}

fn assert_same(expected_cell: Cell, expected: &Answer, cell: Cell, actual: &Answer) {
    if let Some(mismatch) = answer_mismatch(expected_cell, expected, cell, actual) {
        panic!("{mismatch}");
    }
}

fn answer_mismatch(
    expected_cell: Cell,
    expected: &Answer,
    cell: Cell,
    actual: &Answer,
) -> Option<String> {
    (expected != actual).then(|| {
        let diff = expected
            .allowed
            .as_ref()
            .zip(actual.allowed.as_ref())
            .map_or_else(
                || "n/a".to_string(),
                |(left, right)| left.symmetric_difference(right).count().to_string(),
            );
        format!(
            "{expected_cell:?} hash {} evidence {:?}, {cell:?} hash {} evidence {:?}, diff size {diff}",
            expected.hash(),
            expected.evidence_allowed,
            actual.hash(),
            actual.evidence_allowed,
        )
    })
}

fn read_cpu(path: Option<&Path>) -> Option<u64> {
    let path = path?.join("cpu.stat");
    let data = fs::read_to_string(&path)
        .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
    let usage = data
        .lines()
        .find_map(|line| line.strip_prefix("usage_usec "))
        .expect("cpu.stat has usage_usec");
    Some(usage.trim().parse().expect("usage_usec is numeric"))
}

async fn fga_handled(url: Option<&str>, client: &reqwest::Client) -> Option<u64> {
    let metrics = client
        .get(url?)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .expect("scrape OpenFGA metrics")
        .error_for_status()
        .expect("OpenFGA metrics status")
        .text()
        .await
        .expect("read OpenFGA metrics");
    grpc_calls(&metrics)
}

fn grpc_calls(metrics: &str) -> Option<u64> {
    if !metrics
        .lines()
        .any(|line| line.starts_with("# TYPE grpc_server_handled_total counter"))
    {
        return None;
    }
    Some(
        metrics
            .lines()
            .filter_map(|line| {
                let sample = line.strip_prefix("grpc_server_handled_total{")?;
                let (labels, value) = sample.split_once('}')?;
                labels
                    .split(',')
                    .any(|label| {
                        matches!(
                            label,
                            "grpc_method=\"Check\""
                                | "grpc_method=\"StreamedListObjects\""
                                | "grpc_method=\"ListObjects\""
                        )
                    })
                    .then(|| value.trim().parse::<f64>().expect("numeric gRPC counter") as u64)
            })
            .sum(),
    )
}

#[cfg(test)]
mod tests {
    use std::{convert::Infallible, net::SocketAddr};

    use axum::{extract::ConnectInfo, routing::post};

    use super::*;

    const NEIGHBOR_USER: &str = "neighbor@example.com";
    const NEIGHBOR_BODY: &str = r#"{"tuple_key":{"user":"user:neighbor@example.com"}}"#;

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn proxy_counts_until_the_last_chunk_and_reuses_http1_connections() {
        RUNTIME.block_on(async {
            let _serial = SERIAL.lock().await;
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let upstream = format!("http://{}", listener.local_addr().unwrap());
            let release = Arc::new(Notify::new());
            let router = Router::new()
                .route("/stores/test/streamed-list-objects", post(chunks))
                .with_state(Arc::clone(&release));
            let server = tokio::spawn(async move {
                axum::serve(
                    listener,
                    router.into_make_service_with_connect_info::<SocketAddr>(),
                )
                .await
                .unwrap();
            });
            let proxy = Proxy::start(upstream).await;
            proxy.state.set_neighbor(Some(NEIGHBOR_USER));
            let client = reqwest::Client::builder()
                .http1_only()
                .no_proxy()
                .timeout(Duration::from_secs(10))
                .build()
                .unwrap();
            let mut first_peer = None;
            for (body, neighbor) in [("{}", false), (NEIGHBOR_BODY, true)] {
                let mut response = client
                    .post(format!("{}/stores/test/streamed-list-objects", proxy.url))
                    .body(body)
                    .send()
                    .await
                    .unwrap()
                    .error_for_status()
                    .unwrap();
                assert_eq!(response.version(), http::Version::HTTP_11);
                let peer = response.headers()["x-peer-port"].clone();
                assert_eq!(*first_peer.get_or_insert_with(|| peer.clone()), peer);
                assert_eq!(response.chunk().await.unwrap().unwrap().as_ref(), b"first");
                assert_eq!(
                    proxy.state.primary.active.load(Ordering::Acquire),
                    usize::from(!neighbor)
                );
                assert_eq!(
                    proxy.state.neighbor.active.load(Ordering::Acquire),
                    usize::from(neighbor)
                );
                release.notify_one();
                assert_eq!(response.bytes().await.unwrap().as_ref(), b"last");
                proxy.state.wait_idle().await;
                assert_eq!(proxy.state.primary.active.load(Ordering::Acquire), 0);
                assert_eq!(proxy.state.neighbor.active.load(Ordering::Acquire), 0);
            }
            assert_eq!(proxy.state.primary.peak.load(Ordering::Relaxed), 1);
            assert_eq!(proxy.state.neighbor.peak.load(Ordering::Relaxed), 1);
            assert_eq!(proxy.state.requests.load(Ordering::Relaxed), 2);
            server.abort();
        });
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn equal_size_grant_drift_reports_both_hashes_and_the_diff_size() {
        let off = Cell {
            path: SITE_SERVICE_STREAMS,
            scale: 100,
            shape: "direct",
            users: 1,
            mode: "off",
        };
        let on = Cell { mode: "on", ..off };
        let expected = Answer {
            allowed: Some(StreamSet::from([(StreamType::Logs, "one".to_string())])),
            evidence_allowed: None,
        };
        let actual = Answer {
            allowed: Some(StreamSet::from([(StreamType::Metrics, "one".to_string())])),
            evidence_allowed: None,
        };
        assert!(answer_mismatch(off, &expected, on, &expected).is_none());
        let message = answer_mismatch(off, &expected, on, &actual).unwrap();
        assert!(message.contains(&expected.hash()));
        assert!(message.contains(&actual.hash()));
        assert!(message.contains("diff size 2"));
        assert_ne!(expected.hash(), actual.hash());
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn graph_unscoped_answer_differs_from_all_named_traces() {
        let off = Cell {
            path: SITE_SERVICE_GRAPH,
            scale: 100,
            shape: "type_wide",
            users: 1,
            mode: "off",
        };
        let on = Cell { mode: "on", ..off };
        let unscoped = Answer {
            allowed: None,
            evidence_allowed: None,
        };
        let scoped = Answer {
            allowed: Some(Workload::new(on, &Fixture::new(on.scale)).requested),
            evidence_allowed: None,
        };
        assert_eq!(unscoped.hash(), "unscoped");
        assert_ne!(unscoped.hash(), scoped.hash());
        assert!(answer_mismatch(off, &unscoped, on, &scoped).is_some());
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn g6_checks_warm_and_cold_list_timings() {
        let cold: ColdRecord = serde_json::from_str(
            r#"{"key":"service_graph/100/direct/1/1/on","cold_ms":1200,"list_max_ms":1100,"list_calls_over_1s":1}"#,
        )
        .unwrap();
        assert_eq!(cold.list_max_ms, Some(1_100.0));
        assert_eq!(cold.list_calls_over_1s, Some(1));
        assert!(list_deadline_exceeded(
            cold.list_max_ms,
            cold.list_calls_over_1s
        ));
        assert!(list_deadline_exceeded(Some(1_000.001), Some(0)));
        assert!(list_deadline_exceeded(None, Some(1)));
        assert!(!list_deadline_exceeded(Some(1_000.0), Some(0)));
        assert!(!list_deadline_exceeded(None, None));
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn selected_cells_require_cold_measurements() {
        let gate = Cell {
            path: SITE_SERVICE_STREAMS,
            scale: 2_858,
            shape: "direct",
            users: 1,
            mode: "on",
        };
        let cpus = Some(1.0);
        for (cell, selection, required) in [
            (gate, ColdCells::Gates, true),
            (Cell { scale: 100, ..gate }, ColdCells::All, true),
            (
                Cell {
                    mode: "off",
                    ..gate
                },
                ColdCells::All,
                true,
            ),
            (
                Cell {
                    mode: "shadow",
                    ..gate
                },
                ColdCells::All,
                true,
            ),
            (
                Cell {
                    mode: "off",
                    ..gate
                },
                ColdCells::Gates,
                false,
            ),
            (gate, ColdCells::None, false),
        ] {
            let mut result = CellResult {
                cell,
                key: cell.key(cpus),
                cpus,
                requested_objects: cell.scale,
                types: TYPES.len(),
                runs: 1,
                wall: Latency::default(),
                wall_runs_ms: None,
                cold_ms: None,
                cold: false,
                require_cold: selection.selects(cell, cpus),
                calls: HashMap::new(),
                calls_total: 0,
                scope_calls: 0,
                scope_errors: 0,
                max_calls_per_user: 0,
                call_budget: cell.budget(TYPES.len()),
                security_p95_gate_passed: None,
                call_latency: HashMap::new(),
                list_max_ms: None,
                list_calls_over_1s: 0,
                warm_list_max_ms: None,
                cold_list_max_ms: None,
                cold_list_calls_over_1s: None,
                fallback_checks: 0,
                proxy_requests: 0,
                peak_in_flight: 0,
                peak_in_flight_limit: cell.peak_limit(TYPES.len()),
                neighbor: NeighborResult::default(),
                fga_handled: None,
                fga_cpu_seconds: None,
                fga_cpu_seconds_per_auth: None,
                allowed: 0,
                allowed_hash: String::new(),
                unscoped: false,
                evidence_allowed: None,
            };
            let expected: Vec<_> = required
                .then(|| format!("{}: has no cold measurement", result.key))
                .into_iter()
                .collect();
            assert_eq!(result.violations(), expected);
            result.cold_ms = Some(100.0);
            assert!(result.violations().is_empty());
            if cell.gate(cpus).is_some() {
                result.cold_ms = Some(151.0);
                assert_eq!(
                    result.violations(),
                    [format!(
                        "{}: G-1 cold 151.00 ms exceeded 150 ms",
                        result.key
                    )]
                );
            }
        }
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn five_thousand_object_off_baselines_are_kept_except_at_point_two_cpu() {
        let off = Cell {
            path: SITE_SERVICE_STREAMS,
            scale: 5_000,
            shape: "direct",
            users: 1,
            mode: "off",
        };
        assert!(off.selected(false, Some(1.0)));
        assert!(off.selected(false, None));
        assert!(!off.selected(false, Some(0.2)));
        assert!(off.selected(true, Some(0.2)));

        let small = Cell { path: SMALL, ..off };
        assert!(small.selected(false, Some(0.2)));
        assert!(
            !Cell {
                scale: 2_858,
                ..small
            }
            .selected(false, Some(0.2))
        );
        let small_workload = Workload::new(small, &Fixture::new(small.scale));
        assert_eq!(small_workload.requested.len(), 10);

        let shadow = Cell {
            mode: "shadow",
            ..off
        };
        assert!(!shadow.selected(true, Some(1.0)));
        assert!(
            Cell {
                scale: 2_858,
                ..shadow
            }
            .selected(false, Some(1.0))
        );
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn security_sources_target_has_two_thousand_logs_and_a_seven_call_budget() {
        let cell = Cell {
            path: SITE_SECURITY_SOURCES,
            scale: SECURITY_SCALE,
            shape: "direct",
            users: 1,
            mode: "on",
        };
        assert!(cell.selected(false, Some(1.0)));
        assert!(
            !Cell {
                path: SITE_SERVICE_STREAMS,
                ..cell
            }
            .selected(false, Some(1.0))
        );
        let fixture = Fixture::new(cell.scale);
        let workload = Workload::new(cell, &fixture);
        assert_eq!(workload.requested.len(), 2_000);
        assert_eq!(workload.configured_sources.len(), 2);
        assert!(
            fixture
                .subset_streams()
                .all(|(_, name)| !workload.configured_sources.contains(name))
        );
        assert!(
            workload
                .requested
                .iter()
                .all(|(kind, _)| *kind == StreamType::Logs)
        );
        assert_eq!(cell.budget(workload.types.len()), Some(7));
        assert_eq!(cell.security_p95_gate(Some(1_500.0)), Some(true));
        assert_eq!(cell.security_p95_gate(Some(1_501.0)), Some(false));
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn s6_requests_five_hundred_streams_across_types() {
        let cell = Cell {
            path: S6,
            scale: S6_SCALE,
            shape: "direct",
            users: 1,
            mode: "on",
        };
        let fixture = Fixture::new(cell.scale);
        let workload = Workload::new(cell, &fixture);
        assert!(cell.selected(false, Some(1.0)));
        assert_eq!(member_role(cell.shape), UserRole::User);
        let sources = workload.s6.unwrap().sources;
        assert_eq!(sources.len(), 500);
        for kind in TYPES {
            assert!(sources.iter().any(|source| {
                matches!(source, QuerySource::Stream { stream_type, .. } if *stream_type == kind)
            }));
        }
        assert_eq!(cell.peak_limit(TYPES.len()), 16);
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn wall_p99_requires_one_hundred_waves() {
        let mut samples = (1..=100)
            .rev()
            .map(Duration::from_millis)
            .collect::<Vec<_>>();
        let incomplete = Latency::wall(&mut samples[..99]);
        assert_eq!(incomplete.p99_ms, None);
        let complete = Latency::wall(&mut samples);
        assert_eq!(complete.p50_ms.map(f64::round), Some(50.0));
        assert_eq!(complete.p95_ms.map(f64::round), Some(95.0));
        assert_eq!(complete.p99_ms.map(f64::round), Some(99.0));
        assert_eq!(complete.max_ms.map(f64::round), Some(100.0));
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn observer_retains_exact_timings_under_each_operation() {
        let timings = CALL_TIMINGS.sync_scope(RefCell::default(), || {
            for (i, op) in OPS.into_iter().enumerate().rev() {
                observe_call(
                    op,
                    CallOutcome::Allow,
                    Duration::from_micros(110 * (i as u64 + 1)),
                );
            }
            CALL_TIMINGS.with(RefCell::take)
        });
        for (i, samples) in timings.into_iter().enumerate() {
            assert_eq!(samples, vec![Duration::from_micros(110 * (i as u64 + 1))]);
        }
    }

    #[test]
    #[ignore = "bench: needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
    fn server_counter_sums_only_authorization_rpcs() {
        let metrics = concat!(
            "# TYPE grpc_server_handled_total counter\n",
            "grpc_server_handled_total{grpc_code=\"OK\",grpc_method=\"Check\"} 2e+06\n",
            "grpc_server_handled_total{grpc_code=\"Canceled\",grpc_method=\"StreamedListObjects\"} 3\n",
            "grpc_server_handled_total{grpc_code=\"OK\",grpc_method=\"ListObjects\"} 5\n",
            "grpc_server_handled_total{grpc_code=\"OK\",grpc_method=\"Write\"} 11\n",
        );
        assert_eq!(grpc_calls(metrics), Some(2_000_008));
        assert_eq!(grpc_calls("# HELP unrelated_metric other"), None);
    }

    async fn chunks(
        ConnectInfo(peer): ConnectInfo<SocketAddr>,
        State(release): State<Arc<Notify>>,
        request: axum::body::Bytes,
    ) -> impl IntoResponse {
        assert!(request.as_ref() == b"{}" || request.as_ref() == NEIGHBOR_BODY.as_bytes());
        let body =
            stream::once(async { Ok::<_, Infallible>("first") }).chain(stream::once(async move {
                release.notified().await;
                Ok("last")
            }));
        (
            [("x-peer-port", peer.port().to_string())],
            Body::from_stream(body),
        )
    }
}
