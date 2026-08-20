import { useState, useEffect } from "react";
import { getAllDeliveries } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const fmt = d => d ? new Date(d?.toDate?d.toDate():d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}) : "—";

export default function History() {
  const { user, profile } = useAuth();
  const toast = useToast();
  const [records,  setRecords]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [q, setQ] = useState("");

  useEffect(()=>{
    if (!user) return;
    setLoading(true);
    getAllDeliveries(user.uid, profile?.role)
      .then(d=>setRecords(d))
      .catch(e=>{ console.error(e); toast.error(`โหลดประวัติไม่สำเร็จ: ${e?.message||e}`); })
      .finally(()=>setLoading(false));
  },[user]);

  const filtered = records.filter(r=> !q || r.orderId?.includes(q) || r.receiverName?.toLowerCase().includes(q));

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-800 mb-1">ประวัติการส่งมอบ</h1>
      <p className="text-sm text-slate-400 mb-5">{records.length} รายการทั้งหมด</p>
      <div className="mb-4">
        <input value={q} onChange={e=>setQ(e.target.value.toLowerCase())} placeholder="ค้นหาเลขที่ใบสั่งซื้อ หรือผู้รับสินค้า..."
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none w-full sm:w-80"/>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
            <span className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />กำลังโหลด...
          </div>
        : filtered.length===0 ? <div className="p-8 text-center text-slate-400">ไม่พบรายการ</div>
        : <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="bg-slate-50 border-b-2 border-slate-200">
              {["วันที่ส่ง","เลขที่ใบสั่งซื้อ","จำนวน","ผู้รับสินค้า","เลขที่ใบส่งของ","หมายเลขพัสดุ","หมายเหตุ"].map(h=>(
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400">{h}</th>
              ))}
            </tr></thead>
            <tbody>{filtered.map(r=>(
              <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmt(r.deliveryDate||r.recordedAt)}</td>
                <td className="px-4 py-3 font-bold text-blue-900">{r.orderId?.slice(0,8)}...</td>
                <td className="px-4 py-3 font-bold text-teal-600 text-center">{r.quantity}</td>
                <td className="px-4 py-3">{r.receiverName||"—"}</td>
                <td className="px-4 py-3 font-mono text-blue-700 text-xs">{r.deliveryNoteNumber||"—"}</td>
                <td className="px-4 py-3 font-mono text-slate-400 text-xs">{r.trackingNumber||"—"}</td>
                <td className="px-4 py-3 text-slate-400">{r.notes||"—"}</td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        }
      </div>
    </div>
  );
}
