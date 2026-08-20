import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useOrders } from "../hooks/useOrders";
import { StatusPill, DaysBadge } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";

const fmt = d => d ? new Date(d?.toDate?d.toDate():d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}) : "—";

export default function Dashboard() {
  const { profile } = useAuth();
  const { orders, loading, error, refresh } = useOrders();

  const stats = useMemo(() => ({
    overdue:   orders.filter(o=>o.status==="overdue").length,
    partial:   orders.filter(o=>o.status==="partial").length,
    pending:   orders.filter(o=>o.status==="pending").length,
    completed: orders.filter(o=>o.status==="completed").length,
  }), [orders]);

  const urgent = useMemo(() =>
    orders.filter(o => {
      const d = new Date(o.dueDate?.toDate?o.dueDate.toDate():o.dueDate);
      const days = Math.ceil((d-new Date())/86400000);
      return days>=0 && days<=7 && !["completed","cancelled"].includes(o.status);
    }).sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate)),
  [orders]);

  const STATS = [
    {label:"เกินกำหนดส่ง", value:stats.overdue,   color:"#DC2626"},
    {label:"ส่งบางส่วน",   value:stats.partial,   color:"#D97706"},
    {label:"รอดำเนินการ",  value:stats.pending,   color:"#2563EB"},
    {label:"ส่งครบแล้ว",   value:stats.completed, color:"#0D9488"},
  ];

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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-1">สวัสดี {profile?.displayName?.split(" ")[0]} — สรุปงานของคุณวันนี้</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6">
        {STATS.map(s=>(
          <div key={s.label} className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 shadow-sm">
            <div className="text-2xl sm:text-3xl font-black leading-none" style={{color:s.color}}>{s.value}</div>
            <div className="text-xs font-semibold text-slate-500 mt-2">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <span className="text-amber-500">⚠</span>
          <span className="font-bold text-slate-800">ต้องดำเนินการภายใน 7 วัน</span>
          <span className="ml-auto text-xs text-slate-400">{urgent.length} รายการ</span>
        </div>
        {urgent.length===0
          ? <div className="px-5 py-8 text-center text-slate-400 text-sm">✅ ไม่มีรายการเร่งด่วน</div>
          : <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="border-b border-slate-100">
                {["เลขที่ใบสั่งซื้อ","โรงพยาบาล","กำหนดส่ง","สถานะ",""].map(h=>(
                  <th key={h} className="text-left px-5 py-3 text-xs font-bold text-slate-400">{h}</th>
                ))}
              </tr></thead>
              <tbody>{urgent.map(o=>(
                <tr key={o.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-5 py-3 font-bold text-blue-900">{o.orderNumber}</td>
                  <td className="px-5 py-3 text-slate-700">{o.hospital}</td>
                  <td className="px-5 py-3"><div className="text-xs text-slate-400 mb-1">{fmt(o.dueDate)}</div><DaysBadge dueDate={o.dueDate} status={o.status}/></td>
                  <td className="px-5 py-3"><StatusPill status={o.status}/></td>
                  <td className="px-5 py-3"><Link to={`/orders/${o.id}`} className="text-xs font-semibold text-blue-600 hover:underline">ดูรายละเอียด →</Link></td>
                </tr>
              ))}</tbody>
            </table>
            </div>
        }
      </div>
    </div>
  );
}
