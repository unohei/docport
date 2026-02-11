import { useMemo, useState } from "react";
import {
  THEME,
  Card,
  PrimaryButton,
  TextInput,
} from "../components/ui/primitives";
import FileDrop from "../components/FileDrop";
import ScanCapture from "../components/ScanCapture";

export default function SendTab({
  headerTitle,
  // headerDesc,
  isMobile,
  myHospitalId,
  hospitals,
  toHospitalId,
  setToHospitalId,
  comment,
  setComment,
  pdfFile,
  setPdfFile,
  sending,
  createDocument,
}) {
  const [inputMode, setInputMode] = useState("drop"); // "drop" | "scan"
  const [hoverMode, setHoverMode] = useState(null); // "drop" | "scan" | null

  const hospitalOptions = useMemo(() => {
    return (hospitals || [])
      .filter((h) => h.id !== myHospitalId)
      .map((h) => ({ id: h.id, name: h.name }));
  }, [hospitals, myHospitalId]);

  const SegButton = ({ active, hovered, icon, children, ...props }) => {
    const isHot = !!active || !!hovered;
    const accentBg = "rgba(14, 165, 233, 0.14)"; // sky
    const accentBorder = "rgba(14, 165, 233, 0.45)";
    const accentText = "#0369a1";

    return (
      <button
        {...props}
        aria-pressed={active ? "true" : "false"}
        style={{
          flex: 1,
          minWidth: 160,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          padding: isMobile ? "12px 12px" : "14px 14px",
          borderRadius: 14,
          border: `1px solid ${
            active
              ? accentBorder
              : isHot
                ? "rgba(2, 132, 199, 0.28)"
                : "rgba(15, 23, 42, 0.12)"
          }`,
          background: active
            ? accentBg
            : isHot
              ? "rgba(2, 132, 199, 0.06)"
              : "rgba(255,255,255,0.7)",
          color: active ? accentText : THEME.text,
          fontWeight: 900,
          letterSpacing: 0.2,
          cursor: "pointer",
          userSelect: "none",
          boxShadow: active
            ? "0 10px 24px rgba(2, 132, 199, 0.18)"
            : isHot
              ? "0 8px 18px rgba(15, 23, 42, 0.10)"
              : "0 2px 8px rgba(15, 23, 42, 0.06)",
          transform: active
            ? "translateY(-1px)"
            : isHot
              ? "translateY(-0.5px)"
              : "none",
          transition:
            "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease, color 140ms ease",
          position: "relative",
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>{icon}</span>
        <span>{children}</span>

        {/* 選択中の“しるし” */}
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 12,
            bottom: 8,
            width: 34,
            height: 4,
            borderRadius: 999,
            background: active ? "rgba(2, 132, 199, 0.75)" : "transparent",
            transition: "background 140ms ease",
          }}
        />
      </button>
    );
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={headerTitle}>置く</div>
        {/* <div style={headerDesc}>
          ドラッグ＆ドロップ / スキャンでPDFを置きます
        </div> */}
      </div>

      {/* Mode toggle */}
      {!pdfFile ? (
        <Card>
          <div
            style={{
              display: "flex",
              gap: 10,
              padding: 10,
              borderRadius: 16,
              border: "1px solid rgba(15, 23, 42, 0.10)",
              background: "rgba(255,255,255,0.65)",
            }}
          >
            <SegButton
              active={inputMode === "drop"}
              hovered={hoverMode === "drop"}
              onMouseEnter={() => setHoverMode("drop")}
              onMouseLeave={() => setHoverMode(null)}
              onClick={() => setInputMode("drop")}
              icon="📎"
            >
              ドラッグで置く
            </SegButton>

            <SegButton
              active={inputMode === "scan"}
              hovered={hoverMode === "scan"}
              onMouseEnter={() => setHoverMode("scan")}
              onMouseLeave={() => setHoverMode(null)}
              onClick={() => setInputMode("scan")}
              icon="📷"
            >
              スキャンで置く
            </SegButton>
          </div>

          <div style={{ marginTop: 12 }}>
            {inputMode === "drop" ? (
              <FileDrop
                onPick={(file) => setPdfFile(file)}
                accept="application/pdf"
                hintTitle="PDFをここに置く"
                hintSub="ドラッグ＆ドロップ / クリックで選択"
                // hintPill="送信ではなく「置く」です"
              />
            ) : (
              <ScanCapture
                filenameBase="紹介状"
                preferRearCamera={true}
                onDone={(file) => {
                  setPdfFile(file);
                }}
                onCancel={() => {}}
              />
            )}
          </div>

          {/* <div style={{ marginTop: 10, fontSize: 12, opacity: 0.7 }}>
            ※ PDFが選択されると、宛先とコメント入力フォームが表示されます
          </div> */}
        </Card>
      ) : null}

      {/* Form (shown when pdf selected) */}
      {pdfFile ? (
        <Card>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ fontWeight: 800 }}>置く先（宛先）</div>

            <select
              value={toHospitalId}
              onChange={(e) => setToHospitalId(e.target.value)}
              style={{
                width: "100%",
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(15, 23, 42, 0.12)",
                background: "rgba(255,255,255,0.85)",
                fontWeight: 700,
                color: THEME.text,
              }}
            >
              <option value="">選択してください</option>
              {hospitalOptions.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>

            <div style={{ fontWeight: 800, marginTop: 6 }}>ひとこと</div>
            <TextInput
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例）紹介状お送りします。ご確認お願いします。"
            />

            <div
              style={{
                marginTop: 6,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                選択中: <b>{pdfFile?.name}</b>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
                  onClick={() => {
                    setPdfFile(null);
                    setToHospitalId("");
                    setComment("");
                  }}
                  disabled={sending}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 12,
                    border: "1px solid rgba(15, 23, 42, 0.12)",
                    background: "transparent",
                    fontWeight: 800,
                    cursor: sending ? "not-allowed" : "pointer",
                  }}
                >
                  戻る
                </button>

                <PrimaryButton onClick={createDocument} disabled={sending}>
                  {sending ? "置いています..." : "置く"}
                </PrimaryButton>
              </div>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
