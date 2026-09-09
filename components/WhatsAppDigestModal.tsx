"use client";

import { useEffect, useState } from "react";
import { X, Send, Copy, Check, RefreshCw, AlertCircle, Plus, Trash2, User } from "lucide-react";
import {
  fetchDailyDigestData,
  formatWhatsAppDigestMessage,
  getWhatsAppShareUrl,
  getSavedOwnerRecipients,
  saveOwnerRecipients,
  DailyDigestData,
  DigestShift,
  OwnerRecipient,
} from "@/lib/digest/dailyDigest";

export function WhatsAppDigestModal({
  restaurantId,
  restaurantName,
  defaultPhone,
  initialShift = "EOD",
  onClose,
}: {
  restaurantId: string;
  restaurantName: string;
  defaultPhone?: string;
  initialShift?: DigestShift;
  onClose: () => void;
}) {
  const [shift, setShift] = useState<DigestShift>(initialShift);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DailyDigestData | null>(null);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  // Multiple recipients
  const [recipients, setRecipients] = useState<OwnerRecipient[]>(() => {
    const saved = getSavedOwnerRecipients(restaurantId);
    if (saved.length > 0) return saved;
    if (defaultPhone) {
      return [{ id: "1", name: "Primary Owner", phone: defaultPhone, role: "Owner" }];
    }
    return [];
  });

  const [showAddContact, setShowAddContact] = useState(false);
  const [newContactName, setNewContactName] = useState("");
  const [newContactPhone, setNewContactPhone] = useState("");

  useEffect(() => {
    loadDigest(shift);
  }, [restaurantId, shift]);

  async function loadDigest(targetShift: DigestShift) {
    setLoading(true);
    setError(null);
    try {
      const digest = await fetchDailyDigestData(
        restaurantId,
        restaurantName,
        targetShift
      );
      setData(digest);
      const formatted = formatWhatsAppDigestMessage(digest);
      setMessage(formatted);
    } catch (err: any) {
      console.error("Failed to load digest:", err);
      setError(err?.message || "Could not generate digest.");
    } finally {
      setLoading(false);
    }
  }

  function handleAddRecipient() {
    if (!newContactName.trim() || !newContactPhone.trim()) {
      alert("Enter recipient name and phone number.");
      return;
    }
    const updated = [
      ...recipients,
      {
        id: String(Date.now()),
        name: newContactName.trim(),
        phone: newContactPhone.trim(),
      },
    ];
    setRecipients(updated);
    saveOwnerRecipients(restaurantId, updated);
    setNewContactName("");
    setNewContactPhone("");
    setShowAddContact(false);
  }

  function handleRemoveRecipient(id: string) {
    const updated = recipients.filter((r) => r.id !== id);
    setRecipients(updated);
    saveOwnerRecipients(restaurantId, updated);
  }

  function handleCopy() {
    if (!message) return;
    navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleSendToRecipient(phone: string) {
    if (!phone.trim()) {
      alert("Missing phone number.");
      return;
    }
    const url = getWhatsAppShareUrl(phone, message);
    window.open(url, "_blank");
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(15, 23, 42, 0.65)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "16px",
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "16px",
          width: "100%",
          maxWidth: "580px",
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #e2e8f0",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: "#f8fafc",
          }}
        >
          <div>
            <h2
              style={{
                margin: 0,
                fontSize: "17px",
                fontWeight: 800,
                color: "#0f172a",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>📲 Daily Reminders & Digests</span>
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: "12px", color: "#64748b" }}>
              Send scheduled shift reports to owners and managers
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "6px",
              color: "#64748b",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Shift selector pills */}
        <div
          style={{
            display: "flex",
            gap: "8px",
            padding: "12px 20px 0",
            borderBottom: "1px solid #f1f5f9",
            background: "#ffffff",
          }}
        >
          <button
            onClick={() => setShift("LUNCH")}
            style={{
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 700,
              border: "none",
              borderBottom: shift === "LUNCH" ? "2px solid #25d366" : "2px solid transparent",
              background: "transparent",
              color: shift === "LUNCH" ? "#15803d" : "#64748b",
              cursor: "pointer",
            }}
          >
            ☀️ Lunch (4:00 PM)
          </button>

          <button
            onClick={() => setShift("EOD")}
            style={{
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 700,
              border: "none",
              borderBottom: shift === "EOD" ? "2px solid #25d366" : "2px solid transparent",
              background: "transparent",
              color: shift === "EOD" ? "#15803d" : "#64748b",
              cursor: "pointer",
            }}
          >
            🌙 Night Close (10:30 PM)
          </button>

          <button
            onClick={() => setShift("PULSE")}
            style={{
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 700,
              border: "none",
              borderBottom: shift === "PULSE" ? "2px solid #25d366" : "2px solid transparent",
              background: "transparent",
              color: shift === "PULSE" ? "#15803d" : "#64748b",
              cursor: "pointer",
            }}
          >
            ⚡ Live Snapshot
          </button>
        </div>

        {/* Content */}
        <div
          style={{
            padding: "16px 20px",
            overflowY: "auto",
            flexGrow: 1,
            display: "flex",
            flexDirection: "column",
            gap: "14px",
          }}
        >
          {loading ? (
            <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
              <RefreshCw size={22} className="animate-spin" color="#0284c7" />
              <div style={{ marginTop: "8px", fontSize: "13px" }}>Loading report figures...</div>
            </div>
          ) : error ? (
            <div
              style={{
                padding: "12px",
                background: "#fef2f2",
                border: "1px solid #fee2e2",
                borderRadius: "8px",
                color: "#b91c1c",
                fontSize: "13px",
              }}
            >
              {error}
            </div>
          ) : (
            <>
              {/* Message preview */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>
                    Formatted WhatsApp Message ({data?.shiftTimeLabel}):
                  </span>
                  <button
                    onClick={handleCopy}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#2563eb",
                      fontSize: "12px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    {copied ? "✓ Copied!" : "Copy for Group"}
                  </button>
                </div>

                <div
                  style={{
                    background: "#0c1f17",
                    color: "#e2e8f0",
                    padding: "12px",
                    borderRadius: "8px",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    lineHeight: "1.4",
                    whiteSpace: "pre-wrap",
                    maxHeight: "180px",
                    overflowY: "auto",
                    border: "1px solid #1e3a2b",
                  }}
                >
                  {message}
                </div>
              </div>

              {/* Recipient contacts */}
              <div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "8px",
                  }}
                >
                  <span style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b" }}>
                    Send To Owners / Managers ({recipients.length}):
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowAddContact((p) => !p)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      background: "#f1f5f9",
                      border: "1px solid #cbd5e1",
                      borderRadius: "6px",
                      padding: "3px 8px",
                      fontSize: "11.5px",
                      fontWeight: 600,
                      cursor: "pointer",
                      color: "#334155",
                    }}
                  >
                    <Plus size={12} />
                    <span>Add Phone</span>
                  </button>
                </div>

                {showAddContact && (
                  <div
                    style={{
                      background: "#f8fafc",
                      border: "1px solid #e2e8f0",
                      borderRadius: "8px",
                      padding: "10px",
                      marginBottom: "10px",
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Name (e.g. Partner)"
                      value={newContactName}
                      onChange={(e) => setNewContactName(e.target.value)}
                      style={{
                        padding: "6px 10px",
                        fontSize: "12px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        width: "120px",
                      }}
                    />
                    <input
                      type="tel"
                      placeholder="10-digit Phone"
                      value={newContactPhone}
                      onChange={(e) => setNewContactPhone(e.target.value)}
                      style={{
                        padding: "6px 10px",
                        fontSize: "12px",
                        borderRadius: "6px",
                        border: "1px solid #cbd5e1",
                        flexGrow: 1,
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddRecipient}
                      style={{
                        padding: "6px 12px",
                        background: "#0f172a",
                        color: "#fff",
                        border: "none",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 700,
                        cursor: "pointer",
                      }}
                    >
                      Save
                    </button>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {recipients.length === 0 ? (
                    <div style={{ fontSize: "12px", color: "#64748b", fontStyle: "italic" }}>
                      No phone numbers added yet. Click &quot;Add Phone&quot; to add an owner or manager.
                    </div>
                  ) : (
                    recipients.map((rec) => (
                      <div
                        key={rec.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          padding: "8px 12px",
                          background: "#f8fafc",
                          borderRadius: "8px",
                          border: "1px solid #e2e8f0",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <User size={15} color="#64748b" />
                          <div>
                            <div style={{ fontSize: "12.5px", fontWeight: 700, color: "#1e293b" }}>
                              {rec.name}
                            </div>
                            <div style={{ fontSize: "11px", color: "#64748b" }}>{rec.phone}</div>
                          </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <button
                            type="button"
                            onClick={() => handleSendToRecipient(rec.phone)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "5px",
                              padding: "6px 12px",
                              background: "#25d366",
                              color: "#fff",
                              border: "none",
                              borderRadius: "6px",
                              fontSize: "12px",
                              fontWeight: 700,
                              cursor: "pointer",
                            }}
                          >
                            <Send size={12} />
                            <span>Send WhatsApp</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleRemoveRecipient(rec.id)}
                            title="Remove contact"
                            style={{
                              padding: "6px",
                              background: "transparent",
                              border: "none",
                              color: "#94a3b8",
                              cursor: "pointer",
                            }}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid #e2e8f0",
            background: "#f8fafc",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "11.5px", color: "#64748b" }}>
            Scheduled Auto-Reminders: <strong>4:00 PM</strong> (Lunch) &amp; <strong>10:30 PM</strong> (EOD)
          </div>

          <button
            onClick={handleCopy}
            disabled={loading || !message}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "7px 14px",
              borderRadius: "6px",
              border: "1px solid #cbd5e1",
              background: "#fff",
              color: "#334155",
              fontSize: "12.5px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
            <span>{copied ? "Copied!" : "Copy Report"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
