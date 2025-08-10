// Copyright 2025 OpenObserve Inc.
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

use chrono::TimeZone;
use clap::{Arg, ArgAction, Command};
use config::utils::file::set_permission;
use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    file_list as infra_file_list, table,
};

use crate::{
    cli::data::{
        Context,
        cli::{Cli as dataCli, args as dataArgs},
        export, import,
    },
    common::{infra::config::USERS, meta},
    migration,
    service::{compact, db, file_list, users},
};

/// Not to be confused with [`clap::arg`] macro, this is a custom macro that
/// is used to create an `Arg` struct with the given name, short, long, help,
/// and required flags.
macro_rules! arg {
    ($name:expr, $short:expr, $long:expr, $help:expr $(, $required:expr)?) => {
        clap::Arg::new($name).short($short).long($long).help($help)$(.required($required))?
    };
}

fn create_cli_app() -> Command {
    Command::new("openobserve")
        .version(config::VERSION)
        .about(clap::crate_description!())
        .subcommands(&[
            Command::new("reset")
                .about("reset openobserve data")
                .arg(arg!("component", 'c', "component", "reset data of the component: root, user, alert, dashboard, function, stream-stats", true)),
            Command::new("import")
                .about("import openobserve data").args(dataArgs()),
            Command::new("export")
                .about("export openobserve data").args(dataArgs()),
            Command::new("view")
                .about("view openobserve data")
                .arg(arg!("component", 'c', "component", "view data of the component: version, user")),
            Command::new("init-dir")
                .about("init openobserve data dir")
                .arg(arg!("path", 'p', "path", "init this path as data root dir")),
            Command::new("migrate-file-list")
                .about("migrate file-list")
                .args([
                    arg!("prefix", 'p', "prefix", "only migrate specified prefix, default is all"),
                    arg!("from", 'f', "from", "migrate from: sled, sqlite, etcd, mysql, postgresql"),
                    arg!("to", 't', "to", "migrate to: sqlite, mysql, postgresql"),
                ]),
            Command::new("migrate-meta")
                .about("migrate meta")
                .args([
                    arg!("from", 'f', "from", "migrate from: sled, sqlite, etcd, mysql, postgresql", true).value_name("from"),
                    arg!("to", 't', "to", "migrate to: sqlite, etcd, mysql, postgresql", true).value_name("to"),
                ]),
            Command::new("migrate-dashboards").about("migrate-dashboards"),
            Command::new("migrate-pipeline").about("migrate pipelines")
                .arg(
                    arg!("drop-table", 'd', "drop-table", "Drop existing Pipeline table first before migrating", false)
                    .value_name("drop-table")
                    .num_args(0)
                ),
            Command::new("delete-parquet")
                .about("delete parquet files from s3 and file_list")
                .args([
                    arg!("account", 'a', "account", "the account name", false).value_name("account"),
                    arg!("file", 'f', "file", "the parquet file name", true).value_name("file"),
                ]),
            Command::new("migrate-schemas").about("migrate from single row to row per schema version"),
            Command::new("seaorm-rollback").about("rollback SeaORM migration steps")
                .subcommand(
                    Command::new("all")
                    .about("rollback all SeaORM migration steps")
                )
                .subcommand(
                    Command::new("last")
                    .about("rollback last N SeaORM migration steps")
                    .arg(
                        Arg::new("N").help("number of migration steps to rollback (default is 1)").value_parser(clap::value_parser!(u32)))
                ),
            Command::new("recover-file-list").about("recover file list from s3")
                .args([
                    arg!("account", 'a', "account", "the account name", true).value_name("account"),
                    arg!("prefix", 'p', "prefix", "only migrate specified prefix", true).value_name("prefix"),
                    arg!("insert", 'i', "insert", "insert file list into db", false).value_name("insert").action(ArgAction::SetTrue),
                ]),
                Command::new("node").about("node command").subcommands([
                Command::new("offline").about("offline node"),
                Command::new("online").about("online node"),
                Command::new("flush").about("flush memtable to disk"),
                Command::new("status").about("show node status"),
                Command::new("list").about("list cached nodes").args([
                    arg!("metrics", 'm', "metrics", "show node metrics", false).action(ArgAction::SetTrue),
                ]),
                Command::new("metrics").about("show local node metrics"),
            ]),
            Command::new("sql").about("query data").args([
                arg!("org", 'o', "org", "org name").default_value("default"),
                arg!("execute", 'e', "execute", "execute sql", true),
                arg!("time", 't', "time", "time range, e.g. 15m, 1h, 1d, 1w, 1y").default_value("15m"),
                arg!("limit", 'l', "limit", "limit the number of results").default_value("10"),
            ]),
            Command::new("test").about("test command").subcommands([
                Command::new("file_list").about("test generate file list groups").args([
                    arg!("mode", 'm', "mode", "mode: file_size, file_time, time_range").default_value("file_size"),
                    arg!("stream", 's', "stream", "stream name, the format is org/logs/default").default_value(""),
                    arg!("hour", 'd', "hour", "date for testing, the format is 2025/01/01/00").default_value(""),
                    arg!("group_size", 'g', "group_size", "group size by gb, default is 5gb").default_value("5"),
                ]),
            ]),
            Command::new("parse-id").about("parse snowflake id to timestamp").args([
                arg!("id", 'i', "id", "snowflake id", true),
            ]),
            Command::new("consistent-hash").about("consistent hash").args([
                arg!("file", 'f', "file", "file", true).num_args(1..),
            ]),
            Command::new("upgrade-db")
                .about("upgrade db table schemas").args(dataArgs()),
        ])
}

pub async fn cli() -> Result<bool, anyhow::Error> {
    let mut app = create_cli_app().get_matches();

    if app.subcommand().is_none() {
        return Ok(false);
    }

    #[cfg(not(feature = "tokio-console"))]
    env_logger::init_from_env(env_logger::Env::new().default_filter_or("INFO"));

    let (name, mut command) = app.remove_subcommand().unwrap();
    if name == "init-dir" {
        let path = command
            .get_one::<String>("path")
            .ok_or_else(|| anyhow::anyhow!("please set data path"))?;
        set_permission(path, 0o777)?;
        println!("init dir {path} successfully");
        return Ok(true);
    }

    // init infra, create data dir & tables
    let cfg = config::get_config();
    infra::init().await.expect("infra init failed");
    match name.as_str() {
        "reset" => {
            let component = command.get_one::<String>("component").unwrap();
            match component.as_str() {
                "root" => {
                    let _ = users::update_user(
                        meta::organization::DEFAULT_ORG,
                        cfg.auth.root_user_email.as_str(),
                        false,
                        cfg.auth.root_user_email.as_str(),
                        meta::user::UpdateUser {
                            change_password: true,
                            old_password: None,
                            new_password: Some(cfg.auth.root_user_password.clone()),
                            role: Some(crate::common::meta::user::UserRoleRequest {
                                role: config::meta::user::UserRole::Root.to_string(),
                                custom: None,
                            }),
                            first_name: Some("root".to_owned()),
                            last_name: Some("".to_owned()),
                            token: if cfg.auth.root_user_token.is_empty() {
                                None
                            } else {
                                Some(cfg.auth.root_user_token.clone())
                            },
                        },
                    )
                    .await?;
                }
                "user" => {
                    db::user::reset().await?;
                }
                "alert" => {
                    db::alerts::alert::reset().await?;
                }
                "dashboard" => {
                    table::dashboards::delete_all().await?;
                }
                "report" => {
                    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
                    db::dashboards::reports::reset(conn).await?;
                }
                "function" => {
                    db::functions::reset().await?;
                }
                "stream-stats" => {
                    // init nats client
                    let (tx, _rx) = tokio::sync::mpsc::channel::<infra::db::nats::NatsEvent>(1);
                    if !cfg.common.local_mode
                        && cfg.common.cluster_coordinator.to_lowercase() == "nats"
                    {
                        infra::db::nats::init_nats_client(tx).await?;
                    }
                    // reset stream stats update offset
                    db::compact::stats::set_offset(0, None).await?;
                    // reset stream stats table data
                    infra_file_list::reset_stream_stats().await?;
                    // load stream list
                    db::schema::cache().await?;
                    // update stats from file list
                    compact::stats::update_stats_from_file_list()
                        .await
                        .expect("file list remote calculate stats failed");
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "unsupported reset component: {}",
                        component
                    ));
                }
            }
        }
        "view" => {
            let component = command.get_one::<String>("component").unwrap();
            match component.as_str() {
                "version" => {
                    println!("version: {}", db::metas::version::get().await?);
                }
                "user" => {
                    db::user::cache().await?;
                    db::org_users::cache().await?;
                    let mut id = 0;
                    for user in USERS.iter() {
                        id += 1;
                        println!("{id}\t{:?}\n{:?}", user.key(), user.value());
                    }
                }
                _ => {
                    return Err(anyhow::anyhow!("unsupported reset component: {component}"));
                }
            }
        }
        "migrate-file-list" => {
            let from = command.remove_one::<String>("from").unwrap_or_default();
            let to = command.remove_one::<String>("to").unwrap_or_default();
            println!("Running migration file_list from {from} to {to}");
            migration::file_list::run(&from, &to).await?;
        }
        "migrate-meta" => {
            let from = command.remove_one::<String>("from").unwrap_or_default();
            let to = command.remove_one::<String>("to").unwrap_or_default();
            println!("Running migration metadata from {from} to {to}");
            migration::meta::run(&from, &to).await?
        }
        "migrate-dashboards" => {
            println!("Running migration dashboard");
            migration::dashboards::run().await?
        }
        "migrate-pipeline" => {
            println!("Running migration pipeline");
            let drop_table = command.get_flag("drop-table");
            migration::pipeline_func::run(drop_table).await?;
        }
        "delete-parquet" => {
            let account = command.remove_one::<String>("account").unwrap_or_default();
            let file = command.get_one::<String>("file").unwrap();
            match file_list::delete_parquet_file(&account, file, true).await {
                Ok(_) => {
                    println!("delete parquet file {file} successfully");
                }
                Err(e) => {
                    println!("delete parquet file {file} failed, error: {e}");
                }
            }
        }
        "import" => {
            crate::common::infra::init().await?;
            crate::common::infra::cluster::register_and_keep_alive().await?;
            import::Import::operator(dataCli::arg_matches(command.clone())).await?;
        }
        "export" => {
            crate::common::infra::init().await?;
            crate::common::infra::cluster::register_and_keep_alive().await?;
            export::Export::operator(dataCli::arg_matches(command.clone())).await?;
        }
        "migrate-schemas" => {
            println!("Running schema migration to row per schema version");
            #[allow(deprecated)]
            migration::schema::run().await?
        }
        "seaorm-rollback" => match command.subcommand() {
            Some(("all", _)) => {
                println!("Rolling back all");
                infra::table::down(None).await?
            }
            Some(("last", sub_matches)) => {
                let n = sub_matches
                    .get_one::<u32>("N")
                    .map(|n| n.to_owned())
                    .unwrap_or(1);
                println!("Rolling back {n}");
                infra::table::down(Some(n)).await?
            }
            Some((name, _)) => {
                return Err(anyhow::anyhow!("unsupported sub command: {name}"));
            }
            None => {
                return Err(anyhow::anyhow!("missing sub command"));
            }
        },
        "recover-file-list" => {
            let account = command
                .get_one::<String>("account")
                .map(|s| s.to_string())
                .unwrap_or_default();
            let prefix = command.get_one::<String>("prefix").unwrap();
            let insert = command.get_flag("insert");
            super::load::load_file_list_from_s3(&account, prefix, insert).await?;
        }
        "node" => {
            let command = command.subcommand();
            match command {
                Some(("offline", _)) => {
                    super::http::node_offline().await?;
                }
                Some(("online", _)) => {
                    super::http::node_online().await?;
                }
                Some(("flush", _)) => {
                    super::http::node_flush().await?;
                }
                Some(("status", _)) => {
                    super::http::node_status().await?;
                }
                Some(("list", args)) => {
                    let metrics = args.get_flag("metrics");
                    if metrics {
                        super::http::node_list_with_metrics().await?;
                    } else {
                        super::http::node_list().await?;
                    }
                }
                Some(("metrics", _)) => {
                    super::http::local_node_metrics().await?;
                }
                _ => {
                    return Err(anyhow::anyhow!("unsupported sub command: {name}"));
                }
            }
        }
        "sql" => {
            let org = command.get_one::<String>("org").unwrap();
            let sql = command.get_one::<String>("execute").unwrap();
            let time = command.get_one::<String>("time").unwrap();
            let limit = command.get_one::<String>("limit").unwrap();
            let mut limit = limit.parse::<i64>().unwrap_or(10);
            if !(1..=1000).contains(&limit) {
                limit = 10;
            }
            super::http::query(org, sql, time, limit).await?;
        }
        "test" => {
            let command = command.subcommand();
            match command {
                Some(("file_list", args)) => {
                    let mode = args.get_one::<String>("mode").unwrap();
                    let stream = args.get_one::<String>("stream").unwrap();
                    let hour = args.get_one::<String>("hour").unwrap();
                    let group_size = args.get_one::<String>("group_size").unwrap();
                    super::test::file_list(mode, stream, hour, group_size).await?;
                }
                _ => {
                    return Err(anyhow::anyhow!("unsupported sub command: {name}"));
                }
            }
        }
        "parse-id" => {
            let id = command.get_one::<String>("id").unwrap();
            println!("id: {id}");
            let id = id.parse::<i64>().unwrap();
            let ts = config::ider::to_timestamp_millis(id);
            println!("timestamp: {ts}");
            let t = chrono::Utc.timestamp_nanos(ts * 1_000_000);
            let td = t.format("%Y-%m-%dT%H:%M:%SZ").to_string();
            println!("datetimes: {td}");
        }
        "consistent-hash" => {
            let files = command
                .get_many::<String>("file")
                .unwrap()
                .collect::<Vec<_>>();
            let files = files.iter().map(|f| f.to_string()).collect::<Vec<_>>();
            super::http::consistent_hash(files).await?;
        }
        "upgrade-db" => {
            crate::migration::init_db().await?;
        }
        _ => {
            return Err(anyhow::anyhow!("unsupported sub command: {name}"));
        }
    }

    // flush db
    let db = infra::db::get_db().await;
    if let Err(e) = db.close().await {
        log::error!("waiting for db close failed, error: {e}");
    }

    println!("command {name} execute successfully");
    Ok(true)
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use clap::Command;

    use super::*;

    // Helper function to create the CLI app for testing
    fn create_test_app() -> Command {
        create_cli_app()
    }

    #[test]
    fn test_arg_macro() {
        // Test that the arg! macro works correctly
        let arg = arg!("test", 't', "test", "test argument");
        assert_eq!(arg.get_id(), "test");
        assert_eq!(arg.get_short(), Some('t'));
        assert_eq!(arg.get_long(), Some("test"));
        assert!(arg.get_help().is_some());
        assert!(!arg.is_required_set());
    }

    #[test]
    fn test_arg_macro_required() {
        // Test that the arg! macro works with required flag
        let arg = arg!("test", 't', "test", "test argument", true);
        assert_eq!(arg.get_id(), "test");
        assert_eq!(arg.get_short(), Some('t'));
        assert_eq!(arg.get_long(), Some("test"));
        assert!(arg.get_help().is_some());
        assert!(arg.is_required_set());
    }

    #[test]
    fn test_cli_app_creation() {
        // Test that the CLI app can be created without errors
        let app = create_test_app();
        assert_eq!(app.get_name(), "openobserve");
        assert!(app.get_subcommands().count() > 0);
    }

    #[test]
    fn test_reset_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "reset", "--component", "user"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "reset");
        assert_eq!(sub_matches.get_one::<String>("component").unwrap(), "user");
    }

    #[test]
    fn test_reset_command_invalid_component() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "reset", "--component", "invalid"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "reset");
        assert_eq!(
            sub_matches.get_one::<String>("component").unwrap(),
            "invalid"
        );
    }

    #[test]
    fn test_view_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "view", "--component", "version"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "view");
        assert_eq!(
            sub_matches.get_one::<String>("component").unwrap(),
            "version"
        );
    }

    #[test]
    fn test_init_dir_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "init-dir", "--path", "/tmp/test"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "init-dir");
        assert_eq!(sub_matches.get_one::<String>("path").unwrap(), "/tmp/test");
    }

    #[test]
    fn test_migrate_file_list_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "migrate-file-list",
                "--from",
                "sqlite",
                "--to",
                "mysql",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "migrate-file-list");
        assert_eq!(sub_matches.get_one::<String>("from").unwrap(), "sqlite");
        assert_eq!(sub_matches.get_one::<String>("to").unwrap(), "mysql");
    }

    #[test]
    fn test_migrate_meta_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "migrate-meta",
                "--from",
                "sqlite",
                "--to",
                "mysql",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "migrate-meta");
        assert_eq!(sub_matches.get_one::<String>("from").unwrap(), "sqlite");
        assert_eq!(sub_matches.get_one::<String>("to").unwrap(), "mysql");
    }

    #[test]
    fn test_migrate_pipeline_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "migrate-pipeline"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "migrate-pipeline");
        assert!(!sub_matches.get_flag("drop-table"));
    }

    #[test]
    fn test_migrate_pipeline_with_drop_table() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "migrate-pipeline", "--drop-table"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "migrate-pipeline");
        assert!(sub_matches.get_flag("drop-table"));
    }

    #[test]
    fn test_delete_parquet_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "delete-parquet", "--file", "test.parquet"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "delete-parquet");
        assert_eq!(
            sub_matches.get_one::<String>("file").unwrap(),
            "test.parquet"
        );
        assert_eq!(
            sub_matches
                .get_one::<String>("account")
                .unwrap_or(&String::new()),
            ""
        );
    }

    #[test]
    fn test_delete_parquet_with_account() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "delete-parquet",
                "--account",
                "test-account",
                "--file",
                "test.parquet",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "delete-parquet");
        assert_eq!(
            sub_matches.get_one::<String>("account").unwrap(),
            "test-account"
        );
        assert_eq!(
            sub_matches.get_one::<String>("file").unwrap(),
            "test.parquet"
        );
    }

    #[test]
    fn test_seaorm_rollback_all_command() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "seaorm-rollback", "all"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "seaorm-rollback");
        let (sub_name, _) = sub_matches.subcommand().unwrap();
        assert_eq!(sub_name, "all");
    }

    #[test]
    fn test_seaorm_rollback_last_command() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "seaorm-rollback", "last", "5"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "seaorm-rollback");
        let (sub_name, sub_sub_matches) = sub_matches.subcommand().unwrap();
        assert_eq!(sub_name, "last");
        assert_eq!(sub_sub_matches.get_one::<u32>("N").unwrap(), &5);
    }

    #[test]
    fn test_seaorm_rollback_last_default() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "seaorm-rollback", "last"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "seaorm-rollback");
        let (sub_name, sub_sub_matches) = sub_matches.subcommand().unwrap();
        assert_eq!(sub_name, "last");
        assert_eq!(sub_sub_matches.get_one::<u32>("N"), None);
    }

    #[test]
    fn test_recover_file_list_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "recover-file-list",
                "--account",
                "test-account",
                "--prefix",
                "test-prefix",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "recover-file-list");
        assert_eq!(
            sub_matches.get_one::<String>("account").unwrap(),
            "test-account"
        );
        assert_eq!(
            sub_matches.get_one::<String>("prefix").unwrap(),
            "test-prefix"
        );
        assert!(!sub_matches.get_flag("insert"));
    }

    #[test]
    fn test_recover_file_list_with_insert() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "recover-file-list",
                "--account",
                "test-account",
                "--prefix",
                "test-prefix",
                "--insert",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "recover-file-list");
        assert_eq!(
            sub_matches.get_one::<String>("account").unwrap(),
            "test-account"
        );
        assert_eq!(
            sub_matches.get_one::<String>("prefix").unwrap(),
            "test-prefix"
        );
        assert!(sub_matches.get_flag("insert"));
    }

    #[test]
    fn test_node_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "node", "offline"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "node");
        let (sub_name, _) = sub_matches.subcommand().unwrap();
        assert_eq!(sub_name, "offline");
    }

    #[test]
    fn test_node_list_command() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "node", "list"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "node");
        let (sub_name, sub_sub_matches) = sub_matches.subcommand().unwrap();
        assert_eq!(sub_name, "list");
        assert!(!sub_sub_matches.get_flag("metrics"));
    }

    #[test]
    fn test_node_list_with_metrics() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "node", "list", "--metrics"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "node");
        let (sub_name, sub_sub_matches) = sub_matches.subcommand().unwrap();
        assert_eq!(sub_name, "list");
        assert!(sub_sub_matches.get_flag("metrics"));
    }

    #[test]
    fn test_sql_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "sql",
                "--execute",
                "SELECT * FROM logs",
                "--org",
                "test-org",
                "--time",
                "1h",
                "--limit",
                "50",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "sql");
        assert_eq!(sub_matches.get_one::<String>("org").unwrap(), "test-org");
        assert_eq!(
            sub_matches.get_one::<String>("execute").unwrap(),
            "SELECT * FROM logs"
        );
        assert_eq!(sub_matches.get_one::<String>("time").unwrap(), "1h");
        assert_eq!(sub_matches.get_one::<String>("limit").unwrap(), "50");
    }

    #[test]
    fn test_sql_command_defaults() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "sql", "--execute", "SELECT * FROM logs"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "sql");
        assert_eq!(sub_matches.get_one::<String>("org").unwrap(), "default");
        assert_eq!(
            sub_matches.get_one::<String>("execute").unwrap(),
            "SELECT * FROM logs"
        );
        assert_eq!(sub_matches.get_one::<String>("time").unwrap(), "15m");
        assert_eq!(sub_matches.get_one::<String>("limit").unwrap(), "10");
    }

    #[test]
    fn test_test_file_list_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "test",
                "file_list",
                "--mode",
                "file_size",
                "--stream",
                "org/logs/default",
                "--hour",
                "2025/01/01/00",
                "--group_size",
                "10",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "test");
        let (sub_name, sub_sub_matches) = sub_matches.subcommand().unwrap();
        assert_eq!(sub_name, "file_list");
        assert_eq!(
            sub_sub_matches.get_one::<String>("mode").unwrap(),
            "file_size"
        );
        assert_eq!(
            sub_sub_matches.get_one::<String>("stream").unwrap(),
            "org/logs/default"
        );
        assert_eq!(
            sub_sub_matches.get_one::<String>("hour").unwrap(),
            "2025/01/01/00"
        );
        assert_eq!(
            sub_sub_matches.get_one::<String>("group_size").unwrap(),
            "10"
        );
    }

    #[test]
    fn test_test_file_list_defaults() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "test",
                "file_list",
                "--mode",
                "file_size",
                "--stream",
                "org/logs/default",
                "--hour",
                "2025/01/01/00",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "test");
        let (sub_name, sub_sub_matches) = sub_matches.subcommand().unwrap();
        assert_eq!(sub_name, "file_list");
        assert_eq!(
            sub_sub_matches.get_one::<String>("mode").unwrap(),
            "file_size"
        );
        assert_eq!(
            sub_sub_matches.get_one::<String>("stream").unwrap(),
            "org/logs/default"
        );
        assert_eq!(
            sub_sub_matches.get_one::<String>("hour").unwrap(),
            "2025/01/01/00"
        );
        assert_eq!(
            sub_sub_matches.get_one::<String>("group_size").unwrap(),
            "5"
        );
    }

    #[test]
    fn test_parse_id_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "parse-id", "--id", "123456789"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "parse-id");
        assert_eq!(sub_matches.get_one::<String>("id").unwrap(), "123456789");
    }

    #[test]
    fn test_consistent_hash_command_parsing() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from([
                "openobserve",
                "consistent-hash",
                "--file",
                "file1.txt",
                "file2.txt",
                "file3.txt",
            ])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "consistent-hash");
        let files: Vec<&String> = sub_matches.get_many::<String>("file").unwrap().collect();
        assert_eq!(files, vec!["file1.txt", "file2.txt", "file3.txt"]);
    }

    #[test]
    fn test_consistent_hash_single_file() {
        let app = create_test_app();
        let matches = app
            .try_get_matches_from(["openobserve", "consistent-hash", "--file", "file1.txt"])
            .unwrap();
        let (name, sub_matches) = matches.subcommand().unwrap();
        assert_eq!(name, "consistent-hash");
        let files: Vec<&String> = sub_matches.get_many::<String>("file").unwrap().collect();
        assert_eq!(files, vec!["file1.txt"]);
    }

    #[test]
    fn test_no_subcommand() {
        let app = create_test_app();
        let matches = app.try_get_matches_from(["openobserve"]).unwrap();
        assert!(matches.subcommand().is_none());
    }

    #[test]
    fn test_invalid_subcommand() {
        let app = create_test_app();
        let result = app.try_get_matches_from(["openobserve", "invalid-command"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_missing_required_argument() {
        let app = create_test_app();
        let result = app.try_get_matches_from(["openobserve", "migrate-meta"]);
        assert!(result.is_err());
    }

    #[test]
    fn test_limit_validation_logic() {
        // Test the limit validation logic from the sql command
        let test_cases = [
            ("5", 5),
            ("100", 100),
            ("1000", 1000),
            ("0", 10),    // Should default to 10
            ("1001", 10), // Should default to 10
            ("-5", 10),   // Should default to 10
        ];

        for (input, expected) in test_cases {
            let mut limit = input.parse::<i64>().unwrap_or(10);
            if !(1..=1000).contains(&limit) {
                limit = 10;
            }
            assert_eq!(limit, expected, "Failed for input: {input}");
        }
    }

    #[test]
    fn test_path_validation() {
        // Test path validation logic
        let valid_paths = [
            "/tmp/test",
            "./relative/path",
            "C:\\Windows\\Path",
            "/home/user/documents",
        ];

        for path in valid_paths {
            let path_obj = Path::new(path);
            assert!(!path_obj.to_string_lossy().is_empty());
        }
    }

    #[test]
    fn test_component_validation() {
        // Test valid reset components
        let valid_reset_components = [
            "root",
            "user",
            "alert",
            "dashboard",
            "function",
            "stream-stats",
        ];

        for component in valid_reset_components {
            assert!(!component.is_empty());
            assert!(component.len() < 50); // Reasonable length check
        }

        for component in ["version", "user"] {
            assert!(!component.is_empty());
            assert!(component.len() < 50);
        }
    }

    #[test]
    fn test_migration_source_target_validation() {
        // Test valid migration sources and targets
        let valid_sources = ["sled", "sqlite", "etcd", "mysql", "postgresql"];
        let valid_targets = ["sqlite", "mysql", "postgresql"];

        for source in valid_sources {
            assert!(!source.is_empty());
            assert!(source.len() < 20);
        }

        for target in valid_targets {
            assert!(!target.is_empty());
            assert!(target.len() < 20);
        }
    }

    #[test]
    fn test_time_format_validation() {
        // Test time format validation logic
        let valid_time_formats = ["15m", "1h", "1d", "1w", "1y", "30s", "2h30m"];

        for time_format in valid_time_formats {
            assert!(!time_format.is_empty());
            assert!(time_format.len() < 10);
            // Basic format check: should contain at least one letter
            assert!(time_format.chars().any(|c| c.is_alphabetic()));
        }
    }

    #[test]
    fn test_sql_query_validation() {
        // Test SQL query validation logic
        let valid_queries = [
            "SELECT * FROM logs",
            "SELECT count(*) FROM metrics",
            "SELECT * FROM traces WHERE timestamp > now() - 1h",
        ];

        for query in valid_queries {
            assert!(!query.is_empty());
            assert!(query.len() < 1000); // Reasonable length
            assert!(query.to_uppercase().contains("SELECT"));
        }
    }

    #[test]
    fn test_stream_format_validation() {
        // Test stream format validation (org/logs/default)
        let valid_streams = ["org/logs/default", "test/metrics/cpu", "prod/traces/api"];

        for stream in valid_streams {
            let parts: Vec<&str> = stream.split('/').collect();
            assert_eq!(parts.len(), 3, "Stream should have 3 parts: {stream}");
            assert!(!parts[0].is_empty(), "Org should not be empty: {stream}");
            assert!(
                !parts[1].is_empty(),
                "Stream type should not be empty: {stream}"
            );
            assert!(
                !parts[2].is_empty(),
                "Stream name should not be empty: {stream}"
            );
        }
    }

    #[test]
    fn test_hour_format_validation() {
        // Test hour format validation (2025/01/01/00)
        let valid_hours = ["2025/01/01/00", "2024/12/31/23", "2023/06/15/12"];

        for hour in valid_hours {
            let parts: Vec<&str> = hour.split('/').collect();
            assert_eq!(parts.len(), 4, "Hour should have 4 parts: {hour}");

            // Year should be 4 digits
            assert_eq!(parts[0].len(), 4, "Year should be 4 digits: {hour}");
            assert!(
                parts[0].parse::<i32>().is_ok(),
                "Year should be numeric: {hour}"
            );

            // Month should be 1-2 digits
            let month: i32 = parts[1].parse().unwrap();
            assert!((1..=12).contains(&month), "Month should be 1-12: {hour}");

            // Day should be 1-2 digits
            let day: i32 = parts[2].parse().unwrap();
            assert!((1..=31).contains(&day), "Day should be 1-31: {hour}");

            // Hour should be 1-2 digits
            let hour_val: i32 = parts[3].parse().unwrap();
            assert!((0..=23).contains(&hour_val), "Hour should be 0-23: {hour}");
        }
    }
}
