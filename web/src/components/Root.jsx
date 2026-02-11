import "../index.css";

export default function Root({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "transparent",
        fontFamily:
          "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      {children}
    </div>
  );
}
