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

//! I-1b and I-9: the type-level path through the real checker against today's per-stream helpers.

#![cfg(feature = "enterprise")]

use std::{borrow::Cow, collections::HashSet, path::PathBuf, sync::Arc};

use common::infra::config::{ORG_USERS, USERS};
use config::meta::{
    organization::OrganizationType,
    stream::StreamType,
    user::{UserRole, UserType},
};
use futures::{StreamExt, stream};
use infra::table::{self, org_users, org_users::OrgUserRecord, users, users::UserRecord};
use o2_dex::meta::auth::{O2EntityAuthorization, Permission};
use o2_openfga::{
    authorizer::{
        authz::{add_user_to_org, init_open_fga, save_org_tuples},
        is_valid_tuple_object, roles,
        test_support::{BUILT_IN_ROLES, Dataset, OrgData, Rng, Scale, UserData, generate, write},
    },
    config::OFGA_STORE_ID,
    meta::mapping::OFGA_MODELS,
    model::{create_open_fga_store, read_ofga_model, write_auth_models},
};
use openobserve_core::{
    auth::{self, AuthExtractor},
    authz::{
        self, StreamAccessChecker, TypedStream,
        accounting::{CallCounts, REQUEST_CALLS},
        active_checker,
        list::{
            Bypass, Identity, ObjectRef, ObjectsQuery, OrgWideCheck, Readable,
            SITE_AUTOOBSERVE_STREAMS, SITE_DB_MONITORING, SITE_GEN_AI, SITE_SECURITY_SOURCES,
            SITE_SERVICE_GRAPH, StreamSet, authorize_objects, probe_covers, stream_answers,
            stream_read_query,
        },
    },
};

const ORG: &str = "i1b_org";

/// Every test reconfigures the process-wide OpenFGA settings, so they run one at a time.
static SERIAL: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

static RUNTIME: std::sync::LazyLock<tokio::runtime::Runtime> =
    std::sync::LazyLock::new(|| tokio::runtime::Runtime::new().unwrap());

static STORE: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();

const MEMBERS: [Member; 5] = [
    Member {
        id: "plain@example.com",
        email: "plain@example.com",
        role: UserRole::User,
    },
    Member {
        id: "upper@example.com",
        email: "Upper@Example.com",
        role: UserRole::User,
    },
    Member {
        id: "custom@example.com",
        email: "custom@example.com",
        role: UserRole::User,
    },
    Member {
        id: "editor@example.com",
        email: "editor@example.com",
        role: UserRole::Editor,
    },
    Member {
        id: ORG,
        email: ORG,
        role: UserRole::Admin,
    },
];

const STREAMS: [(StreamType, &str); 9] = [
    (StreamType::Logs, "s1"),
    (StreamType::Logs, "s2"),
    (StreamType::Logs, "_all_i1b_org"),
    (StreamType::Logs, "foo.bar"),
    (StreamType::Logs, "foo:bar"),
    (StreamType::Metrics, "m1"),
    (StreamType::Metrics, "m2"),
    (StreamType::Traces, "t1"),
    (StreamType::Traces, "t2"),
];

const PERMISSIONS: [&str; 3] = ["GET", "LIST", "PUT"];
const SHAPES: [(bool, bool, bool, &str); 5] = [
    (false, true, false, ""),
    (false, false, false, ""),
    (true, false, false, ""),
    (false, true, true, ""),
    (true, false, false, "i1b_parent"),
];

/// One request user: the id the request carries, the stored email, and the org role.
struct Member {
    id: &'static str,
    email: &'static str,
    role: UserRole,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum IdForm {
    Sanitized,
    Raw,
}

impl IdForm {
    fn object(self, stream_type: StreamType, name: &str) -> ObjectRef<'_> {
        match self {
            Self::Sanitized => ObjectRef::stream(stream_type, name),
            Self::Raw => ObjectRef {
                id: name,
                stream_type,
                ofga_id: Cow::Borrowed(name),
            },
        }
    }
}

struct TemporaryMetadata {
    dir: PathBuf,
    original_config: Arc<config::Config>,
}

impl Drop for TemporaryMetadata {
    fn drop(&mut self) {
        config::CONFIG.store(Arc::clone(&self.original_config));
        if let Err(error) = std::fs::remove_dir_all(&self.dir) {
            eprintln!("Could not remove {}: {error}", self.dir.display());
        }
    }
}

#[test]
#[ignore = "needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
fn type_answers_equal_todays_helpers_end_to_end() {
    RUNTIME.block_on(async {
        let _serial = SERIAL.lock().await;
        connect().await;
        seed().await;
        for deadline in ["5000", "0"] {
            declare_deadline(deadline);
            for member in &MEMBERS {
                for identity in [Identity::GivenId, Identity::StoredEmail] {
                    assert_member_matches(ORG, member, &STREAMS, identity, deadline).await;
                }
            }
        }
    });
}

#[test]
#[ignore = "needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
fn generated_authorization_matches_legacy_helpers() {
    RUNTIME.block_on(async {
        let _serial = SERIAL.lock().await;
        let _metadata = init_matrix_metadata().await;
        connect().await;
        let checker = active_checker();
        let scale = match std::env::var("O2_OPENFGA_IT_SCALE").as_deref() {
            Ok("full") => Scale::full(),
            _ => Scale::small(),
        };
        let seeds = std::env::var("O2_OPENFGA_IT_SEEDS").unwrap_or_else(|_| "1".to_string());
        for seed in seeds.split(',') {
            let seed = seed.trim().parse().expect("seed is a number");
            let mut dataset = generate(seed, scale);
            for org in &mut dataset.orgs {
                add_missing_stream_names(org);
            }
            write(&dataset).await.expect("data set is written");
            seed_matrix_members(&dataset).await;
            let mut rng = Rng::new(seed);
            for org in &dataset.orgs {
                let users = sampled_users(&dataset, org, &mut rng);
                assert_org_matrix(checker.as_ref(), org, &users).await;
            }
        }
    });
}

#[test]
#[ignore = "needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
fn meta_role_override_answers_equal_todays_helpers() {
    RUNTIME.block_on(assert_meta_override(
        Member {
            id: "Meta-Role@example.com",
            email: "Meta-Role@example.com",
            role: UserRole::User,
        },
        "meta_readers",
    ));
}

#[test]
#[ignore = "needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
fn meta_role_override_uses_the_identity_sent_to_openfga() {
    RUNTIME.block_on(assert_meta_override(
        Member {
            id: "meta.mixed@example.com",
            email: "Meta.Mixed@Example.com",
            role: UserRole::User,
        },
        "meta_mixed_readers",
    ));
}

#[test]
#[ignore = "needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
fn s5_site_answers_equal_per_object_checks_end_to_end() {
    RUNTIME.block_on(async {
        let _serial = SERIAL.lock().await;
        connect().await;
        seed().await;
        for deadline in ["5000", "0"] {
            declare_deadline(deadline);
            for member in &MEMBERS {
                for query in s5_queries(member.id) {
                    assert_s5_matches(&query, deadline).await;
                }
            }
        }
    });
}

#[test]
#[ignore = "needs OpenFGA v1.22.1 at O2_OPENFGA_IT_URL"]
fn an_undeclared_deadline_returns_the_complete_answer_at_scale() {
    RUNTIME.block_on(async {
        let _serial = SERIAL.lock().await;
        connect().await;
        let org = "i9_org";
        let user = "subset@example.com";
        save_org_tuples(org).await;
        add_member(org, user, user, UserRole::User).await;
        let names: Vec<String> = (0..2858).map(|i| format!("m{i}")).collect();
        roles::create_role("subset", org).await.unwrap();
        for chunk in names[..315].chunks(50) {
            let grants = chunk
                .iter()
                .map(|name| O2EntityAuthorization {
                    object: format!("metrics:{name}"),
                    permission: Permission::AllowGet,
                })
                .collect();
            let members = HashSet::from([user.to_string()]);
            roles::update_role(org, "subset", grants, vec![], Some(members), None)
                .await
                .unwrap();
        }
        declare_deadline("0");
        let streams: HashSet<(StreamType, String)> = names
            .iter()
            .map(|n| (StreamType::Metrics, n.clone()))
            .collect();
        let checker = active_checker();
        let (readable, _) = stream_answers(
            checker.as_ref(),
            "i9",
            user,
            org,
            &streams,
            &[StreamType::Metrics],
        )
        .await
        .expect("no 503");
        let expected: HashSet<(StreamType, String)> = names[..315]
            .iter()
            .map(|n| (StreamType::Metrics, n.clone()))
            .collect();
        assert_eq!(readable, Some(expected));
    });
}

/// Points the process at the test OpenFGA and creates one store for the binary.
async fn connect() {
    let url = std::env::var("O2_OPENFGA_IT_URL").unwrap_or("http://127.0.0.1:18080".into());
    // SAFETY: tests hold `SERIAL`, and no other thread reads the environment meanwhile.
    unsafe {
        std::env::set_var("O2_OPENFGA_ENABLED", "true");
        std::env::set_var("O2_OPENFGA_BASE_URL", url);
    }
    o2_openfga::config::refresh_config().unwrap();
    init_open_fga().await;
    STORE
        .get_or_init(|| async {
            let store_id = create_open_fga_store().await.expect("store is created");
            write_auth_models(&read_ofga_model().await, &store_id)
                .await
                .expect("model is written");
            OFGA_STORE_ID.insert("store_id".to_string(), store_id);
        })
        .await;
}

fn declare_deadline(ms: &str) {
    // SAFETY: tests hold `SERIAL`, and no other thread reads the environment meanwhile.
    unsafe { std::env::set_var("O2_OPENFGA_LIST_SERVER_DEADLINE_MS", ms) };
    o2_openfga::config::refresh_config().unwrap();
}

async fn add_member(org: &str, id: &str, email: &str, role: UserRole) {
    add_user_to_org(org, email, &role.to_string()).await;
    cache_member(org, id, user_record(email), role);
}

async fn seed() {
    save_org_tuples(ORG).await;
    for member in &MEMBERS {
        add_member(ORG, member.id, member.email, member.role.clone()).await;
    }
    let grant = |object: &str| O2EntityAuthorization {
        object: object.to_string(),
        permission: Permission::AllowGet,
    };
    roles::create_role("readers", ORG).await.unwrap();
    let readers = MEMBERS[..2].iter().map(|m| m.email.to_string()).collect();
    let grants = ["logs:s1", "logs:_all_i1b_org", "metrics:m1", "traces:t2"].map(grant);
    roles::update_role(ORG, "readers", grants.to_vec(), vec![], Some(readers), None)
        .await
        .unwrap();
    roles::create_role("wide", ORG).await.unwrap();
    let wide = HashSet::from([MEMBERS[2].email.to_string()]);
    let grants = vec![grant(&format!("logs:_all_{ORG}"))];
    roles::update_role(ORG, "wide", grants, vec![], Some(wide), None)
        .await
        .unwrap();
}

/// Compares `authorize_objects` with the helper each identity's sites call today.
async fn assert_member_matches(
    org: &str,
    member: &Member,
    streams: &[(StreamType, &str)],
    identity: Identity,
    deadline: &str,
) -> HashSet<(StreamType, String)> {
    let checker = active_checker();
    let mut query = stream_read_query("i1b", org, member.id, &[]);
    query.bypass = Bypass::RbacOffOrRoot;
    query.identity = identity;
    let form = match identity {
        Identity::GivenId => IdForm::Raw,
        Identity::StoredEmail => IdForm::Sanitized,
    };
    let objects: Vec<_> = streams
        .iter()
        .map(|(stream_type, name)| form.object(*stream_type, name))
        .collect();
    let oracle = legacy_readable(checker.as_ref(), &query, &objects, form).await;
    let label = format!("{org} {} {identity:?} deadline {deadline}", member.id);
    let readable = authorize_objects(checker.as_ref(), &query, &objects)
        .await
        .expect(&label);
    assert_eq!(readable, Readable::Only(oracle.clone()), "{label}");
    oracle
}

async fn assert_meta_override(member: Member, role_name: &str) {
    let _serial = SERIAL.lock().await;
    connect().await;
    let org = config::META_ORG_ID;
    save_org_tuples(org).await;
    let override_role = seed_meta_member(&member, role_name).await;
    let override_key = format!("{org}/{}", member.email);
    let streams = [(StreamType::Logs, "s1"), (StreamType::Logs, "s2")];
    let expected = HashSet::from([(StreamType::Logs, "s1".to_string())]);
    for deadline in ["5000", "0"] {
        declare_deadline(deadline);
        for identity in [Identity::GivenId, Identity::StoredEmail] {
            let request_role =
                assert_member_matches(org, &member, &streams, identity, deadline).await;
            ORG_USERS.insert(override_key.clone(), override_role.clone());
            let overridden =
                assert_member_matches(org, &member, &streams, identity, deadline).await;
            ORG_USERS.remove(&override_key);
            if identity == Identity::GivenId && member.id != member.email {
                assert_eq!(overridden, request_role, "{identity:?} deadline {deadline}");
            } else {
                assert_eq!(overridden, expected, "{identity:?} deadline {deadline}");
                assert_ne!(overridden, request_role, "{identity:?} deadline {deadline}");
            }
        }
    }
    let lookup_id = member.id.to_lowercase();
    ORG_USERS.remove(&format!("{org}/{lookup_id}"));
    USERS.remove(&lookup_id);
}

async fn seed_meta_member(member: &Member, role_name: &str) -> OrgUserRecord {
    let org = config::META_ORG_ID;
    add_member(org, member.id, member.email, member.role.clone()).await;
    roles::create_role(role_name, org).await.unwrap();
    roles::update_role(
        org,
        role_name,
        vec![O2EntityAuthorization {
            object: "logs:s1".to_string(),
            permission: Permission::AllowGet,
        }],
        vec![],
        Some(HashSet::from([member.email.to_string()])),
        None,
    )
    .await
    .unwrap();

    // The membership lookup folds case, while the _meta override uses the exact id.
    let lookup_key = format!("{org}/{}", member.id.to_lowercase());
    let override_role = {
        let mut lookup = ORG_USERS.get_mut(&lookup_key).unwrap();
        let override_role = lookup.value().clone();
        lookup.role = UserRole::Editor;
        override_role
    };
    let request_user = openobserve_core::users::get_user(Some(org), member.id)
        .await
        .unwrap();
    assert_eq!(request_user.email, member.email);
    assert_eq!(request_user.role, UserRole::Editor);
    override_role
}

async fn init_matrix_metadata() -> TemporaryMetadata {
    let mut cfg = config::config::init();
    let dir = std::env::temp_dir().join(format!("i1b-{}", config::ider::uuid()));
    std::fs::create_dir(&dir).unwrap();
    cfg.common.local_mode = true;
    cfg.common.meta_store = "sqlite".to_string();
    cfg.common.data_db_dir = format!("{}/", dir.display());
    let original_config = config::CONFIG.swap(Arc::new(cfg));
    let metadata = TemporaryMetadata {
        dir,
        original_config,
    };
    table::create_user_tables().await.unwrap();
    metadata
}

fn user_record(email: &str) -> UserRecord {
    UserRecord {
        email: email.to_string(),
        first_name: String::new(),
        last_name: String::new(),
        password: String::new(),
        salt: String::new(),
        is_root: false,
        password_ext: None,
        user_type: UserType::Internal,
        created_at: 0,
        updated_at: 0,
        must_reset_password: false,
        password_reset_reason: None,
        flagged_at: None,
        password_updated_at: None,
    }
}

fn cache_member(org: &str, id: &str, record: UserRecord, role: UserRole) {
    let id = id.to_lowercase();
    let email = record.email.clone();
    USERS.insert(id.clone(), record);
    ORG_USERS.insert(
        format!("{org}/{id}"),
        OrgUserRecord {
            email,
            org_id: org.to_string(),
            role,
            token: String::new(),
            rum_token: None,
            created_at: 0,
            allow_static_token: false,
        },
    );
}

async fn seed_matrix_members(dataset: &Dataset) {
    for org in &dataset.orgs {
        table::organizations::add(&org.org, &org.org, OrganizationType::Custom)
            .await
            .unwrap();
        for user in &org.users {
            let record = user_record(&user.id);
            let role: UserRole = user.role.parse().unwrap();
            users::add(record.clone()).await.unwrap();
            org_users::add_with_flags(&org.org, &user.id, role.clone(), "", None, false)
                .await
                .unwrap();
            cache_member(&org.org, &user.id, record, role);
        }
    }
}

fn add_missing_stream_names(org: &mut OrgData) {
    for (&kind, names) in &mut org.streams {
        if !names.iter().any(|name| name.chars().count() > 256) {
            names.push("x".repeat(260));
        }
        if !names.iter().any(|name| {
            name.chars().count() > 200 && is_valid_tuple_object(&format!("{kind}:{name}"))
        }) {
            names.push("y".repeat(205));
        }
        for (character, name) in [
            ('/', "matrix/path"),
            (':', "matrix:colon"),
            (' ', "matrix space"),
            ('\u{a0}', "matrix\u{a0}nbsp"),
            ('\u{2003}', "matrix\u{2003}emsp"),
        ] {
            if !names.iter().any(|name| name.contains(character)) {
                names.push(name.to_string());
            }
        }
    }
}

fn sampled_users<'a>(dataset: &Dataset, org: &'a OrgData, rng: &mut Rng) -> Vec<&'a UserData> {
    if matches!(std::env::var("O2_OPENFGA_IT_USERS").as_deref(), Ok("all")) {
        return org.users.iter().collect();
    }
    let mut sampled = HashSet::new();
    for role in BUILT_IN_ROLES {
        let mut candidates: Vec<_> = org.users.iter().filter(|user| user.role == role).collect();
        for _ in 0..candidates.len().div_ceil(20) {
            let index = rng.below(candidates.len());
            sampled.insert(candidates.swap_remove(index).id.as_str());
        }
    }
    org.users
        .iter()
        .filter(|user| {
            sampled.contains(user.id.as_str())
                || user.id == org.org
                || user.id.chars().any(char::is_uppercase)
                || dataset.orgs.iter().any(|other| {
                    other.org != org.org && other.users.iter().any(|member| member.id == user.id)
                })
        })
        .collect()
}

async fn assert_org_matrix(checker: &dyn StreamAccessChecker, org: &OrgData, users: &[&UserData]) {
    for (&kind, names) in &org.streams {
        let stream_type = StreamType::from(kind);
        for form in [IdForm::Sanitized, IdForm::Raw] {
            let objects: Vec<_> = names
                .iter()
                .map(|name| form.object(stream_type, name))
                .collect();
            for user in users {
                let user_id = user.id.to_lowercase();
                let types = [stream_type];
                let query = stream_read_query("i1b_matrix", &org.org, &user_id, &types);
                assert_query_shapes(checker, query, &objects, form).await;
            }
        }
    }
}

async fn assert_query_shapes(
    checker: &dyn StreamAccessChecker,
    query: ObjectsQuery<'_>,
    objects: &[ObjectRef<'_>],
    form: IdForm,
) {
    for permission in PERMISSIONS {
        for (use_self_context, use_self_parent, use_all_org, parent_id) in SHAPES {
            for identity in [Identity::GivenId, Identity::StoredEmail] {
                let query = ObjectsQuery {
                    permission,
                    use_self_context,
                    use_self_parent,
                    use_all_org,
                    parent_id,
                    bypass: Bypass::RbacOffOrRoot,
                    identity,
                    ..query
                };
                assert_matrix_query(checker, &query, objects, form).await;
            }
        }
    }
}

async fn assert_matrix_query(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    objects: &[ObjectRef<'_>],
    form: IdForm,
) {
    let oracle = Readable::Only(legacy_readable(checker, query, objects, form).await);
    let uncovered = objects
        .iter()
        .filter(|object| !probe_covers(&object.ofga_id))
        .count();
    let budget = 1 + 3 * query.stream_types.len() + uncovered;
    for (declared, deadline) in [(true, "5000"), (false, "0")] {
        declare_deadline(deadline);
        let counts = Arc::new(CallCounts::default());
        let answer = REQUEST_CALLS
            .scope(
                Arc::clone(&counts),
                authorize_objects(checker, query, objects),
            )
            .await
            .unwrap_or_else(|error| panic!("{query:?} {form:?} deadline {deadline}: {error:?}"));
        assert_eq!(answer, oracle, "{query:?} {form:?} deadline {deadline}");
        let calls = counts.calls() as usize;
        if !query.type_level_supported() {
            assert_eq!(
                calls,
                objects.len(),
                "{query:?} {form:?} deadline {deadline}: one OpenFGA Check per object"
            );
        } else if declared {
            assert!(
                (1..=budget).contains(&calls),
                "{query:?} {form:?} sent {calls} OpenFGA calls, expected 1..={budget}"
            );
        }
    }
}

async fn legacy_readable(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    objects: &[ObjectRef<'_>],
    form: IdForm,
) -> StreamSet {
    stream::iter(objects)
        .map(|object| async move {
            legacy_object_allowed(checker, query, object, form)
                .await
                .then(|| (object.stream_type, object.id.to_string()))
        })
        .buffer_unordered(32)
        .filter_map(|allowed| async move { allowed })
        .collect()
        .await
}

async fn legacy_object_allowed(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    object: &ObjectRef<'_>,
    form: IdForm,
) -> bool {
    match query.identity {
        // `can_read_stream` uses the stored email and hardcodes the sanitized GET shape.
        Identity::StoredEmail
            if form == IdForm::Sanitized
                && query.permission == "GET"
                && !query.use_all_org
                && query.parent_id.is_empty()
                && query.use_self_parent
                && !query.use_self_context =>
        {
            let stream = TypedStream {
                org_id: query.org_id.to_string(),
                stream_type: object.stream_type,
                name: object.id.to_string(),
            };
            checker.can_read_stream(query.user_id, &stream).await
        }
        Identity::GivenId => legacy_given_id_check(query, object).await,
        Identity::StoredEmail => {
            auth::check_permissions(
                &object.ofga_id,
                query.org_id,
                query.user_id,
                object.stream_type.as_str(),
                query.permission,
                (!query.parent_id.is_empty()).then_some(query.parent_id),
                query.use_all_org,
                query.use_self_context,
                query.use_self_parent,
            )
            .await
        }
    }
}

async fn legacy_given_id_check(query: &ObjectsQuery<'_>, object: &ObjectRef<'_>) -> bool {
    let user = openobserve_core::users::get_user(Some(query.org_id), query.user_id)
        .await
        .expect("generated member is seeded");
    let resource = object.stream_type.as_str();
    let model = OFGA_MODELS
        .get(resource)
        .map_or(resource, |model| model.key);
    authz::check_permissions(
        query.user_id,
        AuthExtractor {
            auth: String::new(),
            method: query.permission.to_string(),
            o2_type: format!("{model}:{}", object.ofga_id),
            org_id: query.org_id.to_string(),
            bypass_check: false,
            parent_id: query.parent_id.to_string(),
            use_all_org: query.use_all_org,
            use_self_context: query.use_self_context,
            use_self_parent: query.use_self_parent,
            feature: None,
        },
        user.role,
        user.is_external,
    )
    .await
}

fn s5_queries(user_id: &str) -> Vec<ObjectsQuery<'_>> {
    let stored = ObjectsQuery {
        bypass: Bypass::RbacOffOrRoot,
        identity: Identity::StoredEmail,
        ..stream_read_query(
            SITE_GEN_AI,
            ORG,
            user_id,
            &[StreamType::Logs, StreamType::Metrics],
        )
    };
    let mut queries = vec![
        stream_read_query(SITE_SECURITY_SOURCES, ORG, user_id, &[StreamType::Logs]),
        ObjectsQuery {
            prelude: Some(s5_prelude("db_monitoring")),
            ..stream_read_query(SITE_DB_MONITORING, ORG, user_id, &[StreamType::Traces])
        },
        ObjectsQuery {
            site: SITE_SERVICE_GRAPH,
            stream_types: &[StreamType::Traces],
            prelude: Some(s5_prelude("traces")),
            ..stored
        },
        stored,
    ];
    for stream_types in [
        &[StreamType::Logs],
        &[StreamType::Metrics],
        &[StreamType::Traces],
    ] {
        queries.push(stream_read_query(
            SITE_AUTOOBSERVE_STREAMS,
            ORG,
            user_id,
            stream_types,
        ));
    }
    queries
}

fn s5_prelude(resource: &str) -> OrgWideCheck<'_> {
    OrgWideCheck {
        resource,
        permission: "GET",
        use_all_org: true,
        use_self_context: false,
        use_self_parent: false,
    }
}

async fn assert_s5_matches(query: &ObjectsQuery<'_>, deadline: &str) {
    let checker = active_checker();
    let objects: Vec<ObjectRef<'_>> = STREAMS
        .iter()
        .filter(|(stream_type, _)| query.stream_types.contains(stream_type))
        .map(|(stream_type, name)| {
            if query.site == SITE_GEN_AI {
                ObjectRef {
                    id: name,
                    stream_type: *stream_type,
                    ofga_id: Cow::Borrowed(name),
                }
            } else {
                ObjectRef::stream(*stream_type, name)
            }
        })
        .collect();
    let label = format!(
        "{} {} {:?} deadline {deadline}",
        query.site, query.user_id, query.stream_types
    );
    let oracle = s5_per_object_answer(checker.as_ref(), query, &objects, &label).await;
    let readable = authorize_objects(checker.as_ref(), query, &objects)
        .await
        .expect(&label);
    assert_eq!(readable, oracle, "{label}");
}

async fn s5_per_object_answer(
    checker: &dyn StreamAccessChecker,
    query: &ObjectsQuery<'_>,
    objects: &[ObjectRef<'_>],
    label: &str,
) -> Readable {
    if !checker.enforces_rbac().await
        || checker.is_root(query.user_id).await
        || (query.bypass == Bypass::RbacOffRootOrOrgAdmin
            && checker.is_root_or_admin(query.org_id, query.user_id).await)
    {
        return Readable::All;
    }
    if let Some(prelude) = &query.prelude
        && checker
            .org_wide_check(query.user_id, query.org_id, prelude)
            .await
            .expect(label)
    {
        return Readable::All;
    }
    let mut oracle = HashSet::new();
    for object in objects {
        if checker
            .check_object(query.user_id, query.org_id, query, object)
            .await
            .expect(label)
        {
            oracle.insert((object.stream_type, object.id.to_string()));
        }
    }
    Readable::Only(oracle)
}
