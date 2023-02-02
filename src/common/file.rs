use std::{
    fs::{File, Metadata},
    io::{Read, Write},
};

pub fn get_file_meta(file: &str) -> Result<Metadata, std::io::Error> {
    let file = File::open(file)?;
    file.metadata()
}

pub fn get_file_contents(file: &str) -> Result<Vec<u8>, std::io::Error> {
    let mut file = File::open(file)?;
    let mut contents: Vec<u8> = Vec::new();
    file.read_to_end(&mut contents)?;
    Ok(contents)
}

pub fn put_file_contents(file: &str, contents: &[u8]) -> Result<(), std::io::Error> {
    let mut file = File::create(file)?;
    file.write_all(contents)?;
    Ok(())
}

pub fn delete_file(file: &str) -> Result<(), std::io::Error> {
    std::fs::remove_file(file)?;
    Ok(())
}

pub fn scan_files(pattern: &str) -> Vec<String> {
    let files: Vec<String> = glob::glob(pattern)
        .unwrap()
        .map(|m| m.unwrap().to_str().unwrap().to_string())
        .collect();
    files
}
