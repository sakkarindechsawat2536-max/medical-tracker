import { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { getOrderItems, recordDelivery, getDeliveries, deleteOrder } from "../lib/firestore";
import { StatusPill, DaysBadge } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const fmt = d => d ? new Date(d?.toDate?d.toDate():d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}) : "—";

function DeliveryModal({ item, orderId, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ quantity:1, deliveryDate:new Date().toISOString().split("T")[0], receiverName:"", deliveryNoteNumber:"", trackingNumber:"", notes:"" });
  const [saving, setSaving] = useState(false);
  const [done,   setDone]   = useState(false);
  const rem = item.quantity - item.delivered;
  const upd = k => v => setForm(f=>({...f,[k]:v}));

  async function save() {
    setSaving(true);
    const toastId = toast.loading("กำลังบันทึกการส่งมอบ...");
    try {
      await recordDelivery(item.id, orderId, form, user.uid);
      setDone(true);
      toast.success("บันทึกการส่งมอบสำเร็จ", { id: toastId });
      setTimeout(()=>{onSaved();onClose();},1000);
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e?.message || e}`, { id: toastId });
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto p-5 sm:p-7">
        {done ? <div className="py-10 text-center"><div className="text-5xl mb-3">✅</div><div className="font-bold text-teal-600 text-lg">บันทึกสำเร็จ</div></div> : <>
          <div className="flex justify-between items-start mb-5">
            <div><div className="font-extrabold text-slate-800 text-lg">บันทึกการส่งมอบ</div>
              <div className="text-xs text-slate-400 mt-1">{item.productCode} — {item.description}</div>
              <div className="text-xs text-slate-400">คงเหลือ <b className="text-red-500">{rem}</b> ชิ้น</div>
            </div>
            <button onClick={onClose} className="text-slate-400 text-xl cursor-pointer">✕</button>
          </div>
          <div className="grid gap-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className="text-xs font-semibold text-slate-500 block mb-1">จำนวนที่ส่ง *</label>
                <input type="number" min={1} max={rem} value={form.quantity} onChange={e=>upd("quantity")(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"/></div>
              <div><label className="text-xs font-semibold text-slate-500 block mb-1">วันที่ส่งจริง *</label>
                <input type="date" value={form.deliveryDate} onChange={e=>upd("deliveryDate")(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"/></div>
            </div>
            {[["ผู้รับสินค้า","receiverName","ชื่อผู้รับ"],["เลขที่ใบส่งของ","deliveryNoteNumber","DN-XXXX"],["หมายเลขพัสดุ","trackingNumber","TH1234..."],["หมายเหตุ","notes","..."]].map(([l,k,ph])=>(
              <div key={k}><label className="text-xs font-semibold text-slate-500 block mb-1">{l}</label>
                <input value={form[k]} onChange={e=>upd(k)(e.target.value)} placeholder={ph}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"/></div>
            ))}
            <div className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center text-slate-400 text-sm cursor-pointer hover:border-slate-400 transition">
              📎 แนบรูปภาพ / ใบส่งของ / PDF
            </div>
          </div>
          <div className="flex gap-3 mt-5 justify-end">
            <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">ยกเลิก</button>
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50">
              {saving?"กำลังบันทึก...":"บันทึกการส่งมอบ"}
            </button>
          </div>
        </>}
      </div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user, isManager } = useAuth();
  const [order,     setOrder]     = useState(null);
  const [items,     setItems]     = useState([]);
  const [deliveries,setDeliveries]= useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [modal,     setModal]     = useState(null);
  const [deleting,  setDeleting]  = useState(false);

  async function handleDeleteOrder() {
    if (!order) return;
    const canDelete = isManager || order.ownerId === user?.uid;
    if (!canDelete) { toast.error("คุณไม่มีสิทธิ์ลบใบสั่งซื้อนี้"); return; }
    const ok = window.confirm(
      `ยืนยันลบใบสั่งซื้อเลขที่ "${order.orderNumber}" (${order.hospital || "-"})?\n\nการลบจะลบรายการสินค้าและประวัติการส่งมอบที่เกี่ยวข้องทั้งหมดไปด้วย และไม่สามารถกู้คืนได้`
    );
    if (!ok) return;
    setDeleting(true);
    const toastId = toast.loading("กำลังลบใบสั่งซื้อ...");
    try {
      await deleteOrder(id);
      toast.success("ลบใบสั่งซื้อสำเร็จ", { id: toastId });
      navigate("/orders");
    } catch (e) {
      toast.error(`ลบไม่สำเร็จ: ${e?.message || e}`, { id: toastId });
      setDeleting(false);
    }
  }

  async function load() {
    setLoading(true); setError("");
    try {
      const [snap, itemsData, delData] = await Promise.all([
        getDoc(doc(db,"purchaseOrders",id)), getOrderItems(id), getDeliveries(id),
      ]);
      if (snap.exists()) setOrder({id:snap.id,...snap.data()});
      else setOrder(null);
      setItems(itemsData); setDeliveries(delData);
    } catch (e) {
      console.error("โหลดข้อมูลใบสั่งซื้อล้มเหลว:", e);
      setError(e?.message || "โหลดข้อมูลไม่สำเร็จ");
      toast.error(`โหลดข้อมูลใบสั่งซื้อไม่สำเร็จ: ${e?.code || e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }
  useEffect(()=>{load();},[id]);

  if (loading) return (
    <div className="flex items-center gap-3 text-slate-400">
      <span className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
      กำลังโหลด...
    </div>
  );

  if (error) return (
    <div className="max-w-md">
      <div className="text-red-500 font-semibold mb-2">⚠ โหลดข้อมูลไม่สำเร็จ</div>
      <div className="text-sm text-slate-500 mb-4 break-words">{error}</div>
      <div className="flex gap-3">
        <button onClick={load} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold cursor-pointer">ลองใหม่</button>
        <Link to="/orders" className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold">← กลับรายการ</Link>
      </div>
    </div>
  );

  if (!order)  return <div className="text-red-500">ไม่พบข้อมูล</div>;

  const INFO = [["เลขที่สัญญา",order.contractNumber],["เลขที่เสนอราคา",order.quoteNumber],
    ["โรงพยาบาล",order.hospital],["แผนกที่ส่ง",order.department],
    ["ผู้ติดต่อ",order.contactPerson],["กำหนดส่ง",fmt(order.dueDate)],["ผู้รับผิดชอบ",order.ownerName]];

  return (
    <div>
      <Link to="/orders" className="text-blue-600 text-sm font-semibold hover:underline">← กลับรายการ</Link>
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mt-4 mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800 break-words">{order.orderNumber}</h1>
          <div className="flex gap-2 mt-2 items-center flex-wrap">
            <StatusPill status={order.status}/><DaysBadge dueDate={order.dueDate} status={order.status}/>
          </div>
        </div>
        <div className="flex gap-2 self-start">
          {(isManager || order.ownerId === user?.uid) && (
            <button onClick={handleDeleteOrder} disabled={deleting}
              className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-red-100 cursor-pointer disabled:opacity-50">
              {deleting ? "กำลังลบ..." : "ลบใบสั่งซื้อ"}
            </button>
          )}
          <button onClick={()=>setModal(items.find(i=>i.status!=="completed")||items[0])}
            className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-600 cursor-pointer">
            + บันทึกการส่งมอบ
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs font-bold text-slate-400 tracking-wider mb-3">ข้อมูลใบสั่งซื้อ</div>
          {INFO.map(([k,v])=>(
            <div key={k} className="flex justify-between gap-3 py-2 border-b border-slate-50 text-sm">
              <span className="text-slate-400 flex-shrink-0">{k}</span><span className="font-semibold text-slate-800 text-right break-words">{v||"—"}</span>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs font-bold text-slate-400 tracking-wider mb-3">หมายเหตุ</div>
          <p className="text-sm text-slate-700 leading-relaxed break-words">{order.notes||"ไม่มีหมายเหตุ"}</p>
          {order.notes && <div className="mt-3 bg-amber-50 text-amber-700 text-xs font-semibold rounded-lg px-3 py-2">⚠ สถานะส่งมอบต้องยืนยันโดยผู้รับผิดชอบเท่านั้น</div>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-5">
        <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-800">รายการสินค้า</div>
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="bg-slate-50 border-b-2 border-slate-200">
            {["รหัสสินค้า","รายละเอียด","สั่ง","ส่งแล้ว","คงเหลือ","สถานะ",""].map(h=>(
              <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400">{h}</th>
            ))}
          </tr></thead>
          <tbody>{items.map(item=>(
            <tr key={item.id} className="border-b border-slate-50">
              <td className="px-4 py-3 font-bold text-blue-900 font-mono">{item.productCode}</td>
              <td className="px-4 py-3 text-slate-700">{item.description}</td>
              <td className="px-4 py-3 text-center font-bold">{item.quantity}</td>
              <td className="px-4 py-3 text-center font-bold text-teal-600">{item.delivered}</td>
              <td className="px-4 py-3 text-center font-bold" style={{color:item.quantity-item.delivered>0?"#DC2626":"#0D9488"}}>{item.quantity-item.delivered}</td>
              <td className="px-4 py-3"><StatusPill status={item.status}/></td>
              <td className="px-4 py-3">{item.status!=="completed"&&<button onClick={()=>setModal(item)} className="text-xs font-semibold bg-teal-50 text-teal-700 hover:bg-teal-100 px-3 py-1.5 rounded-lg cursor-pointer">บันทึกส่ง</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        </div>
      </div>

      {deliveries.length>0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-800">ประวัติการส่งมอบ</div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {["วันที่ส่ง","จำนวน","ผู้รับ","เลขใบส่งของ","หมายเลขพัสดุ","หมายเหตุ"].map(h=>(
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400">{h}</th>
              ))}
            </tr></thead>
            <tbody>{deliveries.map(d=>(
              <tr key={d.id} className="border-b border-slate-50">
                <td className="px-4 py-3 text-slate-500">{fmt(d.deliveryDate||d.recordedAt)}</td>
                <td className="px-4 py-3 font-bold text-teal-600">{d.quantity}</td>
                <td className="px-4 py-3">{d.receiverName||"—"}</td>
                <td className="px-4 py-3 font-mono text-blue-700">{d.deliveryNoteNumber||"—"}</td>
                <td className="px-4 py-3 font-mono text-slate-500">{d.trackingNumber||"—"}</td>
                <td className="px-4 py-3 text-slate-400">{d.notes||"—"}</td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        </div>
      )}

      {modal && <DeliveryModal item={modal} orderId={id} onClose={()=>setModal(null)} onSaved={load}/>}
    </div>
  );
}
