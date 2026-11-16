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

use sea_orm::{ActiveModelTrait, Database, DatabaseConnection, IntoActiveModel, Schema, Set};

use super::*;

async fn load_page_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    kind: ResourceKind,
    after: Option<&str>,
    limit: usize,
) -> Result<SummaryPage> {
    super::load_page_with(conn, org, kind, after, limit, usize::MAX / 4).await
}

async fn refresh_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    kind: ResourceKind,
    id: &str,
) -> Result<Option<ResourceSummary>> {
    super::refresh_with(conn, org, kind, id, usize::MAX / 4).await
}

async fn folder_page_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    after: Option<&str>,
    limit: usize,
) -> Result<FolderPage> {
    super::folder_page_with(conn, org, after, limit, usize::MAX / 4).await
}

async fn fixture() -> DatabaseConnection {
    let conn = Database::connect("sqlite::memory:").await.unwrap();
    for sql in [
        "CREATE TABLE folders (id TEXT PRIMARY KEY,org TEXT,type INTEGER,folder_id TEXT,name TEXT)",
        "CREATE TABLE dashboards (dashboard_id TEXT,folder_id TEXT,title TEXT,data TEXT)",
        "CREATE TABLE alerts (id TEXT,org TEXT,folder_id TEXT,name TEXT,enabled BOOLEAN,is_real_time BOOLEAN,context_attributes TEXT)",
        "CREATE TABLE alert_composites (id TEXT,org TEXT,folder_id TEXT,name TEXT,enabled BOOLEAN,context_attributes TEXT)",
        "CREATE TABLE anomaly_detection_config (anomaly_id TEXT,org_id TEXT,folder_id TEXT,name TEXT,enabled BOOLEAN)",
        "CREATE TABLE synthetics (id TEXT,org_id TEXT,folder_id TEXT,name TEXT,enabled BOOLEAN)",
        "CREATE TABLE pipeline (id TEXT,org TEXT,name TEXT,enabled BOOLEAN,kind TEXT)",
        "CREATE TABLE users (email TEXT,first_name TEXT,last_name TEXT)",
        "CREATE TABLE org_users (email TEXT,org_id TEXT,role INTEGER)",
        "CREATE TABLE meta (module TEXT,key1 TEXT,key2 TEXT,start_dt BIGINT,value TEXT)",
        "INSERT INTO folders VALUES ('pk1','org',0,'public1','Production'),('pk2','org',0,'public2','Staging'),('pk3','other',0,'other','Hidden'),('pa','org',1,'alerts','Alert folder'),('ps','org',3,'synthetics','Probe folder')",
    ] {
        conn.execute_unprepared(sql).await.unwrap();
    }
    conn
}

#[tokio::test]
async fn dashboard_projection_pages_and_refreshes_current_folder_without_reading_body() {
    let conn = fixture().await;
    conn.execute_unprepared("INSERT INTO dashboards VALUES ('a','pk1','Alpha','malformed JSON'),('b','pk2','Beta','body'),('c','pk3','Other org','body')").await.unwrap();
    let page = load_page_with(&conn, "org", ResourceKind::Dashboard, None, 1)
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    assert_eq!(page.items[0].id, "a");
    assert_eq!(page.items[0].folder_id.as_deref(), Some("public1"));
    let next = load_page_with(
        &conn,
        "org",
        ResourceKind::Dashboard,
        page.next.as_deref(),
        1,
    )
    .await
    .unwrap();
    assert_eq!(next.items[0].id, "b");
    let end = load_page_with(
        &conn,
        "org",
        ResourceKind::Dashboard,
        next.next.as_deref(),
        1,
    )
    .await
    .unwrap();
    assert!(end.items.is_empty() && end.next.is_none());
    conn.execute_unprepared(
        "UPDATE dashboards SET folder_id='pk2',title='Renamed' WHERE dashboard_id='a'",
    )
    .await
    .unwrap();
    let row = refresh_with(&conn, "org", ResourceKind::Dashboard, "a")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(row.name, "Renamed");
    assert_eq!(row.folder_name.as_deref(), Some("Staging"));
    assert!(
        refresh_with(&conn, "org", ResourceKind::Dashboard, "c")
            .await
            .unwrap()
            .is_none()
    );
    conn.execute_unprepared("DELETE FROM dashboards WHERE dashboard_id='a'")
        .await
        .unwrap();
    assert!(
        refresh_with(&conn, "org", ResourceKind::Dashboard, "a")
            .await
            .unwrap()
            .is_none()
    );
}

#[tokio::test]
async fn alert_projection_unions_subtypes_and_retains_siem_filter_metadata() {
    let conn = fixture().await;
    for sql in [
        "INSERT INTO alerts VALUES ('a','org','pa','Ordinary',false,false,'{\"siem\":\"true\"}')",
        "INSERT INTO alert_composites VALUES ('b','org','alerts','Composite',true,NULL)",
        "INSERT INTO anomaly_detection_config VALUES ('c','org','pa','Anomaly',false)",
        "INSERT INTO alerts VALUES ('z','other','pa','Not owned',true,false,NULL)",
    ] {
        conn.execute_unprepared(sql).await.unwrap();
    }
    let page = load_page_with(&conn, "org", ResourceKind::Alert, None, 20)
        .await
        .unwrap();
    assert_eq!(
        page.items.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        vec!["a", "b", "c"]
    );
    assert!(page.items[0].is_siem);
    assert!(!page.items[1].is_siem);
    assert!(
        page.items
            .iter()
            .all(|r| r.folder_id.as_deref() == Some("alerts"))
    );
}

#[tokio::test]
async fn metadata_pages_use_exact_org_boundaries_and_stream_identity() {
    let conn = fixture().await;
    for sql in [
        "INSERT INTO meta VALUES ('function','org','Alpha',0,'not valid VRL or JSON'),('function','org','Beta',0,'body'),('function','org2','Leaked',0,'body')",
        "INSERT INTO meta VALUES ('schema','org','logs/payment',0,'not JSON'),('schema','org','logs/payment',1,'not JSON'),('schema','org','metrics/payment',0,'not JSON'),('schema','org','traces/payment/123',0,'not JSON'),('schema','org','logs/_o2_ai_chat_events',0,'not JSON')",
        "INSERT INTO meta VALUES ('organization','savedviews','org/view1',0,'{\"org_id\":\"org\",\"view_id\":\"view1\",\"view_name\":\"Saved\",\"data\":\"private query body\",\"view_type\":\"traces\"}'),('organization','savedviews','org2/view2',0,'invalid')",
    ] {
        conn.execute_unprepared(sql).await.unwrap();
    }
    let one = load_page_with(&conn, "org", ResourceKind::Function, None, 1)
        .await
        .unwrap();
    assert_eq!(one.items[0].name, "Alpha");
    let two = load_page_with(&conn, "org", ResourceKind::Function, one.next.as_deref(), 1)
        .await
        .unwrap();
    assert_eq!(two.items[0].name, "Beta");
    let end = load_page_with(&conn, "org", ResourceKind::Function, two.next.as_deref(), 1)
        .await
        .unwrap();
    assert!(end.items.is_empty() && end.next.is_none());
    let streams = load_page_with(&conn, "org", ResourceKind::Stream, None, 20)
        .await
        .unwrap();
    assert_eq!(
        streams
            .items
            .iter()
            .map(|r| r.id.as_str())
            .collect::<Vec<_>>(),
        vec!["logs/payment", "metrics/payment", "traces/payment"]
    );
    assert!(
        refresh_with(&conn, "org", ResourceKind::Stream, "traces/payment")
            .await
            .unwrap()
            .is_some()
    );
    let views = load_page_with(&conn, "org", ResourceKind::SavedView, None, 20)
        .await
        .unwrap();
    assert_eq!(views.items[0].id, "view1");
    assert_eq!(
        views.items[0].route_ref,
        ResourceRoute::SavedView {
            view_id: "view1".into(),
            view_type: "traces".into()
        }
    );
    assert!(
        !serde_json::to_string(&views.items)
            .unwrap()
            .contains("private query body")
    );
    conn.execute_unprepared("UPDATE meta SET value='malformed' WHERE module='organization'")
        .await
        .unwrap();
    assert!(
        load_page_with(&conn, "org", ResourceKind::SavedView, None, 20)
            .await
            .is_err()
    );
}

#[tokio::test]
async fn safe_projections_keep_disabled_user_pipelines_and_separate_account_roles() {
    let conn = fixture().await;
    for sql in [
        "INSERT INTO pipeline VALUES ('user','org','Disabled',false,'user'),('internal','org','Internal',true,'evaluation')",
        "INSERT INTO synthetics VALUES ('s','org','ps','Probe',false)",
        "INSERT INTO users VALUES ('a@example.invalid','Alice','Human'),('sa@example.invalid','Service','Account'),('agent@example.invalid','Agent','')",
        "INSERT INTO org_users VALUES ('a@example.invalid','org',4),('sa@example.invalid','org',5),('agent@example.invalid','org',6)",
    ] {
        conn.execute_unprepared(sql).await.unwrap();
    }
    let pipelines = load_page_with(&conn, "org", ResourceKind::Pipeline, None, 20)
        .await
        .unwrap();
    assert_eq!(pipelines.items.len(), 1);
    assert_eq!(pipelines.items[0].enabled, Some(false));
    let probes = load_page_with(&conn, "org", ResourceKind::Synthetic, None, 20)
        .await
        .unwrap();
    assert_eq!(probes.items[0].folder_id.as_deref(), Some("synthetics"));
    let humans = load_page_with(&conn, "org", ResourceKind::User, None, 20)
        .await
        .unwrap();
    assert_eq!(humans.items.len(), 1);
    let accounts = load_page_with(&conn, "org", ResourceKind::ServiceAccount, None, 20)
        .await
        .unwrap();
    assert_eq!(accounts.items.len(), 2);
    assert!(
        load_page_with(&conn, "org' OR 1=1 --", ResourceKind::User, None, 20)
            .await
            .unwrap()
            .items
            .is_empty()
    );
}

#[tokio::test]
async fn synthetic_projection_uses_the_actual_entity_schema_without_secret_columns() {
    use infra::table::entity::{folders, synthetics_checks};

    let conn = Database::connect("sqlite::memory:").await.unwrap();
    let backend = conn.get_database_backend();
    let schema = Schema::new(backend);
    for statement in [
        schema.create_table_from_entity(folders::Entity),
        schema.create_table_from_entity(synthetics_checks::Entity),
    ] {
        conn.execute(backend.build(&statement)).await.unwrap();
    }
    folders::ActiveModel {
        id: Set("folder-primary-key".into()),
        org: Set("org".into()),
        folder_id: Set("public-folder".into()),
        name: Set("Probe folder".into()),
        description: Set(None),
        icon: Set(None),
        r#type: Set(3),
    }
    .insert(&conn)
    .await
    .unwrap();
    synthetics_checks::Model {
        id: "check".into(),
        org_id: "org".into(),
        folder_id: "folder-primary-key".into(),
        name: "Probe".into(),
        enabled: false,
        target: "https://example.invalid/never-executed".into(),
        secrets: "unreadable-secret-payload".repeat(4096),
        ..Default::default()
    }
    .into_active_model()
    .insert(&conn)
    .await
    .unwrap();
    let page = super::load_page_with(&conn, "org", ResourceKind::Synthetic, None, 20, 4096)
        .await
        .unwrap();
    assert_eq!(page.items.len(), 1);
    let check = &page.items[0];
    assert_eq!(check.folder_id.as_deref(), Some("public-folder"));
    assert_eq!(check.folder_name.as_deref(), Some("Probe folder"));
    assert_eq!(check.enabled, Some(false));
    assert_eq!(
        check.route_ref,
        ResourceRoute::Synthetic {
            check_id: "check".into(),
            folder_id: "public-folder".into()
        }
    );
    let json = serde_json::to_value(check).unwrap();
    assert!(json.get("secrets").is_none() && json.get("target").is_none());
    assert!(
        refresh_with(&conn, "org", ResourceKind::Synthetic, "check")
            .await
            .unwrap()
            .is_some()
    );
    assert!(
        load_page_with(&conn, "other", ResourceKind::Synthetic, None, 20)
            .await
            .unwrap()
            .items
            .is_empty()
    );
}

#[tokio::test]
async fn folder_name_projection_pages_with_kind_and_public_identity() {
    let conn = fixture().await;
    let mut after = None;
    let mut items = Vec::new();
    loop {
        let page = folder_page_with(&conn, "org", after.as_deref(), 1)
            .await
            .unwrap();
        assert!(page.items.len() <= 1);
        items.extend(page.items);
        after = page.next;
        if after.is_none() {
            break;
        }
    }
    assert_eq!(items.len(), 4);
    assert!(items.contains(&(
        ResourceKind::Dashboard,
        "public1".into(),
        "Production".into()
    )));
    assert!(items.contains(&(ResourceKind::Alert, "alerts".into(), "Alert folder".into())));
    assert!(items.contains(&(
        ResourceKind::Synthetic,
        "synthetics".into(),
        "Probe folder".into()
    )));
    assert!(!items.iter().any(|(_, id, _)| id == "other"));
}

#[tokio::test]
async fn source_scratch_bound_suppresses_growing_saved_payload_and_alert_attributes() {
    let conn = fixture().await;
    conn.execute_unprepared("INSERT INTO meta VALUES ('organization','savedviews','org/view',0,'{\"org_id\":\"org\",\"view_id\":\"view\",\"view_name\":\"Saved\",\"view_type\":\"logs\",\"data\":\"tiny_payload\"}')").await.unwrap();
    conn.execute_unprepared(
        "INSERT INTO alerts VALUES ('alert','org','pa','Alert',true,false,'{}')",
    )
    .await
    .unwrap();
    for kind in [ResourceKind::SavedView, ResourceKind::Alert] {
        let read = SourceRead::page("org", kind, None, 20).unwrap();
        let reserved = read.scratch_bytes(&conn).await.unwrap();
        if kind == ResourceKind::SavedView {
            conn.execute_unprepared("UPDATE meta SET value=replace(value,'tiny_payload',replace(hex(zeroblob(32768)),'00','x')) WHERE module='organization'").await.unwrap();
        } else {
            conn.execute_unprepared("UPDATE alerts SET context_attributes='{\"large\":\"' || replace(hex(zeroblob(32768)),'00','x') || '\"}'").await.unwrap();
        }
        let actual = read.scratch_bytes(&conn).await.unwrap();
        assert!(actual > reserved);
        let raw = SummaryRow::find_by_statement(read.bounded_statement(&conn, reserved).unwrap())
            .all(&conn)
            .await
            .unwrap();
        assert!(raw.iter().all(|row| row.id.is_empty()
            && row.name.is_empty()
            && row.payload.is_none()
            && row.attributes.is_none()));
        let error = super::load_page_with(&conn, "org", kind, None, 20, reserved)
            .await
            .unwrap_err();
        assert_eq!(
            error
                .downcast_ref::<ResourceExhausted>()
                .unwrap()
                .required_bytes,
            actual
        );
        let loaded = super::load_page_with(&conn, "org", kind, None, 20, actual)
            .await
            .unwrap();
        assert_eq!(loaded.items.len(), 1);
    }
}

#[tokio::test]
async fn subscription_distinguishes_empty_explicit_gap_and_closed_channel() {
    let (sender, receiver) = mpsc::channel(4);
    sender.send(Event::Empty).await.unwrap();
    sender
        .send(Event::Put(infra::db::EventData {
            key: infra::coordinator::resources::CONTINUITY_LOST_KEY.into(),
            value: None,
            start_dt: None,
        }))
        .await
        .unwrap();
    drop(sender);
    let mut events = ResourceEvents {
        receiver,
        pending: VecDeque::new(),
    };
    assert_eq!(events.next().await.unwrap(), ResourceChange::InvalidateAll);
    assert!(events.next().await.is_err());
}

#[test]
fn event_parser_preserves_scopes_without_using_payload_or_repurposing_empty() {
    let changes = parse_event_key("/dashboards/org/id").unwrap();
    assert!(
        matches!(&changes[0],ResourceChange::Resource{org,kind:ResourceKind::Dashboard,id} if org=="org"&&id=="id")
    );
    assert!(
        matches!(&parse_event_key("/pipelines/id").unwrap()[0],ResourceChange::GlobalResource{kind:ResourceKind::Pipeline,id} if id=="id")
    );
    assert_eq!(
        parse_event_key("/user_record/u@example.invalid")
            .unwrap()
            .len(),
        2
    );
    assert!(
        matches!(&parse_event_key("/resource_catalog/folder/org").unwrap()[0],ResourceChange::Folder{org} if org=="org")
    );
    assert!(matches!(
        &parse_event_key(infra::coordinator::resources::CONTINUITY_LOST_KEY).unwrap()[0],
        ResourceChange::InvalidateAll
    ));
    assert!(parse_event_key("/unrelated/org/id").unwrap().is_empty());
    assert!(parse_event_key("/dashboards/malformed").is_err());
}
