import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useFundOrders } from "../hooks/useFundOrders";
import { fundOrderAllocated } from "../components/StatusPill";
import FundOrderModal from "../components/FundOrderModal";

const fmtMoney = n => (n === null || n === undefined || isNaN(n)) ? "–" :
  n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });

export default function FundDashboard() {
  const { fundOrders, loading, error, refresh } = useFundOrders();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

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
  const hospitalNames = hospitals.map(h => h.name);

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
          <h1 className="text-2xl font-extrabold text-slate-800">เงินกันซื้ออุปกรณ์การแพทย์</h1>
          <p className="text-sm text-slate-400 mt-1">ติดตามยอดเงินกันและใบสั่งซื้อของแต่ละโรงพยาบาล · {hospitals.length} แห่ง</p>
        </div>
        <button onClick={() => setModalOpen(true)}
          className="bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-slate-700 transition text-center">
          + เพิ่มรายการเงินกัน
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 shadow-sm">
          <div className="text-xl sm:text-2xl font-black leading-none text-slate-800">฿{fmtMoney(grand.allocated)}</div>
          <div className="text-xs font-semibold text-slate-500 mt-2">เงินกันทั้งหมด</div>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 shadow-sm">
          <div className="text-xl sm:text-2xl font-black leading-none text-amber-600">฿{fmtMoney(grand.deducted)}</div>
          <div className="text-xs font-semibold text-slate-500 mt-2">ใช้ไปแล้ว</div>
        </div>
        <div className="bg-white rounded-xl p-4 sm:p-5 border border-slate-200 shadow-sm">
          <div className="text-xl sm:text-2xl font-black leading-none text-teal-700">฿{fmtMoney(grand.allocated - grand.deducted)}</div>
          <div className="text-xs font-semibold text-slate-500 mt-2">คงเหลือ</div>
        </div>
      </div>

      <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาโรงพยาบาล..."
        className="w-full sm:w-80 border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none mb-4" />

      {filtered.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">ไม่พบโรงพยาบาล</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(h => {
            const usedPct = h.allocated > 0 ? Math.min(100, (h.deducted / h.allocated) * 100) : 0;
            return (
              <button key={h.name} onClick={() => navigate(`/fund/${encodeURIComponent(h.name)}`)}
                className="text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-teal-400 hover:-translate-y-0.5 transition shadow-sm cursor-pointer">
                <div className="flex justify-between items-center mb-2.5">
                  <div className="font-bold text-slate-800 text-sm truncate">{h.name}</div>
                  {h.remaining < 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600 flex-shrink-0 ml-2">ติดลบ</span>
                  )}
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden flex mb-2">
                  <div className="h-full bg-amber-500" style={{ width: `${usedPct}%` }} />
                  <div className="h-full bg-teal-600" style={{ width: `${100 - usedPct}%` }} />
                </div>
                <div className="flex justify-between text-xs font-mono text-slate-400">
                  <span>ใช้ <b className="text-slate-700">฿{fmtMoney(h.deducted)}</b></span>
                  <span>เหลือ <b className="text-teal-700">฿{fmtMoney(h.remaining)}</b></span>
                </div>
                <div className="text-[11px] text-slate-400 mt-1.5">{h.orders.length} รายการ</div>
              </button>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <FundOrderModal hospitalOptions={hospitalNames} onClose={() => setModalOpen(false)} onSaved={refresh} />
      )}
    </div>
  );
}
