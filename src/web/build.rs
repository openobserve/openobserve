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

use std::{fs, path::Path};

fn main() {
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    println!("cargo:rerun-if-changed={manifest_dir}/src/lib.rs");

    // Read the embed folder from the `#[folder = "..."]` attribute in lib.rs
    // instead of hardcoding it: e2e workflows rewrite that attribute to a
    // path outside the repo, and this keeps the tracking in sync.
    let lib = fs::read_to_string(format!("{manifest_dir}/src/lib.rs"))
        .expect("failed to read src/lib.rs");
    let folder = lib
        .split("#[folder = \"")
        .nth(1)
        .and_then(|rest| rest.split('"').next())
        .expect("no #[folder = \"...\"] attribute found in src/lib.rs");
    let dist = Path::new(manifest_dir).join(folder);

    // The RustEmbed derive has no file tracking of its own, so without this
    // a rebuilt web/dist would silently ship stale embedded assets.
    println!("cargo:rerun-if-changed={}", dist.display());

    // A wrong or missing folder embeds zero assets and only fails at runtime
    // with a blank UI (openobserve/openobserve#13197).
    if !dist.join("index.html").is_file() {
        println!(
            "cargo:warning={} does not contain index.html; the binary will serve an empty web UI",
            dist.display()
        );
    }
}
