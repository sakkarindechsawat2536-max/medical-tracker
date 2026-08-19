import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to:"/",          icon:"⊞",  label:"Dashboard" },
  { to:"/orders",    icon:"📋", label:"ใบสั่งซื้อของฉัน" },
  { to:"/upload",    icon:"⊕",  label:"เพิ่มใบสั่งซื้อ PDF" },
  { to:"/calendar",  icon:"📅", label:"ปฏิทินกำหนดส่ง" },
  { to:"/history",   icon:"🕐", label:"ประวัติการส่งมอบ" },
  { to:"/notify",    icon:"🔔", label:"การแจ้งเตือน" },
  { to:"/users",     icon:"👥", label:"ผู้ใช้งานและสิทธิ์", adminOnly:true },
];

export default function Layout() {
  const { profile, logout, isAdmin } = useAuth();
  const nav = NAV.filter(n => !n.adminOnly || isAdmin);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <aside className="w-56 flex-shrink-0 flex flex-col" style={{ background:"#1B2B4B" }}>
        <div className="px-5 py-6 border-b border-white/10">
          <div className="text-xs font-bold tracking-widest text-slate-400 mb-1">KOSIN MED</div>
          <div className="text-base font-extrabold text-white leading-tight">ติดตาม<br/>กำหนดส่ง</div>
        </div>
        <nav className="flex-1 py-3">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end={n.to==="/"}
              className={({ isActive }) =>
                `flex items-center gap-3 w-full px-5 py-3 text-sm transition-all border-l-[3px] ${
                  isActive ? "bg-white/10 text-white font-bold border-amber-400"
                           : "text-slate-400 border-transparent hover:text-white hover:bg-white/5"}`}>
              <span>{n.icon}</span><span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-4 border-t border-white/10">
          <div className="text-xs text-slate-400">เข้าสู่ระบบในฐานะ</div>
          <div className="text-sm font-bold text-white mt-1 truncate">{profile?.displayName}</div>
          <div className="text-xs text-slate-400 mb-2 capitalize">{profile?.role}</div>
          <button onClick={logout} className="text-xs text-slate-400 hover:text-white transition cursor-pointer">ออกจากระบบ →</button>
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-y-auto"><Outlet /></main>
    </div>
  );
}
