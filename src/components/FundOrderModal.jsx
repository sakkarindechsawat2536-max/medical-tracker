import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { addFundOrder, updateFundOrder } from "../lib/firestore";
import { FUND_DEPTS } from "../lib/fundConstants";

// modal เพิ่ม/แก้ไขรายการเงินกันซื้ออุปกรณ์ 1 ใบ — ใช้ทั้งจากหน้า FundDashboard (เพิ่มโรงพยาบาลใหม่)
// และหน้า FundHospitalDetail (เพิ่ม/แก้ไขรายการของโรงพยาบาลที่เปิดอยู่)
export default function FundOrderModal({ order, defaultHospital, hospitalOptions, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const isEdit = !!order;
  const [form, setForm] = useState({
    hospital:   order?.hospital   ?? defaultHospital ?? "",
    date:       order?.date       ?? new Date().toISOString().split("T")[0],
    orderNo:    order?.orderNo    ?? "",
    dept:       order?.dept       ?? "",
    buyFund:    order?.buyFund    ?? "",
    travelFund: order?.travelFund ?? "",
    cameraFund: order?.cameraFund ?? "",
    deduct:     order?.deduct     ?? "",
    note:       order?.note       ?? "",
  });
  const [saving, setSaving] = useState(false);
  const upd = k => v => setForm(f => ({ ...f, [k]: v }));

  async function save() {
    if (!form.hospital.trim()) { toast.error("กรุณากรอกชื่อโรงพยาบาล"); return; }
    setSaving(true);
    const toastId = toast.loading(isEdit ? "กำลังบันทึกการแก้ไข..." : "กำลังเพิ่มรายการเงินกัน...");
    const data = {
      date: form.date || null,
      orderNo: form.orderNo || "",
      dept: form.dept || null,
      buyFund: Number(form.buyFund) || 0,
      travelFund: Number(form.travelFund) || 0,
      cameraFund: Number(form.cameraFund) || 0,
      deduct: Number(form.deduct) || 0,
      note: form.note || null,
    };
    try {
      if (isEdit) {
        await updateFundOrder(order.id, data);
      } else {
        await addFundOrder(form.hospital.trim(), data, user.uid);
      }
      toast.success(isEdit ? "บันทึกการแก้ไขเรียบร้อย" : "เพิ่มรายการเรียบร้อย", { id: toastId });
      onSaved();
      onClose();
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e?.message || e}`, { id: toastId });
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto p-5 sm:p-7">
        <div className="flex justify-between items-start mb-5">
          <div className="font-extrabold text-slate-800 text-lg">{isEdit ? "แก้ไขรายการเงินกัน" : "เพิ่มรายการเงินกัน"}</div>
          <button onClick={onClose} className="text-slate-400 text-xl cursor-pointer">✕</button>
        </div>
        <div className="grid gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">โรงพยาบาล <span className="text-red-400">*</span></label>
            <input value={form.hospital} onChange={e => upd("hospital")(e.target.value)} list="fund-hospital-list"
              disabled={isEdit}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-400" />
            {hospitalOptions?.length > 0 && (
              <datalist id="fund-hospital-list">
                {hospitalOptions.map(h => <option key={h} value={h} />)}
              </datalist>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">วันที่</label>
              <input type="date" value={form.date} onChange={e => upd("date")(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">เลขที่ใบสั่ง</label>
              <input value={form.orderNo} onChange={e => upd("orderNo")(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">แผนก</label>
            <select value={form.dept} onChange={e => upd("dept")(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none bg-white">
              <option value="">— เลือกแผนก —</option>
              {FUND_DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">เงินกันซื้อของ (฿)</label>
              <input type="number" value={form.buyFund} onChange={e => upd("buyFund")(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">เงินกันเดินทาง (฿)</label>
              <input type="number" value={form.travelFund} onChange={e => upd("travelFund")(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 block mb-1">เงินกันกล้อง (฿)</label>
              <input type="number" value={form.cameraFund} onChange={e => upd("cameraFund")(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">ยอดที่เคลียร์แล้ว (฿)</label>
            <input type="number" value={form.deduct} onChange={e => upd("deduct")(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
            <p className="text-[11px] text-slate-400 mt-1">ยอดเงินที่ใช้ไปจริงจากเงินกันก้อนนี้แล้ว (0 = ยังไม่เคลียร์)</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-500 block mb-1">หมายเหตุ</label>
            <input value={form.note} onChange={e => upd("note")(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none" />
          </div>
        </div>
        <div className="flex gap-3 mt-5 justify-end">
          <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">ยกเลิก</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50">
            {saving ? "กำลังบันทึก..." : "บันทึก"}
          </button>
        </div>
      </div>
    </div>
  );
}
