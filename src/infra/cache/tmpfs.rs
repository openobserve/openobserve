use parking_lot::RwLock;
use rsfs::mem;
use rsfs::*;
use std::io::Error;
use std::io::Read;
use std::path::Path;

lazy_static! {
    pub static ref FS: RwLock<mem::FS> = RwLock::new(mem::FS::new());
}

pub fn open_file<P: AsRef<Path>>(path: P) -> Result<mem::File, Error> {
    FS.write().open_file(path)
}

pub fn create_file<P: AsRef<Path>>(path: P) -> Result<mem::File, Error> {
    FS.write().create_file(path)
}

pub fn read_file<P: AsRef<Path>>(path: P) -> Result<Vec<u8>, Error> {
    let mut file = open_file(path)?;
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

pub fn read_dir<P: AsRef<Path>>(path: P) -> Result<mem::ReadDir, Error> {
    FS.read().read_dir(path)
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
    use std::io::Read;
    use std::io::Write;

    #[test]
    fn create_read_file() {
        let path = "/test.txt";
        let mut file = create_file(path).unwrap();
        file.write_all(b"hello world").unwrap();
        let mut file = open_file(path).unwrap();
        let mut buf = vec![];
        file.read_to_end(&mut buf).unwrap();
        assert_eq!(buf, b"hello world");
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
