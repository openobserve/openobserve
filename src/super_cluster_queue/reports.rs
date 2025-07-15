// Copyright 2025 Zinc Labs Inc.
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

use std::str::FromStr;

use infra::{
    db::{ORM_CLIENT, connect_to_orm},
    errors::Result,
    table,
};
use o2_enterprise::enterprise::super_cluster::queue::{Message, MessageType, ReportMessage};
use svix_ksuid::Ksuid;

pub(crate) async fn process(msg: Message) -> Result<()> {
    match msg.message_type {
        MessageType::ReportsTable => {
            let msg = msg.try_into()?;
            process_msg(msg).await?;
        }
        _ => {
            // Try to process the message as an old event for the meta table for backward
            // compatability. This logic can be removed after all logic reading and writing alerts
            // to the meta table is removed from the application.
            super::meta::process(msg).await?;
        }
    }

    Ok(())
}

pub(crate) async fn process_msg(msg: ReportMessage) -> Result<()> {
    let conn = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match msg {
        ReportMessage::Create {
            org_id,
            folder_id,
            report_id,
            report,
        } => {
            log::debug!("Creating report: {report:?}");
            if table::reports::get_by_name(conn, &org_id, &folder_id, &report.name)
                .await
                .map_err(|e| infra::errors::Error::Message(e.to_string()))?
                .is_some()
            {
                return Ok(());
            }
            let report_id = Ksuid::from_str(&report_id)
                .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
            table::reports::create_report(conn, &folder_id, report, Some(report_id))
                .await
                .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        ReportMessage::Update {
            org_id: _,
            folder_snowflake_id,
            new_folder_snowflake_id,
            report,
        } => {
            table::reports::update_report(
                conn,
                &folder_snowflake_id,
                new_folder_snowflake_id.as_deref(),
                report,
            )
            .await
            .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
        ReportMessage::Delete {
            org_id,
            folder_id,
            name,
        } => {
            if table::reports::get_by_name(conn, &org_id, &folder_id, &name)
                .await
                .map_err(|e| infra::errors::Error::Message(e.to_string()))?
                .is_some()
            {
                table::reports::delete_by_name(conn, &org_id, &folder_id, &name)
                    .await
                    .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
            }
        }
        ReportMessage::Reset => {
            table::reports::delete_all(conn)
                .await
                .map_err(|e| infra::errors::Error::Message(e.to_string()))?;
        }
    };
    Ok(())
}
