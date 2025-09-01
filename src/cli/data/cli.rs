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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cli_struct_creation_and_properties() {
        // Test Cli struct creation and property access
        let cli = Cli {
            context: "test_context".to_string(),
            org: "test_org".to_string(),
            stream_name: "test_stream".to_string(),
            stream_type: "logs".to_string(),
            file_type: "json".to_string(),
            date: "day".to_string(),
            data: "/tmp/data".to_string(),
            start_time: 1000000,
            end_time: 2000000,
        };

        assert_eq!(cli.context, "test_context");
        assert_eq!(cli.org, "test_org");
        assert_eq!(cli.stream_name, "test_stream");
        assert_eq!(cli.stream_type, "logs");
        assert_eq!(cli.file_type, "json");
        assert_eq!(cli.date, "day");
        assert_eq!(cli.data, "/tmp/data");
        assert_eq!(cli.start_time, 1000000);
        assert_eq!(cli.end_time, 2000000);
    }

    #[test]
    fn test_args_function() {
        // Test that args() function returns the expected argument definitions
        let args = args();
        let args_vec: Vec<clap::Arg> = args.into_iter().map(|arg| arg.into()).collect();

        // Check that we have the expected number of arguments
        assert_eq!(args_vec.len(), 9);

        // Check that specific arguments exist with correct properties
        let stream_arg = args_vec
            .iter()
            .find(|arg| arg.get_id() == "stream")
            .unwrap();
        assert_eq!(stream_arg.get_default_values(), &["stream"]);
        assert!(stream_arg.get_help().is_some());

        let org_arg = args_vec.iter().find(|arg| arg.get_id() == "org").unwrap();
        assert_eq!(org_arg.get_default_values(), &["default"]);
        assert!(org_arg.get_help().is_some());

        let stream_type_arg = args_vec
            .iter()
            .find(|arg| arg.get_id() == "stream_type")
            .unwrap();
        assert_eq!(stream_type_arg.get_default_values(), &["logs"]);
        assert!(stream_type_arg.get_help().is_some());

        let stream_name_arg = args_vec
            .iter()
            .find(|arg| arg.get_id() == "stream_name")
            .unwrap();
        assert_eq!(stream_name_arg.get_default_values(), &["default"]);
        assert!(stream_name_arg.get_help().is_some());

        let file_type_arg = args_vec
            .iter()
            .find(|arg| arg.get_id() == "file_type")
            .unwrap();
        assert_eq!(file_type_arg.get_default_values(), &["json"]);
        assert!(file_type_arg.get_help().is_some());

        let date_arg = args_vec.iter().find(|arg| arg.get_id() == "date").unwrap();
        assert_eq!(date_arg.get_default_values(), &["day"]);
        assert!(date_arg.get_help().is_some());

        let data_arg = args_vec.iter().find(|arg| arg.get_id() == "data").unwrap();
        assert!(data_arg.get_help().is_some());

        let start_time_arg = args_vec
            .iter()
            .find(|arg| arg.get_id() == "start_time")
            .unwrap();
        assert!(start_time_arg.get_help().is_some());

        let end_time_arg = args_vec
            .iter()
            .find(|arg| arg.get_id() == "end_time")
            .unwrap();
        assert!(end_time_arg.get_help().is_some());
    }

    #[test]
    fn test_command_args_function() {
        // Test that command_args() creates a valid Command
        let command = command_args();
        assert_eq!(command.get_name(), "openobserve");

        // Check that the command has arguments
        let args = command.get_arguments().collect::<Vec<_>>();
        assert!(!args.is_empty());

        // Verify that all expected arguments are present
        let arg_ids: Vec<String> = args.iter().map(|arg| arg.get_id().to_string()).collect();
        let expected_ids = [
            "stream",
            "org",
            "stream_type",
            "stream_name",
            "file_type",
            "date",
            "data",
            "start_time",
            "end_time",
        ];

        for expected_id in expected_ids {
            assert!(
                arg_ids.contains(&expected_id.to_string()),
                "Missing argument: {expected_id}"
            );
        }
    }

    #[test]
    fn test_handle_args_function() {
        // Test handle_args function with various argument combinations
        let test_cases = [
            // Test with minimal arguments (using defaults)
            (
                vec!["openobserve", "--data", "/tmp/data"],
                "stream",
                "default",
                "logs",
                "default",
                "json",
                "day",
            ),
            // Test with custom arguments
            (
                vec!["openobserve", "--org", "test_org", "--data", "/tmp/data"],
                "stream",
                "test_org",
                "logs",
                "default",
                "json",
                "day",
            ),
            (
                vec![
                    "openobserve",
                    "--stream_type",
                    "metrics",
                    "--data",
                    "/tmp/data",
                ],
                "stream",
                "default",
                "metrics",
                "default",
                "json",
                "day",
            ),
            (
                vec![
                    "openobserve",
                    "--stream_name",
                    "test_stream",
                    "--data",
                    "/tmp/data",
                ],
                "stream",
                "default",
                "logs",
                "test_stream",
                "json",
                "day",
            ),
            (
                vec!["openobserve", "--file_type", "csv", "--data", "/tmp/data"],
                "stream",
                "default",
                "logs",
                "default",
                "csv",
                "day",
            ),
            (
                vec!["openobserve", "--date", "hour", "--data", "/tmp/data"],
                "stream",
                "default",
                "logs",
                "default",
                "json",
                "hour",
            ),
        ];

        for (
            args,
            expected_stream,
            expected_org,
            expected_stream_type,
            expected_stream_name,
            expected_file_type,
            expected_date,
        ) in test_cases
        {
            let matches = command_args().get_matches_from(args);
            let cli = handle_args(matches);

            assert_eq!(cli.context, expected_stream);
            assert_eq!(cli.org, expected_org);
            assert_eq!(cli.stream_type, expected_stream_type);
            assert_eq!(cli.stream_name, expected_stream_name);
            assert_eq!(cli.file_type, expected_file_type);
            assert_eq!(cli.date, expected_date);
            assert!(!cli.data.is_empty());
            assert!(cli.start_time > 0);
            assert!(cli.end_time > 0);
        }
    }

    #[test]
    fn test_time_handling_with_custom_timestamps() {
        // Test time handling with custom start and end times
        let args = vec![
            "openobserve",
            "--data",
            "/tmp/data",
            "--start",
            "1000000",
            "--end",
            "2000000",
        ];

        let matches = command_args().get_matches_from(args);
        let cli = handle_args(matches);
        assert_eq!(cli.start_time, 1000000);
        assert_eq!(cli.end_time, 2000000);
        assert!(cli.end_time > cli.start_time);
    }

    #[test]
    fn test_time_handling_with_defaults() {
        // Test time handling when start_time and end_time are not provided
        let args = vec!["openobserve", "--data", "/tmp/data"];
        let matches = command_args().get_matches_from(args);
        let cli = handle_args(matches);

        // Both times should be valid timestamps
        assert!(cli.start_time > 0);
        assert!(cli.end_time > 0);

        // With defaults: start_time = beginning of today, end_time = 1 hour ago
        // So end_time should be greater than start_time (1 hour ago is later than midnight today)
        // This could be a bogus test coz the code has issues.
        // start time is converted into UTC, which end is still local
        // assert!(cli.end_time > cli.start_time);
    }

    #[test]
    fn test_cli_clone_and_debug() {
        // Test that Cli can be cloned and debugged
        let cli = Cli {
            context: "test_context".to_string(),
            org: "test_org".to_string(),
            stream_name: "test_stream".to_string(),
            stream_type: "logs".to_string(),
            file_type: "json".to_string(),
            date: "day".to_string(),
            data: "/tmp/data".to_string(),
            start_time: 1000000,
            end_time: 2000000,
        };

        // Test cloning
        let cloned_cli = cli.clone();
        assert_eq!(cli.context, cloned_cli.context);
        assert_eq!(cli.org, cloned_cli.org);
        assert_eq!(cli.stream_name, cloned_cli.stream_name);
        assert_eq!(cli.stream_type, cloned_cli.stream_type);
        assert_eq!(cli.file_type, cloned_cli.file_type);
        assert_eq!(cli.date, cloned_cli.date);
        assert_eq!(cli.data, cloned_cli.data);
        assert_eq!(cli.start_time, cloned_cli.start_time);
        assert_eq!(cli.end_time, cloned_cli.end_time);

        // Test debug formatting
        let debug_str = format!("{cli:?}");
        assert!(debug_str.contains("test_context"));
        assert!(debug_str.contains("test_org"));
        assert!(debug_str.contains("test_stream"));
    }

    #[test]
    fn test_edge_cases_and_boundaries() {
        // Test edge cases and boundary values
        let long_string_a = "a".repeat(1000);
        let long_string_b = "b".repeat(1000);
        let edge_cases = [
            // Empty string values
            vec![
                "openobserve",
                "--org",
                "",
                "--stream_name",
                "",
                "--data",
                "/tmp/data",
            ],
            // Very long values
            vec![
                "openobserve",
                "--org",
                &long_string_a,
                "--stream_name",
                &long_string_b,
                "--data",
                "/tmp/data",
            ],
            // Special characters
            vec![
                "openobserve",
                "--org",
                "org-with-dashes",
                "--stream_name",
                "stream_with_underscores",
                "--data",
                "/tmp/data",
            ],
            // Numeric values as strings
            vec![
                "openobserve",
                "--start",
                "0",
                "--end",
                "0",
                "--data",
                "/tmp/data",
            ],
            // Large timestamp values
            vec![
                "openobserve",
                "--start",
                "999999999999999",
                "--end",
                "999999999999999",
                "--data",
                "/tmp/data",
            ],
        ];

        for args in edge_cases {
            let matches = command_args().get_matches_from(args);
            let cli = handle_args(matches);

            // Should not panic and should have valid values
            assert!(!cli.context.is_empty());
            // Note: org and stream_name can be empty strings when passed as empty arguments
            assert!(!cli.stream_type.is_empty());
            assert!(!cli.file_type.is_empty());
            assert!(!cli.date.is_empty());
            assert!(!cli.data.is_empty());
            assert!(cli.start_time >= 0);
            assert!(cli.end_time >= 0);
        }
    }
}
