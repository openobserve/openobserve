use std::{
    fs::OpenOptions,
    io::{BufWriter, ErrorKind, Write},
    thread,
    time::Duration,
};

use cluFlock::{ExclusiveFlock, FlockLock};

fn main() {
    println!("Checking lock");
    let handle = thread::spawn(|| {
        for i in 1..3 {
            let file = OpenOptions::new()
                .write(true)
                .create(true)
                .append(true)
                .open("./test_file.json")
                .unwrap();

            let file_lock = ExclusiveFlock::try_lock(&file);
            match file_lock {
                Ok(_) => println!("{:?} locked using thread {}", file_lock, i),
                Err(_) => println!(" ****** Create New File "),
            }

            println!("################# Checking if lock exists");

            let is_locked = is_locked("./test_file.json").unwrap();

            println!("################# lock exists {}", is_locked);
            let mut writer = BufWriter::new(&file);
            writer
                .write(
                    format!("Writing using thread {} ", i)
                        .to_string()
                        .as_bytes(),
                )
                .unwrap();
            writer.write(b"\n").unwrap();

            thread::sleep(Duration::from_millis(5));
            writer
                .write(
                    format!("Somthing using thread after sleep {} ", i)
                        .to_string()
                        .as_bytes(),
                )
                .unwrap();
            writer.write(b"\n").unwrap();
            //file_lock.unlock().unwrap();
            println!("unlocked by thread {}", i);
        }
    });

    for i in 1..3 {
        let file = OpenOptions::new()
            .write(true)
            .create(true)
            .append(true)
            .open("./test_file.json")
            .unwrap();

        let file_lock = ExclusiveFlock::wait_lock(&file).unwrap();
        println!("{:?}  locked using Main Attempt  {}", file_lock, i);
        let mut writer = BufWriter::new(&file);
        writer
            .write(format!("Writing Main Attempt{}", i).to_string().as_bytes())
            .unwrap();
        writer.write(b"\n").unwrap();

        writer
            .write(
                format!("Somthing Main Attempt After sleep{} ", i)
                    .to_string()
                    .as_bytes(),
            )
            .unwrap();
        writer.write(b"\n").unwrap();
        thread::sleep(Duration::from_millis(10));
        file_lock.unlock().unwrap();
        println!("unlocked using Main Attempt {}", i);
    }
    handle.join().unwrap();

    println!("Checking if lock exists before existing");
    let is_locked = is_locked("./test_file.json").unwrap();
    println!("lock exists {}", is_locked);
}

pub fn is_locked(path: &str) -> Result<bool, std::io::Error> {
    let file = OpenOptions::new().read(true).write(false).open(path)?;

    FlockLock::try_exclusive_lock_fn(
        &file,
        |_| Ok(false),
        |e| match e.kind() {
            ErrorKind::WouldBlock => Ok(true), // ignore err
            _ => Err(e.into_err()),            // into_err: FlockErr -> std::io::Error
        },
    )
}
