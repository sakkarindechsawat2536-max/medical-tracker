import { useAuth } from "../context/AuthContext";
export default function Login() {
  const { login } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm text-center border border-slate-200">
        <div className="text-xs font-bold tracking-widest text-slate-400 mb-1">KOSIN MED</div>
        <h1 className="text-2xl font-extrabold text-slate-800 leading-tight mb-1">ระบบติดตาม<br/>กำหนดส่งสินค้า</h1>
        <p className="text-sm text-slate-400 mb-8">เข้าสู่ระบบด้วยบัญชี Google ของบริษัท</p>
        <button onClick={login}
          className="w-full flex items-center justify-center gap-3 border border-slate-200 rounded-xl px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50 transition cursor-pointer">
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" />
          เข้าสู่ระบบด้วย Google
        </button>
        <p className="text-xs text-slate-300 mt-8">Medical Supply Co., Ltd. · Internal System</p>
      </div>
    </div>
  );
}
