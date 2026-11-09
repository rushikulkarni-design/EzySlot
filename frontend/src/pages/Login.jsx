
import React, { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiErr } from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Radio, Loader2, ArrowLeft, ShieldCheck } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);

    try {
      const u = await login(email, password);
      navigate(u.role === "developer" ? "/ops" : "/app");
    } catch (e2) {
      setErr(apiErr(e2));
    } finally {
      setLoading(false);
    }
  };

  const quick = (em, pw) => {
    setEmail(em);
    setPassword(pw);
    setErr("");
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-white px-4 py-10 text-slate-800">
      {/* Warm white-and-orange background */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 15% 15%, rgba(255,90,31,0.10), transparent 38%), radial-gradient(ellipse at 90% 85%, rgba(255,145,77,0.12), transparent 35%)",
        }}
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 -top-24 h-80 w-80 rounded-full bg-orange-100/60 blur-3xl"
      />

      <div className="relative z-10 w-full max-w-md">
        <Link
          to="/"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition-colors hover:text-orange-600"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to site
        </Link>

        <section className="rounded-2xl border border-orange-100 bg-white p-6 shadow-xl shadow-orange-900/5 sm:p-8">
          {/* Brand */}
          <div className="mb-8 flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-500/20">
              <Radio className="h-6 w-6" />
            </div>

            <div>
              <div className="font-display text-2xl font-bold tracking-tight text-slate-900">
                EzySlot<span className="text-orange-500">.AI</span>
              </div>
              <div className="mt-1 font-mono text-xs uppercase tracking-[0.2em] text-orange-600">
                Portal Access
              </div>
            </div>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Welcome back
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Sign in to manage your parking operations.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="login-email"
                className="text-sm font-medium text-slate-700"
              >
                Email address
              </label>
              <Input
                id="login-email"
                required
                type="email"
                data-testid="login-email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="username"
                className="h-11 border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-orange-500"
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="login-password"
                className="text-sm font-medium text-slate-700"
              >
                Password
              </label>
              <Input
                id="login-password"
                required
                type="password"
                data-testid="login-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-11 border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus-visible:ring-orange-500"
              />
            </div>

            {err && (
              <p
                data-testid="login-error"
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700"
              >
                {err}
              </p>
            )}

            <Button
              type="submit"
              disabled={loading}
              data-testid="login-submit"
              className="h-11 w-full bg-orange-500 font-semibold text-white shadow-md shadow-orange-500/20 transition-colors hover:bg-orange-600 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing in...
                </>
              ) : (
                "Sign in"
              )}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-400">
              Quick access
            </span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="space-y-3">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-500">
              <ShieldCheck className="h-4 w-4 text-orange-500" />
              Demo accounts
            </p>

            <button
              type="button"
              data-testid="demo-dev-btn"
              onClick={() =>
                quick("revati031004@gmail.com", "EzySlot@2025")
              }
              className="group flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-all hover:border-orange-300 hover:bg-orange-50"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-800">
                  Developer
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Operations portal
                </span>
              </span>
              <span className="text-sm font-semibold text-orange-600 transition-transform group-hover:translate-x-1">
                Use →
              </span>
            </button>

            <button
              type="button"
              data-testid="demo-client-btn"
              onClick={() =>
                quick("client@metromall.com", "Client@2025")
              }
              className="group flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition-all hover:border-orange-300 hover:bg-orange-50"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-800">
                  Client
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  Metro Mall portal
                </span>
              </span>
              <span className="text-sm font-semibold text-orange-600 transition-transform group-hover:translate-x-1">
                Use →
              </span>
            </button>
          </div>
        </section>

        <p className="mt-5 text-center text-xs text-slate-400">
          EzySlot.AI · Smart parking management
        </p>
      </div>
    </main>
  );
}
