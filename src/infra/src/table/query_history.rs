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

use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DbBackend, EntityTrait, FromQueryResult,
    PaginatorTrait, QueryFilter, QueryOrder, QuerySelect, QueryTrait, Set, Statement,
    TransactionTrait,
    sea_query::{Expr, Func, LikeExpr, OnConflict, Query, SimpleExpr},
};

use super::entity::query_history::{ActiveModel, Column, Entity, Model};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors, orm_err,
};

/// Recording a new row prunes the user's oldest unstarred rows of that source beyond this many.
pub const MAX_UNSTARRED_PER_SOURCE: u64 = 500;
/// Starring past this many across all sources is refused; recording never stars.
pub const MAX_STARRED_PER_USER: u64 = 200;
/// Pages that record history; the handler refuses any other source.
pub const SOURCES: [&str; 5] = ["logs", "traces", "metrics", "dbm", "profiles"];
/// What v1.1.x rows and clients that send no source are.
pub const DEFAULT_SOURCE: &str = "metrics";
pub const STATUS_OK: &str = "ok";
pub const STATUS_ERROR: &str = "error";

/// Outcome of starring or unstarring an entry.
pub enum SetStarred {
    Updated(Box<Model>),
    NotFound,
    /// Starring would take the user past `MAX_STARRED_PER_USER`.
    StarredCapReached,
}

/// One run to record; repeats of the same source and key merge into one row.
pub struct NewRun<'a> {
    pub org_id: &'a str,
    pub user_email: &'a str,
    pub source: &'a str,
    pub query: &'a str,
    /// The client's merge key; `None` or empty falls back to the query text.
    pub query_key: Option<&'a str>,
    pub streams: &'a [String],
    pub status: &'a str,
    pub context: serde_json::Value,
    pub now_us: i64,
}

/// List filters; every `None` or empty field matches all rows.
#[derive(Default)]
pub struct ListFilter {
    pub sources: Vec<String>,
    pub status: Option<String>,
    /// Exact stream name.
    pub stream: Option<String>,
    /// Case-insensitive literal substring of the query or the streams.
    pub q: Option<String>,
    pub starred: Option<bool>,
    /// Inclusive bounds on `updated_at`, in microseconds.
    pub ran_from: Option<i64>,
    pub ran_to: Option<i64>,
}

/// Records a run: inserts a row, or merges into the row with the same org, user, source and key.
pub async fn record(run: NewRun<'_>) -> Result<Model, errors::Error> {
    let client = get_orm_client_rw().await;
    record_with(client, run).await
}

pub async fn record_with<C: ConnectionTrait>(
    conn: &C,
    run: NewRun<'_>,
) -> Result<Model, errors::Error> {
    let entry = ActiveModel {
        id: Set(config::ider::uuid()),
        org_id: Set(run.org_id.to_string()),
        user_email: Set(run.user_email.to_string()),
        query: Set(run.query.to_string()),
        context: Set(run.context),
        starred: Set(false),
        created_at: Set(run.now_us),
        source: Set(run.source.to_string()),
        query_key: Set(Some(query_key_hash(run.query_key, run.query))),
        streams: Set(encode_streams(run.streams)),
        run_count: Set(1),
        updated_at: Set(run.now_us),
        status: Set(run.status.to_string()),
    };
    // One statement, so concurrent identical runs merge instead of racing to insert.
    let mut stmt = Entity::insert(entry)
        .on_conflict(
            OnConflict::columns([
                Column::OrgId,
                Column::UserEmail,
                Column::Source,
                Column::QueryKey,
            ])
            .value(
                Column::RunCount,
                Expr::col((Entity, Column::RunCount)).add(1),
            )
            .update_columns([Column::UpdatedAt, Column::Context, Column::Status])
            .to_owned(),
        )
        .into_query();
    stmt.returning(Query::returning().all());

    let Some(row) = conn
        .query_one(conn.get_database_backend().build(&stmt))
        .await?
    else {
        return orm_err!("query history upsert returned no row");
    };
    let model = Model::from_query_result(&row, "")?;
    // After the upsert has committed, so a prune also sees rows that concurrent runs inserted.
    if model.run_count == 1 {
        prune_unstarred_over_cap(conn, run.org_id, run.user_email, run.source, &model.id).await?;
    }
    Ok(model)
}

/// Lists one user's entries in one org, most recently run first.
pub async fn list(
    org_id: &str,
    user_email: &str,
    filter: &ListFilter,
    limit: u64,
    offset: u64,
) -> Result<Vec<Model>, errors::Error> {
    let client = get_orm_client_ro().await;
    list_with(client, org_id, user_email, filter, limit, offset).await
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    filter: &ListFilter,
    limit: u64,
    offset: u64,
) -> Result<Vec<Model>, errors::Error> {
    Ok(list_query(org_id, user_email, filter)
        .limit(limit)
        .offset(offset)
        .all(conn)
        .await?)
}

/// How many entries `list` would return with no limit.
pub async fn count(
    org_id: &str,
    user_email: &str,
    filter: &ListFilter,
) -> Result<u64, errors::Error> {
    let client = get_orm_client_ro().await;
    count_with(client, org_id, user_email, filter).await
}

pub async fn count_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    filter: &ListFilter,
) -> Result<u64, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(list_condition(filter))
        .count(conn)
        .await?)
}

/// Stars or unstars one of the user's entries; starring is refused at `MAX_STARRED_PER_USER`.
pub async fn set_starred(
    org_id: &str,
    user_email: &str,
    id: &str,
    starred: bool,
) -> Result<SetStarred, errors::Error> {
    let client = get_orm_client_rw().await;
    set_starred_with(client, org_id, user_email, id, starred).await
}

pub async fn set_starred_with<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    id: &str,
    starred: bool,
) -> Result<SetStarred, errors::Error> {
    let txn = conn.begin().await?;
    let users_rows = Condition::all()
        .add(Column::OrgId.eq(org_id))
        .add(Column::UserEmail.eq(user_email));
    // Only a star can pass the cap, so an unstar takes no lock.
    if starred && let Some(lock) = star_lock(txn.get_database_backend(), org_id, user_email) {
        txn.execute(lock).await?;
    }
    // MySQL rows_affected counts changed rows, so a re-star reports 0; the response needs the row.
    let Some(entry) = Entity::find()
        .filter(users_rows.clone())
        .filter(Column::Id.eq(id))
        .one(&txn)
        .await?
    else {
        return Ok(SetStarred::NotFound);
    };
    if starred && !entry.starred {
        let starred_count = Entity::find()
            .filter(users_rows)
            .filter(Column::Starred.eq(true))
            .count(&txn)
            .await?;
        if starred_count >= MAX_STARRED_PER_USER {
            return Ok(SetStarred::StarredCapReached);
        }
    }
    Entity::update_many()
        .col_expr(Column::Starred, Expr::value(starred))
        .filter(Column::Id.eq(id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(SetStarred::Updated(Box::new(Model { starred, ..entry })))
}

/// Deletes one of the user's entries in the org; false when it is not theirs or does not exist.
pub async fn delete(org_id: &str, user_email: &str, id: &str) -> Result<bool, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_with(client, org_id, user_email, id).await
}

pub async fn delete_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    id: &str,
) -> Result<bool, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(Column::Id.eq(id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected > 0)
}

/// Deletes the user's entries in the org for `sources` (all when empty); starred only on request.
pub async fn clear(
    org_id: &str,
    user_email: &str,
    sources: &[String],
    include_starred: bool,
) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    clear_with(client, org_id, user_email, sources, include_starred).await
}

pub async fn clear_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    sources: &[String],
    include_starred: bool,
) -> Result<u64, errors::Error> {
    let mut delete = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email));
    if !sources.is_empty() {
        delete = delete.filter(Column::Source.is_in(sources.iter().cloned()));
    }
    if !include_starred {
        delete = delete.filter(Column::Starred.eq(false));
    }
    Ok(delete.exec(conn).await?.rows_affected)
}

/// Deletes unstarred entries first and last run before `cutoff_us` across every org and user.
pub async fn delete_unstarred_before(cutoff_us: i64) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_unstarred_before_with(client, cutoff_us).await
}

pub async fn delete_unstarred_before_with<C: ConnectionTrait>(
    conn: &C,
    cutoff_us: i64,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::Starred.eq(false))
        .filter(Column::UpdatedAt.lt(cutoff_us))
        // An older node in a rolling upgrade writes rows with updated_at = 0.
        .filter(Column::CreatedAt.lt(cutoff_us))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_org(org_id: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_org_with(client, org_id).await
}

pub async fn delete_by_org_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_user(org_id: &str, user_email: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_user_with(client, org_id, user_email).await
}

pub async fn delete_by_user_with<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

pub async fn delete_by_email(user_email: &str) -> Result<u64, errors::Error> {
    let client = get_orm_client_rw().await;
    delete_by_email_with(client, user_email).await
}

pub async fn delete_by_email_with<C: ConnectionTrait>(
    conn: &C,
    user_email: &str,
) -> Result<u64, errors::Error> {
    let res = Entity::delete_many()
        .filter(Column::UserEmail.eq(user_email))
        .exec(conn)
        .await?;
    Ok(res.rows_affected)
}

/// Splits the stored `,a,b,` form back into stream names.
pub fn decode_streams(streams: &str) -> Vec<String> {
    streams
        .split(',')
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// Creates the table as the migrations leave it; for tests, since the migrator replays everything.
#[cfg(any(test, feature = "test-utils"))]
pub async fn create_table_for_tests(
    db: &sea_orm::DatabaseConnection,
) -> Result<(), sea_orm::DbErr> {
    super::migration::create_query_history_table(db).await
}

/// Comma-wrapped so `LIKE '%,name,%'` matches whole stream names only.
fn encode_streams(streams: &[String]) -> String {
    if streams.is_empty() {
        return String::new();
    }
    format!(",{},", streams.join(","))
}

fn query_key_hash(query_key: Option<&str>, query: &str) -> String {
    sha256::digest(query_key.filter(|k| !k.is_empty()).unwrap_or(query))
}

fn list_condition(filter: &ListFilter) -> Condition {
    let mut cond = Condition::all();
    if !filter.sources.is_empty() {
        cond = cond.add(Column::Source.is_in(filter.sources.iter().cloned()));
    }
    if let Some(status) = &filter.status {
        cond = cond.add(Column::Status.eq(status.as_str()));
    }
    if let Some(stream) = filter.stream.as_deref().filter(|s| !s.is_empty()) {
        let pattern = format!("%,{},%", escape_like(stream));
        cond = cond.add(Expr::col(Column::Streams).like(LikeExpr::new(pattern).escape('\\')));
    }
    if let Some(q) = filter.q.as_deref().filter(|q| !q.is_empty()) {
        cond = cond.add(
            Condition::any()
                .add(contains_lowered(Column::Query, q))
                .add(contains_lowered(Column::Streams, q)),
        );
    }
    if let Some(starred) = filter.starred {
        cond = cond.add(Column::Starred.eq(starred));
    }
    if let Some(from) = filter.ran_from {
        cond = cond.add(Column::UpdatedAt.gte(from));
    }
    if let Some(to) = filter.ran_to {
        cond = cond.add(Column::UpdatedAt.lte(to));
    }
    cond
}

/// Newest first; the id breaks ties so pages never overlap.
fn list_query(org_id: &str, user_email: &str, filter: &ListFilter) -> sea_orm::Select<Entity> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::UserEmail.eq(user_email))
        .filter(list_condition(filter))
        .order_by_desc(Column::UpdatedAt)
        .order_by_desc(Column::Id)
}

/// Keeps `kept_id` and the newest other unstarred rows of `source`, up to the per-source cap.
async fn prune_unstarred_over_cap<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    user_email: &str,
    source: &str,
    kept_id: &str,
) -> Result<(), errors::Error> {
    // The run just recorded survives a timestamp tie or a clock that stepped back.
    let unstarred = Condition::all()
        .add(Column::OrgId.eq(org_id))
        .add(Column::UserEmail.eq(user_email))
        .add(Column::Source.eq(source))
        .add(Column::Starred.eq(false))
        .add(Column::Id.ne(kept_id));
    let Some((ran_at, id)) = Entity::find()
        .filter(unstarred.clone())
        .select_only()
        .column(Column::UpdatedAt)
        .column(Column::Id)
        .order_by_desc(Column::UpdatedAt)
        .order_by_desc(Column::Id)
        .offset(MAX_UNSTARRED_PER_SOURCE - 1)
        .into_tuple::<(i64, String)>()
        .one(conn)
        .await?
    else {
        return Ok(());
    };
    let at_or_before_boundary = Condition::any().add(Column::UpdatedAt.lt(ran_at)).add(
        Condition::all()
            .add(Column::UpdatedAt.eq(ran_at))
            .add(Column::Id.lte(id)),
    );
    Entity::delete_many()
        .filter(unstarred)
        .filter(at_or_before_boundary)
        .exec(conn)
        .await?;
    Ok(())
}

/// Serializes one user's stars in an org, so the starred count below cannot go stale.
fn star_lock(backend: DbBackend, org_id: &str, user_email: &str) -> Option<Statement> {
    match backend {
        DbBackend::Postgres => Some(Statement::from_sql_and_values(
            backend,
            "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
            [format!("query_history_star/{org_id}/{user_email}").into()],
        )),
        // MySQL has no transaction-scoped named lock, so it row-locks the user's rows instead.
        DbBackend::MySql => Some(Statement::from_sql_and_values(
            backend,
            "SELECT COUNT(*) FROM query_history WHERE org_id = ? AND user_email = ? FOR UPDATE",
            [org_id.into(), user_email.into()],
        )),
        // SQLite serializes every write transaction already.
        DbBackend::Sqlite => None,
    }
}

/// Case-insensitive literal substring match: `%`, `_` and `\` match only themselves.
fn contains_lowered(column: Column, q: &str) -> SimpleExpr {
    let pattern = format!("%{}%", escape_like(&q.to_lowercase()));
    Expr::expr(Func::lower(Expr::col(column))).like(LikeExpr::new(pattern).escape('\\'))
}

fn escape_like(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

#[cfg(test)]
mod tests {
    use sea_orm::{Database, DatabaseConnection, PaginatorTrait};
    use serde_json::json;

    use super::*;

    const A: &str = "a@x.com";
    const B: &str = "b@x.com";
    const DAY_US: i64 = 86_400 * 1_000_000;

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        create_table_for_tests(&db).await.unwrap();
        db
    }

    fn run<'a>(user: &'a str, source: &'a str, query: &'a str, now_us: i64) -> NewRun<'a> {
        NewRun {
            org_id: "default",
            user_email: user,
            source,
            query,
            query_key: None,
            streams: &[],
            status: STATUS_OK,
            context: json!({}),
            now_us,
        }
    }

    async fn rec(db: &DatabaseConnection, run: NewRun<'_>) -> Model {
        record_with(db, run).await.unwrap()
    }

    fn updated(outcome: SetStarred) -> Model {
        match outcome {
            SetStarred::Updated(m) => *m,
            _ => panic!("expected the entry to be updated"),
        }
    }

    async fn listed(db: &DatabaseConnection, user: &str, filter: ListFilter) -> Vec<Model> {
        list_with(db, "default", user, &filter, 10_000, 0)
            .await
            .unwrap()
    }

    async fn all(db: &DatabaseConnection, user: &str) -> Vec<Model> {
        listed(db, user, ListFilter::default()).await
    }

    fn queries(rows: Vec<Model>) -> Vec<String> {
        rows.into_iter().map(|r| r.query).collect()
    }

    #[tokio::test]
    async fn test_same_key_merges_and_keeps_first_run_and_star() {
        let db = db().await;
        let streams = vec!["k8s".to_string()];
        let first = rec(
            &db,
            NewRun {
                query_key: Some("k8s|sql|up|"),
                streams: &streams,
                context: json!({"chart": "line"}),
                ..run(A, "logs", "up", 1)
            },
        )
        .await;
        assert_eq!(
            (first.run_count, first.created_at, first.updated_at),
            (1, 1, 1)
        );
        set_starred_with(&db, "default", A, &first.id, true)
            .await
            .unwrap();

        let again = rec(
            &db,
            NewRun {
                query_key: Some("k8s|sql|up|"),
                status: STATUS_ERROR,
                context: json!({"error": "boom"}),
                ..run(A, "logs", "up", 5)
            },
        )
        .await;
        assert_eq!(again.id, first.id);
        assert_eq!(
            (again.run_count, again.created_at, again.updated_at),
            (2, 1, 5)
        );
        assert!(again.starred, "a merge keeps the star");
        assert_eq!(again.status, STATUS_ERROR);
        assert_eq!(again.context, json!({"error": "boom"}));
        assert_eq!(again.streams, ",k8s,", "the key already holds the streams");
        assert_eq!(all(&db, A).await.len(), 1);
    }

    #[tokio::test]
    async fn test_the_same_search_on_two_days_is_one_row() {
        let db = db().await;
        let key = Some("k8s|sql|up|");
        let monday = rec(
            &db,
            NewRun {
                query_key: key,
                ..run(A, "logs", "up", DAY_US)
            },
        )
        .await;
        let later = rec(
            &db,
            NewRun {
                query_key: key,
                ..run(A, "logs", "up", 40 * DAY_US)
            },
        )
        .await;
        assert_eq!(later.id, monday.id);
        assert_eq!(
            (later.run_count, later.created_at, later.updated_at),
            (2, DAY_US, 40 * DAY_US)
        );
        assert_eq!(all(&db, A).await.len(), 1);
    }

    #[tokio::test]
    async fn test_a_merge_sets_only_run_count_updated_at_context_and_status() {
        let db = db().await;
        let k8s = vec!["k8s".to_string()];
        let other = vec!["other".to_string()];
        let first = rec(
            &db,
            NewRun {
                query_key: Some("k8s|sql|q|"),
                streams: &k8s,
                ..run(A, "logs", "SELECT 1", 1)
            },
        )
        .await;
        let merged = rec(
            &db,
            NewRun {
                query_key: Some("k8s|sql|q|"),
                streams: &other,
                status: STATUS_ERROR,
                context: json!({"error": "boom"}),
                ..run(A, "logs", "SELECT 1 -- edited", 2)
            },
        )
        .await;
        assert_eq!(merged.id, first.id);
        assert_eq!(
            (merged.run_count, merged.created_at, merged.updated_at),
            (2, 1, 2)
        );
        assert_eq!(
            (merged.status.as_str(), &merged.context),
            (STATUS_ERROR, &json!({"error": "boom"}))
        );
        assert_eq!(
            (merged.query.as_str(), merged.streams.as_str()),
            ("SELECT 1", ",k8s,"),
            "query and streams stay as inserted"
        );
    }

    #[tokio::test]
    async fn test_a_merge_on_a_later_day_leaves_every_other_column_as_first_inserted() {
        let db = db().await;
        let k8s = vec!["k8s".to_string()];
        let first = rec(
            &db,
            NewRun {
                query_key: Some("k8s|sql|q|"),
                streams: &k8s,
                context: json!({"run": 1}),
                ..run(A, "logs", "q", DAY_US)
            },
        )
        .await;
        let starred = updated(
            set_starred_with(&db, "default", A, &first.id, true)
                .await
                .unwrap(),
        );
        let merged = rec(
            &db,
            NewRun {
                query_key: Some("k8s|sql|q|"),
                streams: &[],
                status: STATUS_ERROR,
                context: json!({"run": 2}),
                ..run(A, "logs", "q edited", 3 * DAY_US)
            },
        )
        .await;
        assert_eq!(
            merged,
            Model {
                run_count: 2,
                updated_at: 3 * DAY_US,
                context: json!({"run": 2}),
                status: STATUS_ERROR.to_string(),
                ..starred
            }
        );
        assert_eq!(all(&db, A).await, vec![merged]);
    }

    #[tokio::test]
    async fn test_merge_is_per_user_per_source_and_per_key() {
        let db = db().await;
        rec(&db, run(A, "logs", "up", 1)).await;
        rec(&db, run(B, "logs", "up", 2)).await;
        rec(&db, run(A, "traces", "up", 3)).await;
        rec(
            &db,
            NewRun {
                query_key: Some("up|2026-10-28"),
                ..run(A, "logs", "up", 4)
            },
        )
        .await;
        assert_eq!(all(&db, A).await.len(), 3);
        assert_eq!(all(&db, B).await.len(), 1);
        let merged = rec(&db, run(A, "logs", "up", 5)).await;
        assert_eq!(merged.run_count, 2, "no key falls back to the query text");
    }

    #[tokio::test]
    async fn test_new_key_prunes_over_the_per_source_cap_and_keeps_starred() {
        let db = db().await;
        let starred = rec(&db, run(A, "logs", "starred", 0)).await;
        set_starred_with(&db, "default", A, &starred.id, true)
            .await
            .unwrap();
        for i in 1..=MAX_UNSTARRED_PER_SOURCE as i64 {
            rec(&db, run(A, "logs", &format!("q{i}"), i)).await;
        }
        rec(&db, run(A, "traces", "other source", 0)).await;
        rec(&db, run(B, "logs", "other user", 0)).await;
        let logs = |rows: Vec<Model>| rows.into_iter().filter(|r| r.source == "logs").count();
        assert_eq!(logs(all(&db, A).await), 501);

        rec(&db, run(A, "logs", "q1", 1_000)).await;
        assert_eq!(logs(all(&db, A).await), 501, "a merge never prunes");

        rec(&db, run(A, "logs", "q501", 1_001)).await;
        let rows = all(&db, A).await;
        assert_eq!(logs(rows.clone()), 501);
        assert!(rows.iter().all(|r| r.query != "q2"), "oldest is pruned");
        assert!(
            rows.iter().any(|r| r.query == "q1"),
            "the merge refreshed q1"
        );
        assert!(rows.iter().any(|r| r.id == starred.id && r.starred));
        assert!(rows.iter().any(|r| r.source == "traces"));
        assert_eq!(all(&db, B).await.len(), 1);
    }

    #[tokio::test]
    async fn test_cap_holds_when_timestamps_tie() {
        let db = db().await;
        for i in 0..=MAX_UNSTARRED_PER_SOURCE {
            rec(&db, run(A, "logs", &format!("q{i}"), 7)).await;
        }
        assert_eq!(all(&db, A).await.len() as u64, MAX_UNSTARRED_PER_SOURCE);
    }

    #[tokio::test]
    async fn test_reaper_uses_updated_at_and_keeps_starred() {
        let db = db().await;
        let now = 100 * DAY_US;
        let cutoff = now - 14 * DAY_US;
        let old = rec(&db, run(A, "logs", "old", now - 15 * DAY_US)).await;
        let old_starred = rec(&db, run(A, "logs", "old starred", now - 15 * DAY_US)).await;
        set_starred_with(&db, "default", A, &old_starred.id, true)
            .await
            .unwrap();
        let rerun = rec(&db, run(A, "logs", "rerun", now - 20 * DAY_US)).await;
        rec(&db, run(A, "logs", "rerun", now)).await;

        assert_eq!(delete_unstarred_before_with(&db, cutoff).await.unwrap(), 1);
        let ids: Vec<String> = all(&db, A).await.into_iter().map(|r| r.id).collect();
        assert!(!ids.contains(&old.id));
        assert!(ids.contains(&old_starred.id));
        assert!(ids.contains(&rerun.id), "a recent run keeps an old row");
    }

    async fn row_at(db: &DatabaseConnection, id: &str, created_at: i64, updated_at: i64) {
        db.execute_unprepared(&format!(
            "INSERT INTO query_history (id, org_id, user_email, query, context, created_at, \
             updated_at, source) VALUES ('{id}', 'default', '{A}', 'q {id}', '{{}}', {created_at}, \
             {updated_at}, 'logs')"
        ))
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn test_the_reaper_needs_both_runs_before_the_cutoff() {
        let db = db().await;
        row_at(&db, "stale", 50, 60).await;
        row_at(&db, "fresh", 50, 500).await;
        row_at(&db, "old-node", 500, 0).await;
        assert_eq!(delete_unstarred_before_with(&db, 100).await.unwrap(), 1);
        let mut ids: Vec<String> = all(&db, A).await.into_iter().map(|r| r.id).collect();
        ids.sort();
        assert_eq!(ids, vec!["fresh", "old-node"]);
    }

    #[tokio::test]
    async fn test_order_window_and_prune_read_updated_at_alone() {
        let db = db().await;
        for i in 1..=MAX_UNSTARRED_PER_SOURCE as i64 {
            row_at(&db, &format!("r{i:04}"), 1_000_000 - i, i * 10).await;
        }
        let rows = all(&db, A).await;
        assert_eq!(
            rows.iter()
                .take(2)
                .map(|r| r.id.as_str())
                .collect::<Vec<_>>(),
            vec!["r0500", "r0499"],
            "newest updated_at first, whatever created_at says"
        );
        let window = ListFilter {
            ran_from: Some(4_980),
            ran_to: Some(4_990),
            ..Default::default()
        };
        assert_eq!(
            listed(&db, A, window)
                .await
                .iter()
                .map(|r| r.id.as_str())
                .collect::<Vec<_>>(),
            vec!["r0499", "r0498"]
        );
        rec(&db, run(A, "logs", "new", 1)).await;
        let ids: Vec<String> = all(&db, A).await.into_iter().map(|r| r.id).collect();
        assert_eq!(ids.len() as u64, MAX_UNSTARRED_PER_SOURCE);
        assert!(
            !ids.contains(&"r0001".to_string()),
            "lowest updated_at is pruned"
        );
        assert!(ids.contains(&"r0002".to_string()));
    }

    #[tokio::test]
    async fn test_count_matches_the_list_filters() {
        let db = db().await;
        let starred = rec(&db, run(A, "logs", "a", 1)).await;
        set_starred_with(&db, "default", A, &starred.id, true)
            .await
            .unwrap();
        rec(&db, run(A, "logs", "b", 2)).await;
        rec(&db, run(A, "traces", "c", 3)).await;
        rec(&db, run(B, "logs", "d", 4)).await;
        let count = |sources: &[&str], starred: Option<bool>| ListFilter {
            sources: sources.iter().map(|s| s.to_string()).collect(),
            starred,
            ..Default::default()
        };
        assert_eq!(
            count_with(&db, "default", A, &count(&[], None))
                .await
                .unwrap(),
            3
        );
        assert_eq!(
            count_with(&db, "default", A, &count(&["logs"], None))
                .await
                .unwrap(),
            2
        );
        assert_eq!(
            count_with(&db, "default", A, &count(&["logs"], Some(false)))
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            count_with(&db, "default", A, &count(&[], Some(true)))
                .await
                .unwrap(),
            1
        );
    }

    #[tokio::test]
    async fn test_a_new_row_survives_the_cap_when_others_ran_later() {
        let db = db().await;
        for i in 0..MAX_UNSTARRED_PER_SOURCE as i64 {
            rec(&db, run(A, "logs", &format!("q{i}"), 1_000 + i)).await;
        }
        // The clock stepped back, or every row ties: the new run must still be kept.
        let new = rec(&db, run(A, "logs", "after the step back", 5)).await;
        let rows = all(&db, A).await;
        assert_eq!(rows.len() as u64, MAX_UNSTARRED_PER_SOURCE);
        assert!(rows.iter().any(|r| r.id == new.id));
        assert!(
            rows.iter().all(|r| r.query != "q0"),
            "the oldest other row is pruned"
        );

        let tie = rec(&db, run(A, "logs", "tie", 1_001)).await;
        let rows = all(&db, A).await;
        assert_eq!(rows.len() as u64, MAX_UNSTARRED_PER_SOURCE);
        assert!(rows.iter().any(|r| r.id == tie.id));
    }

    #[tokio::test]
    async fn test_list_order_is_served_by_the_updated_at_indexes_on_sqlite() {
        let db = db().await;
        for i in 0..20 {
            rec(&db, run(A, "logs", &format!("q{i}"), i)).await;
        }
        let filters = [
            ListFilter::default(),
            ListFilter {
                sources: vec!["logs".to_string()],
                ..Default::default()
            },
        ];
        for filter in filters {
            let sql = list_query("default", A, &filter)
                .limit(50)
                .build(sea_orm::DbBackend::Sqlite)
                .to_string();
            let plan: Vec<String> = db
                .query_all(sea_orm::Statement::from_string(
                    sea_orm::DbBackend::Sqlite,
                    format!("EXPLAIN QUERY PLAN {sql}"),
                ))
                .await
                .unwrap()
                .iter()
                .map(|r| r.try_get::<String>("", "detail").unwrap())
                .collect();
            let plan = plan.join(" | ");
            assert!(plan.contains("updated_at_idx"), "{plan}");
            assert!(!plan.contains("TEMP B-TREE FOR ORDER BY"), "{plan}");
        }
    }

    #[tokio::test]
    async fn test_concurrent_new_rows_keep_the_per_source_cap() {
        let db = db().await;
        for i in 0..MAX_UNSTARRED_PER_SOURCE as i64 {
            rec(&db, run(A, "logs", &format!("q{i}"), i)).await;
        }
        let queries: Vec<String> = (0..8).map(|i| format!("new{i}")).collect();
        let results = futures::future::join_all(
            queries
                .iter()
                .enumerate()
                .map(|(i, q)| record_with(&db, run(A, "logs", q, 10_000 + i as i64))),
        )
        .await;
        assert!(results.iter().all(Result::is_ok));
        assert_eq!(all(&db, A).await.len() as u64, MAX_UNSTARRED_PER_SOURCE);
    }

    #[tokio::test]
    async fn test_list_orders_by_last_run_and_filters() {
        let db = db().await;
        let k8s = vec!["k8s_logs".to_string(), "default".to_string()];
        let app = vec!["app_logs".to_string()];
        let up = rec(
            &db,
            NewRun {
                streams: &k8s,
                ..run(A, "logs", "level = 'error'", 1)
            },
        )
        .await;
        rec(
            &db,
            NewRun {
                streams: &app,
                status: STATUS_ERROR,
                ..run(A, "logs", "SELECT * FROM app", 2)
            },
        )
        .await;
        rec(&db, run(A, "traces", "service = 'cart'", 3)).await;
        rec(&db, run(A, "metrics", "rate(http_total[5m])", 4)).await;
        rec(&db, run(A, "logs", "level = 'error'", 5)).await;
        set_starred_with(&db, "default", A, &up.id, true)
            .await
            .unwrap();

        let f = |build: fn(&mut ListFilter)| {
            let mut filter = ListFilter::default();
            build(&mut filter);
            filter
        };
        assert_eq!(
            queries(all(&db, A).await),
            vec![
                "level = 'error'",
                "rate(http_total[5m])",
                "service = 'cart'",
                "SELECT * FROM app"
            ]
        );
        let by_source = f(|f| f.sources = vec!["logs".into(), "traces".into()]);
        assert_eq!(queries(listed(&db, A, by_source).await).len(), 3);
        let failed = f(|f| f.status = Some(STATUS_ERROR.into()));
        assert_eq!(
            queries(listed(&db, A, failed).await),
            vec!["SELECT * FROM app"]
        );
        let stream = f(|f| f.stream = Some("default".into()));
        assert_eq!(
            queries(listed(&db, A, stream).await),
            vec!["level = 'error'"],
            "a merge keeps the streams"
        );
        let stream = f(|f| f.stream = Some("app_logs".into()));
        assert_eq!(
            queries(listed(&db, A, stream).await),
            vec!["SELECT * FROM app"]
        );
        let partial = f(|f| f.stream = Some("app".into()));
        assert!(listed(&db, A, partial).await.is_empty(), "stream is exact");
        let q_stream = f(|f| f.q = Some("APP_LO".into()));
        assert_eq!(
            queries(listed(&db, A, q_stream).await),
            vec!["SELECT * FROM app"]
        );
        let q_query = f(|f| f.q = Some("HTTP".into()));
        assert_eq!(
            queries(listed(&db, A, q_query).await),
            vec!["rate(http_total[5m])"]
        );
        let starred = f(|f| f.starred = Some(true));
        assert_eq!(
            queries(listed(&db, A, starred).await),
            vec!["level = 'error'"]
        );
        let window = f(|f| {
            f.ran_from = Some(2);
            f.ran_to = Some(3);
        });
        assert_eq!(
            queries(listed(&db, A, window).await),
            vec!["service = 'cart'", "SELECT * FROM app"]
        );
        let page = list_with(&db, "default", A, &ListFilter::default(), 1, 1)
            .await
            .unwrap();
        assert_eq!(queries(page), vec!["rate(http_total[5m])"]);
    }

    #[tokio::test]
    async fn test_search_is_a_case_insensitive_literal_substring() {
        let db = db().await;
        for (i, query) in [
            "cpu > 50%",
            "rate(x[50m])",
            "a_b",
            "axb",
            "rate(x[5m])",
            r"a\b",
        ]
        .into_iter()
        .enumerate()
        {
            rec(&db, run(A, "metrics", query, i as i64)).await;
        }
        let search = |q: &'static str| {
            let db = &db;
            async move {
                let filter = ListFilter {
                    q: Some(q.to_string()),
                    ..Default::default()
                };
                let mut rows = queries(listed(db, A, filter).await);
                rows.sort();
                rows
            }
        };
        assert_eq!(search("50%").await, vec!["cpu > 50%"]);
        assert_eq!(search("a_b").await, vec!["a_b"]);
        assert_eq!(search(r"a\b").await, vec![r"a\b"]);
        assert_eq!(search("RATE").await, vec!["rate(x[50m])", "rate(x[5m])"]);
    }

    // Postgres LIKE is case-sensitive, so the filter must lower both sides.
    #[test]
    fn test_search_sql_lowers_and_escapes_on_postgres() {
        use sea_orm::DbBackend;
        let sql = Entity::find()
            .filter(contains_lowered(Column::Query, "50%_X"))
            .build(DbBackend::Postgres)
            .to_string();
        assert!(
            sql.contains(r#"LOWER("query") LIKE E'%50\\%\\_x%' ESCAPE E'\\'"#),
            "{sql}"
        );
    }

    #[test]
    fn test_star_lock_is_narrow_on_each_backend() {
        let pg = star_lock(DbBackend::Postgres, "default", A)
            .unwrap()
            .to_string();
        assert!(pg.contains("pg_advisory_xact_lock"), "{pg}");
        assert!(
            !pg.contains("FOR UPDATE"),
            "no rows are locked or read: {pg}"
        );
        let mysql = star_lock(DbBackend::MySql, "default", A)
            .unwrap()
            .to_string();
        assert!(
            mysql.starts_with("SELECT COUNT(*)") && mysql.ends_with("FOR UPDATE"),
            "{mysql}"
        );
        assert!(star_lock(DbBackend::Sqlite, "default", A).is_none());
    }

    #[test]
    fn test_upsert_sql_targets_the_unique_key_on_postgres() {
        use sea_orm::DbBackend;
        let sql = Entity::insert(ActiveModel {
            id: Set("x".into()),
            ..Default::default()
        })
        .on_conflict(
            OnConflict::columns([Column::OrgId, Column::QueryKey])
                .value(
                    Column::RunCount,
                    Expr::col((Entity, Column::RunCount)).add(1),
                )
                .to_owned(),
        )
        .build(DbBackend::Postgres)
        .to_string();
        assert!(
            sql.contains(r#""run_count" = "query_history"."run_count" + 1"#),
            "{sql}"
        );
    }

    #[test]
    fn test_streams_round_trip_through_the_comma_wrapped_form() {
        let streams = vec!["a".to_string(), "b".to_string()];
        assert_eq!(encode_streams(&streams), ",a,b,");
        assert_eq!(decode_streams(",a,b,"), streams);
        assert_eq!(encode_streams(&[]), "");
        assert!(decode_streams("").is_empty());
    }

    #[test]
    fn test_query_key_is_a_sha256_of_the_key_or_the_query() {
        assert_eq!(query_key_hash(Some("k"), "q"), sha256::digest("k"));
        assert_eq!(query_key_hash(None, "q"), sha256::digest("q"));
        assert_eq!(query_key_hash(Some(""), "q"), sha256::digest("q"));
        assert_eq!(query_key_hash(None, "q").len(), 64);
    }

    #[tokio::test]
    async fn test_clear_scopes_by_source_and_keeps_starred_unless_asked() {
        let db = db().await;
        let star = rec(&db, run(A, "logs", "starred", 1)).await;
        set_starred_with(&db, "default", A, &star.id, true)
            .await
            .unwrap();
        rec(&db, run(A, "logs", "a", 2)).await;
        rec(&db, run(A, "traces", "b", 3)).await;
        rec(&db, run(A, "metrics", "c", 4)).await;
        rec(&db, run(B, "logs", "a", 5)).await;

        let logs = vec!["logs".to_string()];
        assert_eq!(
            clear_with(&db, "default", A, &logs, false).await.unwrap(),
            1
        );
        assert_eq!(queries(all(&db, A).await), vec!["c", "b", "starred"]);
        assert_eq!(clear_with(&db, "default", A, &[], false).await.unwrap(), 2);
        assert_eq!(queries(all(&db, A).await), vec!["starred"]);
        assert_eq!(clear_with(&db, "default", A, &[], true).await.unwrap(), 1);
        assert!(all(&db, A).await.is_empty());
        assert_eq!(all(&db, B).await.len(), 1, "only the caller's rows");
    }

    #[tokio::test]
    async fn test_by_id_operations_are_scoped_to_org_and_user() {
        let db = db().await;
        let entry = rec(&db, run(A, "metrics", "up", 1)).await;

        assert!(matches!(
            set_starred_with(&db, "default", B, &entry.id, true)
                .await
                .unwrap(),
            SetStarred::NotFound
        ));
        assert!(matches!(
            set_starred_with(&db, "other", A, &entry.id, true)
                .await
                .unwrap(),
            SetStarred::NotFound
        ));
        assert!(!delete_with(&db, "default", B, &entry.id).await.unwrap());
        assert!(!delete_with(&db, "other", A, &entry.id).await.unwrap());
        assert!(!all(&db, A).await[0].starred);

        let starred = updated(
            set_starred_with(&db, "default", A, &entry.id, true)
                .await
                .unwrap(),
        );
        assert!(starred.starred);
        assert!(delete_with(&db, "default", A, &entry.id).await.unwrap());
        assert!(all(&db, A).await.is_empty());
    }

    // MySQL counts changed rows, so a no-op update reports 0; existence is a lookup.
    #[tokio::test]
    async fn test_starring_twice_still_returns_the_entry() {
        let db = db().await;
        let entry = rec(&db, run(A, "metrics", "up", 1)).await;
        for _ in 0..2 {
            let starred = updated(
                set_starred_with(&db, "default", A, &entry.id, true)
                    .await
                    .unwrap(),
            );
            assert!(starred.starred);
        }
        let unstarred = updated(
            set_starred_with(&db, "default", A, &entry.id, false)
                .await
                .unwrap(),
        );
        assert!(!unstarred.starred);
        assert!(matches!(
            set_starred_with(&db, "default", A, "missing", true)
                .await
                .unwrap(),
            SetStarred::NotFound
        ));
    }

    #[tokio::test]
    async fn test_starring_past_the_cap_is_refused_across_sources() {
        let db = db().await;
        let mut ids = Vec::new();
        for i in 0..=MAX_STARRED_PER_USER as i64 {
            let source = SOURCES[i as usize % 3];
            let entry = rec(&db, run(A, source, &format!("q{i}"), i)).await;
            assert!(!entry.starred, "recording never stars");
            ids.push(entry.id);
        }
        let (over, at_cap) = ids.split_last().unwrap();
        for id in at_cap {
            updated(set_starred_with(&db, "default", A, id, true).await.unwrap());
        }
        assert!(matches!(
            set_starred_with(&db, "default", A, over, true)
                .await
                .unwrap(),
            SetStarred::StarredCapReached
        ));
        assert!(
            updated(
                set_starred_with(&db, "default", A, &at_cap[0], true)
                    .await
                    .unwrap()
            )
            .starred,
            "re-starring an already starred entry at the cap still succeeds"
        );
        let other_user = rec(&db, run(B, "logs", "up", 1)).await;
        updated(
            set_starred_with(&db, "default", B, &other_user.id, true)
                .await
                .unwrap(),
        );

        updated(
            set_starred_with(&db, "default", A, &at_cap[0], false)
                .await
                .unwrap(),
        );
        assert!(
            updated(
                set_starred_with(&db, "default", A, over, true)
                    .await
                    .unwrap()
            )
            .starred,
            "unstarring frees a slot"
        );
    }

    #[tokio::test]
    async fn test_concurrent_stars_never_pass_the_cap() {
        let db = db().await;
        let mut ids = Vec::new();
        for i in 0..MAX_STARRED_PER_USER as i64 + 5 {
            ids.push(rec(&db, run(A, "logs", &format!("q{i}"), i)).await.id);
        }
        let (racing, below_cap) = ids.split_at(6);
        for id in &below_cap[..MAX_STARRED_PER_USER as usize - 1] {
            updated(set_starred_with(&db, "default", A, id, true).await.unwrap());
        }
        let outcomes = futures::future::join_all(
            racing
                .iter()
                .map(|id| set_starred_with(&db, "default", A, id, true)),
        )
        .await;
        let starred_now = outcomes
            .into_iter()
            .filter(|o| matches!(o, Ok(SetStarred::Updated(_))))
            .count();
        assert_eq!(starred_now, 1);
        let starred = Entity::find()
            .filter(Column::Starred.eq(true))
            .count(&db)
            .await
            .unwrap();
        assert_eq!(starred, MAX_STARRED_PER_USER);
    }

    #[tokio::test]
    async fn test_concurrent_first_stars_from_zero_stop_at_the_cap() {
        let db = db().await;
        let mut ids = Vec::new();
        for i in 0..MAX_STARRED_PER_USER as i64 + 10 {
            ids.push(rec(&db, run(A, "logs", &format!("q{i}"), i)).await.id);
        }
        let outcomes = futures::future::join_all(
            ids.iter()
                .map(|id| set_starred_with(&db, "default", A, id, true)),
        )
        .await;
        let starred_now = outcomes
            .iter()
            .filter(|o| matches!(o, Ok(SetStarred::Updated(_))))
            .count();
        let refused = outcomes
            .iter()
            .filter(|o| matches!(o, Ok(SetStarred::StarredCapReached)))
            .count();
        assert_eq!((starred_now, refused), (MAX_STARRED_PER_USER as usize, 10));
        let starred = Entity::find()
            .filter(Column::Starred.eq(true))
            .count(&db)
            .await
            .unwrap();
        assert_eq!(starred, MAX_STARRED_PER_USER);
    }

    /// One-connection pools on a throwaway CI Postgres schema, so calls truly race.
    async fn postgres_pools(
        n: usize,
    ) -> Option<(DatabaseConnection, String, Vec<DatabaseConnection>)> {
        let dsn = std::env::var("ZO_META_POSTGRES_DSN").ok()?;
        // The SQLite lane sets the variable empty rather than unsetting it.
        if dsn.trim().is_empty() {
            return None;
        }
        let schema = format!("qh_test_{}", config::ider::generate().to_ascii_lowercase());
        let admin = Database::connect(&dsn).await.unwrap();
        admin
            .execute_unprepared(&format!(r#"CREATE SCHEMA "{schema}""#))
            .await
            .unwrap();
        let mut pools = Vec::new();
        for _ in 0..n {
            let mut options = sea_orm::ConnectOptions::new(dsn.clone());
            options
                .max_connections(1)
                .min_connections(1)
                .set_schema_search_path(schema.clone());
            pools.push(Database::connect(options).await.unwrap());
        }
        create_table_for_tests(&pools[0]).await.unwrap();
        Some((admin, schema, pools))
    }

    async fn drop_schema(admin: DatabaseConnection, schema: &str, pools: Vec<DatabaseConnection>) {
        for pool in pools {
            pool.close().await.unwrap();
        }
        admin
            .execute_unprepared(&format!(r#"DROP SCHEMA "{schema}" CASCADE"#))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn test_postgres_concurrent_first_stars_stop_at_the_cap_when_ci_provides_it() {
        let Some((admin, schema, pools)) = postgres_pools(8).await else {
            return;
        };
        let mut ids = Vec::new();
        for i in 0..MAX_STARRED_PER_USER as i64 + 16 {
            ids.push(rec(&pools[0], run(A, "logs", &format!("q{i}"), i)).await.id);
        }
        let outcomes = futures::future::join_all(
            ids.iter()
                .enumerate()
                .map(|(i, id)| set_starred_with(&pools[i % pools.len()], "default", A, id, true)),
        )
        .await;
        let starred_now = outcomes
            .iter()
            .filter(|o| matches!(o, Ok(SetStarred::Updated(_))))
            .count();
        assert_eq!(starred_now, MAX_STARRED_PER_USER as usize);
        let starred = Entity::find()
            .filter(Column::Starred.eq(true))
            .count(&pools[0])
            .await
            .unwrap();
        assert_eq!(starred, MAX_STARRED_PER_USER);
        drop_schema(admin, &schema, pools).await;
    }

    #[tokio::test]
    async fn test_postgres_concurrent_new_rows_keep_the_cap_when_ci_provides_it() {
        let Some((admin, schema, pools)) = postgres_pools(8).await else {
            return;
        };
        for i in 0..MAX_UNSTARRED_PER_SOURCE as i64 {
            rec(&pools[0], run(A, "logs", &format!("q{i}"), i)).await;
        }
        let queries: Vec<String> = (0..16).map(|i| format!("new{i}")).collect();
        let results = futures::future::join_all(queries.iter().enumerate().map(|(i, q)| {
            record_with(
                &pools[i % pools.len()],
                run(A, "logs", q, 10_000 + i as i64),
            )
        }))
        .await;
        assert!(results.iter().all(Result::is_ok));
        assert_eq!(
            all(&pools[0], A).await.len() as u64,
            MAX_UNSTARRED_PER_SOURCE
        );
        drop_schema(admin, &schema, pools).await;
    }

    #[tokio::test]
    async fn test_cleanup_by_org_user_and_email() {
        let db = db().await;
        for (org, user) in [("default", A), ("default", B), ("other", A), ("other", B)] {
            rec(
                &db,
                NewRun {
                    org_id: org,
                    ..run(user, "logs", "up", 1)
                },
            )
            .await;
        }
        assert_eq!(delete_by_user_with(&db, "default", A).await.unwrap(), 1);
        assert!(all(&db, A).await.is_empty());
        assert_eq!(all(&db, B).await.len(), 1);

        assert_eq!(delete_by_email_with(&db, B).await.unwrap(), 2);
        assert_eq!(delete_by_org_with(&db, "other").await.unwrap(), 1);
        assert_eq!(Entity::find().count(&db).await.unwrap(), 0);
    }
}
