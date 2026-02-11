import { useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";

/**
 * ScanCapture.jsx（カラー版）
 * - getUserMedia でカメラ起動
 * - OpenCV.js で書類検出（エッジ→輪郭→四隅推定）
 * - Perspective Transform で台形補正（★カラー出力）
 * - pdf-lib で 1ページPDF化
 *
 * props:
 * - onDone(file: File): スキャン結果PDFを File として返す
 * - onCancel(): 閉じるなど
 * - filenameBase?: "紹介状" など（省略可）
 * - preferRearCamera?: boolean（既定 true）
 */
export default function ScanCapture({
  onDone,
  onCancel,
  filenameBase = "scan",
  preferRearCamera = true,
}) {
  const videoRef = useRef(null);
  const rawCanvasRef = useRef(null); // キャプチャ用（元画像）
  const outCanvasRef = useRef(null); // 補正結果（★カラー）
  const streamRef = useRef(null);

  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [opencvReady, setOpenCvReady] = useState(false);

  // device switching
  const [devices, setDevices] = useState([]); // videoinput
  const [deviceId, setDeviceId] = useState(""); // selected deviceId

  // ---- UI accents ----
  const SKY_TEXT = "#0369a1";
  const DEEP = "#0F172A"; // deepsea（カメラ起動）

  const canUseMedia =
    typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  // ---- OpenCV.js ready check ----
  useEffect(() => {
    let t = null;
    const check = () => {
      if (typeof window !== "undefined" && window.cv && window.cv.Mat) {
        setOpenCvReady(true);
        return;
      }
      t = setTimeout(check, 200);
    };
    check();
    return () => t && clearTimeout(t);
  }, []);

  // ---- helpers (OpenCV) ----
  const cv = useMemo(
    () => (typeof window !== "undefined" ? window.cv : null),
    [],
  );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const refreshDevices = async () => {
    try {
      if (!navigator?.mediaDevices?.enumerateDevices) return;
      const list = await navigator.mediaDevices.enumerateDevices();
      const vids = list.filter((d) => d.kind === "videoinput");
      setDevices(vids);
      return vids;
    } catch {
      return [];
    }
  };

  const stopCamera = async () => {
    try {
      const s = streamRef.current;
      if (s) s.getTracks().forEach((tr) => tr.stop());
      streamRef.current = null;

      const v = videoRef.current;
      if (v) v.srcObject = null;

      setCamOn(false);
    } catch {
      // ignore
    }
  };

  const startCamera = async (opts = {}) => {
    const { forceDeviceId } = opts;

    setErr("");
    if (!canUseMedia) {
      setErr("このブラウザではカメラが使えません。");
      return;
    }

    // 先に video を描画（黒画面/要素なし対策）
    setCamOn(true);
    await sleep(0);

    try {
      await stopCamera();
      setCamOn(true);
      await sleep(0);

      const constraints = {
        audio: false,
        video: (() => {
          if (forceDeviceId || deviceId) {
            return { deviceId: { exact: forceDeviceId || deviceId } };
          }
          return preferRearCamera
            ? { facingMode: { ideal: "environment" } }
            : { facingMode: { ideal: "user" } };
        })(),
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const v = videoRef.current;
      if (!v) throw new Error("video 要素が見つかりません（描画タイミング）");

      v.srcObject = stream;
      await sleep(0);
      await v.play();

      const vids = (await refreshDevices()) || [];

      if (!forceDeviceId && !deviceId && vids.length >= 2 && preferRearCamera) {
        const rearLike =
          vids.find((d) => /back|rear|environment/i.test(d.label)) || null;
        if (rearLike?.deviceId) {
          setDeviceId(rearLike.deviceId);
          await stopCamera();
          await sleep(0);
          return startCamera({ forceDeviceId: rearLike.deviceId });
        }
      }

      if (forceDeviceId) setDeviceId(forceDeviceId);
      else if (!deviceId && vids?.[0]?.deviceId) setDeviceId(vids[0].deviceId);

      setCamOn(true);
    } catch (e) {
      setErr(e?.message ?? String(e));
      setCamOn(false);
      await stopCamera();
    }
  };

  useEffect(() => {
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function orderQuadPoints(pts) {
    const sum = pts.map((p) => p.x + p.y);
    const diff = pts.map((p) => p.x - p.y);
    const tl = pts[sum.indexOf(Math.min(...sum))];
    const br = pts[sum.indexOf(Math.max(...sum))];
    const tr = pts[diff.indexOf(Math.max(...diff))];
    const bl = pts[diff.indexOf(Math.min(...diff))];
    return [tl, tr, br, bl];
  }

  function dist(a, b) {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  async function canvasToPdfFile(canvas, outName) {
    // カラーのままPDFへ
    const dataUrl = canvas.toDataURL("image/png");
    const pngBytes = await fetch(dataUrl).then((r) => r.arrayBuffer());

    const pdf = await PDFDocument.create();
    const img = await pdf.embedPng(pngBytes);

    const w = img.width;
    const h = img.height;

    const page = pdf.addPage([w, h]);
    page.drawImage(img, { x: 0, y: 0, width: w, height: h });

    const pdfBytes = await pdf.save();
    return new File([pdfBytes], outName, { type: "application/pdf" });
  }

  const captureAndProcess = async () => {
    setErr("");
    if (!opencvReady)
      return setErr("OpenCV.js がまだ読み込み中です（少し待ってね）");
    if (!camOn) return setErr("カメラが起動していません");
    if (!cv) return setErr("OpenCVが見つかりません（window.cv）");

    const video = videoRef.current;
    const rawCanvas = rawCanvasRef.current;
    const outCanvas = outCanvasRef.current;
    if (!video || !rawCanvas || !outCanvas) return;

    setBusy(true);
    try {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) {
        throw new Error(
          "カメラ映像の準備ができていません（videoWidth/videoHeightが0）。少し待ってから再試行してください。",
        );
      }

      const MAX_W = 1400;
      const scale = vw > MAX_W ? MAX_W / vw : 1;
      const cw = Math.round(vw * scale);
      const ch = Math.round(vh * scale);

      rawCanvas.width = cw;
      rawCanvas.height = ch;
      const ctx = rawCanvas.getContext("2d");
      ctx.drawImage(video, 0, 0, cw, ch);

      // ★srcRGBA（カラー）を保持
      const srcRGBA = cv.imread(rawCanvas);

      // 検出はグレーで
      const gray = new cv.Mat();
      cv.cvtColor(srcRGBA, gray, cv.COLOR_RGBA2GRAY);

      // ★前処理：文字を潰しにくい & エッジ安定
      const denoise = new cv.Mat();
      cv.bilateralFilter(gray, denoise, 7, 50, 50);

      const edges = new cv.Mat();
      cv.Canny(denoise, edges, 50, 150);

      // ★エッジの欠けをつなぐ
      const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
      kernel.delete();

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();

      // ★外側輪郭のみ（誤検出を減らす）
      cv.findContours(
        edges,
        contours,
        hierarchy,
        cv.RETR_EXTERNAL,
        cv.CHAIN_APPROX_SIMPLE,
      );

      let bestQuad = null;
      let bestArea = 0;

      for (let i = 0; i < contours.size(); i++) {
        const cnt = contours.get(i);

        const peri = cv.arcLength(cnt, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(cnt, approx, 0.02 * peri, true);

        if (approx.rows === 4) {
          const area = cv.contourArea(approx);
          // 凸性チェック（紙以外のギザギザ排除）
          const convex = cv.isContourConvex(approx);

          // 面積しきい値（画面の12%は踏襲）
          const okArea = area >= cw * ch * 0.12;

          if (convex && okArea && area > bestArea) {
            bestArea = area;
            bestQuad?.delete?.();
            bestQuad = approx.clone();
          }
        }

        approx.delete();
        cnt.delete();
      }

      contours.delete();
      hierarchy.delete();
      edges.delete();
      denoise.delete();

      if (!bestQuad) {
        gray.delete();
        srcRGBA.delete();
        bestQuad?.delete?.();
        throw new Error(
          "書類の四隅を検出できませんでした。紙全体が映るように撮ってみてください。",
        );
      }

      const pts = [];
      for (let r = 0; r < 4; r++) {
        pts.push({
          x: bestQuad.intAt(r, 0),
          y: bestQuad.intAt(r, 1),
        });
      }
      const [tl, tr, br, bl] = orderQuadPoints(pts);

      const widthA = dist(br, bl);
      const widthB = dist(tr, tl);
      const maxW = Math.max(widthA, widthB);

      const heightA = dist(tr, br);
      const heightB = dist(tl, bl);
      const maxH = Math.max(heightA, heightB);

      // 出力解像（最低800幅）
      const dstW = Math.max(800, Math.round(maxW));
      const dstH = Math.round(maxW > 0 ? (maxH / maxW) * dstW : maxH);

      const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        tl.x,
        tl.y,
        tr.x,
        tr.y,
        br.x,
        br.y,
        bl.x,
        bl.y,
      ]);
      const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0,
        0,
        dstW - 1,
        0,
        dstW - 1,
        dstH - 1,
        0,
        dstH - 1,
      ]);

      const M = cv.getPerspectiveTransform(srcTri, dstTri);
      const dsize = new cv.Size(dstW, dstH);

      // ★ここが本体：カラーで補正
      const warpedColor = new cv.Mat();
      cv.warpPerspective(
        srcRGBA,
        warpedColor,
        M,
        dsize,
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(),
      );

      outCanvas.width = dstW;
      outCanvas.height = dstH;
      cv.imshow(outCanvas, warpedColor);

      // cleanup
      warpedColor.delete();
      M.delete();
      srcTri.delete();
      dstTri.delete();
      bestQuad.delete();
      gray.delete();
      srcRGBA.delete();

      const ymd = new Date();
      const stamp =
        `${ymd.getFullYear()}` +
        `${String(ymd.getMonth() + 1).padStart(2, "0")}` +
        `${String(ymd.getDate()).padStart(2, "0")}` +
        `_` +
        `${String(ymd.getHours()).padStart(2, "0")}` +
        `${String(ymd.getMinutes()).padStart(2, "0")}`;

      const outName = `${filenameBase}_${stamp}.pdf`;
      const file = await canvasToPdfFile(outCanvas, outName);

      await stopCamera();
      onDone?.(file);
    } catch (e) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const canSwitch = devices.length >= 2;

  const switchCamera = async () => {
    setErr("");
    if (!canSwitch) return;

    const idx = devices.findIndex((d) => d.deviceId === deviceId);
    const next = devices[(idx + 1) % devices.length] || devices[0];
    if (!next?.deviceId) return;

    setDeviceId(next.deviceId);
    await startCamera({ forceDeviceId: next.deviceId });
  };

  return (
    <div
      style={{
        border: "1px solid rgba(15, 23, 42, 0.12)",
        borderRadius: 14,
        padding: 14,
        background: "rgba(255,255,255,0.8)",
      }}
    >
      <div style={{ fontWeight: 900, marginBottom: 6 }}>スキャンして置く</div>
      <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
        紙を撮影 → 自動で台形補正 → カラーPDFにして「置く」に渡します
      </div>

      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        style={{
          width: "100%",
          borderRadius: 14,
          background: "#0b1220",
          display: camOn ? "block" : "none",
        }}
      />

      {!camOn ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button
            onClick={() => startCamera()}
            disabled={busy || !opencvReady}
            style={{
              padding: "12px 16px",
              borderRadius: 14,
              border: "1px solid rgba(15, 23, 42, 0.16)",
              background: busy || !opencvReady ? "rgba(15,23,42,0.08)" : DEEP,
              color: busy || !opencvReady ? "rgba(15,23,42,0.45)" : "#fff",
              fontWeight: 900,
              letterSpacing: 0.2,
              cursor: busy || !opencvReady ? "not-allowed" : "pointer",
              boxShadow:
                busy || !opencvReady
                  ? "none"
                  : "0 10px 22px rgba(15,23,42,0.18)",
              transform: busy || !opencvReady ? "none" : "translateY(-0.5px)",
              transition:
                "transform 140ms ease, box-shadow 140ms ease, background 140ms ease",
              minWidth: 180,
            }}
          >
            📷 カメラを起動
          </button>

          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "12px 16px",
              borderRadius: 14,
              border: "1px solid rgba(15, 23, 42, 0.12)",
              background: "rgba(255,255,255,0.75)",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
              minWidth: 140,
            }}
          >
            キャンセル
          </button>

          <div style={{ fontSize: 12, opacity: 0.7 }}>
            OpenCV: {opencvReady ? "ready" : "loading..."}
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 10,
              alignItems: "center",
            }}
          >
            <button
              onClick={captureAndProcess}
              disabled={busy}
              style={{
                padding: "14px 18px",
                borderRadius: 16,
                border: `1px solid ${
                  busy ? "rgba(15,23,42,0.12)" : "rgba(14,165,233,0.45)"
                }`,
                background: busy
                  ? "rgba(15,23,42,0.06)"
                  : "rgba(224,242,254,0.85)",
                color: busy ? "rgba(15,23,42,0.55)" : SKY_TEXT,
                fontWeight: 950,
                fontSize: 15,
                letterSpacing: 0.25,
                cursor: busy ? "not-allowed" : "pointer",
                boxShadow: busy ? "none" : "0 14px 30px rgba(14,165,233,0.22)",
                transform: busy ? "none" : "translateY(-1px)",
                transition:
                  "background 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease, color 140ms ease",
                minWidth: 220,
              }}
            >
              {busy ? "処理中..." : "📄 撮ってPDF化"}
            </button>

            {canSwitch ? (
              <button
                onClick={switchCamera}
                disabled={busy}
                style={{
                  padding: "12px 14px",
                  borderRadius: 14,
                  border: `1px solid ${
                    busy ? "rgba(15,23,42,0.10)" : "rgba(14,165,233,0.22)"
                  }`,
                  background: busy
                    ? "rgba(15,23,42,0.06)"
                    : "rgba(255,255,255,0.75)",
                  color: "rgba(15,23,42,0.85)",
                  fontWeight: 800,
                  cursor: busy ? "not-allowed" : "pointer",
                  boxShadow: busy ? "none" : "0 8px 16px rgba(15,23,42,0.06)",
                }}
              >
                🔁 カメラ切替
              </button>
            ) : null}

            <button
              onClick={stopCamera}
              disabled={busy}
              style={{
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid rgba(15, 23, 42, 0.12)",
                background: "rgba(255,255,255,0.75)",
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
                boxShadow: busy ? "none" : "0 8px 16px rgba(15,23,42,0.06)",
              }}
            >
              カメラ停止
            </button>

            <div style={{ fontSize: 12, opacity: 0.7 }}>
              device:{" "}
              {deviceId
                ? devices.find((d) => d.deviceId === deviceId)?.label ||
                  "selected"
                : "auto"}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              プレビュー（補正後・カラー）
            </div>
            <canvas
              ref={outCanvasRef}
              style={{
                width: "100%",
                borderRadius: 14,
                border: `1px dashed ${
                  busy ? "rgba(14,165,233,0.45)" : "rgba(15, 23, 42, 0.18)"
                }`,
                background: "white",
              }}
            />
          </div>
        </>
      )}

      <canvas ref={rawCanvasRef} style={{ display: "none" }} />

      {err ? (
        <div style={{ marginTop: 10, fontSize: 13, color: "#b91c1c" }}>
          {err}
        </div>
      ) : null}

      {!canUseMedia ? (
        <div style={{ marginTop: 10, fontSize: 13, color: "#b45309" }}>
          この環境ではカメラが利用できません（getUserMedia非対応）。
        </div>
      ) : null}
    </div>
  );
}
