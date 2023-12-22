// Copyright 2023 Zinc Labs Inc.
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

use crate::{
    cli::data::{
        cli::{args, Cli},
        export, import, Context,
    },
    common::{
        infra,
        infra::config::{CONFIG, USERS},
        meta, migration,
        utils::file::set_permission,
    },
    service::{compact, db, file_list, users},
};

pub async fn cli() -> Result<bool, anyhow::Error> {
    let app = clap::Command::new("openobserve")
        .version(env!("GIT_VERSION"))
        .about(clap::crate_description!())
        .subcommands(&[
            clap::Command::new("reset")
                .about("reset openobserve data")
                .arg(
                    clap::Arg::new("component")
                        .short('c')
                        .long("component")
                        .help(
                            "reset data of the component: root, user, alert, dashboard, function, stream-stats",
                        ),
                ),
            clap::Command::new("import")
                .about("import openobserve data").args(args()),
            clap::Command::new("export")
                .about("export openobserve data").args(args()),
            clap::Command::new("view")
                .about("view openobserve data")
                .arg(
                    clap::Arg::new("component")
                        .short('c')
                        .long("component")
                        .help("view data of the component: version, user"),
                ),
            clap::Command::new("init-dir")
                .about("init openobserve data dir")
                .arg(
                    clap::Arg::new("path")
                        .short('p')
                        .long("path")
                        .help("init this path as data root dir"),
                ),
            clap::Command::new("migrate-file-list")
                .about("migrate file-list from s3 to dynamo db")
                .arg(
                    clap::Arg::new("prefix")
                        .short('p')
                        .long("prefix")
                        .value_name("prefix")
                        .required(false)
                        .help("only migrate specified prefix, default is all"),
                ),
            clap::Command::new("migrate-file-list-from-dynamo")
                .about("migrate file-list from dynamo to dynamo db"),
            clap::Command::new("migrate-meta").about("migrate meta"),
            clap::Command::new("migrate-dashboards").about("migrate-dashboards"),
            clap::Command::new("delete-parquet")
                .about("delete parquet files from s3 and file_list")
                .arg(
                    clap::Arg::new("file")
                        .short('f')
                        .long("file")
                        .value_name("file")
                        .help("the parquet file name"),
                ),
        ])
        .get_matches();

    if app.subcommand().is_none() {
        return Ok(false);
    }

    env_logger::init_from_env(env_logger::Env::new().default_filter_or("INFO"));

    let (name, command) = app.subcommand().unwrap();
    if name == "init-dir" {
        match command.get_one::<String>("path") {
            Some(path) => {
                set_permission(path, 0o777)?;
                println!("init dir {} succeeded", path);
            }
            None => {
                return Err(anyhow::anyhow!("please set data path"));
            }
        }
        return Ok(true);
    }

    // init infra, create data dir & tables
    infra::init().await.expect("infra init failed");
    match name {
        "reset" => {
            let component = command.get_one::<String>("component").unwrap();
            match component.as_str() {
                "root" => {
                    let _ = users::post_user(
                        meta::organization::DEFAULT_ORG,
                        meta::user::UserRequest {
                            email: CONFIG.auth.root_user_email.clone(),
                            password: CONFIG.auth.root_user_password.clone(),
                            role: meta::user::UserRole::Root,
                            first_name: "root".to_owned(),
                            last_name: "".to_owned(),
                            is_ldap: false,
                        },
                    )
                    .await?;
                }
                "user" => {
                    db::user::reset().await?;
                }
                "alert" => {
                    db::alerts::reset().await?;
                }
                "dashboard" => {
                    db::dashboards::reset().await?;
                }
                "function" => {
                    db::functions::reset().await?;
                }
                "stream-stats" => {
                    // reset stream stats update offset
                    db::compact::stats::set_offset(0, None).await?;
                    // reset stream stats table data
                    infra::file_list::reset_stream_stats().await?;
                    infra::file_list::set_initialised().await?;
                    // load stream list
                    db::schema::cache().await?;
                    // update stats from file list
                    compact::stats::update_stats_from_file_list()
                        .await
                        .expect("file list remote calculate stats failed");
                }
                _ => {
                    return Err(anyhow::anyhow!("unsupport reset component: {}", component));
                }
            }
        }
        "view" => {
            let component = command.get_one::<String>("component").unwrap();
            match component.as_str() {
                "version" => {
                    println!("version: {}", db::version::get().await?);
                }
                "user" => {
                    db::user::cache().await?;
                    let mut id = 0;
                    for user in USERS.iter() {
                        id += 1;
                        println!("{id}\t{:?}\n{:?}", user.key(), user.value());
                    }
                }
                _ => {
                    return Err(anyhow::anyhow!("unsupport reset component: {component}"));
                }
            }
        }
        "migrate-file-list" => {
            let prefix = match command.get_one::<String>("prefix") {
                Some(prefix) => prefix.to_string(),
                None => "".to_string(),
            };
            println!("Running migration file_list with prefix: {}", prefix);
            migration::file_list::run(&prefix).await?;
            println!("Running migration file_list_deleted");
            migration::file_list::run_for_deleted().await?;
        }
        "migrate-file-list-from-dynamo" => {
            println!("Running migration from DynamoDB");
            migration::file_list::run_for_dynamo().await?
        }
        "migrate-meta" => {
            println!("Running migration");
            migration::meta::run().await?
        }
        "migrate-dashboards" => {
            println!("Running migration dashboard");
            migration::dashboards::run().await?
        }
        "delete-parquet" => {
            let file = command.get_one::<String>("file").unwrap();
            match file_list::delete_parquet_file(file, true).await {
                Ok(_) => {
                    println!("delete parquet file {} succeeded", file);
                }
                Err(e) => {
                    println!("delete parquet file {} failed, error: {}", file, e);
                }
            }
        }
        "import" => {
            return import::Import::operator(Cli::arg_matches(command.clone()));
        }
        "export" => {
            return export::Export::operator(Cli::arg_matches(command.clone()));
        }
        _ => {
            return Err(anyhow::anyhow!("unsupport sub command: {name}"));
        }
    }

    // flush db
    let db = infra::db::get_db().await;
    if let Err(e) = db.close().await {
        log::error!("waiting for db close failed, error: {}", e);
    }

    println!("command {name} execute succeeded");
    Ok(true)
}
