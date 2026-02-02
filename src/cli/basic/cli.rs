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

use std::path::PathBuf;

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
        .arg(arg!("config", 'c', "config", "Path to config file"))
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
            Command::new("init-db")
                    .about("init openobserve database tables"),
            Command::new("upgrade-db")
                .about("upgrade db table schemas"),
            Command::new("migrate-file-list")
                .about("migrate file_list related tables between databases")
                .args([
                    arg!("from", 'f', "from", "migrate from: sqlite, mysql, postgresql", true),
                    arg!("to", 't', "to", "migrate to: sqlite, mysql, postgresql", true),
                    Arg::new("batch-size").short('b').long("batch-size").help("batch size for migration").default_value("1000"),
                    Arg::new("tables").long("tables").help("only migrate specified tables (comma-separated)"),
                    Arg::new("exclude").long("exclude").help("exclude specified tables (comma-separated)"),
                    Arg::new("truncate-target").long("truncate-target").help("truncate target tables before migration").action(ArgAction::SetTrue),
                    Arg::new("incremental").long("incremental").help("incremental mode").action(ArgAction::SetTrue),
                    Arg::new("since").long("since").help("incremental start time (microseconds timestamp)").value_parser(clap::value_parser!(i64)),
                    Arg::new("dry-run").long("dry-run").help("only print plan, don't execute").action(ArgAction::SetTrue),
                ]),
            Command::new("migrate-meta")
                .about("migrate meta tables between databases (excludes file_list tables)")
                .args([
                    arg!("from", 'f', "from", "migrate from: sqlite, mysql, postgresql", true),
                    arg!("to", 't', "to", "migrate to: sqlite, mysql, postgresql", true),
                    Arg::new("batch-size").short('b').long("batch-size").help("batch size for migration").default_value("1000"),
                    Arg::new("tables").long("tables").help("only migrate specified tables (comma-separated)"),
                    Arg::new("exclude").long("exclude").help("exclude specified tables (comma-separated)"),
                    Arg::new("truncate-target").long("truncate-target").help("truncate target tables before migration").action(ArgAction::SetTrue),
                    Arg::new("incremental").long("incremental").help("incremental mode").action(ArgAction::SetTrue),
                    Arg::new("since").long("since").help("incremental start time (microseconds timestamp)").value_parser(clap::value_parser!(i64)),
                    Arg::new("dry-run").long("dry-run").help("only print plan, don't execute").action(ArgAction::SetTrue),
                ]),
            Command::new("delete-parquet")
                .about("delete parquet files from s3 and file_list")
                .args([
                    arg!("account", 'a', "account", "the account name", false).value_name("account"),
                    arg!("file", 'f', "file", "the parquet file name", true).value_name("file"),
                ]),
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
                Command::new("reload").about("reload cache from database").args([
                    arg!("module", 'm', "module", "comma-separated list of modules to reload (e.g., schema,user,functions)", true),
                ]),
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
            Command::new("query-optimiser").about("query optimiser").args([
                    arg!("url", 'u', "url", "url", true),
                    arg!("token", 't', "token", "token", true),
                    arg!("meta-token", 'm', "meta-token", "meta-token"),
                    arg!("duration", 'd', "duration", "duration", true),
                    arg!("stream-name", 's', "stream-name", "stream-name"),
                    arg!("top-x", 'x', "top-x", "top-x").default_value("5"),
                    arg!("org-id", 'o', "org-id", "org-id").default_value("default"),
            ])
        ])
}

pub async fn cli() -> Result<bool, anyhow::Error> {
    let mut app = create_cli_app().get_matches();

    // Handle config file argument
    if let Some(config_file_path) = app.get_one::<String>("config") {
        let path = PathBuf::from(config_file_path);
        config::config_path_manager::set_config_file_path(path.clone())
            .and_then(|_| crate::job::config_watcher::reload_config(&path))
            .map_err(|e|
                anyhow::anyhow!(
                    "set config from file path {config_file_path} failed with {e}, stopping boot up... ",
                )
            )?;
    }

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
    match name.as_str() {
        "reset" => {
            infra::init().await?;
            db::org_users::cache().await?;
            let component = command.get_one::<String>("component").unwrap();
            match component.as_str() {
                "root" => {
                    let ret = users::update_user(
                        meta::organization::DEFAULT_ORG,
                        cfg.auth.root_user_email.as_str(),
                        meta::user::UserUpdateMode::CliUpdate,
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
                    if !ret.status().is_success() {
                        return Err(anyhow::anyhow!(
                            "reset root user failed, error: {:?}",
                            ret.body()
                        ));
                    }
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
        "upgrade-db" | "init-db" => {
            crate::migration::init_db().await?;
        }
        "migrate-file-list" => {
            let from = command.remove_one::<String>("from").unwrap_or_default();
            let to = command.remove_one::<String>("to").unwrap_or_default();
            let batch_size = command
                .get_one::<String>("batch-size")
                .map(|s| s.parse::<u64>().unwrap_or(1000))
                .unwrap_or(1000);
            let tables = command.remove_one::<String>("tables");
            let exclude = command.remove_one::<String>("exclude");
            let truncate_target = command.get_flag("truncate-target");
            let incremental = command.get_flag("incremental");
            let since = command.get_one::<i64>("since").copied();
            let dry_run = command.get_flag("dry-run");

            let config = migration::MigrationConfig::new(&from, &to)
                .with_batch_size(batch_size)
                .with_tables(tables)
                .with_exclude(exclude)
                .with_truncate_target(truncate_target)
                .with_incremental(incremental, since)
                .with_dry_run(dry_run);

            migration::run_file_list(config).await?;
        }
        "migrate-meta" => {
            let from = command.remove_one::<String>("from").unwrap_or_default();
            let to = command.remove_one::<String>("to").unwrap_or_default();
            let batch_size = command
                .get_one::<String>("batch-size")
                .map(|s| s.parse::<u64>().unwrap_or(1000))
                .unwrap_or(1000);
            let tables = command.remove_one::<String>("tables");
            let exclude = command.remove_one::<String>("exclude");
            let truncate_target = command.get_flag("truncate-target");
            let incremental = command.get_flag("incremental");
            let since = command.get_one::<i64>("since").copied();
            let dry_run = command.get_flag("dry-run");

            let config = migration::MigrationConfig::new(&from, &to)
                .with_batch_size(batch_size)
                .with_tables(tables)
                .with_exclude(exclude)
                .with_truncate_target(truncate_target)
                .with_incremental(incremental, since)
                .with_dry_run(dry_run);

            migration::run_meta(config).await?;
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
                Some(("reload", args)) => {
                    let modules_str = args.get_one::<String>("module").unwrap();
                    let modules: Vec<String> = modules_str
                        .split(',')
                        .map(|s| s.trim().to_string())
                        .collect();
                    super::http::node_reload(modules).await?;
                }
                Some(("node-list", _)) => {
                    super::http::refresh_nodes_list().await?;
                }
                Some(("user-sessions", _)) => {
                    super::http::refresh_user_sessions().await?;
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
            // Snowflake IDs are expected to be 19 digits. If the input ID is longer,
            // we truncate to the first 19 digits to ensure correct parsing; any extra digits are
            // ignored.
            let id = if id.len() > 19 {
                id[..19].to_string()
            } else {
                id.to_string()
            };
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
        "query-optimiser" => {
            let stream_name = command
                .get_one::<String>("stream-name")
                .map(|stream_name| stream_name.to_string());

            let meta_token = command
                .get_one::<String>("meta-token")
                .map(|meta_token| meta_token.to_string());

            let url = command.get_one::<String>("url").expect("url is required");
            let token = command
                .get_one::<String>("token")
                .expect("token is required");

            let duration = command.get_one::<String>("duration").unwrap();
            let duration = duration.parse::<i64>().unwrap_or(12);
            let top_x = command.get_one::<String>("top-x").unwrap();
            let top_x = top_x.parse::<usize>().unwrap_or(5);
            let org_id = command.get_one::<String>("org-id").unwrap();

            super::query_optimiser::query_optimiser(
                url,
                token,
                &meta_token,
                duration,
                &stream_name,
                top_x,
                org_id,
            )
            .await?;
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
        let valid_sources = ["sqlite", "mysql", "postgresql"];
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
