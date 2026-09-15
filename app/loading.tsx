export default function Loading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        background: "#faf7f2",
        color: "#1c1917",
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
        {/* Brand Icon */}
        <div
          style={{
            position: "relative",
            width: "90px",
            height: "90px",
            marginBottom: "24px",
          }}
        >
          <img
            src="/logo.png"
            alt="RestaurantIQ"
            width={90}
            height={90}
            style={{
              position: "relative",
              width: "90px",
              height: "90px",
              borderRadius: "20px",
              boxShadow: "0 8px 24px rgba(0, 0, 0, 0.08), 0 0 0 1px #ede7dc",
              objectFit: "cover",
            }}
          />
        </div>

        {/* Brand Name */}
        <h1
          style={{
            margin: "0 0 8px 0",
            fontSize: "26px",
            fontWeight: 800,
            letterSpacing: "-0.02em",
            color: "#1c1917",
          }}
        >
          RestaurantIQ
        </h1>

        <p
          style={{
            margin: "0 0 24px 0",
            fontSize: "14px",
            color: "#78716c",
            fontWeight: 500,
          }}
        >
          Restaurant POS & Intelligence
        </p>

        {/* Animated Progress Shimmer Bar */}
        <div
          style={{
            width: "160px",
            height: "4px",
            background: "#ede7dc",
            borderRadius: "999px",
            overflow: "hidden",
            position: "relative",
            marginBottom: "14px",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              height: "100%",
              width: "40%",
              background: "linear-gradient(90deg, #d99726, #167a49)",
              borderRadius: "999px",
              animation: "shimmer 1.5s infinite ease-in-out",
            }}
          />
        </div>

        <span
          style={{
            fontSize: "12px",
            color: "#78716c",
            fontWeight: 500,
          }}
        >
          Loading your restaurant workspace...
        </span>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(350%); }
        }
      `}</style>
    </div>
  );
}
