import { useState, useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { addFundOrder } from "../lib/firestore";
import { FUND_DEPTS } from "../lib/fundConstants";

const fmtMoney = n => (n === null || n === undefined || isNaN(n)) ? "–" :
  n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });

// modal "ใช้เงินกัน" — บันทึกยอดที่ใช้ไปหักออกจากเงินกันคงเหลือของโรงพยาบาลที่เลือกโดยตรง
// (ไม่ผูกกับใบสั่งซื้อใบใดใบหนึ่ง เป็นรายการหักลบยอดรวมของโรงพยาบาลนั้น)
export default function UseFundModal({ hospitals, defaultHospital, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const locked = !!defaultHospital;
  const [hospital, setHospital] = useState(defaultHospital || hospitals?.[0]?.name || "");
  const [amount, setAmount]     = useState("");
  const [dept, setDept]         = useState("");
  const [date, setDate]         = useState(new Date().toISOString().split("T")[0]);
  const [note, setNote]         = useState("");
  const [saving, setSaving]     = useState(false);

  const current = useMemo(() => hospitals?.find(h => h.name === hospital), [hospitals, hospital]);
  const remaining = current?.remaining ?? 0;
  const after = remaining - (Number(amount) || 0);

  async function save() {
    if (!hospital) { toast.error("กรุณาเลือกโรงพยาบาล"); return; }
    const amt = Number(amount);
    if (!amt || amt <= 0) { toast.error("กรุณากรอกจำนวนเงินที่ใช้"); return; }
    setSaving(true);
    const toastId = toast.loading("กำลังบันทึกการใช้เงินกัน...");
    try {
      await addFundOrder(hospital, {
        date, dept: dept || null, buyFund: 0, travelFund: 0, cameraFund: 0,
        deduct: amt, note: note || null,
      }, user.uid);
      toast.success("บันทึกการใช้เงินกันเรียบร้อย", { id: toastId });
      onSaved();
      onClose();
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e?.message || e}`, { id: toastId });
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px] max-h-[90vh] overflow-y-auto p-5 sm:p-7">
        <div className="flex justify-between items-start mb-1">
          <div className="font-extrabold text-slate-800 text-lg">ใช้เงินกัน</div>
          <button onClick={onClose} className="text-slate-400 text-xl cursor-pointer">✕</button>
        </div>
        <p className="text-xs text-slate-400 mb-5">บันทึกยอดที่ใช้ไป ระบบจะหักออกจากเงินกันคงเหลือของโรงพยาบาลที่เลือกทันที</p>

        <div className="grid gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">โรงพยาบาล <span className="text-red-400">*</span></label>
            {locked ? (
              <div className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-slate-50 text-slate-700 font-semibold">{hospital}</div>
            ) : (
              <select value={hospital} onChange={e => setHospital(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                {hospitals?.map(h => <option key={h.name} value={h.name}>{h.name}</option>)}
              </select>
            )}
          </div>

          <div className={`rounded-xl px-4 py-3 text-sm ${remaining < 0 ? "bg-red-50" : "bg-teal-50"}`}>
            <div className="flex justify-between">
              <span className="text-slate-500">คงเหลือปัจจุบัน</span>
              <span className={`font-mono font-bold ${remaining<0?"text-red-600":"text-teal-700"}`}>฿{fmtMoney(remaining)}</span>
            </div>
            {amount > 0 && (
              <div className="flex justify-between mt-1 pt-1 border-t border-black/5">
                <span className="text-slate-500">คงเหลือหลังใช้</span>
                <span className={`font-mono font-bold ${after<0?"text-red-600":"text-teal-700"}`}>฿{fmtMoney(after)}</span>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">จำนวนเงินที่ใช้ (฿) <span className="text-red-400">*</span></label>
            <input type="number" value={amount} onChange={e => setAmount(e.target.value)} autoFocus
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
            {after < 0 && <p className="text-[11px] text-red-500 mt-1">⚠ ยอดนี้จะทำให้เงินกันของโรงพยาบาลนี้ติดลบ</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">วันที่</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">แผนก</label>
              <select value={dept} onChange={e => setDept(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
                <option value="">— ไม่ระบุ —</option>
                {FUND_DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">หมายเหตุ</label>
            <input value={note} onChange={e => setNote(e.target.value)} placeholder="เช่น ใช้ซื้ออุปกรณ์รายการ..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
        </div>

        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50 hover:bg-amber-600 transition">
            {saving ? "กำลังบันทึก..." : "บันทึกการใช้เงินกัน"}
          </button>
        </div>
      </div>
    </div>
  );
}
