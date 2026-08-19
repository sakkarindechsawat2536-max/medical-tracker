const { initializeApp } = require("firebase/app");
const { getFirestore, collection, getDocs, query, where } = require("firebase/firestore");

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
    headers: { "Authorization": `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "KOSIN Med <onboarding@resend.dev>", to, subject, html }),
  });
  return res.json();
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000);
}

async function run() {
  const itemsSnap = await getDocs(query(collection(db, "orderItems"), where("status", "!=", "completed")));
  const usersSnap = await getDocs(collection(db, "users"));
  const ordersSnap = await getDocs(collection(db, "purchaseOrders"));

  const users  = Object.fromEntries(usersSnap.docs.map(d => [d.id, d.data()]));
  const orders = Object.fromEntries(ordersSnap.docs.map(d => [d.id, d.data()]));

  for (const itemDoc of itemsSnap.docs) {
    const item  = itemDoc.data();
    const order = orders[item.orderId];
    if (!order) continue;

    const days    = daysUntil(item.dueDate || order.dueDate);
    const isMatch = THRESHOLDS.includes(days) || (days < 0 && item.status !== "completed");
    if (!isMatch) continue;

    const user = users[order.ownerId];
    if (!user?.email) continue;

    const subject = days < 0
      ? `⚠️ เกินกำหนดส่ง ${Math.abs(days)} วัน — ${order.hospital}`
      : `🔔 เหลืออีก ${days} วัน — ${order.hospital}`;

    const html = `
      <div style="font-family:sans-serif;max-width:500px">
        <h2 style="color:#1B2B4B">${subject}</h2>
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="color:#666;padding:4px 0">โรงพยาบาล</td><td><b>${order.hospital}</b></td></tr>
          <tr><td style="color:#666;padding:4px 0">เลขที่ใบสั่งซื้อ</td><td><b>${order.orderNumber}</b></td></tr>
          <tr><td style="color:#666;padding:4px 0">กำหนดส่ง</td><td><b>${item.dueDate || order.dueDate}</b></td></tr>
          <tr><td style="color:#666;padding:4px 0">สินค้า</td><td><b>${item.productCode} — ${item.description}</b></td></tr>
          <tr><td style="color:#666;padding:4px 0">คงเหลือ</td><td><b style="color:#DC2626">${item.quantity - item.delivered} ชิ้น</b></td></tr>
        </table>
        <br>
        <a href="https://sakkarindechsawat2536-max.github.io/medical-tracker/" 
           style="background:#1B2B4B;color:white;padding:10px 20px;border-radius:8px;text-decoration:none">
          เปิดระบบ →
        </a>
      </div>`;

    await sendEmail(user.email, subject, html);
    console.log(`✅ ส่งอีเมลถึง ${user.email} — ${item.productCode}`);
  }
  console.log("เสร็จสิ้น");
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });