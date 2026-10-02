/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/** Extracted from App.jsx on 2026-10-02 (App.jsx split, slice 1). */
const mono="'JetBrains Mono','SF Mono',monospace";
const sans="'Inter',-apple-system,sans-serif";
export function CaptureCardVertical({label,side,image,onImage,onOpenCamera,quality}){
  const isFront = side === "front";
  const accentColor = isFront ? "#6366f1" : "#8b5cf6";
  const hasWarnings = quality?.warnings?.length > 0;
  const hasHighSeverity = quality?.warnings?.some(w => w.severity === 'high');

  return(
    <div style={{marginBottom:hasWarnings?0:0}}>
      <div
        onClick={!image ? ()=>onOpenCamera(side) : undefined}
        style={{
          display:"flex",
          alignItems:"stretch",
          background:"#0d0f13",
          border: hasHighSeverity ? "1px solid #ff663344" : image ? `1px solid ${accentColor}44` : "1px dashed #2a2d35",
          borderRadius: hasWarnings ? "12px 12px 0 0" : 12,
          overflow:"hidden",
          cursor: !image ? "pointer" : "default",
          transition:"all .2s",
        }}
      >
        {/* Image Preview Area */}
        <div style={{
          width:100,
          minHeight:140,
          background:"#0a0a0a",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          position:"relative",
          flexShrink:0,
        }}>
          {!image ? (
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#333" strokeWidth="1.5">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          ) : (
            <>
              <img src={image} alt="Card" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
              <div style={{position:"absolute",top:4,left:4,width:16,height:16,borderRadius:"50%",background:hasHighSeverity?"#ff6633":accentColor,display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{color:"#fff",fontSize:10,fontWeight:700}}>{hasHighSeverity?"!":"✓"}</span>
              </div>
            </>
          )}
        </div>

        {/* Info Area */}
        <div style={{flex:1,padding:"14px 16px",display:"flex",flexDirection:"column",justifyContent:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
            <span style={{fontFamily:mono,fontSize:13,fontWeight:700,color:image ? accentColor : "#666",textTransform:"uppercase"}}>{label}</span>
            {image && !hasHighSeverity && <span style={{fontFamily:mono,fontSize:11,color:"#00ff88",background:"rgba(0,255,136,.1)",padding:"2px 6px",borderRadius:4}}>Ready</span>}
            {image && hasHighSeverity && <span style={{fontFamily:mono,fontSize:11,color:"#ff6633",background:"rgba(255,102,51,.1)",padding:"2px 6px",borderRadius:4}}>Issues</span>}
          </div>

          {!image ? (
            <>
              <div style={{fontFamily:sans,fontSize:12,color:"#666",marginBottom:8}}>Tap to capture {label.toLowerCase()} of card</div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:"#00ff8866"}}/>
                <span style={{fontFamily:mono,fontSize:11,color:"#00ff8866"}}>Level guide + card detection</span>
              </div>
            </>
          ) : (
          <button
            onClick={(e)=>{e.stopPropagation();onImage(null);}}
            style={{
              alignSelf:"flex-start",
              padding:"6px 12px",
              background:"rgba(255,68,68,.1)",
              border:"1px solid rgba(255,68,68,.2)",
              borderRadius:6,
              color:"#ff6666",
              fontFamily:mono,
              fontSize:10,
              cursor:"pointer",
            }}
          >
            ✕ Remove
          </button>
        )}
      </div>
    </div>

    {/* Photo Quality Warnings */}
    {image && hasWarnings && (
      <div style={{
        padding:"10px 14px",
        background: hasHighSeverity ? "rgba(255,102,51,.08)" : "rgba(255,170,0,.08)",
        borderTop: "none",
        borderLeft: `1px solid ${hasHighSeverity ? "#ff663333" : "#ffaa0033"}`,
        borderRight: `1px solid ${hasHighSeverity ? "#ff663333" : "#ffaa0033"}`,
        borderBottom: `1px solid ${hasHighSeverity ? "#ff663333" : "#ffaa0033"}`,
        borderRadius: "0 0 12px 12px",
      }}>
        {quality.warnings.map((w, i) => (
          <div key={i} style={{display:"flex",alignItems:"flex-start",gap:8,marginBottom:i<quality.warnings.length-1?6:0}}>
            <span style={{color:w.severity==='high'?"#ff6633":"#ffaa00",fontSize:12}}>⚠</span>
            <span style={{fontFamily:sans,fontSize:11,color:"#999",lineHeight:1.4}}>{w.message}</span>
          </div>
        ))}
      </div>
    )}
    </div>
  );
}
