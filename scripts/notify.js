import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const THRESHOLDS = [30, 15, 7, 3, 1];

async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: "KOSIN Med <onboarding@resend.dev>", to, subject, html }),
  });
  return res.json();
}

function daysUntil(d) {
  return Math.ceil((new Date(d) - new Date()) / 86400000);
}

async function run() {
  const [itemsSnap, usersSnap, ordersSnap] = await Promise.all([
    db.collection("orderItems").where("status", "!=", "completed").get(),
    db.collection("users").get(),
    db.collection("purchaseOrders").get(),
  ]);

  const users  = Object.fromEntries(usersSnap.docs.map(d => [d.id, d.data()]));
  const orders = Object.fromEntries(ordersSnap.docs.map(d => [d.id, d.data()]));
  console.log(`พบ ${itemsSnap.size} รายการที่ยังไม่ส่งครบ`);

  for (const doc of itemsSnap.docs) {
    const item  = doc.data();
    const order = orders[item.orderId];
    if (!order) continue;
    const due  = item.dueDate || order.dueDate;
    const days = daysUntil(due);
    if (!THRESHOLDS.includes(days) && days >= 0) continue;
    const user = users[order.ownerId];
    if (!user?.email) continue;

    const subj = days < 0
      ? `⚠️ เกินกำหนด ${Math.abs(days)} วัน — ${order.hospital}`
      : `🔔 เหลืออีก ${days} วัน — ${order.hospital}`;

    const html = `<div style="font-family:sans-serif;max-width:500px;padding:20px">
      <h2 style="color:#1B2B4B">${subj}</h2>
      <p>โรงพยาบาล: <b>${order.hospital}</b></p>
      <p>เลขที่ใบสั่งซื้อ: <b>${order.orderNumber}</b></p>
      <p>สินค้า: <b>${item.productCode} — ${item.description}</b></p>
      <p>คงเหลือ: <b style="color:#DC2626">${item.quantity - item.delivered} ชิ้น</b></p>
      <a href="https://sakkarindechsawat2536-max.github.io/medical-tracker/"
         style="display:inline-block;background:#1B2B4B;color:white;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
        เปิดระบบ →
      </a>
    </div>`;

    const r = await sendEmail(user.email, subj, html);
    console.log(`✅ ส่งถึง ${user.email}:`, JSON.stringify(r));
  }
  console.log("✅ เสร็จสิ้น");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
