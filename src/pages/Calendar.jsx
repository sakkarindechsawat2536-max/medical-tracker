import { useMemo } from "react";
import { useOrders } from "../hooks/useOrders";
import { STATUS_META } from "../components/StatusPill";
import { effectiveStatus } from "../lib/orderStatus";

const WEEKDAYS = ["อา","จ","อ","พ","พฤ","ศ","ส"];

export default function Calendar() {
  const { orders, loading, error, refresh } = useOrders();
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const firstDay    = new Date(year, month, 1).getDay();
  const today       = now.getDate();
  const monthName   = now.toLocaleDateString("th-TH",{month:"long",year:"numeric"});

  const byDay = useMemo(()=>{
    const map = {};
    orders.forEach(o=>{
      if (!o.dueDate) return;
      const d = new Date(o.dueDate?.toDate?o.dueDate.toDate():o.dueDate);
      if (d.getMonth()===month && d.getFullYear()===year) {
        const day = d.getDate();
        if (!map[day]) map[day]=[];
        map[day].push(o);
      }
    });
    return map;
  },[orders, month, year]);

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
      <h1 className="text-2xl font-extrabold text-slate-800 mb-1">ปฏิทินกำหนดส่ง</h1>
      <p className="text-sm text-slate-400 mb-5">{monthName}</p>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-2.5 sm:p-5 overflow-x-auto">
        <div className="grid grid-cols-7 gap-1 mb-2 min-w-[420px]">
          {WEEKDAYS.map(d=><div key={d} className="text-center text-xs font-bold text-slate-400 py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1 sm:gap-2 min-w-[420px]">
          {Array.from({length:firstDay}).map((_,i)=><div key={"e"+i}/>)}
          {Array.from({length:daysInMonth},(_,i)=>i+1).map(d=>{
            const items = byDay[d]||[];
            const hasOverdue = items.some(o=>effectiveStatus(o)==="overdue");
            const hasPartial = items.some(o=>effectiveStatus(o)==="partial");
            const allDone    = items.length>0 && items.every(o=>effectiveStatus(o)==="completed");
            const isToday    = d===today;
            let bg="bg-slate-50 border-slate-200", dot="";
            if (hasOverdue)      { bg="bg-red-50 border-red-300"; }
            else if (hasPartial) { bg="bg-amber-50 border-amber-300"; }
            else if (allDone)    { bg="bg-teal-50 border-teal-300"; }
            else if (items.length>0) { bg="bg-blue-50 border-blue-300"; }
            return (
              <div key={d} className={`min-h-12 sm:min-h-14 rounded-lg p-1 sm:p-1.5 border ${bg} ${isToday?"ring-2 ring-blue-800 ring-offset-1":""}`}>
                <div className={`text-xs font-bold ${isToday?"text-blue-800":"text-slate-700"}`}>{d}</div>
                {items.slice(0,2).map(o=>{
                  const st = effectiveStatus(o);
                  return (
                    <div key={o.id} className="text-[9px] font-semibold mt-0.5 px-1 py-0.5 rounded truncate"
                      style={{background:STATUS_META[st]?.bg, color:STATUS_META[st]?.text}}>
                      {o.hospital?.replace("รพ.","").substring(0,8)}
                    </div>
                  );
                })}
                {items.length>2 && <div className="text-[9px] text-slate-400 mt-0.5 pl-1">+{items.length-2}</div>}
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-4 flex-wrap">
          {[["เกินกำหนด","#DC2626","#FEE2E2"],["ใกล้กำหนด","#D97706","#FEF3C7"],["มีงาน","#2563EB","#DBEAFE"],["ส่งครบ","#0D9488","#CCFBF1"]].map(([l,c,bg])=>(
            <div key={l} className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-3 h-3 rounded" style={{background:bg,border:`2px solid ${c}`}}/>
              {l}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
