//! Module that contains a type that represents resources with which organizations or users can have
//! authorization relationships.

use std::fmt::Display;

use config::meta::{folder::FolderType, stream::StreamType};

/// Types of resources that organizations or users can have relationships with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectType {
    Action,
    Alert,
    AlertFolder,
    CipherKey,
    Dashboard,
    DashboardFolder,
    Destination,
    EnrichmentTableStream,
    FileListStream,
    Function,
    IndexStream,
    LogStream,
    MetadataStream,
    MetricStream,
    Pipeline,
    Report,
    ReportFolder,
    SavedView,
    Template,
    TraceStream,
}

impl Display for ObjectType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ObjectType::Action => "actions",
            ObjectType::Alert => "alerts",
            ObjectType::AlertFolder => todo!(),
            ObjectType::CipherKey => "cipher_keys",
            ObjectType::Dashboard => "dashboards",
            ObjectType::DashboardFolder => "dfolder",
            ObjectType::Destination => "destinations",
            ObjectType::EnrichmentTableStream => todo!(),
            ObjectType::FileListStream => todo!(),
            ObjectType::Function => todo!(),
            ObjectType::IndexStream => todo!(),
            ObjectType::LogStream => todo!(),
            ObjectType::MetadataStream => todo!(),
            ObjectType::MetricStream => todo!(),
            ObjectType::Pipeline => "pipelines",
            ObjectType::Report => todo!(),
            ObjectType::ReportFolder => todo!(),
            ObjectType::SavedView => "savedviews",
            ObjectType::Template => "templates",
            ObjectType::TraceStream => todo!(),
        };
        write!(f, "{s}")
    }
}

impl From<StreamType> for ObjectType {
    fn from(value: StreamType) -> Self {
        match value {
            StreamType::Logs => ObjectType::LogStream,
            StreamType::Metrics => ObjectType::MetricStream,
            StreamType::Traces => ObjectType::TraceStream,
            StreamType::EnrichmentTables => ObjectType::EnrichmentTableStream,
            StreamType::Filelist => ObjectType::FileListStream,
            StreamType::Metadata => ObjectType::MetadataStream,
            StreamType::Index => ObjectType::IndexStream,
        }
    }
}

impl From<FolderType> for ObjectType {
    fn from(value: FolderType) -> Self {
        match value {
            FolderType::Alerts => ObjectType::AlertFolder,
            FolderType::Dashboards => ObjectType::DashboardFolder,
        }
    }
}
