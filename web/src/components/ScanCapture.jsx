import { useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";

/**
 * ScanCapture.jsx
 * - getUserMedia でカメラ起動
 * - OpenCV.js で書類検出（エッジ→輪郭→四隅推定）
 * - Perspective Transform で台形補正
 * - adaptive threshold で白黒最適化（FAXっぽく）
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
  const outCanvasRef = useRef(null); // 補正結果（白黒）
  const streamRef = useRef(null);

  const [camOn, setCamOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [opencvReady, setOpenCvReady] = useState(false);

  // device switching
  const [devices, setDevices] = useState([]); // videoinput
  const [deviceId, setDeviceId] = useState(""); // selected deviceId

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
      // ignore
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

    // 先に video を必ず描画しておく（←これが黒画面/要素なしエラー対策）
    setCamOn(true);
    await sleep(0);

    try {
      // 既に起動中なら一旦止める（切替時もここに来る）
      await stopCamera();
      setCamOn(true);
      await sleep(0);

      // permission後じゃないとlabelが空のことが多いので、
      // まず constraints を決めて getUserMedia → その後 enumerate でデバイス情報を更新する
      const constraints = {
        audio: false,
        video: (() => {
          if (forceDeviceId || deviceId) {
            return { deviceId: { exact: forceDeviceId || deviceId } };
          }
          // 端末により facingMode が効く/効かないがあるので "ideal" にしておく
          return preferRearCamera
            ? { facingMode: { ideal: "environment" } }
            : { facingMode: { ideal: "user" } };
        })(),
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      const v = videoRef.current;
      if (!v) {
        throw new Error("video 要素が見つかりません（描画タイミング）");
      }

      v.srcObject = stream;

      // iOS/一部Androidで play() が間に合わないことがあるので少し待つ
      await sleep(0);
      await v.play();

      // デバイス一覧を更新（permission後の方がlabelが入る）
      const vids = (await refreshDevices()) || [];

      // 初回だけ “背面っぽい” デバイスが見つかったら自動選択して切り替え（任意）
      if (!forceDeviceId && !deviceId && vids.length >= 2 && preferRearCamera) {
        const rearLike =
          vids.find((d) => /back|rear|environment/i.test(d.label)) || null;
        if (rearLike?.deviceId) {
          setDeviceId(rearLike.deviceId);
          // 今のstreamは停止して背面デバイスで取り直す
          await stopCamera();
          await sleep(0);
          return startCamera({ forceDeviceId: rearLike.deviceId });
        }
      }

      // selected deviceId を保持（取れた範囲で）
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
    // unmount cleanup
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

      const src = cv.imread(rawCanvas);
      const gray = new cv.Mat();
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      const blur = new cv.Mat();
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);

      const edges = new cv.Mat();
      cv.Canny(blur, edges, 60, 180);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(
        edges,
        contours,
        hierarchy,
        cv.RETR_LIST,
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
          if (area > bestArea) {
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
      blur.delete();

      if (!bestQuad || bestArea < cw * ch * 0.12) {
        gray.delete();
        src.delete();
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
      const warped = new cv.Mat();
      const dsize = new cv.Size(dstW, dstH);
      cv.warpPerspective(
        gray,
        warped,
        M,
        dsize,
        cv.INTER_LINEAR,
        cv.BORDER_CONSTANT,
        new cv.Scalar(),
      );

      const bw = new cv.Mat();
      cv.adaptiveThreshold(
        warped,
        bw,
        255,
        cv.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv.THRESH_BINARY,
        31,
        10,
      );

      outCanvas.width = dstW;
      outCanvas.height = dstH;
      cv.imshow(outCanvas, bw);

      bw.delete();
      warped.delete();
      M.delete();
      srcTri.delete();
      dstTri.delete();
      bestQuad.delete();
      gray.delete();
      src.delete();

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

    // 次のdeviceへ
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
      <div style={{ fontWeight: 800, marginBottom: 6 }}>スキャンして置く</div>
      <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 12 }}>
        紙を撮影 → 自動で台形補正 → 白黒最適化 → PDFにして「置く」に渡します
      </div>

      {/* ★重要：video は常に描画（camOnで表示/非表示だけ切替） */}
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={() => startCamera()}
            disabled={busy || !opencvReady}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(15, 23, 42, 0.18)",
              background: "white",
              fontWeight: 800,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            📷 カメラを起動
          </button>

          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "10px 14px",
              borderRadius: 12,
              border: "1px solid rgba(15, 23, 42, 0.12)",
              background: "transparent",
              fontWeight: 700,
              cursor: busy ? "not-allowed" : "pointer",
            }}
          >
            キャンセル
          </button>

          <div style={{ fontSize: 12, opacity: 0.7, alignSelf: "center" }}>
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
            }}
          >
            <button
              onClick={captureAndProcess}
              disabled={busy}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(15, 23, 42, 0.18)",
                background: "white",
                fontWeight: 800,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              {busy ? "処理中..." : "📄 撮ってPDF化"}
            </button>

            {canSwitch ? (
              <button
                onClick={switchCamera}
                disabled={busy}
                style={{
                  padding: "10px 14px",
                  borderRadius: 12,
                  border: "1px solid rgba(15, 23, 42, 0.12)",
                  background: "transparent",
                  fontWeight: 700,
                  cursor: busy ? "not-allowed" : "pointer",
                }}
              >
                🔁 カメラ切替
              </button>
            ) : null}

            <button
              onClick={stopCamera}
              disabled={busy}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(15, 23, 42, 0.12)",
                background: "transparent",
                fontWeight: 700,
                cursor: busy ? "not-allowed" : "pointer",
              }}
            >
              カメラ停止
            </button>

            <div style={{ fontSize: 12, opacity: 0.7, alignSelf: "center" }}>
              device:{" "}
              {deviceId
                ? devices.find((d) => d.deviceId === deviceId)?.label ||
                  "selected"
                : "auto"}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              プレビュー（補正後の白黒）
            </div>
            <canvas
              ref={outCanvasRef}
              style={{
                width: "100%",
                borderRadius: 14,
                border: "1px dashed rgba(15, 23, 42, 0.18)",
                background: "white",
              }}
            />
          </div>
        </>
      )}

      {/* hidden raw canvas */}
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
