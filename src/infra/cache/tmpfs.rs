use chrono::{DateTime, Utc};
use parking_lot::RwLock;
use rsfs::mem;
use rsfs::*;
use rsfs::{DirEntry, Metadata};
use std::io::{Error, Read, Write};
use std::path::Path;

pub struct TmpDirEntry {
    pub location: String,
    pub last_modified: DateTime<Utc>,
    pub size: usize,
}

lazy_static! {
    pub static ref FS: RwLock<mem::FS> = RwLock::new(mem::FS::new());
}

pub fn write_file<P: AsRef<Path>>(path: P, data: &[u8]) -> Result<(), Error> {
    let mut f = FS.write().create_file(path)?;
    f.write_all(data)?;
    Ok(())
}

pub fn read_file<P: AsRef<Path>>(path: P) -> Result<Vec<u8>, Error> {
    let mut file = FS.write().open_file(path)?;
    let mut buf = vec![];
    file.read_to_end(&mut buf)?;
    Ok(buf)
}

pub fn create_dir<P: AsRef<Path>>(path: P) -> Result<(), Error> {
    FS.write().create_dir(path)
}

pub fn create_dir_all<P: AsRef<Path>>(path: P) -> Result<(), Error> {
    FS.write().create_dir_all(path)
}

pub fn read_dir<P: AsRef<Path>>(path: P) -> Result<Vec<TmpDirEntry>, Error> {
    let mut values = Vec::with_capacity(2);
    let files = FS.read().read_dir(path)?;
    for file in files {
        let file = file.unwrap();
        let file_path = file.path();
        let file_metadata = file.metadata().unwrap();
        values.push(TmpDirEntry {
            location: file_path.to_str().unwrap().to_string(),
            last_modified: file_metadata.modified().unwrap().into(),
            size: file_metadata.len() as usize,
        });
    }
    Ok(values)
}

pub fn remove_dir<P: AsRef<Path>>(path: P) -> Result<(), Error> {
    FS.write().remove_dir(path)
}

pub fn remove_dir_all<P: AsRef<Path>>(path: P) -> Result<(), Error> {
    FS.write().remove_dir_all(path)
}

pub fn remove_file<P: AsRef<Path>>(path: P) -> Result<(), Error> {
    FS.write().remove_file(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_read_file() {
        let path = "/test.txt";
        let mut file = write_file(path, b"hello world").unwrap();
        let data = read_file(path).unwrap();
        assert_eq!(data, b"hello world");
        remove_file(path).unwrap();
    }

    #[test]
    fn create_read_directory() {
        let path = "/test_dir/abc/";
        assert_eq!(true, create_dir_all(path).is_ok());
        assert_eq!(false, remove_dir("/test_dir/").is_ok());
        assert_eq!(true, remove_dir_all("/test_dir/").is_ok());
    }
}
