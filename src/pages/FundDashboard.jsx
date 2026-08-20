import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useFundOrders } from "../hooks/useFundOrders";
import { fundOrderAllocated } from "../components/StatusPill";
import FundOrderModal from "../components/FundOrderModal";
import UseFundModal from "../components/UseFundModal";

const fmtMoney = n => (n === null || n === undefined || isNaN(n)) ? "–" :
  n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });

export default function FundDashboard() {
  const { fundOrders, loading, error, refresh } = useFundOrders();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [useOpen, setUseOpen] = useState(false);

  // จัดกลุ่มรายการเงินกันตามโรงพยาบาล คำนวณยอดกันทั้งหมด/ใช้ไปแล้ว/คงเหลือของแต่ละแห่ง
  const hospitals = useMemo(() => {
    const map = new Map();
    for (const o of fundOrders) {
      const key = o.hospital || "(ไม่ระบุโรงพยาบาล)";
      if (!map.has(key)) map.set(key, { name: key, orders: [], allocated: 0, deducted: 0 });
      const h = map.get(key);
      h.orders.push(o);
      h.allocated += fundOrderAllocated(o);
      h.deducted  += (o.deduct || 0);
    }
    return Array.from(map.values())
      .map(h => ({ ...h, remaining: h.allocated - h.deducted }))
      .sort((a, b) => a.name.localeCompare(b.name, "th"));
  }, [fundOrders]);

  const grand = useMemo(() => hospitals.reduce((s, h) => ({
    allocated: s.allocated + h.allocated, deducted: s.deducted + h.deducted,
  }), { allocated: 0, deducted: 0 }), [hospitals]);

  const filtered = hospitals.filter(h => !q || h.name.toLowerCase().includes(q.toLowerCase()));

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
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 flex items-center gap-2">💰 เงินกันซื้ออุปกรณ์การแพทย์</h1>
          <p className="text-sm text-slate-400 mt-1">ติดตามยอดเงินกันและใบสั่งซื้อของแต่ละโรงพยาบาล · {hospitals.length} แห่ง</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setUseOpen(true)} disabled={hospitals.length === 0}
            className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-600 transition text-center disabled:opacity-40 disabled:cursor-not-allowed">
            − ใช้เงินกัน
          </button>
          <button onClick={() => setAddOpen(true)}
            className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition text-center">
            + เพิ่มรายการ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-400 mb-1.5">เงินกันทั้งหมด</div>
          <div className="text-xl sm:text-2xl font-black leading-none text-slate-800 font-mono">฿{fmtMoney(grand.allocated)}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-400 mb-1.5">ใช้ไปแล้ว</div>
          <div className="text-xl sm:text-2xl font-black leading-none text-amber-600 font-mono">฿{fmtMoney(grand.deducted)}</div>
        </div>
        <div className="bg-gradient-to-br from-teal-600 to-teal-700 rounded-2xl p-4 sm:p-5 shadow-sm">
          <div className="text-[11px] font-semibold text-teal-100 mb-1.5">คงเหลือ</div>
          <div className="text-xl sm:text-2xl font-black leading-none text-white font-mono">฿{fmtMoney(grand.allocated - grand.deducted)}</div>
        </div>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="🔍 ค้นหาโรงพยาบาล..."
        className="w-full sm:w-80 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none mb-4 focus:border-teal-400 transition" />

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-400 text-sm">
          {hospitals.length === 0 ? "ยังไม่มีข้อมูลเงินกัน — เริ่มเพิ่มรายการแรกได้เลย" : "ไม่พบโรงพยาบาล"}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filtered.map(h => {
            const usedPct = h.allocated > 0 ? Math.min(100, (h.deducted / h.allocated) * 100) : 0;
            return (
              <button key={h.name} onClick={() => navigate(`/fund/${encodeURIComponent(h.name)}`)}
                className="text-left bg-white rounded-2xl border border-slate-200 p-4 hover:border-teal-400 hover:shadow-md hover:-translate-y-0.5 transition-all shadow-sm cursor-pointer">
                <div className="flex justify-between items-start mb-3">
                  <div className="font-bold text-slate-800 text-sm leading-snug pr-2">{h.name}</div>
                  {h.remaining < 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 flex-shrink-0">ติดลบ</span>
                  )}
                </div>

                <div className={`text-2xl font-black font-mono leading-none mb-1 ${h.remaining<0?"text-red-600":"text-teal-700"}`}>
                  ฿{fmtMoney(h.remaining)}
                </div>
                <div className="text-[11px] text-slate-400 mb-3">คงเหลือ</div>

                <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex mb-2">
                  <div className="h-full bg-amber-500 rounded-l-full" style={{ width: `${usedPct}%` }} />
                  <div className="h-full bg-teal-600 rounded-r-full" style={{ width: `${100 - usedPct}%` }} />
                </div>
                <div className="flex justify-between text-[11px] font-mono text-slate-400">
                  <span>ใช้ ฿{fmtMoney(h.deducted)}</span>
                  <span>{h.orders.length} รายการ</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {addOpen && (
        <FundOrderModal hospitalOptions={hospitals.map(h => h.name)} onClose={() => setAddOpen(false)} onSaved={refresh} />
      )}
      {useOpen && (
        <UseFundModal hospitals={hospitals} onClose={() => setUseOpen(false)} onSaved={refresh} />
      )}
    </div>
  );
}
