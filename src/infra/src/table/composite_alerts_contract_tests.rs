use sea_orm::{
    ActiveModelTrait, ActiveValue::Set, ConnectOptions, ConnectionTrait, Database,
    DatabaseConnection, EntityTrait, Schema,
};
use svix_ksuid::{Ksuid, KsuidLike as _};

use super::{
    alert_composites::{
        ChildKind, CompositeWithChildren, ReplicaWrite, ReplicatedKind, Resolution,
        apply_replicated, create_with_children, delete_by_id, get_by_id,
        increment_evaluation_generation, list_by_org, list_parents, load_graph, move_to_folder,
        replica_write, resolve_by_id, set_enabled, update_with_children,
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
        pending_period_sec: Set(0),
        incident_title_template: Set(None),
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
        "pending_period_sec",
        "incident_title_template",
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

/// A definition as another region would send it; `children` are ordinary alerts in display order.
fn replicated(
    id: &str,
    name: &str,
    updated_at: Option<i64>,
    evaluation_generation: i64,
    children: &[&str],
) -> CompositeWithChildren {
    CompositeWithChildren {
        definition: alert_composites::Model {
            id: id.to_string(),
            org: ORG.to_string(),
            folder_id: "folder-a".to_string(),
            name: name.to_string(),
            expression: "normalized-expression".to_string(),
            destinations: serde_json::json!(["pager"]),
            enabled: true,
            workflows: serde_json::json!([]),
            updated_at,
            evaluation_generation,
            ..Default::default()
        },
        children: children
            .iter()
            .enumerate()
            .map(|(order, child_id)| alert_composite_children::Model {
                composite_id: id.to_string(),
                child_alert_id: child_id.to_string(),
                child_kind: ChildKind::Alert as i16,
                display_order: order as i32,
            })
            .collect(),
    }
}

fn child_ids(stored: &CompositeWithChildren) -> Vec<&str> {
    stored
        .children
        .iter()
        .map(|child| child.child_alert_id.as_str())
        .collect()
}

/// R3 and R4: the decision for every (message kind, local row, incoming `updated_at`).
#[test]
fn a_replicated_definition_is_decided_by_its_kind_the_local_row_and_updated_at() {
    use ReplicaWrite::{Insert, Replace, Skip};
    use ReplicatedKind::{Create, Update};

    let bumped = Replace {
        evaluation_generation: 5,
    };
    let cases = [
        (Create, None, Some(10), Insert),
        (Update, None, Some(10), Skip),
        (Update, Some(Some(10)), Some(11), bumped),
        (Update, Some(Some(10)), Some(10), Skip),
        (Update, Some(Some(10)), Some(9), Skip),
        (Update, Some(Some(10)), None, Skip),
        (Update, Some(None), Some(1), bumped),
        (Update, Some(None), None, Skip),
        (Create, Some(Some(10)), Some(11), bumped),
        (Create, Some(Some(10)), Some(10), Skip),
    ];
    for (kind, local_updated_at, incoming_updated_at, expected) in cases {
        let local = local_updated_at.map(|updated_at| alert_composites::Model {
            updated_at,
            evaluation_generation: 4,
            ..Default::default()
        });
        let incoming = alert_composites::Model {
            updated_at: incoming_updated_at,
            evaluation_generation: 99,
            ..Default::default()
        };
        assert_eq!(
            replica_write(kind, local.as_ref(), &incoming),
            expected,
            "{kind:?} local={local_updated_at:?} incoming={incoming_updated_at:?}"
        );
    }
}

/// R3: an unknown id is inserted with the origin's `updated_at` and a fresh generation.
#[tokio::test]
async fn a_replicated_create_inserts_once_and_a_redelivery_changes_nothing() {
    let db = db().await;
    let composite_id = id();
    let (first, second) = (id(), id());
    let incoming = replicated(
        &composite_id,
        "from-origin",
        Some(100),
        7,
        &[&first, &second],
    );

    let write = apply_replicated(&db, ReplicatedKind::Create, incoming.clone())
        .await
        .unwrap();
    assert_eq!(write, ReplicaWrite::Insert);
    let stored = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    assert_eq!(stored.definition.name, "from-origin");
    assert_eq!(stored.definition.updated_at, Some(100));
    assert_eq!(stored.definition.evaluation_generation, 0);
    assert_eq!(stored.children, incoming.children);

    let again = apply_replicated(&db, ReplicatedKind::Create, incoming)
        .await
        .unwrap();
    assert_eq!(again, ReplicaWrite::Skip);
    assert_eq!(
        get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap(),
        stored
    );
}

/// R3: a create for an id this region already holds is applied as an update.
#[tokio::test]
async fn a_replicated_create_of_a_known_id_is_applied_as_an_update() {
    let db = db().await;
    let composite_id = id();
    let (old_child, new_child) = (id(), id());
    apply_replicated(
        &db,
        ReplicatedKind::Create,
        replicated(&composite_id, "before", Some(100), 0, &[&old_child]),
    )
    .await
    .unwrap();

    let write = apply_replicated(
        &db,
        ReplicatedKind::Create,
        replicated(&composite_id, "after", Some(200), 0, &[&new_child]),
    )
    .await
    .unwrap();

    assert_eq!(
        write,
        ReplicaWrite::Replace {
            evaluation_generation: 1
        }
    );
    let stored = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    assert_eq!(stored.definition.name, "after");
    assert_eq!(stored.definition.updated_at, Some(200));
    assert_eq!(stored.definition.evaluation_generation, 1);
    assert_eq!(child_ids(&stored), vec![new_child.as_str()]);
}

/// R4: only a strictly newer `updated_at` replaces the row, and the generation is the local one.
#[tokio::test]
async fn a_replicated_update_applies_only_when_strictly_newer() {
    let db = db().await;
    let composite_id = id();
    let (old_child, new_child) = (id(), id());
    apply_replicated(
        &db,
        ReplicatedKind::Create,
        replicated(&composite_id, "before", Some(100), 0, &[&old_child]),
    )
    .await
    .unwrap();
    for _ in 0..3 {
        increment_evaluation_generation(&db, ORG, &composite_id)
            .await
            .unwrap();
    }
    let before = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();

    for not_newer in [Some(100), Some(99), None] {
        let write = apply_replicated(
            &db,
            ReplicatedKind::Update,
            replicated(&composite_id, "stale", not_newer, 50, &[&new_child]),
        )
        .await
        .unwrap();
        assert_eq!(write, ReplicaWrite::Skip, "incoming {not_newer:?}");
        assert_eq!(
            get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap(),
            before
        );
    }

    let write = apply_replicated(
        &db,
        ReplicatedKind::Update,
        replicated(&composite_id, "after", Some(101), 50, &[&new_child]),
    )
    .await
    .unwrap();
    assert_eq!(
        write,
        ReplicaWrite::Replace {
            evaluation_generation: 4
        }
    );
    let stored = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    assert_eq!(stored.definition.name, "after");
    assert_eq!(stored.definition.updated_at, Some(101));
    assert_eq!(stored.definition.evaluation_generation, 4);
    assert_eq!(child_ids(&stored), vec![new_child.as_str()]);
}

/// R4: a delete wins over a late update.
#[tokio::test]
async fn a_replicated_update_of_an_absent_id_writes_nothing() {
    let db = db().await;
    let composite_id = id();

    let write = apply_replicated(
        &db,
        ReplicatedKind::Update,
        replicated(&composite_id, "late", Some(100), 0, &[&id()]),
    )
    .await
    .unwrap();

    assert_eq!(write, ReplicaWrite::Skip);
    assert!(get_by_id(&db, ORG, &composite_id).await.unwrap().is_none());
    assert!(
        alert_composite_children::Entity::find()
            .all(&db)
            .await
            .unwrap()
            .is_empty()
    );
}

/// The `[strong]` promise of `apply_replicated`: a failed apply leaves the row as it was.
#[tokio::test]
async fn a_failed_replicated_update_changes_nothing() {
    let db = db().await;
    let composite_id = id();
    apply_replicated(
        &db,
        ReplicatedKind::Create,
        replicated(&composite_id, "before", Some(100), 0, &[&id(), &id()]),
    )
    .await
    .unwrap();
    let before = get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap();
    let duplicate = id();

    let result = apply_replicated(
        &db,
        ReplicatedKind::Update,
        replicated(
            &composite_id,
            "must-not-commit",
            Some(200),
            0,
            &[&duplicate, &duplicate],
        ),
    )
    .await;

    assert!(result.is_err());
    assert_eq!(
        get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap(),
        before
    );
}

/// R5: a replicated delete removes the definition with its children, and an absent id is fine.
#[tokio::test]
async fn deleting_removes_the_definition_with_its_children_and_tolerates_absence() {
    let db = db().await;
    let composite_id = id();
    apply_replicated(
        &db,
        ReplicatedKind::Create,
        replicated(&composite_id, "doomed", Some(100), 0, &[&id(), &id()]),
    )
    .await
    .unwrap();

    delete_by_id(&db, ORG, &composite_id).await.unwrap();
    assert!(get_by_id(&db, ORG, &composite_id).await.unwrap().is_none());
    assert!(
        alert_composite_children::Entity::find()
            .all(&db)
            .await
            .unwrap()
            .is_empty()
    );
    delete_by_id(&db, ORG, &composite_id).await.unwrap();
}

/// R2: enable, disable and move stamp the `updated_at` the origin passes and bump the generation.
#[tokio::test]
async fn enabling_and_moving_stamp_updated_at_and_bump_the_generation() {
    let db = db().await;
    let composite_id = id();
    let child_id = id();
    apply_replicated(
        &db,
        ReplicatedKind::Create,
        replicated(&composite_id, "stamped", Some(100), 0, &[&child_id]),
    )
    .await
    .unwrap();

    let disabled = set_enabled(&db, ORG, &composite_id, false, 500)
        .await
        .unwrap()
        .unwrap();
    assert!(!disabled.definition.enabled);
    assert_eq!(disabled.definition.updated_at, Some(500));
    assert_eq!(disabled.definition.evaluation_generation, 1);
    assert_eq!(child_ids(&disabled), vec![child_id.as_str()]);

    let moved = move_to_folder(&db, ORG, &composite_id, "folder-b", "editor@acme.com", 600)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(moved.definition.folder_id, "folder-b");
    assert_eq!(
        moved.definition.last_edited_by.as_deref(),
        Some("editor@acme.com")
    );
    assert_eq!(moved.definition.updated_at, Some(600));
    assert_eq!(moved.definition.evaluation_generation, 2);
    assert_eq!(
        get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap(),
        moved
    );

    assert!(
        set_enabled(&db, OTHER_ORG, &composite_id, true, 700)
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        move_to_folder(&db, ORG, &id(), "folder-b", "editor@acme.com", 700)
            .await
            .unwrap()
            .is_none()
    );
    assert_eq!(
        get_by_id(&db, ORG, &composite_id).await.unwrap().unwrap(),
        moved
    );
}
