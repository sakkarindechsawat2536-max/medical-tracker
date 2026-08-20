import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import { createOrder } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";

// ใช้ worker จาก CDN ตรงกับ version ที่ติดตั้ง (ฟรี ไม่ต้องการ API key)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// ---- helpers ---------------------------------------------------------------

function parseThaiDate(str) {
  if (!str) return "";
  const m = str.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (m) {
    let y = parseInt(m[3]);
    if (y > 2500) y -= 543;          // แปลง พ.ศ. → ค.ศ.
    return `${y}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  const m2 = str.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m2) {
    let y = parseInt(m2[1]);
    if (y > 2500) y -= 543;
    return `${y}-${m2[2].padStart(2,"0")}-${m2[3].padStart(2,"0")}`;
  }
  return "";
}

function findFirst(text, patterns) {
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function parseKOSINText(rawText) {
  // รวมช่องว่างซ้ำให้เป็นบรรทัดเดียว แต่เก็บบรรทัดไว้สำหรับ item parsing
  const t = rawText.replace(/[ \t]+/g, " ");

  const orderNumber    = findFirst(t, [/\b(PL[\d\-\/]+)/i,  /ใบสั่งซื้อ[เลขที่\s:]*([\w\-\/]+)/]);
  const contractNumber = findFirst(t, [/\b(6[89][\-\d]+)/,  /สัญญา(?:เลขที่)?[\s:]*([\w\-]+)/]);
  const quoteNumber    = findFirst(t, [/\b(A0[\d\-]+)/i,    /ใบเสนอราคา[\s:]*([\w\-]+)/]);
  const hospital = findFirst(t, [
    /ส่งถึง[\s:]+([^\n,]+)/,
    /โรงพยาบาล([^\n,\d]{3,40})/,
    /ผู้ซื้อ[\s:]*([^\n]+)/,
  ]).replace(/^โรงพยาบาล/, "").trim();

  const department    = findFirst(t, [/แผนก[\s:]*([\w\sก-๙]+)/,     /Department[\s:]*([^\n]+)/i]);
  const contactPerson = findFirst(t, [/ผู้ติดต่อ[\s:]*([^\n,]+)/,   /Contact[\s:]*([^\n]+)/i]);
  const ownerName     = findFirst(t, [/ผู้ขาย[\s:]*([^\n,]+)/,      /ผู้จำหน่าย[\s:]*([^\n,]+)/]);
  const orderTitle    = findFirst(t, [/เรื่อง[\s:]*([^\n]+)/,        /Subject[\s:]*([^\n]+)/i]);
  const notes         = findFirst(t, [/หมายเหตุ[\s:]*([^\n]+)/,     /Note[s]?[\s:]*([^\n]+)/i]);
  const orderDate     = parseThaiDate(findFirst(t, [/วันที่[\s:]*([\d\/\-]+)/,          /Date[\s:]*([\d\/\-]+)/i]));
  const dueDate       = parseThaiDate(findFirst(t, [/กำหนดส่ง(?:ของ)?[\s:]*([\d\/\-]+)/, /ส่งมอบ[\s:]*([\d\/\-]+)/, /Due[\s:]*([\d\/\-]+)/i]));

  // แยก item จาก pattern: รหัส  รายละเอียด  จำนวน  ราคา/หน่วย  รวม
  const items = [];
  const lineRe = /([A-Z0-9][A-Z0-9\-\/\.]{2,})\s+(.{5,80}?)\s+(\d+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)/g;
  let m;
  while ((m = lineRe.exec(t)) !== null) {
    const qty   = parseFloat(m[3]);
    const unit  = parseFloat(m[4].replace(/,/g, ""));
    const total = parseFloat(m[5].replace(/,/g, ""));
    if (qty > 0 && unit > 0 && unit < 99_000_000) {
      items.push({ productCode: m[1], description: m[2].trim(), quantity: qty, unitPrice: unit, totalPrice: total });
    }
  }

  return {
    orderNumber, contractNumber, quoteNumber,
    orderDate, dueDate, hospital, department,
    contactPerson, orderTitle, notes, ownerName,
    items: items.length > 0 ? items : [{ productCode: "", description: "", quantity: 0, unitPrice: 0, totalPrice: 0 }],
  };
}

// ---- extract text from PDF (pdfjs-dist) ------------------------------------

async function extractPDFText(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  let text = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str).join(" ") + "\n";
  }
  return text;
}

// ---- empty form template ---------------------------------------------------

function emptyForm() {
  return {
    orderNumber: "", contractNumber: "", quoteNumber: "",
    orderDate: "", dueDate: "", hospital: "", department: "",
    contactPerson: "", orderTitle: "", notes: "", ownerName: "",
    items: [{ productCode: "", description: "", quantity: 0, unitPrice: 0, totalPrice: 0 }],
  };
}

// ---- sub-components --------------------------------------------------------

function Field({ label, value, onChange, type = "text", required }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 block mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition"
      />
    </div>
  );
}

// ---- main component --------------------------------------------------------

export default function UploadPDF() {
  const { user }   = useAuth();
  const navigate   = useNavigate();
  const [stage, setStage]       = useState("upload");
  const [form,  setForm]        = useState(null);
  const [error, setError]       = useState("");
  const [drag,  setDrag]        = useState(false);
  const [pdfNote, setPdfNote]   = useState("");   // ข้อความแจ้ง parse ได้เท่าไหร่
  const [rawText, setRawText]   = useState("");   // ข้อความดิบจาก PDF
  const [showRaw, setShowRaw]   = useState(false);

  const upd  = k => v => setForm(f => ({ ...f, [k]: v }));
  const updI = (i, k) => v => setForm(f => ({
    ...f, items: f.items.map((it, idx) => idx === i ? { ...it, [k]: v } : it),
  }));

  async function handleFile(file) {
    if (!file || file.type !== "application/pdf") { setError("กรุณาเลือกไฟล์ PDF เท่านั้น"); return; }
    setError(""); setPdfNote(""); setRawText(""); setStage("parsing");
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = () => res(r.result.split(",")[1]);
        r.onerror = () => rej(new Error("อ่านไฟล์ไม่ได้"));
        r.readAsDataURL(file);
      });

      const text = await extractPDFText(b64);
      setRawText(text);

      const parsed = parseKOSINText(text);
      setForm(parsed);

      // ตรวจว่า parse ได้ข้อมูลหลักครบไหม
      const filled = [parsed.orderNumber, parsed.hospital, parsed.dueDate].filter(Boolean).length;
      if (filled === 0) {
        setPdfNote("⚠ ดึงข้อมูลอัตโนมัติไม่ได้ — กรุณากรอกข้อมูลเอง (ดูข้อความจาก PDF ด้านล่าง)");
      } else if (filled < 3) {
        setPdfNote("ℹ ดึงข้อมูลได้บางส่วน — ตรวจสอบและเติมข้อมูลที่ขาดหายด้านล่าง");
      } else {
        setPdfNote("✅ ดึงข้อมูลสำเร็จ — ตรวจสอบก่อนบันทึก");
      }
      setStage("review");
    } catch (e) {
      setPdfNote("⚠ อ่าน PDF ไม่สำเร็จ: " + e.message + " — กรอกข้อมูลเองแทน");
      setForm(emptyForm());
      setStage("review");
    }
  }

  function handleManual() {
    setError(""); setPdfNote(""); setRawText("");
    setForm(emptyForm()); setStage("review");
  }

  async function handleSave() {
    setStage("saving");
    try { await createOrder(form, user.uid); setStage("done"); }
    catch (e) { setError("บันทึกไม่สำเร็จ: " + e.message); setStage("review"); }
  }

  // ---- upload / parsing stage ----
  if (stage === "upload" || stage === "parsing") return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-800 mb-1">เพิ่มใบสั่งซื้อจาก PDF</h1>
      <p className="text-sm text-slate-400 mb-6">ระบบอ่านข้อมูลอัตโนมัติ แล้วให้คุณตรวจสอบก่อนบันทึก</p>
      {stage === "parsing"
        ? (
          <div className="bg-white rounded-xl border border-slate-200 p-16 text-center max-w-lg">
            <div className="text-4xl mb-4 animate-pulse">📄</div>
            <div className="font-bold text-slate-700">กำลังอ่านข้อมูลจาก PDF...</div>
            <div className="text-sm text-slate-400 mt-2">ประมวลผลบนเครื่อง — ไม่ส่งข้อมูลออกอินเทอร์เน็ต</div>
          </div>
        ) : (
          <div className="max-w-lg">
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => document.getElementById("pdf-in").click()}
              className={`border-2 border-dashed rounded-2xl p-16 text-center cursor-pointer transition
                ${drag ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-slate-50 hover:border-slate-400"}`}
            >
              <div className="text-4xl mb-3">📄</div>
              <div className="font-bold text-slate-700">คลิกเพื่อเลือกไฟล์ หรือลากวางที่นี่</div>
              <div className="text-xs text-slate-400 mt-2">รองรับ PDF • ขนาดไม่เกิน 10MB</div>
              <input id="pdf-in" type="file" accept="application/pdf" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />
            </div>
            {error && <div className="mt-3 text-red-500 text-sm">{error}</div>}
            <div className="mt-4 bg-green-50 text-green-700 text-xs rounded-lg px-4 py-3">
              🔒 อ่าน PDF บนเครื่องของคุณ — ฟรี 100% ไม่ใช้ API ภายนอก
            </div>
            <button onClick={handleManual}
              className="mt-3 w-full text-center text-sm text-slate-400 hover:text-slate-600 underline cursor-pointer">
              หรือกรอกข้อมูลด้วยตนเอง →
            </button>
          </div>
        )
      }
    </div>
  );

  // ---- done stage ----
  if (stage === "done") return (
    <div className="flex items-center justify-center min-h-96">
      <div className="text-center">
        <div className="text-6xl mb-4">✅</div>
        <h2 className="text-xl font-extrabold text-slate-800 mb-2">บันทึกใบสั่งซื้อสำเร็จ</h2>
        <p className="text-slate-400 text-sm mb-6">{form?.orderNumber} — {form?.hospital}</p>
        <div className="flex gap-3 justify-center">
          <button onClick={() => { setStage("upload"); setForm(null); setPdfNote(""); }}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">
            เพิ่มใบสั่งซื้อใหม่
          </button>
          <button onClick={() => navigate("/orders")}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold cursor-pointer">
            ดูรายการทั้งหมด →
          </button>
        </div>
      </div>
    </div>
  );

  // ---- review stage ----
  return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-800 mb-1">ตรวจสอบข้อมูลก่อนบันทึก</h1>
      <p className="text-sm text-slate-400 mb-4">ตรวจสอบและแก้ไขข้อมูลก่อนบันทึก</p>

      {/* แจ้งผลการ parse */}
      {pdfNote && (
        <div className={`mb-4 text-sm rounded-xl px-4 py-3 border
          ${pdfNote.startsWith("✅") ? "bg-green-50 border-green-200 text-green-800"
          : pdfNote.startsWith("ℹ")  ? "bg-blue-50  border-blue-200  text-blue-800"
          : "bg-amber-50 border-amber-200 text-amber-800"}`}>
          {pdfNote}
          {rawText && (
            <button onClick={() => setShowRaw(v => !v)}
              className="ml-3 text-xs underline opacity-70 hover:opacity-100 cursor-pointer">
              {showRaw ? "ซ่อนข้อความ PDF" : "ดูข้อความจาก PDF"}
            </button>
          )}
        </div>
      )}

      {/* raw text จาก PDF เพื่อ reference */}
      {showRaw && rawText && (
        <div className="mb-4 bg-slate-50 border border-slate-200 rounded-xl p-4 max-h-48 overflow-y-auto">
          <div className="text-xs font-bold text-slate-400 mb-2">ข้อความดิบจาก PDF (ใช้เป็น reference)</div>
          <pre className="text-xs text-slate-600 whitespace-pre-wrap">{rawText}</pre>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs font-bold text-slate-400 tracking-wider mb-4">ข้อมูลหลัก</div>
          <div className="grid gap-3">
            <Field label="เลขที่สัญญา / สั่งซื้อ" value={form?.orderNumber}     onChange={upd("orderNumber")} required />
            <Field label="เลขที่เสนอราคา"           value={form?.quoteNumber}     onChange={upd("quoteNumber")} />
            <Field label="วันที่ออกใบสั่ง"           value={form?.orderDate}       onChange={upd("orderDate")} type="date" />
            <Field label="กำหนดส่งของ"               value={form?.dueDate}         onChange={upd("dueDate")} type="date" required />
          </div>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="text-xs font-bold text-slate-400 tracking-wider mb-4">ปลายทาง</div>
          <div className="grid gap-3">
            <Field label="โรงพยาบาล / บริษัท" value={form?.hospital}       onChange={upd("hospital")} required />
            <Field label="แผนกที่ส่ง"           value={form?.department}    onChange={upd("department")} />
            <Field label="ผู้ติดต่อ"             value={form?.contactPerson} onChange={upd("contactPerson")} />
            <Field label="ผู้รับผิดชอบ"          value={form?.ownerName}     onChange={upd("ownerName")} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 mb-4 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-800">รายการสินค้า</div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {["รหัสสินค้า","รายละเอียด","จำนวน","หน่วยละ (฿)","รวม (฿)"].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {form?.items?.map((it, i) => (
              <tr key={i} className="border-b border-slate-50">
                <td className="px-4 py-2">
                  <input value={it.productCode || ""} onChange={e => updI(i,"productCode")(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-28 outline-none font-mono" />
                </td>
                <td className="px-4 py-2">
                  <input value={it.description || ""} onChange={e => updI(i,"description")(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-full outline-none" />
                </td>
                <td className="px-4 py-2">
                  <input type="number" value={it.quantity || ""} onChange={e => updI(i,"quantity")(e.target.value)}
                    className="border border-slate-200 rounded-lg px-2 py-1 text-sm w-16 outline-none" />
                </td>
                <td className="px-4 py-2 text-slate-500">{Number(it.unitPrice).toLocaleString()}</td>
                <td className="px-4 py-2 font-bold text-blue-900">{Number(it.totalPrice).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form?.notes && (
        <div className="bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl px-4 py-3 mb-4">
          ⚠ พบหมายเหตุ: "{form.notes}" — สถานะส่งมอบต้องยืนยันแยกต่างหาก
        </div>
      )}
      {error && <div className="text-red-500 text-sm mb-3">{error}</div>}
      <div className="flex gap-3 justify-end">
        <button onClick={() => { setStage("upload"); setPdfNote(""); }}
          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">
          ← เลือกไฟล์ใหม่
        </button>
        <button onClick={handleSave} disabled={stage === "saving"}
          className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50">
          {stage === "saving" ? "กำลังบันทึก..." : "บันทึกใบสั่งซื้อ →"}
        </button>
      </div>
    </div>
  );
}
