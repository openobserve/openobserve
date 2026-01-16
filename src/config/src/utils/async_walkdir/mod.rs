// Copyright 2020 Ririsoft <riri@ririsoft.com>
// Copyright 2024 Jordan Danford <jordandanford@gmail.com>
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

//! An utility for walking through a directory asynchronously and recursively.
//!
//! Based on [async-fs](https://docs.rs/async-fs) and [blocking](https://docs.rs/blocking),
//! it uses a thread pool to handle blocking IOs. Please refere to those crates for the rationale.
//! This crate is compatible with any async runtime based on [futures 0.3](https://docs.rs/futures-core),
//! which includes [tokio](https://docs.rs/tokio), [async-std](https://docs.rs/async-std) and [smol](https://docs.rs/smol).
//!
//! Symbolic links are walked through but they are not followed.
//!
//! # Example
//!
//! Recursively traverse a directory:
//!
//! ```
//! use async_walkdir::WalkDir;
//! use futures::{StreamExt, executor::block_on};
//!
//! block_on(async {
//!     let mut entries = WalkDir::new("my_directory");
//!     loop {
//!         match entries.next().await {
//!             Some(Ok(entry)) => println!("file: {}", entry.path().display()),
//!             Some(Err(e)) => {
//!                 eprintln!("error: {}", e);
//!                 break;
//!             }
//!             None => break,
//!         }
//!     }
//! });
//! ```
//!
//! Do not recurse through directories whose name starts with '.':
//!
//! ```
//! use async_walkdir::{Filtering, WalkDir};
//! use futures::{StreamExt, executor::block_on};
//!
//! block_on(async {
//!     let mut entries = WalkDir::new("my_directory").filter(|entry| async move {
//!         if let Some(true) = entry
//!             .path()
//!             .file_name()
//!             .map(|f| f.to_string_lossy().starts_with('.'))
//!         {
//!             return Filtering::IgnoreDir;
//!         }
//!         Filtering::Continue
//!     });
//!
//!     loop {
//!         match entries.next().await {
//!             Some(Ok(entry)) => println!("file: {}", entry.path().display()),
//!             Some(Err(e)) => {
//!                 eprintln!("error: {}", e);
//!                 break;
//!             }
//!             None => break,
//!         }
//!     }
//! });
//! ```

#![forbid(unsafe_code)]
#![deny(missing_docs)]

mod error;

use std::{
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    task::{Context, Poll},
};

use async_fs::{ReadDir, read_dir};
type BoxedFut<T> = futures::future::BoxFuture<'static, T>;
#[doc(no_inline)]
pub use async_fs::DirEntry;
pub use error::Error;
use error::InnerError;
use futures::{
    FutureExt, StreamExt,
    stream::{self, Stream},
};

/// A specialized [`Result`][`std::result::Result`] type.
pub type Result<T> = std::result::Result<T, Error>;

type BoxStream = futures::stream::BoxStream<'static, Result<DirEntry>>;

/// A `Stream` of `DirEntry` generated from recursively traversing
/// a directory.
///
/// Entries are returned without a specific ordering. The top most root directory
/// is not returned but child directories are.
///
/// # Panics
///
/// Panics if the directories depth overflows `usize`.
pub struct WalkDir {
    root: PathBuf,
    entries: BoxStream,
}

/// Sets the filtering behavior.
#[derive(Debug, PartialEq, Eq)]
pub enum Filtering {
    /// Ignore the current entry.
    Ignore,
    /// Ignore the current entry and, if a directory,
    /// do not traverse its childs.
    IgnoreDir,
    /// Continue the normal processing.
    Continue,
}

impl WalkDir {
    /// Returns a new `Walkdir` starting at `root`.
    pub fn new(root: impl AsRef<Path>) -> Self {
        Self {
            root: root.as_ref().to_owned(),
            entries: walk_dir(
                root,
                None::<Box<dyn FnMut(DirEntry) -> BoxedFut<Filtering> + Send>>,
            ),
        }
    }

    /// Filter entries.
    pub fn filter<F, Fut>(self, f: F) -> Self
    where
        F: FnMut(DirEntry) -> Fut + Send + 'static,
        Fut: Future<Output = Filtering> + Send,
    {
        let root = self.root.clone();
        Self {
            root: self.root,
            entries: walk_dir(root, Some(f)),
        }
    }
}

impl Stream for WalkDir {
    type Item = Result<DirEntry>;

    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let entries = Pin::new(&mut self.entries);
        entries.poll_next(cx)
    }
}

fn walk_dir<F, Fut>(root: impl AsRef<Path>, filter: Option<F>) -> BoxStream
where
    F: FnMut(DirEntry) -> Fut + Send + 'static,
    Fut: Future<Output = Filtering> + Send,
{
    stream::unfold(
        State::Start((root.as_ref().to_owned(), filter)),
        move |state| async move {
            match state {
                State::Start((root, filter)) => match read_dir(&root).await {
                    Err(source) => Some((
                        Err(InnerError::Io { path: root, source }.into()),
                        State::Done,
                    )),
                    Ok(rd) => walk(vec![(root, rd)], filter).await,
                },
                State::Walk((dirs, filter)) => walk(dirs, filter).await,
                State::Done => None,
            }
        },
    )
    .boxed()
}

enum State<F> {
    Start((PathBuf, Option<F>)),
    Walk((Vec<(PathBuf, ReadDir)>, Option<F>)),
    Done,
}

type UnfoldState<F> = (Result<DirEntry>, State<F>);

fn walk<F, Fut>(
    mut dirs: Vec<(PathBuf, ReadDir)>,
    filter: Option<F>,
) -> BoxedFut<Option<UnfoldState<F>>>
where
    F: FnMut(DirEntry) -> Fut + Send + 'static,
    Fut: Future<Output = Filtering> + Send,
{
    async move {
        if let Some((path, dir)) = dirs.last_mut() {
            let path_clone = path.clone();
            match dir.next().await {
                Some(Ok(entry)) => walk_entry(entry, dirs, filter).await,
                Some(Err(source)) => Some((
                    Err(InnerError::Io {
                        path: path_clone,
                        source,
                    }
                    .into()),
                    State::Walk((dirs, filter)),
                )),
                None => {
                    dirs.pop();
                    walk(dirs, filter).await
                }
            }
        } else {
            None
        }
    }
    .boxed()
}

fn walk_entry<F, Fut>(
    entry: DirEntry,
    mut dirs: Vec<(PathBuf, ReadDir)>,
    mut filter: Option<F>,
) -> BoxedFut<Option<UnfoldState<F>>>
where
    F: FnMut(DirEntry) -> Fut + Send + 'static,
    Fut: Future<Output = Filtering> + Send,
{
    async move {
        match entry.file_type().await {
            Err(source) => Some((
                Err(InnerError::Io {
                    path: entry.path(),
                    source,
                }
                .into()),
                State::Walk((dirs, filter)),
            )),
            Ok(ft) => {
                let filtering = match filter.as_mut() {
                    Some(filter) => filter(entry.clone()).await,
                    None => Filtering::Continue,
                };
                if ft.is_dir() {
                    let path = entry.path();
                    let rd = match read_dir(&path).await {
                        Err(source) => {
                            return Some((
                                Err(InnerError::Io { path, source }.into()),
                                State::Walk((dirs, filter)),
                            ));
                        }
                        Ok(rd) => rd,
                    };
                    if filtering != Filtering::IgnoreDir {
                        dirs.push((path, rd));
                    }
                }
                match filtering {
                    Filtering::Continue => Some((Ok(entry), State::Walk((dirs, filter)))),
                    Filtering::IgnoreDir | Filtering::Ignore => walk(dirs, filter).await,
                }
            }
        }
    }
    .boxed()
}

#[cfg(test)]
mod tests {
    use std::io::{ErrorKind, Result};

    use futures::{StreamExt, executor::block_on};

    use super::{Filtering, WalkDir};

    #[test]
    fn walk_dir_empty() -> Result<()> {
        block_on(async {
            let root = tempfile::tempdir()?;
            let mut wd = WalkDir::new(root.path());
            assert!(wd.next().await.is_none());
            Ok(())
        })
    }

    #[test]
    fn walk_dir_not_exist() {
        block_on(async {
            let mut wd = WalkDir::new("foobar");
            match wd.next().await.unwrap() {
                Err(e) => {
                    assert_eq!(wd.root, e.path().unwrap());
                    assert_eq!(e.io().unwrap().kind(), ErrorKind::NotFound);
                    assert_eq!(e.into_io().unwrap().kind(), ErrorKind::NotFound);
                }
                _ => panic!("want IO error"),
            }
        })
    }

    #[test]
    fn into_io_error() {
        block_on(async {
            let mut wd = WalkDir::new("foobar");
            match wd.next().await.unwrap() {
                Err(e) => {
                    let e: std::io::Error = e.into();
                    assert_eq!(e.kind(), ErrorKind::NotFound);
                }
                _ => panic!("want IO error"),
            }
        })
    }

    #[test]
    fn walk_dir_files() -> Result<()> {
        block_on(async {
            let root = tempfile::tempdir()?;
            let f1 = root.path().join("f1.txt");
            let d1 = root.path().join("d1");
            let f2 = d1.join("f2.txt");
            let d2 = d1.join("d2");
            let f3 = d2.join("f3.txt");

            async_fs::create_dir_all(&d2).await?;
            async_fs::write(&f1, []).await?;
            async_fs::write(&f2, []).await?;
            async_fs::write(&f3, []).await?;

            let want = vec![
                d1.to_owned(),
                d2.to_owned(),
                f3.to_owned(),
                f2.to_owned(),
                f1.to_owned(),
            ];
            let mut wd = WalkDir::new(root.path());

            let mut got = Vec::new();
            while let Some(entry) = wd.next().await {
                let entry = entry.unwrap();
                got.push(entry.path());
            }
            got.sort();
            assert_eq!(got, want);

            Ok(())
        })
    }

    #[test]
    fn filter_dirs() -> Result<()> {
        block_on(async {
            let root = tempfile::tempdir()?;
            let f1 = root.path().join("f1.txt");
            let d1 = root.path().join("d1");
            let f2 = d1.join("f2.txt");
            let d2 = d1.join("d2");
            let f3 = d2.join("f3.txt");

            async_fs::create_dir_all(&d2).await?;
            async_fs::write(&f1, []).await?;
            async_fs::write(&f2, []).await?;
            async_fs::write(&f3, []).await?;

            let want = vec![f3.to_owned(), f2.to_owned(), f1.to_owned()];

            let mut wd = WalkDir::new(root.path()).filter(|entry| async move {
                match entry.file_type().await {
                    Ok(ft) if ft.is_dir() => Filtering::Ignore,
                    _ => Filtering::Continue,
                }
            });

            let mut got = Vec::new();
            while let Some(entry) = wd.next().await {
                let entry = entry.unwrap();
                got.push(entry.path());
            }
            got.sort();
            assert_eq!(got, want);

            Ok(())
        })
    }

    #[test]
    fn filter_dirs_no_traverse() -> Result<()> {
        block_on(async {
            let root = tempfile::tempdir()?;
            let f1 = root.path().join("f1.txt");
            let d1 = root.path().join("d1");
            let f2 = d1.join("f2.txt");
            let d2 = d1.join("d2");
            let f3 = d2.join("f3.txt");

            async_fs::create_dir_all(&d2).await?;
            async_fs::write(&f1, []).await?;
            async_fs::write(&f2, []).await?;
            async_fs::write(&f3, []).await?;

            let want = vec![d1, f2.to_owned(), f1.to_owned()];

            let mut wd = WalkDir::new(root.path()).filter(move |entry| {
                let d2 = d2.clone();
                async move {
                    if entry.path() == d2 {
                        Filtering::IgnoreDir
                    } else {
                        Filtering::Continue
                    }
                }
            });

            let mut got = Vec::new();
            while let Some(entry) = wd.next().await {
                let entry = entry.unwrap();
                got.push(entry.path());
            }
            got.sort();
            assert_eq!(got, want);

            Ok(())
        })
    }
}

#[cfg(all(unix, test))]
mod test_unix {
    use std::io::Result;

    use async_fs::unix::PermissionsExt;
    use futures::{StreamExt, executor::block_on};

    use super::WalkDir;
    #[test]
    fn walk_dir_error_path() -> Result<()> {
        block_on(async {
            let root = tempfile::tempdir()?;
            let d1 = root.path().join("d1");
            async_fs::create_dir_all(&d1).await?;
            let mut perms = async_fs::metadata(&d1).await?.permissions();
            perms.set_mode(0o222);
            async_fs::set_permissions(&d1, perms).await?;
            let mut wd = WalkDir::new(&root);
            match wd.next().await.unwrap() {
                Err(e) => assert_eq!(e.path().unwrap(), d1.as_path()),
                _ => panic!("want IO error"),
            }
            Ok(())
        })
    }
}
