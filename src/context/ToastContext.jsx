import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

let seq = 0;
const nextId = () => `t${++seq}_${Date.now()}`;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const remove = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id));
    if (timers.current[id]) { clearTimeout(timers.current[id]); delete timers.current[id]; }
  }, []);

  const upsert = useCallback((id, patch) => {
    setToasts((list) => {
      const idx = list.findIndex((t) => t.id === id);
      if (idx === -1) return [...list, { id, ...patch }];
      const copy = list.slice();
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  }, []);

  const autoDismiss = useCallback((id, ms) => {
    if (timers.current[id]) clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => remove(id), ms);
  }, [remove]);

  const api = useRef({
    // แสดง toast กำลังโหลด — คืนค่า id ไว้ใช้ update/dismiss ทีหลัง
    loading(message) {
      const id = nextId();
      upsert(id, { type: "loading", message });
      return id;
    },
    success(message, opts = {}) {
      const id = opts.id || nextId();
      upsert(id, { type: "success", message });
      autoDismiss(id, opts.duration ?? 3000);
      return id;
    },
    error(message, opts = {}) {
      const id = opts.id || nextId();
      upsert(id, { type: "error", message });
      autoDismiss(id, opts.duration ?? 4500);
      return id;
    },
    info(message, opts = {}) {
      const id = opts.id || nextId();
      upsert(id, { type: "info", message });
      autoDismiss(id, opts.duration ?? 3000);
      return id;
    },
    dismiss(id) { remove(id); },
    // helper: รัน async task พร้อม toast loading → success/error อัตโนมัติ
    async promise(task, { loading: loadingMsg, success: successMsg, error: errorMsg }) {
      const id = nextId();
      upsert(id, { type: "loading", message: loadingMsg || "กำลังดำเนินการ..." });
      try {
        const result = await task;
        const msg = typeof successMsg === "function" ? successMsg(result) : (successMsg || "สำเร็จ");
        upsert(id, { type: "success", message: msg });
        autoDismiss(id, 3000);
        return result;
      } catch (e) {
        const msg = typeof errorMsg === "function" ? errorMsg(e) : (errorMsg || `เกิดข้อผิดพลาด: ${e?.message || e}`);
        upsert(id, { type: "error", message: msg });
        autoDismiss(id, 5000);
        throw e;
      }
    },
  }).current;

  return (
    <ToastContext.Provider value={{ toasts, ...api, remove }}>
      {children}
      <ToastViewport toasts={toasts} onClose={remove} />
    </ToastContext.Provider>
  );
}

function Icon({ type }) {
  if (type === "loading") return (
    <span className="flex-shrink-0 w-4 h-4 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" />
  );
  if (type === "success") return <span className="flex-shrink-0 text-teal-600 text-base leading-none">✅</span>;
  if (type === "error")   return <span className="flex-shrink-0 text-red-600 text-base leading-none">⚠</span>;
  return <span className="flex-shrink-0 text-blue-600 text-base leading-none">ℹ</span>;
}

function ToastViewport({ toasts, onClose }) {
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed z-[100] flex flex-col gap-2
                 top-3 left-3 right-3
                 sm:top-4 sm:left-auto sm:right-4 sm:w-80"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-start gap-2.5 rounded-xl border shadow-lg px-4 py-3 text-sm bg-white animate-[toast-in_0.18s_ease-out]
            ${t.type === "success" ? "border-teal-200" : t.type === "error" ? "border-red-200" : t.type === "loading" ? "border-blue-200" : "border-slate-200"}`}
        >
          <Icon type={t.type} />
          <div className="flex-1 min-w-0">
            {t.type === "loading" && (
              <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden mb-1.5">
                <div className="h-full w-1/3 bg-blue-500 rounded-full animate-[toast-bar_1.1s_ease-in-out_infinite]" />
              </div>
            )}
            <div className="text-slate-700 font-medium leading-snug break-words">{t.message}</div>
          </div>
          {t.type !== "loading" && (
            <button onClick={() => onClose(t.id)} className="flex-shrink-0 text-slate-300 hover:text-slate-500 cursor-pointer leading-none text-base">✕</button>
          )}
        </div>
      ))}
      <style>{`
        @keyframes toast-in { from { opacity:0; transform:translateY(-6px);} to { opacity:1; transform:translateY(0);} }
        @keyframes toast-bar { 0% { margin-left:-33%; } 50% { margin-left:66%; } 100% { margin-left:-33%; } }
      `}</style>
    </div>
  );
}

export const useToast = () => useContext(ToastContext);
