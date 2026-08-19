import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);
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
  const [a, b, c] = await Promise.all([
    getDocs(query(collection(db, "orderItems"), where("status", "!=", "completed"))),
    getDocs(collection(db, "users")),
    getDocs(collection(db, "purchaseOrders")),
  ]);
  const users = Object.fromEntries(b.docs.map(d => [d.id, d.data()]));
  const orders = Object.fromEntries(c.docs.map(d => [d.id, d.data()]));
  console.log(`พบ ${a.size} รายการ`);
  for (const doc of a.docs) {
    const item = doc.data();
    const order = orders[item.orderId];
    if (!order) continue;
    const due = item.dueDate || order.dueDate;
    const days = daysUntil(due);
    if (!THRESHOLDS.includes(days) && days >= 0) continue;
    const user = users[order.ownerId];
    if (!user?.email) continue;
    const subj = days < 0
      ? `เกินกำหนด ${Math.abs(days)} วัน — ${order.hospital}`
      : `เหลืออีก ${days} วัน — ${order.hospital}`;
    const html = `<div style="font-family:sans-serif">
      <h2 style="color:#1B2B4B">${subj}</h2>
      <p>โรงพยาบาล: <b>${order.hospital}</b></p>
      <p>เลขที่: <b>${order.orderNumber}</b></p>
      <p>สินค้า: <b>${item.productCode} — ${item.description}</b></p>
      <p>คงเหลือ: <b style="color:red">${item.quantity - item.delivered} ชิ้น</b></p>
      <a href="https://sakkarindechsawat2536-max.github.io/medical-tracker/">เปิดระบบ</a>
    </div>`;
    const r = await sendEmail(user.email, subj, html);
    console.log("sent:", JSON.stringify(r));
  }
  console.log("done");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
