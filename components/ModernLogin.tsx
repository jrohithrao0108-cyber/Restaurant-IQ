"use client";

import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { supabase } from "@/lib/supabase";

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

  async function handleLogin() {
    setErrorMessage(null);

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
      console.warn("LOGIN ERROR:", err);

      const isNetworkIssue =
        err?.message?.includes("Failed to fetch") ||
        err?.name === "AuthRetryableFetchError" ||
        err?.message?.includes("NetworkError");

      if (isNetworkIssue) {
        setErrorMessage(
          "Could not reach the server. Please check your connection and try again."
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
      <div className="login-card">
        {/* BRAND HEADER */}
        <div className="brand-box">
          <div className="logo-badge">
            <img src="/logo.png" alt="RestaurantIQ" className="login-logo-img" />
          </div>
          <div className="brand-text">
            <h1 className="brand-name">RestaurantIQ</h1>
            <span className="brand-badge">Restaurant POS & Intelligence</span>
          </div>
        </div>

        {/* ERROR NOTIFICATION */}
        {errorMessage && (
          <div className="error-alert">
            <AlertCircle size={16} className="error-icon" />
            <div className="error-content">
              <span>{errorMessage}</span>
            </div>
          </div>
        )}

        {/* LOGIN FORM */}
        <form
          className="login-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin();
          }}
        >
          <div className="input-group">
            <label htmlFor="login-email">Email or User ID</label>
            <div className="input-wrap">
              <Mail size={16} className="input-icon" />
              <input
                id="login-email"
                type="text"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@restaurant.com"
                autoComplete="username"
                disabled={checking}
              />
            </div>
          </div>

          <div className="input-group">
            <label htmlFor="login-password">Password</label>
            <div className="input-wrap">
              <Lock size={16} className="input-icon" />
              <input
                id="login-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                disabled={checking}
              />
              <button
                type="button"
                className="toggle-pw-btn"
                onClick={() => setShowPassword(!showPassword)}
                aria-label="Toggle password visibility"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            className="submit-btn"
            disabled={checking}
          >
            {checking ? (
              <span>Authenticating...</span>
            ) : (
              <>
                <span>Sign In to Terminal</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <div className="card-footer">
          <ShieldCheck size={14} />
          <span>Secure Encrypted Connection</span>
        </div>
      </div>

      <style jsx>{`
        .modern-login-wrapper {
          min-height: 100vh;
          width: 100%;
          background: #faf7f2;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right))
            max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
          font-family: Inter, ui-sans-serif, system-ui, sans-serif;
        }

        .login-card {
          width: 100%;
          max-width: 420px;
          background: #ffffff;
          border: 1px solid #ede7dc;
          border-radius: 20px;
          box-shadow: 0 16px 40px -10px rgba(0, 0, 0, 0.05),
            0 2px 6px rgba(0, 0, 0, 0.02);
          padding: 36px 32px 28px;
          display: flex;
          flex-direction: column;
          gap: 22px;
        }

        .brand-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
          text-align: center;
        }

        .logo-badge {
          width: 60px;
          height: 60px;
          border-radius: 16px;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          display: grid;
          place-items: center;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.04);
          overflow: hidden;
        }

        .login-logo-img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          display: block;
        }

        .brand-text {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 4px;
        }

        .brand-name {
          margin: 0;
          font-size: 24px;
          font-weight: 800;
          color: #1c1917;
          letter-spacing: -0.02em;
        }

        .brand-badge {
          font-size: 12px;
          color: #78716c;
          font-weight: 500;
        }

        .error-alert {
          background: #fdf0ee;
          border: 1px solid #f6c8c0;
          border-radius: 10px;
          padding: 10px 12px;
          display: flex;
          gap: 10px;
          align-items: flex-start;
          color: #c23820;
          font-size: 12.5px;
        }

        .error-icon {
          flex-shrink: 0;
          margin-top: 2px;
        }

        .error-content {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .login-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .input-group label {
          font-size: 12px;
          font-weight: 600;
          color: #44403c;
        }

        .input-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .input-wrap input {
          width: 100%;
          height: 44px;
          background: #faf7f2;
          border: 1px solid #ede7dc;
          border-radius: 10px;
          padding: 0 40px 0 38px;
          font-size: 13.5px;
          color: #1c1917;
          outline: none;
          transition: all 0.15s ease;
          font-family: inherit;
        }

        .input-wrap input:focus {
          background: #ffffff;
          border-color: #d99726;
          box-shadow: 0 0 0 3px rgba(217, 151, 38, 0.12);
        }

        .input-wrap input::placeholder {
          color: #a8a29e;
        }

        :global(.input-icon) {
          position: absolute;
          left: 12px;
          color: #78716c;
          pointer-events: none;
        }

        .toggle-pw-btn {
          position: absolute;
          right: 10px;
          background: transparent;
          border: 0;
          color: #78716c;
          cursor: pointer;
          display: grid;
          place-items: center;
          padding: 4px;
        }

        .toggle-pw-btn:hover {
          color: #1c1917;
        }

        .submit-btn {
          height: 46px;
          background: linear-gradient(135deg, #d99726, #b47814);
          border: 0;
          border-radius: 10px;
          color: #ffffff;
          font-size: 14px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          cursor: pointer;
          box-shadow: 0 4px 12px rgba(217, 151, 38, 0.3);
          transition: all 0.15s ease;
          margin-top: 4px;
        }

        .submit-btn:hover {
          background: linear-gradient(135deg, #c88719, #9c6307);
          transform: translateY(-1px);
          box-shadow: 0 6px 16px rgba(217, 151, 38, 0.35);
        }

        .submit-btn:active {
          transform: translateY(0);
        }

        .submit-btn:disabled {
          opacity: 0.65;
          cursor: not-allowed;
        }

        .card-footer {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          font-size: 11px;
          color: #a8a29e;
          border-top: 1px solid #ede7dc;
          padding-top: 14px;
        }

        @media (max-width: 380px) {
          .modern-login-wrapper {
            padding-left: max(16px, env(safe-area-inset-left));
            padding-right: max(16px, env(safe-area-inset-right));
          }

          .login-card {
            padding: 28px 20px 22px;
            border-radius: 16px;
            gap: 18px;
          }

          .logo-badge {
            width: 52px;
            height: 52px;
            border-radius: 14px;
          }

          .brand-name {
            font-size: 20px;
          }
        }
      `}</style>
    </div>
  );
}
