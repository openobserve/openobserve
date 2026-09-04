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

use config::meta::dashboards::reports::{
    ReportAttachmentDimensions, ReportDashboard as MetaReportDashboard,
};
use sea_orm::{ActiveValue::NotSet, ConnectionTrait, Set};

use super::{super::entity::report_dashboards, Error, intermediate, queries};

/// Takes the list of existing report-dashboard relations for a single report and the list of
/// desired report-dashboard relations for that report. Returns the list of report-dashboard
/// relations that need to be created to achieve the desired state of report-dashboard relations.
pub async fn relations_to_create<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    report_id: &str,
    existing_rltns: &[queries::JoinReportDashboardFolderResults],
    desired_rltns: &[MetaReportDashboard],
) -> Result<Vec<report_dashboards::ActiveModel>, Error> {
    // Find the desiered relations that don't exist yet.
    let missing_rltns = desired_rltns.iter().filter(|d| {
        !existing_rltns.iter().any(|e| {
            d.dashboard == e.dashboard_snowflake_id && d.folder == e.dashboard_folder_snowflake_id
        })
    });

    let mut to_create = vec![];
    for rltn in missing_rltns {
        let maybe_dashboard = crate::table::dashboards::get_model_from_folder(
            conn,
            org,
            &rltn.folder,
            &rltn.dashboard,
        )
        .await?
        .and_then(|(_folder, maybe_dashboard)| maybe_dashboard);
        let Some(dashboard) = maybe_dashboard else {
            return Err(Error::DashboardNotFound);
        };

        let updated_tab_names_intermediate: intermediate::TabNames = rltn.tabs.clone().into();
        let updated_tab_names_json = serde_json::to_value(updated_tab_names_intermediate)?;
        let tab_names = Set(updated_tab_names_json);

        let updated_variables_intermediate: intermediate::ReportDashboardVariables =
            rltn.variables.clone().into();
        let updated_variables_json: serde_json::Value =
            serde_json::to_value(updated_variables_intermediate)?;
        let variables = Set(updated_variables_json);

        let updated_timerange_intermediate: intermediate::ReportTimerange =
            rltn.timerange.clone().into();
        let updated_timerange_json: serde_json::Value =
            serde_json::to_value(updated_timerange_intermediate)?;
        let timerange = Set(updated_timerange_json);

        let report_type = Set(i16::from(rltn.report_type.clone()));
        let email_attachment_type = Set(i16::from(rltn.email_attachment_type.clone()));
        let attachment_dimensions = Set(rltn
            .attachment_dimensions
            .as_ref()
            .map(serde_json::to_value)
            .transpose()?);

        to_create.push(report_dashboards::ActiveModel {
            report_id: Set(report_id.to_owned()),
            dashboard_id: Set(dashboard.id.clone()),
            tab_names,
            variables,
            timerange,
            report_type,
            email_attachment_type,
            attachment_dimensions,
        });
    }

    Ok(to_create)
}

/// Takes the list of existing report-dashboard relations for a single report and the list of
/// desired report-dashboard relations for that report. Returns the list of report-dashboard
/// relations that need to be updated to achieve the desired state of report-dashboard relations.
pub fn relations_to_update(
    existing_rltns: &[queries::JoinReportDashboardFolderResults],
    desired_rltns: &[MetaReportDashboard],
) -> Result<Vec<report_dashboards::ActiveModel>, Error> {
    // Find the pairs of relations from the set of existing relations and the set of desired
    // relations that reference the same dashboard.
    let matching_rltns = desired_rltns.iter().filter_map(|d| {
        existing_rltns
            .iter()
            .find(|e| {
                d.dashboard == e.dashboard_snowflake_id
                    && d.folder == e.dashboard_folder_snowflake_id
            })
            .map(|e| (d, e))
    });

    let mut to_update = vec![];
    for (des_rltn, ex_rltn) in matching_rltns {
        // Compare the tab name lists from the existing and desired relations.
        let existing_tab_names_intermediate: intermediate::TabNames =
            serde_json::from_value(ex_rltn.report_dashboard_tab_names.clone())?;
        let updated_tab_names_intermediate: intermediate::TabNames = des_rltn.tabs.clone().into();
        let tab_names = if existing_tab_names_intermediate != updated_tab_names_intermediate {
            let updated_tab_names_json = serde_json::to_value(updated_tab_names_intermediate)?;
            Set(updated_tab_names_json)
        } else {
            NotSet
        };

        // Compare the variable lists from the existing and desired relations.
        let existing_variables_intermediate: intermediate::ReportDashboardVariables =
            serde_json::from_value(ex_rltn.report_dashboard_variables.clone())?;
        let updated_variables_intermediate: intermediate::ReportDashboardVariables =
            des_rltn.variables.clone().into();
        let variables = if existing_variables_intermediate != updated_variables_intermediate {
            let updated_variables_json: serde_json::Value =
                serde_json::to_value(updated_variables_intermediate)?;
            Set(updated_variables_json)
        } else {
            NotSet
        };

        // Compare the timeranges from the existing and desired relations.
        let existing_timerange_intermediate: intermediate::ReportTimerange =
            serde_json::from_value(ex_rltn.report_dashboard_timerange.clone())?;
        let updated_timerange_intermediate: intermediate::ReportTimerange =
            des_rltn.timerange.clone().into();
        let timerange = if existing_timerange_intermediate != updated_timerange_intermediate {
            let updated_timerange_json: serde_json::Value =
                serde_json::to_value(updated_timerange_intermediate)?;
            Set(updated_timerange_json)
        } else {
            NotSet
        };

        let existing_report_type = ex_rltn.report_dashboard_report_type;
        let desired_report_type = i16::from(des_rltn.report_type.clone());
        let report_type = if existing_report_type != desired_report_type {
            Set(desired_report_type)
        } else {
            NotSet
        };

        let existing_attachment_type = ex_rltn.report_dashboard_email_attachment_type;
        let desired_attachment_type = i16::from(des_rltn.email_attachment_type.clone());
        let email_attachment_type = if existing_attachment_type != desired_attachment_type {
            Set(desired_attachment_type)
        } else {
            NotSet
        };

        let existing_dims: Option<ReportAttachmentDimensions> = ex_rltn
            .report_dashboard_attachment_dimensions
            .as_ref()
            .and_then(|v| serde_json::from_value(v.clone()).ok());
        let attachment_dimensions = if existing_dims.as_ref().map(|d| (d.width, d.height))
            != des_rltn
                .attachment_dimensions
                .as_ref()
                .map(|d| (d.width, d.height))
        {
            Set(des_rltn
                .attachment_dimensions
                .as_ref()
                .map(serde_json::to_value)
                .transpose()?)
        } else {
            NotSet
        };

        if tab_names.is_not_set()
            && variables.is_not_set()
            && timerange.is_not_set()
            && report_type.is_not_set()
            && email_attachment_type.is_not_set()
            && attachment_dimensions.is_not_set()
        {
            continue;
        }

        to_update.push(report_dashboards::ActiveModel {
            report_id: Set(ex_rltn.report_id.clone()),
            dashboard_id: Set(ex_rltn.dashboard_id.clone()),
            tab_names,
            variables,
            timerange,
            report_type,
            email_attachment_type,
            attachment_dimensions,
        });
    }

    Ok(to_update)
}

/// Takes the list of existing report-dashboard relations for a single report and the list of
/// desired report-dashboard relations for that report. Returns the list of primary keys of
/// report-dashboard relations that need to be deleted to achieve the desired state of
/// report-dashboard relations.
///
/// Since the primary key of the `report_dashboards` table is a composite key, each returned primary
/// key is a tuple containing the `report_id` and `dashboard_id` of the `report_dashboards` record.
pub fn relations_to_delete(
    existing: &[queries::JoinReportDashboardFolderResults],
    desired: &[MetaReportDashboard],
) -> Vec<(String, String)> {
    existing
        .iter()
        .filter(|e| {
            !desired.iter().any(|d| {
                d.dashboard == e.dashboard_snowflake_id
                    && d.folder == e.dashboard_folder_snowflake_id
            })
        })
        .map(|e| (e.report_id.clone(), e.dashboard_id.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use config::meta::dashboards::reports::{
        ReportDashboard as MetaReportDashboard, ReportEmailAttachmentType, ReportMediaType,
        ReportTimerange,
    };

    use super::*;

    fn make_existing(
        report_id: &str,
        dashboard_id: &str,
        dashboard_snowflake_id: &str,
        folder_snowflake_id: &str,
    ) -> queries::JoinReportDashboardFolderResults {
        queries::JoinReportDashboardFolderResults {
            report_id: report_id.to_string(),
            report_dashboard_tab_names: serde_json::json!([]),
            report_dashboard_variables: serde_json::json!([]),
            report_dashboard_timerange: serde_json::json!({}),
            report_dashboard_report_type: 0,
            report_dashboard_email_attachment_type: 0,
            report_dashboard_attachment_dimensions: None,
            dashboard_id: dashboard_id.to_string(),
            dashboard_snowflake_id: dashboard_snowflake_id.to_string(),
            dashboard_folder_id: "fk1".to_string(),
            dashboard_folder_snowflake_id: folder_snowflake_id.to_string(),
        }
    }

    fn make_desired(dashboard: &str, folder: &str) -> MetaReportDashboard {
        MetaReportDashboard {
            dashboard: dashboard.to_string(),
            folder: folder.to_string(),
            tabs: vec![],
            variables: vec![],
            timerange: ReportTimerange::default(),
            report_type: ReportMediaType::default(),
            email_attachment_type: ReportEmailAttachmentType::default(),
            attachment_dimensions: None,
        }
    }

    #[test]
    fn test_relations_to_delete_empty_existing() {
        let result = relations_to_delete(&[], &[make_desired("dash1", "folder1")]);
        assert!(result.is_empty());
    }

    #[test]
    fn test_relations_to_delete_empty_desired_removes_all() {
        let existing = vec![
            make_existing("r1", "dk1", "dash1", "f1"),
            make_existing("r1", "dk2", "dash2", "f2"),
        ];
        let result = relations_to_delete(&existing, &[]);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_relations_to_delete_matching_kept() {
        let existing = vec![make_existing("r1", "dk1", "dash1", "folder1")];
        let desired = vec![make_desired("dash1", "folder1")];
        let result = relations_to_delete(&existing, &desired);
        assert!(result.is_empty());
    }

    #[test]
    fn test_relations_to_delete_partial_match() {
        let existing = vec![
            make_existing("r1", "dk1", "dash1", "f1"),
            make_existing("r1", "dk2", "dash2", "f2"),
        ];
        let desired = vec![make_desired("dash1", "f1")];
        let result = relations_to_delete(&existing, &desired);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], ("r1".to_string(), "dk2".to_string()));
    }

    #[test]
    fn test_relations_to_delete_folder_mismatch_counts_as_deletion() {
        // Same dashboard but different folder — not a match, should be deleted.
        let existing = vec![make_existing("r1", "dk1", "dash1", "folder_old")];
        let desired = vec![make_desired("dash1", "folder_new")];
        let result = relations_to_delete(&existing, &desired);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0], ("r1".to_string(), "dk1".to_string()));
    }
}
