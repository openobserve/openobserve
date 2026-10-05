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

//! RUM Product Analytics named events and saved funnels.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DbBackend, DbErr, EntityTrait, IntoActiveModel,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, Set, Statement, TransactionTrait,
    sea_query::{Expr, OnConflict},
};

use super::entity::{rum_pa_funnels, rum_pa_named_events, rum_pa_tombstones};
pub use super::entity::{
    rum_pa_funnels::Model as FunnelRow, rum_pa_named_events::Model as NamedEventRow,
};
use crate::db::get_orm_client_rw;

/// Most named events, and separately most saved funnels, one app may hold.
pub const MAX_PER_APP: u64 = 50;
/// In UTF-16 units, as the web's `.length` counts them.
pub const MAX_NAME_LENGTH: usize = 80;
/// The `name_key` column is `varchar(128)`, which Postgres counts in characters.
pub const MAX_NAME_KEY_CHARS: usize = 128;
/// Passes of a replicated upsert whose insert lost a race to a same-id row committed meanwhile.
const UPSERT_PASSES: u32 = 3;

/// The row fields replication and conflict handling read on both tables.
pub trait PaRow: Clone + Send + Sync {
    fn id(&self) -> &str;
    fn org_id(&self) -> &str;
    fn app(&self) -> &str;
    fn name(&self) -> &str;
    fn version(&self) -> i32;
    fn updated_at(&self) -> i64;
    fn updated_by(&self) -> &str;
    fn rename(&mut self, name: String, name_key: String);
}

impl PaRow for NamedEventRow {
    fn id(&self) -> &str {
        &self.id
    }

    fn org_id(&self) -> &str {
        &self.org_id
    }

    fn app(&self) -> &str {
        &self.app
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn version(&self) -> i32 {
        self.version
    }

    fn updated_at(&self) -> i64 {
        self.updated_at
    }

    fn updated_by(&self) -> &str {
        &self.updated_by
    }

    fn rename(&mut self, name: String, name_key: String) {
        self.name = name;
        self.name_key = name_key;
    }
}

impl PaRow for FunnelRow {
    fn id(&self) -> &str {
        &self.id
    }

    fn org_id(&self) -> &str {
        &self.org_id
    }

    fn app(&self) -> &str {
        &self.app
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn version(&self) -> i32 {
        self.version
    }

    fn updated_at(&self) -> i64 {
        self.updated_at
    }

    fn updated_by(&self) -> &str {
        &self.updated_by
    }

    fn rename(&mut self, name: String, name_key: String) {
        self.name = name;
        self.name_key = name_key;
    }
}

/// One of the two tables, with the columns they share.
pub trait PaTable: EntityTrait<Model = Self::Row> {
    type Row: PaRow
        + sea_orm::FromQueryResult
        + sea_orm::ModelTrait<Entity = Self>
        + IntoActiveModel<Self::Active>;
    type Active: ActiveModelTrait<Entity = Self> + Send;
    /// The tombstone kind, which is also the replication key's table segment.
    const KIND: &'static str;
    const ID: Self::Column;
    const ORG_ID: Self::Column;
    const APP: Self::Column;
    const NAME_KEY: Self::Column;
    const VERSION: Self::Column;
    const UPDATED_AT: Self::Column;
}

impl PaTable for rum_pa_named_events::Entity {
    type Row = NamedEventRow;
    type Active = rum_pa_named_events::ActiveModel;
    const KIND: &'static str = "named_events";
    const ID: Self::Column = rum_pa_named_events::Column::Id;
    const ORG_ID: Self::Column = rum_pa_named_events::Column::OrgId;
    const APP: Self::Column = rum_pa_named_events::Column::App;
    const NAME_KEY: Self::Column = rum_pa_named_events::Column::NameKey;
    const VERSION: Self::Column = rum_pa_named_events::Column::Version;
    const UPDATED_AT: Self::Column = rum_pa_named_events::Column::UpdatedAt;
}

impl PaTable for rum_pa_funnels::Entity {
    type Row = FunnelRow;
    type Active = rum_pa_funnels::ActiveModel;
    const KIND: &'static str = "funnels";
    const ID: Self::Column = rum_pa_funnels::Column::Id;
    const ORG_ID: Self::Column = rum_pa_funnels::Column::OrgId;
    const APP: Self::Column = rum_pa_funnels::Column::App;
    const NAME_KEY: Self::Column = rum_pa_funnels::Column::NameKey;
    const VERSION: Self::Column = rum_pa_funnels::Column::Version;
    const UPDATED_AT: Self::Column = rum_pa_funnels::Column::UpdatedAt;
}

pub type NamedEvents = rum_pa_named_events::Entity;
pub type Funnels = rum_pa_funnels::Entity;
type Tombstones = rum_pa_tombstones::Entity;

/// What a replicated upsert did on this replica.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Applied {
    Written,
    /// The stored row or its tombstone is at least as new, so the message changed nothing.
    Stale,
    /// Written, after one side of a name clash was renamed to the given name.
    Renamed {
        id: String,
        name: String,
    },
    /// Not written: the id is stored under another app, and an app never changes.
    OtherApp,
}

/// The case- and space-insensitive form names are unique by.
pub fn name_key(name: &str) -> String {
    name.trim().to_lowercase()
}

/// A trimmed name within the length the web allows whose lowercase form fits `name_key`.
pub fn name_fits(name: &str) -> bool {
    let units = name.encode_utf16().count();
    units > 0 && units <= MAX_NAME_LENGTH && name_key(name).chars().count() <= MAX_NAME_KEY_CHARS
}

pub async fn list<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    app: &str,
) -> Result<Vec<T::Row>, DbErr> {
    T::find()
        .filter(T::ORG_ID.eq(org_id))
        .filter(T::APP.eq(app))
        .order_by_asc(T::NAME_KEY)
        .all(db)
        .await
}

pub async fn get<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    app: &str,
    id: &str,
) -> Result<Option<T::Row>, DbErr> {
    T::find()
        .filter(T::ORG_ID.eq(org_id))
        .filter(T::APP.eq(app))
        .filter(T::ID.eq(id))
        .one(db)
        .await
}

/// The row locked `FOR UPDATE`; a no-op lock on SQLite, whose writer is already exclusive.
pub async fn get_for_update<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    app: &str,
    id: &str,
) -> Result<Option<T::Row>, DbErr> {
    T::find()
        .filter(T::ORG_ID.eq(org_id))
        .filter(T::APP.eq(app))
        .filter(T::ID.eq(id))
        .lock_exclusive()
        .one(db)
        .await
}

/// Locks every row of the app in id order, so concurrent creates queue behind each other.
pub async fn lock_app_ordered<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    app: &str,
) -> Result<Vec<T::Row>, DbErr> {
    T::find()
        .filter(T::ORG_ID.eq(org_id))
        .filter(T::APP.eq(app))
        .order_by_asc(T::ID)
        .lock_exclusive()
        .all(db)
        .await
}

pub async fn count<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    app: &str,
) -> Result<u64, DbErr> {
    T::find()
        .filter(T::ORG_ID.eq(org_id))
        .filter(T::APP.eq(app))
        .count(db)
        .await
}

/// The named events among `ids` that exist, locked `FOR SHARE` in id order.
pub async fn lock_events_ordered<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    app: &str,
    ids: &[String],
) -> Result<Vec<NamedEventRow>, DbErr> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    NamedEvents::find()
        .filter(rum_pa_named_events::Column::OrgId.eq(org_id))
        .filter(rum_pa_named_events::Column::App.eq(app))
        .filter(rum_pa_named_events::Column::Id.is_in(ids.iter().cloned()))
        .order_by_asc(rum_pa_named_events::Column::Id)
        .lock_shared()
        .all(db)
        .await
}

pub async fn insert<T: PaTable, C: ConnectionTrait>(db: &C, row: T::Row) -> Result<(), DbErr> {
    T::insert(row.into_active_model())
        .exec_without_returning(db)
        .await
        .map(|_| ())
}

/// Replaces the row only while it is still at `expected`; returns the rows changed, 0 or 1.
pub async fn update_if_version<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    app: &str,
    id: &str,
    expected: i32,
    row: T::Row,
) -> Result<u64, DbErr> {
    T::update_many()
        .set(row.into_active_model().reset_all())
        .filter(T::ORG_ID.eq(org_id))
        .filter(T::APP.eq(app))
        .filter(T::ID.eq(id))
        .filter(T::VERSION.eq(expected))
        .exec(db)
        .await
        .map(|res| res.rows_affected)
}

/// Deletes the row and tombstones it at `version`, so a late replicated put cannot restore it.
pub async fn delete<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    app: &str,
    id: &str,
    version: i32,
) -> Result<bool, DbErr> {
    let deleted = T::delete_many()
        .filter(T::ORG_ID.eq(org_id))
        .filter(T::APP.eq(app))
        .filter(T::ID.eq(id))
        .exec(db)
        .await?
        .rows_affected
        > 0;
    if deleted {
        record_tombstone::<T, _>(db, org_id, id, version).await?;
    }
    Ok(deleted)
}

/// Creates the tables if absent; for tests, since the migrator replays the whole history.
#[cfg(any(test, feature = "test-utils"))]
pub async fn create_tables_for_tests(db: &sea_orm::DatabaseConnection) -> Result<(), DbErr> {
    super::migration::create_rum_pa_tables(db).await
}

/// Removes both tables' rows for an org in one transaction.
pub async fn delete_by_org(org_id: &str) -> Result<(), DbErr> {
    apply_delete_org(get_orm_client_rw().await, org_id).await
}

/// Writes a replicated row unless a newer edit or delete is stored; name clashes rename the loser.
pub async fn apply_upsert<T: PaTable, C: ConnectionTrait + TransactionTrait>(
    db: &C,
    app: &str,
    mut row: T::Row,
) -> Result<Applied, DbErr> {
    let name = row.name().to_string();
    row.rename(name.clone(), name_key(&name));
    for _ in 0..UPSERT_PASSES {
        if let Some(applied) = upsert_once::<T, _>(db, app, row.clone()).await? {
            return Ok(applied);
        }
    }
    Err(DbErr::Custom(format!(
        "rum_pa {}: a concurrent insert of the same id won {UPSERT_PASSES} times",
        row.id()
    )))
}

/// Deletes the row only while it is at or below `version`, so a newer edit made elsewhere survives.
pub async fn apply_delete<T: PaTable, C: ConnectionTrait + TransactionTrait>(
    db: &C,
    org_id: &str,
    id: &str,
    version: i32,
) -> Result<bool, DbErr> {
    let txn = db.begin().await?;
    lock_id::<T, _>(&txn, id).await?;
    let deleted = T::delete_many()
        .filter(T::ORG_ID.eq(org_id))
        .filter(T::ID.eq(id))
        .filter(T::VERSION.lte(version))
        .exec(&txn)
        .await?
        .rows_affected
        > 0;
    record_tombstone::<T, _>(&txn, org_id, id, version).await?;
    txn.commit().await?;
    Ok(deleted)
}

pub async fn apply_delete_org<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    org_id: &str,
) -> Result<(), DbErr> {
    let txn = db.begin().await?;
    Funnels::delete_many()
        .filter(rum_pa_funnels::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    NamedEvents::delete_many()
        .filter(rum_pa_named_events::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    Tombstones::delete_many()
        .filter(rum_pa_tombstones::Column::OrgId.eq(org_id))
        .exec(&txn)
        .await?;
    txn.commit().await
}

/// `None` when the insert lost to a same-id row committed meanwhile; the next pass sees it.
async fn upsert_once<T: PaTable, C: ConnectionTrait + TransactionTrait>(
    db: &C,
    app: &str,
    mut row: T::Row,
) -> Result<Option<Applied>, DbErr> {
    let org = row.org_id().to_string();
    let txn = db.begin().await?;
    lock_id::<T, _>(&txn, row.id()).await?;
    // The local create's lock order, so a replicated write and a local one never deadlock.
    let locked = lock_app_ordered::<T, _>(&txn, &org, app).await?;
    let stored = locked.into_iter().find(|s| s.id() == row.id());
    if stored.as_ref().is_some_and(|s| !newer(&row, s)) {
        return Ok(Some(Applied::Stale));
    }
    let tombstone = tombstone_version::<T, _>(&txn, &org, row.id()).await?;
    if tombstone.is_some_and(|deleted| row.version() <= deleted) {
        return Ok(Some(Applied::Stale));
    }
    let rival = T::find()
        .filter(T::ORG_ID.eq(&org))
        .filter(T::APP.eq(app))
        .filter(T::NAME_KEY.eq(name_key(row.name())))
        .filter(T::ID.ne(row.id()))
        .lock_exclusive()
        .one(&txn)
        .await?;
    let mut applied = Applied::Written;
    if let Some(mut rival) = rival {
        let loser_is_rival = (row.updated_at(), row.id()) > (rival.updated_at(), rival.id());
        let loser = if loser_is_rival { &mut rival } else { &mut row };
        let (name, key) = free_loser_name::<T, _>(&txn, app, &*loser).await?;
        loser.rename(name.clone(), key);
        applied = Applied::Renamed {
            id: loser.id().to_string(),
            name,
        };
        if loser_is_rival {
            let (rival_id, rival_version) = (rival.id().to_string(), rival.version());
            T::update_many()
                .set(rival.into_active_model().reset_all())
                .filter(T::ORG_ID.eq(&org))
                .filter(T::ID.eq(rival_id))
                .filter(T::VERSION.eq(rival_version))
                .exec(&txn)
                .await?;
        }
    }
    match stored {
        Some(stored) => {
            T::update_many()
                .set(row.into_active_model().reset_all())
                .filter(T::ORG_ID.eq(&org))
                .filter(T::ID.eq(stored.id()))
                .filter(T::VERSION.eq(stored.version()))
                .filter(T::UPDATED_AT.eq(stored.updated_at()))
                .exec(&txn)
                .await?;
        }
        None => {
            let id = row.id().to_string();
            let inserted = T::insert(row.into_active_model())
                .on_conflict(OnConflict::column(T::ID).do_nothing().to_owned())
                .exec_without_returning(&txn)
                .await?;
            if inserted == 0 {
                txn.rollback().await?;
                let holder = T::find().filter(T::ID.eq(id.as_str())).one(db).await?;
                let elsewhere = holder.is_some_and(|h| h.org_id() != org || h.app() != app);
                return Ok(elsewhere.then_some(Applied::OtherApp));
            }
        }
    }
    txn.commit().await?;
    Ok(Some(applied))
}

/// Queues the replicated writes of one id on Postgres; SQLite's single writer already does.
async fn lock_id<T: PaTable, C: ConnectionTrait>(db: &C, id: &str) -> Result<(), DbErr> {
    if db.get_database_backend() != DbBackend::Postgres {
        return Ok(());
    }
    db.execute(Statement::from_sql_and_values(
        DbBackend::Postgres,
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        [format!("rum_pa/{}/{id}", T::KIND).into()],
    ))
    .await
    .map(|_| ())
}

async fn tombstone_version<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    id: &str,
) -> Result<Option<i32>, DbErr> {
    Ok(Tombstones::find()
        .filter(rum_pa_tombstones::Column::Kind.eq(T::KIND))
        .filter(rum_pa_tombstones::Column::Id.eq(id))
        .filter(rum_pa_tombstones::Column::OrgId.eq(org_id))
        .one(db)
        .await?
        .map(|t| t.version))
}

/// Raises the tombstone to `version`; never lowers it, so an older delete arriving late is a no-op.
async fn record_tombstone<T: PaTable, C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    id: &str,
    version: i32,
) -> Result<(), DbErr> {
    use rum_pa_tombstones::Column;
    let stone = rum_pa_tombstones::ActiveModel {
        kind: Set(T::KIND.to_string()),
        id: Set(id.to_string()),
        org_id: Set(org_id.to_string()),
        version: Set(version),
        deleted_at: Set(config::utils::time::now_micros()),
    };
    Tombstones::insert(stone)
        .on_conflict(
            OnConflict::columns([Column::Kind, Column::Id])
                .update_columns([Column::Version, Column::DeletedAt])
                .action_and_where(
                    Expr::col((rum_pa_tombstones::Entity, Column::Version))
                        .lt(Expr::cust("excluded.version")),
                )
                .to_owned(),
        )
        .exec_without_returning(db)
        .await
        .map(|_| ())
}

/// Compared as bytes, not by the store's collation, so every region picks the same winner.
fn newer<R: PaRow>(incoming: &R, stored: &R) -> bool {
    (
        incoming.version(),
        incoming.updated_at(),
        incoming.updated_by().as_bytes(),
    ) > (
        stored.version(),
        stored.updated_at(),
        stored.updated_by().as_bytes(),
    )
}

/// The first loser name no other row of the app holds; the first try is the same everywhere.
async fn free_loser_name<T: PaTable, C: ConnectionTrait>(
    db: &C,
    app: &str,
    loser: &T::Row,
) -> Result<(String, String), DbErr> {
    let mut attempt = 0;
    loop {
        let name = loser_name(loser, attempt);
        let key = name_key(&name);
        let taken = T::find()
            .filter(T::ORG_ID.eq(loser.org_id()))
            .filter(T::APP.eq(app))
            .filter(T::NAME_KEY.eq(key.as_str()))
            .filter(T::ID.ne(loser.id()))
            .count(db)
            .await?;
        if taken == 0 {
            return Ok((name, key));
        }
        attempt += 1;
    }
}

/// `{name} ({id6})`, then `({id})`, then `({id} {n})`, cut until it is a valid name.
fn loser_name<R: PaRow>(row: &R, attempt: u32) -> String {
    let suffix = match attempt {
        0 => row.id().chars().take(6).collect(),
        1 => row.id().to_string(),
        n => format!("{} {n}", row.id()),
    };
    let mut stem: Vec<char> = row.name().chars().collect();
    loop {
        let base: String = stem.iter().collect();
        let name = format!("{} ({suffix})", base.trim_end())
            .trim_start()
            .to_string();
        if stem.is_empty() || name_fits(&name) {
            return name;
        }
        stem.pop();
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection};

    use super::*;

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        create_tables_for_tests(&db).await.unwrap();
        db
    }

    fn event(id: &str, app: &str, name: &str) -> NamedEventRow {
        NamedEventRow {
            id: id.into(),
            org_id: "acme".into(),
            app: app.into(),
            name: name.into(),
            name_key: name_key(name),
            rules: serde_json::json!([{"t": "view", "op": "eq", "value": "/"}]),
            version: 1,
            created_by: "a@x.io".into(),
            updated_by: "a@x.io".into(),
            created_at: 10,
            updated_at: 10,
        }
    }

    fn funnel(id: &str, name: &str) -> FunnelRow {
        FunnelRow {
            id: id.into(),
            org_id: "acme".into(),
            app: "web".into(),
            name: name.into(),
            name_key: name_key(name),
            description: None,
            definition: serde_json::json!({"s": [["p", "/"], ["p", "/a"]], "u": "sessions", "w": "session"}),
            sql: "SELECT 1".into(),
            event_ids: serde_json::json!([]),
            version: 1,
            created_by: "a@x.io".into(),
            updated_by: "a@x.io".into(),
            created_at: 10,
            updated_at: 10,
        }
    }

    fn edit(row: &NamedEventRow, version: i32, updated_at: i64, by: &str) -> NamedEventRow {
        NamedEventRow {
            version,
            updated_at,
            updated_by: by.into(),
            rules: serde_json::json!([{"t": "view", "op": "eq", "value": format!("/v{version}/{by}")}]),
            ..row.clone()
        }
    }

    async fn events(db: &DatabaseConnection, app: &str) -> Vec<NamedEventRow> {
        list::<NamedEvents, _>(db, "acme", app).await.unwrap()
    }

    #[tokio::test]
    async fn list_is_scoped_by_org_and_app_and_ordered_by_name_key() {
        let db = db().await;
        insert::<NamedEvents, _>(&db, event("e2", "web", "beta"))
            .await
            .unwrap();
        insert::<NamedEvents, _>(&db, event("e1", "web", "Alpha"))
            .await
            .unwrap();
        insert::<NamedEvents, _>(&db, event("e3", "ios", "alpha"))
            .await
            .unwrap();
        insert::<NamedEvents, _>(
            &db,
            NamedEventRow {
                org_id: "other".into(),
                ..event("e4", "web", "gamma")
            },
        )
        .await
        .unwrap();

        let names: Vec<String> = events(&db, "web")
            .await
            .into_iter()
            .map(|r| r.name)
            .collect();
        assert_eq!(names, ["Alpha", "beta"]);
        assert_eq!(
            count::<NamedEvents, _>(&db, "acme", "web").await.unwrap(),
            2
        );
        assert_eq!(
            count::<NamedEvents, _>(&db, "acme", "ios").await.unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn an_id_from_app_a_is_not_found_under_app_b() {
        let db = db().await;
        insert::<NamedEvents, _>(&db, event("e1", "web", "Signup"))
            .await
            .unwrap();
        assert!(
            get::<NamedEvents, _>(&db, "acme", "web", "e1")
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            get::<NamedEvents, _>(&db, "acme", "ios", "e1")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            get::<NamedEvents, _>(&db, "other", "web", "e1")
                .await
                .unwrap()
                .is_none()
        );
        assert!(
            !delete::<NamedEvents, _>(&db, "acme", "ios", "e1", 1)
                .await
                .unwrap()
        );
        assert!(
            Tombstones::find().all(&db).await.unwrap().is_empty(),
            "a delete that matched nothing leaves no tombstone"
        );
        let row = event("e1", "web", "Signup");
        assert_eq!(
            update_if_version::<NamedEvents, _>(&db, "acme", "ios", "e1", 1, row)
                .await
                .unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn update_if_version_changes_only_the_expected_version() {
        let db = db().await;
        let row = event("e1", "web", "Signup");
        insert::<NamedEvents, _>(&db, row.clone()).await.unwrap();
        let next = edit(&row, 2, 20, "b@x.io");
        assert_eq!(
            update_if_version::<NamedEvents, _>(&db, "acme", "web", "e1", 1, next.clone())
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            update_if_version::<NamedEvents, _>(&db, "acme", "web", "e1", 1, next)
                .await
                .unwrap(),
            0
        );
        let stored = get::<NamedEvents, _>(&db, "acme", "web", "e1")
            .await
            .unwrap()
            .unwrap();
        assert_eq!((stored.version, stored.updated_by.as_str()), (2, "b@x.io"));
    }

    #[tokio::test]
    async fn a_second_name_key_in_one_app_is_a_unique_violation() {
        let db = db().await;
        insert::<NamedEvents, _>(&db, event("e1", "web", "Signup"))
            .await
            .unwrap();
        let err = insert::<NamedEvents, _>(&db, event("e2", "web", " SIGNUP "))
            .await
            .unwrap_err();
        assert!(
            matches!(
                err.sql_err(),
                Some(sea_orm::SqlErr::UniqueConstraintViolation(_))
            ),
            "{err}"
        );
        insert::<NamedEvents, _>(&db, event("e3", "ios", "Signup"))
            .await
            .unwrap();
        insert::<Funnels, _>(&db, funnel("f1", "Signup"))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn lock_events_ordered_returns_only_existing_ids_of_the_app() {
        let db = db().await;
        insert::<NamedEvents, _>(&db, event("e2", "web", "b"))
            .await
            .unwrap();
        insert::<NamedEvents, _>(&db, event("e1", "web", "a"))
            .await
            .unwrap();
        insert::<NamedEvents, _>(&db, event("e3", "ios", "c"))
            .await
            .unwrap();
        let ids: Vec<String> = lock_events_ordered(
            &db,
            "acme",
            "web",
            &["e3".into(), "e2".into(), "gone".into(), "e1".into()],
        )
        .await
        .unwrap()
        .into_iter()
        .map(|r| r.id)
        .collect();
        assert_eq!(ids, ["e1", "e2"]);
    }

    #[tokio::test]
    async fn delete_by_org_keeps_other_orgs() {
        let db = db().await;
        insert::<NamedEvents, _>(&db, event("e1", "web", "a"))
            .await
            .unwrap();
        insert::<Funnels, _>(&db, funnel("f1", "a")).await.unwrap();
        insert::<NamedEvents, _>(
            &db,
            NamedEventRow {
                org_id: "keep".into(),
                ..event("e2", "web", "a")
            },
        )
        .await
        .unwrap();
        apply_delete_org(&db, "acme").await.unwrap();
        assert!(events(&db, "web").await.is_empty());
        assert!(
            list::<Funnels, _>(&db, "acme", "web")
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            list::<NamedEvents, _>(&db, "keep", "web")
                .await
                .unwrap()
                .len(),
            1
        );
    }

    #[tokio::test]
    async fn the_newer_version_wins_whichever_arrives_second() {
        let base = event("e1", "web", "Signup");
        let v2 = edit(&base, 2, 20, "a@x.io");
        let v3 = edit(&base, 3, 15, "a@x.io");
        for order in [[&v2, &v3], [&v3, &v2]] {
            let db = db().await;
            for row in order {
                apply_upsert::<NamedEvents, _>(&db, "web", row.clone())
                    .await
                    .unwrap();
            }
            assert_eq!(events(&db, "web").await, std::slice::from_ref(&v3));
        }
    }

    #[tokio::test]
    async fn an_older_upsert_is_ignored_and_a_repeat_keeps_one_row() {
        let db = db().await;
        let base = event("e1", "web", "Signup");
        let v2 = edit(&base, 2, 20, "a@x.io");
        assert_eq!(
            apply_upsert::<NamedEvents, _>(&db, "web", v2.clone())
                .await
                .unwrap(),
            Applied::Written
        );
        assert_eq!(
            apply_upsert::<NamedEvents, _>(&db, "web", v2.clone())
                .await
                .unwrap(),
            Applied::Stale
        );
        assert_eq!(
            apply_upsert::<NamedEvents, _>(&db, "web", base)
                .await
                .unwrap(),
            Applied::Stale
        );
        assert_eq!(events(&db, "web").await, [v2]);
    }

    #[tokio::test]
    async fn an_equal_version_breaks_the_tie_on_updated_at_then_updated_by() {
        let base = event("e1", "web", "Signup");
        let early = edit(&base, 2, 20, "z@x.io");
        let late = edit(&base, 2, 30, "a@x.io");
        let by_b = edit(&base, 2, 30, "b@x.io");
        for order in [[&early, &late, &by_b], [&by_b, &late, &early]] {
            let db = db().await;
            for row in order {
                apply_upsert::<NamedEvents, _>(&db, "web", row.clone())
                    .await
                    .unwrap();
            }
            assert_eq!(events(&db, "web").await, std::slice::from_ref(&by_b));
        }
    }

    #[tokio::test]
    async fn a_delete_below_the_stored_version_keeps_the_row() {
        let db = db().await;
        let base = event("e1", "web", "Signup");
        apply_upsert::<NamedEvents, _>(&db, "web", edit(&base, 3, 30, "a@x.io"))
            .await
            .unwrap();
        assert!(
            !apply_delete::<NamedEvents, _>(&db, "acme", "e1", 2)
                .await
                .unwrap()
        );
        assert_eq!(events(&db, "web").await.len(), 1);
        assert!(
            apply_delete::<NamedEvents, _>(&db, "acme", "e1", 3)
                .await
                .unwrap()
        );
        assert!(events(&db, "web").await.is_empty());
        assert!(
            !apply_delete::<NamedEvents, _>(&db, "acme", "absent", 9)
                .await
                .unwrap()
        );
    }

    #[tokio::test]
    async fn a_delete_that_arrives_before_its_put_keeps_the_row_away() {
        let db = db().await;
        let v1 = event("e1", "web", "Signup");
        assert!(
            !apply_delete::<NamedEvents, _>(&db, "acme", "e1", 1)
                .await
                .unwrap()
        );
        assert_eq!(
            apply_upsert::<NamedEvents, _>(&db, "web", v1.clone())
                .await
                .unwrap(),
            Applied::Stale
        );
        assert!(events(&db, "web").await.is_empty());
        let v2 = edit(&v1, 2, 20, "b@x.io");
        assert_eq!(
            apply_upsert::<NamedEvents, _>(&db, "web", v2.clone())
                .await
                .unwrap(),
            Applied::Written,
            "an edit newer than the delete survives it"
        );
        assert_eq!(events(&db, "web").await, [v2]);
    }

    #[tokio::test]
    async fn a_put_redelivered_after_its_delete_is_stale() {
        let db = db().await;
        let v2 = edit(&event("e1", "web", "Signup"), 2, 20, "a@x.io");
        apply_upsert::<NamedEvents, _>(&db, "web", v2.clone())
            .await
            .unwrap();
        assert!(
            apply_delete::<NamedEvents, _>(&db, "acme", "e1", 2)
                .await
                .unwrap()
        );
        assert!(
            !apply_delete::<NamedEvents, _>(&db, "acme", "e1", 1)
                .await
                .unwrap(),
            "an older delete never lowers the tombstone"
        );
        for redelivered in [v2.clone(), edit(&v2, 1, 10, "a@x.io")] {
            assert_eq!(
                apply_upsert::<NamedEvents, _>(&db, "web", redelivered)
                    .await
                    .unwrap(),
                Applied::Stale
            );
        }
        assert!(events(&db, "web").await.is_empty());
        let f = funnel("e1", "Signup");
        assert_eq!(
            apply_upsert::<Funnels, _>(&db, "web", f.clone())
                .await
                .unwrap(),
            Applied::Written,
            "a tombstone covers one table only"
        );
    }

    #[tokio::test]
    async fn a_local_delete_leaves_a_tombstone_and_the_list_ignores_it() {
        let db = db().await;
        let row = edit(&event("e1", "web", "Signup"), 3, 30, "a@x.io");
        insert::<NamedEvents, _>(&db, row.clone()).await.unwrap();
        insert::<NamedEvents, _>(&db, event("e2", "web", "Login"))
            .await
            .unwrap();
        assert!(
            delete::<NamedEvents, _>(&db, "acme", "web", "e1", 3)
                .await
                .unwrap()
        );
        let names: Vec<String> = events(&db, "web")
            .await
            .into_iter()
            .map(|r| r.name)
            .collect();
        assert_eq!(names, ["Login"]);
        assert_eq!(
            count::<NamedEvents, _>(&db, "acme", "web").await.unwrap(),
            1
        );
        assert_eq!(
            apply_upsert::<NamedEvents, _>(&db, "web", row)
                .await
                .unwrap(),
            Applied::Stale
        );
        insert::<NamedEvents, _>(&db, event("e3", "web", "Signup"))
            .await
            .unwrap();
        assert_eq!(events(&db, "web").await.len(), 2, "the name is free again");
    }

    #[tokio::test]
    async fn an_org_delete_purges_its_tombstones_only() {
        let db = db().await;
        apply_delete::<NamedEvents, _>(&db, "acme", "e1", 1)
            .await
            .unwrap();
        apply_delete::<Funnels, _>(&db, "acme", "f1", 1)
            .await
            .unwrap();
        apply_delete::<NamedEvents, _>(&db, "keep", "e2", 1)
            .await
            .unwrap();
        apply_delete_org(&db, "acme").await.unwrap();
        let left: Vec<(String, String)> = Tombstones::find()
            .all(&db)
            .await
            .unwrap()
            .into_iter()
            .map(|t| (t.org_id, t.id))
            .collect();
        assert_eq!(left, [("keep".to_string(), "e2".to_string())]);
    }

    #[tokio::test]
    async fn a_name_clash_renames_the_loser_the_same_way_in_either_order() {
        let a = NamedEventRow {
            updated_at: 50,
            ..event("AAAAAAAAzzzzzzzzzzzzzzzzzzz", "web", "Signup")
        };
        let b = NamedEventRow {
            updated_at: 40,
            ..event("BBBBBBBBzzzzzzzzzzzzzzzzzzz", "web", "signup")
        };
        let mut finals = Vec::new();
        for order in [[&a, &b], [&b, &a]] {
            let db = db().await;
            let mut renamed = Vec::new();
            for row in order {
                if let Applied::Renamed { id, name } =
                    apply_upsert::<NamedEvents, _>(&db, "web", row.clone())
                        .await
                        .unwrap()
                {
                    renamed.push((id, name));
                }
            }
            assert_eq!(
                renamed,
                [(b.id.clone(), "signup (BBBBBB)".to_string())],
                "the older row loses the name"
            );
            finals.push(events(&db, "web").await);
        }
        assert_eq!(finals[0], finals[1]);
        let names: Vec<&str> = finals[0].iter().map(|r| r.name.as_str()).collect();
        assert_eq!(names, ["Signup", "signup (BBBBBB)"]);
    }

    #[tokio::test]
    async fn a_loser_rename_skips_every_name_already_taken() {
        let loser_id = "BBBBBBBBzzzzzzzzzzzzzzzzzzz";
        let a = NamedEventRow {
            updated_at: 50,
            ..event("AAAAAAAAzzzzzzzzzzzzzzzzzzz", "web", "Signup")
        };
        let b = NamedEventRow {
            updated_at: 40,
            ..event(loser_id, "web", "signup")
        };
        let squatters = [
            event("CCCCCCCCzzzzzzzzzzzzzzzzzzz", "web", "SIGNUP (BBBBBB)"),
            event(
                "DDDDDDDDzzzzzzzzzzzzzzzzzzz",
                "web",
                &format!("signup ({loser_id})"),
            ),
        ];
        for order in [[&a, &b], [&b, &a]] {
            let db = db().await;
            for squatter in &squatters {
                insert::<NamedEvents, _>(&db, squatter.clone())
                    .await
                    .unwrap();
            }
            for row in order {
                apply_upsert::<NamedEvents, _>(&db, "web", row.clone())
                    .await
                    .unwrap();
            }
            let stored = get::<NamedEvents, _>(&db, "acme", "web", loser_id)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(stored.name, format!("signup ({loser_id} 2)"));
            assert_eq!(events(&db, "web").await.len(), 4);
        }
    }

    #[tokio::test]
    async fn a_loser_rename_is_shortened_to_stay_a_valid_name() {
        let long = "x".repeat(80);
        let a = NamedEventRow {
            updated_at: 50,
            ..event("AAAAAAAAzzzzzzzzzzzzzzzzzzz", "web", &long)
        };
        let b = NamedEventRow {
            updated_at: 40,
            ..event("BBBBBBBBzzzzzzzzzzzzzzzzzzz", "web", &long)
        };
        let db = db().await;
        apply_upsert::<NamedEvents, _>(&db, "web", a).await.unwrap();
        let applied = apply_upsert::<NamedEvents, _>(&db, "web", b.clone())
            .await
            .unwrap();
        let expected = format!("{} (BBBBBB)", "x".repeat(71));
        assert_eq!(
            applied,
            Applied::Renamed {
                id: b.id,
                name: expected.clone()
            }
        );
        assert!(name_fits(&expected));
    }

    #[tokio::test]
    async fn an_id_stored_under_another_app_is_left_alone() {
        let db = db().await;
        let ios = event("e1", "ios", "Signup");
        insert::<NamedEvents, _>(&db, ios.clone()).await.unwrap();
        insert::<NamedEvents, _>(&db, event("e2", "web", "signup"))
            .await
            .unwrap();
        let moved = NamedEventRow {
            app: "web".into(),
            ..edit(&ios, 2, 20, "b@x.io")
        };
        assert_eq!(
            apply_upsert::<NamedEvents, _>(&db, "web", moved)
                .await
                .unwrap(),
            Applied::OtherApp
        );
        assert_eq!(events(&db, "ios").await, [ios]);
        let web: Vec<String> = events(&db, "web")
            .await
            .into_iter()
            .map(|r| r.name)
            .collect();
        assert_eq!(web, ["signup"], "the rival rename was rolled back");
    }
}
