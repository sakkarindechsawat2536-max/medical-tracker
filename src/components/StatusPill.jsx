export const STATUS_META = {
  pending:   { label:"รอดำเนินการ",   bg:"#F1F5F9", text:"#475569", bar:"#94A3B8" },
  partial:   { label:"ส่งบางส่วน",   bg:"#FEF3C7", text:"#D97706", bar:"#D97706" },
  completed: { label:"ส่งครบแล้ว",   bg:"#CCFBF1", text:"#0D9488", bar:"#0D9488" },
  overdue:   { label:"เกินกำหนดส่ง", bg:"#FEE2E2", text:"#DC2626", bar:"#DC2626" },
  cancelled: { label:"ยกเลิก",        bg:"#F1F5F9", text:"#94A3B8", bar:"#94A3B8" },
};

export function StatusPill({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", padding:"3px 10px 3px 8px",
      borderRadius:20, background:m.bg, fontSize:12, fontWeight:600, color:m.text,
      borderLeft:`3px solid ${m.bar}` }}>
      {m.label}
    </span>
  );
}

export function DaysBadge({ dueDate, status }) {
  if (!dueDate || status === "completed" || status === "cancelled") return null;
  const d = new Date(dueDate?.toDate ? dueDate.toDate() : dueDate);
  const days = Math.ceil((d - new Date()) / 86400000);
  let bg="#CCFBF1", color="#0D9488";
  if (days < 0)       { bg="#FEE2E2"; color="#DC2626"; }
  else if (days <= 3) { bg="#FEE2E2"; color="#DC2626"; }
  else if (days <= 7) { bg="#FEF3C7"; color="#D97706"; }
  const label = days < 0 ? `เกิน ${Math.abs(days)} วัน` : days === 0 ? "วันนี้!" : `อีก ${days} วัน`;
  return <span style={{ fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:12, background:bg, color }}>{label}</span>;
}

// ---- สถานะการเคลียร์เงินกัน (แยกจากสถานะใบสั่งซื้อด้านบน — ความหมายคนละแบบ) ----
// outstanding: ยังไม่เคลียร์เลย (deduct=0) / partial: เคลียร์บางส่วน / cleared: เคลียร์ครบแล้ว
export const FUND_STATUS_META = {
  outstanding: { label:"ค้างเคลียร์",  bg:"#FEE2E2", text:"#DC2626", bar:"#DC2626" },
  partial:     { label:"เคลียร์บางส่วน", bg:"#FEF3C7", text:"#D97706", bar:"#D97706" },
  cleared:     { label:"เคลียร์ครบแล้ว", bg:"#CCFBF1", text:"#0D9488", bar:"#0D9488" },
};

export function fundOrderAllocated(o) {
  return (o.buyFund||0) + (o.travelFund||0) + (o.cameraFund||0);
}
export function fundOrderStatus(o) {
  const alloc = fundOrderAllocated(o);
  const ded = o.deduct || 0;
  if (ded <= 0) return "outstanding";
  if (ded >= alloc && alloc > 0) return "cleared";
  if (ded > 0) return "partial";
  return "outstanding";
}

export function FundStatusPill({ status }) {
  const m = FUND_STATUS_META[status] || FUND_STATUS_META.outstanding;
  return (
    <span style={{ display:"inline-flex", alignItems:"center", padding:"3px 10px 3px 8px",
      borderRadius:20, background:m.bg, fontSize:12, fontWeight:600, color:m.text,
      borderLeft:`3px solid ${m.bar}` }}>
      {m.label}
    </span>
  );
}
