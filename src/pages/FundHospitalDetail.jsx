import { useState, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useFundOrders } from "../hooks/useFundOrders";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { fundOrderAllocated, fundOrderStatus, FundStatusPill } from "../components/StatusPill";
import { deleteFundOrder } from "../lib/firestore";
import FundOrderModal from "../components/FundOrderModal";

const fmtMoney = n => (n === null || n === undefined || isNaN(n)) ? "–" :
  n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
const fmtDate = iso => {
  if (!iso) return "—";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("th-TH", { day:"numeric", month:"short", year:"numeric" });
};

export default function FundHospitalDetail() {
  const { hospital: hospitalParam } = useParams();
  const hospital = decodeURIComponent(hospitalParam);
  const { fundOrders, loading, error, refresh } = useFundOrders();
  const { user, isManager } = useAuth();
  const toast = useToast();
  const [modal, setModal] = useState(null); // {mode:'add'|'edit', order?}
  const [deptFilter, setDeptFilter] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const orders = useMemo(() =>
    fundOrders.filter(o => o.hospital === hospital)
      .sort((a,b) => (b.date||"").localeCompare(a.date||"")),
  [fundOrders, hospital]);

  const filtered = deptFilter ? orders.filter(o => o.dept === deptFilter) : orders;

  const totals = useMemo(() => {
    const allocated = orders.reduce((s,o) => s + fundOrderAllocated(o), 0);
    const deducted  = orders.reduce((s,o) => s + (o.deduct||0), 0);
    return { allocated, deducted, remaining: allocated - deducted };
  }, [orders]);

  const deptBreakdown = useMemo(() => {
    const map = new Map();
    for (const o of orders) {
      const key = o.dept || "ไม่ระบุ";
      if (!map.has(key)) map.set(key, { dept:key, allocated:0, deducted:0, count:0 });
      const d = map.get(key);
      d.allocated += fundOrderAllocated(o); d.deducted += (o.deduct||0); d.count += 1;
    }
    return Array.from(map.values()).sort((a,b) => b.allocated - a.allocated);
  }, [orders]);

  async function handleDelete(o) {
    const canDelete = isManager || o.createdBy === user?.uid;
    if (!canDelete) { toast.error("คุณไม่มีสิทธิ์ลบรายการนี้"); return; }
    const ok = window.confirm(`ยืนยันลบรายการเงินกันเลขที่ "${o.orderNo || "-"}" ?\n\nไม่สามารถกู้คืนได้`);
    if (!ok) return;
    setDeletingId(o.id);
    const toastId = toast.loading("กำลังลบรายการ...");
    try {
      await deleteFundOrder(o.id);
      toast.success("ลบรายการเรียบร้อย", { id: toastId });
      refresh();
    } catch (e) {
      toast.error(`ลบไม่สำเร็จ: ${e?.message || e}`, { id: toastId });
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) return (
    <div className="flex items-center gap-2 text-slate-400">
      <span className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />กำลังโหลด...
    </div>
  );
  if (error) return (
    <div className="max-w-md">
      <div className="text-red-500 font-semibold mb-2">⚠ โหลดข้อมูลไม่สำเร็จ</div>
      <div className="text-sm text-slate-500 mb-4 break-words">{error}</div>
      <button onClick={refresh} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold cursor-pointer">ลองใหม่</button>
    </div>
  );

  const usedPct = totals.allocated > 0 ? Math.min(100, (totals.deducted / totals.allocated) * 100) : 0;

  return (
    <div>
      <Link to="/fund" className="text-blue-600 text-sm font-semibold hover:underline">← กลับรายชื่อโรงพยาบาล</Link>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mt-4 mb-5">
        <h1 className="text-2xl font-extrabold text-slate-800 break-words">{hospital}</h1>
        <button onClick={() => setModal({ mode:"add" })}
          className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-600 cursor-pointer self-start">
          + เพิ่มรายการ
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <div className="h-4 rounded-full bg-slate-100 overflow-hidden flex mb-3">
          <div className="h-full bg-amber-500" style={{ width: `${usedPct}%` }} />
          <div className="h-full bg-teal-600" style={{ width: `${100 - usedPct}%` }} />
        </div>
        <div className="flex gap-6 sm:gap-8 flex-wrap">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">เงินกันทั้งหมด</div>
            <div className="font-mono font-bold text-lg text-slate-800">฿{fmtMoney(totals.allocated)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">ใช้ไปแล้ว</div>
            <div className="font-mono font-bold text-lg text-amber-600">฿{fmtMoney(totals.deducted)}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-slate-400 mb-0.5">คงเหลือ</div>
            <div className={`font-mono font-bold text-lg ${totals.remaining<0?"text-red-600":"text-teal-700"}`}>฿{fmtMoney(totals.remaining)}</div>
          </div>
        </div>
      </div>

      {deptBreakdown.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 mb-5">
          {deptBreakdown.map(d => (
            <button key={d.dept} onClick={() => setDeptFilter(f => f === d.dept ? null : d.dept)}
              className={`text-left rounded-lg border p-3 cursor-pointer transition ${deptFilter===d.dept ? "border-teal-500 bg-teal-50" : "border-slate-200 bg-white hover:border-teal-300"}`}>
              <div className="font-bold text-xs mb-1.5">{d.dept}</div>
              <div className="text-[11px] font-mono text-slate-500">฿{fmtMoney(d.allocated)}</div>
              <div className="text-[10px] text-slate-400 mt-0.5">{d.count} รายการ</div>
            </button>
          ))}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-800 flex items-center justify-between">
          <span>รายการเงินกัน</span>
          {deptFilter && (
            <button onClick={() => setDeptFilter(null)} className="text-xs text-teal-600 hover:underline cursor-pointer">
              ล้างตัวกรอง "{deptFilter}" ✕
            </button>
          )}
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">ไม่มีรายการ</div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="bg-slate-50 border-b-2 border-slate-200">
              {["วันที่","เลขที่ใบสั่ง","แผนก","เงินกันซื้อของ","เงินกันเดินทาง","เงินกันกล้อง","เคลียร์แล้ว","คงเหลือ","สถานะ",""].map(h => (
                <th key={h} className="text-left px-3 py-3 text-xs font-bold text-slate-400 whitespace-nowrap">{h}</th>
              ))}
            </tr></thead>
            <tbody>{filtered.map(o => {
              const alloc = fundOrderAllocated(o);
              const remain = alloc - (o.deduct||0);
              const canEdit = isManager || o.createdBy === user?.uid;
              return (
                <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-3 py-3 text-slate-500 whitespace-nowrap">{fmtDate(o.date)}</td>
                  <td className="px-3 py-3 font-mono text-blue-900">{o.orderNo || "—"}</td>
                  <td className="px-3 py-3">{o.dept || "—"}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtMoney(o.buyFund)}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtMoney(o.travelFund)}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtMoney(o.cameraFund)}</td>
                  <td className="px-3 py-3 text-right font-mono">{fmtMoney(o.deduct)}</td>
                  <td className={`px-3 py-3 text-right font-mono font-bold ${remain<0?"text-red-600":"text-teal-700"}`}>{fmtMoney(remain)}</td>
                  <td className="px-3 py-3"><FundStatusPill status={fundOrderStatus(o)} /></td>
                  <td className="px-3 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setModal({ mode:"edit", order:o })}
                          className="text-xs font-semibold bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg transition cursor-pointer">แก้ไข</button>
                        <button onClick={() => handleDelete(o)} disabled={deletingId===o.id}
                          className="text-xs font-semibold bg-red-50 text-red-600 hover:bg-red-100 px-2.5 py-1 rounded-lg transition cursor-pointer disabled:opacity-50">
                          {deletingId===o.id ? "..." : "ลบ"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
          </div>
        )}
      </div>

      {modal?.mode === "add" && (
        <FundOrderModal defaultHospital={hospital} onClose={() => setModal(null)} onSaved={refresh} />
      )}
      {modal?.mode === "edit" && (
        <FundOrderModal order={modal.order} onClose={() => setModal(null)} onSaved={refresh} />
      )}
    </div>
  );
}
