use std::sync::mpsc::channel;
use std::thread::{self, sleep};
use std::time;

fn main() {
    let (tx, rx) = channel();

    let receiver = thread::spawn(move || {
        for received in rx {
            println!("Got: {}", received);
        }
        // let value = rx.recv().expect("Unable to receive from channel");
        // println!("{value}");
    });

    let sender = thread::spawn(move || {
        for i in 0..100 {
            tx.send(i).expect("Unable to send on channel");
            println!("send {}", i);
            let ten_millis = time::Duration::from_millis(10);
            let _now = time::Instant::now();

            sleep(ten_millis);
        }
    });

    receiver.join().expect("The receiver thread has panicked");
    sender.join().expect("The sender thread has panicked");
}
