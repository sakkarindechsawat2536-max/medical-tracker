import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useOrders } from "../hooks/useOrders";
import { StatusPill, DaysBadge } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { deleteOrder } from "../lib/firestore";

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
    return m && (fs==="all" || o.status===fs);
  });

  // หาเลขที่ใบสั่งซื้อที่ซ้ำกันในระบบ เพื่อขึ้นป้ายเตือนให้เห็นชัด
  const duplicateNumbers = useMemo(() => {
    const counts = {};
    orders.forEach(o => { if (o.orderNumber) counts[o.orderNumber] = (counts[o.orderNumber]||0) + 1; });
    return new Set(Object.keys(counts).filter(k => counts[k] > 1));
  }, [orders]);

  async function handleDelete(o) {
    const canDelete = isManager || o.ownerId === user?.uid;
    if (!canDelete) { toast.error("คุณไม่มีสิทธิ์ลบใบสั่งซื้อนี้"); return; }
    const ok = window.confirm(
      `ยืนยันลบใบสั่งซื้อเลขที่ "${o.orderNumber}" (${o.hospital || "-"})?\n\nการลบจะลบรายการสินค้าและประวัติการส่งมอบที่เกี่ยวข้องทั้งหมดไปด้วย และไม่สามารถกู้คืนได้`
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
            {duplicateNumbers.size > 0 && (
              <span className="ml-2 text-amber-600 font-semibold">⚠ พบเลขที่ซ้ำ {duplicateNumbers.size} เลขที่</span>
            )}
          </p>
        </div>
        <Link to="/upload" className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition text-center">+ เพิ่มจาก PDF</Link>
      </div>
      <div className="flex gap-3 mb-4 flex-wrap">
        <input value={q} onChange={e=>setQ(e.target.value.toLowerCase())} placeholder="ค้นหาเลขที่ใบสั่งซื้อ หรือโรงพยาบาล..."
          className="flex-1 min-w-48 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"/>
        {FILTERS.map(f=>(
          <button key={f.v} onClick={()=>setFs(f.v)}
            className={`px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer transition ${fs===f.v?"bg-slate-800 text-white border-slate-800":"bg-white text-slate-600 border-slate-200 hover:border-slate-400"}`}>
            {f.l}
          </button>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? <div className="p-8 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />กำลังโหลด...
          </div>
        : error ? <div className="p-8 text-center text-sm">
            <div className="text-red-500 font-semibold mb-2">⚠ โหลดข้อมูลไม่สำเร็จ</div>
            <div className="text-slate-400 mb-3 break-words">{error}</div>
            <button onClick={refresh} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer">ลองใหม่</button>
          </div>
        : filtered.length===0 ? <div className="p-8 text-center text-slate-400 text-sm">ไม่พบรายการ</div>
        : <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="bg-slate-50 border-b-2 border-slate-200">
              {["เลขที่ใบสั่งซื้อ","โรงพยาบาล / แผนก","กำหนดส่ง","สถานะ",""].map(h=>(
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400">{h}</th>
              ))}
            </tr></thead>
            <tbody>{filtered.map(o=>{
              const isDup = duplicateNumbers.has(o.orderNumber);
              const canDelete = isManager || o.ownerId === user?.uid;
              return (
              <tr key={o.id} className={`border-b border-slate-50 hover:bg-slate-50 transition ${isDup ? "bg-amber-50/40" : ""}`}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="font-bold text-blue-900">{o.orderNumber}</div>
                    {isDup && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="พบใบสั่งซื้อเลขที่นี้มากกว่า 1 รายการในระบบ">
                        ซ้ำ
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-400">{o.contractNumber}</div>
                </td>
                <td className="px-4 py-3"><div className="font-semibold text-slate-800">{o.hospital}</div><div className="text-xs text-slate-400">{o.department} · {o.contactPerson}</div></td>
                <td className="px-4 py-3"><div className="text-xs text-slate-400 mb-1">{fmt(o.dueDate)}</div><DaysBadge dueDate={o.dueDate} status={o.status}/></td>
                <td className="px-4 py-3"><StatusPill status={o.status}/></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link to={`/orders/${o.id}`} className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg transition">ดู</Link>
                    {canDelete && (
                      <button onClick={()=>handleDelete(o)} disabled={deletingId===o.id}
                        className="text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 px-3 py-1.5 rounded-lg transition cursor-pointer disabled:opacity-50">
                        {deletingId===o.id ? "..." : "ลบ"}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
              );
            })}</tbody>
          </table>
          </div>
        }
      </div>
    </div>
  );
}
