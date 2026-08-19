import { useState, useEffect } from "react";
import { getOrdersByUser } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";

export function useOrders() {
  const { user, profile } = useAuth();
  const [orders,  setOrders]  = useState([]);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    if (!user || !profile) return;
    try {
      setLoading(true);
      setOrders(await getOrdersByUser(user.uid, profile.role));
    } finally { setLoading(false); }
  };

  useEffect(() => { refresh(); }, [user?.uid, profile?.role]);
  return { orders, loading, refresh };
}
