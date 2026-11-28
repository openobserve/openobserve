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

use config::{meta::secret_store::SecretErrorCode, utils::time::now_micros};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QueryFilter,
    QuerySelect,
};

use crate::{
    errors::Error,
    table::{org_secret_consumers, org_secrets, secret_aliases},
};

pub const METADATA_CAP_BYTES: usize = 64 * 1024;
const NOT_FOUND: Error = Error::SecretStore(SecretErrorCode::SecretNotFound);

pub enum RowWrite {
    Insert(org_secrets::ActiveModel),
    Update(org_secrets::Model),
}

pub struct MetadataWrite {
    pub row: RowWrite,
    pub allowlist: Option<Vec<org_secret_consumers::Model>>,
    pub add_aliases: Vec<secret_aliases::Model>,
}

pub fn metadata_size<'a>(
    row: &org_secrets::ActiveModel,
    allowlist: &[org_secret_consumers::Model],
    alias_names: impl IntoIterator<Item = &'a str>,
) -> usize {
    let row_bytes = [
        &row.name,
        &row.description,
        &row.allowed_hosts,
        &row.pin_override_reason,
        &row.private_locations_reason,
    ]
    .into_iter()
    .filter_map(|field| field.try_as_ref())
    .map(String::len)
    .sum::<usize>();
    let consumer_bytes = allowlist
        .iter()
        .map(|entry| entry.consumer_type.len() + entry.consumer_id.len())
        .sum::<usize>();
    row_bytes + consumer_bytes + alias_names.into_iter().map(str::len).sum::<usize>()
}

/// Supply a transaction so concurrent changes share the row lock and partial writes can roll back.
pub async fn write_in<C: ConnectionTrait>(
    conn: &C,
    org_id: &str,
    write: MetadataWrite,
) -> Result<org_secrets::Model, Error> {
    let (row, insert) = match write.row {
        RowWrite::Insert(row) => (row, true),
        RowWrite::Update(row) => (row.into_active_model().reset_all(), false),
    };
    let id = row.id.try_as_ref().ok_or(NOT_FOUND)?;
    if row.org_id.try_as_ref().map(String::as_str) != Some(org_id)
        || write
            .allowlist
            .iter()
            .flatten()
            .any(|c| c.org_id != org_id || c.secret_id != *id)
        || write
            .add_aliases
            .iter()
            .any(|a| a.org_id != org_id || a.secret_id != *id)
    {
        return Err(NOT_FOUND);
    }
    if !insert
        && org_secrets::get_for_update_in(conn, org_id, id)
            .await?
            .is_none()
    {
        return Err(NOT_FOUND);
    }
    let existing_consumers;
    let consumers = match &write.allowlist {
        Some(replacement) => replacement,
        None => {
            existing_consumers = org_secret_consumers::list_consumers_in(conn, org_id, id).await?;
            &existing_consumers
        }
    };
    let existing_aliases = secret_aliases::Entity::find()
        .filter(secret_aliases::Column::OrgId.eq(org_id))
        .filter(secret_aliases::Column::SecretId.eq(id.as_str()))
        .filter(secret_aliases::Column::ExpiresAt.gt(now_micros()))
        .select_only()
        .column(secret_aliases::Column::Name)
        .into_tuple::<String>()
        .all(conn)
        .await?;
    let names = existing_aliases
        .iter()
        .chain(write.add_aliases.iter().map(|a| &a.name));
    if metadata_size(&row, consumers, names.map(String::as_str)) > METADATA_CAP_BYTES {
        return Err(Error::SecretStore(SecretErrorCode::SecretMetadataTooLarge));
    }

    let stored = if insert {
        org_secrets::insert_in(conn, row).await?
    } else {
        org_secrets::update_in(conn, org_id, row)
            .await?
            .ok_or(NOT_FOUND)?
    };
    if let Some(replacement) = write.allowlist {
        org_secret_consumers::delete_for_secret_in(conn, org_id, &stored.id).await?;
        for entry in replacement {
            org_secret_consumers::add_in(conn, entry.into()).await?;
        }
    }
    for alias in write.add_aliases {
        secret_aliases::insert_in(conn, alias.into()).await?;
    }
    Ok(stored)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path};

    use sea_orm::{Set, TransactionTrait};

    use super::*;
    use crate::{
        db::get_orm_client_rw,
        table::testing::{meta_store, unique},
    };

    fn insert(org: &str, id: &str, description: &str) -> MetadataWrite {
        let row = org_secrets::ActiveModel {
            id: Set(id.into()),
            org_id: Set(org.into()),
            name: Set("TOKEN".into()),
            kind: Set("secret".into()),
            description: Set(description.into()),
            state: Set("active".into()),
            policy_rev: Set(config::ider::ksuid()),
            policy_version: Set(1),
            created_by: Set("user".into()),
            updated_by: Set("user".into()),
            created_at: Set(1),
            updated_at: Set(1),
            ..Default::default()
        };
        MetadataWrite {
            row: RowWrite::Insert(row),
            allowlist: None,
            add_aliases: vec![],
        }
    }

    fn update(row: org_secrets::Model) -> MetadataWrite {
        MetadataWrite {
            row: RowWrite::Update(row),
            allowlist: None,
            add_aliases: vec![],
        }
    }

    fn consumer(org: &str, secret_id: &str, consumer_id: &str) -> org_secret_consumers::Model {
        org_secret_consumers::Model {
            org_id: org.into(),
            secret_id: secret_id.into(),
            consumer_type: "job".into(),
            consumer_id: consumer_id.into(),
            added_by: "user".into(),
            added_at: 1,
        }
    }

    fn alias(org: &str, secret_id: &str, name: &str, expires_at: i64) -> secret_aliases::Model {
        secret_aliases::Model {
            org_id: org.into(),
            secret_id: secret_id.into(),
            name: name.into(),
            expires_at,
        }
    }

    #[tokio::test]
    async fn oversized_insert_leaves_no_row() {
        if !meta_store().await {
            return;
        }
        let txn = get_orm_client_rw().await.begin().await.unwrap();
        let org = unique("meta_insert");
        let id = config::ider::ksuid();
        let write = insert(&org, &id, &"é".repeat(METADATA_CAP_BYTES / 2));
        assert!(matches!(
            write_in(&txn, &org, write).await,
            Err(Error::SecretStore(SecretErrorCode::SecretMetadataTooLarge))
        ));
        assert!(
            org_secrets::get_secret_in(&txn, &org, &id)
                .await
                .unwrap()
                .is_none()
        );
        txn.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn row_and_allowlist_share_the_cap_on_insert_and_update() {
        if !meta_store().await {
            return;
        }
        let txn = get_orm_client_rw().await.begin().await.unwrap();
        let org = unique("meta_consumers");
        let id = config::ider::ksuid();
        let entry = consumer(&org, &id, "a");
        let description = "x".repeat(METADATA_CAP_BYTES - "TOKENjoba".len());
        let mut write = insert(&org, &id, &description);
        write.allowlist = Some(vec![entry.clone()]);
        let original = write_in(&txn, &org, write).await.unwrap();
        assert_eq!(original.description, description);

        let mut bigger = original.clone();
        bigger.description.push('x');
        let mut more_consumers = update(original.clone());
        more_consumers.allowlist = Some(vec![entry.clone(), consumer(&org, &id, "b")]);
        for write in [update(bigger), more_consumers] {
            assert!(matches!(
                write_in(&txn, &org, write).await,
                Err(Error::SecretStore(SecretErrorCode::SecretMetadataTooLarge))
            ));
            assert_eq!(
                org_secrets::get_secret_in(&txn, &org, &id)
                    .await
                    .unwrap()
                    .as_ref(),
                Some(&original)
            );
            assert_eq!(
                org_secret_consumers::list_consumers_in(&txn, &org, &id)
                    .await
                    .unwrap(),
                std::slice::from_ref(&entry)
            );
        }

        let mut replacement = update(original);
        replacement.allowlist = Some(vec![]);
        write_in(&txn, &org, replacement).await.unwrap();
        assert!(
            org_secret_consumers::list_consumers_in(&txn, &org, &id)
                .await
                .unwrap()
                .is_empty()
        );
        txn.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn existing_live_and_added_aliases_share_the_cap_with_policy_text() {
        if !meta_store().await {
            return;
        }
        let txn = get_orm_client_rw().await.begin().await.unwrap();
        let org = unique("meta_alias");
        let id = config::ider::ksuid();
        let mut write = insert(&org, &id, "");
        write.add_aliases = vec![
            alias(&org, &id, "OLD", i64::MAX),
            alias(&org, &id, "EXPIRED", 0),
        ];
        let mut row = write_in(&txn, &org, write).await.unwrap();
        row.description = "x".repeat(METADATA_CAP_BYTES - "TOKENOLDhostpinprivate".len());
        row.allowed_hosts = "host".into();
        row.pin_override_reason = "pin".into();
        row.private_locations_reason = "private".into();
        let stored = write_in(&txn, &org, update(row.clone())).await.unwrap();
        assert_eq!(stored, row);

        let mut extra = update(row);
        extra.add_aliases = vec![alias(&org, &id, "X", i64::MAX)];
        assert!(matches!(
            write_in(&txn, &org, extra).await,
            Err(Error::SecretStore(SecretErrorCode::SecretMetadataTooLarge))
        ));
        assert!(
            secret_aliases::get_alias_in(&txn, &org, "X", 1)
                .await
                .unwrap()
                .is_none()
        );
        txn.rollback().await.unwrap();
    }

    #[tokio::test]
    async fn foreign_metadata_is_refused_before_insert() {
        if !meta_store().await {
            return;
        }
        let txn = get_orm_client_rw().await.begin().await.unwrap();
        let org = unique("meta_scope");
        let id = config::ider::ksuid();
        let mut wrong_consumer = insert(&org, &id, "");
        wrong_consumer.allowlist = Some(vec![consumer("other", &id, "a")]);
        let mut wrong_alias = insert(&org, &id, "");
        wrong_alias.add_aliases = vec![alias("other", &id, "OLD", i64::MAX)];
        let mut other_secret = insert(&org, &id, "");
        other_secret.allowlist = Some(vec![consumer(&org, "other", "a")]);
        for write in [
            insert("other", &id, ""),
            wrong_consumer,
            wrong_alias,
            other_secret,
        ] {
            assert!(matches!(
                write_in(&txn, &org, write).await,
                Err(Error::SecretStore(SecretErrorCode::SecretNotFound))
            ));
        }
        assert!(
            org_secrets::get_secret_in(&txn, &org, &id)
                .await
                .unwrap()
                .is_none()
        );
        txn.rollback().await.unwrap();
    }

    /// Source with every `#[cfg(test)] mod name { ... }` removed; test fixtures may write rows.
    fn production_code(source: &str) -> String {
        let mut code = String::new();
        let mut rest = source;
        while let Some(at) = rest.find("#[cfg(test)]") {
            let after = rest[at + "#[cfg(test)]".len()..].trim_start();
            let Some(open) = after
                .strip_prefix("mod ")
                .and_then(|module| module.find(['{', ';']))
                .filter(|&end| after["mod ".len() + end..].starts_with('{'))
                .map(|end| "mod ".len() + end)
            else {
                code.push_str(&rest[..at + "#[cfg(test)]".len()]);
                rest = &rest[at + "#[cfg(test)]".len()..];
                continue;
            };
            code.push_str(&rest[..at]);
            let mut depth = 0usize;
            let body = &after[open..];
            let close = body
                .char_indices()
                .find(|&(_, c)| {
                    match c {
                        '{' => depth += 1,
                        '}' => depth -= 1,
                        _ => {}
                    }
                    depth == 0
                })
                .map_or(body.len(), |(i, _)| i + 1);
            rest = &body[close..];
        }
        code.push_str(rest);
        code
    }

    fn writer_violation(code: &str) -> Option<String> {
        for call in [
            "org_secrets::insert_in",
            "org_secrets::update_in",
            "org_secret_consumers::add_in",
            "org_secret_consumers::remove_in",
            "org_secret_consumers::delete_for_secret_in",
            "secret_aliases::insert_in",
            "secret_aliases::delete_name_in",
            "secret_aliases::delete_for_secret_in",
        ] {
            if code.contains(call) {
                return Some(format!("calls {call}"));
            }
            let (module, function) = call.split_once("::").unwrap();
            let imports = code.match_indices(&format!("{module}::{{")).any(|(at, _)| {
                code[at..].split_once('}').is_some_and(|(list, _)| {
                    list.split([',', '{', ' ', '\n'])
                        .any(|item| item == function)
                })
            });
            if imports {
                return Some(format!("imports {call}"));
            }
        }
        None
    }

    #[test]
    fn writer_scan_skips_only_test_modules() {
        let fixture = "fn f() {}\n#[cfg(test)]\nmod tests {\n    fn g() { if x { org_secrets::insert_in(); } }\n}\n";
        assert_eq!(writer_violation(&production_code(fixture)), None);
        let nested = "mod a {\n    #[cfg(test)]\n    mod t { use org_secrets::{insert_in}; }\n}\n";
        assert_eq!(writer_violation(&production_code(nested)), None);
        for source in [
            "fn f() { org_secrets::insert_in(); }\n#[cfg(test)]\nmod tests {}\n",
            "#[cfg(test)]\nmod tests {}\nfn f() { secret_aliases::delete_name_in(); }\n",
            "#[cfg(test)]\nfn helper() { org_secret_consumers::add_in(); }\n",
            "use crate::table::org_secrets::{get_secret_in, update_in};\n",
        ] {
            assert!(
                writer_violation(&production_code(source)).is_some(),
                "{source}"
            );
        }
    }

    #[test]
    fn metadata_has_one_writer() {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let mut dirs = vec![src.to_path_buf()];
        while let Some(dir) = dirs.pop() {
            for entry in fs::read_dir(dir).unwrap() {
                let entry = entry.unwrap();
                let file = entry.path();
                if entry.file_type().unwrap().is_dir() {
                    dirs.push(file);
                    continue;
                }
                if file.extension().is_none_or(|ext| ext != "rs") {
                    continue;
                }
                let relative = file.strip_prefix(src).unwrap();
                if [
                    "infra/src/secret_store/metadata.rs",
                    "infra/src/table/org_secrets.rs",
                    "infra/src/table/org_secret_consumers.rs",
                    "infra/src/table/secret_aliases.rs",
                ]
                .iter()
                .any(|path| relative == Path::new(path))
                {
                    continue;
                }
                let code = production_code(&fs::read_to_string(&file).unwrap());
                if let Some(found) = writer_violation(&code) {
                    panic!("{} {found}", relative.display());
                }
            }
        }
    }
}
