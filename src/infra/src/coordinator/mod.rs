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

pub mod ai_prompts;
pub mod alerts;
pub mod destinations;
pub mod events;
pub mod pipelines;
pub mod service_streams;
pub mod system_settings;

pub async fn get_coordinator() -> &'static Box<dyn crate::db::Db> {
    super::db::get_coordinator().await
}
