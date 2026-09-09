export default function Loading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "radial-gradient(ellipse at top, #111b2e, #070a12)",
        color: "#ffffff",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        padding: "24px",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          maxWidth: "360px",
          width: "100%",
          textAlign: "center",
        }}
      >
        {/* Glowing Brand Icon */}
        <div
          style={{
            position: "relative",
            width: "100px",
            height: "100px",
            marginBottom: "28px",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: "-8px",
              borderRadius: "28px",
              background: "radial-gradient(circle, rgba(16,185,129,0.35) 0%, rgba(16,185,129,0) 70%)",
              filter: "blur(12px)",
              animation: "pulse 2s infinite ease-in-out",
            }}
          />
          <img
            src="/icon-192.png"
            alt="RestaurantIQ"
            width={100}
            height={100}
            style={{
              position: "relative",
              width: "100px",
              height: "100px",
              borderRadius: "24px",
              boxShadow: "0 12px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.1)",
              objectFit: "cover",
            }}
          />
        </div>

        {/* Brand Name */}
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "28px",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            background: "linear-gradient(135deg, #ffffff 40%, #10b981 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          RestaurantIQ
        </h1>

        <p
          style={{
            margin: "0 0 28px 0",
            fontSize: "14px",
            color: "#94a3b8",
            fontWeight: 500,
          }}
        >
          Restaurant POS & Intelligence
        </p>

        {/* Animated Progress Shimmer Bar */}
        <div
          style={{
            width: "180px",
            height: "4px",
            background: "rgba(255, 255, 255, 0.08)",
            borderRadius: "999px",
            overflow: "hidden",
            position: "relative",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: "40%",
              background: "linear-gradient(90deg, #10b981, #34d399)",
              borderRadius: "999px",
              animation: "shimmer 1.5s infinite ease-in-out",
            }}
          />
        </div>

        <span
          style={{
            fontSize: "12px",
            color: "#64748b",
            fontWeight: 500,
            letterSpacing: "0.02em",
          }}
        >
          Loading your restaurant workspace...
        </span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 0.9; transform: scale(1.08); }
        }
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
