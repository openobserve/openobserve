use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ConnectOptions, ConnectionTrait, Database,
    DatabaseConnection, EntityTrait, Schema,
};
use svix_ksuid::{Ksuid, KsuidLike as _};

use super::{
    alert_composites::{
        ChildKind, Resolution, create_with_children, delete_by_id, get_by_id,
        increment_evaluation_generation, list_by_org, list_parents, load_graph, resolve_by_id,
        update_with_children,
    },
    entity::{alert_composite_children, alert_composites, alerts},
    migration::{
        composite_alert_migration_sql_for_test, create_composite_alert_tables_for_test,
        create_scheduled_jobs_for_test,
    },
};

const ORG: &str = "org-a";
const OTHER_ORG: &str = "org-b";

fn id() -> String {
    Ksuid::new(None, None).to_string()
}

#[test]
fn child_kind_storage_ids_are_append_only() {
    assert_eq!(ChildKind::Alert as i16, 0);
    assert_eq!(ChildKind::Composite as i16, 1);
}

fn definition(id: &str, org: &str, name: &str) -> alert_composites::ActiveModel {
    alert_composites::ActiveModel {
        id: Set(id.to_string()),
        org: Set(org.to_string()),
        folder_id: Set("folder-a".to_string()),
        name: Set(name.to_string()),
        description: Set(Some("description".to_string())),
        expression: Set("normalized-expression".to_string()),
        warning_counts_as_firing: Set(true),
        stale_child_policy: Set(0),
        destinations: Set(serde_json::json!(["pager"])),
        template: Set(None),
        context_attributes: Set(None),
        enabled: Set(true),
        silence_seconds: Set(0),
        creates_incident: Set(false),
        workflows: Set(serde_json::json!([])),
        priority: Set(None),
        tags: Set(None),
        owner: Set(None),
        last_edited_by: Set(None),
        updated_at: Set(None),
        evaluation_generation: Set(0),
    }
}

fn child(
    composite_id: &str,
    child_id: &str,
    kind: ChildKind,
    order: i32,
) -> alert_composite_children::ActiveModel {
    alert_composite_children::ActiveModel {
        composite_id: Set(composite_id.to_string()),
        child_alert_id: Set(child_id.to_string()),
        child_kind: Set(kind as i16),
        display_order: Set(order),
    }
}

async fn db() -> DatabaseConnection {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    create_composite_alert_tables_for_test(&db).await.unwrap();
    db
}

#[tokio::test]
async fn migration_creates_only_v1_tables_indexes_and_claim_epoch() {
    let db = Database::connect("sqlite::memory:").await.unwrap();
    create_scheduled_jobs_for_test(&db).await.unwrap();
    create_composite_alert_tables_for_test(&db).await.unwrap();

    let tables: Vec<String> = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name".to_string(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get_by_index(0).unwrap())
        .collect();
    assert!(tables.iter().any(|name| name == "alert_composites"));
    assert!(tables.iter().any(|name| name == "alert_composite_children"));
    assert_eq!(
        tables
            .iter()
            .filter(|name| name.starts_with("alert_composite"))
            .cloned()
            .collect::<Vec<_>>(),
        vec![
            "alert_composite_children".to_string(),
            "alert_composites".to_string(),
        ]
    );

    let scheduled_columns = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "PRAGMA table_info('scheduled_jobs')".to_string(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| {
            (
                row.try_get::<String>("", "name").unwrap(),
                row.try_get::<Option<String>>("", "dflt_value").unwrap(),
            )
        })
        .collect::<Vec<_>>();
    assert_eq!(
        scheduled_columns
            .iter()
            .find(|(column, _)| column == "claim_epoch")
            .and_then(|(_, default)| default.as_deref()),
        Some("0")
    );

    let composite_columns = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "PRAGMA table_info('alert_composites')".to_string(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect::<std::collections::HashSet<_>>();
    let expected_columns = [
        "id",
        "org",
        "folder_id",
        "name",
        "description",
        "expression",
        "warning_counts_as_firing",
        "stale_child_policy",
        "destinations",
        "template",
        "context_attributes",
        "enabled",
        "silence_seconds",
        "creates_incident",
        "workflows",
        "priority",
        "tags",
        "owner",
        "last_edited_by",
        "updated_at",
        "evaluation_generation",
    ]
    .into_iter()
    .map(str::to_string)
    .collect();
    assert_eq!(composite_columns, expected_columns);

    let child_columns = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "PRAGMA table_info('alert_composite_children')".to_string(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect::<std::collections::HashSet<_>>();
    assert_eq!(
        child_columns,
        [
            "composite_id",
            "child_alert_id",
            "child_kind",
            "display_order",
        ]
        .into_iter()
        .map(str::to_string)
        .collect()
    );

    let child_indexes: Vec<String> = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "PRAGMA index_list('alert_composite_children')".to_string(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect();
    assert!(
        child_indexes
            .iter()
            .any(|name| name == "idx_alert_composite_children_reverse")
    );

    let composite_indexes: Vec<String> = db
        .query_all(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Sqlite,
            "PRAGMA index_list('alert_composites')".to_string(),
        ))
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.try_get::<String>("", "name").unwrap())
        .collect();
    for expected in [
        "idx_alert_composites_org_folder",
        "idx_alert_composites_org_name",
        "idx_alert_composites_org_enabled",
    ] {
        assert!(composite_indexes.iter().any(|name| name == expected));
    }
}

#[test]
fn composite_entities_generate_portable_sql_for_supported_meta_stores() {
    for backend in [
        sea_orm::DatabaseBackend::Sqlite,
        sea_orm::DatabaseBackend::Postgres,
    ] {
        let schema = Schema::new(backend);
        for entity in [
            schema.create_table_from_entity(alert_composites::Entity),
            schema.create_table_from_entity(alert_composite_children::Entity),
        ] {
            let sql = backend.build(&entity).to_string();
            assert!(!sql.is_empty());
            assert!(!sql.contains("AUTOINCREMENT"));
        }
    }
}

#[test]
fn migration_statements_build_for_supported_meta_stores() {
    for backend in [
        sea_orm::DatabaseBackend::Sqlite,
        sea_orm::DatabaseBackend::Postgres,
    ] {
        let sql = composite_alert_migration_sql_for_test(backend)
            .join(" ")
            .to_ascii_lowercase();
        for contract in [
            "alert_composites",
            "alert_composite_children",
            "evaluation_generation",
            "child_kind",
            "display_order",
        ] {
            assert!(sql.contains(contract), "{backend:?} omitted {contract}");
        }
    }
}

#[tokio::test]
async fn postgres_migration_and_repository_crud_execute_when_ci_provides_postgres() {
    let Ok(dsn) = std::env::var("ZO_META_POSTGRES_DSN") else {
        // The normal SQLite unit-test lane has no external service. The
        // repository's PostgreSQL lane sets this variable and must execute
        // this same contract against the real supported backend.
        return;
    };
    // The SQLite lane sets the variable to an empty string rather than leaving
    // it unset; treat that the same as unset so this contract only runs
    // against a real PostgreSQL.
    if dsn.trim().is_empty() {
        return;
    }
    let admin = Database::connect(&dsn).await.unwrap();
    let schema_name = format!("composite_alerts_test_{}", id().to_ascii_lowercase());
    assert!(
        schema_name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
    );
    admin
        .execute(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            format!(r#"CREATE SCHEMA "{schema_name}""#),
        ))
        .await
        .unwrap();

    let mut options = ConnectOptions::new(dsn);
    options.max_connections(1).min_connections(1);
    let db = Database::connect(options).await.unwrap();
    db.execute(sea_orm::Statement::from_string(
        sea_orm::DatabaseBackend::Postgres,
        format!(r#"SET search_path TO "{schema_name}""#),
    ))
    .await
    .unwrap();
    create_scheduled_jobs_for_test(&db).await.unwrap();
    create_composite_alert_tables_for_test(&db).await.unwrap();

    let composite_id = id();
    let first = id();
    let second = id();
    create_with_children(
        &db,
        definition(&composite_id, ORG, "postgres-parent"),
        vec![
            child(&composite_id, &first, ChildKind::Alert, 0),
            child(&composite_id, &second, ChildKind::Alert, 1),
        ],
    )
    .await
    .unwrap();
    let stored = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    assert_eq!(stored.definition.name, "postgres-parent");
    assert_eq!(stored.children.len(), 2);

    let mut replacement = definition(&composite_id, ORG, "postgres-updated");
    replacement.evaluation_generation = Set(0);
    update_with_children(
        &db,
        replacement,
        vec![child(&composite_id, &second, ChildKind::Alert, 0)],
    )
    .await
    .unwrap();
    let updated = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    assert_eq!(updated.definition.name, "postgres-updated");
    assert_eq!(updated.definition.evaluation_generation, 1);
    assert_eq!(updated.children.len(), 1);

    delete_by_id(&db, ORG, &composite_id).await.unwrap();
    assert!(get_by_id(&db, ORG, &composite_id).await.unwrap().is_none());

    db.close().await.unwrap();
    admin
        .execute(sea_orm::Statement::from_string(
            sea_orm::DatabaseBackend::Postgres,
            format!(r#"DROP SCHEMA "{schema_name}" CASCADE"#),
        ))
        .await
        .unwrap();
}

#[tokio::test]
async fn repository_crud_preserves_child_order_kind_org_scope_and_generation() {
    let db = db().await;
    let composite_id = id();
    let ordinary_id = id();
    let nested_id = id();

    create_with_children(
        &db,
        definition(&composite_id, ORG, "parent"),
        vec![
            child(&composite_id, &ordinary_id, ChildKind::Alert, 0),
            child(&composite_id, &nested_id, ChildKind::Composite, 1),
        ],
    )
    .await
    .unwrap();

    let stored = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    assert_eq!(stored.definition.name, "parent");
    assert_eq!(stored.children.len(), 2);
    assert_eq!(stored.children[0].child_alert_id, ordinary_id);
    assert_eq!(stored.children[0].child_kind, ChildKind::Alert as i16);
    assert_eq!(stored.children[1].child_alert_id, nested_id);
    assert_eq!(stored.children[1].child_kind, ChildKind::Composite as i16);
    assert!(
        get_by_id(&db, OTHER_ORG, &composite_id)
            .await
            .unwrap()
            .is_none()
    );
    assert!(list_by_org(&db, OTHER_ORG).await.unwrap().is_empty());

    assert_eq!(
        increment_evaluation_generation(&db, ORG, &composite_id)
            .await
            .unwrap(),
        1
    );
    let replacement_id = id();
    let mut replacement = definition(&composite_id, ORG, "renamed");
    // A stale full-row update must not reset the runtime counter.
    replacement.evaluation_generation = Set(0);
    update_with_children(
        &db,
        replacement,
        vec![child(&composite_id, &replacement_id, ChildKind::Alert, 0)],
    )
    .await
    .unwrap();
    let updated = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    assert_eq!(updated.definition.name, "renamed");
    assert_eq!(updated.definition.evaluation_generation, 2);
    assert_eq!(updated.children.len(), 1);
    assert_eq!(updated.children[0].child_alert_id, replacement_id);

    delete_by_id(&db, ORG, &composite_id).await.unwrap();
    assert!(get_by_id(&db, ORG, &composite_id).await.unwrap().is_none());
}

#[tokio::test]
async fn reverse_lookup_is_scoped_by_child_kind_and_org_and_graph_is_complete() {
    let db = db().await;
    let shared_id = id();
    let parent_a = id();
    let parent_b = id();
    let other_parent = id();

    for (parent, org, kind) in [
        (&parent_a, ORG, ChildKind::Alert),
        (&parent_b, ORG, ChildKind::Composite),
        (&other_parent, OTHER_ORG, ChildKind::Alert),
    ] {
        create_with_children(
            &db,
            definition(parent, org, parent),
            vec![child(parent, &shared_id, kind, 0)],
        )
        .await
        .unwrap();
    }

    assert_eq!(
        list_parents(&db, ORG, ChildKind::Alert, &shared_id)
            .await
            .unwrap()
            .into_iter()
            .map(|parent| parent.id)
            .collect::<Vec<_>>(),
        vec![parent_a.clone()]
    );
    assert_eq!(
        list_parents(&db, ORG, ChildKind::Composite, &shared_id)
            .await
            .unwrap()
            .into_iter()
            .map(|parent| parent.id)
            .collect::<Vec<_>>(),
        vec![parent_b.clone()]
    );
    assert_eq!(load_graph(&db, ORG).await.unwrap().len(), 2);
}

#[tokio::test]
async fn definition_and_children_commit_or_roll_back_together() {
    let db = db().await;
    let composite_id = id();
    let duplicate = id();
    let result = create_with_children(
        &db,
        definition(&composite_id, ORG, "will-roll-back"),
        vec![
            child(&composite_id, &duplicate, ChildKind::Alert, 0),
            child(&composite_id, &duplicate, ChildKind::Alert, 1),
        ],
    )
    .await;
    assert!(result.is_err());
    assert!(get_by_id(&db, ORG, &composite_id).await.unwrap().is_none());
    assert!(
        alert_composite_children::Entity::find()
            .all(&db)
            .await
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn failed_update_preserves_the_previous_definition_children_and_generation() {
    let db = db().await;
    let composite_id = id();
    let first = id();
    let second = id();
    create_with_children(
        &db,
        definition(&composite_id, ORG, "before"),
        vec![
            child(&composite_id, &first, ChildKind::Alert, 0),
            child(&composite_id, &second, ChildKind::Alert, 1),
        ],
    )
    .await
    .unwrap();
    let before = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    let duplicate = id();

    let result = update_with_children(
        &db,
        definition(&composite_id, ORG, "must-not-commit"),
        vec![
            child(&composite_id, &duplicate, ChildKind::Alert, 0),
            child(&composite_id, &duplicate, ChildKind::Alert, 1),
        ],
    )
    .await;

    assert!(result.is_err());
    let after = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    assert_eq!(after.definition, before.definition);
    assert_eq!(after.children, before.children);
}

#[tokio::test]
async fn generic_resolution_rejects_a_cross_table_duplicate_id() {
    let db = db().await;
    let duplicate_id = id();
    create_with_children(
        &db,
        definition(&duplicate_id, ORG, "composite"),
        vec![
            child(&duplicate_id, &id(), ChildKind::Alert, 0),
            child(&duplicate_id, &id(), ChildKind::Alert, 1),
        ],
    )
    .await
    .unwrap();

    // Corrupt shape is inserted directly: production allocation cannot create
    // it, but a resolver must fail closed if restored data contains it.
    let backend = db.get_database_backend();
    let schema = Schema::new(backend);
    db.execute(backend.build(&schema.create_table_from_entity(alerts::Entity)))
        .await
        .unwrap();
    db.execute(sea_orm::Statement::from_string(
        sea_orm::DatabaseBackend::Sqlite,
        "PRAGMA foreign_keys = OFF".to_string(),
    ))
    .await
    .unwrap();
    let mut ordinary = crate::table::alerts::tests::make_model(&duplicate_id);
    ordinary.org = ORG.to_string();
    alerts::ActiveModel::from(ordinary)
        .insert(&db)
        .await
        .unwrap();

    assert_eq!(
        resolve_by_id(&db, ORG, &duplicate_id).await.unwrap(),
        Resolution::DuplicateId
    );
}
