/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/** Extracted from App.jsx on 2026-10-02 (App.jsx split, slice 1). */
import { useState, useRef, useCallback, useEffect } from "react";
import { loadImg } from "../../lib/image-utils.js";
import { findBounds } from "../../lib/detectors.js";
import { markModelPass } from "../../services/cornerEdgeModels.js";
import { preloadCardModel, liveCardQuad, detectCardInSource } from "../../services/cardModels.js";
const mono="'JetBrains Mono','SF Mono',monospace";
/* ═══════════════════════════════════════════
   MANUAL BOUNDARY EDITOR
   Drag handles for outer (card edge) and
   inner (artwork border) boundaries.
   Corrects centering + re-runs analysis.
   ═══════════════════════════════════════════ */

/* Lightweight card detection for live preview (runs on small canvas) */
export function detectCardLive(video, scanW=320) {
  const vw=video.videoWidth, vh=video.videoHeight;
  if(!vw||!vh) return null;
  const scale=scanW/vw, scanH=~~(vh*scale);
  const c=document.createElement("canvas"); c.width=scanW; c.height=scanH;
  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(video,0,0,scanW,scanH);
  const data=ctx.getImageData(0,0,scanW,scanH).data;
  const bounds=findBounds(data,scanW,scanH);
  if(bounds.cardW<scanW*0.12||bounds.cardH<scanH*0.12) return null;
  const asp=bounds.cardW/bounds.cardH, idealAsp=2.5/3.5;
  // Relaxed from 0.2 to 0.25 — handles slight tilt without dropping detection
  if(Math.abs(asp-idealAsp)>0.25) return null;
  return {
    left: (bounds.left/scanW)*100,
    top: (bounds.top/scanH)*100,
    width: (bounds.cardW/scanW)*100,
    height: (bounds.cardH/scanH)*100,
    fill: (bounds.cardW*bounds.cardH)/(scanW*scanH)*100,
    aspectOk: Math.abs(asp-idealAsp)<0.12,
  };
}

/* Live outline helpers (viewfinder). Corners are fractions of the video frame. */
export const LIVE_INTERVAL_MS = { webgpu: 120, wasm: 300, grid: 350 }; // between frames, per backend — battery over frame rate
export const LIVE_LOCK_MOVE = 0.012;   // a corner moving less than this (fraction of the frame) between frames counts as steady
export const LIVE_LOCK_FRAMES = 3;     // steady frames before the box reads "locked"
export const AUTO_SNAP_MS = 2500;      // the box must stay locked this long before the photo takes itself
export const AUTO_SNAP_KEY = 'slabsense_autoSnap';
export const autoSnapEnabled = () => { try { return localStorage.getItem(AUTO_SNAP_KEY) !== '0'; } catch { return true; } };
export const CORNER_KEYS = ['tl', 'tr', 'br', 'bl'];
export const blendCorners = (prev, next, a) => Object.fromEntries(CORNER_KEYS.map(k => [k, { x: prev[k].x + (next[k].x - prev[k].x) * a, y: prev[k].y + (next[k].y - prev[k].y) * a }]));
export const maxCornerMove = (a, b) => Math.max(...CORNER_KEYS.map(k => Math.hypot(a[k].x - b[k].x, a[k].y - b[k].y)));
/** Frame fractions -> percent of the element the video is drawn in (object-fit: cover). */
export function coverToScreen(corners, video) {
  const vw = video.videoWidth || 1, vh = video.videoHeight || 1, cw = video.clientWidth || vw, ch = video.clientHeight || vh;
  const sc = Math.max(cw / vw, ch / vh), ox = (cw - vw * sc) / 2, oy = (ch - vh * sc) / 2;
  return CORNER_KEYS.map(k => [((corners[k].x * vw * sc + ox) / cw) * 100, ((corners[k].y * vh * sc + oy) / ch) * 100]);
}

export function CameraViewfinder({ side, onCapture, onClose }) {
  const videoRef = useRef(null);
  // Warm the card model (6 MB) while the user frames the shot, so the centering tool
  // can pre-place the card edge the moment the photo is taken.
  useEffect(() => { preloadCardModel(); }, []);
  const streamRef = useRef(null);
  const [active, setActive] = useState(false);
  const [tilt, setTilt] = useState({ beta:0, gamma:0 });
  const [orientPerm, setOrientPerm] = useState("unknown");
  const [captured, setCaptured] = useState(null);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState(null);
  const [camError, setCamError] = useState(null);
  const [cardOutline, setCardOutline] = useState(null);
  const [cardStable, setCardStable] = useState(0); // frames card has been stable
  const [autoSnap, setAutoSnap] = useState(autoSnapEnabled); // photo takes itself after a steady lock
  const [autoProgress, setAutoProgress] = useState(0);         // 0..1 of AUTO_SNAP_MS while locked
  const captureRef = useRef(null);                               // latest captureFrame, for the timer
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [hasCamera, setHasCamera] = useState(null); // null = checking, true/false = result
  const fileRef = useRef(null);
  const detectRef = useRef(null);

  // Check for camera availability first
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // First check if any video input devices exist
        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = devices.filter(d => d.kind === 'videoinput');

        if (videoInputs.length === 0) {
          // No camera - go straight to upload mode
          if (!cancelled) {
            setHasCamera(false);
            setCamError(null); // Not an error, just no camera
          }
          return;
        }

        // Camera exists, try to access it
        setHasCamera(true);
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode:"environment", width:{ideal:4096}, height:{ideal:3072} }, audio:false,
        });
        if (cancelled) { stream.getTracks().forEach(t=>t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
        setActive(true);
      } catch(err) {
        if (!cancelled) {
          setHasCamera(false);
          setCamError(err.name==="NotAllowedError"?"Camera permission denied":"Camera not available");
        }
      }
    })();
    return () => { cancelled=true; streamRef.current?.getTracks().forEach(t=>t.stop()); };
  }, []);

  // Live card detection loop. The card model draws the true outline (it follows a tilted or
  // rotated card) once it has loaded; until then, or with the models off, the texture-grid
  // detector draws its upright box as before. Frames are paced per backend, skipped while the
  // tab is hidden, and the corners are smoothed so hand jitter does not reset the lock.
  useEffect(() => {
    if (!active || captured) return;
    let running = true;
    let stableCount = 0;
    let smooth = null;
    markModelPass(true);

    const detect = async () => {
      if (!running || !videoRef.current) return;
      const t0 = performance.now();
      let interval = LIVE_INTERVAL_MS.grid;
      try {
        const v = videoRef.current;
        let corners = null, fill = 0, source = 'grid', ms = 0;
        if (document.visibilityState !== 'hidden') {
          const live = await liveCardQuad(v);
          if (live.ok) { corners = live.corners; fill = live.fill; source = live.backend || 'model'; ms = live.ms; interval = LIVE_INTERVAL_MS[live.backend] || LIVE_INTERVAL_MS.wasm; }
          else if (live.reason === 'no-card') { source = 'model'; interval = LIVE_INTERVAL_MS.wasm; }
          else {
            const r = detectCardLive(v);
            if (r) { corners = { tl: { x: r.left / 100, y: r.top / 100 }, tr: { x: (r.left + r.width) / 100, y: r.top / 100 }, br: { x: (r.left + r.width) / 100, y: (r.top + r.height) / 100 }, bl: { x: r.left / 100, y: (r.top + r.height) / 100 } }; fill = r.fill; }
          }
        }
        if (!running) return;
        if (corners && fill > 15 && fill < 92) {
          const moved = smooth ? maxCornerMove(smooth, corners) : 1;
          smooth = smooth ? blendCorners(smooth, corners, 0.5) : corners;
          stableCount = moved < LIVE_LOCK_MOVE ? Math.min(stableCount + 1, 15) : 1;
          setCardOutline({ pts: coverToScreen(smooth, v), fill, source, ms });
          setCardStable(stableCount);
        } else {
          stableCount = 0; smooth = null;
          setCardOutline(null); setCardStable(0);
        }
      } catch(e) { /* ignore detection errors on live frames */ }
      if (running) detectRef.current = setTimeout(detect, Math.max(0, interval - (performance.now() - t0)));
    };

    detectRef.current = setTimeout(detect, 500);
    return () => { running=false; clearTimeout(detectRef.current); markModelPass(false); };
  }, [active, captured]);

  const tiltHandler = useCallback(e => setTilt({ beta:Math.round((e.beta||0)*10)/10, gamma:Math.round((e.gamma||0)*10)/10 }), []);
  useEffect(() => {
    if (typeof DeviceOrientationEvent!=="undefined" && typeof DeviceOrientationEvent.requestPermission==="function") {
      setOrientPerm("needs-request");
    } else if (typeof DeviceOrientationEvent!=="undefined") {
      window.addEventListener("deviceorientation",tiltHandler); setOrientPerm("granted");
    }
    // one cleanup covers both paths (the permission path adds the same handler later; audit E-15)
    return () => window.removeEventListener("deviceorientation",tiltHandler);
  }, [tiltHandler]);

  const requestOrient = async () => {
    try {
      const p = await DeviceOrientationEvent.requestPermission();
      if (p==="granted") { setOrientPerm("granted"); window.addEventListener("deviceorientation",tiltHandler); }
    } catch { setOrientPerm("denied"); }
  };

  const isLevel=Math.abs(tilt.beta)<2&&Math.abs(tilt.gamma)<2;
  const isClose=Math.abs(tilt.beta)<5&&Math.abs(tilt.gamma)<5;
  const lvlColor=isLevel?"#00ff88":isClose?"#ffcc00":"#ff4444";
  const bx=Math.max(-20,Math.min(20,tilt.gamma*2)), by=Math.max(-20,Math.min(20,tilt.beta*2));
  
  const cardLocked = cardOutline && cardStable >= LIVE_LOCK_FRAMES;
  const cardFound = Boolean(cardOutline);
  // Pressing the shutter is what shakes the phone, so a lock that holds for AUTO_SNAP_MS takes the
  // photo by itself. Only the model's lock counts (the grid box can lock on a patterned table), and
  // any drop of the lock resets the countdown.
  const autoArmed = autoSnap && cardLocked && !captured && cardOutline?.source !== 'grid';
  useEffect(() => {
    if (!autoArmed) { setAutoProgress(0); return; }
    const t0 = performance.now();
    let fired = false;
    const id = setInterval(() => {
      const p = Math.min(1, (performance.now() - t0) / AUTO_SNAP_MS);
      setAutoProgress(p);
      if (p >= 1 && !fired) { fired = true; clearInterval(id); captureRef.current?.(); }
    }, 50);
    return () => { clearInterval(id); setAutoProgress(0); };
  }, [autoArmed]);

  const captureFrame = () => {
    if(!videoRef.current) return;
    const v=videoRef.current, c=document.createElement("canvas");
    c.width=v.videoWidth; c.height=v.videoHeight;
    c.getContext("2d").drawImage(v,0,0);
    const dataUrl=c.toDataURL("image/jpeg",0.92);
    setCaptured(dataUrl); setValidating(true);
    validateCap(dataUrl).then(r=>{setValidation(r);setValidating(false);});
  };

  captureRef.current = captureFrame;
  const acceptCapture = () => { streamRef.current?.getTracks().forEach(t=>t.stop()); onCapture(captured); };
  const retake = () => {
    setCaptured(null);
    setValidation(null);
    setCardOutline(null);
    setCardStable(0);
    // Restart video playback after unhiding
    if (videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  };
  const closeCam = () => { streamRef.current?.getTracks().forEach(t=>t.stop()); onClose(); };
  const handleFile = async (e) => {
    let f = e.target.files?.[0];
    if (!f) return;

    // Reset states
    setUploadError(null);
    setIsUploading(true);

    // Check file size (max 25MB before processing)
    const maxFileSize = 25 * 1024 * 1024;
    if (f.size > maxFileSize) {
      setUploadError(`File too large (${Math.round(f.size/1024/1024)}MB). Max 25MB.`);
      setIsUploading(false);
      return;
    }

    // Check file type - allow common image formats including HEIC
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif', 'image/bmp'];
    const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.gif', '.bmp'];
    const fileName = f.name.toLowerCase();
    const hasValidType = f.type.startsWith('image/') || validTypes.includes(f.type);
    const hasValidExt = validExtensions.some(ext => fileName.endsWith(ext));

    if (!hasValidType && !hasValidExt) {
      setUploadError('Please select an image file (JPG, PNG, WebP, HEIC)');
      setIsUploading(false);
      return;
    }

    // HEIC works on mobile (iOS Safari) but not desktop browsers
    // Check if HEIC and on desktop - show convert message
    const isHeic = fileName.endsWith('.heic') || fileName.endsWith('.heif') ||
                   f.type === 'image/heic' || f.type === 'image/heif';
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    if (isHeic && !isMobile) {
      setUploadError('HEIC not supported on desktop. Please convert to JPG first.');
      setIsUploading(false);
      return;
    }

    // Process the image (now guaranteed to be browser-compatible format)
    const processImage = (file) => {
      const r = new FileReader();
      r.onerror = () => {
        setUploadError('Failed to read file');
        setIsUploading(false);
      };
      r.onload = ev => {
        const img = new Image();
        img.onerror = () => {
          setUploadError('Failed to load image. Try a different file.');
          setIsUploading(false);
        };
        img.onload = () => {
          try {
            // Use full resolution - no resize. AI grades upload the photo to the Supabase
            // bucket and send the URL, so the model always sees full resolution.
            const c = document.createElement('canvas');
            c.width = img.width; c.height = img.height;
            c.getContext('2d').drawImage(img, 0, 0);
            const d = c.toDataURL('image/jpeg', 0.95); // Higher quality for full-res
            setCaptured(d);
            setIsUploading(false);
            setValidating(true);
            validateCap(d).then(r => { setValidation(r); setValidating(false); });
          } catch (err) {
            setUploadError('Failed to process image');
            setIsUploading(false);
          }
        };
        img.src = ev.target.result;
      };
      r.readAsDataURL(file);
    };

    processImage(f);
  };

  return (
    <div style={{position:"fixed",inset:0,zIndex:1000,background:"#000",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"12px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(0,0,0,.8)",zIndex:10}}>
        <button onClick={closeCam} style={{background:"transparent",border:"none",color:"#888",fontFamily:mono,fontSize:12,cursor:"pointer"}}>✕ Cancel</button>
        <div style={{fontFamily:mono,fontSize:12,color:"#fff",textTransform:"uppercase",letterSpacing:".1em"}}>Capture {side}</div>
        <button onClick={()=>{const next=!autoSnap;setAutoSnap(next);try{localStorage.setItem(AUTO_SNAP_KEY,next?'1':'0');}catch{/* private mode */}}} aria-label={`Auto snap ${autoSnap?'on':'off'}`}
          style={{width:60,background:"transparent",border:`1px solid ${autoSnap?"#00ff8866":"#333"}`,borderRadius:6,padding:"4px 0",color:autoSnap?"#00ff88":"#666",fontFamily:mono,fontSize:11,letterSpacing:".08em",cursor:"pointer"}}>AUTO {autoSnap?"ON":"OFF"}</button>
      </div>

      <div style={{flex:1,position:"relative",overflow:"hidden"}}>
        {/* Checking for camera */}
        {hasCamera === null && !captured && (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",padding:32}}>
            <div style={{fontFamily:mono,fontSize:12,color:"#666"}}>Checking camera...</div>
          </div>
        )}

        {/* No camera available - show upload-focused UI */}
        {hasCamera === false && !captured && (
          <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:"100%",padding:32}}>
            {camError && (
              <div style={{fontFamily:mono,fontSize:11,color:"#ff9944",marginBottom:20,textAlign:"center"}}>{camError}</div>
            )}
            <div
              onClick={()=>!isUploading && fileRef.current?.click()}
              onDragOver={(e)=>{e.preventDefault();e.stopPropagation();}}
              onDrop={(e)=>{
                e.preventDefault();
                e.stopPropagation();
                const file = e.dataTransfer.files?.[0];
                if (file && fileRef.current) {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  fileRef.current.files = dt.files;
                  handleFile({target: fileRef.current});
                }
              }}
              style={{
                width:"100%",
                maxWidth:300,
                aspectRatio:"2.5/3.5",
                border:"2px dashed #333",
                borderRadius:16,
                display:"flex",
                flexDirection:"column",
                alignItems:"center",
                justifyContent:"center",
                cursor:isUploading?"wait":"pointer",
                background:"#0d0f13",
                transition:"all .2s",
              }}
            >
              {isUploading ? (
                <>
                  <div style={{width:40,height:40,border:"3px solid #333",borderTopColor:"#00ff88",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
                  <div style={{fontFamily:mono,fontSize:12,color:"#00ff88",marginTop:16}}>Processing image...</div>
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                </>
              ) : (
                <>
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#444" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                    <polyline points="17,8 12,3 7,8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <div style={{fontFamily:mono,fontSize:13,color:"#888",marginTop:16}}>Drop image here</div>
                  <div style={{fontFamily:mono,fontSize:11,color:"#555",marginTop:4}}>or click to browse</div>
                </>
              )}
            </div>
            {uploadError && (
              <div style={{fontFamily:mono,fontSize:11,color:"#ff4444",marginTop:16,textAlign:"center"}}>{uploadError}</div>
            )}
            <div style={{fontFamily:mono,fontSize:10,color:"#444",marginTop:20,textAlign:"center"}}>
              Supports JPG, PNG, WebP, HEIC • Max 25MB
            </div>
            <input ref={fileRef} type="file" accept="image/*,.heic,.heif" onChange={handleFile} style={{display:"none"}}/>
          </div>
        )}

        {/* Camera available - show video */}
        {hasCamera === true && (
          <video ref={videoRef} playsInline muted style={{width:"100%",height:"100%",objectFit:"cover",display:captured?"none":"block"}}/>
        )}
        {/* Camera overlay - only show when not captured */}
        {!captured && active && (
            <svg style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
              {/* Dim overlay with cutout - use detected card or static guide */}
              {cardFound ? (<>
                {/* Live detected card outline: a true quadrilateral in percent of the view, drawn in a
                    0-100 space stretched over the frame; strokes stay constant width. */}
                <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="100%" data-live={`${cardOutline.source} ${Math.round(cardOutline.ms)}ms`}>
                  <defs><mask id="cm"><rect width="100" height="100" fill="white"/><polygon points={cardOutline.pts.map(p=>p.join(',')).join(' ')} fill="black"/></mask></defs>
                  <rect width="100" height="100" fill="rgba(0,0,0,.5)" mask="url(#cm)"/>
                  <polygon points={cardOutline.pts.map(p=>p.join(',')).join(' ')} fill="none" stroke={cardLocked?"#00ff88":"#ffcc00"} strokeWidth={cardLocked?"2.5":"1.5"} vectorEffect="non-scaling-stroke" style={{transition:"stroke .2s ease"}}/>
                  {/* Corner brackets along the card's own edges */}
                  {cardOutline.pts.map((p,i)=>{
                    const n=cardOutline.pts[(i+1)%4], m=cardOutline.pts[(i+3)%4];
                    const seg=(q)=>[p[0]+(q[0]-p[0])*0.12,p[1]+(q[1]-p[1])*0.12];
                    const a=seg(n), b=seg(m);
                    return(<g key={i} stroke={cardLocked?"#00ff88":"#ffcc00"} strokeWidth="3">
                      <line x1={p[0]} y1={p[1]} x2={a[0]} y2={a[1]} vectorEffect="non-scaling-stroke"/>
                      <line x1={p[0]} y1={p[1]} x2={b[0]} y2={b[1]} vectorEffect="non-scaling-stroke"/>
                    </g>);
                  })}
                </svg>
              </>):(<>
                {/* Static guide when no card detected */}
                <defs><mask id="cm"><rect width="100%" height="100%" fill="white"/><rect x="15%" y="12%" width="70%" height="76%" rx="8" fill="black"/></mask></defs>
                <rect width="100%" height="100%" fill="rgba(0,0,0,.45)" mask="url(#cm)"/>
                <rect x="15%" y="12%" width="70%" height="76%" rx="8" fill="none" stroke="#ffffff33" strokeWidth="1.5" strokeDasharray="8,6"/>
              </>)}
              {/* Center crosshair */}
              <line x1="49%" y1="50%" x2="51%" y2="50%" stroke="rgba(255,255,255,.2)" strokeWidth="1"/>
              <line x1="50%" y1="49%" x2="50%" y2="51%" stroke="rgba(255,255,255,.2)" strokeWidth="1"/>
              {/* Status text */}
              <text x="50%" y="7%" textAnchor="middle" fill={cardLocked?"#00ff88":cardFound?"#ffcc00":"rgba(255,255,255,.4)"} fontSize="11" fontFamily={mono}>
                {autoArmed?`✓ LOCKED — HOLD STILL, SNAPPING IN ${Math.max(1,Math.ceil((1-autoProgress)*AUTO_SNAP_MS/1000))}`:cardLocked?"✓ CARD LOCKED — READY TO SNAP":cardFound?"CARD DETECTED — HOLD STEADY":"ALIGN CARD WITHIN FRAME"}
              </text>
              {/* Fill percentage */}
              {cardFound&&<text x="50%" y="95%" textAnchor="middle" fill="#00ff8888" fontSize="10" fontFamily={mono}>
                {Math.round(cardOutline.fill)}% fill
              </text>}
            </svg>
          )}

          {/* Bubble level */}
          {orientPerm==="granted"&&active&&(
            <div style={{position:"absolute",bottom:100,left:"50%",transform:"translateX(-50%)",display:"flex",flexDirection:"column",alignItems:"center",gap:6}}>
              <div style={{width:56,height:56,borderRadius:"50%",border:`2px solid ${lvlColor}44`,background:"rgba(0,0,0,.5)",position:"relative",display:"flex",alignItems:"center",justifyContent:"center"}}>
                <div style={{position:"absolute",width:10,height:1,background:`${lvlColor}33`}}/>
                <div style={{position:"absolute",width:1,height:10,background:`${lvlColor}33`}}/>
                <div style={{position:"absolute",width:12,height:12,borderRadius:"50%",border:`1px solid ${lvlColor}44`}}/>
                <div style={{width:10,height:10,borderRadius:"50%",background:lvlColor,boxShadow:`0 0 8px ${lvlColor}66`,transform:`translate(${bx}px,${by}px)`,transition:"transform .1s ease-out"}}/>
              </div>
              <div style={{fontFamily:mono,fontSize:11,color:lvlColor,textTransform:"uppercase",letterSpacing:".1em"}}>{isLevel?"✓ Level":isClose?"Almost level":"Tilted"}</div>
            </div>
          )}
        {/* Bubble level permission request */}
        {!captured && orientPerm==="needs-request" && active && (
          <button onClick={requestOrient} style={{position:"absolute",bottom:110,left:"50%",transform:"translateX(-50%)",padding:"8px 16px",background:"rgba(0,255,136,.15)",border:"1px solid #00ff8844",borderRadius:8,color:"#00ff88",fontFamily:mono,fontSize:10,cursor:"pointer"}}>Enable Level</button>
        )}

        {/* Captured image preview */}
        {captured && (
          <div style={{width:"100%",height:"100%",position:"relative"}}>
            <img src={captured} alt="Captured card" style={{width:"100%",height:"100%",objectFit:"contain"}}/>
            {validating&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",background:"rgba(0,0,0,.6)"}}><div style={{fontFamily:mono,fontSize:12,color:"#00ff88"}}>Checking card detection...</div></div>}
            {validation&&(
              <div style={{position:"absolute",bottom:0,left:0,right:0,padding:16,background:"linear-gradient(transparent,rgba(0,0,0,.9))"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:validation.valid?"#00ff88":"#ff4444"}}/>
                  <span style={{fontFamily:mono,fontSize:12,color:validation.valid?"#00ff88":"#ff4444"}}>{validation.valid?"Card detected — good capture":"Issues detected"}</span>
                </div>
                {validation.valid&&<div style={{fontFamily:mono,fontSize:10,color:"#666"}}>Card fills {validation.fillRatio}% of frame</div>}
                {!validation.valid&&validation.issues.map((is,i)=><div key={i} style={{fontFamily:mono,fontSize:10,color:"#ff9944"}}>⚠ {is}</div>)}
              </div>
            )}
          </div>
        )}
      </div>

      <div style={{padding:"16px 20px 28px",background:"rgba(0,0,0,.9)",display:"flex",alignItems:"center",justifyContent:"center",gap:20}}>
        {!captured ? (
          hasCamera === false ? (
            /* Upload-only mode - no shutter button needed, upload UI is above */
            <div style={{fontFamily:mono,fontSize:11,color:"#555"}}>
              {isUploading ? "Processing..." : "Select an image above"}
            </div>
          ) : (
            /* Camera mode - show shutter + upload button */
            <>
              <button onClick={()=>fileRef.current?.click()} aria-label="Choose a photo" style={{width:40,height:40,borderRadius:"50%",background:"transparent",border:"1px solid #444",color:"#888",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer"}}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
              </button>
              <input ref={fileRef} type="file" accept="image/*,.heic,.heif" onChange={handleFile} style={{display:"none"}}/>
              {/* Shutter button - changes color when card locked */}
              <button onClick={captureFrame} disabled={!active} aria-label="Take photo" style={{position:"relative",width:68,height:68,borderRadius:"50%",background:"transparent",border:`4px solid ${cardLocked?"#00ff88":active?"#fff":"#444"}`,cursor:active?"pointer":"default",display:"flex",alignItems:"center",justifyContent:"center",transition:"border-color .3s"}}>
                <div style={{width:56,height:56,borderRadius:"50%",background:cardLocked?"#00ff88":active?"#fff":"#333",transition:"all .3s"}}/>
                {autoArmed&&<svg data-autosnap={autoProgress.toFixed(2)} style={{position:"absolute",inset:-8,width:76,height:76,transform:"rotate(-90deg)",pointerEvents:"none"}} viewBox="0 0 76 76">
                  <circle cx="38" cy="38" r="35" fill="none" stroke="#000" strokeWidth="3"/>
                  <circle cx="38" cy="38" r="35" fill="none" stroke="#fff" strokeWidth="3" strokeDasharray={`${2*Math.PI*35}`} strokeDashoffset={`${2*Math.PI*35*(1-autoProgress)}`} strokeLinecap="round"/>
                </svg>}
              </button>
              <div style={{width:40}}/>
            </>
          )
        ) : (
          /* Image captured - show retake/use buttons */
          <>
            <button onClick={retake} style={{padding:"12px 24px",background:"transparent",border:"1px solid #444",borderRadius:10,color:"#fff",fontFamily:mono,fontSize:12,cursor:"pointer"}}>{hasCamera === false ? "Choose Different" : "Retake"}</button>
            <button onClick={acceptCapture} style={{padding:"12px 24px",background:validation?.valid?"#00ff88":"rgba(0,255,136,.3)",border:"none",borderRadius:10,color:"#000",fontFamily:mono,fontSize:12,fontWeight:700,cursor:"pointer"}}>{validation?.valid?"✓ Use Photo":"Use Anyway"}</button>
          </>
        )}
      </div>
    </div>
  );
}

/* Post-capture validation */
export async function validateCap(src){
  // The card model when it runs (a sleeve or slab reads as "not found"); the texture-grid
  // detector when the models are off or fail to load.
  const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('load'));i.src=src;});
  const m=await detectCardInSource(img);
  if(m.ok||m.reason==='no-card'){
    const issues=[];
    if(!m.ok)issues.push("Card not found — use a plain, contrasting background and take the card out of any sleeve or case");
    const fill=m.ok?m.fill:0;
    if(m.ok&&fill<20)issues.push("Card too small — move closer");
    if(m.ok&&fill>=95)issues.push("Too close — back up slightly");
    if(m.ok){
      const q=m.quad, len=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
      const tb=len(q.tl,q.tr)/len(q.bl,q.br), lr=len(q.tl,q.bl)/len(q.tr,q.br);
      if(Math.max(tb,1/tb)>1.08||Math.max(lr,1/lr)>1.08)issues.push("Card may be tilted — hold the phone flat over it");
    }
    return{valid:issues.length===0,fillRatio:~~fill,issues,source:'model',corners:m.ok?m.corners:null};
  }
  const{w,h,data}=await loadImg(src,600);const bn=findBounds(data.data,w,h);const fill=bn.cardW*bn.cardH/(w*h),asp=bn.cardH>0?bn.cardW/bn.cardH:0,aDiff=Math.abs(asp-2.5/3.5);const ok=bn.cardW>50&&bn.cardH>50&&fill>.2&&fill<.95&&aDiff<.15;const issues=[];if(bn.cardW<=50)issues.push("Card not detected — use contrasting background");if(fill<.2&&bn.cardW>50)issues.push("Card too small — move closer");if(fill>=.95)issues.push("Too close — back up slightly");if(aDiff>=.15&&bn.cardW>50)issues.push("Card may be tilted");return{valid:ok,fillRatio:~~(fill*100),issues,source:'grid'};
}

/* Image Capture - Vertical stack layout (horizontal card with image left, info right) */
