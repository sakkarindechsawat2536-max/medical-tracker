import { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { auth, db, provider } from "../lib/firebase";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        const ref  = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setProfile(snap.data());
        } else {
          const p = { uid: u.uid, email: u.email, displayName: u.displayName,
            photoURL: u.photoURL, role: "sales", lineToken: "", isActive: true,
            createdAt: new Date().toISOString() };
          await setDoc(ref, p);
          setProfile(p);
        }
      } else { setUser(null); setProfile(null); }
      setLoading(false);
    });
  }, []);

  const login  = () => signInWithPopup(auth, provider);
  const logout = () => signOut(auth);
  const isAdmin     = profile?.role === "admin";
  const isManager   = ["admin","manager"].includes(profile?.role);

  // อัปเดต profile ในหน่วยความจำทันทีหลังบันทึกข้อมูลผู้ใช้ลง Firestore ที่อื่น (เช่นหน้าการแจ้งเตือน)
  // profile ที่นี่โหลดครั้งเดียวตอน login เท่านั้น ถ้าไม่เรียกฟังก์ชันนี้หลัง updateDoc ค่าที่เพิ่งบันทึกจะไม่ปรากฏ
  // จนกว่าจะออกจากระบบแล้วเข้าใหม่ — ทำให้ดูเหมือนบันทึกไม่ติดเวลาย้ายไปหน้าอื่นแล้วย้อนกลับมา
  const updateProfile = (patch) => setProfile(p => (p ? { ...p, ...patch } : p));

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, logout, isAdmin, isManager, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
