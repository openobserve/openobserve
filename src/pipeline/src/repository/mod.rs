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

pub mod backfill;
pub mod pipeline_errors;
pub mod pipelines;

#[derive(Debug, thiserror::Error)]
pub enum PipelineError {
    #[error("InfraError# {0}")]
    InfraError(infra::errors::Error),
    #[error("Pipeline with ID {0} not found.")]
    NotFound(String),
    #[error("Pipeline with ID {0} modified by someone else. Please refresh.")]
    Modified(String),
    #[error("A realtime pipeline with same source stream already exists")]
    StreamInUse,
    #[error("Invalid pipeline {0}")]
    InvalidPipeline(String),
    #[error("Invalid DerivedStream config: {0}")]
    InvalidDerivedStream(String),
    #[error("Reset only applied to scheduled pipelines")]
    PipelineDoesNotApply,
    #[error("Error deleting previous DerivedStream: {0}")]
    DeleteDerivedStream(String),
}

impl From<infra::errors::Error> for PipelineError {
    fn from(value: infra::errors::Error) -> Self {
        match value {
            infra::errors::Error::DbError(infra::errors::DbError::KeyNotExists(key)) => {
                PipelineError::NotFound(key)
            }
            error => PipelineError::InfraError(error),
        }
    }
}
