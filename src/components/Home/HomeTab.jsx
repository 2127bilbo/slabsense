/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
/** Extracted from App.jsx on 2026-10-02 (App.jsx split, slice 1). */
const mono="'JetBrains Mono','SF Mono',monospace";
const sans="'Inter',-apple-system,sans-serif";
/* ═══════════════════════════════════════════
   HOME TAB - Portfolio & Dashboard
   ═══════════════════════════════════════════ */
export function HomeTab({ auth, onOpenCollection, onStartScan, collectionStats }) {
  // Real data from collection (passed from parent)
  const portfolio = {
    totalValue: collectionStats?.totalValue || 0,
    cardCount: collectionStats?.totalCards || 0,
    avgGrade: collectionStats?.avgGrade || 0,
  };

  return (
    <div style={{padding:16,flex:1,overflowY:"auto"}}>
      {/* Welcome Header */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:22,fontWeight:700,color:"#fff",marginBottom:4}}>
          {auth?.isAuthenticated ? `Hey, ${auth.profile?.display_name || 'Collector'}` : 'Welcome to SlabSense'}
        </div>
        <div style={{fontFamily:mono,fontSize:11,color:"#666"}}>
          {auth?.isAuthenticated ? 'Your card grading dashboard' : 'Sign in to track your collection'}
        </div>
      </div>

      {/* Quick Action - Scan Card */}
      <button
        onClick={onStartScan}
        style={{
          width:"100%",
          padding:"16px 20px",
          marginBottom:16,
          borderRadius:12,
          border:"none",
          background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
          color:"#fff",
          fontFamily:sans,
          fontSize:14,
          fontWeight:600,
          cursor:"pointer",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          gap:10,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
        Grade a Card
      </button>

      {/* Portfolio Summary */}
      {auth?.isAuthenticated && (
        <div style={{
          padding:16,
          background: portfolio.totalValue > 0 ? "rgba(0,255,136,0.05)" : "#0d0f13",
          borderRadius:12,
          border: portfolio.totalValue > 0 ? "1px solid rgba(0,255,136,0.15)" : "1px solid #1a1c22",
          marginBottom:16,
        }}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <span style={{fontFamily:mono,fontSize:10,color: portfolio.totalValue > 0 ? "#00ff88" : "#888",textTransform:"uppercase",letterSpacing:".1em"}}>Collection Value</span>
          </div>

          <div style={{display:"flex",alignItems:"baseline",gap:8,marginBottom:4}}>
            <span style={{fontSize:32,fontWeight:800,color:portfolio.totalValue > 0 ? "#00ff88" : "#555"}}>
              ${portfolio.totalValue > 0 ? portfolio.totalValue.toFixed(2) : '0.00'}
            </span>
          </div>
          <div style={{fontFamily:mono,fontSize:10,color:"#555"}}>
            {portfolio.totalValue > 0 ? 'Raw card values · Cardmarket via TCGdex' : 'Add cards with pricing to see value'}
          </div>
        </div>
      )}

      {/* Stats Grid */}
      {auth?.isAuthenticated && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:12,marginBottom:16}}>
          <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22"}}>
            <div style={{fontFamily:mono,fontSize:11,color:"#888",textTransform:"uppercase",marginBottom:6}}>Cards Graded</div>
            <div style={{fontSize:24,fontWeight:700,color:"#fff"}}>{portfolio.cardCount}</div>
          </div>
          <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22"}}>
            <div style={{fontFamily:mono,fontSize:11,color:"#888",textTransform:"uppercase",marginBottom:6}}>Avg Grade</div>
            <div style={{fontSize:24,fontWeight:700,color:portfolio.avgGrade >= 8 ? "#00ff88" : portfolio.avgGrade >= 6 ? "#ffcc00" : "#ff6633"}}>
              {portfolio.avgGrade > 0 ? portfolio.avgGrade.toFixed(1) : '—'}
            </div>
          </div>
        </div>
      )}

      {/* View Collection Button */}
      {auth?.isAuthenticated && portfolio.cardCount > 0 && (
        <button
          onClick={onOpenCollection}
          style={{
            width:"100%",
            padding:"14px 20px",
            marginBottom:16,
            borderRadius:10,
            border:"1px solid #1a1c22",
            background:"#0d0f13",
            color:"#888",
            fontFamily:mono,
            fontSize:12,
            cursor:"pointer",
            display:"flex",
            alignItems:"center",
            justifyContent:"space-between",
          }}
        >
          <span>View Collection</span>
          <span style={{color:"#555"}}>{portfolio.cardCount} cards →</span>
        </button>
      )}

      {/* Not Signed In */}
      {!auth?.isAuthenticated && (
        <div style={{
          padding:24,
          background:"#0d0f13",
          borderRadius:12,
          border:"1px solid #1a1c22",
          textAlign:"center",
        }}>
          <div style={{fontSize:32,marginBottom:12}}>📊</div>
          <div style={{fontSize:14,fontWeight:600,color:"#ddd",marginBottom:8}}>Track Your Collection</div>
          <div style={{fontSize:12,color:"#666",marginBottom:16,lineHeight:1.5}}>
            Sign in to save your graded cards, track portfolio value, and see your grading history.
          </div>
        </div>
      )}
    </div>
  );
}

/* Grade Confidence Calculator */
