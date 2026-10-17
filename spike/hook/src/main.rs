use std::io::{self, BufWriter, Write};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::OnceLock;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_MENU};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, MSG,
    WH_MOUSE_LL, WM_MOUSEMOVE, WM_RBUTTONDOWN, WM_RBUTTONUP,
};

/// Mirrors Win32 MSLLHOOKSTRUCT (x64).
#[repr(C)]
struct Msllhookstruct {
    pt: POINT,
    mouse_data: u32,
    flags: u32,
    time: u32,
    dw_extra_info: usize,
}

static ACTIVE: AtomicBool = AtomicBool::new(false);
static LAST_MOVE_MS: AtomicU64 = AtomicU64::new(0);
static SENDER: OnceLock<mpsc::SyncSender<String>> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn emit(line: String) {
    if let Some(tx) = SENDER.get() {
        // Non-blocking: never stall the low-level hook on stdout backpressure.
        let _ = tx.try_send(line);
    }
}

unsafe extern "system" fn mouse_hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code < 0 {
        return CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam);
    }

    match wparam as u32 {
        WM_RBUTTONDOWN => {
            let alt_down = (GetAsyncKeyState(VK_MENU as i32) as u16 & 0x8000) != 0;
            if alt_down {
                let info = &*(lparam as *const Msllhookstruct);
                ACTIVE.store(true, Ordering::Relaxed);
                LAST_MOVE_MS.store(now_ms(), Ordering::Relaxed);
                emit(format!(
                    r#"{{"type":"down","x":{},"y":{}}}"#,
                    info.pt.x, info.pt.y
                ));
                return 1; // swallow: no context menu, no drag in the target app
            }
        }
        WM_MOUSEMOVE => {
            if ACTIVE.load(Ordering::Relaxed) {
                let now = now_ms();
                let last = LAST_MOVE_MS.load(Ordering::Relaxed);
                if now.saturating_sub(last) >= 16 {
                    LAST_MOVE_MS.store(now, Ordering::Relaxed);
                    let info = &*(lparam as *const Msllhookstruct);
                    emit(format!(
                        r#"{{"type":"move","x":{},"y":{}}}"#,
                        info.pt.x, info.pt.y
                    ));
                }
                // Do NOT swallow moves: the cursor must actually move.
                // Swallowing WM_MOUSEMOVE freezes the pointer, and the wheel
                // can no longer track direction. The button events are enough
                // to keep the target app from starting a drag or opening a menu.
            }
        }
        WM_RBUTTONUP => {
            if ACTIVE.load(Ordering::Relaxed) {
                ACTIVE.store(false, Ordering::Relaxed);
                let info = &*(lparam as *const Msllhookstruct);
                emit(format!(
                    r#"{{"type":"up","x":{},"y":{}}}"#,
                    info.pt.x, info.pt.y
                ));
                return 1;
            }
        }
        _ => {}
    }

    CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam)
}

fn main() {
    let (tx, rx) = mpsc::sync_channel::<String>(2048);
    let _ = SENDER.set(tx);

    std::thread::spawn(move || {
        let stdout = io::stdout();
        let mut out = BufWriter::new(stdout.lock());
        loop {
            match rx.recv_timeout(Duration::from_secs(2)) {
                Ok(line) => {
                    if writeln!(out, "{}", line).is_err() {
                        break;
                    }
                }
                Err(RecvTimeoutError::Timeout) => {
                    // If the host closed our stdout, exit so the hook doesn't orphan.
                    if writeln!(out, r#"{{"type":"ping"}}"#).is_err() {
                        break;
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
            let _ = out.flush();
        }
        std::process::exit(0);
    });

    unsafe {
        let hook = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), std::ptr::null_mut(), 0);
        if hook.is_null() {
            eprintln!(
                "failed to install WH_MOUSE_LL: {}",
                io::Error::last_os_error()
            );
            std::process::exit(1);
        }

        emit(r#"{"type":"ready"}"#.to_string());

        let mut msg: MSG = std::mem::zeroed();
        loop {
            let ret = GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0);
            if ret <= 0 {
                break;
            }
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}
