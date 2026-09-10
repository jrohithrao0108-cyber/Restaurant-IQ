"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  Eye,
  EyeOff,
  Info,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Store,
  Wifi,
  Zap,
} from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type Role = "SUPER_ADMIN" | "ADMIN" | "POC";

export type CurrentUser = {
  id: string;
  name: string;
  phone: string;
  role: Role;
  restaurantId: string | null;
  restaurantName: string;
};

type UserRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  role: Role;
  restaurant_id: string | null;
  is_active: boolean;
  auth_user_id?: string;
  restaurants?: {
    name: string;
  } | null;
};

export function ModernLogin({
  onLogin,
}: {
  onLogin: (u: CurrentUser) => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [checking, setChecking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedRoleHint, setSelectedRoleHint] = useState<Role>("ADMIN");

  function performDemoLogin(forcedRole?: Role) {
    const roleToUse = forcedRole || selectedRoleHint;
    let demoUser: CurrentUser;

    if (roleToUse === "POC" || email.toLowerCase().includes("poc")) {
      demoUser = {
        id: "demo-poc-user",
        name: "Ramesh (POC Cashier)",
        phone: "9876543210",
        role: "POC",
        restaurantId: "demo-restaurant-1",
        restaurantName: "The Grand Rasoi",
      };
    } else if (
      roleToUse === "SUPER_ADMIN" ||
      email.toLowerCase().includes("super")
    ) {
      demoUser = {
        id: "demo-superadmin-user",
        name: "Platform SuperAdmin",
        phone: "9876543212",
        role: "SUPER_ADMIN",
        restaurantId: null,
        restaurantName: "Platform",
      };
    } else {
      demoUser = {
        id: "demo-admin-user",
        name: "Rohith",
        phone: "9876543211",
        role: "ADMIN",
        restaurantId: "demo-restaurant-1",
        restaurantName: "Shubham",
      };
    }

    try {
      localStorage.setItem("restaurant_iq_user", JSON.stringify(demoUser));
    } catch (e) {}

    onLogin(demoUser);
  }

  async function handleLogin() {
    setErrorMessage(null);

    // If Supabase backend is not configured in .env.local, log in via Demo Mode directly
    if (!isSupabaseConfigured) {
      performDemoLogin();
      return;
    }

    if (!email.trim() || !password) {
      setErrorMessage("Please enter both your email address and password.");
      return;
    }

    setChecking(true);

    try {
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });

      if (authError) {
        throw authError;
      }

      if (!authData.user) {
        throw new Error(
          "Could not verify your credentials with authentication service."
        );
      }

      const { data, error } = await supabase
        .from("users")
        .select(`
          id,
          name,
          phone,
          email,
          role,
          restaurant_id,
          is_active,
          restaurants (
            name
          )
        `)
        .eq("auth_user_id", authData.user.id)
        .maybeSingle();

      if (error) {
        throw error;
      }

      if (!data) {
        throw new Error(
          "Your login account is not linked to a Restaurant profile. Please contact your Super Administrator."
        );
      }

      const row = data as unknown as UserRow;

      if (row.is_active === false) {
        await supabase.auth.signOut();
        throw new Error(
          "This account has been deactivated. Please contact your administrator for access."
        );
      }

      const userObj: CurrentUser = {
        id: row.id,
        name: row.name,
        phone: row.phone || "",
        role: row.role,
        restaurantId: row.restaurant_id,
        restaurantName: row.restaurants?.name || "",
      };

      try {
        localStorage.setItem("restaurant_iq_user", JSON.stringify(userObj));
      } catch (e) {}

      onLogin(userObj);
    } catch (err: any) {
      console.error("LOGIN ERROR:", err);

      const isNetworkIssue =
        err?.message?.includes("Failed to fetch") ||
        err?.name === "AuthRetryableFetchError" ||
        err?.message?.includes("NetworkError");

      if (isNetworkIssue) {
        setErrorMessage(
          "Could not reach Supabase backend (Failed to fetch). Live database is offline or unconfigured. Use Demo Sign In below to test the app."
        );
      } else {
        setErrorMessage(
          err?.message ||
            "Invalid email or password. Please check your credentials."
        );
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="modern-login-wrapper">
      {/* Background ambient lighting */}
      <div className="ambient-glow glow-1" />
      <div className="ambient-glow glow-2" />

      <div className="login-container">
        {/* LEFT COLUMN: BRAND HERO SHOWCASE */}
        <div className="brand-showcase-panel">
          <div className="showcase-content">
            <div className="brand-pill">
              <Sparkles size={14} className="pill-icon" />
              <span>Next-Gen Restaurant OS</span>
            </div>

            <div className="brand-header">
              <div className="brand-logo-square">
                <span>R</span>
              </div>
              <h1>RestaurantIQ</h1>
            </div>

            <p className="brand-tagline">
              The high-speed restaurant management system built for rapid counter
              billing, kitchen order routing, and real-time business intelligence.
            </p>

            {/* Feature Badges */}
            <div className="feature-list">
              <div className="feature-item">
                <div className="feature-icon-box orange">
                  <Zap size={18} />
                </div>
                <div>
                  <strong>RestaurantIQ Rapid POS</strong>
                  <p>
                    3-click order punching, instant KOT printing, and multi-mode
                    settlements.
                  </p>
                </div>
              </div>

              <div className="feature-item">
                <div className="feature-icon-box purple">
                  <BarChart3 size={18} />
                </div>
                <div>
                  <strong>Real-Time Analytics</strong>
                  <p>
                    Hourly sales velocity, revenue trends, top-selling items, and
                    table KPIs.
                  </p>
                </div>
              </div>

              <div className="feature-item">
                <div className="feature-icon-box green">
                  <Wifi size={18} />
                </div>
                <div>
                  <strong>Offline Resilience</strong>
                  <p>
                    Keep punching orders even during internet cuts; auto-syncs when
                    reconnected.
                  </p>
                </div>
              </div>
            </div>

            <div className="showcase-footer">
              <div className="ssl-badge">
                <ShieldCheck size={16} />
                <span>Enterprise grade security & encrypted data</span>
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: AUTHENTICATION CARD */}
        <div className="login-card-panel">
          <div className="card-header">
            <div className="mobile-brand">
              <div className="brand-logo-square small">R</div>
              <b>RestaurantIQ</b>
            </div>
            <h2>Sign In to Terminal</h2>
            <p>Select your role or enter credentials to access your dashboard</p>
          </div>

          {/* Database Status Alert if not configured */}
          {!isSupabaseConfigured && (
            <div className="offline-mode-note">
              <Info size={15} />
              <span>
                Demo Mode Active: No live Supabase URL detected. You can sign in
                instantly without a database connection.
              </span>
            </div>
          )}

          {/* Role guidance pills */}
          <div className="role-selector-bar">
            <span className="role-selector-label">Active Role:</span>
            <div className="role-pills">
              <button
                type="button"
                className={`role-pill ${
                  selectedRoleHint === "POC" ? "active" : ""
                }`}
                onClick={() => setSelectedRoleHint("POC")}
              >
                <Zap size={13} />
                <span>POC (Billing Terminal)</span>
              </button>

              <button
                type="button"
                className={`role-pill ${
                  selectedRoleHint === "ADMIN" ? "active" : ""
                }`}
                onClick={() => setSelectedRoleHint("ADMIN")}
              >
                <BarChart3 size={13} />
                <span>Admin (Analytics)</span>
              </button>

              <button
                type="button"
                className={`role-pill ${
                  selectedRoleHint === "SUPER_ADMIN" ? "active" : ""
                }`}
                onClick={() => setSelectedRoleHint("SUPER_ADMIN")}
              >
                <Store size={13} />
                <span>Super Admin</span>
              </button>
            </div>
          </div>

          {/* Inline Error Alert */}
          {errorMessage && (
            <div className="error-alert-banner">
              <AlertCircle size={18} className="alert-icon" />
              <div className="alert-text">
                {errorMessage}
                {errorMessage.includes("Failed to fetch") && (
                  <button
                    type="button"
                    className="demo-fallback-link"
                    onClick={() => performDemoLogin()}
                  >
                    ⚡ Click here to proceed with Demo Mode ({selectedRoleHint})
                  </button>
                )}
              </div>
              <button
                className="close-alert-btn"
                onClick={() => setErrorMessage(null)}
                title="Dismiss"
              >
                ×
              </button>
            </div>
          )}

          {/* Login Form */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            className="auth-form"
          >
            {/* Email Field */}
            <div className="form-group">
              <label htmlFor="login-email">Email Address</label>
              <div className="input-wrapper">
                <Mail size={16} className="field-icon" />
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder={
                    selectedRoleHint === "POC"
                      ? "poc@restaurant.com"
                      : selectedRoleHint === "ADMIN"
                      ? "admin@restaurant.com"
                      : "superadmin@platform.com"
                  }
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password Field */}
            <div className="form-group">
              <div className="label-row">
                <label htmlFor="login-password">Password</label>
              </div>
              <div className="input-wrapper">
                <Lock size={16} className="field-icon" />
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errorMessage) setErrorMessage(null);
                  }}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="pwd-toggle-btn"
                  onClick={() => setShowPassword((prev) => !prev)}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              className="submit-login-btn"
              disabled={checking}
            >
              {checking ? (
                <>
                  <Loader2 size={18} className="spinner" />
                  <span>Verifying Credentials...</span>
                </>
              ) : (
                <>
                  <span>
                    Sign In as {selectedRoleHint === "POC" ? "POC" : selectedRoleHint === "ADMIN" ? "Admin" : "Super Admin"}
                  </span>
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>

          {/* Quick Demo Shortcuts */}
          <div className="demo-shortcuts">
            <div className="demo-divider">
              <span>OR 1-CLICK DEMO ACCESS</span>
            </div>

            <div className="demo-buttons-grid">
              <button
                type="button"
                className="demo-quick-btn admin primary-highlight"
                onClick={() => performDemoLogin("ADMIN")}
              >
                <BarChart3 size={14} />
                <span>Open Analytics (Admin)</span>
              </button>

              <button
                type="button"
                className="demo-quick-btn poc"
                onClick={() => performDemoLogin("POC")}
              >
                <Zap size={14} />
                <span>Open POS Terminal (POC)</span>
              </button>
            </div>
          </div>

          {/* Footer Guidance */}
          <div className="card-footer-info">
            <p>
              To connect a live cloud database, configure <code>.env.local</code>{" "}
              with your Supabase project credentials.
            </p>
          </div>
        </div>
      </div>

      <style jsx>{`
        .modern-login-wrapper {
          min-height: 100vh;
          width: 100%;
          background: #090d16;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          position: relative;
          overflow: hidden;
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }

        .ambient-glow {
          position: absolute;
          border-radius: 50%;
          filter: blur(120px);
          pointer-events: none;
          opacity: 0.25;
        }

        .glow-1 {
          width: 500px;
          height: 500px;
          background: #3b82f6;
          top: -100px;
          left: -100px;
        }

        .glow-2 {
          width: 600px;
          height: 600px;
          background: #6366f1;
          bottom: -150px;
          right: -100px;
        }

        .login-container {
          position: relative;
          z-index: 10;
          width: 100%;
          max-width: 1040px;
          min-height: 600px;
          background: #0f172a;
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 24px;
          box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.7),
            0 0 0 1px rgba(255, 255, 255, 0.05);
          display: grid;
          grid-template-columns: 1.15fr 1fr;
          overflow: hidden;
        }

        .brand-showcase-panel {
          background: linear-gradient(
            145deg,
            rgba(30, 27, 75, 0.6) 0%,
            rgba(15, 23, 42, 0.8) 100%
          );
          border-right: 1px solid rgba(255, 255, 255, 0.08);
          padding: 48px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          position: relative;
        }

        .showcase-content {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .brand-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: rgba(99, 102, 241, 0.15);
          border: 1px solid rgba(99, 102, 241, 0.3);
          color: #a5b4fc;
          padding: 5px 12px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 600;
          width: fit-content;
        }

        .pill-icon {
          color: #f59e0b;
        }

        .brand-header {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .brand-logo-square {
          width: 44px;
          height: 44px;
          background: linear-gradient(135deg, #6366f1, #3b82f6);
          border-radius: 12px;
          display: grid;
          place-items: center;
          color: #ffffff;
          font-size: 22px;
          font-weight: 900;
          box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
        }

        .brand-logo-square.small {
          width: 32px;
          height: 32px;
          font-size: 16px;
          border-radius: 8px;
        }

        .brand-header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 900;
          letter-spacing: -0.02em;
          background: linear-gradient(135deg, #ffffff 30%, #cbd5e1 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .brand-tagline {
          margin: 0;
          color: #94a3b8;
          font-size: 14px;
          line-height: 1.6;
        }

        .feature-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin: 10px 0;
        }

        .feature-item {
          display: flex;
          align-items: flex-start;
          gap: 12px;
        }

        .feature-icon-box {
          width: 36px;
          height: 36px;
          border-radius: 10px;
          display: grid;
          place-items: center;
          flex-shrink: 0;
        }

        .feature-icon-box.orange {
          background: rgba(245, 158, 11, 0.15);
          color: #f59e0b;
        }

        .feature-icon-box.purple {
          background: rgba(168, 85, 247, 0.15);
          color: #c084fc;
        }

        .feature-icon-box.green {
          background: rgba(16, 185, 129, 0.15);
          color: #34d399;
        }

        .feature-item strong {
          display: block;
          color: #f1f5f9;
          font-size: 13px;
          font-weight: 600;
        }

        .feature-item p {
          margin: 2px 0 0;
          color: #64748b;
          font-size: 12px;
          line-height: 1.4;
        }

        .showcase-footer {
          margin-top: 10px;
          padding-top: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }

        .ssl-badge {
          display: flex;
          align-items: center;
          gap: 6px;
          color: #64748b;
          font-size: 12px;
        }

        /* RIGHT: AUTH CARD */
        .login-card-panel {
          background: #ffffff;
          padding: 40px;
          display: flex;
          flex-direction: column;
          justify-content: center;
        }

        .card-header {
          margin-bottom: 16px;
        }

        .mobile-brand {
          display: none;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          font-size: 18px;
          color: #0f172a;
        }

        .card-header h2 {
          margin: 0;
          font-size: 24px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -0.02em;
        }

        .card-header p {
          margin: 6px 0 0;
          color: #64748b;
          font-size: 13px;
        }

        .offline-mode-note {
          display: flex;
          align-items: center;
          gap: 8px;
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #15803d;
          font-size: 12px;
          padding: 8px 12px;
          border-radius: 8px;
          margin-bottom: 16px;
          line-height: 1.4;
        }

        .role-selector-bar {
          margin-bottom: 16px;
        }

        .role-selector-label {
          display: block;
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #64748b;
          margin-bottom: 6px;
        }

        .role-pills {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .role-pill {
          display: flex;
          align-items: center;
          gap: 5px;
          padding: 6px 10px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          font-size: 11px;
          font-weight: 600;
          color: #475569;
          cursor: pointer;
          transition: all 0.15s;
        }

        .role-pill.active {
          background: #0f172a;
          color: #ffffff;
          border-color: #0f172a;
        }

        .error-alert-banner {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          background: #fef2f2;
          border: 1px solid #fecaca;
          border-radius: 10px;
          padding: 12px 14px;
          color: #b91c1c;
          font-size: 13px;
          margin-bottom: 16px;
          animation: slideDown 0.2s ease-out;
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-6px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .alert-icon {
          flex-shrink: 0;
          margin-top: 1px;
        }

        .alert-text {
          flex: 1;
          line-height: 1.4;
        }

        .demo-fallback-link {
          display: block;
          margin-top: 8px;
          background: #b91c1c;
          color: #ffffff;
          border: none;
          padding: 6px 10px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
        }

        .close-alert-btn {
          border: none;
          background: transparent;
          color: #b91c1c;
          font-size: 18px;
          font-weight: 700;
          cursor: pointer;
          line-height: 1;
        }

        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .form-group label {
          font-size: 12px;
          font-weight: 600;
          color: #334155;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .field-icon {
          position: absolute;
          left: 14px;
          color: #94a3b8;
          pointer-events: none;
        }

        .input-wrapper input {
          width: 100%;
          padding: 11px 40px 11px 40px;
          background: #ffffff;
          border: 1.5px solid #e2e8f0;
          border-radius: 10px;
          font-size: 13px;
          color: #0f172a;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }

        .input-wrapper input:focus {
          border-color: #2563eb;
          box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
        }

        .pwd-toggle-btn {
          position: absolute;
          right: 12px;
          border: none;
          background: transparent;
          color: #94a3b8;
          cursor: pointer;
          display: grid;
          place-items: center;
        }

        .pwd-toggle-btn:hover {
          color: #475569;
        }

        .submit-login-btn {
          margin-top: 4px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 12px;
          background: #0f172a;
          color: #ffffff;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
          transition: background 0.15s, transform 0.1s;
        }

        .submit-login-btn:hover:not(:disabled) {
          background: #1e293b;
        }

        .submit-login-btn:active:not(:disabled) {
          transform: scale(0.99);
        }

        .submit-login-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .spinner {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }

        /* Demo Shortcuts */
        .demo-shortcuts {
          margin-top: 18px;
        }

        .demo-divider {
          display: flex;
          align-items: center;
          text-align: center;
          margin-bottom: 12px;
        }

        .demo-divider::before,
        .demo-divider::after {
          content: "";
          flex: 1;
          border-bottom: 1px solid #e2e8f0;
        }

        .demo-divider span {
          padding: 0 10px;
          color: #94a3b8;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 0.05em;
        }

        .demo-buttons-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }

        .demo-quick-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 9px 8px;
          border-radius: 8px;
          border: 1px solid;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          transition: all 0.15s;
        }

        .demo-quick-btn.poc {
          background: #eff6ff;
          border-color: #bfdbfe;
          color: #1d4ed8;
        }

        .demo-quick-btn.poc:hover {
          background: #dbeafe;
        }

        .demo-quick-btn.admin {
          background: #fdf4ff;
          border-color: #f5d0fe;
          color: #86198f;
        }

        .demo-quick-btn.admin:hover {
          background: #fae8ff;
        }

        .card-footer-info {
          margin-top: 18px;
          text-align: center;
        }

        .card-footer-info p {
          margin: 0;
          font-size: 11px;
          color: #94a3b8;
          line-height: 1.5;
        }

        .card-footer-info code {
          background: #f1f5f9;
          padding: 2px 4px;
          border-radius: 4px;
          color: #475569;
        }

        @media (max-width: 900px) {
          .login-container {
            grid-template-columns: 1fr;
            max-width: 480px;
          }

          .brand-showcase-panel {
            display: none;
          }

          .mobile-brand {
            display: flex;
          }

          .login-card-panel {
            padding: 32px 24px;
          }
        }
      `}</style>
    </div>
  );
}
