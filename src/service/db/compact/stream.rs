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

use config::RwHashSet;
use once_cell::sync::Lazy;

static STREAMS: Lazy<RwHashSet<String>> = Lazy::new(Default::default);

pub fn is_running(stream: &str) -> bool {
    STREAMS.contains(stream)
}

pub fn set_running(stream: &str) {
    STREAMS.insert(stream.to_string());
}

pub fn clear_running(stream: &str) {
    STREAMS.remove(stream);
}
