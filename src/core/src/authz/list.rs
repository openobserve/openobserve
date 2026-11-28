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

mod error_table;
pub mod outcome;

use std::{
    borrow::Cow,
    collections::{BTreeSet, HashMap, HashSet},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use axum::{
    Json,
    http::{HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use config::{
    meta::stream::{ALL_STREAM_TYPES, StreamType},
    metrics::authz as metrics,
};
use futures::stream::StreamExt;
use tokio::time::Instant;
use tracing::Instrument;

pub use self::outcome::{
    Calls, ErrorDenials, Folded, Outcome, Scope, all_of, error_denials_of, without_error_denials,
};
pub(crate) use self::outcome::{object_outcome, record_error_denial};
use super::{
    SharedAnswers, StreamAccessChecker, check_each, org_wide_shortcut_covers, shared_cell,
};

pub const SITE_SERVICE_STREAMS: Site = "service_streams";
pub const SITE_SERVICE_STREAMS_CORRELATE: Site = "service_streams_correlate";
pub const SITE_SERVICE_IDENTITY: Site = "service_identity";
pub const SITE_SERVICE_EVIDENCE: Site = "service_evidence";
pub const SITE_SECURITY_SOURCES: Site = "security_sources";
pub const SITE_DB_MONITORING: Site = "db_monitoring";
pub const SITE_AUTOOBSERVE_STREAMS: Site = "autoobserve_streams";
pub const SITE_SERVICE_GRAPH: Site = "service_graph";
pub const SITE_GEN_AI: Site = "gen_ai";

/// At or below this many objects, Checks cost less: at 1 CPU the OpenFGA probes and lists cost
/// about 55 ms and one Check about 10.5 ms.
pub const SMALL_REQUEST_OBJECTS: usize = 5;

/// OpenFGA accepts every id of this length in the covered alphabet, so a type answer decides it.
pub(super) const MAX_COVERED_ID_LEN: usize = 200;

/// Lists stop at the 2.9 s guard; past this a sampled request would only wait on fallback Checks.
const SHADOW_NEW_PATH_BUDGET: Duration = Duration::from_secs(3);

/// At most one shadow comparison runs per node, so the per-stream Checks never run twice at once.
static SHADOW_BUSY: AtomicBool = AtomicBool::new(false);

// The node-wide shadow slot and metrics are shared, so shadow tests run one at a time.
#[cfg(test)]
pub(crate) static SHADOW_TESTS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Static site name; it becomes a metric label, so it must come from a fixed set.
pub type Site = &'static str;

/// `(type, name)` pairs of one org's streams.
pub type StreamSet = HashSet<(StreamType, String)>;

/// The type-level answer for a stream set: the readable streams (`None` is all) and the answers.
pub type StreamAnswer = Result<(Option<StreamSet>, TypeAnswers), AuthzUnavailable>;

/// A yes/no answer; `Err` names the refused stream's type, or `None` when no stream was asked.
pub type Verdict = Result<(), Option<StreamType>>;

#[derive(Clone, Copy)]
pub struct Decision {
    pub verdict: Verdict,
    /// Length of the deciding prefix, or zero for a denial without a valid object.
    pub decided: usize,
}

/// Type answers kept by `answer_in_mode`, served in `on`, compared only in a sampled `shadow` call.
#[derive(Clone, Debug)]
pub enum ModeAnswers {
    Legacy,
    /// `on` served the legacy answer of a small request.
    SmallOn,
    Serve(TypeAnswers),
    Shadow(TypeAnswers),
}

pub enum ShadowComparison<'a> {
    Requested,
    Objects(&'a [ObjectRef<'a>]),
    /// The site applies the small-request cutoff after its request-wide answer.
    PreserveUnscoped(StreamType),
}

/// Who asks a list question, and from which site; the mode comes from the user's settings.
#[derive(Clone, Copy)]
pub struct ListCaller<'a> {
    pub checker: &'a dyn StreamAccessChecker,
    pub site: Site,
    pub user_id: &'a str,
}

/// Which path answers a converted site (`O2_OPENFGA_LIST_AUTHZ_MODE`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ListMode {
    #[default]
    Off,
    Shadow,
    On,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ListSettings {
    pub mode: ListMode,
    pub shadow_sample: f64,
    pub fallback_concurrency: usize,
    pub small_request_objects: usize,
}

impl Default for ListSettings {
    fn default() -> Self {
        Self {
            mode: ListMode::Off,
            shadow_sample: 0.0,
            fallback_concurrency: 16,
            small_request_objects: 0,
        }
    }
}

/// Whether the type-level path may send a streamed list; `Enabled` needs a declared deadline.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ListPolicy {
    #[default]
    Disabled,
    Enabled,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ObjectsQuery<'a> {
    pub site: Site,
    pub org_id: &'a str,
    pub user_id: &'a str,
    pub stream_types: &'a [StreamType],
    pub permission: &'a str,
    /// Flags exactly as the site's per-object Check passes them.
    pub use_all_org: bool,
    pub use_self_parent: bool,
    pub use_self_context: bool,
    /// The site's per-object Check parent id, empty when absent.
    pub parent_id: &'a str,
    pub bypass: Bypass,
    pub identity: Identity,
    /// The site's own org-wide Check, sent unchanged; `None` when the site has none.
    pub prelude: Option<OrgWideCheck<'a>>,
}

impl ObjectsQuery<'_> {
    pub fn type_level_supported(&self) -> bool {
        !self.use_all_org && (!self.use_self_context || self.parent_id.is_empty())
    }
}

/// Only what the site's code skips today; admins otherwise go through the role branch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bypass {
    RbacOffOrRoot,
    RbacOffRootOrOrgAdmin,
    OpenFgaOffOrRoot,
}

/// The user string the site's helper sends today.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Identity {
    GivenId,
    StoredEmail,
}

/// Arguments of `check_permissions(org, org, user, resource, perm, None, use_all_org, sc, sp)`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OrgWideCheck<'a> {
    pub resource: &'a str,
    pub permission: &'a str,
    pub use_all_org: bool,
    pub use_self_context: bool,
    pub use_self_parent: bool,
}

#[derive(Clone, Debug)]
pub struct ObjectRef<'a> {
    /// Returned in `Readable` as given.
    pub id: &'a str,
    pub stream_type: StreamType,
    /// The id exactly as the site's current Check composes it after `type:`.
    pub ofga_id: Cow<'a, str>,
}

impl<'a> ObjectRef<'a> {
    /// A stream as the sanitizing sites name it in their Check.
    pub fn stream(stream_type: StreamType, name: &'a str) -> Self {
        Self {
            id: name,
            stream_type,
            ofga_id: Cow::Owned(config::utils::str::into_ofga_supported_format(name)),
        }
    }
}

/// The two Checks a converted site's `origin/main` loop sends, so its legacy copy also runs on a
/// fake.
#[async_trait::async_trait]
pub trait LegacyChecks: Send + Sync {
    async fn org_wide(&self, org_id: &str, user_id: &str, check: &OrgWideCheck<'_>) -> bool;

    async fn object(
        &self,
        org_id: &str,
        user_id: &str,
        query: &ObjectsQuery<'_>,
        object: &ObjectRef<'_>,
    ) -> bool;
}

/// Sends each Check through `check_permissions` with the sites' own arguments.
#[cfg(feature = "enterprise")]
pub struct TodayChecks;

#[cfg(feature = "enterprise")]
#[async_trait::async_trait]
impl LegacyChecks for TodayChecks {
    async fn org_wide(&self, org_id: &str, user_id: &str, check: &OrgWideCheck<'_>) -> bool {
        crate::auth::check_permissions(
            org_id,
            org_id,
            user_id,
            check.resource,
            check.permission,
            None,
            check.use_all_org,
            check.use_self_context,
            check.use_self_parent,
        )
        .await
    }

    async fn object(
        &self,
        org_id: &str,
        user_id: &str,
        query: &ObjectsQuery<'_>,
        object: &ObjectRef<'_>,
    ) -> bool {
        crate::auth::check_permissions(
            &object.ofga_id,
            org_id,
            user_id,
            object.stream_type.as_str(),
            query.permission,
            None,
            false,
            query.use_self_context,
            query.use_self_parent,
        )
        .await
    }
}

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
pub struct CheckerChecks<'a>(pub &'a dyn StreamAccessChecker);

#[cfg(any(test, all(feature = "enterprise", feature = "test-utils")))]
#[async_trait::async_trait]
impl LegacyChecks for CheckerChecks<'_> {
    async fn org_wide(&self, org_id: &str, user_id: &str, check: &OrgWideCheck<'_>) -> bool {
        self.0
            .org_wide_check(user_id, org_id, check)
            .await
            .unwrap_or_else(|e| {
                record_error_denial(e.reason);
                false
            })
    }

    async fn object(
        &self,
        org_id: &str,
        user_id: &str,
        query: &ObjectsQuery<'_>,
        object: &ObjectRef<'_>,
    ) -> bool {
        self.0
            .check_object(user_id, org_id, query, object)
            .await
            .unwrap_or_else(|e| {
                record_error_denial(e.reason);
                false
            })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Readable {
    /// Only from the bypass or a `true` prelude.
    All,
    /// The requested `(type, id)` pairs the user may access.
    Only(HashSet<(StreamType, String)>),
}

impl Readable {
    /// `None` means every stream, as `readable_streams` answers.
    pub fn into_streams(self) -> Option<StreamSet> {
        match self {
            Self::All => None,
            Self::Only(streams) => Some(streams),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnavailableReason {
    NotInitialized,
    Timeout,
    Transport,
    Server(u16),
    MissingAnswer,
}

impl UnavailableReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::NotInitialized => "not_initialized",
            Self::Timeout => "timeout",
            Self::Transport => "transport",
            Self::Server(_) => "server",
            Self::MissingAnswer => "missing_answer",
        }
    }
}

#[cfg(feature = "enterprise")]
impl From<o2_openfga::authorizer::decision::Unavailable> for UnavailableReason {
    fn from(err: o2_openfga::authorizer::decision::Unavailable) -> Self {
        use o2_openfga::authorizer::decision::Unavailable;

        match err {
            Unavailable::NotInitialized => Self::NotInitialized,
            Unavailable::Timeout => Self::Timeout,
            Unavailable::Transport => Self::Transport,
            Unavailable::Server(status) => Self::Server(status),
            Unavailable::MissingAnswer => Self::MissingAnswer,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AuthzUnavailable {
    pub reason: UnavailableReason,
}

impl From<UnavailableReason> for AuthzUnavailable {
    fn from(reason: UnavailableReason) -> Self {
        Self { reason }
    }
}

#[cfg(feature = "enterprise")]
impl From<o2_openfga::authorizer::decision::Unavailable> for AuthzUnavailable {
    fn from(err: o2_openfga::authorizer::decision::Unavailable) -> Self {
        Self { reason: err.into() }
    }
}

impl std::fmt::Display for AuthzUnavailable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "permission service unavailable: {:?}", self.reason)
    }
}

impl std::error::Error for AuthzUnavailable {}

/// OpenAPI shape of [`authz_unavailable_response`]'s body.
#[derive(utoipa::ToSchema)]
pub struct AuthzUnavailableBody {
    #[schema(example = 503)]
    pub code: u16,
    #[schema(example = "authz_unavailable")]
    pub error_code: String,
    #[schema(example = "Permission service unavailable, try again")]
    pub message: String,
}

/// First failure of an infallible callback chain; only the AutoObserve streams site uses it.
#[derive(Default)]
pub struct AuthzLatch(std::sync::OnceLock<AuthzUnavailable>);

impl AuthzLatch {
    pub fn record(&self, err: AuthzUnavailable) {
        self.0.get_or_init(|| err);
    }

    pub fn failure(&self) -> Option<AuthzUnavailable> {
        self.0.get().copied()
    }
}

/// OSS form of the effective shape, so the trait needs no enterprise type.
#[derive(Clone, Copy, Debug)]
pub struct StreamShape<'a> {
    pub permission: &'a str,
    pub self_parent_edge: bool,
    pub identity: Identity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TypeAccessKind {
    All,
    Role(bool),
    Listed(HashSet<String>),
    Unlisted(UnlistedKind),
    /// The type query failed, so each id it would answer is an `Error`; other ids take their Check.
    Failed(UnavailableReason),
}

impl TypeAccessKind {
    fn strategy(&self) -> &'static str {
        match self {
            Self::All => "probe_all",
            Self::Role(_) => "role",
            Self::Listed(_) => "list",
            Self::Unlisted(kind) => kind.as_str(),
            Self::Failed(_) => "failed",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnlistedKind {
    Disabled,
    Rejected,
    Incomplete,
    OfflineRule,
}

impl UnlistedKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "unlisted",
            Self::Rejected => "list_rejected",
            Self::Incomplete => "list_incomplete",
            Self::OfflineRule => "offline_rule",
        }
    }
}

#[cfg(feature = "enterprise")]
impl From<o2_openfga::authorizer::list::TypeAccess> for TypeAccessKind {
    fn from(access: o2_openfga::authorizer::list::TypeAccess) -> Self {
        use o2_openfga::authorizer::list::{TypeAccess, UnlistedReason};

        match access {
            TypeAccess::All => Self::All,
            TypeAccess::Listed(ids) => Self::Listed(ids),
            TypeAccess::Unlisted(reason) => Self::Unlisted(match reason {
                UnlistedReason::Disabled => UnlistedKind::Disabled,
                UnlistedReason::Rejected => UnlistedKind::Rejected,
                UnlistedReason::Incomplete => UnlistedKind::Incomplete,
                UnlistedReason::OfflineRule => UnlistedKind::OfflineRule,
            }),
        }
    }
}

/// Steps 0-3 for a type set, kept by the caller for one request only.
#[derive(Clone, Debug)]
pub struct TypeAnswers {
    query: OwnedQuery,
    answer: Answer,
    fallback_concurrency: usize,
    /// Failed Checks are kept too, so an outage costs one timeout per object, not one per reader.
    fallback_checks: Arc<SharedAnswers<FallbackKey, Outcome>>,
    shadow_deadline: Option<Instant>,
    later: Option<Arc<LaterTypes>>,
}

impl TypeAnswers {
    fn new(checker: &dyn StreamAccessChecker, query: &ObjectsQuery<'_>, answer: Answer) -> Self {
        let answers = Self {
            query: OwnedQuery::new(query),
            answer,
            fallback_concurrency: checker.list_settings(query.user_id).fallback_concurrency,
            fallback_checks: Default::default(),
            shadow_deadline: None,
            later: None,
        };
        for strategy in answers.strategies() {
            metrics::AUTHZ_STRATEGY_TOTAL
                .with_label_values(&[query.site, strategy])
                .inc();
        }
        answers
    }

    pub fn reads_every(&self) -> bool {
        matches!(self.answer, Answer::Every(_))
    }

    /// Asks the type query of `types` only when an object of one of them is first decided.
    pub fn with_later_types(mut self, types: &[StreamType]) -> Self {
        if let Answer::PerType(per_type) = &self.answer {
            let types: Vec<_> = types
                .iter()
                .filter(|t| !per_type.contains_key(*t))
                .copied()
                .collect();
            if !types.is_empty() {
                self.later = Some(Arc::new(LaterTypes {
                    types,
                    answer: Default::default(),
                }));
            }
        }
        self
    }

    /// One object's outcome; `None` when `calls` is held-only and no answer is held.
    pub async fn decide_object(
        &self,
        checker: &dyn StreamAccessChecker,
        site: Site,
        object: &ObjectRef<'_>,
        calls: Calls,
    ) -> Option<Outcome> {
        let kind = match &self.answer {
            Answer::Every(_) => return Some(Outcome::Allow),
            Answer::PerType(per_type) => match per_type.get(&object.stream_type) {
                Some(kind) => Some(kind),
                None => {
                    self.later_kind(checker, site, object.stream_type, calls)
                        .await?
                }
            },
        };
        if let Some(outcome) = kind.and_then(|kind| covered_answer(kind, object)) {
            return Some(outcome);
        }
        let key = (object.stream_type, object.id.to_string());
        let sent_id = object.ofga_id.as_ref();
        let check_id = (sent_id != object.id).then(|| sent_id.to_string());
        let cell = shared_cell(&self.fallback_checks, (key, check_id));
        if let Some(outcome) = cell.get() {
            return Some(*outcome);
        }
        if calls == Calls::HeldOnly {
            return None;
        }
        let query = self.query.borrowed(site);
        let outcome = cell
            .get_or_init(|| async {
                metrics::AUTHZ_FALLBACK_CHECKS_TOTAL
                    .with_label_values(&[site])
                    .inc();
                Outcome::of(
                    checker
                        .check_object(query.user_id, query.org_id, &query, object)
                        .await,
                )
            })
            .await;
        Some(*outcome)
    }

    pub async fn all_allowed(
        &self,
        checker: &dyn StreamAccessChecker,
        site: Site,
        objects: &[ObjectRef<'_>],
        calls: Calls,
    ) -> Folded {
        metrics::AUTHZ_OBJECTS_AUTHORIZED
            .with_label_values(&[site])
            .observe(objects.len() as f64);
        all_of(calls, objects, |object, calls| {
            self.decide_object(checker, site, object, calls)
        })
        .await
    }

    pub async fn decide_prefix(
        &self,
        checker: &dyn StreamAccessChecker,
        site: Site,
        objects: &[ObjectRef<'_>],
        stream_count: usize,
    ) -> Result<Decision, AuthzUnavailable> {
        let folded = self.all_allowed(checker, site, objects, Calls::Send).await;
        match folded.outcome {
            Some(Outcome::Deny) => Ok(Decision {
                verdict: Err(objects.get(folded.decided - 1).map(|o| o.stream_type)),
                decided: folded.decided,
            }),
            Some(Outcome::Error(reason)) => Err(reason.into()),
            Some(Outcome::Allow) if objects.len() == stream_count => Ok(Decision {
                verdict: Ok(()),
                decided: stream_count,
            }),
            Some(Outcome::Allow) | None => Ok(Decision {
                verdict: Err(None),
                decided: 0,
            }),
        }
    }

    /// The readable set and the objects an error left denied. After the first error no new
    /// Check starts, and an object still unanswered then counts as an error.
    pub async fn decide_outcomes(
        &self,
        checker: &dyn StreamAccessChecker,
        site: Site,
        objects: &[ObjectRef<'_>],
    ) -> (Readable, ErrorDenials) {
        metrics::AUTHZ_OBJECTS_AUTHORIZED
            .with_label_values(&[site])
            .observe(objects.len() as f64);
        if matches!(self.answer, Answer::Every(_)) {
            return (Readable::All, ErrorDenials::default());
        }
        let mut readable = HashSet::new();
        let mut denials = ErrorDenials::default();
        let mut pending = Vec::new();
        let mut seen = HashSet::new();
        for (i, object) in objects.iter().enumerate() {
            if !seen.insert((object.stream_type, object.id, object.ofga_id.as_ref())) {
                continue;
            }
            match self
                .decide_object(checker, site, object, Calls::HeldOnly)
                .await
            {
                Some(outcome) => settle(&mut readable, &mut denials, object, outcome),
                None => pending.push(i),
            }
        }
        let failed = std::sync::OnceLock::new();
        let failed = &failed;
        if let Some(reason) = denials.first() {
            let _ = failed.set(reason);
        }
        // indices, not references: a closure over `&ObjectRef` makes the future fail the Send proof
        let mut checks = futures::stream::iter(pending)
            .map(|i| async move {
                let object = &objects[i];
                let calls = if failed.get().is_some() {
                    Calls::HeldOnly
                } else {
                    Calls::Send
                };
                let outcome = self.decide_object(checker, site, object, calls).await;
                if let Some(Outcome::Error(reason)) = outcome {
                    let _ = failed.set(reason);
                }
                (i, outcome)
            })
            .buffer_unordered(self.fallback_concurrency.max(1));
        while let Some((i, outcome)) = checks.next().await {
            let object = &objects[i];
            let outcome = outcome.unwrap_or_else(|| {
                Outcome::Error(*failed.get().expect("held-only only after a failure"))
            });
            settle(&mut readable, &mut denials, object, outcome);
        }
        (Readable::Only(readable), denials)
    }

    /// Covered ids from the type answers, every other id by `check_object`; any error fails.
    pub async fn decide(
        &self,
        checker: &dyn StreamAccessChecker,
        site: Site,
        objects: &[ObjectRef<'_>],
    ) -> Result<Readable, AuthzUnavailable> {
        let (readable, denials) = self.decide_outcomes(checker, site, objects).await;
        match denials.first() {
            Some(reason) => Err(reason.into()),
            None => Ok(readable),
        }
    }

    async fn later_kind(
        &self,
        checker: &dyn StreamAccessChecker,
        site: Site,
        stream_type: StreamType,
        calls: Calls,
    ) -> Option<Option<&TypeAccessKind>> {
        let Some(later) = self
            .later
            .as_deref()
            .filter(|later| later.types.contains(&stream_type))
        else {
            return Some(None);
        };
        if later.answer.get().is_none() && calls == Calls::HeldOnly {
            return None;
        }
        let answer = later
            .answer
            .get_or_init(|| async {
                let query = self.query.borrowed(site);
                let answer = per_type_answers(checker, &query, &later.types).await;
                for kind in answer.values() {
                    metrics::AUTHZ_STRATEGY_TOTAL
                        .with_label_values(&[site, kind.strategy()])
                        .inc();
                }
                answer
            })
            .await;
        Some(answer.get(&stream_type))
    }

    fn strategies(&self) -> Vec<&'static str> {
        match &self.answer {
            Answer::Every(strategy) => vec![strategy],
            Answer::PerType(per_type) => per_type.values().map(|a| a.strategy()).collect(),
        }
    }

    fn decided_strategies(&self, objects: &[ObjectRef<'_>]) -> BTreeSet<&'static str> {
        let per_type = match &self.answer {
            Answer::Every(strategy) => return BTreeSet::from([*strategy]),
            Answer::PerType(per_type) => per_type,
        };
        let later = self.later.as_deref().and_then(|later| later.answer.get());
        let mut strategies = BTreeSet::new();
        for object in objects {
            let kind = per_type
                .get(&object.stream_type)
                .or_else(|| later.and_then(|answer| answer.get(&object.stream_type)));
            match kind {
                Some(TypeAccessKind::Unlisted(kind)) => {
                    strategies.insert(kind.as_str());
                }
                Some(kind) if probe_covers(&object.ofga_id) => {
                    strategies.insert(kind.strategy());
                }
                _ => {}
            }
        }
        strategies
    }
}

/// A type query deferred to its first object, so an unused type's failure fails nothing.
#[derive(Debug)]
struct LaterTypes {
    types: Vec<StreamType>,
    answer: tokio::sync::OnceCell<HashMap<StreamType, TypeAccessKind>>,
}

// The same returned id can name different OpenFGA objects at raw and sanitizing sites.
type FallbackKey = ((StreamType, String), Option<String>);

/// The parts of an `ObjectsQuery` that `check_object` reads, owned so the answers can be kept.
#[derive(Clone, Debug)]
struct OwnedQuery {
    org_id: String,
    user_id: String,
    permission: String,
    use_all_org: bool,
    use_self_parent: bool,
    use_self_context: bool,
    parent_id: String,
    bypass: Bypass,
    identity: Identity,
}

impl OwnedQuery {
    fn new(query: &ObjectsQuery<'_>) -> Self {
        Self {
            org_id: query.org_id.to_string(),
            user_id: query.user_id.to_string(),
            permission: query.permission.to_string(),
            use_all_org: query.use_all_org,
            use_self_parent: query.use_self_parent,
            use_self_context: query.use_self_context,
            parent_id: query.parent_id.to_string(),
            bypass: query.bypass,
            identity: query.identity,
        }
    }

    fn borrowed(&self, site: Site) -> ObjectsQuery<'_> {
        ObjectsQuery {
            site,
            org_id: &self.org_id,
            user_id: &self.user_id,
            stream_types: &[],
            permission: &self.permission,
            use_all_org: self.use_all_org,
            use_self_parent: self.use_self_parent,
            use_self_context: self.use_self_context,
            parent_id: &self.parent_id,
            bypass: self.bypass,
            identity: self.identity,
            prelude: None,
        }
    }
}

#[derive(Clone, Debug)]
enum Answer {
    /// Every object, from the bypass or a `true` prelude; holds the strategy label.
    Every(&'static str),
    PerType(HashMap<StreamType, TypeAccessKind>),
}

/// Releases the node's shadow slot when the comparison ends or is dropped.
struct ShadowSlot;

impl ShadowSlot {
    fn claim() -> Option<Self> {
        SHADOW_BUSY
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()
            .map(|_| Self)
    }
}

impl Drop for ShadowSlot {
    fn drop(&mut self) {
        SHADOW_BUSY.store(false, Ordering::Release);
    }
}

pub async fn authorize_objects(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    objects: &[ObjectRef<'_>],
) -> Result<Readable, AuthzUnavailable> {
    let span = tracing::info_span!(
        "authz.authorize_objects",
        site = query.site,
        permission = query.permission,
        objects = objects.len(),
        strategy = tracing::field::Empty
    );
    async {
        let mut types: Vec<StreamType> = Vec::new();
        for object in objects {
            if !types.contains(&object.stream_type) {
                types.push(object.stream_type);
            }
        }
        let answers = type_answers(checker, query, &types).await?;
        record_strategy(&span, &answers);
        answers.decide(checker, query.site, objects).await
    }
    .instrument(span.clone())
    .await
}

/// A converted object loop in the configured mode; `None` reads every requested object.
/// Both paths decide only the objects `scope` shows, and `legacy` receives exactly those.
pub async fn objects_in_mode<'o, LF: Future<Output = Option<StreamSet>>>(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    objects: &[ObjectRef<'o>],
    scope: &Scope,
    legacy: impl FnOnce(Vec<ObjectRef<'o>>) -> LF,
) -> Result<Option<StreamSet>, AuthzUnavailable> {
    let objects: Vec<ObjectRef<'o>> = objects
        .iter()
        .filter(|object| scope.shows(object.stream_type, object.id))
        .cloned()
        .collect();
    let objects = objects.as_slice();
    let (readable, _) = answer_in_mode_with(
        ListCaller {
            checker,
            site: query.site,
            user_id: query.user_id,
        },
        |_| std::future::ready(objects.iter().map(|object| (object.stream_type, object.id))),
        ShadowComparison::Objects(objects),
        scope,
        || legacy(objects.to_vec()),
        |_| async {
            let mut types = Vec::new();
            for object in objects {
                if !types.contains(&object.stream_type) {
                    types.push(object.stream_type);
                }
            }
            object_answers(checker, query, &types, objects).await
        },
    )
    .await?;
    Ok(readable)
}

/// Type answers for `types`, then the objects they allow; `None` reads every object.
#[tracing::instrument(name = "authz.authorize_objects", skip_all, fields(
    site = query.site, permission = query.permission, objects = objects.len(), strategy
))]
pub async fn object_answers(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    types: &[StreamType],
    objects: &[ObjectRef<'_>],
) -> StreamAnswer {
    let answers = type_answers(checker, query, types).await?;
    record_strategy(&tracing::Span::current(), &answers);
    let readable = answers.decide(checker, query.site, objects).await?;
    Ok((readable.into_streams(), answers))
}

pub async fn type_answers(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    types: &[StreamType],
) -> Result<TypeAnswers, AuthzUnavailable> {
    if let Some(answers) = request_wide_answers(checker, query).await? {
        return Ok(answers);
    }
    Ok(scoped_type_answers(checker, query, types).await)
}

pub(crate) async fn request_wide_answers(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
) -> Result<Option<TypeAnswers>, AuthzUnavailable> {
    let strategy = if bypassed(checker, query).await {
        "bypass"
    } else if let Some(prelude) = &query.prelude
        && checker
            .org_wide_check(query.user_id, query.org_id, prelude)
            .await?
    {
        "prelude"
    } else {
        return Ok(None);
    };
    Ok(Some(TypeAnswers::new(
        checker,
        query,
        Answer::Every(strategy),
    )))
}

pub(crate) async fn scoped_type_answers(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    types: &[StreamType],
) -> TypeAnswers {
    let per_type = per_type_answers(checker, query, types).await;
    TypeAnswers::new(checker, query, Answer::PerType(per_type))
}

/// The streams in `scope` the user can read, or `None` when RBAC lets them read every stream.
pub async fn readable_streams(
    checker: &dyn StreamAccessChecker,
    site: Site,
    user_id: &str,
    org_id: &str,
    streams: HashSet<(StreamType, String)>,
    scope: &Scope,
) -> Result<Option<StreamSet>, AuthzUnavailable> {
    let streams = scope.narrow(streams);
    let settings = checker.list_settings(user_id);
    if settings.mode == ListMode::Off {
        return Ok(legacy_readable_streams(checker, user_id, org_id, streams).await);
    }
    let (readable, _) = answer_with_settings(
        settings,
        site,
        |_| std::future::ready(streams.iter().map(|(kind, name)| (*kind, name.as_str()))),
        ShadowComparison::Requested,
        scope,
        || legacy_readable_streams(checker, user_id, org_id, streams.clone()),
        |_| async {
            let mut types: Vec<_> = streams.iter().map(|(t, _)| *t).collect();
            types.sort_unstable_by_key(|t| t.as_str());
            types.dedup();
            stream_answers(checker, site, user_id, org_id, &streams, &types).await
        },
    )
    .await?;
    Ok(readable)
}

/// Type answers for `types`, then the streams of `streams` they allow; `None` reads every stream.
pub async fn stream_answers(
    checker: &dyn StreamAccessChecker,
    site: Site,
    user_id: &str,
    org_id: &str,
    streams: &StreamSet,
    types: &[StreamType],
) -> StreamAnswer {
    let query = stream_read_query(site, org_id, user_id, types);
    stream_answers_for_query(checker, &query, streams).await
}

pub async fn stream_answers_for_query(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    streams: &StreamSet,
) -> StreamAnswer {
    let (readable, denials, answers) = stream_outcomes_for_query(checker, query, streams).await?;
    match denials.first() {
        Some(reason) => Err(reason.into()),
        None => Ok((readable, answers)),
    }
}

/// As [`stream_answers_for_query`], for a site that may still admit a stream an error denied.
#[tracing::instrument(name = "authz.authorize_objects", skip_all, fields(
    site = query.site, permission = query.permission, objects = streams.len(), strategy
))]
pub async fn stream_outcomes_for_query(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    streams: &StreamSet,
) -> Result<(Option<StreamSet>, ErrorDenials, TypeAnswers), AuthzUnavailable> {
    let answers = type_answers(checker, query, query.stream_types).await?;
    record_strategy(&tracing::Span::current(), &answers);
    let objects: Vec<ObjectRef<'_>> = streams
        .iter()
        .map(|(stream_type, name)| ObjectRef::stream(*stream_type, name))
        .collect();
    let (readable, denials) = answers.decide_outcomes(checker, query.site, &objects).await;
    Ok((readable.into_streams(), denials, answers))
}

/// The query of the sites that call today's `readable_streams`: GET with the selfParent edge.
/// Its helpers send the stored email, and OpenFGA ids are case-sensitive.
pub fn stream_read_query<'a>(
    site: Site,
    org_id: &'a str,
    user_id: &'a str,
    stream_types: &'a [StreamType],
) -> ObjectsQuery<'a> {
    ObjectsQuery {
        site,
        org_id,
        user_id,
        stream_types,
        permission: "GET",
        use_all_org: false,
        use_self_parent: true,
        use_self_context: false,
        parent_id: "",
        bypass: Bypass::RbacOffRootOrOrgAdmin,
        identity: Identity::StoredEmail,
        prelude: None,
    }
}

pub fn security_sources_query<'a>(org_id: &'a str, user_id: &'a str) -> ObjectsQuery<'a> {
    stream_read_query(SITE_SECURITY_SOURCES, org_id, user_id, &[StreamType::Logs])
}

pub fn db_monitoring_query<'a>(
    org_id: &'a str,
    user_id: &'a str,
    stream_types: &'a [StreamType],
) -> ObjectsQuery<'a> {
    ObjectsQuery {
        prelude: Some(OrgWideCheck {
            resource: "db_monitoring",
            permission: "GET",
            use_all_org: true,
            use_self_context: false,
            use_self_parent: false,
        }),
        ..stream_read_query(SITE_DB_MONITORING, org_id, user_id, stream_types)
    }
}

pub fn autoobserve_streams_query<'a>(
    org_id: &'a str,
    user_id: &'a str,
    stream_types: &'a [StreamType],
) -> ObjectsQuery<'a> {
    stream_read_query(SITE_AUTOOBSERVE_STREAMS, org_id, user_id, stream_types)
}

pub fn gen_ai_query<'a>(org_id: &'a str, user_id: &'a str) -> ObjectsQuery<'a> {
    ObjectsQuery {
        bypass: Bypass::RbacOffOrRoot,
        ..stream_read_query(SITE_GEN_AI, org_id, user_id, &[])
    }
}

pub fn gen_ai_object<'a>(stream_type: &str, name: &'a str) -> Option<ObjectRef<'a>> {
    Some(ObjectRef {
        id: name,
        stream_type: listable_stream_type(stream_type)?,
        ofga_id: Cow::Borrowed(name),
    })
}

/// The stream type spelled exactly `s` whose type-level answer is proved; never lowercased.
pub fn listable_stream_type(s: &str) -> Option<StreamType> {
    let stream_type = ALL_STREAM_TYPES.into_iter().find(|t| t.as_str() == s)?;
    #[cfg(feature = "enterprise")]
    let listable = o2_openfga::authorizer::list::is_listable(super::stream_model(stream_type));
    #[cfg(not(feature = "enterprise"))]
    let listable = matches!(
        stream_type,
        StreamType::Logs
            | StreamType::Metrics
            | StreamType::Traces
            | StreamType::Profiles
            | StreamType::Index
            | StreamType::Metadata
    );
    listable.then_some(stream_type)
}

/// Runs the path the mode names; `shadow` returns the legacy answer and compares the new one.
pub async fn answer_in_mode<
    LF: Future<Output = Option<StreamSet>>,
    NF: Future<Output = StreamAnswer>,
>(
    checker: &dyn StreamAccessChecker,
    site: Site,
    user_id: &str,
    requested: &StreamSet,
    scope: &Scope,
    legacy: impl FnOnce(StreamSet) -> LF,
    new: impl FnOnce(StreamSet) -> NF,
) -> Result<(Option<StreamSet>, ModeAnswers), AuthzUnavailable> {
    let requested = scope.narrow(requested.clone());
    let requested = &requested;
    answer_in_mode_with(
        ListCaller {
            checker,
            site,
            user_id,
        },
        |_| std::future::ready(requested.iter().map(|(kind, name)| (*kind, name.as_str()))),
        ShadowComparison::Requested,
        scope,
        || legacy(requested.clone()),
        |_| new(requested.clone()),
    )
    .await
}

/// As [`answer_in_mode`] for a site that lists its objects only once a path needs them.
pub async fn answer_in_mode_with<
    'a,
    I: Iterator<Item = (StreamType, &'a str)>,
    RF: Future<Output = I>,
    LF: Future<Output = Option<StreamSet>>,
    NF: Future<Output = StreamAnswer>,
>(
    caller: ListCaller<'_>,
    requested: impl FnOnce(ListMode) -> RF,
    comparison: ShadowComparison<'_>,
    scope: &Scope,
    legacy: impl FnOnce() -> LF,
    new: impl FnOnce(ListMode) -> NF,
) -> Result<(Option<StreamSet>, ModeAnswers), AuthzUnavailable> {
    answer_with_settings(
        caller.checker.list_settings(caller.user_id),
        caller.site,
        requested,
        comparison,
        scope,
        legacy,
        new,
    )
    .await
}

pub async fn shadow_verdict<
    LF: Future<Output = (Decision, bool)>,
    NF: Future<Output = Result<Decision, AuthzUnavailable>>,
>(
    site: Site,
    answers: &TypeAnswers,
    objects: &[ObjectRef<'_>],
    legacy: impl FnOnce() -> LF,
    new: impl FnOnce() -> NF,
) -> Verdict {
    let deadline = answers.shadow_deadline.unwrap_or_else(shadow_deadline);
    if Instant::now() >= deadline {
        shadow_skipped(site, "new_timeout");
        return legacy().await.0.verdict;
    }
    let Some(_slot) = ShadowSlot::claim() else {
        shadow_skipped(site, "busy");
        return legacy().await.0.verdict;
    };
    let (((legacy, memo_had_error), legacy_errors), new) = futures::join!(
        counted(legacy()),
        tokio::time::timeout_at(deadline, counted(new())),
    );
    match new {
        Ok((new, _)) => compare_verdict(
            site,
            answers,
            objects,
            legacy,
            memo_had_error || legacy_errors > 0,
            new,
        ),
        Err(_) => shadow_skipped(site, "new_timeout"),
    }
    legacy.verdict
}

/// Logs and counts an unavailable answer that the site turns into a 503.
pub fn unavailable(site: Site, err: AuthzUnavailable) -> AuthzUnavailable {
    log::warn!(
        "[authz] {site}: permission service unavailable ({:?})",
        err.reason
    );
    metrics::AUTHZ_UNAVAILABLE_TOTAL
        .with_label_values(&[site, err.reason.as_str()])
        .inc();
    err
}

pub fn authz_unavailable_response(err: AuthzUnavailable) -> Response {
    log::debug!("[authz] answering 503: {err}");
    let body = serde_json::json!({
        "code": 503,
        "error_code": "authz_unavailable",
        "message": "Permission service unavailable, try again",
    });
    (
        StatusCode::SERVICE_UNAVAILABLE,
        [
            (header::RETRY_AFTER, HeaderValue::from_static("3")),
            (
                HeaderName::from_static("x-o2-authz"),
                HeaderValue::from_static("unavailable"),
            ),
        ],
        Json(body),
    )
        .into_response()
}

/// True for an id OpenFGA accepts as composed: 1-200 bytes of `[A-Za-z0-9_.=-]`.
pub fn probe_covers(ofga_id: &str) -> bool {
    (1..=MAX_COVERED_ID_LEN).contains(&ofga_id.len())
        && ofga_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b'=' | b'-'))
}

/// The `origin/main` answer for `off`, `shadow` and small `on` requests. Errors deny. [no-fail]
pub async fn legacy_readable_streams(
    checker: &dyn StreamAccessChecker,
    user_id: &str,
    org_id: &str,
    streams: HashSet<(StreamType, String)>,
) -> Option<StreamSet> {
    if !checker.enforces_rbac().await
        || checker.is_root(user_id).await
        || checker.is_root_or_admin(org_id, user_id).await
    {
        return None;
    }
    let mut per_type: std::collections::HashMap<StreamType, usize> = Default::default();
    for (stream_type, name) in &streams {
        if org_wide_shortcut_covers(*stream_type, name) {
            *per_type.entry(*stream_type).or_default() += 1;
        }
    }
    // A lone stream's own Check already counts the org-wide grants, so asking first costs more.
    let (covered, mut to_check): (Vec<_>, Vec<_>) =
        streams.into_iter().partition(|(stream_type, name)| {
            org_wide_shortcut_covers(*stream_type, name)
                && per_type.get(stream_type).is_some_and(|n| *n > 1)
        });
    let mut readable = HashSet::new();
    if !covered.is_empty() {
        let mut types: Vec<StreamType> = Vec::new();
        for (stream_type, _) in &covered {
            if !types.contains(stream_type) {
                types.push(*stream_type);
            }
        }
        let org_wide = checker.org_wide_readable(user_id, org_id, &types).await;
        for stream in covered {
            if org_wide.contains(&stream.0) {
                readable.insert(stream);
            } else {
                to_check.push(stream);
            }
        }
    }
    readable.extend(check_each(checker, user_id, org_id, to_check).await);
    Some(readable)
}

/// A legacy per-object Check whose failure is charged to that object, for a set answer.
pub async fn legacy_object_outcome(
    checks: &dyn LegacyChecks,
    query: &ObjectsQuery<'_>,
    object: &ObjectRef<'_>,
) -> Outcome {
    object_outcome(
        object.stream_type,
        object.id,
        checks.object(query.org_id, query.user_id, query, object),
    )
    .await
}

/// True when OpenFGA accepts the stream's own Check, so an org-wide grant is known to cover it.
pub(crate) fn org_wide_grant_covers(stream_name: &str) -> bool {
    probe_covers(&config::utils::str::into_ofga_supported_format(stream_name))
}

async fn answer_with_settings<
    'a,
    I: Iterator<Item = (StreamType, &'a str)>,
    RF: Future<Output = I>,
    LF: Future<Output = Option<StreamSet>>,
    NF: Future<Output = StreamAnswer>,
>(
    settings: ListSettings,
    site: Site,
    requested: impl FnOnce(ListMode) -> RF,
    comparison: ShadowComparison<'_>,
    scope: &Scope,
    legacy: impl FnOnce() -> LF,
    new: impl FnOnce(ListMode) -> NF,
) -> Result<(Option<StreamSet>, ModeAnswers), AuthzUnavailable> {
    // Answers are cut to the scope too, so every mode and the shadow comparison see one set.
    let requested = move |mode| async move {
        requested(mode)
            .await
            .filter(move |(kind, name)| scope.shows(*kind, name))
    };
    let legacy = move || async move { scope.narrow_answer(legacy().await) };
    let new = move |mode| async move {
        new(mode)
            .await
            .map(|(readable, answers)| (scope.narrow_answer(readable), answers))
    };
    match settings.mode {
        ListMode::Off => Ok((legacy().await, ModeAnswers::Legacy)),
        ListMode::On => {
            let cutoff = settings.small_request_objects;
            let requested: Option<Vec<(StreamType, &str)>> = if cutoff == 0 {
                None
            } else {
                match comparison {
                    ShadowComparison::Objects(objects) => {
                        let objects: Vec<_> = objects
                            .iter()
                            .filter(|object| scope.shows(object.stream_type, object.id))
                            .map(|object| (object.stream_type, object.id))
                            .collect();
                        (objects.len() <= cutoff).then_some(objects)
                    }
                    ShadowComparison::Requested => {
                        let requested: Vec<_> = requested(ListMode::On)
                            .await
                            .take(cutoff.saturating_add(1))
                            .collect();
                        (requested.len() <= cutoff).then_some(requested)
                    }
                    // The site sizes itself after its request-wide answer, so a bypass lists
                    // nothing.
                    ShadowComparison::PreserveUnscoped(_) => None,
                }
            };
            if let Some(requested) = requested {
                let (readable, denials) = error_denials_of(legacy()).await;
                if let Some(reason) = denials.hidden_error(&readable, requested) {
                    return Err(unavailable(site, reason.into()));
                }
                return Ok((readable, ModeAnswers::SmallOn));
            }
            match new(ListMode::On).await {
                Ok((readable, answers)) => Ok((readable, ModeAnswers::Serve(answers))),
                Err(err) => Err(unavailable(site, err)),
            }
        }
        ListMode::Shadow => {
            if !sampled(settings.shadow_sample) {
                return Ok((legacy().await, ModeAnswers::Legacy));
            }
            let Some(_slot) = ShadowSlot::claim() else {
                shadow_skipped(site, "busy");
                return Ok((legacy().await, ModeAnswers::Legacy));
            };
            let deadline = shadow_deadline();
            let ((legacy_answer, legacy_errors), new_answer) = futures::join!(
                counted(legacy()),
                tokio::time::timeout_at(deadline, counted(new(ListMode::Shadow))),
            );
            let Ok((new_answer, _)) = new_answer else {
                shadow_skipped(site, "new_timeout");
                return Ok((legacy_answer, ModeAnswers::Legacy));
            };
            let requested = requested(ListMode::Shadow)
                .await
                .map(|(kind, name)| (kind, name.to_string()))
                .collect();
            compare_shadow(
                site,
                &requested,
                comparison,
                &legacy_answer,
                legacy_errors,
                &new_answer,
            );
            let answers = match new_answer {
                Ok((_, mut answers)) => {
                    answers.shadow_deadline = Some(deadline);
                    ModeAnswers::Shadow(answers)
                }
                Err(_) => ModeAnswers::Legacy,
            };
            Ok((legacy_answer, answers))
        }
    }
}

fn sampled(rate: f64) -> bool {
    (0.0..=1.0).contains(&rate) && rate > 0.0 && rand::random::<f64>() < rate
}

fn shadow_deadline() -> Instant {
    Instant::now() + SHADOW_NEW_PATH_BUDGET
}

fn record_strategy(span: &tracing::Span, answers: &TypeAnswers) {
    if !span.is_disabled() {
        let strategies: BTreeSet<_> = answers.strategies().into_iter().collect();
        span.record(
            "strategy",
            tracing::field::display(strategies.into_iter().collect::<Vec<_>>().join(",")),
        );
    }
}

async fn bypassed(checker: &dyn StreamAccessChecker, query: &ObjectsQuery<'_>) -> bool {
    if !checker.enforces_rbac().await || checker.is_root(query.user_id).await {
        return true;
    }
    query.bypass == Bypass::RbacOffRootOrOrgAdmin
        && checker.is_root_or_admin(query.org_id, query.user_id).await
}

/// The answer a type query gives an id it covers; `None` sends the id to its own Check.
fn covered_answer(kind: &TypeAccessKind, object: &ObjectRef<'_>) -> Option<Outcome> {
    if !probe_covers(&object.ofga_id) {
        return None;
    }
    Some(match kind {
        TypeAccessKind::All | TypeAccessKind::Role(true) => Outcome::Allow,
        TypeAccessKind::Role(false) => Outcome::Deny,
        TypeAccessKind::Listed(ids) if ids.contains(object.ofga_id.as_ref()) => Outcome::Allow,
        TypeAccessKind::Listed(_) => Outcome::Deny,
        TypeAccessKind::Failed(reason) => Outcome::Error(*reason),
        TypeAccessKind::Unlisted(_) => return None,
    })
}

/// Per-type answers for `types`; a failed query answers each type `Failed`.
async fn per_type_answers(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    types: &[StreamType],
) -> HashMap<StreamType, TypeAccessKind> {
    if types.is_empty() {
        return HashMap::new();
    }
    let every = |kind: TypeAccessKind| types.iter().map(|t| (*t, kind.clone())).collect();
    if !query.type_level_supported() {
        return every(TypeAccessKind::Unlisted(UnlistedKind::Disabled));
    }
    let shape = StreamShape {
        permission: query.permission,
        self_parent_edge: query.use_self_parent,
        identity: query.identity,
    };
    match checker
        .types_access(query.user_id, query.org_id, &shape, types)
        .await
    {
        Ok(per_type) => per_type,
        Err(err) => every(TypeAccessKind::Failed(err.reason)),
    }
}

fn settle(
    readable: &mut HashSet<(StreamType, String)>,
    denials: &mut ErrorDenials,
    object: &ObjectRef<'_>,
    outcome: Outcome,
) {
    match outcome {
        Outcome::Allow => {
            readable.insert((object.stream_type, object.id.to_string()));
        }
        Outcome::Deny => (),
        Outcome::Error(reason) => denials.object(object.stream_type, object.id, reason),
    }
}

#[cfg(feature = "enterprise")]
async fn counted<F: Future>(fut: F) -> (F::Output, u32) {
    super::accounting::in_own_scope(fut).await
}

#[cfg(not(feature = "enterprise"))]
async fn counted<F: Future>(fut: F) -> (F::Output, u32) {
    (fut.await, 0)
}

fn compare_shadow(
    site: Site,
    requested: &StreamSet,
    comparison: ShadowComparison<'_>,
    legacy: &Option<StreamSet>,
    legacy_errors: u32,
    new: &StreamAnswer,
) {
    if legacy_errors > 0 {
        shadow_skipped(site, "legacy_error");
        return;
    }
    let Ok((new, answers)) = new else {
        shadow_skipped(site, "new_error");
        return;
    };
    let strategies = match comparison {
        ShadowComparison::Objects(objects) => answers.decided_strategies(objects),
        ShadowComparison::Requested | ShadowComparison::PreserveUnscoped(_) => {
            let objects: Vec<_> = requested
                .iter()
                .map(|(stream_type, name)| ObjectRef::stream(*stream_type, name))
                .collect();
            answers.decided_strategies(&objects)
        }
    };
    count_compared(site, strategies);
    if let ShadowComparison::PreserveUnscoped(stream_type) = comparison
        && legacy.is_none() != new.is_none()
    {
        let direction = if new.is_none() {
            "new_allows_more"
        } else {
            "new_allows_less"
        };
        log::warn!("[authz] {site}: shadow scope mismatch on {stream_type} ({direction})");
        metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
            .with_label_values(&[site, stream_type.as_str(), direction])
            .inc();
        return;
    }
    let legacy = legacy.as_ref().unwrap_or(requested);
    let new = new.as_ref().unwrap_or(requested);
    let mut differences: HashMap<(StreamType, &'static str), usize> = HashMap::new();
    for (stream, direction) in new
        .difference(legacy)
        .map(|s| (s, "new_allows_more"))
        .chain(legacy.difference(new).map(|s| (s, "new_allows_less")))
    {
        *differences.entry((stream.0, direction)).or_default() += 1;
    }
    for ((stream_type, direction), count) in differences {
        log::warn!(
            "[authz] {site}: shadow mismatch on {stream_type} ({direction}, {count} of {} streams)",
            requested.len()
        );
        metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
            .with_label_values(&[site, stream_type.as_str(), direction])
            .inc();
    }
}

fn compare_verdict(
    site: Site,
    answers: &TypeAnswers,
    objects: &[ObjectRef<'_>],
    legacy: Decision,
    legacy_had_error: bool,
    new: Result<Decision, AuthzUnavailable>,
) {
    if legacy_had_error {
        shadow_skipped(site, "legacy_error");
        return;
    }
    let Ok(new) = new else {
        shadow_skipped(site, "new_error");
        return;
    };
    let decided = [legacy, new]
        .into_iter()
        .filter(|decision| decision.verdict != Err(None))
        .map(|decision| decision.decided)
        .min()
        .unwrap_or(0);
    if decided > 0 {
        count_compared(site, answers.decided_strategies(&objects[..decided]));
    }
    let (stream_type, direction) = match (legacy.verdict, new.verdict) {
        (Ok(()), Err(stream_type)) => (stream_type, "new_allows_less"),
        (Err(stream_type), Ok(())) => (stream_type, "new_allows_more"),
        // An untyped denial follows the valid prefix and has no strategy of its own.
        (Err(Some(stream_type)), Err(None)) => (Some(stream_type), "new_allows_more"),
        (Err(None), Err(Some(stream_type))) => (Some(stream_type), "new_allows_less"),
        (Err(stream_type), Err(_)) if legacy.decided < new.decided => {
            (stream_type, "new_allows_more")
        }
        (Err(_), Err(stream_type)) if new.decided < legacy.decided => {
            (stream_type, "new_allows_less")
        }
        _ => return,
    };
    let stream_type = stream_type.map_or("unknown", |t| t.as_str());
    log::warn!("[authz] {site}: shadow mismatch on {stream_type} ({direction})");
    metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
        .with_label_values(&[site, stream_type, direction])
        .inc();
}

fn count_compared(site: Site, strategies: BTreeSet<&'static str>) {
    for strategy in strategies {
        metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL
            .with_label_values(&[site, strategy])
            .inc();
    }
}

fn shadow_skipped(site: Site, reason: &str) {
    metrics::AUTHZ_LIST_SHADOW_SKIPPED_TOTAL
        .with_label_values(&[site, reason])
        .inc();
}

#[cfg(test)]
pub(crate) mod tests {
    use std::{collections::BTreeMap, fmt::Debug, process::Command, sync::Mutex};

    use tracing::{
        Event, Metadata, Subscriber,
        field::{Field, Visit},
        span::{Attributes, Id, Record},
    };

    use super::*;
    use crate::authz::{FakeStreamChecker, ObjectCheckArgs, TypedStream, within_budget};

    const ORG: &str = "list_org";

    #[derive(Default)]
    pub(crate) struct CapturedSpans(Mutex<Vec<(&'static str, CapturedFields)>>);

    impl CapturedSpans {
        pub(crate) fn fields(&self, name: &str) -> Option<BTreeMap<&'static str, String>> {
            self.0
                .lock()
                .unwrap()
                .iter()
                .find_map(|(span, fields)| (*span == name).then(|| fields.0.clone()))
        }
    }

    impl Subscriber for CapturedSpans {
        fn enabled(&self, _: &Metadata<'_>) -> bool {
            true
        }

        fn new_span(&self, attrs: &Attributes<'_>) -> Id {
            let mut spans = self.0.lock().unwrap();
            let mut fields = CapturedFields::default();
            attrs.record(&mut fields);
            spans.push((attrs.metadata().name(), fields));
            Id::from_u64(spans.len() as u64)
        }

        fn record(&self, id: &Id, values: &Record<'_>) {
            values.record(&mut self.0.lock().unwrap()[id.into_u64() as usize - 1].1);
        }
        fn record_follows_from(&self, _: &Id, _: &Id) {}
        fn event(&self, _: &Event<'_>) {}
        fn enter(&self, _: &Id) {}
        fn exit(&self, _: &Id) {}
    }

    #[derive(Default)]
    struct CapturedFields(BTreeMap<&'static str, String>);

    impl Visit for CapturedFields {
        fn record_debug(&mut self, field: &Field, value: &dyn Debug) {
            self.0.insert(field.name(), format!("{value:?}"));
        }

        fn record_str(&mut self, field: &Field, value: &str) {
            self.0.insert(field.name(), value.to_string());
        }
    }

    #[test]
    fn authorize_objects_span_records_request_fields_and_strategy() {
        // Callsite interest is cached process-wide on first use.
        if std::env::var_os("O2_AUTHZ_SPAN_CHILD").is_none() {
            let output = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "authz::list::tests::authorize_objects_span_records_request_fields_and_strategy",
                    "--test-threads=1",
                    "--nocapture",
                ])
                .env("O2_AUTHZ_SPAN_CHILD", "1")
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "span test child exited with {}\n{}\n{}",
                output.status,
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let spans = Arc::new(CapturedSpans::default());
        let _subscriber = tracing::subscriber::set_default(spans.clone());
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let fake = FakeStreamChecker::default();
        let query = stream_read_query(
            "trace_authz",
            ORG,
            "trace-authz@example.com",
            &[StreamType::Logs],
        );
        let objects = [ObjectRef::stream(StreamType::Logs, "app")];
        runtime
            .block_on(authorize_objects(&fake, &query, &objects))
            .unwrap();
        let fields = spans.fields("authz.authorize_objects").unwrap();
        assert_eq!(
            fields,
            BTreeMap::from([
                ("site", "trace_authz".into()),
                ("permission", "GET".into()),
                ("objects", "1".into()),
                ("strategy", "list".into()),
            ])
        );
    }

    #[test]
    fn shadow_sampling_rejects_invalid_rates_and_honors_boundaries() {
        for rate in [f64::NAN, -0.1, 1.5, f64::INFINITY, f64::NEG_INFINITY, 0.0] {
            assert!(!sampled(rate), "rate {rate}");
        }
        assert!(sampled(1.0));
    }

    fn names(prefix: &str, n: usize) -> Vec<String> {
        (0..n).map(|i| format!("{prefix}{i}")).collect()
    }

    fn typed(stream_type: StreamType, names: &[String]) -> HashSet<(StreamType, String)> {
        names.iter().map(|n| (stream_type, n.clone())).collect()
    }

    fn grant(fake: &FakeStreamChecker, user: &str, stream_type: StreamType, name: &str) {
        fake.grant_read(
            user,
            &TypedStream {
                org_id: ORG.to_string(),
                stream_type,
                name: name.to_string(),
            },
        );
    }

    fn on(fake: &FakeStreamChecker, user: &str) {
        fake.set_list_mode(user, ListMode::On);
    }

    /// 4,000 streams: logs 400, metrics 3,500, traces 100; every tenth one granted.
    fn big_inventory(fake: &FakeStreamChecker, user: &str) -> HashSet<(StreamType, String)> {
        let mut all = HashSet::new();
        for (stream_type, n) in [
            (StreamType::Logs, 400),
            (StreamType::Metrics, 3500),
            (StreamType::Traces, 100),
        ] {
            let list = names(&format!("{stream_type}_"), n);
            for name in list.iter().step_by(10) {
                grant(fake, user, stream_type, name);
            }
            all.extend(typed(stream_type, &list));
        }
        all
    }

    fn granted_tenth(all: &HashSet<(StreamType, String)>) -> HashSet<(StreamType, String)> {
        all.iter()
            .filter(|(_, n)| {
                n.rsplit('_')
                    .next()
                    .and_then(|i| i.parse::<usize>().ok())
                    .is_some_and(|i| i % 10 == 0)
            })
            .cloned()
            .collect()
    }

    #[tokio::test]
    async fn a_plain_user_with_stream_grants_costs_one_probe_six_wide_grants_and_three_lists() {
        let fake = FakeStreamChecker::default();
        let user = "u7-plain@example.com";
        on(&fake, user);
        let all = big_inventory(&fake, user);
        let kept = readable_streams(
            &fake,
            SITE_SERVICE_STREAMS,
            user,
            ORG,
            all.clone(),
            &Scope::every(),
        )
        .await
        .unwrap();
        assert_eq!(kept, Some(granted_tenth(&all)));
        let calls = fake.calls(user);
        assert_eq!(
            (
                calls.probe_c,
                calls.probe_b,
                calls.lists,
                calls.object_checks
            ),
            (1, 6, 3, 0)
        );
        assert!(calls.total() <= 10, "{calls:?}");
        assert_eq!(calls.streams, 0, "no per-stream Check");
    }

    #[tokio::test]
    async fn unsupported_shapes_send_only_the_original_object_checks() {
        let user = "c7-unsupported-shape@example.com";
        let types = [StreamType::Logs, StreamType::Metrics];
        let objects = [
            ObjectRef::stream(StreamType::Logs, "allowed"),
            ObjectRef::stream(StreamType::Logs, "denied"),
            ObjectRef::stream(StreamType::Metrics, "allowed"),
            ObjectRef::stream(StreamType::Metrics, "denied"),
        ];
        for args in [
            ObjectCheckArgs {
                permission: "LIST".into(),
                use_all_org: true,
                parent_id: String::new(),
                use_self_context: false,
                use_self_parent: true,
                identity: Identity::StoredEmail,
            },
            ObjectCheckArgs {
                permission: "PUT".into(),
                use_all_org: false,
                parent_id: "folder1".into(),
                use_self_context: true,
                use_self_parent: false,
                identity: Identity::GivenId,
            },
        ] {
            let fake = FakeStreamChecker::default();
            on(&fake, user);
            for stream_type in types {
                grant(&fake, user, stream_type, "allowed");
            }
            let query = ObjectsQuery {
                permission: &args.permission,
                use_all_org: args.use_all_org,
                parent_id: &args.parent_id,
                use_self_context: args.use_self_context,
                use_self_parent: args.use_self_parent,
                identity: args.identity,
                ..stream_read_query("c7_unsupported_shape", ORG, user, &types)
            };
            let actual = authorize_objects(&fake, &query, &objects).await.unwrap();
            let calls = fake.calls(user);
            assert_eq!(
                (
                    calls.types_access,
                    calls.probe_c,
                    calls.probe_b,
                    calls.lists,
                    calls.role_checks,
                    calls.object_checks,
                ),
                (0, 0, 0, 0, 0, objects.len()),
                "{query:?}"
            );
            assert_eq!(calls.object_check_args, vec![args.clone(); objects.len()]);

            let mut legacy = HashSet::new();
            for object in &objects {
                let stream = TypedStream {
                    org_id: ORG.to_string(),
                    stream_type: object.stream_type,
                    name: object.id.to_string(),
                };
                if fake.can_read_stream(user, &stream).await {
                    legacy.insert((stream.stream_type, stream.name));
                }
            }
            assert_eq!(actual, Readable::Only(legacy), "{query:?}");
        }
    }

    #[tokio::test]
    async fn self_context_with_an_empty_parent_still_uses_a_list() {
        let fake = FakeStreamChecker::default();
        let user = "c7-empty-parent@example.com";
        on(&fake, user);
        grant(&fake, user, StreamType::Logs, "allowed");
        let query = ObjectsQuery {
            use_self_context: true,
            ..stream_read_query("c7_empty_parent", ORG, user, &[StreamType::Logs])
        };
        let objects = [ObjectRef::stream(StreamType::Logs, "allowed")];
        let actual = authorize_objects(&fake, &query, &objects).await.unwrap();

        assert_eq!(
            actual,
            Readable::Only(HashSet::from([(StreamType::Logs, "allowed".into())]))
        );
        let calls = fake.calls(user);
        assert_eq!(
            (calls.types_access, calls.lists, calls.object_checks),
            (1, 1, 0)
        );
    }

    #[tokio::test]
    async fn on_at_five_objects_sends_the_same_calls_as_off() {
        let fake = FakeStreamChecker::default();
        let off_user = "cutoff-off@example.com";
        let on_user = "cutoff-on@example.com";
        on(&fake, on_user);
        fake.set_small_request_objects(on_user, SMALL_REQUEST_OBJECTS);
        let names = names("s", 5);
        let objects: Vec<_> = names
            .iter()
            .map(|name| ObjectRef::stream(StreamType::Logs, name))
            .collect();
        for user in [off_user, on_user] {
            grant(&fake, user, StreamType::Logs, "s0");
            let query = stream_read_query("cutoff_objects", ORG, user, &[StreamType::Logs]);
            let allowed = objects_in_mode(&fake, &query, &objects, &Scope::every(), |objects| {
                let streams = objects
                    .into_iter()
                    .map(|object| (object.stream_type, object.id.to_string()))
                    .collect();
                legacy_readable_streams(&fake, user, ORG, streams)
            })
            .await
            .unwrap();
            assert_eq!(allowed, Some(typed(StreamType::Logs, &names[..1])));
        }
        assert_eq!(fake.calls(off_user).streams, 5);
        assert_eq!(fake.calls(on_user), fake.calls(off_user));
    }

    #[tokio::test]
    async fn on_lists_above_the_cutoff_or_with_the_default_disabled() {
        for (count, cutoff_enabled) in [(6, true), (5, false)] {
            let fake = FakeStreamChecker::default();
            let user = "cutoff-list@example.com";
            on(&fake, user);
            if cutoff_enabled {
                fake.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
            } else {
                assert_eq!(fake.list_settings(user).small_request_objects, 0);
            }
            grant(&fake, user, StreamType::Logs, "s0");
            let names = names("s", count);
            let allowed = readable_streams(
                &fake,
                "cutoff_list",
                user,
                ORG,
                typed(StreamType::Logs, &names),
                &Scope::every(),
            )
            .await
            .unwrap();

            assert_eq!(allowed, Some(typed(StreamType::Logs, &names[..1])));
            let calls = fake.calls(user);
            assert_eq!((calls.lists, calls.streams, calls.object_checks), (1, 0, 0));
        }
    }

    #[tokio::test]
    async fn readable_streams_ignores_timeouts_on_unrequested_streams() {
        let timed_out = "x".repeat(MAX_COVERED_ID_LEN + 1);
        let scope = Scope::requested([(StreamType::Logs, "allowed".to_string())]);
        assert_scoped_stream_answer_skips_timeout(&scope, &timed_out).await;
    }

    #[tokio::test]
    async fn readable_streams_ignores_timeouts_on_filtered_streams() {
        let timed_out = "x".repeat(MAX_COVERED_ID_LEN + 1);
        let scope = Scope::every().filtered([(StreamType::Logs, timed_out.clone())]);
        assert_scoped_stream_answer_skips_timeout(&scope, &timed_out).await;
    }

    async fn assert_scoped_stream_answer_skips_timeout(scope: &Scope, timed_out: &str) {
        let site = "scoped_stream_answer";
        let on_user = "scoped-stream-on@example.com";
        let off_user = "scoped-stream-off@example.com";
        let streams = typed(StreamType::Logs, &["allowed".into(), timed_out.into()]);
        for (cutoff, expected_calls) in [(1, (1, 0, 0)), (0, (0, 1, 0))] {
            let fake = FakeStreamChecker::default();
            on(&fake, on_user);
            fake.set_small_request_objects(on_user, cutoff);
            for user in [on_user, off_user] {
                grant(&fake, user, StreamType::Logs, "allowed");
                grant(&fake, user, StreamType::Logs, timed_out);
                fake.fail_stream_read_once(user, timed_out);
            }
            fake.fail_object_check_of(on_user, timed_out, UnavailableReason::Timeout);

            let off = readable_streams(&fake, site, off_user, ORG, streams.clone(), scope)
                .await
                .unwrap();
            assert_eq!(off, Some(typed(StreamType::Logs, &["allowed".into()])));
            assert_eq!(fake.calls(off_user).streams, 1);
            assert_eq!(
                readable_streams(&fake, site, on_user, ORG, streams.clone(), scope).await,
                Ok(off),
                "cutoff {cutoff}"
            );
            let calls = fake.calls(on_user);
            assert_eq!(
                (calls.streams, calls.lists, calls.object_checks),
                expected_calls,
                "cutoff {cutoff}"
            );
        }
    }

    #[tokio::test]
    async fn readable_streams_reports_a_requested_streams_timeout() {
        let user = "scoped-stream-timeout@example.com";
        let timed_out = "x".repeat(MAX_COVERED_ID_LEN + 1);
        let scope = Scope::requested([(StreamType::Logs, timed_out.clone())]);
        let streams = typed(StreamType::Logs, &["outside".into(), timed_out.clone()]);
        for (cutoff, expected_calls) in [(1, (1, 0, 0)), (0, (0, 1, 1))] {
            let fake = FakeStreamChecker::default();
            on(&fake, user);
            fake.set_small_request_objects(user, cutoff);
            grant(&fake, user, StreamType::Logs, &timed_out);
            fake.fail_stream_read_once(user, &timed_out);
            fake.fail_object_check_of(user, &timed_out, UnavailableReason::Timeout);

            let result = readable_streams(
                &fake,
                "scoped_stream_timeout",
                user,
                ORG,
                streams.clone(),
                &scope,
            )
            .await;
            assert_eq!(
                result,
                Err(UnavailableReason::Timeout.into()),
                "cutoff {cutoff}"
            );
            let calls = fake.calls(user);
            assert_eq!(
                (calls.streams, calls.lists, calls.object_checks),
                expected_calls,
                "cutoff {cutoff}"
            );
        }
    }

    #[tokio::test]
    async fn on_at_the_cutoff_answers_an_error_denial_with_its_reason_and_no_second_pass() {
        let fake = FakeStreamChecker::default();
        let user = "small-stream-error@example.com";
        let off_user = "small-stream-error-off@example.com";
        on(&fake, user);
        fake.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        fake.set_list_mode(off_user, ListMode::Off);
        for user in [user, off_user] {
            grant(&fake, user, StreamType::Logs, "allowed");
            fake.fail_stream_read_once(user, "failed");
        }
        let streams = StreamSet::from([
            (StreamType::Logs, "allowed".into()),
            (StreamType::Logs, "failed".into()),
        ]);

        let error = readable_streams(
            &fake,
            "small_stream_error",
            user,
            ORG,
            streams.clone(),
            &Scope::every(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.reason, UnavailableReason::Timeout);
        readable_streams(
            &fake,
            "small_stream_error",
            off_user,
            ORG,
            streams,
            &Scope::every(),
        )
        .await
        .unwrap();
        let calls = fake.calls(user);
        assert_eq!((calls.types_access, calls.lists), (0, 0));
        assert_eq!(calls, fake.calls(off_user));
    }

    #[tokio::test]
    async fn on_at_the_cutoff_reports_the_failed_checks_reason() {
        let fake = FakeStreamChecker::default();
        let user = "small-stream-timeout@example.com";
        let off_user = "small-stream-timeout-off@example.com";
        on(&fake, user);
        fake.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        fake.set_list_mode(off_user, ListMode::Off);
        for user in [user, off_user] {
            fake.set_role(ORG, user, "user");
            fake.fail_every_call(user, UnavailableReason::Timeout);
        }
        let streams = typed(StreamType::Logs, &["a".into(), "b".into()]);

        let error = readable_streams(
            &fake,
            "small_stream_timeout",
            user,
            ORG,
            streams.clone(),
            &Scope::every(),
        )
        .await
        .unwrap_err();
        assert_eq!(error.reason, UnavailableReason::Timeout);
        readable_streams(
            &fake,
            "small_stream_timeout",
            off_user,
            ORG,
            streams,
            &Scope::every(),
        )
        .await
        .unwrap();
        let calls = fake.calls(user);
        assert_eq!(calls.types_access, 0);
        assert_eq!(calls, fake.calls(off_user));
    }

    #[tokio::test]
    async fn on_at_the_cutoff_serves_legacy_after_a_recovered_probe_error() {
        let fake = FakeStreamChecker::default();
        let user = "small-recovered-probe@example.com";
        on(&fake, user);
        fake.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        grant(&fake, user, StreamType::Logs, "a");
        grant(&fake, user, StreamType::Logs, "b");
        fake.fail_org_wide_once(user);
        let streams = typed(StreamType::Logs, &["a".into(), "b".into()]);

        let readable = readable_streams(
            &fake,
            "small_recovered_probe",
            user,
            ORG,
            streams.clone(),
            &Scope::every(),
        )
        .await
        .unwrap();

        assert_eq!(readable, Some(streams));
        let calls = fake.calls(user);
        assert_eq!(calls.org_wide, vec![vec![StreamType::Logs]]);
        assert_eq!((calls.types_access, calls.lists, calls.streams), (0, 0, 2));
    }

    #[tokio::test]
    async fn on_at_the_cutoff_serves_legacy_when_an_error_denial_hides_nothing() {
        let user = "small-recovered-prelude@example.com";
        let types = [StreamType::Logs];
        let objects = [
            ObjectRef::stream(StreamType::Logs, "a"),
            ObjectRef::stream(StreamType::Logs, "b"),
        ];
        let all = typed(StreamType::Logs, &["a".into(), "b".into()]);
        let partial = typed(StreamType::Logs, &["a".into()]);
        let query = db_monitoring_query(ORG, user, &types);
        let prelude = query.prelude.as_ref().unwrap();

        for (legacy, expected) in [
            (all.clone(), Ok(Some(all))),
            (partial, Err(UnavailableReason::Timeout.into())),
        ] {
            let fake = FakeStreamChecker::default();
            on(&fake, user);
            fake.set_small_request_objects(user, objects.len());
            grant(&fake, user, StreamType::Logs, "a");
            grant(&fake, user, StreamType::Logs, "b");
            fake.fail_org_wide_check_once(user, UnavailableReason::Timeout);

            let readable = objects_in_mode(&fake, &query, &objects, &Scope::every(), |_| async {
                assert!(!CheckerChecks(&fake).org_wide(ORG, user, prelude).await);
                Some(legacy)
            })
            .await;

            assert_eq!(readable, expected);
            let calls = fake.calls(user);
            assert_eq!((calls.types_access, calls.lists), (0, 0));
        }
    }

    #[tokio::test]
    async fn the_service_streams_request_stays_within_twelve_calls_with_its_route_checks() {
        let fake = FakeStreamChecker::default();
        let user = "f6-service-streams-budget@example.com";
        on(&fake, user);
        fake.set_role(ORG, user, "user");
        let mut all = StreamSet::new();
        for (stream_type, count) in [
            (StreamType::Logs, 400),
            (StreamType::Metrics, 2358),
            (StreamType::Traces, 100),
        ] {
            let list = names(&format!("{stream_type}_"), count);
            for name in list.iter().step_by(10) {
                grant(&fake, user, stream_type, name);
            }
            all.extend(typed(stream_type, &list));
        }
        assert_eq!(all.len(), 2858);
        let kept = within_budget(12, async {
            let query = stream_read_query(SITE_SERVICE_STREAMS, ORG, user, &[]);
            let route = ObjectRef::stream(StreamType::Logs, "logs_0");
            let endpoint = ObjectRef::stream(StreamType::Metrics, "metrics_0");
            assert!(fake.check_object(user, ORG, &query, &route).await.unwrap());
            assert!(
                fake.check_object(user, ORG, &query, &endpoint)
                    .await
                    .unwrap()
            );
            readable_streams(
                &fake,
                SITE_SERVICE_STREAMS,
                user,
                ORG,
                all.clone(),
                &Scope::every(),
            )
            .await
            .unwrap()
        })
        .await;
        assert_eq!(kept, Some(granted_tenth(&all)));
        let calls = fake.calls(user);
        assert_eq!(
            (
                calls.probe_c,
                calls.probe_b,
                calls.lists,
                calls.object_checks
            ),
            (1, 6, 3, 2)
        );
        assert!(calls.total() <= 12, "{calls:?}");
        assert_eq!(calls.streams, 0, "no per-stream Check");
    }

    #[tokio::test]
    async fn a_probe_error_fails_the_call_and_sends_nothing_more() {
        let fake = FakeStreamChecker::default();
        let user = "u7-probe-err@example.com";
        on(&fake, user);
        let all = big_inventory(&fake, user);
        fake.fail_types_access_once(user, UnavailableReason::Server(500));
        let err = readable_streams(&fake, SITE_SERVICE_STREAMS, user, ORG, all, &Scope::every())
            .await
            .unwrap_err();
        assert_eq!(err.reason, UnavailableReason::Server(500));
        let calls = fake.calls(user);
        assert_eq!((calls.probe_c, calls.lists, calls.object_checks), (1, 0, 0));
    }

    #[tokio::test]
    async fn a_list_error_fails_the_call() {
        let fake = FakeStreamChecker::default();
        let user = "u7-list-err@example.com";
        on(&fake, user);
        let all = big_inventory(&fake, user);
        fake.fail_list_once(user, UnavailableReason::Timeout);
        let err = readable_streams(&fake, SITE_SERVICE_STREAMS, user, ORG, all, &Scope::every())
            .await
            .unwrap_err();
        assert_eq!(err.reason, UnavailableReason::Timeout);
        assert_eq!(fake.calls(user).object_checks, 0);
    }

    #[tokio::test]
    async fn a_fallback_error_ends_the_call_and_starts_no_later_check() {
        let fake = FakeStreamChecker::default();
        let user = "u7-fallback-err@example.com";
        on(&fake, user);
        fake.set_list_policy(user, ListPolicy::Disabled);
        fake.set_fallback_concurrency(user, 1);
        let list = names("s", 300);
        for name in &list {
            grant(&fake, user, StreamType::Logs, name);
        }
        fake.fail_object_check_once(user, UnavailableReason::Server(503));
        let site = "u7_fallback_error";
        let checks = metrics::AUTHZ_FALLBACK_CHECKS_TOTAL.with_label_values(&[site]);
        let before = checks.get();
        let err = readable_streams(
            &fake,
            site,
            user,
            ORG,
            typed(StreamType::Logs, &list),
            &Scope::every(),
        )
        .await
        .unwrap_err();
        assert_eq!(err.reason, UnavailableReason::Server(503));
        let started = fake.calls(user).object_checks;
        assert_eq!(started, 1, "no Check after the error");
        assert_eq!(checks.get() - before, started as u64);
    }

    #[tokio::test]
    async fn concrete_streams_named_like_org_wide_markers_are_returned_when_granted() {
        let fake = FakeStreamChecker::default();
        let user = "u7-all-names@example.com";
        on(&fake, user);
        let own = format!("_all_{ORG}");
        for name in [own.as_str(), "_all_foo"] {
            grant(&fake, user, StreamType::Logs, name);
        }
        let all = typed(
            StreamType::Logs,
            &[own.clone(), "_all_foo".to_string(), "other".to_string()],
        );
        let kept = readable_streams(&fake, SITE_SERVICE_STREAMS, user, ORG, all, &Scope::every())
            .await
            .unwrap();
        let expected = typed(StreamType::Logs, &[own, "_all_foo".to_string()]);
        assert_eq!(kept, Some(expected));
    }

    #[tokio::test]
    async fn an_uncovered_id_takes_exactly_one_check_under_every_type_answer() {
        let long = "a".repeat(300);
        let odd = [long.as_str(), "a/b", "caf\u{a0}e"];
        for (case, setup, slash_allowed) in [
            ("probe all", 0_u8, true),
            ("listed", 1, true),
            ("role branch denies", 2, false),
        ] {
            let fake = FakeStreamChecker::default();
            let user = format!("u7-uncovered-{setup}@example.com");
            let user = user.as_str();
            on(&fake, user);
            match setup {
                0 => fake.grant_read_all(user, ORG, StreamType::Logs),
                1 => grant(&fake, user, StreamType::Logs, "plain"),
                _ => fake.set_role_answer(ORG, user, false),
            }
            grant(&fake, user, StreamType::Logs, "a/b");
            let mut objects: Vec<ObjectRef<'_>> = odd
                .iter()
                .map(|name| ObjectRef {
                    id: name,
                    stream_type: StreamType::Logs,
                    ofga_id: Cow::Borrowed(name),
                })
                .collect();
            objects.push(ObjectRef::stream(StreamType::Logs, "plain"));
            let query = stream_read_query(SITE_SERVICE_STREAMS, ORG, user, &[StreamType::Logs]);
            let readable = authorize_objects(&fake, &query, &objects).await.unwrap();
            assert_eq!(fake.calls(user).object_checks, odd.len(), "{case}");
            let Readable::Only(set) = readable else {
                panic!("{case}: no bypass expected");
            };
            let slash = (StreamType::Logs, "a/b".to_string());
            assert_eq!(set.contains(&slash), slash_allowed, "{case}");
            assert!(!set.contains(&(StreamType::Logs, long.clone())), "{case}");
        }
    }

    #[test]
    fn probe_covers_takes_the_id_as_composed() {
        assert!(!probe_covers("foo:bar"));
        assert!(probe_covers("foo.bar"));
        assert!(probe_covers(&"a".repeat(200)));
        assert!(!probe_covers(&"a".repeat(201)));
        assert!(!probe_covers(""));
        assert!(!probe_covers("caf\u{a0}e"));
    }

    #[tokio::test]
    async fn decide_on_a_second_set_sends_no_type_level_call() {
        let fake = FakeStreamChecker::default();
        let user = "u7-decide@example.com";
        on(&fake, user);
        grant(&fake, user, StreamType::Traces, "t1");
        let types = [StreamType::Traces, StreamType::Logs];
        let query = stream_read_query(SITE_SERVICE_IDENTITY, ORG, user, &types);
        let answers = type_answers(&fake, &query, &types).await.unwrap();
        let before = fake.calls(user);
        let objects = [
            ObjectRef::stream(StreamType::Traces, "t1"),
            ObjectRef::stream(StreamType::Traces, "t2"),
        ];
        let second = answers.decide(&fake, query.site, &objects).await.unwrap();
        assert_eq!(fake.calls(user), before);
        let once = authorize_objects(&fake, &query, &objects).await.unwrap();
        assert_eq!(second, once);
    }

    #[tokio::test]
    async fn a_failed_fallback_check_is_held_for_the_rest_of_the_request() {
        let fake = FakeStreamChecker::default();
        let user = "u7-held-failure@example.com";
        on(&fake, user);
        fake.set_list_policy(user, ListPolicy::Disabled);
        let types = [StreamType::Logs];
        let query = stream_read_query(SITE_SERVICE_IDENTITY, ORG, user, &types);
        let answers = type_answers(&fake, &query, &types).await.unwrap();
        fake.fail_object_check_of(user, "down", UnavailableReason::Timeout);
        let down = ObjectRef::stream(StreamType::Logs, "down");
        let error = Some(Outcome::Error(UnavailableReason::Timeout));
        for _ in 0..3 {
            let row = answers
                .all_allowed(&fake, query.site, std::slice::from_ref(&down), Calls::Send)
                .await;
            assert_eq!(row.outcome, error);
        }
        let other = ObjectRef::stream(StreamType::Logs, "other");
        let (_, denials) = answers
            .decide_outcomes(&fake, query.site, &[down.clone(), other])
            .await;
        assert_eq!(denials.first(), Some(UnavailableReason::Timeout));
        assert_eq!(fake.calls(user).object_checks, 1, "one timeout per object");
    }

    #[tokio::test]
    async fn only_an_org_admin_bypass_skips_the_role_branch() {
        let fake = FakeStreamChecker::default();
        let user = "u7b-admin@example.com";
        on(&fake, user);
        fake.grant_admin(ORG, user);
        fake.set_role(ORG, user, "admin");
        let objects = [ObjectRef::stream(StreamType::Logs, "app")];
        let mut query = stream_read_query(SITE_SERVICE_STREAMS, ORG, user, &[StreamType::Logs]);
        assert_eq!(
            authorize_objects(&fake, &query, &objects).await.unwrap(),
            Readable::All
        );
        assert_eq!(fake.calls(user).total(), 0);
        query.bypass = Bypass::RbacOffOrRoot;
        let readable = authorize_objects(&fake, &query, &objects).await.unwrap();
        assert_eq!(fake.calls(user).role_checks, 1);
        assert_eq!(
            readable,
            Readable::Only(typed(StreamType::Logs, &["app".to_string()]))
        );
    }

    #[tokio::test]
    async fn role_and_probe_answers_carry_their_own_strategy() {
        const CHILD: &str = "O2_AUTHZ_ROLE_STRATEGY_METRICS_CHILD";
        // Other tests write to these process-wide counters.
        if std::env::var_os(CHILD).is_none() {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "authz::list::tests::role_and_probe_answers_carry_their_own_strategy",
                ])
                .env(CHILD, "1")
                .output()
                .unwrap();
            let stdout = String::from_utf8_lossy(&output.stdout);
            assert!(
                output.status.success() && stdout.contains("1 passed"),
                "{stdout}\n{}",
                String::from_utf8_lossy(&output.stderr)
            );
            return;
        }

        let fake = FakeStreamChecker::default();
        let role_allowed = "role-allowed@example.com";
        let role_denied = "role-denied@example.com";
        let probe = "probe-all@example.com";
        fake.set_role(ORG, role_allowed, "editor");
        fake.set_role_answer(ORG, role_denied, false);
        fake.grant_read_every_stream(probe, ORG);

        let site = SITE_SERVICE_STREAMS;
        let role_count = metrics::AUTHZ_STRATEGY_TOTAL.with_label_values(&[site, "role"]);
        let probe_count = metrics::AUTHZ_STRATEGY_TOTAL.with_label_values(&[site, "probe_all"]);
        let types = [StreamType::Logs];
        let objects = [ObjectRef::stream(StreamType::Logs, "app")];
        for (user, allowed, expected_delta) in [
            (role_allowed, true, (1, 0)),
            (probe, true, (0, 1)),
            (role_denied, false, (1, 0)),
        ] {
            on(&fake, user);
            let query = stream_read_query(site, ORG, user, &types);
            let before = (role_count.get(), probe_count.get());
            let actual = authorize_objects(&fake, &query, &objects).await.unwrap();
            let expected = if allowed {
                HashSet::from([(StreamType::Logs, "app".to_string())])
            } else {
                HashSet::new()
            };
            assert_eq!(actual, Readable::Only(expected), "{user}");
            assert_eq!(
                (role_count.get() - before.0, probe_count.get() - before.1),
                expected_delta,
                "{user}"
            );
        }
    }

    #[tokio::test]
    async fn a_true_prelude_answers_every_id_and_a_false_one_continues_to_the_probe() {
        let fake = FakeStreamChecker::default();
        let user = "u7b-prelude@example.com";
        on(&fake, user);
        let objects = [
            ObjectRef::stream(StreamType::Traces, "t1"),
            ObjectRef {
                id: "a:b",
                stream_type: StreamType::Traces,
                ofga_id: Cow::Borrowed("a:b"),
            },
        ];
        let prelude = OrgWideCheck {
            resource: "traces",
            permission: "GET",
            use_all_org: true,
            use_self_context: false,
            use_self_parent: false,
        };
        let mut query = stream_read_query(SITE_SERVICE_STREAMS, ORG, user, &[StreamType::Traces]);
        query.bypass = Bypass::RbacOffOrRoot;
        query.prelude = Some(prelude);
        let denied = authorize_objects(&fake, &query, &objects).await.unwrap();
        assert_eq!(denied, Readable::Only(HashSet::new()));
        assert_eq!(fake.calls(user).probe_c, 1, "C after a false prelude");
        fake.grant_org_wide_check(user, ORG, "traces");
        let all = authorize_objects(&fake, &query, &objects).await.unwrap();
        assert_eq!(all, Readable::All);
        assert_eq!(fake.calls(user).probe_c, 1, "nothing after a true prelude");
    }

    #[tokio::test]
    async fn a_raw_id_with_a_colon_takes_its_own_check_and_a_role_answers_its_own() {
        let custom = "u7e-custom@example.com";
        let editor = "u7e-editor@example.com";
        let fake = FakeStreamChecker::default();
        for user in [custom, editor] {
            on(&fake, user);
        }
        fake.grant_read_all(custom, ORG, StreamType::Logs);
        fake.set_role(ORG, editor, "editor");
        let raw = [ObjectRef {
            id: "foo:bar",
            stream_type: StreamType::Logs,
            ofga_id: Cow::Borrowed("foo:bar"),
        }];
        let sanitized = [ObjectRef::stream(StreamType::Logs, "foo:bar")];
        let query = |user| {
            let mut q = stream_read_query(SITE_SERVICE_STREAMS, ORG, user, &[StreamType::Logs]);
            q.bypass = Bypass::RbacOffOrRoot;
            q
        };
        let only = |set: &[&str]| {
            Readable::Only(
                set.iter()
                    .map(|n| (StreamType::Logs, n.to_string()))
                    .collect(),
            )
        };
        let q = query(custom);
        assert_eq!(authorize_objects(&fake, &q, &raw).await.unwrap(), only(&[]));
        assert_eq!(fake.calls(custom).object_checks, 1);
        assert_eq!(
            authorize_objects(&fake, &q, &sanitized).await.unwrap(),
            only(&["foo:bar"])
        );
        let q = query(editor);
        assert_eq!(
            authorize_objects(&fake, &q, &raw).await.unwrap(),
            only(&["foo:bar"])
        );
    }

    #[tokio::test]
    async fn fallback_distinguishes_raw_and_sanitized_ids() {
        let fake = FakeStreamChecker::default();
        let user = "c8-fallback-id@example.com";
        let name = format!("{}:suffix", "x".repeat(201));
        grant(&fake, user, StreamType::Logs, &name);
        let types = [StreamType::Logs];
        let query = stream_read_query(SITE_SERVICE_STREAMS, ORG, user, &types);
        let answers = type_answers(&fake, &query, &types).await.unwrap();
        let objects = [
            ObjectRef {
                id: &name,
                stream_type: StreamType::Logs,
                ofga_id: Cow::Borrowed(&name),
            },
            ObjectRef::stream(StreamType::Logs, &name),
        ];
        assert_eq!(
            answers.decide(&fake, query.site, &objects).await.unwrap(),
            Readable::Only(HashSet::from([(StreamType::Logs, name.clone())]))
        );
        assert_eq!(
            answers
                .clone()
                .decide(&fake, query.site, &objects[..1])
                .await
                .unwrap(),
            Readable::Only(HashSet::new())
        );
        assert_eq!(fake.calls(user).object_checks, 2);
    }

    #[test]
    fn stream_read_sites_send_the_stored_email_like_their_helpers() {
        let query = stream_read_query(SITE_SERVICE_STREAMS, ORG, "upper@example.com", &[]);
        assert_eq!(query.identity, Identity::StoredEmail);
    }

    #[tokio::test]
    async fn a_stored_email_query_asks_the_type_question_with_the_stored_email() {
        let fake = FakeStreamChecker::default();
        let user = "u7e-stored-email@example.com";
        on(&fake, user);
        let objects = [ObjectRef::stream(StreamType::Logs, "s1")];
        let mut query = stream_read_query(SITE_SERVICE_STREAMS, ORG, user, &[StreamType::Logs]);
        authorize_objects(&fake, &query, &objects).await.unwrap();
        assert_eq!(fake.calls(user).stored_email_types, 1);

        query.identity = Identity::GivenId;
        authorize_objects(&fake, &query, &objects).await.unwrap();
        assert_eq!(fake.calls(user).stored_email_types, 1);
    }

    #[tokio::test]
    async fn an_undeclared_deadline_checks_every_stream_sixteen_at_a_time() {
        let fake = FakeStreamChecker::default();
        let user = "u7f-undeclared@example.com";
        on(&fake, user);
        fake.set_list_policy(user, ListPolicy::Disabled);
        let list = names("s", 2858);
        for name in list.iter().take(315) {
            grant(&fake, user, StreamType::Metrics, name);
        }
        let kept = readable_streams(
            &fake,
            SITE_SERVICE_STREAMS,
            user,
            ORG,
            typed(StreamType::Metrics, &list),
            &Scope::every(),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(kept.len(), 315);
        let calls = fake.calls(user);
        assert_eq!((calls.object_checks, calls.lists), (2858, 0));
        assert_eq!(calls.max_in_flight, 16);
    }

    #[tokio::test]
    async fn an_incomplete_list_falls_back_to_checks_for_that_type_only() {
        let fake = FakeStreamChecker::default();
        let user = "u7f-incomplete@example.com";
        on(&fake, user);
        let metrics = names("m", 200);
        for name in metrics.iter().take(15) {
            grant(&fake, user, StreamType::Metrics, name);
        }
        grant(&fake, user, StreamType::Logs, "l1");
        let mut all = typed(StreamType::Metrics, &metrics);
        all.extend(typed(StreamType::Logs, &names("l", 3)));
        fake.fail_list_incomplete_once(user, StreamType::Metrics);
        let before = metrics::AUTHZ_STRATEGY_TOTAL
            .with_label_values(&["u7f_incomplete", "list_incomplete"])
            .get();
        let kept = readable_streams(&fake, "u7f_incomplete", user, ORG, all, &Scope::every())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(kept.len(), 16);
        assert_eq!(fake.calls(user).object_checks, 200, "metrics only");
        let after = metrics::AUTHZ_STRATEGY_TOTAL
            .with_label_values(&["u7f_incomplete", "list_incomplete"])
            .get();
        assert_eq!(after - before, 1);
    }

    #[tokio::test]
    async fn the_offline_rule_gives_the_answers_of_the_legacy_path() {
        let streams = typed(StreamType::Logs, &["a".to_string(), "b".to_string()]);
        for (user, role, offline, expect) in [
            ("u7g-editor@example.com", "editor", true, Ok(2)),
            (
                "u7g-user@example.com",
                "user",
                true,
                Err(UnavailableReason::Transport),
            ),
            (
                "u7g-custom@example.com",
                "auditor",
                true,
                Err(UnavailableReason::Transport),
            ),
            (
                "u7g-editor-no-list@example.com",
                "editor",
                false,
                Err(UnavailableReason::Transport),
            ),
        ] {
            for cutoff in [0, SMALL_REQUEST_OBJECTS] {
                let fake = FakeStreamChecker::default();
                fake.set_role(ORG, user, role);
                if !offline {
                    fake.set_offline_roles(user, &[]);
                }
                fake.fail_every_call(user, UnavailableReason::Transport);
                let legacy = legacy_readable_streams(&fake, user, ORG, streams.clone()).await;
                on(&fake, user);
                fake.set_small_request_objects(user, cutoff);
                let new = readable_streams(
                    &fake,
                    SITE_SERVICE_STREAMS,
                    user,
                    ORG,
                    streams.clone(),
                    &Scope::every(),
                )
                .await
                .map_err(|e| e.reason);
                match new {
                    Ok(kept) => {
                        let count = kept.as_ref().map_or(0, StreamSet::len);
                        assert_eq!(Ok(count), expect, "{user}, cutoff {cutoff}");
                        assert_eq!(kept, legacy, "{user}, cutoff {cutoff}");
                        assert_eq!(
                            fake.calls(user).types_access,
                            if cutoff == 0 { 1 } else { 0 },
                            "{user}, cutoff {cutoff}"
                        );
                    }
                    Err(reason) => assert_eq!(Err(reason), expect, "{user}, cutoff {cutoff}"),
                }
            }
        }
    }

    #[tokio::test]
    async fn a_transport_outage_cannot_allow_an_admin_check_that_requires_a_grant() {
        let fake = FakeStreamChecker::default();
        let user = ORG;
        fake.set_role(ORG, user, "admin");
        grant(&fake, user, StreamType::Logs, "a");
        let streams = typed(StreamType::Logs, &["a".to_string()]);
        fake.fail_every_call(user, UnavailableReason::Transport);
        assert_eq!(
            legacy_readable_streams(&fake, user, ORG, streams.clone()).await,
            Some(StreamSet::new())
        );
        on(&fake, user);
        let err = readable_streams(
            &fake,
            SITE_SERVICE_STREAMS,
            user,
            ORG,
            streams,
            &Scope::every(),
        )
        .await
        .unwrap_err();
        assert_eq!(err.reason, UnavailableReason::Transport);
        assert_eq!(fake.calls(user).object_checks, 1);
    }

    #[tokio::test]
    async fn a_timeout_is_unavailable_for_every_role() {
        for (user, role) in [
            ("u7g-timeout-editor@example.com", "editor"),
            ("u7g-timeout-user@example.com", "user"),
        ] {
            let fake = FakeStreamChecker::default();
            fake.set_role(ORG, user, role);
            fake.fail_every_call(user, UnavailableReason::Timeout);
            on(&fake, user);
            let err = readable_streams(
                &fake,
                SITE_SERVICE_STREAMS,
                user,
                ORG,
                typed(StreamType::Logs, &["a".to_string()]),
                &Scope::every(),
            )
            .await
            .unwrap_err();
            assert_eq!(err.reason, UnavailableReason::Timeout, "{role}");
        }
    }

    #[tokio::test]
    async fn off_mode_returns_the_legacy_answers_including_the_probe_fallback_and_dropped_rows() {
        let fake = FakeStreamChecker::default();
        let user = "u11-off@example.com";
        fake.grant_read_all(user, ORG, StreamType::Logs);
        grant(&fake, user, StreamType::Logs, "b");
        fake.fail_org_wide_once(user);
        fake.fail_stream_read_once(user, "b");
        let streams = typed(StreamType::Logs, &["a".to_string(), "b".to_string()]);
        let kept = readable_streams(
            &fake,
            SITE_SERVICE_STREAMS,
            user,
            ORG,
            streams,
            &Scope::every(),
        )
        .await
        .unwrap();
        assert_eq!(
            kept,
            Some(typed(StreamType::Logs, &["a".to_string()])),
            "the failed probe falls back to stream Checks; the failed Check drops b"
        );
        let calls = fake.calls(user);
        assert_eq!((calls.streams, calls.org_wide.len()), (2, 1));
        assert_eq!((calls.types_access, calls.object_checks), (0, 0));
    }

    #[test]
    fn compared_strategies_only_count_answers_used_by_the_objects() {
        let empty = TypeAccessKind::Listed(HashSet::new());
        assert_eq!(empty.strategy(), "list");
        let answers = TypeAnswers {
            query: OwnedQuery::new(&stream_read_query("compared_strategies", ORG, "user", &[])),
            answer: Answer::PerType(HashMap::from([
                (
                    StreamType::Logs,
                    TypeAccessKind::Listed(HashSet::from(["a".into()])),
                ),
                (StreamType::Metrics, empty),
                (StreamType::Traces, TypeAccessKind::All),
                (StreamType::Profiles, TypeAccessKind::Role(false)),
            ])),
            fallback_concurrency: 1,
            fallback_checks: Default::default(),
            shadow_deadline: None,
            later: None,
        };
        let long_name = "x".repeat(300);
        let uncovered = ObjectRef::stream(StreamType::Logs, &long_name);
        assert!(
            answers
                .decided_strategies(std::slice::from_ref(&uncovered))
                .is_empty()
        );
        assert_eq!(
            answers.decided_strategies(&[ObjectRef::stream(StreamType::Logs, "a"), uncovered]),
            BTreeSet::from(["list"])
        );
        assert_eq!(
            answers.decided_strategies(&[ObjectRef::stream(StreamType::Metrics, "m1")]),
            BTreeSet::from(["list"])
        );
        assert_eq!(
            answers.decided_strategies(&[ObjectRef::stream(StreamType::Profiles, "p1")]),
            BTreeSet::from(["role"])
        );
    }

    #[tokio::test]
    async fn off_readable_streams_reuses_the_wanted_names() {
        let fake = FakeStreamChecker::default();
        let user = "off-owned-stream@example.com";
        let name = "allowed".to_string();
        grant(&fake, user, StreamType::Logs, &name);
        let input = name.as_ptr() as usize;
        let streams = StreamSet::from([(StreamType::Logs, name)]);
        let allowed = readable_streams(
            &fake,
            SITE_SERVICE_STREAMS,
            user,
            ORG,
            streams,
            &Scope::every(),
        )
        .await
        .unwrap()
        .unwrap();
        let (_, name) = allowed.into_iter().next().unwrap();
        assert_eq!(name.as_ptr() as usize, input);
        assert_eq!(fake.calls(user).total(), 0);
    }

    #[tokio::test]
    async fn shadow_objects_compares_a_disagreement_and_serves_legacy() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let user = "shadow-disagreement@example.com";
        let site = SITE_AUTOOBSERVE_STREAMS;
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        fake.list_extra_once(user, StreamType::Logs, "new_only");
        let mismatch = metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL.with_label_values(&[
            site,
            "logs",
            "new_allows_more",
        ]);
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL.with_label_values(&[site, "list"]);
        let before = (mismatch.get(), compared.get());
        let query = stream_read_query(site, ORG, user, &[StreamType::Logs]);
        let objects = [ObjectRef::stream(StreamType::Logs, "new_only")];
        let allowed = objects_in_mode(&fake, &query, &objects, &Scope::every(), |_| async {
            Some(StreamSet::new())
        })
        .await
        .unwrap();
        assert_eq!(allowed, Some(StreamSet::new()));
        assert_eq!(
            (mismatch.get() - before.0, compared.get() - before.1),
            (1, 1)
        );
    }

    #[tokio::test]
    async fn shadow_credits_a_complete_empty_list() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let user = "c7-empty-list@example.com";
        let site = "c7_empty_list";
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        fake.set_list_policy(user, ListPolicy::Enabled);
        fake.set_small_request_objects(user, SMALL_REQUEST_OBJECTS);
        let strategy = metrics::AUTHZ_STRATEGY_TOTAL.with_label_values(&[site, "list"]);
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL.with_label_values(&[site, "list"]);
        let before = (strategy.get(), compared.get());
        let streams = HashSet::from([(StreamType::Logs, "denied".into())]);
        let kept = readable_streams(&fake, site, user, ORG, streams, &Scope::every())
            .await
            .unwrap();

        assert_eq!(kept, Some(HashSet::new()));
        let calls = fake.calls(user);
        assert_eq!((calls.lists, calls.object_checks), (1, 0));
        assert_eq!(
            (strategy.get() - before.0, compared.get() - before.1),
            (1, 1)
        );
    }

    #[tokio::test]
    async fn objects_in_shadow_does_not_credit_lists_for_raw_ids() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let user = "shadow-raw-id@example.com";
        let site = "shadow_raw_id";
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        fake.set_list_policy(user, ListPolicy::Enabled);
        grant(&fake, user, StreamType::Logs, "foo:bar");
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL.with_label_values(&[site, "list"]);
        let before = compared.get();
        let query = stream_read_query(site, ORG, user, &[StreamType::Logs]);
        let objects = [ObjectRef {
            id: "foo:bar",
            stream_type: StreamType::Logs,
            ofga_id: Cow::Borrowed("foo:bar"),
        }];

        let kept = objects_in_mode(&fake, &query, &objects, &Scope::every(), |_| async {
            Some(StreamSet::new())
        })
        .await
        .unwrap();

        assert_eq!(kept, Some(StreamSet::new()));
        let calls = fake.calls(user);
        assert_eq!((calls.lists, calls.object_checks), (1, 1));
        assert_eq!(compared.get(), before);
    }

    #[tokio::test]
    async fn shadow_mode_answers_with_legacy_and_records_comparisons_and_mismatches() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let user = "u11-shadow@example.com";
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        grant(&fake, user, StreamType::Logs, "a");
        fake.list_extra_once(user, StreamType::Logs, "b");
        let site = "u11_shadow";
        let streams = typed(StreamType::Logs, &["a".to_string(), "b".to_string()]);
        let mismatch = || {
            metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
                .with_label_values(&[site, "logs", "new_allows_more"])
                .get()
        };
        let compared = || {
            metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL
                .with_label_values(&[site, "list"])
                .get()
        };
        let kept = readable_streams(&fake, site, user, ORG, streams.clone(), &Scope::every())
            .await
            .unwrap();
        assert_eq!(kept, Some(typed(StreamType::Logs, &["a".to_string()])));
        assert_eq!((mismatch(), compared()), (1, 1));
        readable_streams(&fake, site, user, ORG, streams, &Scope::every())
            .await
            .unwrap();
        assert_eq!(
            (mismatch(), compared()),
            (1, 2),
            "equal answers, no mismatch"
        );
    }

    #[tokio::test]
    async fn shadow_mode_does_not_compare_objects_outside_the_scope() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let user = "shadow-scope@example.com";
        let site = "shadow_scope";
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        grant(&fake, user, StreamType::Logs, "allowed");
        let scoped = typed(StreamType::Logs, &["allowed".into()]);
        let scope = Scope::requested(scoped.clone());
        let requested = [(StreamType::Logs, "allowed"), (StreamType::Logs, "outside")];
        let mismatch = |direction| {
            metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
                .with_label_values(&[site, "logs", direction])
                .get()
        };
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL.with_label_values(&[site, "list"]);
        let before = (
            mismatch("new_allows_more"),
            mismatch("new_allows_less"),
            compared.get(),
        );

        let (allowed, _) = answer_in_mode_with(
            ListCaller {
                checker: &fake,
                site,
                user_id: user,
            },
            |_| std::future::ready(requested.into_iter()),
            ShadowComparison::Requested,
            &scope,
            || async { None },
            |_| stream_answers(&fake, site, user, ORG, &scoped, &[StreamType::Logs]),
        )
        .await
        .unwrap();

        assert_eq!(allowed, None);
        assert_eq!(
            (
                mismatch("new_allows_more"),
                mismatch("new_allows_less"),
                compared.get()
            ),
            (before.0, before.1, before.2 + 1)
        );
    }

    #[tokio::test]
    async fn shadow_mode_runs_the_new_path_beside_the_legacy_one() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = &FakeStreamChecker::default();
        let user = "f5-shadow-concurrent@example.com";
        let site = "f5_shadow_concurrent";
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        let requested = typed(StreamType::Logs, &names("concurrent_", 1));
        grant(fake, user, StreamType::Logs, "concurrent_0");
        let started = &tokio::sync::Notify::new();
        let (kept, answers) = tokio::time::timeout(
            Duration::from_secs(5),
            answer_in_mode(
                fake,
                site,
                user,
                &requested,
                &Scope::every(),
                |requested| async move {
                    started.notified().await;
                    Some(requested)
                },
                |requested| async move {
                    started.notify_one();
                    stream_answers(fake, site, user, ORG, &requested, &[StreamType::Logs]).await
                },
            ),
        )
        .await
        .expect("shadow paths must run concurrently")
        .unwrap();
        assert_eq!(kept, Some(requested));
        assert!(matches!(answers, ModeAnswers::Shadow(_)));
    }

    #[tokio::test(start_paused = true)]
    async fn shadow_mode_answers_without_waiting_for_a_slow_new_path() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = &FakeStreamChecker::default();
        let user = "f5-shadow-timeout@example.com";
        let site = "f5_shadow_timeout";
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        let requested = typed(StreamType::Logs, &names("timeout_", 1));
        grant(fake, user, StreamType::Logs, "timeout_0");
        let skipped =
            metrics::AUTHZ_LIST_SHADOW_SKIPPED_TOTAL.with_label_values(&[site, "new_timeout"]);
        let before = skipped.get();
        let started = tokio::time::Instant::now();
        let (kept, answers) = answer_in_mode(
            fake,
            site,
            user,
            &requested,
            &Scope::every(),
            |requested| async move { Some(requested) },
            |requested| async move {
                tokio::time::sleep(Duration::from_secs(60)).await;
                stream_answers(fake, site, user, ORG, &requested, &[StreamType::Logs]).await
            },
        )
        .await
        .unwrap();
        assert_eq!(kept, Some(requested));
        assert!(matches!(answers, ModeAnswers::Legacy));
        assert_eq!(skipped.get(), before + 1);
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[tokio::test]
    async fn shadow_mode_skips_a_legacy_run_with_a_failed_check_and_a_busy_node() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let user = "u11-shadow-skip@example.com";
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        grant(&fake, user, StreamType::Logs, "a");
        let site = "u11_shadow_skip";
        let skipped = |reason| {
            metrics::AUTHZ_LIST_SHADOW_SKIPPED_TOTAL
                .with_label_values(&[site, reason])
                .get()
        };
        let streams = typed(StreamType::Logs, &["a".to_string()]);
        fake.fail_stream_read_once(user, "a");
        let kept = readable_streams(&fake, site, user, ORG, streams.clone(), &Scope::every())
            .await
            .unwrap();
        assert_eq!(kept, Some(HashSet::new()), "legacy drops the failed row");
        #[cfg(feature = "enterprise")]
        assert_eq!(skipped("legacy_error"), 1);
        let held = ShadowSlot::claim().expect("slot free");
        readable_streams(&fake, site, user, ORG, streams, &Scope::every())
            .await
            .unwrap();
        drop(held);
        assert_eq!(skipped("busy"), 1);
        assert_eq!(
            metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
                .with_label_values(&[site, "logs", "new_allows_less"])
                .get(),
            0
        );
    }

    #[tokio::test]
    async fn shadow_verdict_records_directions_and_keeps_legacy_verdicts() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let site = "c3_shadow_verdict_directions";
        let (_, answers) = stream_answers(
            &fake,
            site,
            "c3-verdict-directions@example.com",
            ORG,
            &HashSet::new(),
            &[StreamType::Logs],
        )
        .await
        .unwrap();
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL.with_label_values(&[site, "list"]);
        let compared_before = compared.get();
        let objects = [ObjectRef::stream(StreamType::Logs, "a")];
        let decision = |verdict| Decision {
            verdict,
            decided: if verdict == Err(None) {
                0
            } else {
                objects.len()
            },
        };
        for (legacy, new, kind, direction) in [
            (
                Ok(()),
                Err(Some(StreamType::Logs)),
                "logs",
                "new_allows_less",
            ),
            (
                Err(Some(StreamType::Traces)),
                Ok(()),
                "traces",
                "new_allows_more",
            ),
            (Ok(()), Err(None), "unknown", "new_allows_less"),
            (Err(None), Ok(()), "unknown", "new_allows_more"),
        ] {
            let mismatch = metrics::AUTHZ_LIST_SHADOW_MISMATCH_TOTAL
                .with_label_values(&[site, kind, direction]);
            let before = mismatch.get();
            assert_eq!(
                shadow_verdict(
                    site,
                    &answers,
                    &objects,
                    || async { (decision(legacy), false) },
                    || async { Ok(decision(new)) },
                )
                .await,
                legacy
            );
            assert_eq!(mismatch.get(), before + 1);
        }
        assert_eq!(compared.get(), compared_before + 4);
    }

    #[tokio::test]
    async fn shadow_verdict_counts_only_the_prefix_through_first_disagreement() {
        let fake = FakeStreamChecker::default();
        let site = "shadow_disagreement_prefix";
        let user = "shadow-prefix@example.com";
        let types = [StreamType::Logs, StreamType::Traces];
        let query = stream_read_query(site, ORG, user, &types);
        fake.grant_read_all(user, ORG, StreamType::Traces);
        let answers = type_answers(&fake, &query, &types).await.unwrap();
        let objects = [
            ObjectRef::stream(StreamType::Logs, "a"),
            ObjectRef::stream(StreamType::Traces, "b"),
        ];
        let compared = |strategy| {
            metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL
                .with_label_values(&[site, strategy])
                .get()
        };
        let before = (compared("list"), compared("probe_all"));
        compare_verdict(
            site,
            &answers,
            &objects,
            Decision {
                verdict: Err(Some(StreamType::Logs)),
                decided: 1,
            },
            false,
            Ok(Decision {
                verdict: Ok(()),
                decided: 2,
            }),
        );
        assert_eq!(
            (compared("list"), compared("probe_all")),
            (before.0 + 1, before.1)
        );
    }

    #[tokio::test]
    async fn shadow_verdict_skips_busy_and_failed_new_paths() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let site = "c3_shadow_verdict_skipped";
        let (_, answers) = stream_answers(
            &fake,
            site,
            "c3-verdict-skipped@example.com",
            ORG,
            &HashSet::new(),
            &[StreamType::Logs],
        )
        .await
        .unwrap();
        let busy = metrics::AUTHZ_LIST_SHADOW_SKIPPED_TOTAL.with_label_values(&[site, "busy"]);
        let busy_before = busy.get();
        let held = ShadowSlot::claim().expect("slot free");
        let objects = [ObjectRef::stream(StreamType::Logs, "a")];
        assert_eq!(
            shadow_verdict(
                site,
                &answers,
                &objects,
                || async {
                    (
                        Decision {
                            verdict: Err(Some(StreamType::Logs)),
                            decided: 1,
                        },
                        false,
                    )
                },
                || async { panic!("a busy shadow slot must not run the new path") },
            )
            .await,
            Err(Some(StreamType::Logs))
        );
        drop(held);
        assert_eq!(busy.get(), busy_before + 1);
        let new_error =
            metrics::AUTHZ_LIST_SHADOW_SKIPPED_TOTAL.with_label_values(&[site, "new_error"]);
        let error_before = new_error.get();
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL.with_label_values(&[site, "list"]);
        let compared_before = compared.get();
        assert_eq!(
            shadow_verdict(
                site,
                &answers,
                &objects,
                || async {
                    (
                        Decision {
                            verdict: Ok(()),
                            decided: objects.len(),
                        },
                        false,
                    )
                },
                || async { Err(UnavailableReason::Transport.into()) },
            )
            .await,
            Ok(())
        );
        assert_eq!(new_error.get(), error_before + 1);
        assert_eq!(compared.get(), compared_before);
    }

    #[tokio::test(start_paused = true)]
    async fn shadow_verdict_times_out_the_new_path_and_keeps_legacy() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let site = "c3_shadow_verdict_timeout";
        let (_, answers) = stream_answers(
            &fake,
            site,
            "c3-verdict-timeout@example.com",
            ORG,
            &HashSet::new(),
            &[StreamType::Logs],
        )
        .await
        .unwrap();
        let skipped =
            metrics::AUTHZ_LIST_SHADOW_SKIPPED_TOTAL.with_label_values(&[site, "new_timeout"]);
        let before = skipped.get();
        let started = tokio::time::Instant::now();
        let objects = [ObjectRef::stream(StreamType::Logs, "a")];
        assert_eq!(
            shadow_verdict(
                site,
                &answers,
                &objects,
                || async {
                    (
                        Decision {
                            verdict: Err(Some(StreamType::Logs)),
                            decided: 1,
                        },
                        false,
                    )
                },
                std::future::pending::<Result<Decision, AuthzUnavailable>>,
            )
            .await,
            Err(Some(StreamType::Logs))
        );
        assert_eq!(skipped.get(), before + 1);
        assert!(started.elapsed() < Duration::from_secs(4));
    }

    #[tokio::test(start_paused = true)]
    async fn stalled_evidence_rows_share_the_shadow_deadline_without_reclaiming_the_slot() {
        let _serial = SHADOW_TESTS.lock().await;
        let fake = &FakeStreamChecker::default();
        let site = "shadow_request_deadline";
        let user = "shadow-request-deadline@example.com";
        fake.set_list_mode(user, ListMode::Shadow);
        fake.set_shadow_sample(user, 1.0);
        let streams = StreamSet::new();
        let started = Instant::now();
        let (_, mode) = answer_in_mode(
            fake,
            site,
            user,
            &streams,
            &Scope::every(),
            |streams| async move { Some(streams) },
            |streams| async move {
                stream_answers(fake, site, user, ORG, &streams, &[StreamType::Logs]).await
            },
        )
        .await
        .unwrap();
        let ModeAnswers::Shadow(answers) = mode else {
            panic!("sampled answers missing")
        };
        tokio::time::advance(Duration::from_secs(2)).await;
        let legacy = || async {
            (
                Decision {
                    verdict: Ok(()),
                    decided: 1,
                },
                false,
            )
        };
        let objects = [ObjectRef::stream(StreamType::Logs, "a")];
        assert_eq!(
            shadow_verdict(
                site,
                &answers,
                &objects,
                legacy,
                std::future::pending::<Result<Decision, AuthzUnavailable>>,
            )
            .await,
            Ok(())
        );
        assert!(started.elapsed() < Duration::from_secs(4));

        assert_eq!(
            shadow_verdict(
                site,
                &answers,
                &objects,
                || async {
                    assert!(!SHADOW_BUSY.load(Ordering::Acquire));
                    legacy().await
                },
                || async { panic!("expired request must skip the new path") }
            )
            .await,
            Ok(())
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn shadow_verdict_skips_legacy_errors_and_counts_both_paths() {
        use std::sync::Arc;

        use super::super::accounting::{CallCounts, CallOutcome, REQUEST_CALLS, record_call};

        let _serial = SHADOW_TESTS.lock().await;
        let fake = FakeStreamChecker::default();
        let site = "c3_shadow_verdict_legacy_error";
        let (_, answers) = stream_answers(
            &fake,
            site,
            "c3-verdict-legacy-error@example.com",
            ORG,
            &HashSet::new(),
            &[StreamType::Logs],
        )
        .await
        .unwrap();
        let skipped =
            metrics::AUTHZ_LIST_SHADOW_SKIPPED_TOTAL.with_label_values(&[site, "legacy_error"]);
        let skipped_before = skipped.get();
        let compared = metrics::AUTHZ_LIST_SHADOW_COMPARED_TOTAL.with_label_values(&[site, "list"]);
        let compared_before = compared.get();
        let objects = [ObjectRef::stream(StreamType::Logs, "a")];
        let outer = Arc::new(CallCounts::default());
        assert_eq!(
            REQUEST_CALLS
                .scope(
                    outer.clone(),
                    shadow_verdict(
                        site,
                        &answers,
                        &objects,
                        || async {
                            record_call(CallOutcome::Error);
                            (
                                Decision {
                                    verdict: Err(Some(StreamType::Logs)),
                                    decided: 1,
                                },
                                false,
                            )
                        },
                        || async {
                            record_call(CallOutcome::Allow);
                            Ok(Decision {
                                verdict: Ok(()),
                                decided: objects.len(),
                            })
                        },
                    ),
                )
                .await,
            Err(Some(StreamType::Logs))
        );
        assert_eq!(skipped.get(), skipped_before + 1);
        assert_eq!(compared.get(), compared_before);
        assert_eq!((outer.calls(), outer.errors()), (2, 1));
    }

    #[tokio::test]
    async fn the_unavailable_response_carries_the_status_headers_and_body() {
        let response = authz_unavailable_response(AuthzUnavailable {
            reason: UnavailableReason::Timeout,
        });
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(response.headers()[header::RETRY_AFTER], "3");
        assert_eq!(response.headers()["x-o2-authz"], "unavailable");
        let body = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(
            body,
            serde_json::json!({
                "code": 503,
                "error_code": "authz_unavailable",
                "message": "Permission service unavailable, try again",
            })
        );
    }

    #[test]
    fn authz_latch_keeps_the_first_failure() {
        let latch = AuthzLatch::default();
        let first = AuthzUnavailable::from(UnavailableReason::Timeout);
        assert_eq!(latch.failure(), None);
        latch.record(first);
        latch.record(UnavailableReason::Transport.into());
        assert_eq!(latch.failure(), Some(first));
    }

    #[test]
    fn listable_stream_types_require_canonical_names_and_listable_models() {
        for stream_type in [
            StreamType::Logs,
            StreamType::Metrics,
            StreamType::Traces,
            StreamType::Profiles,
            StreamType::Index,
            StreamType::Metadata,
        ] {
            assert_eq!(
                listable_stream_type(stream_type.as_str()),
                Some(stream_type)
            );
        }
        for name in [
            "Logs",
            "foo",
            "enrichment_tables",
            "service_graph",
            "file_list",
            " logs",
            "",
        ] {
            assert_eq!(listable_stream_type(name), None, "{name}");
        }
    }

    #[tokio::test]
    async fn checker_checks_preserve_grants_and_deny_check_errors() {
        let fake = FakeStreamChecker::default();
        let user = "s5-legacy-checks@example.com";
        let checks = CheckerChecks(&fake);
        let query = stream_read_query(SITE_DB_MONITORING, ORG, user, &[]);
        let object = ObjectRef::stream(StreamType::Logs, "app");
        let prelude = OrgWideCheck {
            resource: "db_monitoring",
            permission: "GET",
            use_all_org: true,
            use_self_context: true,
            use_self_parent: false,
        };
        assert!(!checks.org_wide(ORG, user, &prelude).await);
        assert!(!checks.object(ORG, user, &query, &object).await);
        fake.grant_org_wide_check(user, ORG, prelude.resource);
        grant(&fake, user, StreamType::Logs, "app");
        assert!(checks.org_wide(ORG, user, &prelude).await);
        assert!(checks.object(ORG, user, &query, &object).await);
        fake.fail_org_wide_check_once(user, UnavailableReason::Timeout);
        fake.fail_object_check_once(user, UnavailableReason::Transport);
        assert!(!checks.org_wide(ORG, user, &prelude).await);
        assert!(!checks.object(ORG, user, &query, &object).await);
    }

    #[tokio::test]
    async fn objects_in_off_mode_returns_the_legacy_answer_unchanged() {
        let fake = FakeStreamChecker::default();
        let user = "s5-objects-off@example.com";
        let query = stream_read_query(SITE_GEN_AI, ORG, user, &[]);
        let objects = [ObjectRef::stream(StreamType::Logs, "app")];
        let streams = typed(StreamType::Logs, &["app".to_string()]);
        for legacy in [None, Some(StreamSet::new()), Some(streams)] {
            let result = objects_in_mode(&fake, &query, &objects, &Scope::every(), |_| async {
                legacy.clone()
            })
            .await
            .unwrap();
            assert_eq!(result, legacy);
        }
        assert_eq!(fake.calls(user).total(), 0);
    }

    #[tokio::test]
    async fn objects_in_off_mode_gives_legacy_only_scoped_objects() {
        let fake = FakeStreamChecker::default();
        let user = "scoped-objects-off@example.com";
        let query = stream_read_query("scoped_objects_off", ORG, user, &[]);
        let objects = [
            ObjectRef::stream(StreamType::Logs, "shared"),
            ObjectRef::stream(StreamType::Metrics, "shared"),
            ObjectRef::stream(StreamType::Logs, "filtered"),
        ];
        let shared = (StreamType::Logs, "shared".to_string());
        let filtered = (StreamType::Logs, "filtered".to_string());
        let scope = Scope::requested([shared.clone(), filtered.clone()]).filtered([filtered]);
        let legacy_answer = objects
            .iter()
            .map(|object| (object.stream_type, object.id.to_string()))
            .collect();

        let allowed = objects_in_mode(&fake, &query, &objects, &scope, |scoped| async move {
            assert_eq!(scoped.len(), 1);
            assert_eq!(
                (scoped[0].stream_type, scoped[0].id),
                (StreamType::Logs, "shared")
            );
            Some(legacy_answer)
        })
        .await
        .unwrap();

        assert_eq!(allowed, Some(StreamSet::from([shared])));
    }

    #[tokio::test]
    async fn objects_in_on_mode_returns_none_for_a_prelude_grant() {
        let fake = FakeStreamChecker::default();
        let user = "s5-objects-prelude@example.com";
        on(&fake, user);
        fake.grant_org_wide_check(user, ORG, "db_monitoring");
        let mut query = stream_read_query(SITE_DB_MONITORING, ORG, user, &[]);
        query.prelude = Some(OrgWideCheck {
            resource: "db_monitoring",
            permission: "GET",
            use_all_org: true,
            use_self_context: true,
            use_self_parent: false,
        });
        let objects = [ObjectRef::stream(StreamType::Logs, "app")];
        let result = within_budget(
            1,
            objects_in_mode(&fake, &query, &objects, &Scope::every(), |_| async {
                panic!("on mode must not call legacy")
            }),
        )
        .await
        .unwrap();
        assert_eq!(result, None);
        let calls = fake.calls(user);
        assert_eq!(calls.org_wide_checks, 1);
        assert_eq!((calls.types_access, calls.object_checks), (0, 0));
    }

    #[tokio::test]
    async fn objects_in_on_mode_decides_each_requested_type_once() {
        let fake = FakeStreamChecker::default();
        let user = "s5-objects-types@example.com";
        on(&fake, user);
        grant(&fake, user, StreamType::Metrics, "shared");
        let mut query = stream_read_query(SITE_GEN_AI, ORG, user, &[StreamType::Profiles]);
        query.use_self_parent = false;
        let objects = [
            ObjectRef::stream(StreamType::Metrics, "shared"),
            ObjectRef::stream(StreamType::Logs, "shared"),
            ObjectRef::stream(StreamType::Metrics, "shared"),
            ObjectRef::stream(StreamType::Traces, "denied"),
        ];
        let result = within_budget(
            4,
            objects_in_mode(&fake, &query, &objects, &Scope::every(), |_| async {
                panic!("on mode must not call legacy")
            }),
        )
        .await
        .unwrap();
        assert_eq!(
            result,
            Some(typed(StreamType::Metrics, &["shared".to_string()]))
        );
        let calls = fake.calls(user);
        assert_eq!(
            (calls.types_access, calls.lists, calls.object_checks),
            (1, 3, 0)
        );
    }

    #[tokio::test]
    async fn objects_in_mode_propagates_new_path_errors_only_in_on_mode() {
        let _serial = SHADOW_TESTS.lock().await;
        for mode in [ListMode::Off, ListMode::Shadow, ListMode::On] {
            let fake = FakeStreamChecker::default();
            let user = "s5-objects-error@example.com";
            fake.set_list_mode(user, mode);
            fake.set_shadow_sample(user, 1.0);
            fake.fail_types_access_once(user, UnavailableReason::Timeout);
            let query = stream_read_query(SITE_AUTOOBSERVE_STREAMS, ORG, user, &[]);
            let objects = [ObjectRef::stream(StreamType::Logs, "app")];
            let legacy = typed(StreamType::Logs, &["app".to_string()]);
            let legacy_called = AtomicBool::new(false);
            let result = objects_in_mode(&fake, &query, &objects, &Scope::every(), |_| async {
                legacy_called.store(true, Ordering::Relaxed);
                Some(legacy.clone())
            })
            .await;
            match mode {
                ListMode::On => assert_eq!(result, Err(UnavailableReason::Timeout.into())),
                ListMode::Off | ListMode::Shadow => assert_eq!(result, Ok(Some(legacy))),
            }
            assert_eq!(legacy_called.load(Ordering::Relaxed), mode != ListMode::On);
            assert_eq!(
                fake.calls(user).types_access,
                usize::from(mode != ListMode::Off)
            );
        }
    }
}
