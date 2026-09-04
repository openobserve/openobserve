// SPDX-FileCopyrightText: 2020-2024 Ririsoft <riri@ririsoft.com>
// SPDX-FileCopyrightText: 2024 Jordan Danford <jordandanford@gmail.com>
// SPDX-License-Identifier: Apache-2.0

use std::{
    io,
    path::{Path, PathBuf},
};

use thiserror::Error;

#[derive(Debug, Error)]
#[error(transparent)]
/// An error produced during a directory tree traversal.
pub struct Error(#[from] InnerError);

impl Error {
    /// Returns the path where the error occured if it applies,
    /// for instance during IO operations.
    pub fn path(&self) -> Option<&Path> {
        let InnerError::Io { ref path, .. } = self.0;
        Some(path)
    }

    /// Returns the original [`io::Error`] if any.
    pub fn io(&self) -> Option<&io::Error> {
        let InnerError::Io { ref source, .. } = self.0;
        Some(source)
    }

    /// Similar to [`io`][Self::io] except consumes self to convert to the original
    /// [`io::Error`] if one exists.
    pub fn into_io(self) -> Option<io::Error> {
        let InnerError::Io { source, .. } = self.0;
        Some(source)
    }
}

impl From<Error> for io::Error {
    /// Convert to an [`io::Error`], preserving the original [`struct@Error`]
    /// as the ["inner error"][io::Error::into_inner].
    /// Note that this also makes the display of the error include the context.
    ///
    /// This is different from [`into_io`][Error::into_io] which returns
    /// the original [`io::Error`].
    fn from(err: Error) -> io::Error {
        let InnerError::Io { ref source, .. } = err.0;
        io::Error::new(source.kind(), err)
    }
}

#[derive(Debug, Error)]
pub enum InnerError {
    #[error("IO error at '{path}': {source}")]
    /// A error produced during an IO operation.
    Io {
        /// The path in the directory tree where the IO error occured.
        path: PathBuf,
        /// The IO error.
        source: io::Error,
    },
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use super::*;

    fn make_error(path: &str) -> Error {
        Error(InnerError::Io {
            path: PathBuf::from(path),
            source: io::Error::new(io::ErrorKind::NotFound, "not found"),
        })
    }

    #[test]
    fn test_path_returns_error_path() {
        let err = make_error("/some/path");
        assert_eq!(err.path().unwrap(), Path::new("/some/path"));
    }

    #[test]
    fn test_io_returns_io_error_with_correct_kind() {
        let err = make_error("/some/path");
        assert_eq!(err.io().unwrap().kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn test_into_io_consumes_and_returns_io_error() {
        let err = make_error("/tmp/file");
        let io_err = err.into_io().unwrap();
        assert_eq!(io_err.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn test_from_error_for_io_error_preserves_kind() {
        let err = make_error("/some/path");
        let io_err = io::Error::from(err);
        assert_eq!(io_err.kind(), io::ErrorKind::NotFound);
    }
}
