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

  return (
    <AuthContext.Provider value={{ user, profile, loading, login, logout, isAdmin, isManager }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
