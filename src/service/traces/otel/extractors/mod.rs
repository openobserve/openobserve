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

//! Extractor modules for processing OTEL span attributes

pub mod input_output;
pub mod metadata;
pub mod model;
pub mod observation_type;
pub mod parameters;
pub mod prompt;
pub mod provider;
pub mod service;
pub mod tool;
pub mod usage;
pub mod utils;

pub use input_output::InputOutputExtractor;
pub use metadata::MetadataExtractor;
pub use model::ModelExtractor;
pub use observation_type::{ObservationType, ScopeInfo, map_to_observation_type};
pub use parameters::ParametersExtractor;
pub use prompt::PromptExtractor;
pub use provider::ProviderExtractor;
pub use service::ServiceNameExtractor;
pub use tool::ToolExtractor;
pub use usage::UsageExtractor;
