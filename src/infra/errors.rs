use thiserror::Error as ThisError;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(ThisError, Debug)]
pub enum Error {
    #[error("DbError# {0}")]
    DbError(#[from] DbError),
    #[error("EtcdError# {0}")]
    EtcdError(#[from] etcd_client::Error),
    #[error("SledError# {0}")]
    SledError(#[from] sled::Error),
    #[error("SerdeJsonError# {0}")]
    SerdeJsonError(#[from] serde_json::Error),
    #[error("SimdJsonError# {0}")]
    SimdJsonError(#[from] simd_json::Error),
    #[error("Error# watcher is exists {0}")]
    WatcherExists(String),
    #[error("Error# {0}")]
    Message(String),
    #[error("Not implemented")]
    NotImplemented,
    #[error("Unknown error")]
    Unknown,
}

#[derive(ThisError, Debug)]
pub enum DbError {
    #[error("key:{0} not exists")]
    KeyNotExists(String),
}
