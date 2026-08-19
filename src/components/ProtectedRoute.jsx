import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, requireAdmin=false }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-slate-400">กำลังโหลด...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.isActive) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center"><div className="text-3xl mb-2">🔒</div>
        <div className="font-bold text-slate-700">บัญชีนี้ถูกระงับ</div>
        <div className="text-sm text-slate-400">ติดต่อผู้ดูแลระบบ</div>
      </div>
    </div>
  );
  if (requireAdmin && profile?.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
