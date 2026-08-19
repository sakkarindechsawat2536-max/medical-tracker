import { useState, useEffect } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { getNotifHistory } from "../lib/firestore";

const fmt = d => d ? new Date(d?.toDate?d.toDate():d).toLocaleDateString("th-TH",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "—";

const CHANNEL_INFO = {
  line: {
    icon:"💚", title:"LINE Notify",
    desc:"รับแจ้งเตือนส่วนตัวผ่าน LINE — ฟรี ไม่จำกัดข้อความ",
    steps:[
      "เปิดลิงก์: https://notify-bot.line.me/th/",
      "Login ด้วยบัญชี LINE ของคุณ",
      "กด \"Generate token\" → ตั้งชื่อ เช่น \"KOSIN Tracker\"",
      "เลือก \"1-on-1 chat with LINE Notify\"",
      "คัดลอก Token แล้วนำมาวางในช่องด้านล่าง",
    ]
  },
  email: {
    icon:"📧", title:"Email (Gmail)",
    desc:"รับแจ้งเตือนทางอีเมล — ใช้อีเมลที่ Login อยู่",
    steps:[
      "ไม่ต้องตั้งค่าอะไรเพิ่ม",
      "ระบบจะส่งไปยังอีเมลที่ Login",
      "ตรวจสอบ Spam/Junk ถ้าไม่เจอใน Inbox",
    ]
  }
};

const SCHEDULE_OPTIONS = [
  {v:"d30", l:"30 วันก่อนกำหนด"},
  {v:"d15", l:"15 วันก่อนกำหนด"},
  {v:"d7",  l:"7 วันก่อนกำหนด"},
  {v:"d3",  l:"3 วันก่อนกำหนด"},
  {v:"d1",  l:"1 วันก่อนกำหนด"},
  {v:"overdue", l:"เกินกำหนด (ทุกวันทำการ)"},
];

export default function Notifications() {
  const { user, profile } = useAuth();
  const [lineToken,   setLineToken]   = useState(profile?.lineToken || "");
  const [emailOn,     setEmailOn]     = useState(profile?.emailNotify ?? true);
  const [lineOn,      setLineOn]      = useState(profile?.lineNotify ?? false);
  const [schedule,    setSchedule]    = useState(profile?.notifySchedule || ["d30","d15","d7","d3","d1","overdue"]);
  const [notifyTime,  setNotifyTime]  = useState(profile?.notifyTime || "08:00");
  const [history,     setHistory]     = useState([]);
  const [saving,      setSaving]      = useState(false);
  const [saved,       setSaved]       = useState(false);
  const [testSending, setTestSending] = useState(null);
  const [testDone,    setTestDone]    = useState(null);

  useEffect(()=>{
    if (user) getNotifHistory(user.uid).then(setHistory);
  },[user]);

  function toggleSchedule(v) {
    setSchedule(s => s.includes(v) ? s.filter(x=>x!==v) : [...s,v]);
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateDoc(doc(db,"users",user.uid), {
        lineToken, emailNotify:emailOn, lineNotify:lineOn,
        notifySchedule:schedule, notifyTime,
      });
      setSaved(true); setTimeout(()=>setSaved(false),2000);
    } finally { setSaving(false); }
  }

  async function handleTest(channel) {
    setTestSending(channel);
    // จำลองการส่ง — จริงๆ จะเรียก GitHub Actions / Cloud Function
    await new Promise(r=>setTimeout(r,1500));
    setTestSending(null); setTestDone(channel);
    setTimeout(()=>setTestDone(null),3000);
  }

  return (
    <div>
      <h1 className="text-2xl font-extrabold text-slate-800 mb-1">การแจ้งเตือน</h1>
      <p className="text-sm text-slate-400 mb-6">ตั้งค่าช่องทางและเวลาแจ้งเตือนกำหนดส่งของคุณ</p>

      <div className="grid grid-cols-2 gap-5 mb-5">

        {/* LINE Notify */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">💚</span>
              <span className="font-bold text-slate-800">LINE Notify</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <div className={`w-10 h-5 rounded-full transition ${lineOn?"bg-green-500":"bg-slate-200"} relative`}
                onClick={()=>setLineOn(!lineOn)}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${lineOn?"left-5":"left-0.5"}`}/>
              </div>
              <span className="text-xs font-semibold text-slate-500">{lineOn?"เปิด":"ปิด"}</span>
            </label>
          </div>
          <p className="text-xs text-slate-400 mb-4">{CHANNEL_INFO.line.desc}</p>

          {lineOn && <>
            <div className="bg-slate-50 rounded-lg p-3 mb-4">
              <div className="text-xs font-bold text-slate-600 mb-2">วิธีรับ LINE Token:</div>
              {CHANNEL_INFO.line.steps.map((s,i)=>(
                <div key={i} className="flex gap-2 text-xs text-slate-500 mb-1">
                  <span className="font-bold text-slate-400 flex-shrink-0">{i+1}.</span><span>{s}</span>
                </div>
              ))}
            </div>
            <div className="mb-3">
              <label className="text-xs font-semibold text-slate-500 block mb-1">LINE Notify Token</label>
              <input value={lineToken} onChange={e=>setLineToken(e.target.value)}
                placeholder="วางToken ที่ได้จาก LINE Notify ที่นี่"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none font-mono"/>
            </div>
            <button onClick={()=>handleTest("line")} disabled={!lineToken||testSending==="line"}
              className="w-full py-2 bg-green-50 text-green-700 font-semibold text-sm rounded-lg border border-green-200 hover:bg-green-100 cursor-pointer disabled:opacity-40 transition">
              {testSending==="line"?"กำลังส่งทดสอบ...":testDone==="line"?"✅ ส่งทดสอบสำเร็จ!":"ทดสอบส่ง LINE"}
            </button>
          </>}
        </div>

        {/* Email */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">📧</span>
              <span className="font-bold text-slate-800">Email (Gmail)</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <div className={`w-10 h-5 rounded-full transition ${emailOn?"bg-blue-500":"bg-slate-200"} relative`}
                onClick={()=>setEmailOn(!emailOn)}>
                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${emailOn?"left-5":"left-0.5"}`}/>
              </div>
              <span className="text-xs font-semibold text-slate-500">{emailOn?"เปิด":"ปิด"}</span>
            </label>
          </div>
          <p className="text-xs text-slate-400 mb-4">{CHANNEL_INFO.email.desc}</p>

          {emailOn && <>
            <div className="bg-blue-50 rounded-lg p-3 mb-4">
              <div className="text-xs font-bold text-blue-700 mb-1">📨 อีเมลปลายทาง</div>
              <div className="text-sm font-semibold text-blue-900">{profile?.email}</div>
              <div className="text-xs text-blue-500 mt-1">ใช้อีเมลที่ Login อยู่โดยอัตโนมัติ</div>
            </div>
            <div className="bg-slate-50 rounded-lg p-3 mb-4">
              <div className="text-xs font-bold text-slate-600 mb-2">ตัวอย่างข้อความที่จะได้รับ:</div>
              <div className="bg-white border border-slate-200 rounded-lg p-3 text-xs text-slate-600 leading-relaxed">
                <b>เหลืออีก 7 วันก่อนกำหนดส่ง</b><br/>
                โรงพยาบาล: รพ.ชุมพรเขตอุดมศักดิ์<br/>
                เลขที่: PL6900762 · กำหนดส่ง: 3 ส.ค. 2026<br/>
                รายการที่ยังไม่ส่ง:<br/>
                • 10101FA – Prismatic Light Deflector (คงเหลือ 1 ชิ้น)
              </div>
            </div>
            <button onClick={()=>handleTest("email")} disabled={testSending==="email"}
              className="w-full py-2 bg-blue-50 text-blue-700 font-semibold text-sm rounded-lg border border-blue-200 hover:bg-blue-100 cursor-pointer disabled:opacity-40 transition">
              {testSending==="email"?"กำลังส่งทดสอบ...":testDone==="email"?"✅ ส่งทดสอบสำเร็จ!":"ทดสอบส่ง Email"}
            </button>
          </>}
        </div>
      </div>

      {/* Schedule settings */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-5">
        <div className="font-bold text-slate-800 mb-4">⏰ กำหนดเวลาและรอบแจ้งเตือน</div>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-bold text-slate-500 mb-3">แจ้งเตือนเมื่อเหลือ:</div>
            <div className="grid gap-2">
              {SCHEDULE_OPTIONS.map(opt=>(
                <label key={opt.v} className="flex items-center gap-3 cursor-pointer group">
                  <div onClick={()=>toggleSchedule(opt.v)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition ${
                      schedule.includes(opt.v)?"bg-blue-600 border-blue-600":"border-slate-300 group-hover:border-blue-400"}`}>
                    {schedule.includes(opt.v) && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7"/></svg>}
                  </div>
                  <span className="text-sm text-slate-700">{opt.l}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold text-slate-500 mb-3">เวลาที่ส่งแจ้งเตือน:</div>
            <input type="time" value={notifyTime} onChange={e=>setNotifyTime(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm outline-none w-32"/>
            <p className="text-xs text-slate-400 mt-2">ระบบจะส่งแจ้งเตือนทุกวันเวลาที่กำหนด<br/>ผ่าน GitHub Actions (ฟรี)</p>
            <div className="mt-4 bg-amber-50 rounded-lg p-3">
              <div className="text-xs font-bold text-amber-700 mb-1">🔒 ป้องกันแจ้งซ้ำ</div>
              <div className="text-xs text-amber-600">ระบบบันทึกประวัติว่าเคยแจ้งเตือนช่วงไหนแล้ว<br/>จะไม่ส่งข้อความซ้ำในวันเดียวกัน</div>
            </div>
          </div>
        </div>
      </div>

      {/* Save button */}
      <div className="flex gap-3 justify-end mb-8">
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 bg-slate-800 text-white rounded-lg font-semibold text-sm cursor-pointer hover:bg-slate-700 disabled:opacity-50 transition">
          {saving?"กำลังบันทึก...":saved?"✅ บันทึกแล้ว":"บันทึกการตั้งค่า"}
        </button>
      </div>

      {/* Notification history */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 font-bold text-slate-800">
          ประวัติการแจ้งเตือน
        </div>
        {history.length===0
          ? <div className="px-5 py-8 text-center text-slate-400 text-sm">ยังไม่มีประวัติการแจ้งเตือน</div>
          : <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {["วันเวลา","ช่องทาง","ใบสั่งซื้อ","ประเภท"].map(h=>(
                  <th key={h} className="text-left px-4 py-3 text-xs font-bold text-slate-400">{h}</th>
                ))}
              </tr></thead>
              <tbody>{history.map(h=>(
                <tr key={h.id} className="border-b border-slate-50">
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmt(h.sentAt)}</td>
                  <td className="px-4 py-3">{h.channel==="line"?"💚 LINE":"📧 Email"}</td>
                  <td className="px-4 py-3 font-bold text-blue-900 text-xs">{h.orderId?.slice(0,8)}...</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{h.type}</td>
                </tr>
              ))}</tbody>
            </table>
        }
      </div>
    </div>
  );
}
