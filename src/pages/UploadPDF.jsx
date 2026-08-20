import { useState } from "react";
import { useNavigate } from "react-router-dom";
import * as pdfjsLib from "pdfjs-dist";
import { createOrder, getOrderByNumber, addFundOrder } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { FUND_DEPTS } from "../lib/fundConstants";
import { isJunkNumber } from "../lib/orderNumber";

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

// PDF บางไฟล์ฝัง font ที่ตาราง ToUnicode แปลงวรรณยุกต์/ตัวการันต์ (่ ้ ๊ ๋ ์ ฯลฯ) ไม่ครบ
// ทำให้ข้อความที่ดึงออกมาขาดเครื่องหมายไปแบบสุ่ม (ไม่คงที่แม้เป็นชื่อเดียวกัน) ซึ่งแก้จาก
// ข้อมูลดิบไม่ได้เพราะตัวอักษรที่ถูกต้องไม่ได้ถูกฝังมาในไฟล์เลย — สำหรับชื่อที่ซ้ำทุกใบ
// (เช่นผู้ขายที่เซ็นกำกับ) จึงจับคู่แบบไม่สนใจวรรณยุกต์แล้วแทนที่ด้วยคำที่ถูกต้องแทน
const KNOWN_NAME_FIXES = [
  { test: /ศ.{0,2}ก.{0,2}ร.{0,2}น.{0,2}ท.{0,2}ร.*น.{0,2}ก/, fix: "ศักรินทร์ (นุ๊ก)" },
];
function fixKnownName(str) {
  for (const { test, fix } of KNOWN_NAME_FIXES) {
    if (test.test(str)) return fix;
  }
  return str;
}

function parseKOSINText(rawText) {
  const t = rawText.replace(/[ \t]+/g, " ");
  const lines = t.split("\n").map(l => l.trim()).filter(Boolean);
  const findLineIdx = (re) => lines.findIndex(l => re.test(l));

  // ---- ใน KOSIN PDF: ค่าข้อมูลอยู่ "บรรทัดเหนือ" label (value-above-label form) ----
  // เลย์เอาต์ของ PDF แต่ละใบไม่เหมือนกันเป๊ะ (บาง PDF ค่า 2 ช่องอยู่บรรทัดเดียวกัน
  // บาง PDF ค่าลอยคนละบรรทัด) จึงต้องอ่านทีละบรรทัดรอบๆ label แทนการเดา pattern เดียว

  // ---- เลขที่สัญญา/สั่งซื้อ + เลขที่เสนอราคา ----
  // อยู่เหนือบรรทัด "เลขที่สัญญา / สั่งซื้อ / สั่งจาง เลขที่เสนอราคา"
  let orderNumber = "", quoteNumber = "";
  const contractLabelIdx = findLineIdx(/เลขท.{0,3}ส.{0,2}ญญา/);
  if (contractLabelIdx > 0) {
    let valueLine = lines[contractLabelIdx - 1] || "";
    valueLine = valueLine.replace(/^(รพ)\s+(?=[\d.])/, "$1"); // "รพ 0033..." → "รพ0033..."
    const tokens = valueLine.split(" ").filter(Boolean);
    if (tokens.length >= 2) {
      orderNumber = tokens[0];
      quoteNumber = tokens[1];
    } else if (tokens.length === 1) {
      orderNumber = tokens[0];
      const above = lines[contractLabelIdx - 2] || "";
      if (/^[A-Z]\d{2,}[A-Z][\d\-]+$/.test(above)) quoteNumber = above; // เลขเสนอราคาลอยขึ้นไปอีกบรรทัด
    }
  }
  // บาง PDF (เช่นใบสั่งประเภทคลินิก) พิมพ์ "-" เป็นตัวคั่นว่างในช่องนี้แทนเลขจริง — ไม่ใช่เลขที่ใบสั่ง กันไว้ไม่ให้จับผิด
  if (isJunkNumber(orderNumber)) orderNumber = "";
  // fallback ด้วย regex กว้างๆ ถ้าหาจากบรรทัดไม่เจอ (รองรับทั้ง PO-xxx และ รพ-xxx)
  if (!orderNumber) orderNumber = findFirst(t, [/\b(PO[\w\-]+)/i, /(รพ[\d\.]+[\d\-]+)/, /UNIT\s+No\.?\s+([\d\-]+)/i]);
  if (!quoteNumber) quoteNumber = findFirst(t, [/([A-Z]\d{2,}[A-Z][\d\-]+)/]);
  orderNumber = orderNumber.replace(/\s+/g, "");

  // ---- โรงพยาบาล + แผนกที่ส่ง ----
  // อยู่เหนือบรรทัด "ชื่อโรงพยาบาล / บริษัท ... แผนก ..." — ตำแหน่งสัมพัทธ์ของ 2 ค่านี้ไม่คงที่
  // บาง PDF ทั้งสองอยู่บรรทัดเดียวกัน ("รพ . วัฒนแพทยอาวนาง OR"), บาง PDF โรงพยาบาลอยู่ไกลกว่าแผนก
  // ("รพ . ระนอง" แล้วค่อย "พัสดุ" ในบรรทัดถัดมา) จึงต้องสแกนหน้าต่างหลายบรรทัดแทนตำแหน่งตายตัว
  let hospital = "", department = "";
  const hospLabelIdx = findLineIdx(/โรงพยาบาล/);
  if (hospLabelIdx > 0) {
    const WIN = 3;
    const winStart = Math.max(0, hospLabelIdx - WIN);
    const win = lines.slice(winStart, hospLabelIdx); // บรรทัดก่อน label เรียงบนลงล่าง
    let hospLineIdx = -1, hMatch = null;
    for (let i = 0; i < win.length; i++) {
      const m = win[i].match(/รพ\s*\.\s*[ก-๙]+/);
      if (m) { hospLineIdx = i; hMatch = m; break; }
    }
    if (hospLineIdx >= 0) {
      hospital = hMatch[0].replace(/\s*\.\s*/, ".");
      const remainder = win[hospLineIdx].slice(hMatch.index + hMatch[0].length).trim();
      if (remainder) department = remainder;
      else if (hospLineIdx !== win.length - 1) department = win[win.length - 1];
    } else if (win.length > 0) {
      hospital = win[win.length - 1];
    }
  }

  // ---- ผู้ติดต่อ ----
  // อยู่เหนือบรรทัด "ชื่อบุคคลที่ติดต่อ กำหนดส่งของ วันที่ออกบิล"
  // เพิกเฉยข้อความ template คงที่ "ป - เดือน - วัน" (คำใบ้รูปแบบวันที่ ไม่ใช่ชื่อคน)
  let contactPerson = "";
  const contactLabelIdx = findLineIdx(/บ.{0,2}คคลท.{0,2}ต.{0,2}ดต/);
  if (contactLabelIdx > 0) {
    const cLine = (lines[contactLabelIdx - 1] || "").trim();
    if (cLine && !/เด.อน/.test(cLine)) contactPerson = cLine;
  }

  // วันที่ออกใบสั่ง — "18/8/2026" อยู่ก่อน label "Date" (value-above-label)
  const orderDate = parseThaiDate(findFirst(t, [
    /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/,   // 18/8/2026
    /วันท.{0,3}\s+([\d\/\-]+)/,
  ]));

  // กำหนดส่งของ — ISO date "2027-02-14" น่าเชื่อถือที่สุด
  const rawDue = findFirst(t, [
    /(\d{4}-\d{2}-\d{2})/,
    /ก.{0,3}หนดส.{0,3}ของ\s+([\d\/\-]+)/,
  ]);
  const dueDate = rawDue.match(/^\d{4}-\d{2}-\d{2}$/) ? rawDue : parseThaiDate(rawDue);

  // ชื่อเรื่องใบสั่ง — label และค่าอยู่บรรทัดเดียวกัน
  const orderTitle = findFirst(t, [
    /ใบส.{0,3}ง\s+([^\n]+)/,
    /Subject\s*:?\s*([^\n]+)/i,
  ]);

  // หมายเหตุ
  const notes = findFirst(t, [
    /หมายเหต.{0,2}\s+([^\n]+)/,
    /Note[s]?\s*:?\s*([^\n]+)/i,
  ]);

  // ผู้ขาย — หาชื่อ Thai หลัง "ผูแทนชวยขาย ลงชื่อ" (ข้ามบรรทัด "Data Not Found")
  const ownerName = fixKnownName(findFirst(t, [
    /ผ.{0,3}แทนช.{0,3}ยขาย\s+ลงช.{0,3}อ\s+([ก-๙][^\n]+)/,  // ชื่อ Thai หลัง ผู้แทน
    /ลงช.{0,3}อ\s+([ก-๙][ก-๙\s()\-]+)/,                      // ชื่อ Thai เท่านั้น
  ]));

  // ---- รายการสินค้า ----
  // format KOSIN: [ลำดับ] จำนวน รหัสสินค้า รายละเอียด ราคา(หน่วยละ) [ราคารวม]
  // ลำดับ (seq) อาจหายไปเมื่อรายการมีมากกว่า 1 บรรทัด และบางแถวมีราคาแค่ตัวเดียว (เมื่อจำนวน=1 หน่วยละ=รวม)
  // จำกัดขอบเขตค้นหาแค่ในตารางรายการสินค้า (ระหว่าง header "ลําดับ" กับ footer "ผูแทน...")
  // เพื่อไม่ให้ไปจับตัวเลขในส่วนสรุปราคา/ส่วนลดที่อยู่ถัดไปโดยผิดพลาด
  const items = [];
  const headerIdx = findLineIdx(/ลําดับ|ลำดับ/);
  let footerIdx = -1;
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < lines.length; i++) {
      if (/ผ.{0,2}แทน/.test(lines[i])) { footerIdx = i; break; }
    }
  }
  const scanLines = headerIdx >= 0
    ? lines.slice(headerIdx + 1, footerIdx >= 0 ? footerIdx : lines.length)
    : lines;

  // บาง PDF เลขลำดับ (seq) ของบางแถวหลุดไปอยู่คนละบรรทัดกับข้อมูลแถวเดียวกัน (ตามหลังบรรทัดข้อมูลทันที
  // เช่น "1 224003 Double Curette... 6,400.00" ตามด้วยบรรทัดโดดๆ "3") ถ้าปล่อยไว้ ตัวเลขลำดับจะหายไป
  // และทำให้ regex ด้านล่างเข้าใจผิดว่าตัวเลขจำนวน (1) คือลำดับ แล้วรหัสสินค้า (224003) กลายเป็นจำนวนแทน
  // จึงรวมบรรทัดลำดับที่หลุดโดดๆ กลับเข้ากับบรรทัดข้อมูลก่อนหน้าก่อนเริ่มจับคู่แถวสินค้า
  const mergedLines = [];
  for (const line of scanLines) {
    if (/^\d{1,2}$/.test(line) && mergedLines.length > 0) {
      mergedLines[mergedLines.length - 1] = `${line} ${mergedLines[mergedLines.length - 1]}`;
    } else {
      mergedLines.push(line);
    }
  }

  const itemLineRe = /^(?:(\d{1,2})\s+)?(\d+(?:\.\d+)?)\s+([A-Za-z0-9][A-Za-z0-9\-\/\.]{2,})\s+(.+?)\s+([\d,]+\.\d{2})(?:\s+([\d,]+\.\d{2}))?$/;

  for (const line of mergedLines) {
    const m = line.match(itemLineRe);
    if (!m) continue;
    const qty    = parseFloat(m[2]);
    const price1 = parseFloat(m[5].replace(/,/g, ""));
    const price2 = m[6] ? parseFloat(m[6].replace(/,/g, "")) : null;
    let unitPrice, totalPrice;
    if (price2 !== null) { unitPrice = price1; totalPrice = price2; }
    else { totalPrice = price1; unitPrice = qty > 0 ? +(price1 / qty).toFixed(2) : price1; }
    if (qty > 0 && totalPrice > 0 && totalPrice < 99_000_000) {
      items.push({
        productCode: m[3],
        description: m[4].trim(),
        quantity:    qty,
        unitPrice,
        totalPrice,
      });
    }
  }

  return {
    orderNumber,
    contractNumber: orderNumber,
    quoteNumber,
    orderDate,
    dueDate,
    hospital,
    department,
    contactPerson,
    orderTitle,
    notes,
    ownerName,
    items: items.length > 0
      ? items
      : [{ productCode: "", description: "", quantity: 0, unitPrice: 0, totalPrice: 0 }],
  };
}

// ---- extract text from PDF (pdfjs-dist) ------------------------------------

async function extractPDFText(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  let fullText = "";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();

    // จัดกลุ่ม text items ตาม y-coordinate เพื่อรักษาโครงสร้างบรรทัด
    const byY = {};
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = item.transform ? Math.round(item.transform[5]) : 0;
      if (!byY[y]) byY[y] = [];
      byY[y].push({ x: item.transform?.[4] ?? 0, str: item.str });
    }

    // เรียงจากบนลงล่าง (y สูง = บน ใน PDF coordinate) แล้วซ้ายไปขวา
    const lines = Object.entries(byY)
      .sort(([a], [b]) => Number(b) - Number(a))
      .map(([, lineItems]) =>
        lineItems.sort((a, b) => a.x - b.x).map(i => i.str).join(" ")
      );

    fullText += lines.join("\n") + "\n";
  }

  // Thai PDF บางไฟล์ใช้ font ที่ไม่มี ToUnicode mapping สำหรับ tone marks (์ ๊ ๋ ฯลฯ)
  // pdfjs-dist อ่านได้แต่แปลงเป็น □ (U+25A0-U+25FF) หรือ replacement char (U+FFFD)
  // กรองออกโดยเก็บเฉพาะ ASCII printable + Thai (U+0E00-U+0E7F) + newline
  fullText = fullText.replace(/[^\x20-\x7E฀-๿\n]/g, "");

  return fullText;
}

// ---- ดึงข้อมูล "เงินกันซื้ออุปกรณ์การแพทย์" จาก PDF ใบเดียวกัน --------------
// PDF ใบสั่งซื้อของ KOSIN มีข้อมูลเงินกันอยู่ในหน้าเดียวกับใบสั่งซื้อ (เครื่องหมายติ๊กแผนก,
// ยอด "ค่าใช้จ่ายส่งเสริมการขาย" = เงินกันซื้อของ, ยอด "สก วิชาการ/ดูงาน" = เงินกันค่าเดินทาง)
// ใช้ตรรกะเดียวกับระบบเงินกันแยกต่างหากที่มีอยู่แล้ว เพื่อให้อัปโหลด PDF ครั้งเดียวสร้างได้ทั้งสองระบบ
// ต้องอ่านตำแหน่ง x/y ของ text แต่ละชิ้นตรงๆ (ไม่ใช้ fullText ที่ extractPDFText ต่อบรรทัดไว้แล้ว)
// เพราะต้องเทียบตำแหน่งซ้าย-ขวาบนแถวเดียวกันอย่างละเอียดกว่า
const PDF_DEPT_MAP = {
  ANES: "AN", ARTHRO: "ARTHRO", ENT: "ENT", GYN: "GYN", HYGIENE: "HYGIENE",
  LAP: "LAP", MTP: "MTP", NEURO: "NEURO", OR1: "OR1", SPINE: "SPINE",
  THORAX: "THORAX", TP: "TP", UNIT: "UNIT", URO: "URO", VET: "VET",
};

function parseThaiNumber(str) {
  if (!str) return null;
  const n = parseFloat(str.replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

async function extractFundFields(b64) {
  const warnings = [];
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const page = await pdf.getPage(1);
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();

  function cleanText(s) { return Array.from(s).filter(ch => { const c = ch.codePointAt(0); return !(c >= 0xF700 && c <= 0xF8FF); }).join(""); }
  const items = textContent.items.map(it => ({
    text: cleanText(it.str),
    x: it.transform[4],
    top: viewport.height - it.transform[5],
  })).filter(it => it.text && it.text.trim());

  function wordsNear(topMin, topMax) {
    return items.filter(it => it.top >= topMin && it.top <= topMax).sort((a, b) => a.x - b.x);
  }

  // เลขที่ใบสั่ง (label "No." บนฟอร์ม) — ดึงแบบอิงตำแหน่งซ้าย-ขวาบนแถวเดียวกัน แม่นยำกว่าอ่านจาก
  // ข้อความที่ต่อบรรทัดไว้แล้ว ใช้เป็นตัวช่วยยืนยัน/ทดแทนเมื่อ parseKOSINText ดึงเลขที่ไม่ได้หรือได้ค่าที่ไม่น่าใช่เลขจริง
  let orderNo = "";
  const noItem = items.find(it => it.text === "No.");
  if (noItem) {
    const sameRow = wordsNear(noItem.top - 4, noItem.top + 4).filter(w => w.x > noItem.x);
    if (sameRow.length) orderNo = sameRow[0].text.trim();
  }
  if (isJunkNumber(orderNo)) orderNo = ""; // กันค่าขยะ เช่น "-" เดี่ยวๆ ที่พิมพ์เป็นตัวคั่นว่างในฟอร์ม

  // แผนก: หา label ในตารางกลุ่มสินค้าที่มีตัวเลข (เครื่องหมายติ๊ก) ต่อท้ายบนแถวเดียวกัน
  let pdfDeptLabel = null;
  for (const it of items) {
    if (Object.keys(PDF_DEPT_MAP).includes(it.text)) {
      const sameRow = wordsNear(it.top - 4, it.top + 4).filter(w => w.x > it.x && w.x < it.x + 40);
      if (sameRow.length && /^\d+$/.test(sameRow[0].text.trim())) { pdfDeptLabel = it.text; break; }
    }
  }
  const dept = pdfDeptLabel ? PDF_DEPT_MAP[pdfDeptLabel] : "";
  if (!dept) warnings.push("ไม่พบเครื่องหมายติ๊กแผนกในไฟล์ (สำหรับเงินกัน) กรุณาเลือกแผนกด้วยตนเอง");

  // เงินกันค่าเดินทาง: ยอดข้าง "สก วิชาการ/ดูงาน"
  let academicSupport = 0;
  const academicIdx = items.findIndex(it => it.text === "สก" &&
    wordsNear(it.top - 4, it.top + 4).some(w => w.text.includes("วิชาการ")));
  if (academicIdx >= 0) {
    const row = wordsNear(items[academicIdx].top - 4, items[academicIdx].top + 4);
    const numTok = row.slice().reverse().find(w => /^[\d,]+\.\d{2}$/.test(w.text.trim()) && w.x < 300);
    if (numTok) academicSupport = parseThaiNumber(numTok.text) || 0;
  }

  // เงินกันซื้อของ: ยอดข้าง "ค่าใช้จ่ายส่งเสริมการขาย"
  let salesPromo = 0;
  const promoIdx = items.findIndex(it => it.text.includes("คาใชจายสงเสริมการขาย") || it.text.includes("ค่าใช้จ่ายส่งเสริมการขาย"));
  if (promoIdx >= 0) {
    const label = items[promoIdx];
    const row = wordsNear(label.top - 4, label.top + 4).filter(w => w.x > label.x);
    const numTok = row.find(w => /^[\d,]+\.\d{2}$/.test(w.text.trim()));
    if (numTok) salesPromo = parseThaiNumber(numTok.text) || 0;
  }

  const buyFund = Math.round(salesPromo * 100) / 100;
  const travelFund = Math.round(academicSupport * 100) / 100;
  if (salesPromo === 0)     warnings.push('ไม่พบยอด "ค่าใช้จ่ายส่งเสริมการขาย" (เงินกันซื้อของ) ในไฟล์ กรุณากรอกด้วยตนเอง');
  if (academicSupport === 0) warnings.push('ไม่พบยอด "สก วิชาการ/ดูงาน" (เงินกันค่าเดินทาง) ในไฟล์ — เว้นว่างไว้ กรุณาตรวจสอบ');

  return { dept, buyFund, travelFund, orderNo, warnings };
}

// ---- empty form template ---------------------------------------------------

function emptyForm() {
  return {
    orderNumber: "", contractNumber: "", quoteNumber: "", pdfNo: "",
    orderDate: "", dueDate: "", hospital: "", department: "",
    contactPerson: "", orderTitle: "", notes: "", ownerName: "",
    items: [{ productCode: "", description: "", quantity: 0, unitPrice: 0, totalPrice: 0 }],
    createFund: true, fundDept: "", fundBuy: "", fundTravel: "", fundCamera: "", fundNote: "", fundWarnings: [],
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

function SelectField({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-500 block mb-1">{label}</label>
      <select
        value={value || ""}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 transition bg-white"
      >
        <option value="">— เลือกแผนก —</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ---- main component --------------------------------------------------------

export default function UploadPDF() {
  const { user }   = useAuth();
  const toast      = useToast();
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
    const toastId = toast.loading("กำลังอ่านข้อมูลจาก PDF...");
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

      // ดึงข้อมูล "เงินกันซื้ออุปกรณ์" จาก PDF ใบเดียวกัน (ไม่ทำให้การอ่านใบสั่งซื้อล้มเหลวถ้าดึงส่วนนี้ไม่ได้)
      // รวมถึงเลขที่ใบสั่งจาก label "No." ที่ดึงแบบอิงตำแหน่ง — ใช้เป็นตัวสำรองเมื่อ parseKOSINText ดึงเลขที่ไม่ได้
      let fund = { dept: "", buyFund: 0, travelFund: 0, orderNo: "", warnings: [] };
      try {
        fund = await extractFundFields(b64);
      } catch (fundErr) {
        fund = { dept: "", buyFund: 0, travelFund: 0, orderNo: "", warnings: ["ดึงข้อมูลเงินกันจาก PDF ไม่สำเร็จ: " + fundErr.message] };
      }
      // เก็บเลขที่จาก label "No." ในไฟล์ไว้แยกต่างหากเสมอ (แม้จะมีเลขที่สัญญา/สั่งซื้ออยู่แล้ว) เพื่อใช้อ้างอิง
      // และกันไม่ให้ใบสั่งที่ไม่มีเลขที่จริง (เช่น ใบสั่งของคลินิก) ถูกเข้าใจผิดว่าซ้ำกันในหน้ารายการ
      parsed.pdfNo = fund.orderNo || "";
      if (!parsed.orderNumber && fund.orderNo) {
        parsed.orderNumber = fund.orderNo;
        parsed.contractNumber = fund.orderNo;
      }
      setForm({
        ...parsed,
        createFund: true,
        fundDept: fund.dept, fundBuy: fund.buyFund || "", fundTravel: fund.travelFund || "",
        fundCamera: "", fundNote: "", fundWarnings: fund.warnings,
      });

      // ตรวจว่า parse ได้ข้อมูลหลักครบไหม
      const filled = [parsed.orderNumber, parsed.hospital, parsed.dueDate].filter(Boolean).length;
      if (filled === 0) {
        setPdfNote("⚠ ดึงข้อมูลอัตโนมัติไม่ได้ — กรุณากรอกข้อมูลเอง (ดูข้อความจาก PDF ด้านล่าง)");
        toast.error("ดึงข้อมูลจาก PDF อัตโนมัติไม่ได้ — กรุณากรอกข้อมูลเอง", { id: toastId });
      } else if (filled < 3) {
        setPdfNote("ℹ ดึงข้อมูลได้บางส่วน — ตรวจสอบและเติมข้อมูลที่ขาดหายด้านล่าง");
        toast.info("ดึงข้อมูลได้บางส่วน — ตรวจสอบและเติมข้อมูลที่ขาดหายด้านล่าง", { id: toastId });
      } else {
        setPdfNote("✅ ดึงข้อมูลสำเร็จ — ตรวจสอบก่อนบันทึก");
        toast.success("อ่าน PDF สำเร็จ — ตรวจสอบข้อมูลก่อนบันทึก", { id: toastId });
      }
      setStage("review");
    } catch (e) {
      setPdfNote("⚠ อ่าน PDF ไม่สำเร็จ: " + e.message + " — กรอกข้อมูลเองแทน");
      toast.error("อ่าน PDF ไม่สำเร็จ: " + e.message, { id: toastId });
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
    setError("");
    const checkId = toast.loading("กำลังตรวจสอบใบสั่งซื้อซ้ำ...");
    try {
      // ป้องกันการบันทึกใบสั่งซื้อเลขที่เดียวกันซ้ำโดยไม่ตั้งใจ (เช่น กดบันทึกซ้ำ หรืออัปโหลด PDF ใบเดิมอีกรอบ)
      const dup = form.orderNumber ? await getOrderByNumber(form.orderNumber) : null;
      if (dup) {
        toast.dismiss(checkId);
        const proceed = window.confirm(
          `พบใบสั่งซื้อเลขที่ "${form.orderNumber}" อยู่ในระบบแล้ว\n\nต้องการบันทึกซ้ำอีกฉบับหรือไม่? (กด "ตกลง" เพื่อบันทึกซ้ำ, กด "ยกเลิก" เพื่อไม่บันทึก)`
        );
        if (!proceed) {
          setStage("review");
          toast.info("ยกเลิกการบันทึก — พบใบสั่งซื้อเลขที่ซ้ำ");
          return;
        }
      } else {
        toast.dismiss(checkId);
      }

      const saveId = toast.loading(form.createFund ? "กำลังบันทึกใบสั่งซื้อและรายการเงินกัน..." : "กำลังบันทึกใบสั่งซื้อ...");
      try {
        // ตัดฟิลด์ที่เกี่ยวกับ "เงินกัน" ออกก่อน ไม่ให้ปนไปกับข้อมูลใบสั่งซื้อใน purchaseOrders
        const { createFund, fundDept, fundBuy, fundTravel, fundCamera, fundNote, fundWarnings, ...orderData } = form;
        const newOrderId = await createOrder(orderData, user.uid);

        if (createFund && form.hospital) {
          try {
            await addFundOrder(form.hospital, {
              date: form.orderDate || form.dueDate || null,
              orderNo: form.orderNumber,
              dept: fundDept || null,
              buyFund: fundBuy || 0,
              travelFund: fundTravel || 0,
              cameraFund: fundCamera || 0,
              deduct: 0,
              note: fundNote || form.orderTitle || null,
              linkedOrderId: newOrderId,
            }, user.uid);
          } catch (fundErr) {
            // ใบสั่งซื้อบันทึกสำเร็จแล้ว แต่รายการเงินกันบันทึกไม่สำเร็จ — แจ้งเตือนแยก ไม่ทำให้ทั้งหมดล้มเหลว
            toast.error("บันทึกใบสั่งซื้อสำเร็จ แต่บันทึกรายการเงินกันไม่สำเร็จ: " + fundErr.message);
          }
        }

        setStage("done");
        toast.success("บันทึกใบสั่งซื้อสำเร็จ", { id: saveId });
      } catch (e) {
        setError("บันทึกไม่สำเร็จ: " + e.message);
        toast.error("บันทึกไม่สำเร็จ: " + e.message, { id: saveId });
        setStage("review");
      }
    } catch (e) {
      toast.error("ตรวจสอบข้อมูลซ้ำไม่สำเร็จ: " + e.message, { id: checkId });
      setStage("review");
    }
  }

  // ---- upload / parsing stage ----
  if (stage === "upload" || stage === "parsing") return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-800 mb-1">เพิ่มใบสั่งซื้อจาก PDF</h1>
      <p className="text-sm text-slate-400 mb-6">ระบบอ่านข้อมูลอัตโนมัติ แล้วให้คุณตรวจสอบก่อนบันทึก</p>
      {stage === "parsing"
        ? (
          <div className="bg-white rounded-xl border border-slate-200 p-8 sm:p-16 text-center max-w-lg">
            <div className="text-4xl mb-4 animate-pulse">📄</div>
            <div className="font-bold text-slate-700 flex items-center justify-center gap-2">
              <span className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
              กำลังอ่านข้อมูลจาก PDF...
            </div>
            <div className="text-sm text-slate-400 mt-2">ประมวลผลบนเครื่อง — ไม่ส่งข้อมูลออกอินเทอร์เน็ต</div>
          </div>
        ) : (
          <div className="max-w-lg">
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={e => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => document.getElementById("pdf-in").click()}
              className={`border-2 border-dashed rounded-2xl p-8 sm:p-16 text-center cursor-pointer transition
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
        <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[560px]">
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
      </div>

      <div className="bg-white rounded-xl border border-slate-200 mb-4 p-5">
        <label className="flex items-center gap-2 cursor-pointer mb-4">
          <input type="checkbox" checked={!!form?.createFund} onChange={e => upd("createFund")(e.target.checked)}
            className="w-4 h-4 accent-teal-600 cursor-pointer" />
          <span className="text-sm font-bold text-slate-800">บันทึกเข้าระบบเงินกันซื้ออุปกรณ์การแพทย์ด้วย</span>
        </label>
        {form?.createFund && (
          <>
            {form?.fundWarnings?.length > 0 && (
              <ul className="mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 list-disc pl-8">
                {form.fundWarnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <SelectField label="แผนก (เงินกัน)" value={form?.fundDept} onChange={upd("fundDept")} options={FUND_DEPTS} />
              <Field label="เงินกันซื้อของ (฿)"     value={form?.fundBuy}    onChange={upd("fundBuy")}    type="number" />
              <Field label="เงินกันค่าเดินทาง (฿)"  value={form?.fundTravel} onChange={upd("fundTravel")} type="number" />
              <Field label="เงินกันกล้อง (฿)"       value={form?.fundCamera} onChange={upd("fundCamera")} type="number" />
            </div>
            <div className="mt-3">
              <Field label="หมายเหตุ (เงินกัน)" value={form?.fundNote} onChange={upd("fundNote")} />
            </div>
          </>
        )}
      </div>

      {form?.notes && (
        <div className="bg-amber-50 text-amber-700 text-sm font-semibold rounded-xl px-4 py-3 mb-4">
          ⚠ พบหมายเหตุ: "{form.notes}" — สถานะส่งมอบต้องยืนยันแยกต่างหาก
        </div>
      )}
      {error && <div className="text-red-500 text-sm mb-3">{error}</div>}
      <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
        <button onClick={() => { setStage("upload"); setPdfNote(""); }}
          className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold cursor-pointer">
          ← เลือกไฟล์ใหม่
        </button>
        <button onClick={handleSave} disabled={stage === "saving"}
          className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2">
          {stage === "saving" && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
          {stage === "saving" ? "กำลังบันทึก..." : "บันทึกใบสั่งซื้อ →"}
        </button>
      </div>
    </div>
  );
}
