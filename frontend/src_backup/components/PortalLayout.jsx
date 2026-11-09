import React from "react";
import { NavLink, useNavigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "./ui/button";
import { LogOut, Radio, ShieldCheck } from "lucide-react";

export default function PortalLayout({ nav, title, badge }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const doLogout = async () => { await logout(); navigate("/login"); };

  return (
    <div className="flex min-h-screen bg-sp-bg text-sp-text">
      <aside className="hidden w-64 flex-shrink-0 flex-col border-r border-sp-border bg-sp-card/60 md:flex">
        <div className="flex items-center gap-2 border-b border-sp-border px-6 py-5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-sp-accent text-sp-bg glow-accent">
            <Radio className="h-5 w-5" />
          </div>
          <div>
            <div className="font-display text-xl font-bold leading-none tracking-wide">EzySlot</div>
            <div className="font-mono text-[10px] uppercase tracking-widest text-sp-accent">{badge}</div>
          </div>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} data-testid={`nav-${n.testid}`}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive ? "bg-sp-accent/15 text-sp-accent glow-accent" : "text-sp-sub hover:bg-sp-cardh hover:text-white"
                }`}>
              <n.icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-sp-border p-3">
          <div className="mb-2 truncate rounded-lg bg-sp-cardh/60 px-3 py-2 text-xs">
            <div className="font-medium text-white">{user?.name}</div>
            <div className="truncate text-sp-sub">{user?.email}</div>
          </div>
          <Button data-testid="logout-btn" onClick={doLogout} variant="outline"
            className="w-full border-sp-border text-sp-sub hover:text-white">
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-sp-border bg-sp-card/40 px-4 py-3 md:px-8">
          <div className="flex items-center gap-2">
            <span className="font-display text-2xl font-bold tracking-wide">{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1.5 rounded-full border border-sp-border px-3 py-1 font-mono text-xs text-sp-free sm:flex">
              <ShieldCheck className="h-3.5 w-3.5" /> {user?.role}
            </span>
          </div>
        </header>
        {/* Mobile nav */}
        <nav className="flex gap-1 overflow-x-auto border-b border-sp-border bg-sp-card/40 px-2 py-2 md:hidden">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium ${
                  isActive ? "bg-sp-accent/15 text-sp-accent" : "text-sp-sub"
                }`}>
              <n.icon style={{ width: 14, height: 14 }} /> {n.label}
            </NavLink>
          ))}
        </nav>
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
