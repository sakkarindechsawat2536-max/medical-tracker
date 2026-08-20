import { useState, useEffect } from "react";
import { getAllFundOrders } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";

export function useFundOrders() {
  const { user } = useAuth();
  const [fundOrders, setFundOrders] = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");

  const refresh = async () => {
    if (!user) return;
    setLoading(true); setError("");
    try {
      setFundOrders(await getAllFundOrders());
    } catch (e) {
      console.error("โหลดข้อมูลเงินกันล้มเหลว:", e);
      setError(e?.message || "โหลดข้อมูลไม่สำเร็จ");
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [user?.uid]);
  return { fundOrders, loading, error, refresh };
}
