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

use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TimedAnnotationReq {
    pub timed_annotations: Vec<TimedAnnotation>,
}

impl TimedAnnotationReq {
    pub fn validate(&self) -> Result<(), String> {
        if self.timed_annotations.is_empty() {
            return Err("timed_annotations cannot be empty".to_string());
        }

        self.timed_annotations
            .iter()
            .map(|annotation| annotation.validate())
            .collect::<Result<Vec<_>, _>>()?;

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TimedAnnotationRes {
    pub timed_annotation_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, Default)]
#[serde(default)]
pub struct TimedAnnotation {
    pub annotation_id: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
    pub title: String,
    pub text: Option<String>,
    pub tags: Vec<String>,
    pub panels: Vec<String>,
}

impl TimedAnnotation {
    pub fn validate(&self) -> Result<(), String> {
        if let Some(end_time) = self.end_time
            && end_time <= self.start_time
        {
            return Err("end time must be greater than start time".to_string());
        }

        if self.title.is_empty() {
            return Err("title cannot be empty".to_string());
        }

        if !self.panels.is_empty() && self.panels.iter().any(|panel| panel.is_empty()) {
            return Err("panel cannot be empty".to_string());
        }

        if !self.tags.is_empty() && self.tags.iter().any(|tag| tag.is_empty()) {
            return Err("tag cannot be empty".to_string());
        }

        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TimedAnnotationDelete {
    pub annotation_ids: Vec<String>,
}

impl TimedAnnotationDelete {
    pub fn validate(&self) -> Result<(), String> {
        if self.annotation_ids.is_empty() {
            return Err("annotation_ids cannot be empty".to_string());
        }

        Ok(())
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, ToSchema)]
pub struct TimedAnnotationUpdate {
    pub start_time: Option<i64>,
    pub end_time: Option<Option<i64>>,
    pub title: Option<String>,
    pub text: Option<String>,
    pub tags: Option<Vec<String>>,
    pub panels: Option<Vec<String>>,
}

impl TimedAnnotationUpdate {
    pub fn validate(&self) -> Result<(), String> {
        if self.start_time.is_none()
            && self.end_time.is_none()
            && self.title.is_none()
            && self.text.is_none()
            && self.tags.is_none()
            && self.panels.is_none()
        {
            return Err("At least one field must be present".to_string());
        }

        if let Some(Some(end_time)) = self.end_time {
            let Some(start_time) = self.start_time else {
                return Err("start time must be present when end_time is specified".to_string());
            };
            if end_time <= start_time {
                return Err("end time must be greater than start time".to_string());
            }
        }

        Ok(())
    }
}

#[derive(Debug, Deserialize, IntoParams)]
#[into_params(style = Form, parameter_in = Query)]
#[serde(rename_all = "snake_case")]
#[into_params(rename_all = "snake_case")]
pub struct ListTimedAnnotationsQuery {
    /// Commas separated list of panels
    pub panels: Option<String>,
    /// Time in microseconds
    pub start_time: i64,
    /// Time in microseconds
    pub end_time: i64,
}

impl ListTimedAnnotationsQuery {
    pub fn validate(&self) -> Result<(), String> {
        if self.start_time >= self.end_time {
            return Err("start time must be less than end time".to_string());
        }

        Ok(())
    }

    pub fn get_panels(&self) -> Option<Vec<String>> {
        self.panels.as_ref().map(|panels| {
            panels
                .split(',')
                .filter(|panel| !panel.is_empty())
                .map(|panel| panel.to_string())
                .collect()
        })
    }
}
