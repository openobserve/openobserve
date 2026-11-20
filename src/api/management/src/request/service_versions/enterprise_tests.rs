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

use axum::http::StatusCode;

use super::*;
use crate::request::service_identity;

fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: std::sync::OnceLock<tokio::runtime::Runtime> = std::sync::OnceLock::new();
    // Global database pools must outlive every test that borrows their runtime resources.
    RUNTIME.get_or_init(|| tokio::runtime::Runtime::new().unwrap())
}

fn denied_user() -> Headers<UserEmail> {
    Headers(UserEmail {
        user_id: "stage4-denied@example.com".into(),
    })
}

#[test]
fn every_read_api_endpoint_denies_missing_org_grant() {
    runtime().block_on(async {
        assert_endpoint_denials().await;
    });
}

async fn assert_endpoint_denials() {
    infra::db::create_table().await.unwrap();
    let request = serde_json::from_value(serde_json::json!({
        "scope":"service", "service_name":"svc", "where_key":"env:prod", "value":"prod"
    }))
    .unwrap();
    let responses = [
        crate::request::alerts::incidents::create_incident(Path("stage4-denied".into()),denied_user(),axum::Json(serde_json::from_value(serde_json::json!({"title":"Regression","severity":"P2","service":"checkout","where_key":"env:prod"})).unwrap())).await,

        deploys(
            Path("stage4-denied".into()),
            denied_user(),
            Query(BTreeMap::new()),
        )
        .await,
        verdicts(
            Path("stage4-denied".into()),
            denied_user(),
            Query(BTreeMap::new()),
        )
        .await,
        list(
            Path("stage4-denied".into()),
            denied_user(),
            Query(BTreeMap::new()),
        )
        .await,
        services(
            Path("stage4-denied".into()),
            denied_user(),
            Query(BTreeMap::new()),
        )
        .await,
        compare(
            Path("stage4-denied".into()),
            denied_user(),
            axum::Json(serde_json::json!({"signals":["traces"]})),
        )
        .await,
        delete(
            Path(("stage4-denied".into(), "version".into())),
            denied_user(),
        )
        .await,
        service_identity::envs(
            Path("stage4-denied".into()),
            denied_user(),
            Query(BTreeMap::new()),
        )
        .await,
        service_identity::unresolved(
            Path("stage4-denied".into()),
            denied_user(),
            Query(BTreeMap::new()),
        )
        .await,
        service_identity::overrides(
            Path("stage4-denied".into()),
            denied_user(),
            Query(BTreeMap::new()),
        )
        .await,
        service_identity::put_override(
            Path("stage4-denied".into()),
            denied_user(),
            axum::Json(request),
        )
        .await,
        service_identity::delete_override(
            Path(("stage4-denied".into(), "rule".into())),
            denied_user(),
        )
        .await,
    ];
    for response in responses {
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}

async fn value(response: Response) -> serde_json::Value {
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert!(
        status.is_success(),
        "{status}: {}",
        String::from_utf8_lossy(&body)
    );
    serde_json::from_slice(&body).unwrap()
}

#[test]
fn every_read_api_endpoint_filters_denied_source_streams() {
    runtime().block_on(async {
    use config::meta::service_identity::{EnvSource, ServiceVersionObservation, WhereKind};
    use infra::table::entity;
    use sea_orm::{ConnectionTrait, EntityTrait};
    let org = format!("stage4-source-denied-{}", config::utils::time::now_micros());
    let org = org.as_str();
    let email = format!("{org}@example.com");
    let email = email.as_str();
    infra::db::create_table().await.unwrap();
    let conn = infra::db::get_orm_client_rw().await;
    infra::table::service_versions::create_tables_for_tests(conn).await.unwrap();
    let backend = conn.get_database_backend();
    let schema = sea_orm::Schema::new(backend);
    let statements = [
        schema
            .create_table_from_entity(entity::service_versions::Entity)
            .if_not_exists()
            .to_owned(),
        schema
            .create_table_from_entity(entity::service_where_summary::Entity)
            .if_not_exists()
            .to_owned(),
        schema
            .create_table_from_entity(entity::service_identity_rules::Entity)
            .if_not_exists()
            .to_owned(),
        schema
            .create_table_from_entity(entity::service_name_aliases::Entity)
            .if_not_exists()
            .to_owned(),
    ];
    for statement in statements {
        conn.execute(backend.build(&statement)).await.unwrap();
    }
    let observation = ServiceVersionObservation {
        service_name: "hidden".into(),
        where_key: "env:secret".into(),
        where_kind: WhereKind::Env,
        k8s_cluster: String::new(),
        k8s_namespace: String::new(),
        env: "secret".into(),
        env_source: EnvSource::Attribute,
        env_source_value: "deployment.environment".into(),
        version: "v1".into(),
        raw_version: Some("v1".into()),
        version_source: "service.version".into(),
        image: None,
        image_ref: None,
        source_stream: "hidden-spans".into(),
        signal: "traces".into(),
        first_seen: 100,
        last_seen: 200,
    };
    let record = observation.to_record(org, 300);
    infra::table::service_versions::merge_upsert_many(conn, vec![record.clone()])
        .await
        .unwrap();
    let summary = observation.to_summary(org, &record, 300);
    infra::table::service_where_summary::upsert_many(conn, vec![summary])
        .await
        .unwrap();
    common::infra::config::ORG_USERS.insert(
        format!("{}/{email}", config::DEFAULT_ORG),
        infra::table::org_users::OrgUserRecord {
            role: config::meta::user::UserRole::Root,
            token: String::new(),
            rum_token: None,
            org_id: config::DEFAULT_ORG.into(),
            email: email.into(),
            created_at: 0,
            allow_static_token: true,
        },
    );
    openobserve_core::authz::fake_checker();
    let user = || {
        Headers(UserEmail {
            user_id: email.into(),
        })
    };
    let params = || Query(BTreeMap::from([("service".into(), "hidden".into())]));
    let listed = value(list(Path(org.into()), user(), params()).await).await;
    assert_eq!(listed["total"], 0);

    let hidden_deploys=value(deploys(Path(org.into()),user(),params()).await).await;
    assert_eq!(hidden_deploys["deploys"],serde_json::json!([]));
    let hidden_verdicts=value(verdicts(Path(org.into()),user(),Query(BTreeMap::from([("keys".into(),record.version_key.clone())]))).await).await;
    assert_eq!(hidden_verdicts["verdicts"],serde_json::json!([]));
    let catalog = value(services(Path(org.into()), user(), Query(BTreeMap::new())).await).await;
    assert_eq!(catalog["services"], serde_json::json!([]));
    let envs =
        value(service_identity::envs(Path(org.into()), user(), Query(BTreeMap::new())).await).await;
    assert_eq!(envs["envs"], serde_json::json!([]));
    let unresolved =
        value(service_identity::unresolved(Path(org.into()), user(), Query(BTreeMap::new())).await)
            .await;
    assert_eq!(unresolved["no_version"], serde_json::json!([]));
    let overrides =
        value(service_identity::overrides(Path(org.into()), user(), Query(BTreeMap::new())).await)
            .await;
    assert_eq!(overrides["total"], 0);
    let request = serde_json::json!({"service":"hidden","where":"env:secret","a":{"version":"v1"},"signals":["traces"]});
    assert_eq!(
        compare(Path(org.into()), user(), axum::Json(request))
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let deleted = value(delete(Path((org.into(), record.version_key.clone())), user()).await).await;
    assert_eq!(deleted["deleted"], false);
    let request=serde_json::from_value(serde_json::json!({"scope":"service","service_name":"hidden","where_key":"env:secret","value":"prod"})).unwrap();
    assert_eq!(
        service_identity::put_override(Path(org.into()), user(), axum::Json(request))
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        service_identity::delete_override(Path((org.into(), "hidden-rule".into())), user())
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert!(
        infra::table::service_versions::get_by_keys(conn, org, &[record.version_key])
            .await
            .unwrap()[0]
            .is_live()
    );
    assert_eq!(
        entity::service_versions::Entity::find()
            .all(conn)
            .await
            .unwrap()
            .iter()
            .filter(|row| row.org_id == org)
            .count(),
        1
    );

    });
}
