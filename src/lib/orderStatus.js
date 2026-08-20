// คำนวณ "สถานะจริง" ของใบสั่งซื้อ ณ เวลาปัจจุบัน
//
// เหตุผล: ระบบไม่มี background job ที่คอยเปลี่ยนค่า status ในฐานข้อมูลเป็น "overdue" อัตโนมัติเมื่อเกินกำหนดส่ง
// ฟิลด์ status ที่เก็บไว้จริงจะเป็นได้แค่ pending / partial / completed เท่านั้น (ตั้งค่าตอนสร้างใบสั่งซื้อ
// และตอนบันทึกการส่งมอบใน src/lib/firestore.js) จึงต้องคำนวณสดจาก dueDate เทียบกับวันนี้ทุกครั้งที่จะแสดงผล
// หรือกรองข้อมูล ไม่เช่นนั้นรายการที่เกินกำหนดจริงจะไม่ถูกนับว่า "เกินกำหนดส่ง" เลย (สถานะค้างเป็น "รอดำเนินการ" ตลอด)
export function effectiveStatus(order) {
  if (!order) return "pending";
  if (order.status === "completed" || order.status === "cancelled") return order.status;
  const raw = order.dueDate;
  if (raw) {
    const due = raw?.toDate ? raw.toDate() : new Date(raw);
    const days = Math.ceil((due - new Date()) / 86400000);
    if (days < 0) return "overdue";
  }
  return order.status || "pending";
}
