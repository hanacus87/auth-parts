import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Callback } from "@auth-parts/auth-container-react";
import { Home } from "./pages/Home";
import { Dashboard } from "./pages/Dashboard";
import { NotFound } from "./pages/NotFound";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/callback" element={<Callback />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
