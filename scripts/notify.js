import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, query, where } from "firebase/firestore";

const app = initializeApp({
  apiKey:    process.env.VITE_FIREBASE_API_KEY,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  appId:     process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

const THRESHOLDS = [30, 15, 7, 3, 1];

async function sendEmail(to, subject, html) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "KOSIN Med <onboarding@resend.dev>",
      to, subject, html
    }),
  });
  const data = await res.json();
  console.log("Resend response:", JSON.stringify(data));
  return data;
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

async function run() {
  console.log("เริ่มตรวจสอบกำหนดส่ง...");

  const [itemsSnap, usersSnap, ordersSnap] = await Promise.all([
    getDocs(query(collection(db, "orderItems"), where("status", "!=", "completed"))),
    getDocs(collection(db, "users")),
    getDocs(collection(db, "purchaseOrders")),
  ]);

  const users  = Object.fromEntries(usersSnap.docs.map(d => [d.id, d.data()]));
  const orders = Object.fromEntries(ordersSnap.docs.map(d => [d.id, d.data()]));

  console.log(`พบ ${itemsSnap.size} รายการที่ยังไม่ส่งครบ`);

  for (const itemDoc of itemsSnap.docs) {
    const item  = itemDoc.data();
    const order = orders[item.orderId];
    if (!order) continue;

    const dueDate = item.dueDate || order.dueDate;
    const days    = daysUntil(dueDate);
    const isMatch = THRESHOLDS.includes(days) || days < 0;
    if (!isMatch) continue;

    const user = users[order.ownerId];
    if (!user?.email) continue;

    const subject = days < 0
      ? `⚠️ เกินกำหนดส่ง ${Math.abs(days)} วัน — ${order.hospital}`
      : `🔔 เหลืออีก ${days} วัน — ${order.hospital}`;

    const html = `
      <div style="font-family:sans-serif;max-width:500px;padding:20px">
        <h2 style="color:#1B2B4B">${subject}</h2>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="color:#666;padding:6px 0;width:120px">โรงพยาบาล</td><td><b>${order.hospital}</b></td></tr>