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

// Only read-only accessors are re-exported here. Mutations must go through
// `service::pipeline::store`, which keeps the executable-pipeline caches and
// coordinator/super-cluster events in sync.
pub use infra::pipeline::{
    get_by_id, get_by_stream, get_with_same_source_stream, list, list_by_org,
    list_streams_with_pipeline,
};
