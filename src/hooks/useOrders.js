import { useState, useEffect } from "react";
import { getOrdersByUser, getOrderItems, resyncOrderStatus } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";

// แก้เฉพาะครั้งแรกที่โหลดต่อรอบเปิดหน้าเว็บ (ไม่ทำซ้ำทุกครั้งที่สลับหน้า Dashboard/รายการ/ปฏิทิน)
// เพื่อไม่ให้เสียรอบอ่านข้อมูลเพิ่มโดยไม่จำเป็นหลังจากแก้ไขข้อมูลเก่าให้ถูกต้องไปแล้วครั้งหนึ่ง
let healedOnce = false;

export function useOrders() {
  const { user, profile } = useAuth();
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  const refresh = async () => {
    if (!user || !profile) return;
    setLoading(true); setError("");
    try {
      const data = await getOrdersByUser(user.uid, profile.role);
      setOrders(data);
      // ใบสั่งซื้อเก่าบางใบอาจเคยถูกคำนวณสถานะรวมผิดพลาดจากบั๊กเวอร์ชันก่อนหน้า (ดู recordDelivery ใน firestore.js)
      // แก้ไขเงียบๆ ที่พื้นหลังครั้งเดียวต่อรอบเปิดเว็บ ไม่บล็อกการแสดงผลรายการหลัก
      if (!healedOnce) { healedOnce = true; healStatuses(data); }
    } catch (e) {
      console.error("โหลดรายการใบสั่งซื้อล้มเหลว:", e);
      setError(e?.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally { setLoading(false); }
  };

  async function healStatuses(data) {
    try {
      const candidates = data.filter(o => o.status !== "completed" && o.status !== "cancelled");
      if (candidates.length === 0) return;
      const fixedAny = await Promise.all(candidates.map(async o => {
        try {
          const items = await getOrderItems(o.id);
          return await resyncOrderStatus(o.id, items, o.status);
        } catch { return null; } // ไม่มีสิทธิ์แก้ หรือโหลดไม่สำเร็จ ก็แค่ข้ามรายการนั้นไปเงียบๆ
      }));
      if (fixedAny.some(Boolean) && user && profile) setOrders(await getOrdersByUser(user.uid, profile.role));
    } catch {}
  }

  useEffect(() => { refresh(); }, [user?.uid, profile?.role]);
  return { orders, loading, error, refresh };
}
