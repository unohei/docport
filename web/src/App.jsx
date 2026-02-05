console.log("App.jsx LOADED: sky-blue + deepsea buttons (responsive)");

import { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import DocPortLogo from "./assets/logo/docport-logo.svg";

import Root from "./components/Root";
import { useMediaQuery } from "./hooks/useMediaQuery";
import {
  THEME,
  Card,
  PrimaryButton,
  SecondaryButton,
  SidebarButton,
  TextInput,
} from "./components/ui/primitives";

import SendTab from "./tabs/SendTab";
import InboxTab from "./tabs/InboxTab";
import SentTab from "./tabs/SentTab";

function fmt(dt) {
  if (!dt) return "";
  const d = new Date(dt);
  return d.toLocaleString();
}

function isExpired(expiresAt) {
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

function statusLabel(status) {
  if (status === "UPLOADED") return "未読";
  if (status === "DOWNLOADED") return "既読";
  if (status === "CANCELLED") return "取消";
  if (status === "ARCHIVED") return "アーカイブ";
  return status || "-";
}

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

  const [profile, setProfile] = useState(null);
  const [hospitals, setHospitals] = useState([]);
  const [inboxDocs, setInboxDocs] = useState([]);
  const [sentDocs, setSentDocs] = useState([]);

  const [toHospitalId, setToHospitalId] = useState("");
  const [comment, setComment] = useState("");
  const [pdfFile, setPdfFile] = useState(null);
  const [sending, setSending] = useState(false);

  const [email, setEmail] = useState("");

  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [showExpired, setShowExpired] = useState(false);
  const [qInbox, setQInbox] = useState("");
  const [qSent, setQSent] = useState("");

  const isMobile = useMediaQuery("(max-width: 820px)");
  const isNarrow = useMediaQuery("(max-width: 1024px)");

  // ロゴサイズ（ここだけ触ればOK）
  const logoLoginSize = isMobile ? 72 : 200;
  const logoTopbarSize = isMobile ? 28 : 120;

  // 病院アイコンサイズ（ここだけ触ればOK）
  const hospitalIconTopbarSize = isMobile ? 22 : 50;

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

  // 病院ID -> 表示名
  const nameOf = (hid) => hospitals.find((h) => h.id === hid)?.name ?? hid;

  // 病院ID -> アイコンURL（なければデフォルト）
  const iconOf = (hid) =>
    hospitals.find((h) => h.id === hid)?.icon_url || "/default-hospital.svg";

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

    if (!showExpired) list = list.filter((d) => !isExpired(d.expires_at));
    list = list.filter((d) => d.status !== "ARCHIVED");
    if (showUnreadOnly) list = list.filter((d) => d.status === "UPLOADED");

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

    // ★ icon_url を取得に含める（ここ重要）
    const { data: hs, error: hsErr } = await supabase
      .from("hospitals")
      .select("id, name, code, icon_url")
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
    const redirectTo = import.meta.env.VITE_SITE_URL || window.location.origin;

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });

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
      alert("置きました（相手の受け取りBOXに入りました）");
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
        return alert("相手により取り消されました");
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
        "この“置いた”共有を取り消しますか？（相手はDLできなくなります）",
      );
      if (!ok) return;

      await supabase
        .from("documents")
        .update({ status: "CANCELLED" })
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

  // ★色トーン（期限切れ最優先）
  const statusTone = (doc) => {
    const expired = isExpired(doc.expires_at);
    if (expired) {
      return {
        bg: "rgba(239, 68, 68, 0.12)",
        text: "#991b1b",
        border: "rgba(153, 27, 27, 0.22)",
      };
    }
    switch (doc.status) {
      case "UPLOADED":
        return {
          bg: "rgba(59, 130, 246, 0.12)",
          text: "#1d4ed8",
          border: "rgba(29, 78, 216, 0.22)",
        }; // 未読(青)
      case "DOWNLOADED":
        return {
          bg: "rgba(16, 185, 129, 0.12)",
          text: "#047857",
          border: "rgba(4, 120, 87, 0.22)",
        }; // 既読(緑)
      case "CANCELLED":
        return {
          bg: "rgba(100, 116, 139, 0.14)",
          text: "#334155",
          border: "rgba(51, 65, 85, 0.22)",
        }; // 取消(グレー)
      case "ARCHIVED":
        return {
          bg: "rgba(168, 85, 247, 0.12)",
          text: "#6d28d9",
          border: "rgba(109, 40, 217, 0.22)",
        }; // アーカイブ(紫)
      default:
        return {
          bg: "rgba(15, 23, 42, 0.08)",
          text: "#0f172a",
          border: "rgba(15, 23, 42, 0.18)",
        };
    }
  };

  if (loading) return <div style={{ padding: 24 }}>Loading...</div>;

  // ------- LOGIN -------
  if (!session) {
    return (
      <Root>
        <div style={{ padding: 24 }}>
          <div style={{ maxWidth: 520, margin: "0 auto", textAlign: "center" }}>
            <img
              src={DocPortLogo}
              alt="DocPort"
              style={{
                width: logoLoginSize,
                height: logoLoginSize,
                marginBottom: 14,
                opacity: 0.95,
              }}
            />

            <h1 style={{ marginBottom: 8, fontWeight: 800, color: THEME.text }}>
              DocPort
            </h1>
            <p style={{ marginTop: 0, opacity: 0.7, color: THEME.text }}>
              送らない共有。置くだけ連携。
            </p>

            <div
              style={{
                marginTop: 24,
                display: "flex",
                gap: 10,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <TextInput
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email"
                style={{ flex: 1, minWidth: 220, maxWidth: 320 }}
              />
              <PrimaryButton onClick={sendMagicLink} style={{ minWidth: 160 }}>
                Send Link
              </PrimaryButton>
            </div>

            <p
              style={{
                marginTop: 12,
                fontSize: 13,
                opacity: 0.7,
                color: THEME.text,
              }}
            >
              ※ メールのリンクを開くとログインできます
            </p>
          </div>
        </div>
      </Root>
    );
  }

  // ------- APP -------
  const headerTitle = { fontSize: 18, fontWeight: 800, color: THEME.text };
  const headerDesc = { fontSize: 12, opacity: 0.7, color: THEME.text };

  return (
    <Root>
      {/* Top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 5,
          background: THEME.topbar,
          backdropFilter: "blur(10px)",
          borderBottom: `1px solid ${THEME.border}`,
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: isMobile ? "10px 12px" : "12px 16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: isMobile ? "flex-start" : "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          {/* ロゴ + タイトル + 自院アイコン（自然に横並び） */}
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <img
              src={DocPortLogo}
              alt="DocPort"
              style={{
                width: logoTopbarSize,
                height: logoTopbarSize,
                opacity: 0.92,
                flexShrink: 0,
              }}
            />

            <div>
              <div style={{ fontSize: 26, fontWeight: 800, color: THEME.text }}>
                DocPort
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                  fontSize: 16,
                  opacity: 0.7,
                  color: THEME.text,
                }}
              >
                <span>
                  {myHospitalName
                    ? `所属：${myHospitalName}${unreadCount ? ` / 未読: ${unreadCount}` : ""}`
                    : "所属：（profiles未設定）"}
                </span>

                {/* ★ 自院アイコン（テキストと別レイアウトで崩れにくい） */}
                {myHospitalId && (
                  <img
                    src={iconOf(myHospitalId)}
                    alt="hospital icon"
                    style={{
                      width: hospitalIconTopbarSize,
                      height: hospitalIconTopbarSize,
                      borderRadius: 6,
                      objectFit: "cover",
                      opacity: 0.95,
                      border: `1px solid ${THEME.border}`,
                    }}
                    onError={(e) => {
                      // 画像URL壊れてても表示を保つ
                      e.currentTarget.src = "/default-hospital.svg";
                    }}
                  />
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: isMobile ? "flex-start" : "flex-end",
            }}
          >
            <SecondaryButton onClick={logout} style={{ minWidth: 120 }}>
              ログアウト
            </SecondaryButton>
          </div>
        </div>
      </div>

      {/* Shell */}
      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: isMobile ? 12 : 16,
          display: "grid",
          gridTemplateColumns: isMobile
            ? "1fr"
            : isNarrow
              ? "220px 1fr"
              : "240px 1fr",
          gap: 14,
        }}
      >
        {/* Sidebar */}
        <div>
          <Card>
            <div style={{ fontSize: 13, opacity: 0.7, fontWeight: 800 }}>
              メニュー
            </div>

            <div
              style={{
                display: "grid",
                gap: 10,
                marginTop: 12,
                gridTemplateColumns: isMobile
                  ? "repeat(3, minmax(0, 1fr))"
                  : "1fr",
              }}
            >
              <SidebarButton
                active={tab === "send"}
                onClick={() => setTab("send")}
              >
                置く
              </SidebarButton>

              <SidebarButton
                active={tab === "inbox"}
                onClick={() => setTab("inbox")}
                badge={unreadCount ? `未読 ${unreadCount}` : null}
              >
                受け取る
              </SidebarButton>

              <SidebarButton
                active={tab === "sent"}
                onClick={() => setTab("sent")}
              >
                記録
              </SidebarButton>
            </div>
          </Card>
        </div>

        {/* Main */}
        <div>
          {tab === "send" && (
            <SendTab
              headerTitle={headerTitle}
              headerDesc={headerDesc}
              isMobile={isMobile}
              myHospitalId={myHospitalId}
              hospitals={hospitals}
              toHospitalId={toHospitalId}
              setToHospitalId={setToHospitalId}
              comment={comment}
              setComment={setComment}
              pdfFile={pdfFile}
              setPdfFile={setPdfFile}
              sending={sending}
              createDocument={createDocument}
              // 将来：一覧や候補表示で使えるように渡しておく
              iconOf={iconOf}
              nameOf={nameOf}
            />
          )}

          {tab === "inbox" && (
            <InboxTab
              headerTitle={headerTitle}
              headerDesc={headerDesc}
              isMobile={isMobile}
              showUnreadOnly={showUnreadOnly}
              setShowUnreadOnly={setShowUnreadOnly}
              showExpired={showExpired}
              setShowExpired={setShowExpired}
              qInbox={qInbox}
              setQInbox={setQInbox}
              filteredInboxDocs={filteredInboxDocs}
              nameOf={nameOf}
              iconOf={iconOf}
              fmt={fmt}
              isExpired={isExpired}
              downloadDocument={downloadDocument}
              archiveDocument={archiveDocument}
              statusLabel={statusLabel}
              isLegacyKey={isLegacyKey}
              statusTone={statusTone}
            />
          )}

          {tab === "sent" && (
            <SentTab
              headerTitle={headerTitle}
              headerDesc={headerDesc}
              isMobile={isMobile}
              qSent={qSent}
              setQSent={setQSent}
              filteredSentDocs={filteredSentDocs}
              nameOf={nameOf}
              iconOf={iconOf}
              fmt={fmt}
              isExpired={isExpired}
              cancelDocument={cancelDocument}
              statusLabel={statusLabel}
              statusTone={statusTone}
            />
          )}
        </div>
      </div>
    </Root>
  );
}
