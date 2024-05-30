// Copyright 2024 Zinc Labs Inc.
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

use chrono::{Duration, Local};
use clap::ArgMatches;

#[derive(Debug, Clone)]
pub struct Cli {
    pub context: String,
    pub org: String,
    pub stream_name: String,
    pub stream_type: String,
    pub file_type: String,
    pub date: String,
    pub data: String,
    pub start_time: i64,
    pub end_time: i64,
}

pub fn args() -> impl IntoIterator<Item = impl Into<clap::Arg>> {
    [
        clap::Arg::new("stream").long("stream").alias("c").default_value("stream")
            .help("for stream data, maybe we can export stream, users, metadata, but for now we can only support stream"),
        clap::Arg::new("org").long("org").alias("o").default_value("default")
            .help("organization, default is default"),
        clap::Arg::new("stream_type").long("stream_type").alias("st").default_value("logs")
            .help("stream_type, default is logs"),
        clap::Arg::new("stream_name").long("stream_name").alias("s").default_value("default")
            .help("stream_name, default is default"),
        clap::Arg::new("file_type").long("file_type").alias("t").default_value("json")
            .help("file type: json or csv, default is json"),
        clap::Arg::new("date").long("date").alias("f").default_value("day")
            .help("create file by day or hour, default is day"),
        clap::Arg::new("data").long("data").alias("d")
            .help("data directory, no default"),
        clap::Arg::new("start_time").long("start").alias("start")
            .help("start time,default day"),
        clap::Arg::new("end_time").long("end").alias("end")
            .help("end time,default now")
    ]
}

impl Cli {
    pub fn new() -> Self {
        handle_args(command_args().get_matches())
    }

    pub fn args(args: Vec<&str>) -> Self {
        handle_args(command_args().get_matches_from(args))
    }

    pub fn arg_matches(args: ArgMatches) -> Self {
        handle_args(args)
    }
}

impl Default for Cli {
    fn default() -> Self {
        Self::new()
    }
}

fn command_args() -> clap::Command {
    clap::Command::new("openobserve").args(args())
}

fn handle_args(app: clap::ArgMatches) -> Cli {
    let stream = app.get_one::<String>("stream").unwrap();
    let org = app.get_one::<String>("org").unwrap();
    let stream_type = app.get_one::<String>("stream_type").unwrap();
    let stream_name = app.get_one::<String>("stream_name").unwrap();
    let file_type = app.get_one::<String>("file_type").unwrap();
    let date = app.get_one::<String>("date").unwrap();
    let data = app.get_one::<String>("data").unwrap();

    let start = match app.get_one::<String>("start_time") {
        Some(time) => time.parse::<i64>().unwrap(),
        None => Local::now()
            .date_naive()
            .and_hms_milli_opt(0, 0, 0, 0)
            .unwrap()
            .and_utc()
            .timestamp_micros(),
    };

    let end = match app.get_one::<String>("end_time") {
        Some(time) => time.parse::<i64>().unwrap(),
        None => (Local::now() - Duration::try_hours(1).unwrap()).timestamp_micros(),
    };

    Cli {
        context: stream.to_string(),
        org: org.to_string(),
        stream_name: stream_name.to_string(),
        stream_type: stream_type.to_string(),
        file_type: file_type.to_string(),
        date: date.to_string(),
        data: data.to_string(),
        start_time: start,
        end_time: end,
    }
}
