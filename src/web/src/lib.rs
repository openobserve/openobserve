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

//! Embeds the built web UI (`web/dist`) into the binary.
//!
//! This lives in its own leaf crate so the expensive embed + compression
//! macro expansion only re-runs when `web/dist` changes, not on every
//! rebuild of the API crate.
//!
//! For that to hold, the dependency list here must stay small and stable:
//! anything this crate depends on drags the ~50MB embed through LLVM again
//! whenever it changes. `config` in particular used to be a dependency, which
//! meant every `config` edit paid the embed cost. Config values the UI routes
//! need are passed in as arguments instead — see [`ui_routes`].

use rust_embed_for_web::RustEmbed;

mod ui;

pub use ui::ui_routes;

#[derive(RustEmbed)]
#[folder = "../../web/dist/"]
#[allow_missing = true]
#[gzip = false]
#[br = false]
pub struct WebAssets;
