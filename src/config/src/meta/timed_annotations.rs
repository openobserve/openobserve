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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_timed_annotation_req_validate_empty() {
        let req = TimedAnnotationReq {
            timed_annotations: vec![],
        };
        assert_eq!(
            req.validate().unwrap_err(),
            "timed_annotations cannot be empty"
        );
    }

    #[test]
    fn test_timed_annotation_req_validate_valid() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 1000,
            end_time: Some(2000),
            title: "Test Annotation".to_string(),
            text: Some("Test description".to_string()),
            tags: vec!["tag1".to_string(), "tag2".to_string()],
            panels: vec!["panel1".to_string()],
        };

        let req = TimedAnnotationReq {
            timed_annotations: vec![annotation],
        };
        assert!(req.validate().is_ok());
    }

    #[test]
    fn test_timed_annotation_req_validate_invalid_annotation() {
        let invalid_annotation = TimedAnnotation {
            annotation_id: None,
            start_time: 2000,
            end_time: Some(1000),  // Invalid: end_time <= start_time
            title: "".to_string(), // Invalid: empty title
            text: None,
            tags: vec![],
            panels: vec![],
        };

        let req = TimedAnnotationReq {
            timed_annotations: vec![invalid_annotation],
        };
        assert!(req.validate().is_err());
    }

    #[test]
    fn test_timed_annotation_validate_valid() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 1000,
            end_time: Some(2000),
            title: "Valid Title".to_string(),
            text: Some("Valid description".to_string()),
            tags: vec!["tag1".to_string(), "tag2".to_string()],
            panels: vec!["panel1".to_string(), "panel2".to_string()],
        };
        assert!(annotation.validate().is_ok());
    }

    #[test]
    fn test_timed_annotation_validate_no_end_time() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 1000,
            end_time: None, // Valid: no end time
            title: "Valid Title".to_string(),
            text: Some("Valid description".to_string()),
            tags: vec!["tag1".to_string()],
            panels: vec!["panel1".to_string()],
        };
        assert!(annotation.validate().is_ok());
    }

    #[test]
    fn test_timed_annotation_validate_invalid_end_time() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 2000,
            end_time: Some(1000), // Invalid: end_time <= start_time
            title: "Valid Title".to_string(),
            text: None,
            tags: vec![],
            panels: vec![],
        };
        assert_eq!(
            annotation.validate().unwrap_err(),
            "end time must be greater than start time"
        );
    }

    #[test]
    fn test_timed_annotation_validate_equal_end_time() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 1000,
            end_time: Some(1000), // Invalid: end_time == start_time
            title: "Valid Title".to_string(),
            text: None,
            tags: vec![],
            panels: vec![],
        };
        assert_eq!(
            annotation.validate().unwrap_err(),
            "end time must be greater than start time"
        );
    }

    #[test]
    fn test_timed_annotation_validate_empty_title() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 1000,
            end_time: Some(2000),
            title: "".to_string(), // Invalid: empty title
            text: None,
            tags: vec![],
            panels: vec![],
        };
        assert_eq!(annotation.validate().unwrap_err(), "title cannot be empty");
    }

    #[test]
    fn test_timed_annotation_validate_empty_panel() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 1000,
            end_time: Some(2000),
            title: "Valid Title".to_string(),
            text: None,
            tags: vec![],
            panels: vec!["panel1".to_string(), "".to_string()], // Invalid: empty panel
        };
        assert_eq!(annotation.validate().unwrap_err(), "panel cannot be empty");
    }

    #[test]
    fn test_timed_annotation_validate_empty_tag() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 1000,
            end_time: Some(2000),
            title: "Valid Title".to_string(),
            text: None,
            tags: vec!["tag1".to_string(), "".to_string()], // Invalid: empty tag
            panels: vec![],
        };
        assert_eq!(annotation.validate().unwrap_err(), "tag cannot be empty");
    }

    #[test]
    fn test_timed_annotation_delete_validate_empty() {
        let delete_req = TimedAnnotationDelete {
            annotation_ids: vec![],
        };
        assert_eq!(
            delete_req.validate().unwrap_err(),
            "annotation_ids cannot be empty"
        );
    }

    #[test]
    fn test_timed_annotation_delete_validate_valid() {
        let delete_req = TimedAnnotationDelete {
            annotation_ids: vec!["id1".to_string(), "id2".to_string()],
        };
        assert!(delete_req.validate().is_ok());
    }

    #[test]
    fn test_timed_annotation_update_validate_empty() {
        let update_req = TimedAnnotationUpdate {
            start_time: None,
            end_time: None,
            title: None,
            text: None,
            tags: None,
            panels: None,
        };
        assert_eq!(
            update_req.validate().unwrap_err(),
            "At least one field must be present"
        );
    }

    #[test]
    fn test_timed_annotation_update_validate_valid_single_field() {
        let update_req = TimedAnnotationUpdate {
            start_time: None,
            end_time: None,
            title: Some("New Title".to_string()),
            text: None,
            tags: None,
            panels: None,
        };
        assert!(update_req.validate().is_ok());
    }

    #[test]
    fn test_timed_annotation_update_validate_valid_with_times() {
        let update_req = TimedAnnotationUpdate {
            start_time: Some(1000),
            end_time: Some(Some(2000)),
            title: Some("Updated Title".to_string()),
            text: Some("Updated text".to_string()),
            tags: Some(vec!["new_tag".to_string()]),
            panels: Some(vec!["new_panel".to_string()]),
        };
        assert!(update_req.validate().is_ok());
    }

    #[test]
    fn test_timed_annotation_update_validate_no_start_time_with_end_time() {
        let update_req = TimedAnnotationUpdate {
            start_time: None,
            end_time: Some(Some(2000)), // Invalid: end_time without start_time
            title: Some("Title".to_string()),
            text: None,
            tags: None,
            panels: None,
        };
        assert_eq!(
            update_req.validate().unwrap_err(),
            "start time must be present when end_time is specified"
        );
    }

    #[test]
    fn test_timed_annotation_update_validate_invalid_time_range() {
        let update_req = TimedAnnotationUpdate {
            start_time: Some(2000),
            end_time: Some(Some(1000)), // Invalid: end_time <= start_time
            title: Some("Title".to_string()),
            text: None,
            tags: None,
            panels: None,
        };
        assert_eq!(
            update_req.validate().unwrap_err(),
            "end time must be greater than start time"
        );
    }

    #[test]
    fn test_timed_annotation_update_validate_none_end_time() {
        let update_req = TimedAnnotationUpdate {
            start_time: Some(1000),
            end_time: Some(None), // Valid: explicitly setting end_time to None
            title: Some("Title".to_string()),
            text: None,
            tags: None,
            panels: None,
        };
        assert!(update_req.validate().is_ok());
    }

    #[test]
    fn test_list_timed_annotations_query_validate_invalid_time_range() {
        let query = ListTimedAnnotationsQuery {
            panels: None,
            start_time: 2000,
            end_time: 1000, // Invalid: start_time >= end_time
        };
        assert_eq!(
            query.validate().unwrap_err(),
            "start time must be less than end time"
        );
    }

    #[test]
    fn test_list_timed_annotations_query_validate_equal_times() {
        let query = ListTimedAnnotationsQuery {
            panels: None,
            start_time: 1000,
            end_time: 1000, // Invalid: start_time == end_time
        };
        assert_eq!(
            query.validate().unwrap_err(),
            "start time must be less than end time"
        );
    }

    #[test]
    fn test_list_timed_annotations_query_validate_valid() {
        let query = ListTimedAnnotationsQuery {
            panels: Some("panel1,panel2".to_string()),
            start_time: 1000,
            end_time: 2000,
        };
        assert!(query.validate().is_ok());
    }

    #[test]
    fn test_list_timed_annotations_query_get_panels_none() {
        let query = ListTimedAnnotationsQuery {
            panels: None,
            start_time: 1000,
            end_time: 2000,
        };
        assert_eq!(query.get_panels(), None);
    }

    #[test]
    fn test_list_timed_annotations_query_get_panels_single() {
        let query = ListTimedAnnotationsQuery {
            panels: Some("panel1".to_string()),
            start_time: 1000,
            end_time: 2000,
        };
        assert_eq!(query.get_panels(), Some(vec!["panel1".to_string()]));
    }

    #[test]
    fn test_list_timed_annotations_query_get_panels_multiple() {
        let query = ListTimedAnnotationsQuery {
            panels: Some("panel1,panel2,panel3".to_string()),
            start_time: 1000,
            end_time: 2000,
        };
        assert_eq!(
            query.get_panels(),
            Some(vec![
                "panel1".to_string(),
                "panel2".to_string(),
                "panel3".to_string()
            ])
        );
    }

    #[test]
    fn test_list_timed_annotations_query_get_panels_with_empty() {
        let query = ListTimedAnnotationsQuery {
            panels: Some("panel1,,panel3,".to_string()),
            start_time: 1000,
            end_time: 2000,
        };
        assert_eq!(
            query.get_panels(),
            Some(vec!["panel1".to_string(), "panel3".to_string()])
        );
    }

    #[test]
    fn test_list_timed_annotations_query_get_panels_all_empty() {
        let query = ListTimedAnnotationsQuery {
            panels: Some(",,".to_string()),
            start_time: 1000,
            end_time: 2000,
        };
        assert_eq!(query.get_panels(), Some(vec![]));
    }

    #[test]
    fn test_serialization_deserialization() {
        let annotation = TimedAnnotation {
            annotation_id: Some("test_id".to_string()),
            start_time: 1640995200000,
            end_time: Some(1640995260000),
            title: "Test Annotation".to_string(),
            text: Some("This is a test annotation".to_string()),
            tags: vec!["maintenance".to_string(), "deployment".to_string()],
            panels: vec!["cpu_usage".to_string(), "memory_usage".to_string()],
        };

        // Test serialization
        let json = serde_json::to_string(&annotation).expect("Failed to serialize");
        assert!(!json.is_empty());

        // Test deserialization
        let deserialized: TimedAnnotation =
            serde_json::from_str(&json).expect("Failed to deserialize");
        assert_eq!(deserialized.annotation_id, annotation.annotation_id);
        assert_eq!(deserialized.start_time, annotation.start_time);
        assert_eq!(deserialized.end_time, annotation.end_time);
        assert_eq!(deserialized.title, annotation.title);
        assert_eq!(deserialized.text, annotation.text);
        assert_eq!(deserialized.tags, annotation.tags);
        assert_eq!(deserialized.panels, annotation.panels);
    }

    #[test]
    fn test_timed_annotation_res_creation() {
        let response = TimedAnnotationRes {
            timed_annotation_ids: vec!["id1".to_string(), "id2".to_string(), "id3".to_string()],
        };

        assert_eq!(response.timed_annotation_ids.len(), 3);
        assert_eq!(response.timed_annotation_ids[0], "id1");
        assert_eq!(response.timed_annotation_ids[1], "id2");
        assert_eq!(response.timed_annotation_ids[2], "id3");
    }
}
