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

use std::{env, io::Result, process::Command};

use chrono::{DateTime, SecondsFormat, Utc};

fn main() -> Result<()> {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=GITHUB_REF_TYPE");
    println!("cargo:rerun-if-env-changed=GITHUB_REF_NAME");

    // build information
    let git_tag = release_version();
    println!("cargo:rustc-env=GIT_VERSION={git_tag}");

    let git_commit = git(&["rev-parse", "HEAD"]);
    println!("cargo:rustc-env=GIT_COMMIT_HASH={git_commit}");

    let now: DateTime<Utc> = Utc::now();
    let build_date = now.to_rfc3339_opts(SecondsFormat::Secs, true);
    println!("cargo:rustc-env=GIT_BUILD_DATE={build_date}");

    Ok(())
}

/// The version stamped into the binary (`config::VERSION`).
///
/// One commit can carry several tags — promoting the last release candidate to GA tags the same
/// commit as both `v1.1.0-rc3` and `v1.1.0`. `git describe` breaks that tie by tag type, and
/// `actions/checkout` re-creates the pushed tag as a lightweight tag, so a GA build was stamped
/// with the RC version. Resolve the version deterministically instead.
fn release_version() -> String {
    let head_tags: Vec<String> = git(&["tag", "--points-at", "HEAD"])
        .lines()
        .map(str::to_string)
        .collect();

    // A tag-triggered CI build: the pushed tag is the version, and it must be on the built commit.
    if env::var("GITHUB_REF_TYPE").as_deref() == Ok("tag")
        && let Ok(tag) = env::var("GITHUB_REF_NAME")
    {
        assert!(
            head_tags.contains(&tag),
            "release tag {tag} does not point at the commit being built (tags on HEAD: {head_tags:?})"
        );
        return tag;
    }

    newest_release(&head_tags).unwrap_or_else(|| git(&["describe", "--tags", "--abbrev=0"]))
}

/// Picks the highest version tag, ranking a GA release above its own pre-releases
/// (`v1.1.0` > `v1.1.0-rc3` > `v1.1.0-rc2`).
fn newest_release(tags: &[String]) -> Option<String> {
    tags.iter()
        .filter(|t| t.starts_with('v') && t[1..].starts_with(|c: char| c.is_ascii_digit()))
        .max_by_key(|t| version_key(t))
        .cloned()
}

fn version_key(tag: &str) -> (Vec<u64>, bool, u64) {
    let tag = tag.trim_start_matches('v');
    let (core, pre) = match tag.split_once('-') {
        Some((core, pre)) => (core, Some(pre)),
        None => (tag, None),
    };
    let numbers = core.split('.').map(|n| n.parse().unwrap_or(0)).collect();
    let pre_number = pre
        .map(|p| p.trim_start_matches(|c: char| !c.is_ascii_digit()))
        .and_then(|p| p.parse().ok())
        .unwrap_or(0);
    (numbers, pre.is_none(), pre_number)
}

fn git(args: &[&str]) -> String {
    Command::new("git")
        .args(args)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .unwrap_or_default()
}
