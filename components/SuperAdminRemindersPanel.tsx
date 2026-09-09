"use client";

import { useEffect, useState } from "react";
import {
  Bell,
  Clock,
  Send,
  CheckCircle,
  RefreshCw,
  Store,
  User,
  Zap,
  Sun,
  Moon,
  Save,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { DigestShift } from "@/lib/digest/dailyDigest";
import { WhatsAppDigestModal } from "@/components/WhatsAppDigestModal";

type RestaurantRow = {
  id: string;
  name: string;
};

type RestaurantOwnerInfo = {
  id: string;
  name: string;
  phone?: string;
  role?: string;
};

type RestaurantStats = {
  revenue: number;
  orders: number;
  owners: RestaurantOwnerInfo[];
};

type TriggerSettings = {
  triggerCount: number;
  trigger1Time: string; // 16:00
  trigger2Time: string; // 22:30
};

const SETTINGS_KEY = "restaurant_iq_superadmin_triggers_v1";

export function SuperAdminRemindersPanel({
  restaurants,
}: {
  restaurants: RestaurantRow[];
}) {
  const [settings, setSettings] = useState<TriggerSettings>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem(SETTINGS_KEY);
        if (saved) return JSON.parse(saved);
      } catch {}
    }
    return {
      triggerCount: 2,
      trigger1Time: "16:00",
      trigger2Time: "22:30",
    };
  });

  const [savedSuccess, setSavedSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restaurantData, setRestaurantData] = useState<Record<string, RestaurantStats>>({});

  // Modal state for triggering messages
  const [activeModal, setActiveModal] = useState<{
    restaurantId: string;
    restaurantName: string;
    defaultPhone?: string;
    shift: DigestShift;
  } | null>(null);

  useEffect(() => {
    loadRestaurantData();
  }, [restaurants]);

  async function loadRestaurantData() {
    if (!restaurants || restaurants.length === 0) return;
    setLoading(true);

    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const statsMap: Record<string, RestaurantStats> = {};

      for (const rest of restaurants) {
        // Fetch owners/admins
        const { data: usersData } = await supabase
          .from("users")
          .select("id, name, phone, role")
          .eq("restaurant_id", rest.id)
          .in("role", ["ADMIN", "SUPER_ADMIN"]);

        // Fetch today's orders
        const { data: ordersData } = await supabase
          .from("orders")
          .select("total, status")
          .eq("restaurant_id", rest.id)
          .gte("created_at", todayStart.toISOString())
          .neq("status", "CANCELLED");

        const revenue = (ordersData || []).reduce(
          (sum, o) => sum + (Number(o.total) || 0),
          0
        );

        statsMap[rest.id] = {
          revenue,
          orders: (ordersData || []).length,
          owners: (usersData || []).map((u: any) => ({
            id: u.id,
            name: u.name,
            phone: u.phone,
            role: u.role,
          })),
        };
      }

      setRestaurantData(statsMap);
    } catch (err) {
      console.error("Failed to load restaurant stats:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleSaveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err) {
      console.error("Failed to save triggers:", err);
    }
  }

  function triggerForRestaurant(
    rest: RestaurantRow,
    shift: DigestShift
  ) {
    const stats = restaurantData[rest.id];
    const defaultPhone = stats?.owners?.[0]?.phone || "";
    setActiveModal({
      restaurantId: rest.id,
      restaurantName: rest.name,
      defaultPhone,
      shift,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* 1. Trigger Configuration Card */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "14px",
          border: "1px solid #e2e8f0",
          padding: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            borderBottom: "1px solid #f1f5f9",
            paddingBottom: "14px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                borderRadius: "10px",
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#16a34a",
              }}
            >
              <Bell size={20} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                Daily Reminder Schedules ({settings.triggerCount} Triggers Active)
              </h2>
              <p style={{ margin: "2px 0 0", fontSize: "12.5px", color: "#64748b" }}>
                Set automatic reminder times and send daily digests to restaurant owners
              </p>
            </div>
          </div>

          <button
            onClick={handleSaveSettings}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              background: savedSuccess ? "#16a34a" : "#0f172a",
              color: "#fff",
              border: "none",
              borderRadius: "8px",
              padding: "8px 16px",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "background 0.2s",
            }}
          >
            {savedSuccess ? <CheckCircle size={15} /> : <Save size={15} />}
            <span>{savedSuccess ? "Saved Successfully!" : "Save Schedule"}</span>
          </button>
        </div>

        {/* The 2 Configurable Triggers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "14px",
          }}
        >
          {/* Trigger 1 */}
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "10px",
              background: "#fffbeb",
              border: "1px solid #fde68a",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Sun size={20} color="#d97706" />
              <div>
                <strong style={{ fontSize: "13.5px", color: "#92400e", display: "block" }}>
                  Trigger 1: Lunch Shift
                </strong>
                <span style={{ fontSize: "11.5px", color: "#b45309" }}>
                  Dispatches 11 AM - 4 PM summary
                </span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Clock size={15} color="#d97706" />
              <input
                type="time"
                value={settings.trigger1Time}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, trigger1Time: e.target.value }))
                }
                style={{
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  fontWeight: 700,
                  background: "#fff",
                  color: "#0f172a",
                }}
              />
            </div>
          </div>

          {/* Trigger 2 */}
          <div
            style={{
              padding: "14px 16px",
              borderRadius: "10px",
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Moon size={20} color="#15803d" />
              <div>
                <strong style={{ fontSize: "13.5px", color: "#166534", display: "block" }}>
                  Trigger 2: Night Close (EOD)
                </strong>
                <span style={{ fontSize: "11.5px", color: "#15803d" }}>
                  Dispatches full day closing numbers
                </span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <Clock size={15} color="#16a34a" />
              <input
                type="time"
                value={settings.trigger2Time}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, trigger2Time: e.target.value }))
                }
                style={{
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "1px solid #cbd5e1",
                  fontSize: "13px",
                  fontWeight: 700,
                  background: "#fff",
                  color: "#0f172a",
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 2. Restaurant List & Manual Triggers */}
      <div
        style={{
          background: "#ffffff",
          borderRadius: "14px",
          border: "1px solid #e2e8f0",
          padding: "20px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
            marginBottom: "16px",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>
              Restaurants &amp; Manual Triggers ({restaurants.length})
            </h3>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
              Send digests right now on demand to any restaurant owner
            </p>
          </div>

          <button
            onClick={loadRestaurantData}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px 12px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#f8fafc",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            <span>Refresh Sales</span>
          </button>
        </div>

        {restaurants.length === 0 ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
            No restaurants registered on the platform yet.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {restaurants.map((rest) => {
              const stats = restaurantData[rest.id] || { revenue: 0, orders: 0, owners: [] };
              const owner = stats.owners[0];

              return (
                <div
                  key={rest.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "12px",
                    padding: "14px 16px",
                    borderRadius: "10px",
                    border: "1px solid #e2e8f0",
                    background: "#f8fafc",
                  }}
                >
                  {/* Restaurant Details */}
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: "220px" }}>
                    <div
                      style={{
                        width: "36px",
                        height: "36px",
                        borderRadius: "8px",
                        background: "#e2e8f0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#475569",
                        fontWeight: 800,
                      }}
                    >
                      <Store size={18} />
                    </div>

                    <div>
                      <div style={{ fontSize: "14px", fontWeight: 800, color: "#0f172a" }}>
                        {rest.name}
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", display: "flex", alignItems: "center", gap: "4px" }}>
                        <User size={12} />
                        <span>
                          {owner?.name ? `${owner.name} (${owner.phone || "No phone"})` : "No registered owner"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Real-time Sales Snapshot */}
                  <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                    <div>
                      <span style={{ display: "block", fontSize: "10.5px", color: "#64748b", textTransform: "uppercase" }}>
                        Today&apos;s Revenue
                      </span>
                      <strong style={{ fontSize: "14px", color: "#16a34a" }}>
                        ₹{Math.round(stats.revenue).toLocaleString("en-IN")}
                      </strong>
                    </div>

                    <div>
                      <span style={{ display: "block", fontSize: "10.5px", color: "#64748b", textTransform: "uppercase" }}>
                        Orders
                      </span>
                      <strong style={{ fontSize: "14px", color: "#0f172a" }}>
                        {stats.orders}
                      </strong>
                    </div>
                  </div>

                  {/* Manual Trigger Buttons */}
                  <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={() => triggerForRestaurant(rest, "PULSE")}
                      title="Send instant real-time numbers right now"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "7px 11px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        background: "#fff",
                        color: "#0f172a",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <Zap size={13} color="#f59e0b" />
                      <span>Send Now</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => triggerForRestaurant(rest, "LUNCH")}
                      title="Send 4:00 PM Lunch Summary"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "7px 11px",
                        borderRadius: "6px",
                        border: "1px solid #fde68a",
                        background: "#fffbeb",
                        color: "#b45309",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <Sun size={13} color="#d97706" />
                      <span>Lunch (4 PM)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => triggerForRestaurant(rest, "EOD")}
                      title="Send 10:30 PM Night Close"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "7px 11px",
                        borderRadius: "6px",
                        border: "1px solid #bbf7d0",
                        background: "#25d366",
                        color: "#fff",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      <Send size={12} />
                      <span>Night Close (10:30 PM)</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal when triggering a message */}
      {activeModal && (
        <WhatsAppDigestModal
          restaurantId={activeModal.restaurantId}
          restaurantName={activeModal.restaurantName}
          defaultPhone={activeModal.defaultPhone}
          initialShift={activeModal.shift}
          onClose={() => setActiveModal(null)}
        />
      )}
    </div>
  );
}
