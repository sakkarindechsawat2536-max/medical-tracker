import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useOrders } from "../hooks/useOrders";
import { StatusPill, DaysBadge } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { deleteOrder } from "../lib/firestore";
import { effectiveStatus } from "../lib/orderStatus";
import { isJunkNumber } from "../lib/orderNumber";

const fmt = d => d ? new Date(d?.toDate?d.toDate():d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}) : "—";
const FILTERS = [{v:"all",l:"ทั้งหมด"},{v:"overdue",l:"เกินกำหนด"},{v:"partial",l:"ส่งบางส่วน"},{v:"pending",l:"รอดำเนินการ"},{v:"completed",l:"ส่งครบแล้ว"}];

export default function Orders() {
  const { orders, loading, error, refresh } = useOrders();
  const { user, isManager } = useAuth();
  const toast = useToast();
  const [q, setQ]   = useState("");
  const [fs, setFs] = useState("all");
  const [deletingId, setDeletingId] = useState(null);

  const filtered = orders.filter(o => {
    const m = !q || o.orderNumber?.toLowerCase().includes(q) || o.hospital?.toLowerCase().includes(q);
    return m && (fs==="all" || effectiveStatus(o)===fs);
  });

  // หาใบสั่งซื้อที่มีเลขที่ซ้ำกันจริงๆ ในระบบ (อิงเลขที่ใบสั่ง หรือเลขที่ "No." จาก PDF เมื่อไม่มีเลขที่ใบสั่งจริง)
  // ค่าขยะอย่าง "-" (ใบสั่งของคลินิกที่ไม่มีเลขที่ใบสั่งซื้อ) จะไม่ถูกนับว่าซ้ำ แม้จะมีหลายใบ
  const duplicateIds = useMemo(() => {
    const dupKey = o => {
      if (!isJunkNumber(o.orderNumber)) return `on:${o.orderNumber}`;
      if (!isJunkNumber(o.pdfNo)) return `no:${o.pdfNo}`;
      return null;
    };
    const counts = {};
    orders.forEach(o => { const k = dupKey(o); if (k) counts[k] = (counts[k]||0) + 1; });
    return new Set(orders.filter(o => { const k = dupKey(o); return k && counts[k] > 1; }).map(o => o.id));
  }, [orders]);

  async function handleDelete(o) {
    const canDelete = isManager || o.ownerId === user?.uid;
    if (!canDelete) { toast.error("คุณไม่มีสิทธิ์ลบใบสั่งซื้อนี้"); return; }
    const ok = window.confirm(
      `ยืนยันลบใบสั่งซื้อเลขที่ "${o.orderNumber || "-"}" (${o.hospital || "-"})?\n\nการลบจะลบรายการสินค้า ประวัติการส่งมอบ และรายการเงินกันที่ผูกกับใบสั่งซื้อนี้ทั้งหมดไปด้วย และไม่สามารถกู้คืนได้`
    );
    if (!ok) return;
    setDeletingId(o.id);
    const toastId = toast.loading("กำลังลบใบสั่งซื้อ...");
    try {
      await deleteOrder(o.id);
      toast.success("ลบใบสั่งซื้อสำเร็จ", { id: toastId });
      refresh();
    } catch (e) {
      toast.error(`ลบไม่สำเร็จ: ${e?.message || e}`, { id: toastId });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">ใบสั่งซื้อของฉัน</h1>
          <p className="text-sm text-slate-400 mt-1">
            {orders.length} รายการ
            {duplicateIds.size > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">⚠ พบเลขที่ซ้ำ {duplicateIds.size} รายการ</span>
            )}
          </p>
        </div>
        <Link to="/upload" className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition text-center">+ เพิ่มจาก PDF</Link>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-3 mb-5 flex gap-2.5 flex-wrap items-center">
        <input value={q} onChange={e=>setQ(e.target.value.toLowerCase())} placeholder="🔍 ค้นหาเลขที่ใบสั่งซื้อ หรือโรงพยาบาล..."
          className="flex-1 min-w-52 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-slate-400 transition"/>
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(f=>(
            <button key={f.v} onClick={()=>setFs(f.v)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer transition ${fs===f.v?"bg-slate-800 text-white":"bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>
              {f.l}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <span className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />กำลังโหลด...
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-sm">
          <div className="text-red-500 font-semibold mb-2">⚠ โหลดข้อมูลไม่สำเร็จ</div>
          <div className="text-slate-400 mb-3 break-words">{error}</div>
          <button onClick={refresh} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer">ลองใหม่</button>
        </div>
      ) : filtered.length===0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 text-sm">ไม่พบรายการ</div>
      ) : (
        <div className="grid gap-2.5">
          {filtered.map(o => {
            const isDup = duplicateIds.has(o.id);
            const canDelete = isManager || o.ownerId === user?.uid;
            const hasRealNumber = !isJunkNumber(o.orderNumber);
            const hasPdfNo = !isJunkNumber(o.pdfNo) && o.pdfNo !== o.orderNumber;
            const title = hasRealNumber ? o.orderNumber : (hasPdfNo ? `No. ${o.pdfNo}` : "ไม่มีเลขที่ใบสั่งซื้อ");

            return (
              <div key={o.id}
                className={`bg-white rounded-2xl border p-4 sm:p-5 shadow-sm transition hover:shadow-md ${isDup ? "border-amber-200 bg-amber-50/30" : "border-slate-200"}`}>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`font-bold ${hasRealNumber ? "text-blue-900" : "text-slate-400"}`}>{title}</span>
                      {isDup && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="พบเลขที่นี้มากกว่า 1 รายการในระบบ">
                          ซ้ำ
                        </span>
                      )}
                      <StatusPill status={effectiveStatus(o)}/>
                    </div>
                    <div className="font-semibold text-slate-800 text-sm">{o.hospital}</div>
                    <div className="text-xs text-slate-400 mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5">
                      {(o.department || o.contactPerson) && <span>{[o.department, o.contactPerson].filter(Boolean).join(" · ")}</span>}
                      {o.orderDate && <span>ออกใบสั่ง {fmt(o.orderDate)}</span>}
                      {hasRealNumber && hasPdfNo && <span>No. {o.pdfNo}</span>}
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:flex-col sm:items-end gap-1.5 sm:gap-1 sm:text-right sm:border-l sm:border-slate-100 sm:pl-4 shrink-0">
                    <div className="text-xs text-slate-400">กำหนดส่ง {fmt(o.dueDate)}</div>
                    <DaysBadge dueDate={o.dueDate} status={o.status}/>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 sm:border-l sm:border-slate-100 sm:pl-4">
                    <Link to={`/orders/${o.id}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition">ดู</Link>
                    {canDelete && (
                      <button onClick={()=>handleDelete(o)} disabled={deletingId===o.id}
                        className="text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50">
                        {deletingId===o.id ? "..." : "ลบ"}
                      </button>
                    )}
                  </div>

                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
