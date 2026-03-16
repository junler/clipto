import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

interface ClipboardItem {
  id: number;
  content: string;
  original_content: string;
  timestamp: string;
  pinned: boolean;
}

// ─── 共用 Hook ────────────────────────────────────────────────
function useClipboard(mode: "popup" | "main" = "popup") {
  const [history, setHistory] = useState<ClipboardItem[]>([]);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadHistory = useCallback(async () => {
    const data = await invoke<ClipboardItem[]>("get_history");
    setHistory(data);
  }, []);

  const pollClipboard = useCallback(async () => {
    try {
      if (mode === "popup") {
        // popup 负责检测新内容并写入后端
        const newItem = await invoke<ClipboardItem | null>("poll_clipboard");
        if (newItem) {
          // 直接从后端拉取最新列表，确保置顶顺序正确
          const data = await invoke<ClipboardItem[]>("get_history");
          setHistory(data);
        }
      } else {
        // 主窗口直接从后端拉取最新完整列表，避免因 last_content 已被 popup 更新而漏掉新条目
        const data = await invoke<ClipboardItem[]>("get_history");
        setHistory(data);
      }
    } catch (_) {}
  }, [mode]);

  useEffect(() => {
    loadHistory();
    pollRef.current = setInterval(pollClipboard, 1000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadHistory, pollClipboard]);

  const handleCopy = async (item: ClipboardItem) => {
    await invoke("copy_to_clipboard", { content: item.content });
    return item.id;
  };

  const handleDelete = async (id: number) => {
    const updated = await invoke<ClipboardItem[]>("delete_item", { id });
    setHistory(updated);
  };

  const handleClear = async () => {
    const updated = await invoke<ClipboardItem[]>("clear_history");
    setHistory(updated);
  };

  const handlePin = async (id: number) => {
    const updated = await invoke<ClipboardItem[]>("toggle_pin", { id });
    setHistory(updated);
  };

  const handleUpdate = async (id: number, content: string) => {
    const updated = await invoke<ClipboardItem[]>("update_item", { id, content });
    setHistory(updated);
  };

  const handleReset = async (id: number) => {
    const updated = await invoke<ClipboardItem[]>("reset_item", { id });
    setHistory(updated);
  };

  return { history, handleCopy, handleDelete, handleClear, handlePin, handleUpdate, handleReset };
}

// ─── ConfirmDialog ──────────────────────────────────────────────
function useConfirmDialog(onConfirm: () => void) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = () => dialogRef.current?.showModal();
  const Dialog = (
    <dialog ref={dialogRef} className="confirm-dialog">
      <div className="confirm-dialog-body">
        <p className="confirm-dialog-icon">🗑</p>
        <p className="confirm-dialog-title">确认清空历史？</p>
        <p className="confirm-dialog-desc">未置顶的记录将全部删除，无法恢复。</p>
        <div className="confirm-dialog-actions">
          <button
            className="confirm-dialog-cancel"
            onClick={() => dialogRef.current?.close()}
          >取消</button>
          <button
            className="confirm-dialog-confirm"
            onClick={() => { dialogRef.current?.close(); onConfirm(); }}
          >确认清空</button>
        </div>
      </div>
    </dialog>
  );
  return { open, Dialog };
}

// ─── Toast ────────────────────────────────────────────────────
function Toast({ msg }: { msg: string }) {
  return <div className="toast">{msg}</div>;
}

function useToast() {
  const [toast, setToast] = useState<string | null>(null);
  const show = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1600);
  };
  return { toast, show };
}

// ─── 弹框页（Popup）─────────────────────────────────────────
function PopupPage() {
  const { history, handleCopy, handleClear } = useClipboard();
  const { toast, show } = useToast();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const { open: openClearDialog, Dialog: ClearDialog } = useConfirmDialog(
    () => handleClear().then(() => show("已清空"))
  );

  // 失焦隐藏由 Rust 后端的 on_window_event 处理

  const onCopy = async (item: ClipboardItem) => {
    const id = await handleCopy(item);
    setCopiedId(id);
    show("已复制");
    setTimeout(() => setCopiedId(null), 1200);
  };

  const onOpenMain = async () => {
    await invoke("open_main_window");
    getCurrentWindow().hide();
  };

  const onQuit = () => invoke("quit_app");

  const recent = history.slice(0, 6);
  const truncate = (t: string, max = 60) => t.length > max ? t.slice(0, max) + "…" : t;

  // 点击 popup 容器空白处隐藏窗口
  const handlePopupClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // 如果点击的是容器本身（不是按钮、列表项等可交互元素）
    if (e.target === e.currentTarget) {
      getCurrentWindow().hide();
    }
  };

  return (
    <div className="popup" onClick={handlePopupClick}>
      {toast && <Toast msg={toast} />}

      {/* 标题栏 */}
      <div className="popup-header" onClick={() => getCurrentWindow().hide()}>
        <span className="popup-title">📋 Clipto</span>
        <span className="popup-count">{history.length} 条</span>
      </div>

      {/* 最近记录 */}
      <div className="popup-list">
        {recent.length === 0 ? (
          <div className="popup-empty">
            <span>📭</span>
            <p>暂无记录，复制内容后自动记录</p>
          </div>
        ) : (
          recent.map((item) => (
            <button
              key={item.id}
              className={`popup-item ${copiedId === item.id ? "copied" : ""}`}
              onClick={() => onCopy(item)}
              title={item.content}
            >
              <span className="popup-item-text">{truncate(item.content)}</span>
              <span className="popup-item-time">{item.timestamp.slice(11, 16)}</span>
            </button>
          ))
        )}
      </div>
      <div className="popup-copyright">© 2026 junler</div>

      {/* 底部操作栏 */}
      <div className="popup-footer">
        <button className="popup-footer-btn" onClick={onOpenMain}>
          📂 查看全部
        </button>
        <div className="popup-footer-divider" />
        <button className="popup-footer-btn danger" onClick={openClearDialog}>
          🗑 清空
        </button>
        <button className="popup-footer-btn danger" onClick={onQuit}>
          ⏻ 退出
        </button>
      </div>
      {ClearDialog}
    </div>
  );
}

// ─── 预览面板 ─────────────────────────────────────────────────
function PreviewPanel({ item, onClose, onCopy, copied, onUpdate, onReset }: {
  item: ClipboardItem;
  onClose: () => void;
  onCopy: (content: string) => void;
  copied: boolean;
  onUpdate: (id: number, content: string) => void;
  onReset: (id: number) => void;
}) {
  const [text, setText] = useState(item.content);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // item 切换时同步最新内容
  useEffect(() => { setText(item.content); }, [item.id, item.content]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setText(val);
    setSaving(true);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      onUpdate(item.id, val);
      setSaving(false);
    }, 800);
  };

  const isModified = text !== item.original_content;

  const handleReset = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setText(item.original_content);
    onReset(item.id);
  };

  return (
    <div className="preview-panel">
      <div className="preview-header">
        <span className="preview-title">
          预览 / 编辑
          {isModified && <span className="preview-modified-dot" title="已修改" />}
        </span>
        <div className="preview-header-actions">
          <span className="preview-meta-inline">
            {saving ? "💾 保存中…" : `${item.timestamp} · ${text.length} 字符`}
          </span>
          <button className="preview-close" onClick={onClose} title="关闭">✕</button>
        </div>
      </div>
      <div className="preview-body">
        <textarea
          className="preview-textarea"
          value={text}
          onChange={handleChange}
          spellCheck={false}
        />
      </div>
      <div className="preview-footer">
        {isModified && (
          <button className="preview-btn preview-btn-reset" onClick={handleReset} title="还原为原始粘贴内容">
            ↺ 还原
          </button>
        )}
        <button className="preview-btn" onClick={() => onCopy(text)}>
          {copied ? "✅ 已复制" : "📋 复制"}
        </button>
      </div>
    </div>
  );
}

// ─── 主窗口页（Main）─────────────────────────────────────────
function MainPage() {
  const { history, handleCopy, handleDelete, handleClear, handlePin, handleUpdate, handleReset } = useClipboard("main");
  const { toast, show } = useToast();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [previewItem, setPreviewItem] = useState<ClipboardItem | null>(null);
  const { open: openClearDialog, Dialog: ClearDialog } = useConfirmDialog(
    () => handleClear().then(() => show("已清空"))
  );

  const onCopy = async (item: ClipboardItem) => {
    const id = await handleCopy(item);
    setCopiedId(id);
    show("已复制到剪贴板");
    setTimeout(() => setCopiedId(null), 1200);
  };

  const onPreview = (e: React.MouseEvent, item: ClipboardItem) => {
    e.stopPropagation();
    setPreviewItem((prev) => (prev?.id === item.id ? null : item));
  };

  const filtered = history.filter((item) =>
    item.content.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="app">
      {toast && <Toast msg={toast} />}

      <header className="header">
        <div className="header-title">
          <span className="header-icon">📋</span>
          <h1>Clipto</h1>
        </div>
        <div className="header-actions">
          <span className="count-badge">{history.length} 条记录</span>
          <button className="btn-clear" onClick={openClearDialog}>
            🗑 清空
          </button>
        </div>
      </header>

      <div className="search-bar">
        <span className="search-icon">🔍</span>
        <input
          type="text"
          placeholder="搜索剪贴板内容..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch("")}>✕</button>
        )}
      </div>

      <div className="main-body">
        <div className="list">
          {filtered.length === 0 ? (
            <div className="empty">
              <div className="empty-icon">📭</div>
              <p>{search ? "没有匹配的记录" : "暂无剪贴板历史"}</p>
              <p className="empty-hint">复制任意内容后将自动记录</p>
            </div>
          ) : (
            filtered.map((item, index) => (
              <div
                key={item.id}
                className={`item ${item.pinned ? "pinned" : ""} ${copiedId === item.id ? "copied" : ""} ${previewItem?.id === item.id ? "previewing" : ""}`}
                onClick={() => onCopy(item)}
              >
                <span className="item-index">{index + 1}</span>
                <div className="item-content">
                  <span className="item-text">{item.content}</span>
                  <div className="item-meta">
                    <span className="item-time">{item.timestamp}</span>
                    {item.pinned && <span className="pin-badge">📌 已置顶</span>}
                  </div>
                </div>
                <div className="item-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className={`btn-icon ${previewItem?.id === item.id ? "active" : ""}`}
                    onClick={(e) => onPreview(e, item)}
                    title="预览"
                  >👁</button>
                  <button
                    className={`btn-icon ${item.pinned ? "active" : ""}`}
                    onClick={() => handlePin(item.id)}
                    title={item.pinned ? "取消置顶" : "置顶"}
                  >📌</button>
                  <button
                    className="btn-icon btn-copy"
                    onClick={() => onCopy(item)}
                    title="复制"
                  >{copiedId === item.id ? "✅" : "📋"}</button>
                  <button
                    className="btn-icon btn-delete"
                    onClick={() => handleDelete(item.id)}
                    title="删除"
                  >🗑</button>
                </div>
              </div>
            ))
          )}
        </div>

        {previewItem && (
          <PreviewPanel
            item={previewItem}
            onClose={() => setPreviewItem(null)}
            onCopy={(content) => {
              invoke("copy_to_clipboard", { content });
              setCopiedId(previewItem.id);
              show("已复制到剪贴板");
              setTimeout(() => setCopiedId(null), 1200);
            }}
            copied={copiedId === previewItem.id}
            onUpdate={handleUpdate}
            onReset={handleReset}
          />
        )}
      </div>
      {ClearDialog}
    </div>
  );
}

// ─── 路由入口 ─────────────────────────────────────────────────
function App() {
  const isMain = window.location.hash === "#/main";
  return isMain ? <MainPage /> : <PopupPage />;
}

export default App;
