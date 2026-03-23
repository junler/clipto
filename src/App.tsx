import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
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
        await invoke<ClipboardItem | null>("poll_clipboard");
        // 每次轮询都同步最新列表，确保主窗口的删除/清空等操作也能及时反映
        const data = await invoke<ClipboardItem[]>("get_history");
        setHistory(data);
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = (msg: string, duration = 1600) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast(msg);
    timerRef.current = setTimeout(() => setToast(null), duration);
  };
  return { toast, show };
}

// ─── 平台设置 ─────────────────────────────────────────────
export type TranslatePlatform = "google" | "deepl" | "bing" | "youdao" | "baidu";
export type AiPlatform =
  | "chatgpt"
  | "claude"
  | "copilot"
  | "perplexity"
  | "gemini"
  | "deepseek"
  | "kimi"
  | "doubao"
  | "tongyi"
  | "yuanbao"
  | "wenxin";

const PLATFORM_OPTIONS: { value: TranslatePlatform; label: string; icon: string }[] = [
  { value: "google", label: "Google 翻译", icon: "🌐" },
  { value: "deepl",  label: "DeepL",       icon: "🔵" },
  { value: "bing",   label: "Bing 翻译",   icon: "🔷" },
  { value: "youdao", label: "有道翻译",     icon: "📗" },
  { value: "baidu",  label: "百度翻译",     icon: "🔴" },
];

const AI_OPTIONS: { value: AiPlatform; label: string; icon: string }[] = [
  { value: "chatgpt",    label: "ChatGPT",    icon: "🟢" },
  { value: "claude",     label: "Claude",     icon: "🟠" },
  { value: "copilot",    label: "Copilot",    icon: "🟣" },
  { value: "perplexity", label: "Perplexity", icon: "⚫" },
  { value: "gemini",     label: "Gemini",     icon: "🔵" },
  { value: "deepseek",   label: "DeepSeek",   icon: "🔷" },
  { value: "kimi",       label: "Kimi",       icon: "🌙" },
  { value: "doubao",     label: "豆包",       icon: "🫘" },
  { value: "tongyi",     label: "通义千问",   icon: "📘" },
  { value: "yuanbao",    label: "腾讯元宝",   icon: "💠" },
  { value: "wenxin",     label: "文心一言",   icon: "🧠" },
];

const TRANSLATE_STORAGE_KEY = "clipto_translate_platform";
const AI_STORAGE_KEY = "clipto_ai_platform";
const OPEN_ROUTE_KEY = "clipto_open_route";
const OPEN_SETTINGS_TAB_KEY = "clipto_settings_tab";
const EMAIL_RECEIVERS_KEY = "clipto_email_receivers";
const SMTP_HOST_KEY = "clipto_smtp_host";
const SMTP_PORT_KEY = "clipto_smtp_port";
const SMTP_USERNAME_KEY = "clipto_smtp_username";
const SMTP_PASSWORD_KEY = "clipto_smtp_password";
const SMTP_USE_TLS_KEY = "clipto_smtp_use_tls";
const SHORTCUT_AI_KEY = "clipto_shortcut_ai";
const SHORTCUT_TRANSLATE_KEY = "clipto_shortcut_translate";
const SYNC_EMAIL_COUNT_KEY = "clipto_sync_email_count";

function useTranslatePlatform() {
  const [platform, setPlatformState] = useState<TranslatePlatform>(
    () => (localStorage.getItem(TRANSLATE_STORAGE_KEY) as TranslatePlatform) ?? "google"
  );
  const setPlatform = (p: TranslatePlatform) => {
    localStorage.setItem(TRANSLATE_STORAGE_KEY, p);
    setPlatformState(p);
  };
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TRANSLATE_STORAGE_KEY && e.newValue) {
        setPlatformState(e.newValue as TranslatePlatform);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return { platform, setPlatform };
}

function useAiPlatform() {
  const [platform, setPlatformState] = useState<AiPlatform>(
    () => (localStorage.getItem(AI_STORAGE_KEY) as AiPlatform) ?? "chatgpt"
  );
  const setPlatform = (p: AiPlatform) => {
    localStorage.setItem(AI_STORAGE_KEY, p);
    setPlatformState(p);
  };
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === AI_STORAGE_KEY && e.newValue) {
        setPlatformState(e.newValue as AiPlatform);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  return { platform, setPlatform };
}

function useEmailSettings() {
  const [receiverEmails, setReceiverEmailsState] = useState<string>(
    () => localStorage.getItem(EMAIL_RECEIVERS_KEY) ?? ""
  );

  const setReceiverEmails = (value: string) => {
    localStorage.setItem(EMAIL_RECEIVERS_KEY, value);
    setReceiverEmailsState(value);
  };

  return { receiverEmails, setReceiverEmails };
}

function useSmtpSettings() {
  const [smtpHost, setSmtpHostState] = useState<string>(() => localStorage.getItem(SMTP_HOST_KEY) ?? "");
  const [smtpPort, setSmtpPortState] = useState<string>(() => localStorage.getItem(SMTP_PORT_KEY) ?? "465");
  const [smtpUsername, setSmtpUsernameState] = useState<string>(() => localStorage.getItem(SMTP_USERNAME_KEY) ?? "");
  const [smtpPassword, setSmtpPasswordState] = useState<string>(() => localStorage.getItem(SMTP_PASSWORD_KEY) ?? "");
  const [smtpUseTls, setSmtpUseTlsState] = useState<boolean>(
    () => (localStorage.getItem(SMTP_USE_TLS_KEY) ?? "true") === "true"
  );

  const setSmtpHost = (value: string) => {
    localStorage.setItem(SMTP_HOST_KEY, value);
    setSmtpHostState(value);
  };

  const setSmtpPort = (value: string) => {
    localStorage.setItem(SMTP_PORT_KEY, value);
    setSmtpPortState(value);
  };

  const setSmtpUsername = (value: string) => {
    localStorage.setItem(SMTP_USERNAME_KEY, value);
    setSmtpUsernameState(value);
  };

  const setSmtpPassword = (value: string) => {
    localStorage.setItem(SMTP_PASSWORD_KEY, value);
    setSmtpPasswordState(value);
  };

  const setSmtpUseTls = (value: boolean) => {
    localStorage.setItem(SMTP_USE_TLS_KEY, String(value));
    setSmtpUseTlsState(value);
  };

  return {
    smtpHost,
    setSmtpHost,
    smtpPort,
    setSmtpPort,
    smtpUsername,
    setSmtpUsername,
    smtpPassword,
    setSmtpPassword,
    smtpUseTls,
    setSmtpUseTls,
  };
}

function useShortcutSettings() {
  const [shortcutAi, setShortcutAiState] = useState<string>(
    () => localStorage.getItem(SHORTCUT_AI_KEY) ?? "CommandOrControl+Shift+G"
  );
  const [shortcutTranslate, setShortcutTranslateState] = useState<string>(
    () => localStorage.getItem(SHORTCUT_TRANSLATE_KEY) ?? "CommandOrControl+Shift+T"
  );

  const setShortcutAi = (value: string) => {
    localStorage.setItem(SHORTCUT_AI_KEY, value);
    setShortcutAiState(value);
  };

  const setShortcutTranslate = (value: string) => {
    localStorage.setItem(SHORTCUT_TRANSLATE_KEY, value);
    setShortcutTranslateState(value);
  };

  return { shortcutAi, setShortcutAi, shortcutTranslate, setShortcutTranslate };
}

function parseEmails(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((email) => email.trim())
    .filter(Boolean);
}

function buildTranslateUrl(text: string, platform: TranslatePlatform): string {
  const encoded = encodeURIComponent(text);
  switch (platform) {
    case "google":  return `https://translate.google.com/?sl=auto&tl=auto&text=${encoded}&op=translate`;
    case "deepl":   return `https://www.deepl.com/translator#auto/auto/${encoded}`;
    case "bing":    return `https://www.bing.com/translator?text=${encoded}&from=auto&to=auto-detect`;
    case "youdao":  return `https://fanyi.youdao.com/#auto/auto/${encoded}`;
    case "baidu":   return `https://fanyi.baidu.com/#auto/auto/${encoded}`;
  }
}

function buildAiUrl(text: string, platform: AiPlatform): string {
  const encoded = encodeURIComponent(text);
  switch (platform) {
    case "chatgpt":
      return `https://chatgpt.com/?q=${encoded}`;
    case "claude":
      return `https://claude.ai/new`;
    case "copilot":
      return `https://copilot.microsoft.com/?q=${encoded}`;
    case "perplexity":
      return `https://www.perplexity.ai/search/new?q=${encoded}`;
    case "gemini":
      return `https://gemini.google.com/app`;
    case "deepseek":
      return `https://chat.deepseek.com/`;
    case "kimi":
      return `https://kimi.moonshot.cn/`;
    case "doubao":
      return `https://www.doubao.com/chat/`;
    case "tongyi":
      return `https://tongyi.aliyun.com/qianwen/`;
    case "yuanbao":
      return `https://yuanbao.tencent.com/`;
    case "wenxin":
      return `https://yiyan.baidu.com/`;
  }
}

// ─── 快捷键格式化显示 ─────────────────────────────────────────
function formatShortcut(raw: string): string {
  if (!raw.trim()) return "（未设置）";
  return raw
    .split("+")
    .map((part) => {
      switch (part.trim()) {
        case "CommandOrControl": return "⌘/Ctrl";
        case "Command":         return "⌘";
        case "Control":         return "Ctrl";
        case "Shift":           return "⇧";
        case "Alt":             return "⌥/Alt";
        case "Meta":            return "⊞/⌘";
        default:                return part.trim().toUpperCase();
      }
    })
    .join(" + ");
}

// ─── 设置页 ───────────────────────────────────────────────────
type SettingsTab = "translate" | "ai" | "shortcuts" | "email" | "about";

const SETTINGS_NAV: { key: SettingsTab; icon: string; label: string }[] = [
  { key: "translate", icon: "🌐", label: "翻译平台" },
  { key: "ai",        icon: "🤖", label: "AI 助手" },
  { key: "shortcuts", icon: "⌨️",  label: "快捷键" },
  { key: "email",     icon: "📧", label: "邮件配置" },
  { key: "about",     icon: "ℹ️",  label: "关于" },
];

function SettingsPage({ onBack }: { onBack: () => void }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => {
    const saved = localStorage.getItem(OPEN_SETTINGS_TAB_KEY) as SettingsTab | null;
    if (saved) { localStorage.removeItem(OPEN_SETTINGS_TAB_KEY); return saved; }
    return "translate";
  });
  const { platform: translatePlatform, setPlatform: setTranslatePlatform } = useTranslatePlatform();
  const { platform: aiPlatform, setPlatform: setAiPlatform } = useAiPlatform();
  const { receiverEmails, setReceiverEmails } = useEmailSettings();
  const {
    smtpHost, setSmtpHost,
    smtpPort, setSmtpPort,
    smtpUsername, setSmtpUsername,
    smtpPassword, setSmtpPassword,
    smtpUseTls, setSmtpUseTls,
  } = useSmtpSettings();
  const { shortcutAi, setShortcutAi, shortcutTranslate, setShortcutTranslate } = useShortcutSettings();
  const [shortcutSaving, setShortcutSaving] = useState(false);
  const [shortcutMsg, setShortcutMsg] = useState<string | null>(null);
  const [editAi, setEditAi] = useState(shortcutAi);
  const [editTranslate, setEditTranslate] = useState(shortcutTranslate);

  const saveShortcuts = async () => {
    setShortcutSaving(true);
    setShortcutMsg(null);
    try {
      await invoke("set_shortcuts", {
        aiShortcut: editAi,
        translateShortcut: editTranslate,
      });
      setShortcutAi(editAi);
      setShortcutTranslate(editTranslate);
      setShortcutMsg("✅ 快捷键已保存并生效");
    } catch (err) {
      setShortcutMsg(`❌ ${String(err)}`);
    } finally {
      setShortcutSaving(false);
      setTimeout(() => setShortcutMsg(null), 3000);
    }
  };

  return (
    <div className="settings-page">
      {/* 顶部标题栏 */}
      <header className="header settings-page-header">
        <div className="header-title">
          <span className="header-icon">⚙️</span>
          <h1>设置</h1>
        </div>
        <div className="header-actions">
          <button className="btn-clear" onClick={onBack}>← 返回</button>
        </div>
      </header>

      {/* 双栏主体 */}
      <div className="settings-layout">
        {/* 左侧导航 */}
        <nav className="settings-nav">
          {SETTINGS_NAV.map((item) => (
            <button
              key={item.key}
              className={`settings-nav-item ${activeTab === item.key ? "active" : ""}`}
              onClick={() => setActiveTab(item.key)}
            >
              <span className="settings-nav-icon">{item.icon}</span>
              <span className="settings-nav-label">{item.label}</span>
            </button>
          ))}
        </nav>

        {/* 右侧内容区 */}
        <div className="settings-content">

          {/* 翻译平台 */}
          {activeTab === "translate" && (
            <div className="settings-section-wrap">
              <div className="settings-section-title">默认翻译平台</div>
              <p className="settings-section-desc">点击条目快速切换，翻译按钮将自动使用所选平台打开。</p>
              <div className="settings-options-grid">
                {PLATFORM_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`settings-option-card ${translatePlatform === opt.value ? "active" : ""}`}
                    onClick={() => setTranslatePlatform(opt.value)}
                  >
                    <span className="settings-option-card-icon">{opt.icon}</span>
                    <span className="settings-option-card-label">{opt.label}</span>
                    {translatePlatform === opt.value && <span className="settings-option-card-check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* AI 助手 */}
          {activeTab === "ai" && (
            <div className="settings-section-wrap">
              <div className="settings-section-title">默认 AI 助手</div>
              <p className="settings-section-desc">点击条目快速切换，AI 按钮将自动使用所选平台打开。</p>
              <div className="settings-options-grid">
                {AI_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`settings-option-card ${aiPlatform === opt.value ? "active" : ""}`}
                    onClick={() => setAiPlatform(opt.value)}
                  >
                    <span className="settings-option-card-icon">{opt.icon}</span>
                    <span className="settings-option-card-label">{opt.label}</span>
                    {aiPlatform === opt.value && <span className="settings-option-card-check">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 快捷键 */}
          {activeTab === "shortcuts" && (
            <div className="settings-section-wrap">
              <div className="settings-section-title">全局快捷键</div>
              <p className="settings-section-desc">
                在任意应用中按下快捷键，将自动读取当前剪切板内容并发送到对应平台。
                修改后点击保存立即生效，无需重启。
              </p>

              <div className="settings-form-group">
                <label className="settings-input-label">🤖 发送到 AI 助手</label>
                <div className="shortcut-input-row">
                  <input
                    className="settings-input shortcut-input"
                    type="text"
                    placeholder="例如 CommandOrControl+Shift+A"
                    value={editAi}
                    onChange={(e) => setEditAi(e.target.value)}
                  />
                  <span className="shortcut-preview">{formatShortcut(editAi)}</span>
                </div>
              </div>

              <div className="settings-form-group" style={{ marginTop: 16 }}>
                <label className="settings-input-label">🌐 发送到翻译平台</label>
                <div className="shortcut-input-row">
                  <input
                    className="settings-input shortcut-input"
                    type="text"
                    placeholder="例如 CommandOrControl+Shift+T"
                    value={editTranslate}
                    onChange={(e) => setEditTranslate(e.target.value)}
                  />
                  <span className="shortcut-preview">{formatShortcut(editTranslate)}</span>
                </div>
              </div>

              <div className="shortcut-actions">
                <button
                  className="shortcut-save-btn"
                  onClick={saveShortcuts}
                  disabled={shortcutSaving}
                >
                  {shortcutSaving ? "保存中…" : "保存快捷键"}
                </button>
                {shortcutMsg && <span className="shortcut-msg">{shortcutMsg}</span>}
              </div>

              <div className="settings-divider" />
              <div className="settings-section-title" style={{ fontSize: 13 }}>格式说明</div>
              <div className="shortcut-hint-list">
                {[
                  ["修饰键", "CommandOrControl · Shift · Alt · Meta"],
                  ["字母键", "A–Z"],
                  ["功能键", "F1–F12"],
                  ["组合示例", "CommandOrControl+Shift+A"],
                ].map(([k, v]) => (
                  <div key={k} className="shortcut-hint-row">
                    <span className="shortcut-hint-key">{k}</span>
                    <span className="shortcut-hint-val">{v}</span>
                  </div>
                ))}
              </div>
              <p className="settings-hint">💡 macOS 上 CommandOrControl 对应 ⌘ Command 键；Windows/Linux 对应 Ctrl 键。</p>
            </div>
          )}

          {/* 邮件配置 */}
          {activeTab === "email" && (
            <div className="settings-section-wrap">
              <div className="settings-section-title">邮件收件人</div>
              <p className="settings-section-desc">第一个地址为收件人（To），其余自动添加为抄送（Cc）。</p>
              <div className="settings-form-group">
                <label className="settings-input-label">收件人邮箱</label>
                <textarea
                  className="settings-textarea"
                  placeholder="每行或用逗号/分号分隔一个邮箱地址"
                  value={receiverEmails}
                  onChange={(e) => setReceiverEmails(e.target.value)}
                  rows={3}
                />
              </div>

              <div className="settings-divider" />
              <div className="settings-section-title">SMTP 发信配置</div>
              <p className="settings-section-desc">用于应用直接发信，请填写邮箱服务商提供的 SMTP 信息。</p>

              <div className="settings-form-row">
                <div className="settings-form-group flex-3">
                  <label className="settings-input-label">SMTP 主机</label>
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="例如 smtp.qq.com"
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                  />
                </div>
                <div className="settings-form-group flex-1">
                  <label className="settings-input-label">端口</label>
                  <input
                    className="settings-input"
                    type="number"
                    placeholder="465"
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                  />
                </div>
              </div>

              <div className="settings-form-row">
                <div className="settings-form-group flex-1">
                  <label className="settings-input-label">用户名</label>
                  <input
                    className="settings-input"
                    type="text"
                    placeholder="通常是邮箱账号"
                    value={smtpUsername}
                    onChange={(e) => setSmtpUsername(e.target.value)}
                  />
                </div>
                <div className="settings-form-group flex-1">
                  <label className="settings-input-label">密码 / 授权码</label>
                  <input
                    className="settings-input"
                    type="password"
                    placeholder="邮箱授权码或密码"
                    value={smtpPassword}
                    onChange={(e) => setSmtpPassword(e.target.value)}
                  />
                </div>
              </div>

              <label className="settings-checkbox-row">
                <input
                  type="checkbox"
                  checked={smtpUseTls}
                  onChange={(e) => setSmtpUseTls(e.target.checked)}
                />
                <span>启用 TLS / SSL 加密</span>
              </label>

              <p className="settings-hint">💡 QQ 邮箱请使用授权码而非登录密码，端口推荐 465（SSL）或 587（STARTTLS）。</p>
            </div>
          )}

          {/* 关于 */}
          {activeTab === "about" && (
            <div className="settings-section-wrap">
              <div className="about-app-header">
                <div className="about-app-icon">📋</div>
                <div>
                  <div className="about-app-name">Clipto</div>
                  <div className="about-app-version">版本 0.2.0</div>
                </div>
              </div>

              <p className="about-app-desc">
                Clipto 是一款轻量级剪贴板历史管理工具，基于 Tauri + React 构建，常驻系统托盘，快速访问、编辑并发送你的剪贴板内容。
              </p>

              <div className="about-info-list">
                <div className="about-info-row">
                  <span className="about-info-key">开发者</span>
                  <span className="about-info-val">junler</span>
                </div>
                <div className="about-info-row">
                  <span className="about-info-key">技术栈</span>
                  <span className="about-info-val">Tauri 2 · React · TypeScript</span>
                </div>
                <div className="about-info-row">
                  <span className="about-info-key">标识符</span>
                  <span className="about-info-val">com.junler.clipto</span>
                </div>
                <div className="about-info-row">
                  <span className="about-info-key">发布年份</span>
                  <span className="about-info-val">2026</span>
                </div>
              </div>

              <div className="settings-section-title" style={{ marginTop: 4 }}>主要功能</div>
              <div className="about-features">
                {[
                  { icon: "⚡", text: "实时监听剪贴板，自动记录历史" },
                  { icon: "📌", text: "置顶常用条目，优先展示" },
                  { icon: "✏️", text: "在线编辑内容，支持一键还原" },
                  { icon: "🌐", text: "快速跳转翻译平台" },
                  { icon: "🤖", text: "一键发送至 AI 助手" },
                  { icon: "📧", text: "直接通过 SMTP 发送邮件" },
                  { icon: "🔍", text: "全文搜索历史记录" },
                  { icon: "🌙", text: "支持深色模式自动切换" },
                ].map((f, i) => (
                  <div key={i} className="about-feature-item">
                    <span className="about-feature-icon">{f.icon}</span>
                    <span className="about-feature-text">{f.text}</span>
                  </div>
                ))}
              </div>

              <p className="settings-hint" style={{ marginTop: 2 }}>© 2026 junler · 保留所有权利</p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── 弹框页（Popup）─────────────────────────────────────────
function PopupPage() {
  const { history, handleCopy } = useClipboard();
  const { toast, show } = useToast();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sendingMailId, setSendingMailId] = useState<number | null>(null);
  const { platform } = useTranslatePlatform();
  const { platform: aiPlatform } = useAiPlatform();
  const { receiverEmails } = useEmailSettings();
  const { smtpHost, smtpPort, smtpUsername, smtpPassword, smtpUseTls } = useSmtpSettings();

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

  const onOpenSettings = async () => {
    localStorage.setItem(OPEN_ROUTE_KEY, "#/settings");
    await invoke("open_main_window");
    getCurrentWindow().hide();
  };

  const onQuit = () => invoke("quit_app");

  const recent = history.slice(0, 6);
  const truncate = (t: string, max = 60) => t.length > max ? t.slice(0, max) + "…" : t;

  const onTranslate = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    openUrl(buildTranslateUrl(text, platform));
  };

  const onAskAi = (text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    openUrl(buildAiUrl(text, aiPlatform));
  };

  const onSendMail = async (id: number, text: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const recipients = parseEmails(receiverEmails);
    const port = Number(smtpPort);
    if (recipients.length === 0 || !smtpHost || !smtpUsername || !smtpPassword || !port) {
      show("请完善发信配置");
      return;
    }

    setSendingMailId(id);
    show("发送中...");

    try {
      await invoke("send_email", {
        content: text,
        recipients,
        smtpHost,
        smtpPort: port,
        smtpUsername,
        smtpPassword,
        smtpUseTls,
      });
      show("邮件已发送");
    } catch (err) {
      show(`发送失败: ${String(err)}`);
    } finally {
      setSendingMailId(null);
    }
  };

  const platformInfo = PLATFORM_OPTIONS.find((o) => o.value === platform)!;
  const aiInfo = AI_OPTIONS.find((o) => o.value === aiPlatform)!;

  // 点击 popup 容器空白处隐藏窗口
  const handlePopupClick = (e: React.MouseEvent<HTMLDivElement>) => {
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
        <span
          className="popup-count popup-count-link"
          onClick={(e) => { e.stopPropagation(); onOpenMain(); }}
          title="查看全部记录"
        >{history.length} 条 ›</span>
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
            <div key={item.id} className="popup-item-row">
              <button
                className={`popup-item ${copiedId === item.id ? "copied" : ""}`}
                onClick={() => onCopy(item)}
                title={item.content}
              >
                <span className="popup-item-text">{truncate(item.content)}</span>
                <span className="popup-item-time">{item.timestamp.slice(11, 16)}</span>
              </button>
              <button
                className="popup-translate-btn"
                onClick={(e) => onTranslate(item.content, e)}
                title={`用 ${platformInfo.label} 翻译`}
              >🌐</button>
              <button
                className="popup-ai-btn"
                onClick={(e) => onAskAi(item.content, e)}
                title={`用 ${aiInfo.label} 打开`}
              >🤖</button>
              <button
                className="popup-email-btn"
                onClick={(e) => onSendMail(item.id, item.content, e)}
                title={sendingMailId === item.id ? "发送中..." : "发送到邮箱"}
                disabled={sendingMailId === item.id}
              >{sendingMailId === item.id ? "⏳" : "📧"}</button>
            </div>
          ))
        )}
      </div>
      <div
        className="popup-copyright popup-copyright-link"
        onClick={async (e) => {
          e.stopPropagation();
          localStorage.setItem(OPEN_ROUTE_KEY, "#/settings");
          localStorage.setItem(OPEN_SETTINGS_TAB_KEY, "about");
          await invoke("open_main_window");
          getCurrentWindow().hide();
        }}
        title="查看关于"
      >© 2026 junler</div>

      {/* 底部操作栏 */}
      <div className="popup-footer">
        <button className="popup-footer-btn" onClick={onOpenMain}>
          📂 查看全部
        </button>
        <div className="popup-footer-divider" />
        <button className="popup-footer-btn" onClick={onOpenSettings}>
          ⚙️ 设置
        </button>
        <button className="popup-footer-btn danger" onClick={onQuit}>
          ⏻ 退出
        </button>
      </div>
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
  const { platform } = useTranslatePlatform();
  const { platform: aiPlatform } = useAiPlatform();
  const { receiverEmails } = useEmailSettings();
  const { smtpHost, smtpPort, smtpUsername, smtpPassword, smtpUseTls } = useSmtpSettings();
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [sendingMailId, setSendingMailId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [previewItem, setPreviewItem] = useState<ClipboardItem | null>(null);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [syncCount, setSyncCount] = useState<number>(() => {
    const stored = localStorage.getItem(SYNC_EMAIL_COUNT_KEY);
    return stored !== null ? Number(stored) : 1000;
  });
  const [syncing, setSyncing] = useState(false);
  const syncDialogRef = useRef<HTMLDialogElement>(null);
  const { open: openClearDialog, Dialog: ClearDialog } = useConfirmDialog(
    () => handleClear().then(() => show("已清空"))
  );

  useEffect(() => {
    if (syncDialogOpen) syncDialogRef.current?.showModal();
    else syncDialogRef.current?.close();
  }, [syncDialogOpen]);

  const onSyncAllToEmail = async () => {
    const recipients = parseEmails(receiverEmails);
    const port = Number(smtpPort);
    if (recipients.length === 0 || !smtpHost || !smtpUsername || !smtpPassword || !port) {
      show("请先完善邮件配置（设置 › 邮件配置）");
      return;
    }
    setSyncDialogOpen(true);
  };

  const doSyncAllToEmail = async () => {
    setSyncDialogOpen(false);
    const items = syncCount > 0 ? history.slice(0, syncCount) : history;
    if (items.length === 0) { show("暂无记录可同步"); return; }
    const recipients = parseEmails(receiverEmails);
    const port = Number(smtpPort);
    setSyncing(true);
    show(`同步中，共 ${items.length} 条…`);
    try {
      const content = items
        .map((it, i) => `[${i + 1}] ${it.timestamp}\n${it.content}`)
        .join("\n\n---\n\n");
      await invoke("send_email", {
        content,
        recipients,
        smtpHost,
        smtpPort: port,
        smtpUsername,
        smtpPassword,
        smtpUseTls,
      });
      show(`已同步 ${items.length} 条记录到邮箱`);
    } catch (err) {
      show(`同步失败: ${String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

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

  const onOpenSettings = () => {
    window.location.hash = "#/settings";
  };

  const filtered = history.filter((item) =>
    item.content.toLowerCase().includes(search.toLowerCase())
  );

  const platformInfo = PLATFORM_OPTIONS.find((o) => o.value === platform)!;
  const aiInfo = AI_OPTIONS.find((o) => o.value === aiPlatform)!;

  const onSendMail = async (id: number, content: string) => {
    const recipients = parseEmails(receiverEmails);
    const port = Number(smtpPort);
    if (recipients.length === 0 || !smtpHost || !smtpUsername || !smtpPassword || !port) {
      show("请完善发信配置");
      return;
    }

    setSendingMailId(id);
    show("发送中...");

    try {
      await invoke("send_email", {
        content,
        recipients,
        smtpHost,
        smtpPort: port,
        smtpUsername,
        smtpPassword,
        smtpUseTls,
      });
      show("邮件已发送");
    } catch (err) {
      show(`发送失败: ${String(err)}`);
    } finally {
      setSendingMailId(null);
    }
  };

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
          <button
            className="btn-settings"
            onClick={onSyncAllToEmail}
            disabled={syncing}
            title="同步剪贴板记录到邮箱"
          >
            {syncing ? "⏳ 同步中…" : "📤 同步到邮件"}
          </button>
          <button className="btn-settings" onClick={onOpenSettings}>
            ⚙️ 设置
          </button>
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
                    className="btn-icon btn-translate"
                    onClick={() => openUrl(buildTranslateUrl(item.content, platform))}
                    title={`用 ${platformInfo.label} 翻译`}
                  >🌐</button>
                  <button
                    className="btn-icon btn-ai"
                    onClick={() => openUrl(buildAiUrl(item.content, aiPlatform))}
                    title={`用 ${aiInfo.label} 打开`}
                  >🤖</button>
                  <button
                    className="btn-icon btn-email"
                    onClick={() => onSendMail(item.id, item.content)}
                    title={sendingMailId === item.id ? "发送中..." : "发送到邮箱"}
                    disabled={sendingMailId === item.id}
                  >{sendingMailId === item.id ? "⏳" : "📧"}</button>
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

      {/* 同步到邮件对话框 */}
      <dialog
        ref={syncDialogRef}
        className="confirm-dialog"
        onClose={() => setSyncDialogOpen(false)}
      >
        <div className="confirm-dialog-body sync-email-dialog-body">
          <p className="confirm-dialog-icon">📤</p>
          <p className="confirm-dialog-title">同步剪贴板到邮件</p>
          <p className="confirm-dialog-desc">
            数量留空或填 <strong>0</strong> 表示同步全部 {history.length} 条。
          </p>
          <div className="sync-email-count-row">
            <label className="sync-email-count-label">同步最新</label>
            <input
              className="sync-email-count-input"
              type="number"
              min={0}
              max={history.length}
              value={syncCount === 0 ? "" : syncCount}
              placeholder={`0（全部 ${history.length} 条）`}
              onChange={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                setSyncCount(v);
                localStorage.setItem(SYNC_EMAIL_COUNT_KEY, String(v));
              }}
            />
            <label className="sync-email-count-label">条</label>
          </div>
          <div className="confirm-dialog-actions">
            <button
              className="confirm-dialog-cancel"
              onClick={() => setSyncDialogOpen(false)}
            >取消</button>
            <button
              className="confirm-dialog-confirm sync-email-confirm-btn"
              onClick={doSyncAllToEmail}
            >确认同步</button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

// ─── 路由入口 ─────────────────────────────────────────────────
function App() {
  const [route, setRoute] = useState(() => window.location.hash || "#/popup");

  useEffect(() => {
    const syncRoute = () => setRoute(window.location.hash || "#/popup");
    const onStorage = (e: StorageEvent) => {
      if (e.key === OPEN_ROUTE_KEY && e.newValue) {
        window.location.hash = e.newValue;
        localStorage.removeItem(OPEN_ROUTE_KEY);
        syncRoute();
      }
    };

    const pendingRoute = localStorage.getItem(OPEN_ROUTE_KEY);
    if (pendingRoute) {
      window.location.hash = pendingRoute;
      localStorage.removeItem(OPEN_ROUTE_KEY);
      syncRoute();
    }

    window.addEventListener("hashchange", syncRoute);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("hashchange", syncRoute);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // 监听全局快捷键事件（由 Rust 后端触发）
  // 只在 popup 窗口中处理，避免多窗口重复触发
  useEffect(() => {
    if (getCurrentWindow().label !== "popup") return;

    const unlistenAi = listen<string>("shortcut-open-ai", (event) => {
      const text = event.payload;
      if (!text.trim()) return;
      const aiPlatform = (localStorage.getItem(AI_STORAGE_KEY) as AiPlatform) ?? "chatgpt";
      openUrl(buildAiUrl(text, aiPlatform));
    });

    const unlistenTranslate = listen<string>("shortcut-open-translate", (event) => {
      const text = event.payload;
      if (!text.trim()) return;
      const translatePlatform = (localStorage.getItem(TRANSLATE_STORAGE_KEY) as TranslatePlatform) ?? "google";
      openUrl(buildTranslateUrl(text, translatePlatform));
    });

    return () => {
      unlistenAi.then((fn) => fn());
      unlistenTranslate.then((fn) => fn());
    };
  }, []);

  if (route === "#/main") return <MainPage />;
  if (route === "#/settings") return <SettingsPage onBack={() => { window.location.hash = "#/main"; }} />;
  return <PopupPage />;
}

export default App;
