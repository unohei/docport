import {
  Card,
  Pill,
  SecondaryButton,
  TextInput,
} from "../components/ui/primitives";

export default function SentTab({
  headerTitle,
  headerDesc,
  isMobile,
  qSent,
  setQSent,
  filteredSentDocs,
  nameOf,
  fmt,
  isExpired,
  cancelDocument,
  statusLabel,
  statusTone, // ★追加
}) {
  return (
    <Card>
      <div style={headerTitle}>記録</div>
      <div style={{ ...headerDesc, marginTop: 6 }}>
        置いた履歴（未読のうちは取り消し可）
      </div>

      <div style={{ marginTop: 14 }}>
        <TextInput
          value={qSent}
          onChange={(e) => setQSent(e.target.value)}
          placeholder="検索（病院名 / コメント）"
          style={{ maxWidth: isMobile ? "100%" : 420 }}
        />
      </div>

      <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
        {filteredSentDocs.length === 0 ? (
          <div style={{ fontSize: 13, opacity: 0.7, padding: 8 }}>
            記録はまだありません。
          </div>
        ) : (
          filteredSentDocs.map((doc) => {
            const expired = isExpired(doc.expires_at);

            return (
              <div
                key={doc.id}
                style={{
                  backgroundColor: "rgba(255, 254, 200, 0.55)",
                  border: "1px solid rgba(15,23,42,0.12)",
                  borderRadius: 12,
                  padding: 12,
                  display: "grid",
                  gap: 10,
                  boxShadow: "0 6px 14px rgba(15, 23, 42, 0.08)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 16 }}>
                      {nameOf(doc.to_hospital_id)}
                    </div>
                    <div style={{ fontSize: 14, opacity: 0.7, marginTop: 4 }}>
                      {fmt(doc.created_at)}{" "}
                      {doc.expires_at ? ` / 期限: ${fmt(doc.expires_at)}` : ""}
                    </div>
                    {doc.comment ? (
                      <div style={{ fontSize: 14, opacity: 0.8, marginTop: 6 }}>
                        {doc.comment}
                      </div>
                    ) : null}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <Pill tone={statusTone(doc)}>
                      {expired ? "期限切れ" : statusLabel(doc.status)}
                    </Pill>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: 10,
                    justifyContent: "flex-end",
                    flexWrap: "wrap",
                  }}
                >
                  <SecondaryButton
                    onClick={() => cancelDocument(doc)}
                    disabled={doc.status !== "UPLOADED" || expired}
                  >
                    取り消す
                  </SecondaryButton>
                </div>
              </div>
            );
          })
        )}
      </div>
    </Card>
  );
}
