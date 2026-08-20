import {
  collection, doc, addDoc, updateDoc, getDoc, getDocs, deleteDoc,
  query, where, orderBy, serverTimestamp, setDoc,
} from "firebase/firestore";
import { db } from "./firebase";

// ตรวจสอบว่ามีใบสั่งซื้อเลขที่นี้อยู่ในระบบแล้วหรือยัง (ป้องกันการบันทึกซ้ำโดยไม่ตั้งใจ)
export async function getOrderByNumber(orderNumber) {
  if (!orderNumber) return null;
  const snap = await getDocs(query(collection(db, "purchaseOrders"), where("orderNumber", "==", orderNumber)));
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

// ลบใบสั่งซื้อพร้อมรายการสินค้าและประวัติการส่งมอบที่ผูกอยู่ทั้งหมด (ลบแล้วกู้คืนไม่ได้)
export async function deleteOrder(orderId) {
  const [itemsSnap, deliveriesSnap] = await Promise.all([
    getDocs(query(collection(db, "orderItems"), where("orderId", "==", orderId))),
    getDocs(query(collection(db, "deliveries"), where("orderId", "==", orderId))),
  ]);
  await Promise.all([
    ...itemsSnap.docs.map(d => deleteDoc(d.ref)),
    ...deliveriesSnap.docs.map(d => deleteDoc(d.ref)),
  ]);
  await deleteDoc(doc(db, "purchaseOrders", orderId));
}

export async function createOrder(data, userId) {
  const ref = await addDoc(collection(db, "purchaseOrders"), {
    ...data, ownerId: userId, status: "pending",
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: userId,
  });
  for (const item of (data.items || [])) {
    await addDoc(collection(db, "orderItems"), {
      orderId: ref.id, productCode: item.productCode, description: item.description,
      quantity: Number(item.quantity), delivered: 0,
      unitPrice: item.unitPrice, totalPrice: item.totalPrice,
      status: "pending", dueDate: data.dueDate,
      notifiedAt: { d30: null, d15: null, d7: null, d3: null, d1: null },
      createdAt: serverTimestamp(),
    });
  }
  return ref.id;
}

export async function getOrdersByUser(userId, role) {
  const col = collection(db, "purchaseOrders");
  const q = (role === "admin" || role === "manager")
    ? query(col, orderBy("createdAt", "desc"))
    : query(col, where("ownerId", "==", userId), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getOrderItems(orderId) {
  const snap = await getDocs(query(collection(db,"orderItems"), where("orderId","==",orderId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function recordDelivery(itemId, orderId, data, userId) {
  await addDoc(collection(db, "deliveries"), {
    itemId, orderId, ...data, recordedBy: userId, recordedAt: serverTimestamp(),
  });
  const ref  = doc(db, "orderItems", itemId);
  const snap = await getDoc(ref);
  const item = snap.data();
  const newDelivered = item.delivered + Number(data.quantity);
  const newStatus    = newDelivered >= item.quantity ? "completed" : "partial";
  await updateDoc(ref, { delivered: newDelivered, status: newStatus, updatedAt: serverTimestamp() });
  // sync order status
  const items = await getOrderItems(orderId);
  let status = "completed";
  for (const i of items) {
    if (i.id === itemId) { if (newStatus !== "completed") status = newStatus; continue; }
    if (i.status === "overdue") { status = "overdue"; break; }
    if (i.status === "partial") { status = "partial"; break; }
    if (i.status === "pending") status = "pending";
  }
  await updateDoc(doc(db,"purchaseOrders",orderId), { status, updatedAt: serverTimestamp() });
}

export async function getDeliveries(orderId) {
  const snap = await getDocs(query(collection(db,"deliveries"), where("orderId","==",orderId), orderBy("recordedAt","desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllDeliveries(userId, role) {
  const col = collection(db, "deliveries");
  const q = (role === "admin" || role === "manager")
    ? query(col, orderBy("recordedAt","desc"))
    : query(col, where("recordedBy","==",userId), orderBy("recordedAt","desc"));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getUsers() {
  const snap = await getDocs(collection(db,"users"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateUserRole(uid, role) {
  await updateDoc(doc(db,"users",uid), { role });
}

export async function updateUserActive(uid, isActive) {
  await updateDoc(doc(db,"users",uid), { isActive });
}

export async function saveNotificationSettings(uid, data) {
  await updateDoc(doc(db,"users",uid), data);
}

export async function getNotifHistory(userId) {
  const snap = await getDocs(query(collection(db,"notifications"), where("userId","==",userId), orderBy("sentAt","desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
