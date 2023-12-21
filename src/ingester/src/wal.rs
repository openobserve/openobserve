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

use std::{
    fs::{create_dir_all, File},
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

use snafu::ResultExt;

use crate::{
    errors::{
        DeleteFileSnafu, OpenDirSnafu, OpenFileSnafu, ReadDataSnafu, ReadFileSnafu,
        RenameFileSnafu, Result,
    },
    PARQUET_DIR, WAL_DIR,
};

// check uncompleted parquet files
// the wal file process have 4 steps:
// 1. write the memory file into disk with .par file extension
// 2. create a lock file with those file names
// 3. delete the wal file
// 4. rename the .par files to .parquet
// 5. delete the lock file
//
// so, there are some cases that the process is not completed:
// 1. the process is killed before step 2, so there are some .par files and have
//    no lock file, need delete those files
// 2. the process is killed before step 3, so there are some .par files and have
//    lock file, the files actually wrote to disk completely, need to continue
//    step 3, 4 and 5
// 3. the process is killed before step 4, so there are some .par files and have
//    lock file, the files actually wrote to disk completely, need to continue
//    step 4 and 5
// 4. the process is killed before step 5, so there are some .parquet files and
//    have lock file, the files actually wrote to disk completely, need to
//    continue step 5
pub(crate) async fn check_uncompleted_parquet_files() -> Result<()> {
    // 1. get all .lock files
    let wal_dir = PathBuf::from(WAL_DIR);
    // create wal dir if not exists
    create_dir_all(&wal_dir).context(OpenDirSnafu {
        path: wal_dir.clone(),
    })?;
    let lock_files = scan_files(wal_dir, "lock");

    // 2. check if there is a .wal file with the same name, delete it and rename the
    //    .par file to .parquet
    for lock_file in lock_files.iter() {
        log::warn!("found uncompleted wal file: {:?}", lock_file);
        let wal_file = lock_file.with_extension("wal");
        if wal_file.exists() {
            // delete the .wal file
            log::warn!("delete processed wal file: {:?}", wal_file);
            std::fs::remove_file(&wal_file).context(DeleteFileSnafu { path: wal_file })?;
        }
        // read all the .par files
        let mut file = File::open(&lock_file).context(OpenFileSnafu { path: lock_file })?;
        let mut par_files = Vec::new();
        for line in BufReader::new(&mut file).lines() {
            let line = line.context(ReadFileSnafu { path: lock_file })?;
            par_files.push(line);
        }
        // rename the .par file to .parquet
        for par_file in par_files.iter() {
            let par_file = PathBuf::from(par_file);
            let parquet_file = par_file.with_extension("parquet");
            log::warn!("rename par file: {:?} to parquet", par_file);
            if par_file.exists() {
                std::fs::rename(&par_file, &parquet_file)
                    .context(RenameFileSnafu { path: par_file })?;
            }
        }
        // delete the .lock file
        log::warn!("delete lock file: {:?}", lock_file);
        std::fs::remove_file(&lock_file).context(DeleteFileSnafu {
            path: lock_file.clone(),
        })?;
    }

    // 4. delete all the .par files
    let parquet_dir = PathBuf::from(PARQUET_DIR);
    // create wal dir if not exists
    create_dir_all(&parquet_dir).context(OpenDirSnafu {
        path: parquet_dir.clone(),
    })?;
    let par_files = scan_files(parquet_dir, "par");
    for par_file in par_files.iter() {
        log::warn!("delete uncompleted par file: {:?}", par_file);
        std::fs::remove_file(&par_file).context(DeleteFileSnafu { path: par_file })?;
    }
    Ok(())
}

// replay wal files to create immutable
pub(crate) async fn replay_wal_files() -> Result<()> {
    Ok(())
}

pub fn scan_files(root_dir: impl Into<PathBuf>, ext: &str) -> Vec<PathBuf> {
    walkdir::WalkDir::new(root_dir.into())
        .into_iter()
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.is_file() {
                let path_ext = path.extension()?.to_str()?;
                if path_ext == ext {
                    Some(PathBuf::from(path))
                } else {
                    None
                }
            } else {
                None
            }
        })
        .collect()
}
