import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";

function fmt(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  return d.toLocaleString();
}

// 期限切れ判定
function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

// ステータス表示
function statusLabel(status) {
  if (status === "UPLOADED") return "未読";
  if (status === "DOWNLOADED") return "既読";
  if (status === "CANCELLED") return "取消";
  if (status === "ARCHIVED") return "アーカイブ";
  return status || "-";
}

function statusTone(status) {
  // 見た目のトーン（色は指定しない縛りがあるので、薄い背景＋枠だけで）
  if (status === "UPLOADED") return { bg: "rgba(0,0,0,0.03)", bd: "#bbb" };
  if (status === "DOWNLOADED") return { bg: "rgba(0,0,0,0.02)", bd: "#ddd" };
  if (status === "CANCELLED") return { bg: "rgba(0,0,0,0.03)", bd: "#bbb" };
  if (status === "ARCHIVED") return { bg: "rgba(0,0,0,0.02)", bd: "#ddd" };
  return { bg: "rgba(0,0,0,0.02)", bd: "#ddd" };
}

// 旧データ（化石）判定
function isLegacyKey(fileKey) {
  if (!fileKey || typeof fileKey !== "string") return true;
  const VALID_PREFIXES = ["documents/"];
  const LEGACY_HINTS = ["docs/", "uploads/", "tmp/", "test/"];

  const ok = VALID_PREFIXES.some((p) => fileKey.startsWith(p));
  const legacyHint = LEGACY_HINTS.some((p) => fileKey.startsWith(p));
  return !ok || legacyHint;
}

const API_BASE = "/api";

export default function App() {
  const [session, setSession] = useState(null);
  const [tab, setTab] = useState("inbox"); // inbox | send | sent
  const [loading, setLoading] = useState(true);

  // data
  const [profile, setProfile] = useState(null); // { hospital_id }
  const [hospitals, setHospitals] = useState([]);
  const [inboxDocs, setInboxDocs] = useState([]);
  const [sentDocs, setSentDocs] = useState([]);

  // send form
  const [toHospitalId, setToHospitalId] = useState("");
  const [comment, setComment] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [sending, setSending] = useState(false);

  // login
  const [email, setEmail] = useState("");

  // filters
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showExpired, setShowExpired] = useState(false); // ★追加：期限切れを表示するか
  const [qInbox, setQInbox] = useState(""); // ★追加：検索
  const [qSent, setQSent] = useState(""); // ★追加：検索

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const myHospitalId = profile?.hospital_id ?? null;

  const myHospitalName = useMemo(() => {
    if (!myHospitalId) return "";
    return hospitals.find((h) => h.id === myHospitalId)?.name ?? "";
  }, [myHospitalId, hospitals]);

  const nameOf = (hid) => hospitals.find((h) => h.id === hid)?.name ?? hid;

  // 未読件数（期限切れ・アーカイブは除外）
  const unreadCount = useMemo(() => {
    return inboxDocs.filter(
      (d) =>
        d.status === "UPLOADED" &&
        !isExpired(d.expires_at) &&
        d.status !== "ARCHIVED",
    ).length;
  }, [inboxDocs]);

  // 受信：フィルタ＆検索
  const filteredInboxDocs = useMemo(() => {
    let list = inboxDocs;

    // デフォルトは期限切れを見せない（★ここが「期限切れが気になる」対策）
    if (!showExpired) {
      list = list.filter((d) => !isExpired(d.expires_at));
    }

    // アーカイブは通常表示しない（必要なら将来「アーカイブ一覧」タブ追加で）
    list = list.filter((d) => d.status !== "ARCHIVED");

    if (showUnreadOnly) {
      list = list.filter((d) => d.status === "UPLOADED");
    }

    const q = (qInbox || "").trim().toLowerCase();
    if (q) {
      list = list.filter((d) => {
        const from = nameOf(d.from_hospital_id).toLowerCase();
        const to = nameOf(d.to_hospital_id).toLowerCase();
        const c = (d.comment || "").toLowerCase();
        return from.includes(q) || to.includes(q) || c.includes(q);
      });
    }

    return list;
  }, [inboxDocs, showExpired, showUnreadOnly, qInbox, hospitals]);

  // 送信履歴：検索
  const filteredSentDocs = useMemo(() => {
    const q = (qSent || "").trim().toLowerCase();
    if (!q) return sentDocs;
    return sentDocs.filter((d) => {
      const from = nameOf(d.from_hospital_id).toLowerCase();
      const to = nameOf(d.to_hospital_id).toLowerCase();
      const c = (d.comment || "").toLowerCase();
      return from.includes(q) || to.includes(q) || c.includes(q);
    });
  }, [sentDocs, qSent, hospitals]);

  const loadAll = async () => {
    if (!session) return;

    const { data: prof, error: profErr } = await supabase
      .from("profiles")
      .select("hospital_id, role")
      .eq("id", session.user.id)
      .single();

    if (profErr) {
      alert(
        `profiles取得に失敗: ${profErr.message}\n（profilesに紐付け済みか確認）`,
      );
      return;
    }
    setProfile(prof);

    const { data: hs, error: hsErr } = await supabase
      .from("hospitals")
      .select("id, name, code")
      .order("name", { ascending: true });
    if (hsErr) return alert(`hospitals取得に失敗: ${hsErr.message}`);
    setHospitals(hs);

    const { data: inbox, error: inboxErr } = await supabase
      .from("documents")
      .select(
        "id, from_hospital_id, to_hospital_id, comment, status, created_at, expires_at, file_key",
      )
      .eq("to_hospital_id", prof.hospital_id)
      .order("created_at", { ascending: false });
    if (inboxErr) return alert(`inbox取得に失敗: ${inboxErr.message}`);
    setInboxDocs(inbox ?? []);

    const { data: sent, error: sentErr } = await supabase
      .from("documents")
      .select(
        "id, from_hospital_id, to_hospital_id, comment, status, created_at, expires_at, file_key",
      )
      .eq("from_hospital_id", prof.hospital_id)
      .order("created_at", { ascending: false });
    if (sentErr) return alert(`sent取得に失敗: ${sentErr.message}`);
    setSentDocs(sent ?? []);
  };

  useEffect(() => {
    if (!session) return;
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const sendMagicLink = async () => {
    const { error } = await supabase.auth.signInWithOtp({ email });
    if (error) alert(error.message);
    else alert("メール送信しました（届いたリンクを開いてログイン）");
  };

  const logout = async () => {
    await supabase.auth.signOut();
    setProfile(null);
    setHospitals([]);
    setInboxDocs([]);
    setSentDocs([]);
    setToHospitalId("");
    setComment("");
    setPdfFile(null);
    setShowUnreadOnly(false);
    setShowExpired(false);
    setQInbox("");
    setQSent("");
  };

  // ---- R2 presign helpers ----
  const getPresignedUpload = async () => {
    const res = await fetch(`${API_BASE}/presign-upload`, { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { upload_url, file_key }
  };

  const putPdf = async (uploadUrl, file) => {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`R2 PUT failed: ${res.status} ${t}`);
    }
  };

  const getPresignedDownload = async (fileKey) => {
    const res = await fetch(
      `${API_BASE}/presign-download?key=${encodeURIComponent(fileKey)}`,
    );
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { download_url }
  };

  const createDocument = async () => {
    if (sending) return;
    try {
      if (!myHospitalId) return alert("profileのhospital_idが取れてません");
      if (!toHospitalId) return alert("宛先病院を選んでください");
      if (toHospitalId === myHospitalId)
        return alert("自院宛は選べません（テストならOKにしても良い）");
      if (!pdfFile) return alert("PDFを選択してください");
      if (pdfFile.type !== "application/pdf")
        return alert("PDFのみアップロードできます");

      setSending(true);

      const { upload_url, file_key } = await getPresignedUpload();
      await putPdf(upload_url, pdfFile);

      const { data, error } = await supabase
        .from("documents")
        .insert({
          from_hospital_id: myHospitalId,
          to_hospital_id: toHospitalId,
          comment: comment || null,
          file_key,
          status: "UPLOADED",
          expires_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        })
        .select()
        .single();

      if (error) return alert(`送信に失敗: ${error.message}`);

      await supabase.from("document_events").insert({
        document_id: data.id,
        actor_user_id: session.user.id,
        action: "UPLOAD",
      });

      setComment("");
      setToHospitalId("");
      setPdfFile(null);
      await loadAll();
      setTab("sent");
      alert("アップロードして送信しました");
    } catch (e) {
      alert(`失敗: ${e?.message ?? e}`);
    } finally {
      setSending(false);
    }
  };

  const downloadDocument = async (doc) => {
    try {
      if (!doc.file_key) return alert("file_keyが空です（旧データの可能性）");
      if (isLegacyKey(doc.file_key))
        return alert(
          `旧データの可能性があるためDLをブロックしました。\nfile_key: ${doc.file_key}`,
        );
      if (isExpired(doc.expires_at))
        return alert("期限切れのためダウンロードできません");
      if (doc.status === "CANCELLED")
        return alert("送信側により取り消されました");
      if (doc.status === "ARCHIVED") return alert("アーカイブ済みです");

      const { download_url } = await getPresignedDownload(doc.file_key);
      window.open(download_url, "_blank");

      await supabase
        .from("documents")
        .update({ status: "DOWNLOADED" })
        .eq("id", doc.id);

      await supabase.from("document_events").insert({
        document_id: doc.id,
        actor_user_id: session.user.id,
        action: "DOWNLOAD",
      });

      await loadAll();
    } catch (e) {
      alert(`DL失敗: ${e?.message ?? e}`);
    }
  };

  const archiveDocument = async (doc) => {
    try {
      if (!doc?.id) return;
      if (doc.status === "ARCHIVED") return;

      await supabase
        .from("documents")
        .update({ status: "ARCHIVED" })
        .eq("id", doc.id);

      await supabase.from("document_events").insert({
        document_id: doc.id,
        actor_user_id: session.user.id,
        action: "ARCHIVE",
      });

      await loadAll();
    } catch (e) {
      alert(`アーカイブ失敗: ${e?.message ?? e}`);
    }
  };

  const cancelDocument = async (doc) => {
    try {
      if (!doc?.id) return;

      const expired = isExpired(doc.expires_at);
      const canCancel = doc.status === "UPLOADED" && !expired;
      if (!canCancel)
        return alert("未読（UPLOADED）かつ期限内のみ取り消しできます");

      const ok = confirm(
        "この送信を取り消しますか？（相手はDLできなくなります）",
      );
      if (!ok) return;

      await supabase
        .from("documents")
        .update({
          status: "CANCELLED",
          // expires_at は触らない（期限切れ表示の違和感を出しにくくする）
        })
        .eq("id", doc.id);

      await supabase.from("document_events").insert({
        document_id: doc.id,
        actor_user_id: session.user.id,
        action: "CANCEL",
      });

      await loadAll();
    } catch (e) {
      alert(`取り消し失敗: ${e?.message ?? e}`);
    }
  };

  // ---- UI helpers ----
  const Card = ({ children, style }) => (
    <div
      style={{
        border: "1px solid #e5e5e5",
        borderRadius: 14,
        padding: 12,
        background: "white",
        ...style,
      }}
    >
      {children}
    </div>
  );

  const Pill = ({ children, title }) => (
    <span
      title={title || ""}
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 12,
        padding: "3px 10px",
        borderRadius: 999,
        border: "1px solid #ddd",
        background: "rgba(0,0,0,0.02)",
        whiteSpace: "nowrap",
        color: "#111",
      }}
    >
      {children}
    </span>
  );

  const SidebarButton = ({ active, children, onClick }) => (
    <button
      onClick={onClick}
      style={{
        width: "100%",
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid #eee",
        background: active ? "rgba(0,0,0,0.04)" : "white",
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );

  const FileDrop = () => {
    const onDrop = (e) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (!f) return;
      if (f.type !== "application/pdf")
        return alert("PDFのみアップロードできます");
      setPdfFile(f);
    };

    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{
          border: "1px dashed #bbb",
          borderRadius: 14,
          padding: 14,
          background: "rgba(0,0,0,0.02)",
        }}
      >
        <div style={{ fontWeight: 700 }}>PDFを置く（ドラッグ&ドロップ）</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
          または下のボタンから選択
        </div>

        <div
          style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}
        >
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              border: "1px solid #ddd",
              borderRadius: 12,
              background: "white",
              cursor: "pointer",
            }}
          >
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
              style={{ display: "none" }}
            />
            ファイルを選ぶ
          </label>

          {pdfFile ? (
            <div style={{ alignSelf: "center", fontSize: 13, opacity: 0.85 }}>
              {pdfFile.name}（{Math.round(pdfFile.size / 1024)} KB）
            </div>
          ) : (
            <div style={{ alignSelf: "center", fontSize: 13, opacity: 0.6 }}>
              未選択
            </div>
          )}
        </div>
      </div>
    );
  };

  // ---- Rendering ----
  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;

  if (!session) {
    return (
      <div style={{ padding: 24, maxWidth: 520, margin: "0 auto" }}>
        <h1 style={{ marginBottom: 8 }}>DocPort</h1>
        <p style={{ marginTop: 0, opacity: 0.75 }}>
          送らない共有。置くだけ連携。
        </p>

        <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email"
            style={{ flex: 1, padding: 10 }}
          />
          <button onClick={sendMagicLink} style={{ padding: "10px 14px" }}>
            Send Link
          </button>
        </div>

        <p style={{ marginTop: 12, fontSize: 13, opacity: 0.7 }}>
          ※ メールのリンクを開くとログインできます
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#fafafa",
        color: "#111", // ← 全体の文字色を固定
        WebkitFontSmoothing: "antialiased",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: "rgba(250,250,250,0.9)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid #eee",
          color: "#111",
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "12px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>DocPort</div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              {myHospitalName
                ? `所属：${myHospitalName}${unreadCount ? ` / 未読: ${unreadCount}` : ""}`
                : "所属：（profiles未設定）"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={() => loadAll()} style={{ padding: "8px 10px" }}>
              Refresh
            </button>
            <button onClick={logout} style={{ padding: "8px 10px" }}>
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Shell */}
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: 16,
          display: "grid",
          gridTemplateColumns: "240px 1fr",
          gap: 14,
        }}
      >
        {/* Sidebar */}
        <div>
          <Card>
            <div style={{ fontSize: 13, opacity: 0.7 }}>メニュー</div>
            <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
              <SidebarButton
                active={tab === "send"}
                onClick={() => setTab("send")}
              >
                送る
              </SidebarButton>
              <SidebarButton
                active={tab === "inbox"}
                onClick={() => setTab("inbox")}
              >
                受信
                {unreadCount ? (
                  <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.75 }}>
                    （未読 {unreadCount}）
                  </span>
                ) : null}
              </SidebarButton>
              <SidebarButton
                active={tab === "sent"}
                onClick={() => setTab("sent")}
              >
                送信履歴
              </SidebarButton>
            </div>
          </Card>

          <div style={{ marginTop: 12, fontSize: 12, opacity: 0.65 }}>
            ※ “置くだけ連携”なので、送信も受信も迷わない導線に寄せていく。
          </div>
        </div>

        {/* Main */}
        <div>
          {tab === "send" && (
            <div style={{ display: "grid", gap: 12 }}>
              <Card>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>送る</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      ① 宛先 → ② PDFを置く → ③ コメント → 送信
                    </div>
                  </div>
                  <Pill>Day5 UI磨き</Pill>
                </div>
              </Card>

              <Card>
                <div style={{ display: "grid", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, opacity: 0.75 }}>宛先病院</div>
                    <select
                      value={toHospitalId}
                      onChange={(e) => setToHospitalId(e.target.value)}
                      style={{
                        width: "100%",
                        padding: 12,
                        marginTop: 6,
                        borderRadius: 12,
                      }}
                    >
                      <option value="">選択してください</option>
                      {hospitals
                        .filter((h) => h.id !== myHospitalId)
                        .map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name} ({h.code || "-"})
                          </option>
                        ))}
                    </select>
                  </div>

                  <div>
                    <div style={{ fontSize: 13, opacity: 0.75 }}>PDF</div>
                    <div style={{ marginTop: 6 }}>
                      <FileDrop />
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 13, opacity: 0.75 }}>
                      コメント（任意）
                    </div>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={3}
                      placeholder="例）紹介状、検査結果、至急 など"
                      style={{
                        width: "100%",
                        padding: 12,
                        marginTop: 6,
                        borderRadius: 12,
                        border: "1px solid #ddd",
                      }}
                    />
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      onClick={createDocument}
                      disabled={!toHospitalId || !pdfFile || sending}
                      style={{
                        padding: "11px 14px",
                        borderRadius: 12,
                        border: "1px solid #ddd",
                        cursor:
                          !toHospitalId || !pdfFile || sending
                            ? "not-allowed"
                            : "pointer",
                        opacity: !toHospitalId || !pdfFile || sending ? 0.6 : 1,
                      }}
                      title={
                        !toHospitalId
                          ? "宛先を選んでください"
                          : !pdfFile
                            ? "PDFを選んでください"
                            : ""
                      }
                    >
                      {sending ? "送信中..." : "送信（PDFアップロード）"}
                    </button>

                    <button
                      onClick={() => {
                        setComment("");
                        setToHospitalId("");
                        setPdfFile(null);
                      }}
                      style={{
                        padding: "11px 14px",
                        borderRadius: 12,
                        border: "1px solid #ddd",
                        background: "white",
                      }}
                    >
                      クリア
                    </button>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {tab === "inbox" && (
            <div style={{ display: "grid", gap: 12 }}>
              <Card>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>受信</div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      受け取り → クリックでDL（未読→既読）→ 必要ならArchive
                    </div>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    <label
                      style={{
                        fontSize: 12,
                        opacity: 0.8,
                        display: "flex",
                        gap: 6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showUnreadOnly}
                        onChange={(e) => setShowUnreadOnly(e.target.checked)}
                      />
                      未読のみ
                    </label>

                    <label
                      style={{
                        fontSize: 12,
                        opacity: 0.8,
                        display: "flex",
                        gap: 6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showExpired}
                        onChange={(e) => setShowExpired(e.target.checked)}
                      />
                      期限切れも表示
                    </label>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    value={qInbox}
                    onChange={(e) => setQInbox(e.target.value)}
                    placeholder="検索（病院名 / コメント）"
                    style={{
                      flex: 1,
                      minWidth: 240,
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid #ddd",
                      background: "white",
                    }}
                  />
                  {qInbox ? (
                    <button
                      onClick={() => setQInbox("")}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #ddd",
                      }}
                    >
                      クリア
                    </button>
                  ) : null}
                </div>

                <div style={{ marginTop: 10, fontSize: 12, opacity: 0.65 }}>
                  ※ 期限切れはデフォルト非表示（ここが“気になる”対策）
                </div>
              </Card>

              {filteredInboxDocs.length === 0 ? (
                <Card>
                  <div style={{ opacity: 0.75 }}>
                    {showUnreadOnly ? "未読はありません" : "まだ届いていません"}
                  </div>
                </Card>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {filteredInboxDocs.map((d) => {
                    const expired = isExpired(d.expires_at);
                    const legacy = isLegacyKey(d.file_key);
                    const unread = d.status === "UPLOADED" && !expired;

                    const disableDownload =
                      expired ||
                      legacy ||
                      d.status === "CANCELLED" ||
                      d.status === "ARCHIVED";

                    const tone = statusTone(d.status);

                    // 表示上のステータス：期限切れは「期限切れ」で明示（ただしトグルで見せた時だけ）
                    const displayPill = expired ? (
                      <Pill title={`expires: ${fmt(d.expires_at)}`}>
                        期限切れ
                      </Pill>
                    ) : legacy ? (
                      <Pill title={`file_key: ${d.file_key}`}>旧データ</Pill>
                    ) : (
                      <Pill>{statusLabel(d.status)}</Pill>
                    );

                    return (
                      <Card
                        key={d.id}
                        style={{
                          border: unread
                            ? "2px solid #333"
                            : "1px solid #e5e5e5",
                          background: unread ? "rgba(0,0,0,0.02)" : "white",
                          opacity: expired ? 0.75 : 1,
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            alignItems: "flex-start",
                          }}
                        >
                          <div style={{ display: "grid", gap: 6 }}>
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                flexWrap: "wrap",
                                alignItems: "center",
                              }}
                            >
                              {unread && (
                                <span style={{ fontSize: 16 }}>●</span>
                              )}
                              {displayPill}
                              <span style={{ fontWeight: 800 }}>
                                {nameOf(d.from_hospital_id)} →{" "}
                                {nameOf(d.to_hospital_id)}
                              </span>
                            </div>

                            <div style={{ fontSize: 13, opacity: 0.9 }}>
                              {d.comment || "（コメントなし）"}
                            </div>

                            {/* expires / file_key は普段は見せない（必要ならtitleで見える） */}
                            <div style={{ fontSize: 12, opacity: 0.6 }}>
                              {fmt(d.created_at)}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={() => downloadDocument(d)}
                              disabled={disableDownload}
                              style={{
                                padding: "9px 12px",
                                borderRadius: 12,
                                border: `1px solid ${tone.bd}`,
                                background: tone.bg,
                                cursor: disableDownload
                                  ? "not-allowed"
                                  : "pointer",
                                opacity: disableDownload ? 0.6 : 1,
                              }}
                              title={
                                expired
                                  ? "期限切れのためダウンロードできません"
                                  : legacy
                                    ? "旧データ（file_key不一致の可能性）があるためダウンロードできません"
                                    : d.status === "CANCELLED"
                                      ? "送信側により取り消されました"
                                      : d.status === "ARCHIVED"
                                        ? "アーカイブ済みです"
                                        : "ダウンロードします"
                              }
                            >
                              Download
                            </button>

                            <button
                              onClick={() => archiveDocument(d)}
                              disabled={d.status === "ARCHIVED"}
                              style={{
                                padding: "9px 12px",
                                borderRadius: 12,
                                border: "1px solid #ddd",
                                background: "white",
                                cursor:
                                  d.status === "ARCHIVED"
                                    ? "not-allowed"
                                    : "pointer",
                                opacity: d.status === "ARCHIVED" ? 0.6 : 1,
                              }}
                              title={
                                d.status === "ARCHIVED"
                                  ? "アーカイブ済み"
                                  : "受信箱から整理します"
                              }
                            >
                              Archive
                            </button>
                          </div>
                        </div>

                        {!expired && !legacy && d.status === "UPLOADED" && (
                          <div
                            style={{
                              marginTop: 10,
                              fontSize: 12,
                              opacity: 0.65,
                            }}
                          >
                            ※ ダウンロードで既読になります
                          </div>
                        )}
                        {d.status === "CANCELLED" && (
                          <div
                            style={{
                              marginTop: 10,
                              fontSize: 12,
                              opacity: 0.65,
                            }}
                          >
                            ※ 送信側で取り消されました（DL不可）
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {tab === "sent" && (
            <div style={{ display: "grid", gap: 12 }}>
              <Card>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>
                      送信履歴
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                      未読のうちだけ“取り消し”可能
                    </div>
                  </div>
                  <Pill>送った記録</Pill>
                </div>

                <div
                  style={{
                    marginTop: 12,
                    display: "flex",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    value={qSent}
                    onChange={(e) => setQSent(e.target.value)}
                    placeholder="検索（病院名 / コメント）"
                    style={{
                      flex: 1,
                      minWidth: 240,
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid #ddd",
                      background: "white",
                    }}
                  />
                  {qSent ? (
                    <button
                      onClick={() => setQSent("")}
                      style={{
                        padding: "10px 12px",
                        borderRadius: 12,
                        border: "1px solid #ddd",
                      }}
                    >
                      クリア
                    </button>
                  ) : null}
                </div>
              </Card>

              {filteredSentDocs.length === 0 ? (
                <Card>
                  <div style={{ opacity: 0.75 }}>まだ送信していません</div>
                </Card>
              ) : (
                <div style={{ display: "grid", gap: 10 }}>
                  {filteredSentDocs.map((d) => {
                    const expired = isExpired(d.expires_at);
                    const canCancel = d.status === "UPLOADED" && !expired;

                    return (
                      <Card key={d.id} style={{ opacity: expired ? 0.85 : 1 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 12,
                            alignItems: "flex-start",
                          }}
                        >
                          <div style={{ display: "grid", gap: 6 }}>
                            <div
                              style={{
                                display: "flex",
                                gap: 8,
                                flexWrap: "wrap",
                                alignItems: "center",
                              }}
                            >
                              <Pill title={`expires: ${fmt(d.expires_at)}`}>
                                {expired ? "期限切れ" : statusLabel(d.status)}
                              </Pill>
                              <span style={{ fontWeight: 800 }}>
                                {nameOf(d.from_hospital_id)} →{" "}
                                {nameOf(d.to_hospital_id)}
                              </span>
                            </div>

                            <div style={{ fontSize: 13, opacity: 0.9 }}>
                              {d.comment || "（コメントなし）"}
                            </div>

                            <div style={{ fontSize: 12, opacity: 0.6 }}>
                              {fmt(d.created_at)}
                            </div>
                          </div>

                          <div
                            style={{
                              display: "flex",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              onClick={() => cancelDocument(d)}
                              disabled={!canCancel}
                              style={{
                                padding: "9px 12px",
                                borderRadius: 12,
                                border: "1px solid #ddd",
                                background: "white",
                                cursor: canCancel ? "pointer" : "not-allowed",
                                opacity: canCancel ? 1 : 0.6,
                              }}
                              title={
                                canCancel
                                  ? "取り消します（相手はDLできなくなります）"
                                  : "未読（UPLOADED）かつ期限内のみ取り消しできます"
                              }
                            >
                              取り消し
                            </button>

                            {canCancel && (
                              <span
                                style={{
                                  fontSize: 12,
                                  opacity: 0.65,
                                  alignSelf: "center",
                                }}
                              >
                                ※ 未読のうちだけ止められます
                              </span>
                            )}
                          </div>
                        </div>

                        {/* デバッグ行は消して “気配” を減らす */}
                        {/* <div style={{ marginTop: 6, fontSize: 12, opacity: 0.6 }}>
                          file_key: {d.file_key}
                        </div> */}
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
