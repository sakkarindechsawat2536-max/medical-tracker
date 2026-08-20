import { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { getOrderItems, recordDelivery, getDeliveries, deleteOrder } from "../lib/firestore";
import { StatusPill, DaysBadge } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

const fmt = d => d ? new Date(d?.toDate?d.toDate():d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}) : "—";

// ---------- ไฟล์แนบ: เก็บเป็น base64 ตรงใน Firestore เลย (ไม่ใช้ Firebase Storage เพราะต้องอัปเกรดแพ็กเกจ Blaze) ----------
// ข้อจำกัด: Firestore เก็บได้เอกสารละไม่เกิน 1MB จึงต้องบีบอัดรูปภาพและจำกัดขนาดไฟล์แนบให้เล็ก
const MAX_FILES        = 3;
const MAX_FILE_BYTES   = 350 * 1024;   // ต่อไฟล์ (หลังบีบอัด/แปลงแล้ว)
const MAX_TOTAL_BYTES  = 700 * 1024;   // รวมทุกไฟล์ต่อ 1 การส่งมอบ

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("อ่านไฟล์ไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
}

function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil(base64.length * 0.75);
}

async function compressImage(file, maxDim, quality) {
  const dataUrl = await readFileAsDataURL(file);
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("อ่านรูปภาพไม่สำเร็จ")); img.src = dataUrl; });
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale); height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

// แปลงไฟล์ที่เลือกให้เป็น attachment ({name,type,dataUrl}) พร้อมบีบอัดรูปภาพจนกว่าจะเล็กพอ
async function fileToAttachment(file) {
  let dataUrl;
  if (file.type.startsWith("image/")) {
    for (const [maxDim, quality] of [[1400,0.75],[1000,0.55],[800,0.4],[600,0.35]]) {
      dataUrl = await compressImage(file, maxDim, quality);
      if (dataUrlBytes(dataUrl) <= MAX_FILE_BYTES) break;
    }
  } else {
    dataUrl = await readFileAsDataURL(file);
  }
  const bytes = dataUrlBytes(dataUrl);
  if (bytes > MAX_FILE_BYTES) {
    throw new Error(`ไฟล์ "${file.name}" ขนาดใหญ่เกินไป (${Math.round(bytes/1024)}KB) — รองรับไฟล์แนบไม่เกิน ${Math.round(MAX_FILE_BYTES/1024)}KB ต่อไฟล์`);
  }
  return { name: file.name, type: file.type || "", dataUrl, bytes };
}

function DeliveryModal({ item, orderId, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ quantity:1, deliveryDate:new Date().toISOString().split("T")[0], receiverName:"", deliveryNoteNumber:"", trackingNumber:"", notes:"" });
  const [saving, setSaving] = useState(false);
  const [done,   setDone]   = useState(false);
  const [files,  setFiles]  = useState([]);
  const fileInputRef = useRef(null);
  const rem = item.quantity - item.delivered;
  const upd = k => v => setForm(f=>({...f,[k]:v}));

  function handleFilePick(e) {
    const picked = Array.from(e.target.files || []);
    e.target.value = ""; // ให้เลือกไฟล์เดิมซ้ำได้อีกครั้งถ้าลบออกไปแล้ว
    if (!picked.length) return;
    setFiles(prev => {
      const next = [...prev, ...picked];
      if (next.length > MAX_FILES) { toast.error(`แนบไฟล์ได้สูงสุด ${MAX_FILES} ไฟล์ (ไฟล์เล็กเท่านั้น เพราะเก็บในฐานข้อมูลโดยตรง)`); return prev; }
      return next;
    });
  }
  function removeFile(idx) { setFiles(prev => prev.filter((_, i) => i !== idx)); }

  async function save() {
    setSaving(true);
    const hasFiles = files.length > 0;
    const toastId = toast.loading(hasFiles ? "กำลังประมวลผลไฟล์แนบและบันทึกการส่งมอบ..." : "กำลังบันทึกการส่งมอบ...");
    try {
      let attachments = [];
      if (hasFiles) {
        let total = 0;
        for (const file of files) {
          const att = await fileToAttachment(file);
          total += att.bytes;
          if (total > MAX_TOTAL_BYTES) {
            throw new Error(`ไฟล์แนบรวมกันใหญ่เกินไป (เกิน ${Math.round(MAX_TOTAL_BYTES/1024)}KB) กรุณาลดจำนวนไฟล์หรือใช้รูปที่มีขนาดเล็กลง`);
          }
          attachments.push({ name: att.name, type: att.type, dataUrl: att.dataUrl });
        }
      }
      await recordDelivery(item.id, orderId, { ...form, attachments }, user.uid);
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
            <div>
              <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,application/pdf"
                onChange={handleFilePick} className="hidden" />
              <button type="button" onClick={()=>fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-slate-200 rounded-xl p-4 text-center text-slate-400 text-sm cursor-pointer hover:border-slate-400 transition">
                📎 แนบรูปภาพ / ใบส่งของ / PDF
              </button>
              <p className="text-[11px] text-slate-400 mt-1">รองรับไฟล์เล็ก (สูงสุด {MAX_FILES} ไฟล์ ระบบจะบีบอัดรูปภาพให้อัตโนมัติ)</p>
              {files.length > 0 && (
                <div className="mt-2 flex flex-col gap-1.5">
                  {files.map((f, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 bg-slate-50 rounded-lg px-3 py-1.5 text-xs">
                      <span className="truncate text-slate-600">{f.name}</span>
                      <button type="button" onClick={()=>removeFile(idx)}
                        className="text-slate-400 hover:text-red-500 cursor-pointer flex-shrink-0">✕</button>
                    </div>
                  ))}
                </div>
              )}
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
  const [preview,   setPreview]   = useState(null);

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
              {["วันที่ส่ง","จำนวน","ผู้รับ","เลขใบส่งของ","หมายเลขพัสดุ","หมายเหตุ","ไฟล์แนบ"].map(h=>(
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
                <td className="px-4 py-3">
                  {d.attachments?.length ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {d.attachments.map((a,i)=> a.type?.startsWith("image/") ? (
                        <img key={i} src={a.dataUrl} alt={a.name} title={a.name}
                          className="w-9 h-9 object-cover rounded-lg border border-slate-200 cursor-pointer hover:opacity-80 transition"
                          onClick={()=>setPreview(a.dataUrl)} />
                      ) : (
                        <a key={i} href={a.dataUrl} download={a.name} title={a.name}
                          className="text-blue-600 hover:underline text-xs truncate max-w-[110px]">📎 {a.name}</a>
                      ))}
                    </div>
                  ) : "—"}
                </td>
              </tr>
            ))}</tbody>
          </table>
          </div>
        </div>
      )}

      {modal && <DeliveryModal item={modal} orderId={id} onClose={()=>setModal(null)} onSaved={load}/>}

      {preview && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4" onClick={()=>setPreview(null)}>
          <img src={preview} alt="ไฟล์แนบ" className="max-w-full max-h-full rounded-lg shadow-2xl" onClick={e=>e.stopPropagation()} />
          <button onClick={()=>setPreview(null)} className="absolute top-4 right-4 text-white text-2xl cursor-pointer">✕</button>
        </div>
      )}
    </div>
  );
}
