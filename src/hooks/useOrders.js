import { useState, useEffect } from "react";
import { getOrdersByUser } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";

export function useOrders() {
  const { user, profile } = useAuth();
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");

  const refresh = async () => {
    if (!user || !profile) return;
    setLoading(true); setError("");
    try {
      setOrders(await getOrdersByUser(user.uid, profile.role));
    } catch (e) {
      console.error("โหลดรายการใบสั่งซื้อล้มเหลว:", e);
      setError(e?.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [user?.uid, profile?.role]);
  return { orders, loading, error, refresh };
}
