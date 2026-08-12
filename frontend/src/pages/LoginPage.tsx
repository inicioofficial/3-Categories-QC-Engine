import type { FormEvent } from "react";
import { useState } from "react";
import { Eye, EyeOff, LockKeyhole, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useAuth } from "@/app/auth";
import { AppFooter } from "@/components/layout/AppFooter";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(username, password);
      navigate("/workspace-select", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid username or password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-900">
      <img
        src="/login-hero-4seasons.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-[57%_center] md:object-center"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(15,23,42,0.10)_0%,rgba(15,23,42,0.04)_48%,rgba(248,250,252,0.42)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-slate-950/55 to-transparent" />
      <div className="pointer-events-none absolute left-1/2 top-5 z-10 flex -translate-x-1/2 flex-col items-center">
        <img
          src="/laptop%20(1).png"
          alt=""
          aria-hidden="true"
          className="h-24 w-44 object-contain sm:h-28 sm:w-56"
        />
        <p className="mt-2 rounded-full bg-white/72 px-4 py-1 text-xs font-black uppercase tracking-[0.24em] text-slate-950 shadow-[0_10px_24px_rgba(15,23,42,0.16)] backdrop-blur-md">
          INICIO INSIGHTS
        </p>
      </div>

      <main className="relative z-20 flex h-screen flex-col">
        <div className="relative flex min-h-0 flex-1 items-center justify-center px-5 pb-4 pt-32 lg:justify-end lg:px-[6vw]">
          <section
            style={{ width: "min(420px, calc(100vw - 40px))" }}
            className="rounded-[28px] border border-white/80 bg-white/82 p-6 text-slate-950 shadow-[0_28px_80px_rgba(15,23,42,0.20)] backdrop-blur-xl transition-colors sm:p-8"
          >
            <div className="mb-7 rounded-[20px] border border-sky-100 bg-white/76 px-5 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              <p
                className="text-[28px] font-black leading-none tracking-[-0.035em] text-slate-950"
              >
                4 Seasons-End-End-Platform
              </p>
              <p
                className="mt-2 text-xs font-extrabold uppercase tracking-[0.22em] text-sky-700"
              >
                Quality Control Explorer
              </p>
            </div>

            <div className="mb-5 flex items-center justify-between">
              <h1 className="text-[30px] font-semibold leading-none tracking-[-0.035em] text-slate-950">
                Sign in
              </h1>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="username" className="block text-[13px] font-semibold text-slate-700">
                  Username
                </label>
                <div className="relative">
                  <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-700" />
                  <input
                    id="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="Enter your username"
                    autoComplete="username"
                    className="login-field login-field-light"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-[13px] font-semibold text-slate-700">
                  Password
                </label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-700" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    className="login-field login-field-light pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((currentValue) => !currentValue)}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-full text-slate-900 transition hover:bg-slate-200"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error ? (
                <p className="flex min-h-[38px] items-center gap-2 rounded-[6px] border border-red-200 bg-red-50 px-3 text-[13px] text-red-600">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-red-400 text-[13px] font-semibold">!</span>
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={submitting}
                className="flex h-[42px] w-full items-center justify-center gap-2 rounded-[5px] bg-[#2563eb] text-[15px] font-semibold text-white shadow-[0_12px_26px_rgba(37,99,235,0.24)] transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LockKeyhole className="h-4 w-4" />
                {submitting ? "Opening workspace..." : "Login"}
              </button>

              <div className="pt-1 text-center">
                <button
                  type="button"
                  className="text-[13px] font-medium text-sky-700 transition hover:text-sky-950"
                >
                  Forgot password?
                </button>
              </div>
            </form>
          </section>
        </div>

        <AppFooter className="flex h-14 items-center justify-center bg-transparent pt-0 text-white/90 drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]" />
      </main>
    </div>
  );
}
