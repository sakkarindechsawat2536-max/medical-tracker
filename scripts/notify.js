import { initializeApp, cert }       from "firebase-admin/app";
import { getFirestore, FieldValue }  from "firebase-admin/firestore";
import nodemailer                    from "nodemailer";

// ---- Firebase init ---------------------------------------------------------
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// ---- Gmail SMTP (ฟรี 100%) -------------------------------------------------
// ตั้งค่า GitHub Secrets: GMAIL_USER และ GMAIL_APP_PASSWORD
// วิธีสร้าง App Password: myaccount.google.com → Security → App Passwords
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendEmail(to, subject, html) {
  const info = await transporter.sendMail({
    from: `"KOSIN Med" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
  });
  return info.messageId;
}

// ---- logic -----------------------------------------------------------------
const THRESHOLDS = [30, 15, 7, 3, 1];
const THRESHOLD_TOKENS = { 30: "d30", 15: "d15", 7: "d7", 3: "d3", 1: "d1" };
// ค่าเริ่มต้นถ้าผู้ใช้ยังไม่เคยกด "บันทึกการตั้งค่า" ในหน้าการแจ้งเตือนเลย (ตรงกับค่าเริ่มต้นฝั่งหน้าเว็บ)
const DEFAULT_SCHEDULE = ["d30", "d15", "d7", "d3", "d1", "overdue"];

function daysUntil(d) {
  return Math.ceil((new Date(d) - new Date()) / 86_400_000);
}

// GitHub Actions รัน workflow นี้ทุกชั่วโมง (UTC) — เทียบแค่ "ชั่วโมง" เวลาไทย (UTC+7) กับที่ผู้ใช้ตั้งไว้
// เพื่อให้แต่ละคนได้รับแจ้งเตือนใกล้เคียงเวลาที่ตั้งเองในหน้าเว็บ (ความละเอียดระดับชั่วโมง ไม่ใช่นาที)
function currentThaiHour() {
  return (new Date().getUTCHours() + 7) % 24;
}
function userNotifyHour(user) {
  const h = parseInt((user.notifyTime || "08:00").split(":")[0], 10);
  return isNaN(h) ? 8 : h;
}

async function run() {
  const [itemsSnap, usersSnap, ordersSnap] = await Promise.all([
    db.collection("orderItems").where("status", "!=", "completed").get(),
    db.collection("users").get(),
    db.collection("purchaseOrders").get(),
  ]);

  const users  = Object.fromEntries(usersSnap.docs.map(d => [d.id, d.data()]));
  const orders = Object.fromEntries(ordersSnap.docs.map(d => [d.id, d.data()]));
  console.log(`📋 พบ ${itemsSnap.size} รายการที่ยังไม่ส่งครบ`);

  const thaiHour = currentThaiHour();
  console.log(`🕐 ชั่วโมงปัจจุบัน (ไทย): ${thaiHour}:00`);

  let sent = 0;
  for (const docSnap of itemsSnap.docs) {
    const item  = docSnap.data();
    const order = orders[item.orderId];
    if (!order) continue;

    const due  = item.dueDate || order.dueDate;
    const days = daysUntil(due);
    if (!THRESHOLDS.includes(days) && days >= 0) continue;

    const user = users[order.ownerId];
    if (!user) continue;
    if (user.isActive === false) continue;              // แอดมินปิดการใช้งานบัญชีนี้ไว้
    if (user.emailNotify === false) continue;            // ผู้ใช้ปิดสวิตช์แจ้งเตือนทางอีเมลไว้ในหน้าการแจ้งเตือน
    if (userNotifyHour(user) !== thaiHour) continue;      // ยังไม่ถึงชั่วโมงที่ผู้ใช้คนนี้ตั้งไว้

    const isOverdue = days < 0;
    const token = isOverdue ? "overdue" : THRESHOLD_TOKENS[days];
    const schedule = Array.isArray(user.notifySchedule) ? user.notifySchedule : DEFAULT_SCHEDULE;
    if (!schedule.includes(token)) continue;              // ผู้ใช้ไม่ได้ติ๊กเลือกรอบแจ้งเตือนนี้ไว้

    const to = user.notifyEmail || user.email;            // ใช้อีเมลปลายทางที่ตั้งไว้ ถ้าไม่ได้ตั้งจะใช้อีเมล Login แทน
    if (!to) continue;

    const subject = isOverdue
      ? `⚠️ เกินกำหนด ${Math.abs(days)} วัน — ${order.hospital}`
      : `🔔 เหลืออีก ${days} วัน — ${order.hospital}`;

    const remaining = item.quantity - item.delivered;
    const color     = isOverdue ? "#DC2626" : "#D97706";
    const badgeBg   = isOverdue ? "#FEE2E2" : "#FEF3C7";

    const html = `
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;background:#f8fafc;border-radius:12px">
  <div style="background:#1B2B4B;color:white;border-radius:8px;padding:20px 24px;margin-bottom:20px">
    <div style="font-size:20px;font-weight:700">${subject}</div>
    <div style="font-size:13px;opacity:0.7;margin-top:4px">KOSIN Medical Supply Tracker</div>
  </div>

  <div style="background:white;border-radius:8px;padding:20px;margin-bottom:16px;border:1px solid #e2e8f0">
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#64748b;width:140px">โรงพยาบาล</td>
          <td style="padding:6px 0;font-weight:600">${order.hospital}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">ใบสั่งซื้อ</td>
          <td style="padding:6px 0;font-weight:600;font-family:monospace">${order.orderNumber}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">สินค้า</td>
          <td style="padding:6px 0">${item.productCode} — ${item.description}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">คงเหลือ</td>
          <td style="padding:6px 0">
            <span style="background:${badgeBg};color:${color};font-weight:700;padding:2px 10px;border-radius:20px">
              ${remaining} ชิ้น
            </span>
          </td></tr>
      <tr><td style="padding:6px 0;color:#64748b">กำหนดส่ง</td>
          <td style="padding:6px 0;color:${color};font-weight:600">${due}</td></tr>
    </table>
  </div>

  <div style="text-align:center">
    <a href="https://sakkarindechsawat2536-max.github.io/medical-tracker/"
       style="display:inline-block;background:#1B2B4B;color:white;padding:12px 32px;border-radius:8px;
              text-decoration:none;font-weight:700;font-size:14px">
      เปิดระบบ KOSIN Med →
    </a>
  </div>

  <div style="text-align:center;margin-top:20px;font-size:11px;color:#94a3b8">
    แจ้งเตือนอัตโนมัติจาก KOSIN Medical Tracker • ไม่ต้องตอบกลับ email นี้
  </div>
</div>`;

    try {
      const msgId = await sendEmail(to, subject, html);
      console.log(`✅ ส่งถึง ${to} — ${msgId}`);
      sent++;
      try {
        await db.collection("notifications").add({
          userId: order.ownerId, channel: "email", orderId: item.orderId,
          type: token, sentAt: FieldValue.serverTimestamp(),
        });
      } catch (histErr) {
        // ส่งอีเมลสำเร็จแล้ว แค่บันทึกประวัติไม่สำเร็จ — ไม่ทำให้ทั้งรอบล้มเหลว
        console.error("⚠ บันทึกประวัติการแจ้งเตือนไม่สำเร็จ:", histErr.message);
      }
    } catch (e) {
      console.error(`❌ ส่งถึง ${to} ไม่สำเร็จ:`, e.message);
    }
  }

  console.log(`\n🏁 เสร็จสิ้น — ส่งสำเร็จ ${sent} ฉบับ`);
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
