use arboard::Clipboard;
use chrono::Local;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::{fs, path::PathBuf};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipboardItem {
    pub id: u64,
    pub content: String,
    pub original_content: String,
    pub timestamp: String,
    pub pinned: bool,
}

pub struct AppState {
    pub history: Mutex<Vec<ClipboardItem>>,
    pub last_content: Mutex<String>,
    pub next_id: Mutex<u64>,
    pub data_path: PathBuf,
}

/// 从磁盘加载历史记录
fn load_history_from_disk(path: &PathBuf) -> (Vec<ClipboardItem>, u64) {
    if let Ok(data) = fs::read_to_string(path) {
        if let Ok(items) = serde_json::from_str::<Vec<ClipboardItem>>(&data) {
            let next_id = items.iter().map(|i| i.id).max().unwrap_or(0) + 1;
            return (items, next_id);
        }
    }
    (Vec::new(), 1)
}

/// 将历史记录保存到磁盘
fn save_history_to_disk(path: &PathBuf, history: &Vec<ClipboardItem>) {
    if let Ok(data) = serde_json::to_string(history) {
        let _ = fs::write(path, data);
    }
}

/// 获取剪贴板历史
#[tauri::command]
fn get_history(state: State<AppState>) -> Vec<ClipboardItem> {
    state.history.lock().unwrap().clone()
}

/// 写入剪贴板并记录历史
#[tauri::command]
fn copy_to_clipboard(content: String, state: State<AppState>) -> Result<(), String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(&content).map_err(|e| e.to_string())?;
    *state.last_content.lock().unwrap() = content.clone();
    Ok(())
}

/// 删除历史记录
#[tauri::command]
fn delete_item(id: u64, state: State<AppState>) -> Vec<ClipboardItem> {
    let mut history = state.history.lock().unwrap();
    history.retain(|item| item.id != id);
    save_history_to_disk(&state.data_path, &history);
    history.clone()
}

/// 清空所有历史
#[tauri::command]
fn clear_history(state: State<AppState>) -> Vec<ClipboardItem> {
    let mut history = state.history.lock().unwrap();
    history.retain(|item| item.pinned);
    save_history_to_disk(&state.data_path, &history);
    history.clone()
}

/// 编辑历史记录内容
#[tauri::command]
fn update_item(id: u64, content: String, state: State<AppState>) -> Vec<ClipboardItem> {
    let mut history = state.history.lock().unwrap();
    if let Some(item) = history.iter_mut().find(|i| i.id == id) {
        item.content = content;
    }
    save_history_to_disk(&state.data_path, &history);
    history.clone()
}

/// 还原为原始粘贴内容
#[tauri::command]
fn reset_item(id: u64, state: State<AppState>) -> Vec<ClipboardItem> {
    let mut history = state.history.lock().unwrap();
    if let Some(item) = history.iter_mut().find(|i| i.id == id) {
        item.content = item.original_content.clone();
    }
    save_history_to_disk(&state.data_path, &history);
    history.clone()
}

/// 切换置顶状态
#[tauri::command]
fn toggle_pin(id: u64, state: State<AppState>) -> Vec<ClipboardItem> {
    let mut history = state.history.lock().unwrap();
    if let Some(item) = history.iter_mut().find(|i| i.id == id) {
        item.pinned = !item.pinned;
    }
    // 置顶项排在前面
    history.sort_by(|a, b| b.pinned.cmp(&a.pinned));
    save_history_to_disk(&state.data_path, &history);
    history.clone()
}

/// 轮询剪贴板变化（由前端定时调用）
#[tauri::command]
fn poll_clipboard(state: State<AppState>) -> Result<Option<ClipboardItem>, String> {
    let mut clipboard = Clipboard::new().map_err(|e| e.to_string())?;
    let current = match clipboard.get_text() {
        Ok(text) => text,
        Err(_) => return Ok(None),
    };

    if current.trim().is_empty() {
        return Ok(None);
    }

    let mut last = state.last_content.lock().unwrap();
    if current == *last {
        return Ok(None);
    }

    *last = current.clone();
    drop(last);

    let mut history = state.history.lock().unwrap();
    // 去重：如果已存在相同内容，移除旧的
    history.retain(|item| item.content != current);

    let mut next_id = state.next_id.lock().unwrap();
    let id = *next_id;
    *next_id += 1;
    drop(next_id);

    let new_item = ClipboardItem {
        id,
        content: current.clone(),
        original_content: current,
        timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
        pinned: false,
    };

    history.insert(0, new_item.clone());

    // 保持置顶项始终排在前面
    history.sort_by(|a, b| b.pinned.cmp(&a.pinned));

    // 最多保留 200 条（置顶的不计入限制）
    let pinned_count = history.iter().filter(|i| i.pinned).count();
    let max_unpinned = 200;
    if history.len() - pinned_count > max_unpinned {
        let mut unpinned_count = 0;
        history.retain(|item| {
            if item.pinned {
                true
            } else {
                unpinned_count += 1;
                unpinned_count <= max_unpinned
            }
        });
    }

    save_history_to_disk(&state.data_path, &history);

    Ok(Some(new_item))
}

/// 打开主窗口（查看全部）
#[tauri::command]
fn open_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.unminimize();
    }
}

/// 退出应用
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 确定数据文件路径：~/.clipto/history.json
    let clipto_dir = dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".clipto");
    let _ = fs::create_dir_all(&clipto_dir);
    let data_path = clipto_dir.join("history.json");

    // 从磁盘加载历史记录
    let (mut loaded_history, next_id) = load_history_from_disk(&data_path);

    // 启动时读取当前剪切板内容，若不在历史中则插入
    let initial_clipboard = Clipboard::new()
        .ok()
        .and_then(|mut cb| cb.get_text().ok())
        .unwrap_or_default();

    let initial_last = if !initial_clipboard.trim().is_empty() {
        // 去重：如果已存在相同内容，移除旧的
        loaded_history.retain(|item| item.content != initial_clipboard);
        let id = next_id;
        let new_item = ClipboardItem {
            id,
            content: initial_clipboard.clone(),
            original_content: initial_clipboard.clone(),
            timestamp: Local::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            pinned: false,
        };
        loaded_history.insert(0, new_item);
        loaded_history.sort_by(|a, b| b.pinned.cmp(&a.pinned));
        save_history_to_disk(&data_path, &loaded_history);
        initial_clipboard
    } else {
        String::new()
    };

    let actual_next_id = loaded_history.iter().map(|i| i.id).max().unwrap_or(0) + 1;

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            history: Mutex::new(loaded_history),
            last_content: Mutex::new(initial_last),
            next_id: Mutex::new(actual_next_id),
            data_path,
        })
        .invoke_handler(tauri::generate_handler![
            get_history,
            copy_to_clipboard,
            delete_item,
            clear_history,
            toggle_pin,
            update_item,
            reset_item,
            poll_clipboard,
            open_main_window,
            quit_app,
        ])
        .setup(|app| {
            // 隐藏 Dock 图标（纯菜单栏应用）
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let quit = MenuItemBuilder::with_id("quit", "退出 Clipto").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&quit]).build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("popup") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                // position 是物理像素坐标，转换为逻辑坐标再定位
                                // 避免第一次显示时因缩放因子未初始化导致位置偏差
                                let scale = window.scale_factor().unwrap_or(2.0);

                                // 转为逻辑坐标
                                let click_lx = position.x / scale;
                                let click_ly = position.y / scale;

                                // popup 左边与图标左边对齐（图标宽约 22 逻辑像素，点击点在图标中心）
                                let icon_w = 22.0_f64 / 2.0;
                                let x = click_lx - icon_w;
                                // click_ly 是图标中心，加上约半个图标高度到菜单栏底部
                                let y = click_ly + 12.0;

                                let _ = window.set_position(tauri::Position::Logical(
                                    tauri::LogicalPosition::new(x, y),
                                ));
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .build(app)?;

            if let Some(w) = app.get_webview_window("popup") {
                // 失去焦点时自动隐藏 popup
                let w_clone = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = w_clone.hide();
                    }
                });
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.hide();
                // 拦截关闭事件：将关闭改为隐藏，避免窗口被销毁后无法再次打开
                let w_clone = w.clone();
                w.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = w_clone.hide();
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
