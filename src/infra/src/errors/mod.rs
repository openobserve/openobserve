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

use async_nats::{error::Error as NatsError, jetstream};
use config::utils::json;
use thiserror::Error as ThisError;
pub mod grpc;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(ThisError, Debug)]
#[allow(clippy::large_enum_variant)]
pub enum Error {
    #[error("IoError# {0}")]
    IoError(#[from] std::io::Error),
    #[error("DbError# {0}")]
    DbError(#[from] DbError),
    #[error("FromStrError# {0}")]
    FromStrError(#[from] FromStrError),
    #[error("FromI16Error# {0}")]
    FromI16Error(#[from] FromI16Error),
    #[error("SerdeJsonError# {0}")]
    SerdeJsonError(#[from] json::Error),
    #[error("ArrowError# {0}")]
    ArrowError(#[from] arrow::error::ArrowError),
    #[error("ParquetError# {0}")]
    ParquetError(#[from] parquet::errors::ParquetError),
    #[error("ObjectStoreError# {0}")]
    ObjectStoreError(#[from] object_store::Error),
    #[error("WatchError# watcher is exists {0}")]
    WatcherExists(String),
    #[error("StringUTF8Error# {0}")]
    StringUTF8Error(#[from] std::string::FromUtf8Error),
    #[error("SqlxError# {0}")]
    SqlxError(#[from] sqlx::Error),
    #[error("Error# {0}")]
    NatsKJetstreamContextRequestError(#[from] NatsError<jetstream::context::RequestErrorKind>),
    #[error("Error# {0}")]
    NatsJetstreamContextCreateKeyValueError(
        #[from] NatsError<jetstream::context::CreateKeyValueErrorKind>,
    ),
    #[error("Error# {0}")]
    NatsJetstreamKvEntryError(#[from] NatsError<jetstream::kv::EntryErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamKvPutError(#[from] NatsError<jetstream::kv::PutErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamKvUpdateError(#[from] NatsError<jetstream::kv::UpdateErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamKvWatchError(#[from] NatsError<jetstream::kv::WatchErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamKvWatcherError(#[from] NatsError<jetstream::kv::WatcherErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamKvStatusError(#[from] NatsError<jetstream::kv::StatusErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamCreateStreamError(#[from] NatsError<jetstream::context::CreateStreamErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamGetStreamError(#[from] NatsError<jetstream::context::GetStreamErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamPublishError(#[from] NatsError<jetstream::context::PublishErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamStreamConsumerError(#[from] NatsError<jetstream::stream::ConsumerErrorKind>),
    #[error("Error# {0}")]
    NatsKJetstreamConsumerStreamError(#[from] NatsError<jetstream::consumer::StreamErrorKind>),
    #[error("Error# {0}")]
    Message(String),
    #[error("DuplicateName# {0}")]
    DuplicateName(String),
    #[error("ReadOnly# {0}")]
    ReadOnly(String),
    #[error("ErrorCode# {0}")]
    ErrorCode(ErrorCodes),
    #[error("Not implemented")]
    NotImplemented,
    #[error("Unknown error")]
    Unknown,
    #[error("Error# {0}")]
    Reqwest(#[from] reqwest::Error),
    #[error("Error# {0}")]
    ResourceError(String),
    #[error("Error# {0}")]
    IngestionError(String),
    #[error("Error# {0}")]
    WalFileError(String),
    #[error("Error# {0}")]
    OtherError(#[from] anyhow::Error),
    #[error("Expired Trial Period")]
    TrialPeriodExpired,
}

unsafe impl Send for Error {}

#[derive(ThisError, Debug)]
#[error("cannot parse \"{value}\" as {ty}")]
pub struct FromStrError {
    pub value: String,
    pub ty: String,
}

#[derive(ThisError, Debug)]
#[error("cannot convert \"{value}\" to {ty}")]
pub struct FromI16Error {
    pub value: i16,
    pub ty: String,
}

#[derive(ThisError, Debug)]
pub enum DbError {
    #[error("key {0} does not exist")]
    KeyNotExists(String),
    #[error("error {0} performing operation on key {1}")]
    DBOperError(String, String),
    #[error("Unique constraint violation")]
    UniqueViolation,
    #[error("SeaORMError# {0}")]
    SeaORMError(String),
    #[error("error getting dashboard")]
    GetDashboardError(#[from] GetDashboardError),
    #[error("PutDashboard# {0}")]
    PutDashboard(#[from] PutDashboardError),
    #[error("DestinationError# {0}")]
    DestinationError(#[from] DestinationError),
    #[error("TemplateError# {0}")]
    TemplateError(#[from] TemplateError),
    #[error("PutAlert# {0}")]
    PutAlert(#[from] PutAlertError),
    #[error("PutAnomalyConfig# {0}")]
    PutAnomalyConfig(#[from] PutAnomalyConfigError),
}

#[derive(ThisError, Debug)]
pub enum GetDashboardError {
    #[error("dashboard in DB has version {0} which cannot be deserialized")]
    UnsupportedVersion(i32),
}

#[derive(ThisError, Debug)]
pub enum PutDashboardError {
    #[error("error putting dashboard with folder that does not exist")]
    FolderDoesNotExist,
    #[error("error putting dashboard with missing dashboard_id")]
    MissingDashboardId,
    #[error("error putting dashboard with missing title")]
    MissingTitle,
    #[error("error putting dashboard with missing owner")]
    MissingOwner,
    #[error("error putting dashboard with missing inner data for version {0}")]
    MissingInnerData(i32),
}

#[derive(ThisError, Debug)]
pub enum PutAnomalyConfigError {
    #[error("error creating anomaly config with folder that does not exist")]
    FolderDoesNotExist,
}

#[derive(ThisError, Debug)]
pub enum PutAlertError {
    #[error("cannot provide alert ID when creating an alert")]
    CreateAlertSetID,
    #[error("must provide alert ID when updating an alert")]
    UpdateAlertMissingID,
    #[error("alert to update not found")]
    UpdateAlertNotFound,
    #[error("error putting alert with folder that does not exist")]
    FolderDoesNotExist,
    #[error("cannot convert {0} into a trigger threshold operator")]
    IntoTriggerThresholdOperator(config::meta::alerts::Operator),
}

#[derive(ThisError, Debug)]
pub enum DestinationError {
    #[error("alert destination template not found")]
    AlertDestTemplateNotFound,
    #[error("alert destination in DB has empty template id")]
    AlertDestEmptyTemplateId,
    #[error("error converting destination id: {0}")]
    ConvertingId(String),
}

#[derive(ThisError, Debug)]
pub enum TemplateError {
    #[error("error converting template id: {0}")]
    ConvertingId(String),
}

#[derive(ThisError, Debug)]
pub enum ErrorCodes {
    ServerInternalError(String),
    SearchSQLNotValid(String),
    SearchStreamNotFound(String),
    FullTextSearchFieldNotFound,
    SearchFieldNotFound(String),
    SearchFunctionNotDefined(String),
    SearchParquetFileNotFound,
    SearchFieldHasNoCompatibleDataType(String),
    SearchSQLExecuteError(String),
    SearchCancelQuery(String),
    SearchTimeout(String),
    InvalidParams(String),
    RatelimitExceeded(String),
    SearchHistogramNotAvailable(String),
}

impl From<sea_orm::DbErr> for Error {
    fn from(value: sea_orm::DbErr) -> Self {
        Error::DbError(DbError::SeaORMError(value.to_string()))
    }
}

impl From<GetDashboardError> for Error {
    fn from(value: GetDashboardError) -> Self {
        Error::DbError(value.into())
    }
}

impl From<PutDashboardError> for Error {
    fn from(value: PutDashboardError) -> Self {
        Error::DbError(value.into())
    }
}

impl From<DestinationError> for Error {
    fn from(value: DestinationError) -> Self {
        Error::DbError(value.into())
    }
}

impl From<TemplateError> for Error {
    fn from(value: TemplateError) -> Self {
        Error::DbError(value.into())
    }
}

impl std::fmt::Display for ErrorCodes {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_json())
    }
}

impl ErrorCodes {
    pub fn get_code(&self) -> u16 {
        match self {
            ErrorCodes::ServerInternalError(_) => 10001,
            ErrorCodes::SearchSQLNotValid(_) => 20001,
            ErrorCodes::SearchStreamNotFound(_) => 20002,
            ErrorCodes::FullTextSearchFieldNotFound => 20003,
            ErrorCodes::SearchFieldNotFound(_) => 20004,
            ErrorCodes::SearchFunctionNotDefined(_) => 20005,
            ErrorCodes::SearchParquetFileNotFound => 20006,
            ErrorCodes::SearchFieldHasNoCompatibleDataType(_) => 20007,
            ErrorCodes::SearchSQLExecuteError(_) => 20008,
            ErrorCodes::SearchCancelQuery(_) => 20009,
            ErrorCodes::SearchTimeout(_) => 20010,
            ErrorCodes::InvalidParams(_) => 20011,
            ErrorCodes::RatelimitExceeded(_) => 20012,
            ErrorCodes::SearchHistogramNotAvailable(_) => 20013,
        }
    }

    pub fn get_message(&self) -> String {
        match self {
            ErrorCodes::ServerInternalError(_) => "Server Internal Error".to_string(),
            ErrorCodes::SearchSQLNotValid(_) => "Search SQL not valid".to_string(),
            ErrorCodes::SearchStreamNotFound(stream) => {
                format!("Search stream not found: {stream}")
            }
            ErrorCodes::FullTextSearchFieldNotFound => {
                "Full text search field not found".to_string()
            }
            ErrorCodes::SearchFieldNotFound(field) => format!("Search field not found: {field}"),
            ErrorCodes::SearchFunctionNotDefined(func) => {
                format!("Search function not defined: {func}")
            }
            ErrorCodes::SearchParquetFileNotFound => "Search parquet file not found".to_string(),
            ErrorCodes::SearchFieldHasNoCompatibleDataType(field) => {
                format!("Search field has no compatible data type: {field}")
            }
            ErrorCodes::SearchSQLExecuteError(_) => "Search SQL execute error".to_string(),
            ErrorCodes::SearchCancelQuery(_) => "Search query was cancelled".to_string(),
            ErrorCodes::SearchTimeout(_) => "Search query timed out".to_string(),
            ErrorCodes::InvalidParams(_) => "Invalid parameters".to_string(),
            ErrorCodes::RatelimitExceeded(_) => "Ratelimit exceeded".to_string(),
            ErrorCodes::SearchHistogramNotAvailable(_) => {
                "Search histogram not available".to_string()
            }
        }
    }

    pub fn get_inner_message(&self) -> String {
        match self {
            ErrorCodes::ServerInternalError(msg) => msg.to_owned(),
            ErrorCodes::SearchSQLNotValid(sql) => sql.to_owned(),
            ErrorCodes::SearchStreamNotFound(stream) => stream.to_owned(),
            ErrorCodes::FullTextSearchFieldNotFound => "".to_string(),
            ErrorCodes::SearchFieldNotFound(field) => field.to_owned(),
            ErrorCodes::SearchFunctionNotDefined(func) => func.to_owned(),
            ErrorCodes::SearchParquetFileNotFound => "".to_string(),
            ErrorCodes::SearchFieldHasNoCompatibleDataType(field) => field.to_owned(),
            ErrorCodes::SearchSQLExecuteError(msg) => msg.to_owned(),
            ErrorCodes::SearchCancelQuery(msg) => msg.to_owned(),
            ErrorCodes::SearchTimeout(msg) => msg.to_owned(),
            ErrorCodes::InvalidParams(msg) => msg.to_owned(),
            ErrorCodes::RatelimitExceeded(msg) => msg.to_owned(),
            ErrorCodes::SearchHistogramNotAvailable(msg) => msg.to_owned(),
        }
    }

    pub fn get_error_detail(&self) -> String {
        match self {
            ErrorCodes::ServerInternalError(msg) => msg.to_owned(),
            ErrorCodes::SearchSQLNotValid(sql) => sql.to_owned(),
            ErrorCodes::SearchStreamNotFound(_) => "".to_string(),
            ErrorCodes::FullTextSearchFieldNotFound => "".to_string(),
            ErrorCodes::SearchFieldNotFound(_) => "".to_string(),
            ErrorCodes::SearchFunctionNotDefined(_) => "".to_string(),
            ErrorCodes::SearchParquetFileNotFound => "".to_string(),
            ErrorCodes::SearchFieldHasNoCompatibleDataType(_) => "".to_string(),
            ErrorCodes::SearchSQLExecuteError(msg) => msg.to_owned(),
            ErrorCodes::SearchCancelQuery(msg) => msg.to_string(),
            ErrorCodes::SearchTimeout(msg) => msg.to_owned(),
            ErrorCodes::InvalidParams(msg) => msg.to_owned(),
            ErrorCodes::RatelimitExceeded(msg) => msg.to_owned(),
            ErrorCodes::SearchHistogramNotAvailable(msg) => msg.to_owned(),
        }
    }

    pub fn to_json(&self) -> String {
        let mut map = json::Map::new();
        map.insert("code".to_string(), json::Value::from(self.get_code()));
        map.insert("message".to_string(), json::Value::from(self.get_message()));
        map.insert(
            "inner".to_string(),
            json::Value::from(self.get_inner_message()),
        );
        json::Value::Object(map).to_string()
    }

    pub fn from_json(json: &str) -> Result<ErrorCodes> {
        let val: json::Value = match json::from_str(json) {
            Ok(val) => val,
            Err(_) => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
        };
        let map = match val.as_object() {
            Some(map) => map,
            None => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
        };
        let code = match map.get("code") {
            Some(code) => match code.as_i64() {
                Some(code) => code as u16,
                None => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
            },
            None => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
        };
        let message = match map.get("inner") {
            Some(message) => match message {
                json::Value::String(message) => message.to_owned(),
                _ => message.to_string(),
            },
            None => return Ok(ErrorCodes::ServerInternalError(json.to_string())),
        };
        match code {
            10001 => Ok(ErrorCodes::ServerInternalError(message)),
            20001 => Ok(ErrorCodes::SearchSQLNotValid(message)),
            20002 => Ok(ErrorCodes::SearchStreamNotFound(message)),
            20003 => Ok(ErrorCodes::FullTextSearchFieldNotFound),
            20004 => Ok(ErrorCodes::SearchFieldNotFound(message)),
            20005 => Ok(ErrorCodes::SearchFunctionNotDefined(message)),
            20006 => Ok(ErrorCodes::SearchParquetFileNotFound),
            20007 => Ok(ErrorCodes::SearchFieldHasNoCompatibleDataType(message)),
            20008 => Ok(ErrorCodes::SearchSQLExecuteError(message)),
            20009 => Ok(ErrorCodes::SearchCancelQuery(message)),
            20010 => Ok(ErrorCodes::SearchTimeout(message)),
            _ => Ok(ErrorCodes::ServerInternalError(json.to_string())),
        }
    }
}

#[derive(ThisError, Debug)]
pub enum JwtError {
    #[error("No matching JWK found for the given kid")]
    KeyNotExists(),
    #[error("Token doesn't have a {0} field")]
    MissingAttribute(String),
    #[error("Token can't be verified")]
    ValidationFailed(),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error() {
        let err = Error::Message("Ni! Try again.".to_string());
        assert_eq!("Error# Ni! Try again.", &err.to_string());

        let err = Error::from(DbError::KeyNotExists("/another/shrubbery".to_string()));
        assert_eq!(
            "DbError# key /another/shrubbery does not exist",
            &err.to_string()
        );
    }

    #[test]
    fn test_error_codes_get_code() {
        assert_eq!(
            ErrorCodes::ServerInternalError("x".into()).get_code(),
            10001
        );
        assert_eq!(ErrorCodes::SearchSQLNotValid("x".into()).get_code(), 20001);
        assert_eq!(
            ErrorCodes::SearchStreamNotFound("x".into()).get_code(),
            20002
        );
        assert_eq!(ErrorCodes::FullTextSearchFieldNotFound.get_code(), 20003);
        assert_eq!(
            ErrorCodes::SearchFieldNotFound("x".into()).get_code(),
            20004
        );
        assert_eq!(
            ErrorCodes::SearchFunctionNotDefined("x".into()).get_code(),
            20005
        );
        assert_eq!(ErrorCodes::SearchParquetFileNotFound.get_code(), 20006);
        assert_eq!(
            ErrorCodes::SearchFieldHasNoCompatibleDataType("x".into()).get_code(),
            20007
        );
        assert_eq!(
            ErrorCodes::SearchSQLExecuteError("x".into()).get_code(),
            20008
        );
        assert_eq!(ErrorCodes::SearchCancelQuery("x".into()).get_code(), 20009);
        assert_eq!(ErrorCodes::SearchTimeout("x".into()).get_code(), 20010);
        assert_eq!(ErrorCodes::InvalidParams("x".into()).get_code(), 20011);
        assert_eq!(ErrorCodes::RatelimitExceeded("x".into()).get_code(), 20012);
        assert_eq!(
            ErrorCodes::SearchHistogramNotAvailable("x".into()).get_code(),
            20013
        );
    }

    #[test]
    fn test_error_codes_get_message() {
        assert_eq!(
            ErrorCodes::SearchStreamNotFound("nginx".into()).get_message(),
            "Search stream not found: nginx"
        );
        assert_eq!(
            ErrorCodes::SearchFieldNotFound("level".into()).get_message(),
            "Search field not found: level"
        );
        assert_eq!(
            ErrorCodes::FullTextSearchFieldNotFound.get_message(),
            "Full text search field not found"
        );
        assert_eq!(
            ErrorCodes::ServerInternalError("oops".into()).get_message(),
            "Server Internal Error"
        );
    }

    #[test]
    fn test_error_codes_get_inner_message() {
        assert_eq!(
            ErrorCodes::SearchSQLNotValid("bad sql".into()).get_inner_message(),
            "bad sql"
        );
        assert_eq!(
            ErrorCodes::FullTextSearchFieldNotFound.get_inner_message(),
            ""
        );
        assert_eq!(
            ErrorCodes::SearchParquetFileNotFound.get_inner_message(),
            ""
        );
        assert_eq!(
            ErrorCodes::InvalidParams("missing field".into()).get_inner_message(),
            "missing field"
        );
    }

    #[test]
    fn test_error_codes_get_error_detail() {
        // variants where detail equals inner message
        assert_eq!(
            ErrorCodes::SearchSQLExecuteError("timeout".into()).get_error_detail(),
            "timeout"
        );
        // variants where detail is always empty
        assert_eq!(
            ErrorCodes::SearchStreamNotFound("stream".into()).get_error_detail(),
            ""
        );
        assert_eq!(
            ErrorCodes::FullTextSearchFieldNotFound.get_error_detail(),
            ""
        );
    }

    #[test]
    fn test_error_codes_to_json_and_from_json_roundtrip() {
        let variants = vec![
            ErrorCodes::ServerInternalError("internal msg".into()),
            ErrorCodes::SearchSQLNotValid("SELECT bad".into()),
            ErrorCodes::SearchStreamNotFound("my_stream".into()),
            ErrorCodes::SearchSQLExecuteError("exec err".into()),
            ErrorCodes::SearchCancelQuery("cancelled".into()),
            ErrorCodes::SearchTimeout("timed out".into()),
        ];

        for ec in variants {
            let json = ec.to_json();
            let restored = ErrorCodes::from_json(&json).unwrap();
            assert_eq!(ec.get_code(), restored.get_code());
            assert_eq!(ec.get_inner_message(), restored.get_inner_message());
        }
    }

    #[test]
    fn test_error_codes_from_json_invalid_input() {
        // non-JSON → falls back to ServerInternalError
        let result = ErrorCodes::from_json("not json at all").unwrap();
        assert!(matches!(result, ErrorCodes::ServerInternalError(_)));

        // unknown code → falls back to ServerInternalError
        let unknown_json = r#"{"code":99999,"message":"x","inner":"y"}"#;
        let result = ErrorCodes::from_json(unknown_json).unwrap();
        assert!(matches!(result, ErrorCodes::ServerInternalError(_)));
    }

    #[test]
    fn test_error_codes_display() {
        let ec = ErrorCodes::InvalidParams("bad input".into());
        let s = ec.to_string();
        // Display delegates to to_json(), so it should be valid JSON
        let parsed: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert_eq!(parsed["code"], 20011);
        assert_eq!(parsed["inner"], "bad input");
    }

    #[test]
    fn test_error_codes_from_json_codes_above_20010_fall_to_server_internal() {
        // from_json only handles codes up to 20010; 20011-20013 fall through
        for (code, inner) in [
            (20011, "invalid_params"),
            (20012, "rate_exceeded"),
            (20013, "histogram_unavail"),
        ] {
            let json = format!(r#"{{"code":{code},"message":"x","inner":"{inner}"}}"#);
            let result = ErrorCodes::from_json(&json).unwrap();
            // The fallback wraps the entire input JSON string, not the inner value
            match result {
                ErrorCodes::ServerInternalError(_) => {}
                other => panic!("expected ServerInternalError for code {code}, got {other:?}"),
            }
        }
    }

    #[test]
    fn test_from_get_dashboard_error_wraps_in_db_error() {
        let e = GetDashboardError::UnsupportedVersion(99);
        let err = Error::from(e);
        assert!(err.to_string().contains("DbError#"));
    }

    #[test]
    fn test_from_put_dashboard_error_wraps_in_db_error() {
        let e = PutDashboardError::FolderDoesNotExist;
        let err = Error::from(e);
        assert!(err.to_string().contains("DbError#"));
    }

    #[test]
    fn test_from_template_error_wraps_in_db_error() {
        let e = TemplateError::ConvertingId("bad-id".to_string());
        let err = Error::from(e);
        assert!(err.to_string().contains("DbError#"));
    }

    #[test]
    fn test_from_destination_error_wraps_in_db_error() {
        let e = DestinationError::AlertDestTemplateNotFound;
        let err = Error::from(e);
        assert!(err.to_string().contains("DbError#"));
    }

    #[test]
    fn test_error_codes_get_message_all_remaining_variants() {
        assert_eq!(
            ErrorCodes::SearchFunctionNotDefined("my_fn".into()).get_message(),
            "Search function not defined: my_fn"
        );
        assert_eq!(
            ErrorCodes::SearchParquetFileNotFound.get_message(),
            "Search parquet file not found"
        );
        assert_eq!(
            ErrorCodes::SearchFieldHasNoCompatibleDataType("ts".into()).get_message(),
            "Search field has no compatible data type: ts"
        );
        assert_eq!(
            ErrorCodes::SearchSQLExecuteError("err".into()).get_message(),
            "Search SQL execute error"
        );
        assert_eq!(
            ErrorCodes::RatelimitExceeded("too fast".into()).get_message(),
            "Ratelimit exceeded"
        );
        assert_eq!(
            ErrorCodes::SearchHistogramNotAvailable("msg".into()).get_message(),
            "Search histogram not available"
        );
    }
}
