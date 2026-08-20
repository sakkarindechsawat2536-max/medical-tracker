import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to:"/",          icon:"⊞",  label:"Dashboard" },
  { to:"/orders",    icon:"📋", label:"ใบสั่งซื้อของฉัน" },
  { to:"/upload",    icon:"⊕",  label:"เพิ่มใบสั่งซื้อ PDF" },
  { to:"/fund",      icon:"💰", label:"เงินกันซื้ออุปกรณ์" },
  { to:"/calendar",  icon:"📅", label:"ปฏิทินกำหนดส่ง" },
  { to:"/history",   icon:"🕐", label:"ประวัติการส่งมอบ" },
  { to:"/notify",    icon:"🔔", label:"การแจ้งเตือน" },
  { to:"/users",     icon:"👥", label:"ผู้ใช้งานและสิทธิ์", adminOnly:true },
];

export default function Layout() {
  const { profile, logout, isAdmin } = useAuth();
  const nav = NAV.filter(n => !n.adminOnly || isAdmin);
  const [open, setOpen] = useState(false);

  const sidebarContent = (
    <>
      <div className="px-5 py-6 border-b border-white/10 flex items-start justify-between">
        <div>
          <div className="text-xs font-bold tracking-widest text-slate-400 mb-1">KOSIN MED</div>
          <div className="text-base font-extrabold text-white leading-tight">ติดตาม<br/>กำหนดส่ง</div>
        </div>
        <button onClick={()=>setOpen(false)} className="md:hidden text-slate-400 hover:text-white text-xl leading-none cursor-pointer">✕</button>
      </div>
      <nav className="flex-1 py-3 overflow-y-auto">
        {nav.map(n => (
          <NavLink key={n.to} to={n.to} end={n.to==="/"} onClick={()=>setOpen(false)}
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
    </>
  );

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-56 flex-shrink-0 flex-col" style={{ background:"#1B2B4B" }}>
        {sidebarContent}
      </aside>

      {/* Mobile drawer + backdrop */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/40" onClick={()=>setOpen(false)} />
      )}
      <aside
        className={`md:hidden fixed inset-y-0 left-0 z-50 w-64 flex flex-col transition-transform duration-200 ${open ? "translate-x-0" : "-translate-x-full"}`}
        style={{ background:"#1B2B4B" }}
      >
        {sidebarContent}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-slate-200 bg-white sticky top-0 z-30">
          <button onClick={()=>setOpen(true)} className="text-slate-600 text-xl leading-none cursor-pointer p-1 -ml-1">☰</button>
          <div className="text-sm font-extrabold text-slate-800">KOSIN MED · ติดตามกำหนดส่ง</div>
        </header>

        <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto overflow-x-hidden"><Outlet /></main>
      </div>
    </div>
  );
}
