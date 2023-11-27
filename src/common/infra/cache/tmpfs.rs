// Copyright 2023 Zinc Labs Inc.
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

use bytes::Bytes;
use chrono::{DateTime, Utc};
use once_cell::sync::Lazy;
use uuid::Uuid;

use crate::common::infra::config::RwHashMap;
use crate::common::infra::errors::*;

static FILES: Lazy<RwHashMap<String, File>> = Lazy::new(Default::default);
static DATA: Lazy<RwHashMap<String, Bytes>> = Lazy::new(Default::default);

const STRING_SIZE: usize = std::mem::size_of::<String>();
const BYTES_SIZE: usize = std::mem::size_of::<bytes::Bytes>();
const FILE_SIZE: usize = std::mem::size_of::<File>();

#[derive(Clone)]
pub struct File {
    pub location: String,
    pub size: usize,
    pub last_modified: DateTime<Utc>,
}

pub struct Directory {
    location: String,
}

impl Directory {
    pub fn new(location: String) -> Self {
        Self { location }
    }
    pub fn name(&self) -> &str {
        &self.location
    }
    pub fn set(&self, path: &str, data: Bytes) -> Result<()> {
        let key = format!("/{}/{}", self.location, path);
        set(&key, data)
    }
}

impl Default for Directory {
    fn default() -> Self {
        Self {
            location: Uuid::new_v4().to_string(),
        }
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        delete(&format!("/{}/", self.location), true).unwrap();
    }
}

pub fn list(path: &str) -> Result<Vec<File>> {
    let path = format_key(path);
    Ok(FILES
        .iter()
        .filter_map(|x| {
            if x.key().starts_with(&path) {
                Some(x.value().clone())
            } else {
                None
            }
        })
        .collect::<Vec<File>>())
}

pub fn empty(path: &str) -> bool {
    let path = format_key(path);
    FILES.iter().all(|x| x.key().starts_with(&path))
}

pub fn get(path: &str) -> Result<Bytes> {
    let path = format_key(path);
    match DATA.get(&path) {
        Some(data) => Ok(data.to_owned()),
        None => Err(Error::from(DbError::KeyNotExists(path.to_string()))),
    }
}

pub fn set(path: &str, data: Bytes) -> Result<()> {
    let path = format_key(path);
    let size = data.len();
    DATA.insert(path.clone(), data);
    FILES.insert(
        path.clone(),
        File {
            location: path,
            size,
            last_modified: Utc::now(),
        },
    );
    Ok(())
}

pub fn delete(path: &str, prefix: bool) -> Result<()> {
    let path = format_key(path);
    if !prefix {
        FILES.remove(&path);
        DATA.remove(&path);
    } else {
        let files = list(&path)?;
        for f in files {
            FILES.remove(&f.location);
            DATA.remove(&f.location);
        }
    }
    FILES.shrink_to_fit();
    DATA.shrink_to_fit();
    Ok(())
}

pub fn stats() -> Result<usize> {
    let mut size = 0;
    FILES.iter().for_each(|x| {
        size += x.key().len() + x.value().location.len() + STRING_SIZE + FILE_SIZE;
    });
    DATA.iter().for_each(|x| {
        size += x.key().len() + x.value().len() + STRING_SIZE + BYTES_SIZE;
    });
    Ok(size)
}

fn format_key(path: &str) -> String {
    if !path.is_empty() && !path.starts_with('/') {
        format!("/{path}")
    } else {
        path.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_set_get() {
        let data = Bytes::from("hello world");
        set("/hello1", data.clone()).unwrap();
        assert_eq!(get("/hello1").unwrap(), data);
    }

    #[test]
    fn test_delete() {
        let data = Bytes::from("hello world");
        set("/hello2", data.clone()).unwrap();
        assert_eq!(get("/hello2").unwrap(), data);
        delete("/hello2", false).unwrap();
        assert!(get("/hello2").is_err());
    }

    #[test]
    fn test_list() {
        let data = Bytes::from("hello world");
        set("/hello3", data.clone()).unwrap();
        assert_eq!(get("/hello3").unwrap(), data);
        let files = list("/hello3").unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].location, "/hello3");
    }

    #[test]
    fn test_delete_prefix() {
        let data = Bytes::from("hello world");
        set("/hello4", data.clone()).unwrap();
        assert_eq!(get("/hello4").unwrap(), data);
        set("/hello4/world", data.clone()).unwrap();
        assert_eq!(get("/hello4/world").unwrap(), data);
        delete("/hello4", true).unwrap();
        assert!(get("/hello4").is_err());
        assert!(get("/hello4/world").is_err());
    }

    #[test]
    fn test_stats() {
        let data = Bytes::from("hello world");
        set("/hello5", data.clone()).unwrap();
        assert_eq!(get("/hello5").unwrap(), data);
        let size = stats().unwrap();
        assert!(size >= 157);
    }

    #[test]
    fn test_empty() {
        let data = Bytes::from("hello world");
        set("/hello6/a", data.clone()).unwrap();
        assert!(!list("/hello6").unwrap().is_empty());
        delete("/hello6/a", true).unwrap();
        assert!(list("/hello6").unwrap().is_empty());
    }
}
