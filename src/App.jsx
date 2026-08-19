import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute  from "./components/ProtectedRoute";
import Layout          from "./components/Layout";
import Login           from "./pages/Login";
import Dashboard       from "./pages/Dashboard";
import Orders          from "./pages/Orders";
import OrderDetail     from "./pages/OrderDetail";
import UploadPDF       from "./pages/UploadPDF";
import Calendar        from "./pages/Calendar";
import History         from "./pages/History";
import Notifications   from "./pages/Notifications";
import Users           from "./pages/Users";

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login/>}/>
          <Route path="/" element={<ProtectedRoute><Layout/></ProtectedRoute>}>
            <Route index              element={<Dashboard/>}/>
            <Route path="orders"      element={<Orders/>}/>
            <Route path="orders/:id"  element={<OrderDetail/>}/>
            <Route path="upload"      element={<UploadPDF/>}/>
            <Route path="calendar"    element={<Calendar/>}/>
            <Route path="history"     element={<History/>}/>
            <Route path="notify"      element={<Notifications/>}/>
            <Route path="users"       element={<Users/>}/>
          </Route>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
