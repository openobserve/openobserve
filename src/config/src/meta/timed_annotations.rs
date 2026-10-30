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

#[cfg(test)]
mod tests {
    use super::*;

    fn annotation(
        start: i64,
        end: Option<i64>,
        title: &str,
        tags: &[&str],
        panels: &[&str],
    ) -> TimedAnnotation {
        TimedAnnotation {
            annotation_id: None,
            start_time: start,
            end_time: end,
            title: title.to_string(),
            text: None,
            tags: tags.iter().map(|s| s.to_string()).collect(),
            panels: panels.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn ok() -> Result<(), String> {
        Ok(())
    }

    fn err(msg: &str) -> Result<(), String> {
        Err(msg.to_string())
    }

    #[test]
    fn test_timed_annotation_req_validate() {
        let empty = TimedAnnotationReq {
            timed_annotations: vec![],
        };
        assert_eq!(empty.validate(), err("timed_annotations cannot be empty"));

        let valid = TimedAnnotationReq {
            timed_annotations: vec![annotation(1000, Some(2000), "t", &["a"], &["p"])],
        };
        assert_eq!(valid.validate(), ok());

        // The first invalid annotation's error is returned
        let invalid = TimedAnnotationReq {
            timed_annotations: vec![
                annotation(1000, None, "t", &[], &[]),
                annotation(1000, None, "", &[], &[]),
                annotation(1000, None, "t", &["a", ""], &[]),
            ],
        };
        assert_eq!(invalid.validate(), err("title cannot be empty"));
    }

    #[test]
    fn test_timed_annotation_validate() {
        let cases = [
            (
                annotation(1000, Some(2000), "t", &["a", "b"], &["p1", "p2"]),
                ok(),
            ),
            (annotation(1000, None, "t", &[], &[]), ok()),
            (
                annotation(1000, Some(1000), "t", &[], &[]),
                err("end time must be greater than start time"),
            ),
            (
                annotation(2000, Some(1000), "", &[], &[]),
                err("end time must be greater than start time"),
            ),
            (
                annotation(1000, Some(2000), "", &[], &[]),
                err("title cannot be empty"),
            ),
            (
                annotation(1000, None, "t", &[], &["p1", ""]),
                err("panel cannot be empty"),
            ),
            (
                annotation(1000, None, "t", &["a", ""], &[]),
                err("tag cannot be empty"),
            ),
        ];
        for (i, (a, want)) in cases.into_iter().enumerate() {
            assert_eq!(a.validate(), want, "case {i}");
        }
    }

    #[test]
    fn test_timed_annotation_delete_validate() {
        let ids = |v: &[&str]| TimedAnnotationDelete {
            annotation_ids: v.iter().map(|s| s.to_string()).collect(),
        };
        assert_eq!(ids(&[]).validate(), err("annotation_ids cannot be empty"));
        assert_eq!(ids(&["id1", "id2"]).validate(), ok());
    }

    #[test]
    fn test_timed_annotation_update_validate() {
        let update = |start: Option<i64>, end: Option<Option<i64>>, title: Option<&str>| {
            TimedAnnotationUpdate {
                start_time: start,
                end_time: end,
                title: title.map(str::to_string),
                text: None,
                tags: None,
                panels: None,
            }
        };
        let cases = [
            (
                update(None, None, None),
                err("At least one field must be present"),
            ),
            (update(None, None, Some("t")), ok()),
            (update(Some(1000), Some(Some(2000)), Some("t")), ok()),
            (update(Some(1000), Some(None), None), ok()),
            (
                update(None, Some(Some(2000)), Some("t")),
                err("start time must be present when end_time is specified"),
            ),
            (
                update(Some(2000), Some(Some(1000)), None),
                err("end time must be greater than start time"),
            ),
        ];
        for (i, (u, want)) in cases.into_iter().enumerate() {
            assert_eq!(u.validate(), want, "case {i}");
        }
    }

    #[test]
    fn test_list_timed_annotations_query_validate() {
        let query = |start, end| ListTimedAnnotationsQuery {
            panels: None,
            start_time: start,
            end_time: end,
        };
        assert_eq!(query(1000, 2000).validate(), ok());
        assert_eq!(
            query(1000, 1000).validate(),
            err("start time must be less than end time")
        );
        assert_eq!(
            query(2000, 1000).validate(),
            err("start time must be less than end time")
        );
    }

    #[test]
    fn test_list_timed_annotations_query_get_panels() {
        let cases: [(Option<&str>, Option<Vec<&str>>); 5] = [
            (None, None),
            (Some("p1"), Some(vec!["p1"])),
            (Some("p1,p2,p3"), Some(vec!["p1", "p2", "p3"])),
            (Some("p1,,p3,"), Some(vec!["p1", "p3"])),
            (Some(",,"), Some(vec![])),
        ];
        for (panels, want) in cases {
            let query = ListTimedAnnotationsQuery {
                panels: panels.map(str::to_string),
                start_time: 0,
                end_time: 1,
            };
            let want = want.map(|v| v.into_iter().map(str::to_string).collect::<Vec<_>>());
            assert_eq!(query.get_panels(), want, "panels {panels:?}");
        }
    }
}
