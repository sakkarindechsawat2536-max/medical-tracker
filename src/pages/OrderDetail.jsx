import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { getOrderItems, recordDelivery, getDeliveries } from "../lib/firestore";
import { StatusPill, DaysBadge } from "../components/StatusPill";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { effectiveStatus } from "../lib/orderStatus";

const fmt = d => d ? new Date(d?.toDate?d.toDate():d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric"}) : "—";

// ---- แนบไฟล์: เก็บเป็น base64 ตรงใน Firestore (ฟรี ไม่ต้องใช้ Firebase Storage ที่ต้องอัปเกรดแผน Blaze) ----
// จำกัดขนาดเพื่อไม่ให้เกิน 1 MiB ต่อเอกสารของ Firestore
const MAX_FILES       = 3;
const MAX_FILE_BYTES  = 350 * 1024;
const MAX_TOTAL_BYTES = 700 * 1024;

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(new Error("อ่านไฟล์ไม่ได้"));
    r.readAsDataURL(file);
  });
}
function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.ceil(base64.length * 3 / 4);
}
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        const scale = maxDim / Math.max(width, height);
        width = Math.round(width * scale); height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("อ่านรูปภาพไม่ได้")); };
    img.src = url;
  });
}
async function fileToAttachment(file) {
  if (file.type.startsWith("image/")) {
    const settings = [[1400,0.75],[1000,0.55],[800,0.4],[600,0.35]];
    for (const [maxDim, quality] of settings) {
      const dataUrl = await compressImage(file, maxDim, quality);
      if (dataUrlBytes(dataUrl) <= MAX_FILE_BYTES) return { name: file.name, type: "image/jpeg", dataUrl };
    }
    throw new Error(`ไฟล์ "${file.name}" ใหญ่เกินไป แม้บีบอัดแล้ว`);
  }
  const dataUrl = await readFileAsDataURL(file);
  if (dataUrlBytes(dataUrl) > MAX_FILE_BYTES) throw new Error(`ไฟล์ "${file.name}" ใหญ่เกิน ${Math.round(MAX_FILE_BYTES/1024)}KB`);
  return { name: file.name, type: file.type || "application/octet-stream", dataUrl };
}

// บันทึกการส่งมอบทีเดียวได้ทุกรายการสินค้าที่ยังค้างส่งของใบสั่งซื้อนี้ — ไม่ต้องเปิดทีละรายการอีกต่อไป
// ค่าเริ่มต้นติ๊กเลือกทุกรายการที่ยังค้างส่ง พร้อมกรอกจำนวนเต็มจำนวนที่เหลือให้อัตโนมัติ (แก้ไข/ยกเลิกทีละรายการได้)
// ข้อมูลร่วม (วันที่ส่ง/ผู้รับ/เลขที่ใบส่งของ ฯลฯ) ใช้ชุดเดียวกันกับทุกรายการที่เลือกในการบันทึกครั้งนี้
function DeliveryModal({ items, orderId, onClose, onSaved }) {
  const { user } = useAuth();
  const toast = useToast();
  const outstanding = items.filter(it => it.quantity - it.delivered > 0);

  const [selected, setSelected] = useState(() => Object.fromEntries(outstanding.map(it => [it.id, true])));
  const [qty,      setQty]      = useState(() => Object.fromEntries(outstanding.map(it => [it.id, it.quantity - it.delivered])));
  const [form, setForm] = useState({ deliveryDate:new Date().toISOString().split("T")[0], receiverName:"", deliveryNoteNumber:"", trackingNumber:"", notes:"" });
  const [files,   setFiles]   = useState([]);
  const [saving,  setSaving]  = useState(false);
  const [done,    setDone]    = useState(false);
  const upd = k => v => setForm(f=>({...f,[k]:v}));

  const toggle = id => setSelected(s => ({ ...s, [id]: !s[id] }));
  const setItemQty = (id, rem) => v => {
    let n = Math.round(Number(v));
    if (isNaN(n)) n = 0;
    n = Math.max(0, Math.min(rem, n));
    setQty(q => ({ ...q, [id]: n }));
  };

  const chosen = outstanding.filter(it => selected[it.id] && qty[it.id] > 0);

  async function save() {
    if (chosen.length === 0) { toast.error("กรุณาเลือกอย่างน้อย 1 รายการ และระบุจำนวนที่ส่ง"); return; }
    setSaving(true);
    const toastId = toast.loading(`กำลังบันทึกการส่งมอบ ${chosen.length} รายการ...`);
    try {
      let attachments = [];
      if (files.length > 0) {
        attachments = await Promise.all(files.map(fileToAttachment));
        const total = attachments.reduce((s,a)=>s+dataUrlBytes(a.dataUrl),0);
        if (total > MAX_TOTAL_BYTES) throw new Error(`ไฟล์แนบรวมกันใหญ่เกิน ${Math.round(MAX_TOTAL_BYTES/1024)}KB กรุณาลดจำนวน/ขนาดไฟล์`);
      }
      // บันทึกทีละรายการตามลำดับ (ไม่ใช่ขนาน) เพื่อให้สถานะรวมของใบสั่งซื้อคำนวณจากข้อมูลล่าสุดเสมอ
      for (const it of chosen) {
        await recordDelivery(it.id, orderId, { ...form, quantity: qty[it.id], attachments }, user.uid);
      }
      setDone(true);
      toast.success(`บันทึกการส่งมอบสำเร็จ ${chosen.length} รายการ`, { id: toastId });
      setTimeout(()=>{onSaved();onClose();},1000);
    } catch (e) {
      toast.error(`บันทึกไม่สำเร็จ: ${e?.message || e}`, { id: toastId });
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[620px] max-h-[90vh] overflow-y-auto p-5 sm:p-7">
        {done ? <div className="py-10 text-center"><div className="text-5xl mb-3">✅</div><div className="font-bold text-teal-600 text-lg">บันทึกสำเร็จ</div></div> : <>
          <div className="flex justify-between items-start mb-5">
            <div>
              <div className="font-extrabold text-slate-800 text-lg">บันทึกการส่งมอบ</div>
              <div className="text-xs text-slate-400 mt-1">เลือกรายการที่ส่งและระบุจำนวน — บันทึกได้ครั้งเดียวหลายรายการ</div>
            </div>
            <button onClick={onClose} className="text-slate-400 text-xl cursor-pointer flex-shrink-0">✕</button>
          </div>

          {outstanding.length === 0 ? (
            <div className="text-center text-slate-400 text-sm py-6">ไม่มีรายการที่ค้างส่ง</div>
          ) : (
            <div className="grid gap-2 mb-5">
              {outstanding.map(it => {
                const rem = it.quantity - it.delivered;
                const sel = !!selected[it.id];
                return (
                  <div key={it.id}
                    className={`flex items-center gap-3 rounded-xl border p-3 transition ${sel ? "border-teal-300 bg-teal-50/40" : "border-slate-200 bg-white"}`}>
                    <input type="checkbox" checked={sel} onChange={()=>toggle(it.id)}
                      className="w-4 h-4 accent-teal-600 cursor-pointer flex-shrink-0"/>
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-xs font-bold text-blue-900">{it.productCode}</div>
                      <div className="text-sm text-slate-700 truncate">{it.description}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">คงเหลือ {rem} จาก {it.quantity} ชิ้น</div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button type="button" disabled={!sel} onClick={()=>setItemQty(it.id, rem)(String((qty[it.id]||0)-1))}
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold disabled:opacity-30 cursor-pointer">−</button>
                      <input type="number" min={0} max={rem} value={qty[it.id] ?? 0} disabled={!sel}
                        onChange={e=>setItemQty(it.id, rem)(e.target.value)}
                        className="w-14 text-center border border-slate-200 rounded-lg px-1 py-1.5 text-sm outline-none disabled:bg-slate-50 disabled:text-slate-300"/>
                      <button type="button" disabled={!sel} onClick={()=>setItemQty(it.id, rem)(String((qty[it.id]||0)+1))}
                        className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold disabled:opacity-30 cursor-pointer">+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-slate-100 pt-4">
            <div className="text-xs font-bold text-slate-400 tracking-wider mb-3">ข้อมูลการส่งมอบ (ใช้กับทุกรายการที่เลือก)</div>
            <div className="grid gap-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="text-xs font-semibold text-slate-500 block mb-1">วันที่ส่งจริง *</label>
                  <input type="date" value={form.deliveryDate} onChange={e=>upd("deliveryDate")(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"/></div>
                <div><label className="text-xs font-semibold text-slate-500 block mb-1">ผู้รับสินค้า</label>
                  <input value={form.receiverName} onChange={e=>upd("receiverName")(e.target.value)} placeholder="ชื่อผู้รับ"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"/></div>
              </div>
              {[["เลขที่ใบส่งของ","deliveryNoteNumber","DN-XXXX"],["หมายเลขพัสดุ","trackingNumber","TH1234..."],["หมายเหตุ","notes","..."]].map(([l,k,ph])=>(
                <div key={k}><label className="text-xs font-semibold text-slate-500 block mb-1">{l}</label>
                  <input value={form[k]} onChange={e=>upd(k)(e.target.value)} placeholder={ph}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none"/></div>
              ))}
              <div>
                <label className="text-xs font-semibold text-slate-500 block mb-1">แนบไฟล์ (ถ้ามี)</label>
                <div onClick={()=>document.getElementById("dm-file-in").click()}
                  className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center text-slate-400 text-sm cursor-pointer hover:border-teal-400 hover:text-teal-600 transition">
                  📎 แนบรูปภาพ / ใบส่งของ / PDF (สูงสุด {MAX_FILES} ไฟล์)
                </div>
                <input id="dm-file-in" type="file" accept="image/*,application/pdf" multiple className="hidden"
                  onChange={e=>{
                    const picked = Array.from(e.target.files||[]);
                    setFiles(f => [...f, ...picked].slice(0, MAX_FILES));
                    e.target.value = "";
                  }}/>
                {files.length>0 && (
                  <div className="mt-2 grid gap-1.5">
                    {files.map((f,i)=>(
                      <div key={i} className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-1.5 text-xs">
                        <span className="truncate text-slate-600">{f.name}</span>
                        <button type="button" onClick={()=>setFiles(fs=>fs.filter((_,idx)=>idx!==i))}
                          className="text-red-400 hover:text-red-600 cursor-pointer flex-shrink-0 ml-2">ลบ</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-3 mt-5 justify-end items-center">
            <span className="text-xs text-slate-400 mr-auto">เลือกแล้ว {chosen.length} รายการ</span>
            <button onClick={onClose} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">ยกเลิก</button>
            <button onClick={save} disabled={saving || chosen.length===0} className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50">
              {saving?"กำลังบันทึก...":`บันทึกการส่งมอบ (${chosen.length})`}
            </button>
          </div>
        </>}
      </div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [order,     setOrder]     = useState(null);
  const [items,     setItems]     = useState([]);
  const [deliveries,setDeliveries]= useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");
  const [modal,     setModal]     = useState(false);
  const [preview,   setPreview]   = useState(null);

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
            <StatusPill status={effectiveStatus(order)}/><DaysBadge dueDate={order.dueDate} status={order.status}/>
          </div>
        </div>
        <button onClick={()=>setModal(true)}
          className="bg-amber-500 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-amber-600 cursor-pointer self-start">
          + บันทึกการส่งมอบ
        </button>
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
              <td className="px-4 py-3">{item.status!=="completed"&&<button onClick={()=>setModal(true)} className="text-xs font-semibold bg-teal-50 text-teal-700 hover:bg-teal-100 px-3 py-1.5 rounded-lg cursor-pointer">บันทึกส่ง</button>}</td>
            </tr>
          ))}</tbody>
        </table>
        </div>
      </div>

      {deliveries.length>0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-800">ประวัติการส่งมอบ</div>
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
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
                  {d.attachments?.length>0 ? (
                    <div className="flex gap-1.5 flex-wrap">
                      {d.attachments.map((a,i)=>(
                        a.type?.startsWith("image/") ? (
                          <img key={i} src={a.dataUrl} alt={a.name} onClick={()=>setPreview(a.dataUrl)}
                            className="w-9 h-9 rounded-lg object-cover border border-slate-200 cursor-pointer hover:opacity-80 transition"/>
                        ) : (
                          <a key={i} href={a.dataUrl} download={a.name}
                            className="text-xs bg-slate-100 hover:bg-slate-200 px-2 py-1 rounded-lg text-slate-600 transition">📎 {a.name}</a>
                        )
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

      {modal && <DeliveryModal items={items} orderId={id} onClose={()=>setModal(false)} onSaved={load}/>}

      {preview && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4" onClick={()=>setPreview(null)}>
          <img src={preview} alt="ตัวอย่างไฟล์แนบ" className="max-w-full max-h-full rounded-xl shadow-2xl"/>
          <button onClick={()=>setPreview(null)} className="absolute top-4 right-4 text-white text-2xl cursor-pointer">✕</button>
        </div>
      )}
    </div>
  );
}
