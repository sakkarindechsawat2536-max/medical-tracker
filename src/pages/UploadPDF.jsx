import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createOrder } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";

const PROMPT = `อ่านใบสั่งซื้อสินค้าของบริษัท KOSIN Medical Supply แล้วตอบกลับเป็น JSON เท่านั้น ห้ามมีข้อความอื่น:
{"orderNumber":"PL...","contractNumber":"69-...","quoteNumber":"A0...","orderDate":"YYYY-MM-DD","dueDate":"YYYY-MM-DD","hospital":"ชื่อโรงพยาบาล","department":"แผนก","contactPerson":"ผู้ติดต่อ","orderTitle":"ชื่อเรื่อง","notes":"หมายเหตุ","ownerName":"ผู้ขาย","items":[{"productCode":"รหัส","description":"รายละเอียด","quantity":จำนวน,"unitPrice":ราคา,"totalPrice":รวม}]}`;

async function parsePDF(b64) {
  const res = await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"Content-Type":"application/json","x-api-key":import.meta.env.VITE_ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model:"claude-sonnet-4-6",max_tokens:1000,messages:[{role:"user",content:[
      {type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}},
      {type:"text",text:PROMPT}
    ]}]})
  });
  const data = await res.json();
  const text = data.content?.find(b=>b.type==="text")?.text||"";
  return JSON.parse(text.replace(/```json|```/g,"").trim());
}

function Field({label,value,onChange,type="text",required}) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 block mb-1">{label}{required&&<span className="text-red-400 ml-0.5">*</span>}</label>
      <input type={type} value={value||""} onChange={e=>onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"/>
    </div>
  );
}

export default function UploadPDF() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stage, setStage] = useState("upload");
  const [form,  setForm]  = useState(null);
  const [error, setError] = useState("");
  const [drag,  setDrag]  = useState(false);

  const upd  = k => v => setForm(f=>({...f,[k]:v}));
  const updI = (i,k) => v => setForm(f=>({...f,items:f.items.map((it,idx)=>idx===i?{...it,[k]:v}:it)}));

  async function handleFile(file) {
    if (!file||file.type!=="application/pdf") { setError("กรุณาเลือกไฟล์ PDF เท่านั้น"); return; }
    setError(""); setStage("parsing");
    try {
      const b64 = await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej();r.readAsDataURL(file);});
      setForm(await parsePDF(b64)); setStage("review");
    } catch(e) { setError("อ่าน PDF ไม่สำเร็จ: "+e.message); setStage("upload"); }
  }

  async function handleSave() {
    setStage("saving");
    try { await createOrder(form, user.uid); setStage("done"); }
    catch(e) { setError("บันทึกไม่สำเร็จ: "+e.message); setStage("review"); }
  }

  if (stage==="upload"||stage==="parsing") return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-800 mb-1">เพิ่มใบสั่งซื้อจาก PDF</h1>
      <p className="text-sm text-slate-400 mb-6">ระบบอ่านข้อมูลอัตโนมัติ แล้วให้คุณตรวจสอบก่อนบันทึก</p>
      {stage==="parsing"
        ? <div className="bg-white rounded-xl border border-slate-200 p-16 text-center max-w-lg">
            <div className="text-4xl mb-4 animate-pulse">🤖</div>
            <div className="font-bold text-slate-700">AI กำลังอ่านข้อมูลจาก PDF...</div>
            <div className="text-sm text-slate-400 mt-2">รองรับภาษาไทยและรูปแบบ KOSIN</div>
          </div>
        : <div className="max-w-lg">
            <div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
              onDrop={e=>{e.preventDefault();setDrag(false);handleFile(e.dataTransfer.files[0]);}}
              onClick={()=>document.getElementById("pdf-in").click()}
              className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition ${drag?"border-blue-400 bg-blue-50":"border-slate-200 bg-slate-50 hover:border-slate-400"}`}>
              <div className="text-4xl mb-3">📄</div>
              <div className="font-bold text-slate-700">คลิกเพื่อเลือกไฟล์ หรือลากวางที่นี่</div>
              <div className="text-xs text-slate-400 mt-2">รองรับ PDF • ขนาดไม่เกิน 10MB</div>
              <input id="pdf-in" type="file" accept="application/pdf" className="hidden" onChange={e=>handleFile(e.target.files[0])}/>
            </div>
            {error && <div className="mt-3 text-red-500 text-sm">{error}</div>}
            <div className="mt-4 bg-blue-50 text-blue-700 text-xs rounded-lg px-4 py-3">
              💡 ระบบใช้ Claude AI อ่านข้อมูลจาก PDF รูปแบบ KOSIN ได้อัตโนมัติ รวมถึงภาษาไทย
            </div>
          </div>
      }
    </div>
  );

  if (stage==="done") return (
    <div className="flex items-center justify-center min-h-96">
      <div className="text-center">
        <div className="text-6xl mb-4">✅</div>
        <h2 className="text-xl font-extrabold text-slate-800 mb-2">บันทึกใบสั่งซื้อสำเร็จ</h2>
        <p className="text-slate-400 text-sm mb-6">{form?.orderNumber} — {form?.hospital}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={()=>{setStage("upload");setForm(null);}} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">เพิ่มใบสั่งซื้อใหม่</button>
          <button onClick={()=>navigate("/orders")} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold cursor-pointer">ดูรายการทั้งหมด →</button>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-800 mb-1">ตรวจสอบข้อมูลก่อนบันทึก</h1>
      <p className="text-sm text-slate-400 mb-5">ระบบอ่าน PDF แล้ว — ตรวจสอบและแก้ไขก่อนบันทึก</p>
      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs font-bold text-slate-400 tracking-wider mb-4">ข้อมูลหลัก</div>
          <div className="grid gap-3">
            <Field label="เลขที่สัญญา / สั่งซื้อ" value={form?.orderNumber} onChange={upd("orderNumber")} required/>
            <Field label="เลขที่เสนอราคา" value={form?.quoteNumber} onChange={upd("quoteNumber")}/>
            <Field label="วันที่ออกใบสั่ง" value={form?.orderDate} onChange={upd("orderDate")} type="date"/>
            <Field label="กำหนดส่งของ" value={form?.dueDate} onChange={upd("dueDate")} type="date" required/>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs font-bold text-slate-400 tracking-wider mb-4">ปลายทาง</div>
          <div className="grid gap-3">
            <Field label="โรงพยาบาล / บริษัท" value={form?.hospital} onChange={upd("hospital")} required/>
            <Field label="แผนกที่ส่ง" value={form?.department} onChange={upd("department")}/>
            <Field label="ผู้ติดต่อ" value={form?.contactPerson} onChange={upd("contactPerson")}/>
            <Field label="ผู้รับผิดชอบ" value={form?.ownerName} onChange={upd("ownerName")}/>
          </div>
        </div>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-800">รายการสินค้า</div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            {["รหัสสินค้า","รายละเอียด","จำนวน","หน่วยละ (฿)","รวม (฿)"].map(h=>(
              <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400">{h}</th>
            ))}
          </tr></thead>
          <tbody>{form?.items?.map((it,i)=>(
            <tr key={i} className="border-b border-slate-50">
              <td className="px-4 py-2"><input value={it.productCode||""} onChange={e=>updI(i,"productCode")(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-28 outline-none font-mono"/></td>
              <td className="px-4 py-2"><input value={it.description||""} onChange={e=>updI(i,"description")(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-full outline-none"/></td>
              <td className="px-4 py-2"><input type="number" value={it.quantity||""} onChange={e=>updI(i,"quantity")(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-16 outline-none"/></td>
              <td className="px-4 py-2 text-slate-500">{Number(it.unitPrice).toLocaleString()}</td>
              <td className="px-4 py-2 font-bold text-blue-900">{Number(it.totalPrice).toLocaleString()}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {form?.notes && <div className="bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl px-4 py-3 mb-4">⚠ พบหมายเหตุ: "{form.notes}" — สถานะส่งมอบต้องยืนยันแยกต่างหาก ไม่บันทึกอัตโนมัติ</div>}
      {error && <div className="text-red-500 text-sm mb-3">{error}</div>}
      <div className="flex gap-3 justify-end">
        <button onClick={()=>setStage("upload")} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">← เลือกไฟล์ใหม่</button>
        <button onClick={handleSave} disabled={stage==="saving"} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50">
          {stage==="saving"?"กำลังบันทึก...":"บันทึกใบสั่งซื้อ →"}
        </button>
      </div>
    </div>
  );
}
