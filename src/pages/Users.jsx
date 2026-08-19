import { useState, useEffect } from "react";
import { getUsers, updateUserRole, updateUserActive } from "../lib/firestore";
import { useAuth } from "../context/AuthContext";

const ROLES = [{v:"admin",l:"ผู้ดูแลระบบ"},{v:"manager",l:"ผู้จัดการ"},{v:"sales",l:"พนักงานขาย"},{v:"warehouse",l:"คลังสินค้า"}];
const ROLE_COLOR = {admin:"#DC2626",manager:"#2563EB",sales:"#1B2B4B",warehouse:"#0D9488"};

export default function Users() {
  const { user:me, isAdmin } = useAuth();
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(null);

  useEffect(()=>{ getUsers().then(u=>{setUsers(u);setLoading(false);}); },[]);

  async function changeRole(uid, role) {
    setSaving(uid+"role");
    await updateUserRole(uid, role);
    setUsers(u=>u.map(x=>x.id===uid?{...x,role}:x));
    setSaving(null);
  }

  async function toggleActive(uid, isActive) {
    setSaving(uid+"active");
    await updateUserActive(uid, !isActive);
    setUsers(u=>u.map(x=>x.id===uid?{...x,isActive:!isActive}:x));
    setSaving(null);
  }

  if (!isAdmin) return <div className="text-red-500 text-sm">ไม่มีสิทธิ์เข้าถึงหน้านี้</div>;

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">ผู้ใช้งานและสิทธิ์</h1>
          <p className="text-sm text-slate-400 mt-1">{users.length} บัญชีในระบบ</p>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 text-sm text-amber-700">
        <b>วิธีเพิ่มผู้ใช้งาน:</b> ให้พนักงานเปิด URL ของระบบแล้ว Login ด้วย Google — ระบบจะสร้างบัญชีอัตโนมัติ (สิทธิ์ sales)
        จากนั้น admin เปลี่ยนสิทธิ์ได้ที่นี่
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? <div className="p-8 text-center text-slate-400">กำลังโหลด...</div>
        : <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b-2 border-slate-200">
              {["ชื่อ","อีเมล","บทบาท","LINE Notify","สถานะ","จัดการ"].map(h=>(
                <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400">{h}</th>
              ))}
            </tr></thead>
            <tbody>{users.map(u=>(
              <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {u.photoURL && <img src={u.photoURL} className="w-7 h-7 rounded-full"/>}
                    <div>
                      <div className="font-semibold text-slate-800">{u.displayName}</div>
                      {u.id===me?.uid && <div className="text-xs text-blue-500">(คุณ)</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">{u.email}</td>
                <td className="px-4 py-3">
                  {u.id===me?.uid
                    ? <span className="text-xs font-bold px-2 py-1 rounded-full" style={{background:`${ROLE_COLOR[u.role]}20`,color:ROLE_COLOR[u.role]}}>
                        {ROLES.find(r=>r.v===u.role)?.l}
                      </span>
                    : <select value={u.role} onChange={e=>changeRole(u.id,e.target.value)}
                        disabled={saving===u.id+"role"}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none cursor-pointer"
                        style={{color:ROLE_COLOR[u.role]}}>
                        {ROLES.map(r=><option key={r.v} value={r.v}>{r.l}</option>)}
                      </select>
                  }
                </td>
                <td className="px-4 py-3 text-center">
                  {u.lineToken ? <span className="text-green-500 text-xs font-bold">✅ ผูกแล้ว</span>
                               : <span className="text-slate-300 text-xs">ยังไม่ผูก</span>}
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-bold ${u.isActive?"text-teal-600":"text-slate-400"}`}>
                    {u.isActive?"● ใช้งาน":"○ ปิด"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {u.id!==me?.uid && (
                    <button onClick={()=>toggleActive(u.id,u.isActive)}
                      disabled={saving===u.id+"active"}
                      className={`text-xs font-semibold px-3 py-1.5 rounded-lg cursor-pointer transition ${
                        u.isActive?"bg-red-50 text-red-600 hover:bg-red-100":"bg-teal-50 text-teal-600 hover:bg-teal-100"}`}>
                      {saving===u.id+"active"?"...":u.isActive?"ปิดบัญชี":"เปิดบัญชี"}
                    </button>
                  )}
                </td>
              </tr>
            ))}</tbody>
          </table>
        }
      </div>
    </div>
  );
}
