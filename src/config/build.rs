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

use std::{io::Result, process::Command};

use chrono::{DateTime, SecondsFormat, Utc};

fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=build.rs");
    // Re-run when these env vars change (CI sets them for deterministic builds)
    println!("cargo:rerun-if-env-changed=SOURCE_DATE_EPOCH");
    println!("cargo:rerun-if-env-changed=GIT_VERSION_OVERRIDE");
    println!("cargo:rerun-if-env-changed=GIT_HASH_OVERRIDE");

    // build information
    let git_tag = match std::env::var("GIT_VERSION_OVERRIDE") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            let output = Command::new("git")
                .args(["describe", "--tags", "--abbrev=0"])
                .output()
                .unwrap();
            String::from_utf8(output.stdout).unwrap().trim().to_string()
        }
    };
    println!("cargo:rustc-env=GIT_VERSION={git_tag}");

    let git_commit = match std::env::var("GIT_HASH_OVERRIDE") {
        Ok(v) if !v.is_empty() => v,
        _ => {
            let output = Command::new("git")
                .args(["rev-parse", "HEAD"])
                .output()
                .unwrap();
            String::from_utf8(output.stdout).unwrap().trim().to_string()
        }
    };
    println!("cargo:rustc-env=GIT_COMMIT_HASH={git_commit}");

    // Use SOURCE_DATE_EPOCH for reproducible builds (set in CI to keep output
    // deterministic across runs on the same commit, avoiding unnecessary rebuilds
    // of every workspace crate that depends on config).
    let build_date = match std::env::var("SOURCE_DATE_EPOCH") {
        Ok(epoch) => {
            let secs: i64 = epoch
                .parse()
                .expect("SOURCE_DATE_EPOCH must be a unix timestamp");
            DateTime::from_timestamp(secs, 0)
                .expect("invalid SOURCE_DATE_EPOCH timestamp")
                .to_rfc3339_opts(SecondsFormat::Secs, true)
        }
        Err(_) => {
            let now: DateTime<Utc> = Utc::now();
            now.to_rfc3339_opts(SecondsFormat::Secs, true)
        }
    };
    println!("cargo:rustc-env=GIT_BUILD_DATE={build_date}");

    Ok(())
}
