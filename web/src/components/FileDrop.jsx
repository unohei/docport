import React, { useMemo, useState } from "react";
import { THEME, Card, Pill } from "./ui/primitives";

export default function FileDrop({
  onFile,
  accept = "application/pdf",
  disabled = false,
  title = "ここに置く",
  hint = "ドラッグ & タップで選択",
}) {
  const [dragOver, setDragOver] = useState(false);
  const [err, setErr] = useState("");

  const pickFirst = (files) => (files && files.length ? files[0] : null);

  const validate = (file) => {
    if (!file) return null;
    const isPdf =
      file.type === "application/pdf" ||
      (file.name || "").toLowerCase().endsWith(".pdf");
    if (!isPdf) return "PDFのみアップロードできます";
    return null;
  };

  const handleFile = (file) => {
    setErr("");
    const v = validate(file);
    if (v) return setErr(v);
    onFile?.(file);
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled) return;
    setDragOver(false);
    const file = pickFirst(e.dataTransfer.files);
    handleFile(file);
  };

  const onBrowse = (e) => {
    const file = pickFirst(e.target.files);
    handleFile(file);
    e.target.value = "";
  };

  const accent = "#0ea5e9";

  return (
    <Card
      style={{
        padding: 0,
        border: "none",
        background: "transparent",
      }}
    >
      <div
        onDragEnter={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragOver(false);
        }}
        onDrop={onDrop}
        onClick={() => {
          if (disabled) return;
          document.getElementById("docport-file-input-hidden")?.click();
        }}
        style={{
          position: "relative",
          borderRadius: 22,
          padding: "60px 24px",
          minHeight: 240,
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "all 200ms ease",
          background: "linear-gradient(180deg, #ffffff, #f2f7fb)",
          border: `1px solid ${dragOver ? accent : "rgba(15,23,42,0.08)"}`,
          boxShadow: `
            inset 0 10px 22px rgba(15,23,42,0.10),
            inset 0 -6px 14px rgba(255,255,255,0.8),
            ${dragOver ? "0 18px 36px rgba(14,165,233,0.25)" : "0 10px 24px rgba(15,23,42,0.08)"}
          `,
          transform: dragOver ? "scale(1.01)" : "scale(1)",
        }}
      >
        {/* 青アクセントバー */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            background: accent,
            opacity: 0.6,
          }}
        />

        <div
          style={{
            display: "grid",
            gap: 14,
            textAlign: "center",
            justifyItems: "center",
          }}
        >
          {/* 紙アイコン */}
          <div
            style={{
              fontSize: 54,
              transition: "transform 200ms ease",
              transform: dragOver ? "translateY(-6px)" : "translateY(0)",
            }}
          >
            📄
          </div>

          <div
            style={{
              fontSize: 22,
              fontWeight: 900,
              color: THEME.text,
              letterSpacing: 0.5,
            }}
          >
            {title}
          </div>

          <div
            style={{
              fontSize: 14,
              opacity: 0.7,
              color: THEME.text,
            }}
          >
            {hint}
          </div>

          <Pill
            tone={{
              bg: "rgba(14,165,233,0.12)",
              text: "#0369a1",
              border: "rgba(14,165,233,0.35)",
            }}
          >
            送信ではなく「置く」です
          </Pill>

          {err ? (
            <div style={{ fontSize: 13, color: "#991b1b", fontWeight: 800 }}>
              {err}
            </div>
          ) : null}
        </div>

        <input
          id="docport-file-input-hidden"
          type="file"
          accept={accept}
          onChange={onBrowse}
          disabled={disabled}
          style={{ display: "none" }}
        />
      </div>
    </Card>
  );
}
