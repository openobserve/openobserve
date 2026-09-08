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

//! Derived reference index: which browser checks embed which, and how many times.

use std::collections::HashMap;

use config::meta::synthetics::{BrowserConfig, SyntheticType};
use sea_orm::{
    ActiveValue::Set, ColumnTrait, ConnectionTrait, EntityTrait, QueryFilter, QueryOrder,
};

use super::entity::{
    synthetics_checks,
    synthetics_refs::{ActiveModel, Column, Entity},
};

/// A referencing check, as the delete guard and "used by" surfaces name it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParentRef {
    pub id: String,
    pub name: String,
    pub folder_id: String,
}

/// Delete-all-and-reinsert; callers run it inside the definition's transaction.
pub async fn replace_for_parent<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    parent_id: &str,
    refs: &[String],
) -> Result<(), sea_orm::DbErr> {
    Entity::delete_many()
        .filter(Column::ParentId.eq(parent_id))
        .exec(conn)
        .await?;
    let mut occurrences: HashMap<&str, i32> = HashMap::new();
    for child in refs {
        *occurrences.entry(child.as_str()).or_default() += 1;
    }
    if occurrences.is_empty() {
        return Ok(());
    }
    let rows = occurrences.into_iter().map(|(child_id, n)| ActiveModel {
        parent_id: Set(parent_id.to_owned()),
        child_id: Set(child_id.to_owned()),
        org_id: Set(org_id.to_owned()),
        occurrences: Set(n),
    });
    Entity::insert_many(rows).exec(conn).await?;
    Ok(())
}

pub async fn list_parents<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    child_id: &str,
) -> Result<Vec<ParentRef>, sea_orm::DbErr> {
    let grouped = list_parents_for_many(conn, org_id, &[child_id.to_owned()]).await?;
    Ok(grouped.into_values().next().unwrap_or_default())
}

pub async fn list_parents_for_many<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    child_ids: &[String],
) -> Result<HashMap<String, Vec<ParentRef>>, sea_orm::DbErr> {
    let mut grouped: HashMap<String, Vec<ParentRef>> = HashMap::new();
    if child_ids.is_empty() {
        return Ok(grouped);
    }
    let links = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ChildId.is_in(child_ids.iter().cloned()))
        .all(conn)
        .await?;
    if links.is_empty() {
        return Ok(grouped);
    }
    let parents: HashMap<String, synthetics_checks::Model> = synthetics_checks::Entity::find()
        .filter(synthetics_checks::Column::OrgId.eq(org_id))
        .filter(synthetics_checks::Column::Id.is_in(links.iter().map(|l| l.parent_id.clone())))
        .order_by_asc(synthetics_checks::Column::Name)
        .all(conn)
        .await?
        .into_iter()
        .map(|m| (m.id.clone(), m))
        .collect();
    for link in links {
        if let Some(parent) = parents.get(&link.parent_id) {
            grouped.entry(link.child_id).or_default().push(ParentRef {
                id: parent.id.clone(),
                name: parent.name.clone(),
                folder_id: parent.folder_id.clone(),
            });
        }
    }
    for list in grouped.values_mut() {
        list.sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    }
    Ok(grouped)
}

pub async fn refs_for_parents<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    parent_ids: &[String],
) -> Result<HashMap<String, Vec<String>>, sea_orm::DbErr> {
    let mut grouped: HashMap<String, Vec<String>> = HashMap::new();
    if parent_ids.is_empty() {
        return Ok(grouped);
    }
    let rows = Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::ParentId.is_in(parent_ids.iter().cloned()))
        .order_by_asc(Column::ChildId)
        .all(conn)
        .await?;
    for row in rows {
        let entry = grouped.entry(row.parent_id).or_default();
        for _ in 0..row.occurrences.max(0) {
            entry.push(row.child_id.clone());
        }
    }
    Ok(grouped)
}

/// Stored step count per child, counted in the DATABASE (§5.5.2); absent ids are absent from the
/// map.
///
/// The count is a JSON length rather than a fetch-and-parse because this runs on the
/// scheduler's 5 s tick: a stored journey may be up to `MAX_STEPS_JSON_BYTES` (256 KB), and
/// transferring one per referenced child per tick to call `.len()` on it is the thing the
/// design's aggregate exists to avoid. Backend-specific SQL follows the
/// `increment_evaluation_generation` precedent in `alert_composites.rs:305-351`.
pub async fn child_step_counts<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    child_ids: &[String],
) -> Result<HashMap<String, usize>, sea_orm::DbErr> {
    if child_ids.is_empty() {
        return Ok(HashMap::new());
    }
    let backend = conn.get_database_backend();
    // `config` is `jsonb` on Postgres and TEXT-backed JSON elsewhere, so the length
    // function differs; MySQL and SQLite share `json_array_length`.
    let length_expr = match backend {
        sea_orm::DatabaseBackend::Postgres => "jsonb_array_length(config->'steps')",
        _ => "json_array_length(json_extract(config, '$.steps'))",
    };
    let placeholders: Vec<String> = (0..child_ids.len())
        .map(|i| match backend {
            sea_orm::DatabaseBackend::Postgres => format!("${}", i + 2),
            _ => "?".to_string(),
        })
        .collect();
    let org_placeholder = match backend {
        sea_orm::DatabaseBackend::Postgres => "$1".to_string(),
        _ => "?".to_string(),
    };
    let sql = format!(
        "SELECT id, COALESCE({length_expr}, 0) AS step_count FROM synthetics \
         WHERE org_id = {org_placeholder} AND id IN ({})",
        placeholders.join(", ")
    );
    let mut values: Vec<sea_orm::Value> = Vec::with_capacity(child_ids.len() + 1);
    values.push(org_id.into());
    values.extend(child_ids.iter().map(|id| id.as_str().into()));
    let rows = conn
        .query_all(sea_orm::Statement::from_sql_and_values(
            backend, &sql, values,
        ))
        .await?;
    let mut counts = HashMap::with_capacity(rows.len());
    for row in rows {
        let id: String = row.try_get("", "id")?;
        // Postgres returns int4, SQLite/MySQL an integer; read the widest and clamp.
        let count: i64 = row.try_get("", "step_count").unwrap_or(0);
        counts.insert(id, usize::try_from(count.max(0)).unwrap_or(0));
    }
    Ok(counts)
}

/// The child ids a check's stored journey references, in order and with multiplicity.
pub fn refs_of(check: &config::meta::synthetics::Synthetic) -> Vec<String> {
    if check.check_type != SyntheticType::Browser {
        return Vec::new();
    }
    serde_json::from_value::<BrowserConfig>(check.config.clone())
        .map(|cfg| config::meta::synthetics_composition::subtest_refs(&cfg.steps))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use sea_orm::{ActiveModelTrait, ConnectOptions, ConnectionTrait, Database, Schema};

    use super::*;
    use crate::table::{entity::synthetics_checks, synthetics_checks::tests::make_model};

    /// Both tables from their entities, one connection, FKs on so the cascade is real.
    async fn db() -> sea_orm::DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        db.execute_unprepared("PRAGMA foreign_keys = ON")
            .await
            .unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        db.execute(backend.build(&schema.create_table_from_entity(synthetics_checks::Entity)))
            .await
            .unwrap();
        db.execute(backend.build(&schema.create_table_from_entity(Entity)))
            .await
            .unwrap();
        db
    }

    async fn insert_check(db: &sea_orm::DatabaseConnection, id: &str, name: &str, steps: usize) {
        let steps: Vec<serde_json::Value> = (0..steps)
            .map(|i| serde_json::json!({ "id": format!("c{i}"), "action": "navigate", "url": "https://x" }))
            .collect();
        let model = synthetics_checks::Model {
            id: id.to_string(),
            name: name.to_string(),
            config: serde_json::json!({ "steps": steps }),
            ..make_model()
        };
        let am: synthetics_checks::ActiveModel = model.into();
        am.reset_all().insert(db).await.unwrap();
    }

    #[tokio::test]
    async fn replace_writes_occurrences_and_drops_stale_rows() {
        let db = db().await;
        insert_check(&db, "p", "parent", 4).await;
        insert_check(&db, "a", "login", 13).await;
        insert_check(&db, "b", "goto", 3).await;

        replace_for_parent(&db, "org1", "p", &["a".into(), "b".into(), "b".into()])
            .await
            .unwrap();
        let refs = refs_for_parents(&db, "org1", &["p".into()]).await.unwrap();
        assert_eq!(refs["p"], vec!["a", "b", "b"]);

        replace_for_parent(&db, "org1", "p", &["a".into()])
            .await
            .unwrap();
        let refs = refs_for_parents(&db, "org1", &["p".into()]).await.unwrap();
        assert_eq!(refs["p"], vec!["a"]);

        replace_for_parent(&db, "org1", "p", &[]).await.unwrap();
        assert!(
            refs_for_parents(&db, "org1", &["p".into()])
                .await
                .unwrap()
                .is_empty()
        );
    }

    #[tokio::test]
    async fn deleting_the_parent_row_cascades_to_its_refs() {
        let db = db().await;
        insert_check(&db, "p", "parent", 4).await;
        insert_check(&db, "a", "login", 13).await;
        replace_for_parent(&db, "org1", "p", &["a".into()])
            .await
            .unwrap();
        synthetics_checks::Entity::delete_by_id("p")
            .exec(&db)
            .await
            .unwrap();
        assert!(list_parents(&db, "org1", "a").await.unwrap().is_empty());
    }

    /// 04's checklist: "refs rows and their check row commit or roll back together."
    ///
    /// Forces the refs write to fail by dropping only that table, then asserts the check row
    /// the same transaction inserted is gone too. Without a shared transaction the check
    /// would survive and the index would silently disagree with the config.
    #[tokio::test]
    async fn a_failed_refs_write_rolls_the_check_back_with_it() {
        use config::meta::synthetics::{Synthetic, SyntheticType};

        let db = db().await;
        insert_check(&db, "a", "login", 13).await;
        db.execute_unprepared("DROP TABLE synthetics_refs")
            .await
            .unwrap();

        let parent = Synthetic {
            id: "p".into(),
            org_id: "org1".into(),
            name: "checkout".into(),
            check_type: SyntheticType::Browser,
            config: serde_json::json!({
                "steps": [ { "id": "r0", "action": "subtest", "subtest": { "id": "a" } } ]
            }),
            ..Synthetic::default()
        };
        let err = crate::table::synthetics_checks::create(&db, "org1", parent, true).await;
        assert!(err.is_err(), "the missing refs table must fail the write");
        assert!(
            crate::table::synthetics_checks::get(&db, "org1", "p")
                .await
                .unwrap()
                .is_none(),
            "the check row must not survive a failed refs write"
        );
    }

    #[tokio::test]
    async fn parents_are_listed_with_name_and_folder_and_scoped_by_org() {
        let db = db().await;
        insert_check(&db, "p1", "checkout", 4).await;
        insert_check(&db, "p2", "logs", 4).await;
        insert_check(&db, "a", "login", 13).await;
        replace_for_parent(&db, "org1", "p1", &["a".into()])
            .await
            .unwrap();
        replace_for_parent(&db, "org1", "p2", &["a".into(), "a".into()])
            .await
            .unwrap();

        let parents = list_parents(&db, "org1", "a").await.unwrap();
        let names: Vec<&str> = parents.iter().map(|p| p.name.as_str()).collect();
        assert_eq!(names, ["checkout", "logs"]);
        assert_eq!(parents[0].folder_id, make_model().folder_id);
        assert!(
            list_parents(&db, "other-org", "a")
                .await
                .unwrap()
                .is_empty()
        );

        let many = list_parents_for_many(&db, "org1", &["a".into(), "zzz".into()])
            .await
            .unwrap();
        assert_eq!(many["a"].len(), 2);
        assert!(!many.contains_key("zzz"));
    }

    #[tokio::test]
    async fn child_step_counts_read_the_stored_journey_length() {
        let db = db().await;
        insert_check(&db, "a", "login", 13).await;
        insert_check(&db, "b", "goto", 3).await;
        let counts = child_step_counts(&db, "org1", &["a".into(), "b".into(), "nope".into()])
            .await
            .unwrap();
        assert_eq!(counts.get("a"), Some(&13));
        assert_eq!(counts.get("b"), Some(&3));
        assert!(!counts.contains_key("nope"));
    }
}
