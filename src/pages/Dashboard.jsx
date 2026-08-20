import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useOrders } from "../hooks/useOrders";
import { StatusPill, DaysBadge } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { effectiveStatus, isOverdue } from "../lib/orderStatus";

const fmt = d => d ? new Date(d?.toDate?d.toDate():d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}) : "—";

export default function Dashboard() {
  const { profile } = useAuth();
  const { orders, loading, error, refresh } = useOrders();

  // "เกินกำหนดส่ง" กับ "ส่งบางส่วน/รอดำเนินการ/ส่งครบแล้ว" เป็นคนละมิติกัน นับแยกกันไม่ให้ทับกัน
  // ใบสั่งซื้อใบเดียวกันที่ทั้งเกินกำหนดส่งแล้ว และส่งของไปบางส่วนแล้ว ต้องถูกนับทั้งสองยอด ไม่ใช่นับได้แค่ยอดเดียว
  // (ก่อนหน้านี้ใช้ effectiveStatus ซึ่งให้ "เกินกำหนดส่ง" มาก่อนเสมอ ทำให้ใบที่เกินกำหนด+ส่งบางส่วนไปนับใน
  // "เกินกำหนดส่ง" อย่างเดียว การ์ด "ส่งบางส่วน" เลยแสดง 0 ทั้งที่มีรายการส่งบางส่วนจริงอยู่)
  const stats = useMemo(() => {
    const s = { overdue:0, partial:0, pending:0, completed:0 };
    orders.forEach(o => {
      if (isOverdue(o)) s.overdue++;
      const real = o.status || "pending";
      if (real === "partial" || real === "pending" || real === "completed") s[real]++;
    });
    return s;
  }, [orders]);

  // "ต้องดำเนินการ" = เกินกำหนดส่งไปแล้ว (เร่งด่วนที่สุด) หรือกำหนดส่งภายใน 7 วันข้างหน้า และยังไม่เสร็จ/ยกเลิก
  const urgent = useMemo(() =>
    orders.filter(o => {
      const st = effectiveStatus(o);
      if (["completed","cancelled"].includes(st)) return false;
      if (!o.dueDate) return false;
      const d = new Date(o.dueDate?.toDate?o.dueDate.toDate():o.dueDate);
      const days = Math.ceil((d-new Date())/86400000);
      return days<=7;
    }).sort((a,b)=>new Date(a.dueDate?.toDate?a.dueDate.toDate():a.dueDate)-new Date(b.dueDate?.toDate?b.dueDate.toDate():b.dueDate)),
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
                  <td className="px-5 py-3"><StatusPill status={effectiveStatus(o)}/></td>
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
