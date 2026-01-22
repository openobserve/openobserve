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

use std::{io::Result, process::Command};

use chrono::{DateTime, Datelike, Utc};

fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=build.rs");
    // Only rerun if these environment variables change
    println!("cargo:rerun-if-env-changed=GIT_VERSION");
    println!("cargo:rerun-if-env-changed=GIT_COMMIT_HASH");
    println!("cargo:rerun-if-env-changed=GIT_BUILD_DATE");

    // build information - prefer environment variables from CI
    let git_version = std::env::var("GIT_VERSION").unwrap_or_else(|_| {
        // Fallback to git command if env var not set (local development)
        let output = Command::new("git")
            .args(["describe", "--tags", "--abbrev=0"])
            .output()
            .unwrap_or_else(|_| panic!("Failed to run git describe"));
        String::from_utf8(output.stdout).unwrap_or_else(|_| "unknown".to_string())
    });
    println!("cargo:rustc-env=GIT_VERSION={git_version}");

    let git_commit = std::env::var("GIT_COMMIT_HASH").unwrap_or_else(|_| {
        // Fallback to git command if env var not set (local development)
        let output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .output()
            .unwrap_or_else(|_| panic!("Failed to run git rev-parse"));
        String::from_utf8(output.stdout).unwrap_or_else(|_| "unknown".to_string())
    });
    println!("cargo:rustc-env=GIT_COMMIT_HASH={git_commit}");

    // Use static build date from environment, or ISO week for local builds
    // This prevents rebuilds by keeping the value stable within a week
    let build_date = std::env::var("GIT_BUILD_DATE").unwrap_or_else(|_| {
        let now: DateTime<Utc> = Utc::now();
        // Use ISO week as granularity to keep builds stable within a week
        format!("{}-W{:02}", now.year(), now.iso_week().week())
    });
    println!("cargo:rustc-env=GIT_BUILD_DATE={build_date}");

    Ok(())
}
