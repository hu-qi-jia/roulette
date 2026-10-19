use std::fs;
use std::io::{self, BufRead, BufReader, BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::OnceLock;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use windows_sys::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, WPARAM};
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, SRCCOPY,
};
use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
    mouse_event, GetAsyncKeyState, SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
    MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, VK_LCONTROL, VK_MENU, VK_V,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, DispatchMessageW, GetAncestor, GetClassNameW, GetForegroundWindow,
    GetGUIThreadInfo, GetMessageW, GetWindowThreadProcessId, SendMessageTimeoutW, SetCursorPos,
    SetForegroundWindow, SetWindowsHookExW, ShowWindow, TranslateMessage, WindowFromPoint, GA_ROOT,
    GUITHREADINFO, MSG, SMTO_ABORTIFHUNG, SW_RESTORE, WH_MOUSE_LL, WM_MOUSEMOVE, WM_PASTE,
    WM_RBUTTONDOWN, WM_RBUTTONUP,
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

unsafe fn send_one_key(vk: u16, up: bool) -> u32 {
    let mut input: INPUT = std::mem::zeroed();
    input.r#type = INPUT_KEYBOARD;
    input.Anonymous.ki = KEYBDINPUT {
        wVk: vk,
        wScan: 0,
        dwFlags: if up { KEYEVENTF_KEYUP as u32 } else { 0 },
        time: 0,
        dwExtraInfo: 0,
    };
    SendInput(1, &input, std::mem::size_of::<INPUT>() as i32)
}

unsafe fn send_key(vk: u16) -> u32 {
    let mut total = send_one_key(vk, false);
    std::thread::sleep(Duration::from_millis(20));
    total += send_one_key(vk, true);
    total
}

unsafe fn send_ctrl_v() -> u32 {
    // SendInput with explicit scan codes is more reliable than keybd_event
    // when this process is not the foreground process (Chromium targets).
    let keys: [(u16, u16, u32); 4] = [
        (VK_LCONTROL, 0x1D, 0),
        (VK_V, 0x2F, 0),
        (VK_V, 0x2F, KEYEVENTF_KEYUP as u32),
        (VK_LCONTROL, 0x1D, KEYEVENTF_KEYUP as u32)
    ];
    let mut inputs: [INPUT; 4] = std::mem::zeroed();
    for (index, (vk, scan, flags)) in keys.iter().enumerate() {
        inputs[index].r#type = INPUT_KEYBOARD;
        inputs[index].Anonymous.ki = KEYBDINPUT {
            wVk: *vk,
            wScan: *scan,
            dwFlags: *flags,
            time: 0,
            dwExtraInfo: 0,
        };
    }
    let sent = SendInput(4, inputs.as_ptr(), std::mem::size_of::<INPUT>() as i32);
    std::thread::sleep(Duration::from_millis(40));
    sent
}

fn json_string(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{}\"", escaped)
}

/// Capture one physical screen rectangle with GDI and encode it as JPEG.
fn capture_display(path: &Path, x: i32, y: i32, width: i32, height: i32) -> Result<(), String> {
    if width <= 0 || height <= 0 {
        return Err("invalid capture size".to_string());
    }

    unsafe {
        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return Err("GetDC failed".to_string());
        }
        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_null() {
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleDC failed".to_string());
        }
        let bitmap = CreateCompatibleBitmap(screen_dc, width, height);
        if bitmap.is_null() {
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("CreateCompatibleBitmap failed".to_string());
        }
        let previous = SelectObject(mem_dc, bitmap as _);
        let bitblt_started = Instant::now();
        let copied = BitBlt(
            mem_dc,
            0,
            0,
            width,
            height,
            screen_dc,
            x,
            y,
            SRCCOPY,
        );
        let bitblt_ms = bitblt_started.elapsed().as_millis();
        if copied == 0 {
            SelectObject(mem_dc, previous);
            DeleteObject(bitmap as _);
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("BitBlt failed".to_string());
        }

        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = std::mem::size_of::<BITMAPINFOHEADER>() as u32;
        info.bmiHeader.biWidth = width;
        info.bmiHeader.biHeight = height;
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 32;
        info.bmiHeader.biCompression = BI_RGB;

        let mut pixels = vec![0u8; (width * height * 4) as usize];
        let dibits_started = Instant::now();
        let lines = GetDIBits(
            mem_dc,
            bitmap,
            0,
            height as u32,
            pixels.as_mut_ptr() as *mut _,
            &mut info,
            DIB_RGB_COLORS,
        );
        let dibits_ms = dibits_started.elapsed().as_millis();

        SelectObject(mem_dc, previous);
        DeleteObject(bitmap as _);
        DeleteDC(mem_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);

        if lines == 0 {
            return Err("GetDIBits failed".to_string());
        }

        // GDI leaves the alpha byte at 0. Chromium treats 0 as transparent in
        // 32-bit BMPs, so make every pixel opaque.
        for pixel in pixels.chunks_exact_mut(4) {
            pixel[3] = 255;
        }

        // Write an uncompressed 32-bit BMP. Chromium decodes it quickly, and
        // avoiding JPEG encoding removes ~400 ms from a 1080p capture.
        write_bmp(path, &pixels, width, height)?;
        eprintln!(
            "[hook] capture steps bitblt={} dibits={} write_bmp done",
            bitblt_ms, dibits_ms
        );
    }

    Ok(())
}

fn write_bmp(path: &Path, pixels: &[u8], width: i32, height: i32) -> Result<(), String> {
    let data_size = (width * height * 4) as u32;
    let file_size = 14 + 40 + data_size;
    let mut header = Vec::with_capacity(54);
    header.extend_from_slice(b"BM");
    header.extend_from_slice(&file_size.to_le_bytes());
    header.extend_from_slice(&0u16.to_le_bytes());
    header.extend_from_slice(&0u16.to_le_bytes());
    header.extend_from_slice(&54u32.to_le_bytes());
    header.extend_from_slice(&40u32.to_le_bytes());
    header.extend_from_slice(&width.to_le_bytes());
    header.extend_from_slice(&height.to_le_bytes());
    header.extend_from_slice(&1u16.to_le_bytes());
    header.extend_from_slice(&32u16.to_le_bytes());
    header.extend_from_slice(&0u32.to_le_bytes());
    header.extend_from_slice(&data_size.to_le_bytes());
    header.extend_from_slice(&2835i32.to_le_bytes());
    header.extend_from_slice(&2835i32.to_le_bytes());
    header.extend_from_slice(&0u32.to_le_bytes());
    header.extend_from_slice(&0u32.to_le_bytes());

    let mut file = fs::File::create(path).map_err(|error| error.to_string())?;
    file.write_all(&header)
        .map_err(|error| error.to_string())?;
    file.write_all(pixels)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn emit_paste_result(ok: bool, method: &str, class: &str) {
    emit(format!(
        r#"{{"type":"paste-result","ok":{},"method":"{}","class":{}}}"#,
        if ok { "true" } else { "false" },
        method,
        json_string(class)
    ));
}

unsafe fn send_paste(hwnd: isize, click: Option<(i32, i32)>) {
    let mut target: HWND = hwnd as HWND;
    if target.is_null() {
        target = GetForegroundWindow();
    }
    if target.is_null() {
        eprintln!("[hook] no paste target");
        emit_paste_result(false, "none", "");
        return;
    }

    let root = {
        let ancestor = GetAncestor(target, GA_ROOT);
        if ancestor.is_null() {
            target
        } else {
            ancestor
        }
    };
    eprintln!("[hook] paste target={:?} root={:?}", target, root);

    ShowWindow(root, SW_RESTORE);
    SetForegroundWindow(root);

    // The target must really own the foreground before keystrokes are sent.
    let deadline = Instant::now() + Duration::from_millis(1200);
    loop {
        let foreground = GetForegroundWindow();
        if foreground == root || GetAncestor(foreground, GA_ROOT) == root {
            break;
        }
        if Instant::now() >= deadline {
            break;
        }
        SetForegroundWindow(root);
        std::thread::sleep(Duration::from_millis(60));
    }

    // Let the target reactivate its edit control.
    std::thread::sleep(Duration::from_millis(150));

    let foreground = GetForegroundWindow();
    let foreground_ok = foreground == root || GetAncestor(foreground, GA_ROOT) == root;
    eprintln!("[hook] foreground={:?} ok={}", foreground, foreground_ok);

    let focus = focused_control(root);
    let class = class_name(focus);
    eprintln!("[hook] focus={:?} class={}", focus, class);

    if is_edit_class(&class) {
        let ok = send_wm_paste(root as isize);
        eprintln!("[hook] wm_paste ok={}", ok);
        emit_paste_result(ok, "wm_paste", &class);
    } else {
        // Custom editors (Chromium, terminals) lose their internal focus when
        // the panel takes over. A click at the wheel's origin restores it.
        if let Some((x, y)) = click {
            let point = POINT { x, y };
            let under = WindowFromPoint(point);
            let same_window = !under.is_null()
                && (under == root || GetAncestor(under, GA_ROOT) == root);
            if same_window {
                SetCursorPos(x, y);
                std::thread::sleep(Duration::from_millis(60));
                mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
                std::thread::sleep(Duration::from_millis(40));
                mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
                std::thread::sleep(Duration::from_millis(160));
                eprintln!("[hook] clicked {}x{} to restore focus", x, y);
            } else {
                eprintln!("[hook] skip click: point is outside the target window");
            }
        }

        let focus = focused_control(root);
        let class = class_name(focus);
        if is_edit_class(&class) {
            let ok = send_wm_paste(root as isize);
            eprintln!("[hook] wm_paste after click ok={}", ok);
            emit_paste_result(ok, "wm_paste_after_click", &class);
        } else {
            let sent = send_ctrl_v();
            eprintln!("[hook] SendInput events={}", sent);
            emit_paste_result(foreground_ok && sent > 0, "ctrl_v", &class);
        }
    }
}

unsafe fn focused_control(hwnd: HWND) -> HWND {
    let mut process_id: u32 = 0;
    let thread_id = GetWindowThreadProcessId(hwnd, &mut process_id);
    if thread_id == 0 {
        return hwnd;
    }

    let mut info: GUITHREADINFO = std::mem::zeroed();
    info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
    if GetGUIThreadInfo(thread_id, &mut info) == 0 || info.hwndFocus.is_null() {
        return hwnd;
    }
    info.hwndFocus
}

unsafe fn class_name(hwnd: HWND) -> String {
    let mut buffer = [0u16; 256];
    let length = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
    if length <= 0 {
        return String::new();
    }
    String::from_utf16_lossy(&buffer[..length as usize])
}

fn is_edit_class(class: &str) -> bool {
    // Covers plain Win32 "Edit", RichEdit variants, and WinForms
    // "WindowsForms10.Edit.app..." controls.
    class.to_lowercase().contains("edit")
}

unsafe fn send_wm_paste(hwnd: isize) -> bool {
    let target: HWND = hwnd as HWND;
    if target.is_null() {
        return false;
    }

    let mut process_id: u32 = 0;
    let thread_id = GetWindowThreadProcessId(target, &mut process_id);
    if thread_id == 0 {
        return false;
    }

    let mut info: GUITHREADINFO = std::mem::zeroed();
    info.cbSize = std::mem::size_of::<GUITHREADINFO>() as u32;
    if GetGUIThreadInfo(thread_id, &mut info) == 0 {
        return false;
    }

    let focus = if info.hwndFocus.is_null() {
        target
    } else {
        info.hwndFocus
    };
    let mut result: usize = 0;
    let ok = SendMessageTimeoutW(
        focus,
        WM_PASTE,
        0,
        0,
        SMTO_ABORTIFHUNG,
        800,
        &mut result,
    );
    eprintln!("[hook] wm_paste focus={:?} ok={}", focus, ok);
    ok != 0
}

fn start_stdin_reader() {
    std::thread::spawn(|| {
        let stdin = io::stdin();
        for line in BufReader::new(stdin.lock()).lines().map_while(Result::ok) {
            let mut parts = line.split_whitespace();
            match parts.next() {
                Some("paste") => {
                    let hwnd = parts
                        .next()
                        .and_then(|value| value.parse::<isize>().ok())
                        .unwrap_or(0);
                    let x = parts.next().and_then(|value| value.parse::<i32>().ok());
                    let y = parts.next().and_then(|value| value.parse::<i32>().ok());
                    let click = match (x, y) {
                        (Some(x), Some(y)) => Some((x, y)),
                        _ => None,
                    };
                    eprintln!("[hook] paste command hwnd={} click={:?}", hwnd, click);
                    unsafe { send_paste(hwnd, click) };
                }
                Some("foreground") => {
                    let hwnd = unsafe { GetForegroundWindow() };
                    let class = unsafe { class_name(hwnd) };
                    emit(format!(
                        r#"{{"type":"foreground","hwnd":{},"class":{}}}"#,
                        hwnd as isize,
                        json_string(&class)
                    ));
                }
                Some("query-foreground") => {
                    let hwnd = unsafe { GetForegroundWindow() };
                    let class = unsafe { class_name(hwnd) };
                    emit(format!(
                        r#"{{"type":"foreground-query","hwnd":{},"class":{}}}"#,
                        hwnd as isize,
                        json_string(&class)
                    ));
                }
                Some("key") => {
                    let sent = unsafe { send_key(0x41) };
                    eprintln!("[hook] side key events={}", sent);
                }
                Some("wmpaste") => {
                    let hwnd = parts
                        .next()
                        .and_then(|value| value.parse::<isize>().ok())
                        .unwrap_or(0);
                    let ok = unsafe { send_wm_paste(hwnd) };
                    eprintln!("[hook] wmpaste command ok={}", ok);
                    emit_paste_result(ok, "wm_paste", "");
                }
                Some("capture") => {
                    let count = parts
                        .next()
                        .and_then(|value| value.parse::<usize>().ok())
                        .unwrap_or(0);
                    let mut items = Vec::new();
                    let mut errors = Vec::new();
                    for _ in 0..count {
                        // Electron display IDs are unsigned 32-bit values; on
                        // some systems they exceed i32::MAX (e.g. 2733337434).
                        let id = parts.next().and_then(|value| value.parse::<u32>().ok());
                        let x = parts.next().and_then(|value| value.parse::<i32>().ok());
                        let y = parts.next().and_then(|value| value.parse::<i32>().ok());
                        let w = parts.next().and_then(|value| value.parse::<i32>().ok());
                        let h = parts.next().and_then(|value| value.parse::<i32>().ok());
                        match (id, x, y, w, h) {
                            (Some(id), Some(x), Some(y), Some(w), Some(h)) => {
                                items.push((id, x, y, w, h))
                            }
                            _ => {
                                errors.push("invalid capture item".to_string());
                                break;
                            }
                        }
                    }
                    if count == 0 {
                        errors.push("no capture items".to_string());
                    }

                    let out_dir = std::env::temp_dir().join("roulette-captures");
                    let _ = fs::create_dir_all(&out_dir);
                    for (id, x, y, w, h) in &items {
                        let path = out_dir.join(format!("{}.bmp", id));
                        let started = Instant::now();
                        match capture_display(&path, *x, *y, *w, *h) {
                            Ok(()) => eprintln!(
                                "[hook] capture {} {}x{} in {} ms",
                                id,
                                w,
                                h,
                                started.elapsed().as_millis()
                            ),
                            Err(error) => {
                                eprintln!("[hook] capture {} failed: {}", id, error);
                                errors.push(format!("{}: {}", id, error));
                            }
                        }
                    }

                    if errors.is_empty() {
                        emit(r#"{"type":"capture-result","ok":true}"#.to_string());
                    } else {
                        emit(format!(
                            r#"{{"type":"capture-result","ok":false,"error":{}}}"#,
                            json_string(&errors.join("; "))
                        ));
                    }
                }
                _ => {}
            }
        }
        // Parent closed stdin: exit so we don't linger.
        std::process::exit(0);
    });
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
                let hwnd = GetForegroundWindow() as isize;
                emit(format!(
                    r#"{{"type":"down","x":{},"y":{},"hwnd":{}}}"#,
                    info.pt.x, info.pt.y, hwnd
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

    start_stdin_reader();

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
