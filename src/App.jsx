/*
 * SlabSense — https://www.slabsenseai.com
 * Copyright (c) 2026 SlabSense. All rights reserved.
 * Proprietary and confidential; see LICENSE at the repository root.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { GRADING_COMPANIES, getCompanyOptions, DEFAULT_GRADING_COMPANY } from "./utils/gradingScales.js";
import { shapeAiResult, shapeDeepResult } from "./services/api.js";
import { aiRecordFromResult, damageReportInputs } from "./lib/grade-records.js";
import { useAuth } from "./hooks/useAuth.js";
import { AuthModal } from "./components/Auth/AuthModal.jsx";
import { SetPasswordModal } from "./components/Auth/SetPasswordModal.jsx";
import { UserMenu } from "./components/Auth/UserMenu.jsx";
import { CollectionView } from "./components/Collection/CollectionView.jsx";
import { ExportCard } from "./components/Export/ExportCard.jsx";
import { ProfileSettings } from "./components/Settings/ProfileSettings.jsx";
import { upsertScan, logMissingImage, getUserScans } from "./services/scans.js";
import { CardCropModal } from "./components/CardCropModal.jsx";
import { claudeGradingAnalysis, deepGradingAnalysisV2 } from "./services/api.js";
import { CardViewer3D } from "./components/CardViewer/CardViewer3D.jsx";
import { CardIdentifier } from "./components/CardIdentifier/CardIdentifier.jsx";
import { PostCaptureCentering } from "./components/PostCaptureCentering/PostCaptureCentering.jsx";
import { HoloLogo } from "./components/HoloLogo/HoloLogo.jsx";
import { DamageReportModal } from "./components/DamageReport";
import { CreditBalance, PricingPage } from "./components/Billing";
import { NativeStore } from "./components/Billing/NativeStore.jsx";
import { isNativeApp } from "./lib/platform.js";
import { getGradeJob, getCreditsBalance, spendFreeGrade } from "./services/credits.js";
import { GradeGate } from "./components/Grading/GradeGate.jsx";
import { gradeButtonLabel } from "./components/Grading/gradeButtonLabel.js";
import { GRADE_TIERS, creditsLabel, PAID_GRADE_TYPE } from "./lib/grade-tiers.js";
import { getGyroInput } from "./lib/gyro-input.js";
import { genMaps } from "./lib/image-utils.js";
import { cropToOuterBounds } from "./lib/centering-utils.js";
import { computeGrade } from "./lib/softwareGrade.js";
import { modelGradingEnabled, cornerEdgeRequest } from "./services/cornerEdgeModels.js";
import { trainingCaptureEnabled, captureForTraining } from "./services/trainingCapture.js";
import { suggestOuterCorners, suggestInnerCorners } from "./services/cardModels.js";
import holoConfig from "../config/holo-config.json";
import { analyzePhotoQuality, formatCaps, analyzeCardFull } from "./lib/analysis-pipeline.js";
import { HomeTab } from "./components/Home/HomeTab.jsx";
import { calcConfidence, getNextGradeInfo } from "./lib/grade-insights.js";
import { CameraViewfinder } from "./components/Capture/CameraViewfinder.jsx";
import { CaptureCardVertical } from "./components/Capture/CaptureCardVertical.jsx";

/* ═══════════════════════════════════════════
   SLABSENSE (version from package.json via __APP_VERSION__)
   Multi-Company Card Pre-Grading Analysis Tool

   Supports: TAG, PSA, BGS, CGC, SGC

   DISCLAIMER: SlabSense is NOT affiliated with any grading company.
   All grades are ESTIMATES only. See /disclaimers (docs/legal/DISCLAIMERS.md) for full details.
   ═══════════════════════════════════════════ */

const mono="'JetBrains Mono','SF Mono',monospace", sans="'Inter',-apple-system,sans-serif";
const PERFECT_CENTER = { lrRatio: 50, tbRatio: 50 }; // For "ignore centering" mode


/* ═══════════════════════════════════════════
   MAIN APP
   ═══════════════════════════════════════════ */
export default function SlabSense(){
  // Unified tab state - single tab bar for everything
  const[tab,setTab]=useState("scan"); // 'home'|'scan'|'cards'|'grade'|'dings'|'centering'

  // Scan flow state
  const[step,setStep]=useState(0);
  const[fI,setFI]=useState(null),[bI,setBI]=useState(null);
  const[fR,setFR]=useState(null),[bR,setBR]=useState(null);
  const[fM,setFM]=useState(null),[bM,setBM]=useState(null);
  const[gradeResult,setGradeResult]=useState(null);
  const[prog,setProg]=useState("");
  const[analysisFailed,setAnalysisFailed]=useState(false); // the free analysis threw; show Try again instead of a spinner (audit I-07)
  const[camTarget,setCamTarget]=useState(null);
  const[manualMode,setManualMode]=useState(null); // 'front'|'back'|null
  const[centeringConfirmed,setCenteringConfirmed]=useState(false); // User confirmed edge alignment
  const[ignoreCentering,setIgnoreCentering]=useState(false); // Ignore centering in grade calculation
  const[gradingCompany,setGradingCompany]=useState(DEFAULT_GRADING_COMPANY); // Selected grading company

  // Photo quality state
  const[frontQuality,setFrontQuality]=useState(null);
  const[backQuality,setBackQuality]=useState(null);

  // UI state
  const[showDisclaimer,setShowDisclaimer]=useState(() => {
    // Only show disclaimer if user hasn't acknowledged it before
    return !localStorage.getItem('slabsense_disclaimer_acknowledged');
  });
  const[showAuthModal,setShowAuthModal]=useState(false); // Auth modal visibility
  const[savingStatus,setSavingStatus]=useState(null); // 'saving' | 'saved' | 'error' | null
  const[showCollection,setShowCollection]=useState(false); // Collection view visibility
  const[showExport,setShowExport]=useState(false); // Export modal visibility
  const[showDamageReport,setShowDamageReport]=useState(false); // Damage Report modal visibility
  const[showSettings,setShowSettings]=useState(false); // Settings modal visibility
  const[visionMode,setVisionMode]=useState('normal'); // 'normal'|'emboss'|'highpass'|'edges'
  const[visionIntensity,setVisionIntensity]=useState(50); // 0-100% intensity slider

  // Grade display mode
  const[gradeMode,setGradeMode]=useState('software'); // 'software' | 'ai' | 'deep' - which grade to display
  const[useAiCentering,setUseAiCentering]=useState(false); // Use AI centering in software grade calc
  const[aiCentering,setAiCentering]=useState(null); // AI centering data: { front: {lrRatio, tbRatio}, back: {...} }

  // 3D Viewer / AI Enhanced Cards state
  const[enhancedCards,setEnhancedCards]=useState(null); // { front, back } - AI cropped cards
  const[,setEnhancingStatus]=useState(null); // 'enhancing' | 'done' | 'error' | null
  const[deepGradeStatus,setDeepGradeStatus]=useState(null); // 'grading' | 'done' | 'error' | null
  const[deepGradeResult,setDeepGradeResult]=useState(null); // Deep AI grade result
  const[aiDefects,setAiDefects]=useState(null); // AI (standard) defects { counts, items }
  const[resumeJob,setResumeJob]=useState(null); // a finished AI grade job whose card is not loaded (offer to restore)
  const cardKeyRef=useRef(null);   // sha-256 of the two photos: ties AI grade jobs to this card
  const gradeRunRef=useRef(0);     // bumps on every new card; late AI results for an older card are not applied
  const pendingApplyRef=useRef(null); // { gradeType, result, jobId, cardKey } to apply once a restored card is analyzed
  // One saved row per card: auto-save after a paid grade and the Save button both write the same scan.
  const[savedScanId,setSavedScanId]=useState(null);
  const savedScanIdRef=useRef(null);      // mirrors savedScanId for async code
  const savedImagesRef=useRef(null);      // images uploaded with the last save (skip re-upload when unchanged)
  const saveChainRef=useRef(Promise.resolve()); // serializes saves (AI + Deep back to back → insert, then update)
  const autosaveArmedRef=useRef(null);    // gradeType whose result should be auto-saved on the next render
  const[show3DViewer,setShow3DViewer]=useState(false); // 3D viewer modal visibility
  const[cardInfo,setCardInfo]=useState(null); // Card info: { name, cardNumber, setName, etc. }
  // AI grade results (unified schema - docs/GRADING_SYSTEM.md)
  const[aiSubgrades,setAiSubgrades]=useState(null); // AI subgrades: 8 keys (frontCentering...backSurface), 0-100 scale
  const[aiOverall,setAiOverall]=useState(null); // AI overall: { score, grade, label, displayGrade, capsApplied, minSubgrade }
  const[aiGrades,setAiGrades]=useState(null); // AI company grades: { psa, bgs, sgc, cgc, tag }
  const[aiConfidence,setAiConfidence]=useState(null); // AI confidence: { value: 0-1, factors: [] }
  const[aiSummary,setAiSummary]=useState(null); // AI summary: { positives, concerns, recommendation }
  const[aiGradingNotes,setAiGradingNotes]=useState(null); // AI grading notes (derived): { positives, concerns, estimatedGrade }

  // Deep AI grade results (unified schema - docs/GRADING_SYSTEM.md)
  const[deepAiSubgrades,setDeepAiSubgrades]=useState(null); // Deep AI subgrades: 8 keys, 0-100 scale
  const[deepAiOverall,setDeepAiOverall]=useState(null); // Deep AI overall: { score, grade, label, displayGrade, capsApplied }
  const[deepAiGrades,setDeepAiGrades]=useState(null); // Deep AI company grades: { psa, bgs, sgc, cgc, tag }
  const[deepAiConfidence,setDeepAiConfidence]=useState(null); // Deep AI confidence: { value: 0-1, factors: [] }
  const[,setDeepAiCentering]=useState(null); // Deep AI centering: numeric shape
  const[deepAiSummary,setDeepAiSummary]=useState(null); // Deep AI summary
  const[,setExtractingInfo]=useState(false); // AI analysis in progress

  // Card identification (OCR + TCGDex)
  const[showCardIdentifier,setShowCardIdentifier]=useState(false); // Show card identifier modal
  const[tcgdexData,setTcgdexData]=useState(null); // Full card data from TCGDex
  const[tcgdexImage,setTcgdexImage]=useState(null); // High-quality card image URL from TCGDex
  const[,setIdentifyingCard]=useState(false); // Card identification in progress
  const[showCropModal,setShowCropModal]=useState(false); // Show crop modal for missing TCGDex images
  const[showPricing,setShowPricing]=useState(false); // Pricing/credits modal visibility
  const[insufficientCredits,setInsufficientCredits]=useState(null); // { type: 'ai'|'deep', needed: number }
  const[gate,setGate]=useState(null); // null | {kind:'signin'} | {kind:'limit', freeGrades} — shown instead of a grade (pricing plan Task 6)
  const[gradeAccess,setGradeAccess]=useState(null); // {unlimited, remaining} from the balance endpoint; null until loaded
  const pendingGradeRef=useRef(false); // a signed-out user tapped Grade: run it once they are signed in
  const creditNotice = insufficientCredits ? `This AI Grade needs ${insufficientCredits.needed} credit${insufficientCredits.needed === 1 ? '' : 's'}. Buy a pack or a plan to continue.` : null;
  const[,setPendingSaveData]=useState(null); // Pending save data while waiting for crop

  // Post-capture centering state
  const[showPostCaptureCentering,setShowPostCaptureCentering]=useState(null); // 'front' | 'back' | null
  const[frontCenteringData,setFrontCenteringData]=useState(null); // Manual centering data for front
  const[backCenteringData,setBackCenteringData]=useState(null); // Manual centering data for back
  const[frontCroppedImage,setFrontCroppedImage]=useState(null); // Manually cropped front image
  const[backCroppedImage,setBackCroppedImage]=useState(null); // Manually cropped back image

  // Auth hook
  const auth = useAuth();

  // Holographic effects - gyro input singleton
  const gyroInputRef = useRef(null);
  if (!gyroInputRef.current) {
    gyroInputRef.current = getGyroInput({
      deadZone: holoConfig.logo.sparkles.deadZone,
      rampPower: holoConfig.logo.sparkles.rampPower,
    });
  }

  // Collection stats (for home dashboard)
  const [collectionStats, setCollectionStats] = useState({ totalCards: 0, totalValue: 0, avgGrade: 0 });

  // Function to refresh collection stats (called on load and after changes)
  const refreshCollectionStats = useCallback(() => {
    if (auth.isAuthenticated && auth.user?.id) {
        getUserScans(auth.user.id, { limit: 100 }).then(scans => {
          let totalValue = 0;
          let gradeSum = 0;
          let gradeCount = 0;

          scans.forEach(scan => {
            // Sum up values from card_info.pricing
            const pricing = scan.card_info?.pricing;
            const eurPrice = pricing?.trend || pricing?.avg || pricing?.low || 0;
            if (eurPrice) totalValue += eurPrice * 1.08; // Convert EUR to USD

            // Calculate avg grade (from ai_grades or software grade)
            const grade = scan.ai_grades?.tag?.score || scan.raw_score || 0;
            if (grade > 0) {
              gradeSum += grade / 100; // Convert 1000-point to 10-point
              gradeCount++;
            }
          });

          setCollectionStats({
            totalCards: scans.length,
            totalValue: Math.round(totalValue * 100) / 100,
            avgGrade: gradeCount > 0 ? Math.round(gradeSum / gradeCount * 10) / 10 : 0,
          });
        }).catch(console.error);
    }
  }, [auth.isAuthenticated, auth.user?.id]);

  // Load collection stats when authenticated
  useEffect(() => {
    refreshCollectionStats();
  }, [refreshCollectionStats]);

  // Load user's preferred grading company when profile loads
  useEffect(() => {
    if (auth.profile?.preferred_company) {
      setGradingCompany(auth.profile.preferred_company);
    }
  }, [auth.profile]);

  // Re-runs analysis with manual boundary overrides, updates grade, cropped image, and centering data
  const applyManualCorrection = useCallback(async (side, overrideBounds, overrideCentering, pre = null) => {
    const src = side === 'front' ? fI : bI;
    if (!src) return;

    // 1) Generate the new crop from the corrected outer bounds (F2: crop first, then analyze it).
    //    `pre` = { croppedImage, centeringData } from the centering tool, which already cropped.
    let croppedImage = pre?.croppedImage || null;
    if (croppedImage) {
      if (side === 'front') setFrontCroppedImage(croppedImage); else setBackCroppedImage(croppedImage);
      try { const maps = await genMaps(croppedImage); if (side === 'front') setFM(maps); else setBM(maps); }
      catch (mapErr) { console.error('[applyManualCorrection] Maps failed:', mapErr); }
    } else try {
      // Use corners if available (corner mode), otherwise build from bounds
      const corners = overrideBounds.corners || {
        tl: { x: overrideBounds.left, y: overrideBounds.top },
        tr: { x: overrideBounds.right, y: overrideBounds.top },
        bl: { x: overrideBounds.left, y: overrideBounds.bottom },
        br: { x: overrideBounds.right, y: overrideBounds.bottom },
      };
      const rotation = overrideCentering.rotation || 0;
      croppedImage = await cropToOuterBounds(src, corners, rotation, 1400);
      if (side === 'front') setFrontCroppedImage(croppedImage); else setBackCroppedImage(croppedImage);
      // Keep the vision maps in sync with the new crop
      const maps = await genMaps(croppedImage);
      if (side === 'front') setFM(maps); else setBM(maps);
    } catch (cropErr) {
      console.error('[applyManualCorrection] Crop failed:', cropErr);
    }

    // 2) Analyze the crop with full-image bounds; fall back to original + bounds only if cropping failed
    const result = croppedImage
      ? await analyzeCardFull(croppedImage, side, null, overrideCentering)
      : await analyzeCardFull(src, side, overrideBounds, overrideCentering);
    const newFR = side === 'front' ? result : fR;
    const newBR = side === 'back' ? result : bR;
    if (side === 'front') setFR(result); else setBR(result);

    // Update centering data with new manual values (the tool's own data is kept whole so it can reopen)
    const newCenteringData = pre?.centeringData ? { ...pre.centeringData, didManualCenter: true } : {
      didManualCenter: true,
      measureMode: overrideCentering.measureMode || 'edge',
      outer: overrideBounds,
      outerCorners: overrideBounds.corners || null,
      croppedBounds: { x: overrideBounds.left, y: overrideBounds.top, width: overrideBounds.right - overrideBounds.left, height: overrideBounds.bottom - overrideBounds.top },
      borderL: overrideCentering.borderL,
      borderR: overrideCentering.borderR,
      borderT: overrideCentering.borderT,
      borderB: overrideCentering.borderB,
      lrRatio: overrideCentering.lrRatio,
      tbRatio: overrideCentering.tbRatio,
      rotation: overrideCentering.rotation || 0,
      tiltX: overrideCentering.tiltX || 0,
      tiltY: overrideCentering.tiltY || 0,
    };

    if (side === 'front') {
      setFrontCenteringData(newCenteringData);
    } else {
      setBackCenteringData(newCenteringData);
    }

    const effFront = ignoreCentering ? PERFECT_CENTER : newFR.centering;
    const effBack = ignoreCentering ? PERFECT_CENTER : newBR.centering;
    // Combine quality metrics for confidence calculation
    const fq = frontQuality?.metrics || {};
    const bq = backQuality?.metrics || {};
    const imageQuality = (frontQuality || backQuality) ? {
      metrics: {
        sharpness: Math.min(fq.sharpness || 999, bq.sharpness || 999),
        brightRatio: Math.max(fq.brightRatio || 0, bq.brightRatio || 0),
        darkRatio: Math.max(fq.darkRatio || 0, bq.darkRatio || 0),
        contrast: Math.min(fq.contrast || 255, bq.contrast || 255),
      },
    } : null;
    const grade = computeGrade(newFR.allDings, newBR.allDings, effFront, effBack, gradingCompany, imageQuality);
    setGradeResult(grade);
  }, [fI, bI, fR, bR, ignoreCentering, gradingCompany, frontQuality, backQuality]);

  // Centering tab: the same tool as capture time, reopened with the saved points. It has already
  // cropped, so apply just re-analyzes that crop and refreshes the grade.
  const handleTabCenteringConfirm = useCallback(async (side, result) => {
    setManualMode(null);
    const cd = result.centeringData;
    const so = cd.source?.outer || { left: 0, top: 0, right: 0, bottom: 0 };
    await applyManualCorrection(side, { ...so, corners: cd.source?.outerCorners || null }, cd, { croppedImage: result.croppedImage, centeringData: cd });
    setCenteringConfirmed(true);
  }, [applyManualCorrection]);

  const run=useCallback(async()=>{
    if(!fI||!bI)return; setAnalysisFailed(false); setStep(1);
    try{
      // Manual centering from the tool overrides the measured ratios (the crop it made is analyzed below)
      let frontOverrideCentering = null, backOverrideCentering = null;

      if (frontCenteringData?.didManualCenter) {
        frontOverrideCentering = {
          lrRatio: frontCenteringData.lrRatio,
          tbRatio: frontCenteringData.tbRatio,
          borderL: frontCenteringData.borderL,
          borderR: frontCenteringData.borderR,
          borderT: frontCenteringData.borderT,
          borderB: frontCenteringData.borderB,
        };
      }

      if (backCenteringData?.didManualCenter) {
        backOverrideCentering = {
          lrRatio: backCenteringData.lrRatio,
          tbRatio: backCenteringData.tbRatio,
          borderL: backCenteringData.borderL,
          borderR: backCenteringData.borderR,
          borderT: backCenteringData.borderT,
          borderB: backCenteringData.borderB,
        };
      }

      // F2: when the user cropped the card in the centering tool, analyze THAT image
      // with no bounds override (findBounds on a card-filling crop returns the frame).
      // The manual centering ratios still override analyzeCentering.
      const frontSrc = frontCroppedImage || fI;
      const backSrc  = backCroppedImage  || bI;
      setProg(frontCroppedImage ? "Analyzing cropped card (front)..." : "Detecting card bounds (front)...");
      await new Promise(r=>setTimeout(r,30));
      const fr=await analyzeCardFull(frontSrc,"front", null, frontOverrideCentering, setProg); setFR(fr);

      setProg(backCroppedImage ? "Analyzing cropped card (back)..." : "Detecting card bounds (back)...");
      await new Promise(r=>setTimeout(r,30));
      const br=await analyzeCardFull(backSrc,"back", null, backOverrideCentering, setProg); setBR(br);

      setProg(`Computing ${GRADING_COMPANIES[gradingCompany]?.name || 'TAG'} grade...`);await new Promise(r=>setTimeout(r,30));
      const effFront = ignoreCentering ? PERFECT_CENTER : fr.centering;
      const effBack = ignoreCentering ? PERFECT_CENTER : br.centering;
      // Combine quality metrics for confidence
      const fq = frontQuality?.metrics || {};
      const bq = backQuality?.metrics || {};
      const imageQuality = (frontQuality || backQuality) ? {
        metrics: {
          sharpness: Math.min(fq.sharpness || 999, bq.sharpness || 999),
          brightRatio: Math.max(fq.brightRatio || 0, bq.brightRatio || 0),
          darkRatio: Math.max(fq.darkRatio || 0, bq.darkRatio || 0),
          contrast: Math.min(fq.contrast || 255, bq.contrast || 255),
        },
        manualCentering: frontCenteringData?.didManualCenter || backCenteringData?.didManualCenter,
      } : null;
      const grade=computeGrade(fr.allDings,br.allDings,effFront,effBack,gradingCompany,imageQuality);
      setGradeResult({...grade, source: 'client'});
      setProg("Generating surface vision maps...");await new Promise(r=>setTimeout(r,30));
      // Vision maps are generated from the same image the detectors saw (the crop when one exists)
      setFM(await genMaps(frontSrc)); setBM(await genMaps(backSrc));
      setStep(2);
    }catch(e){console.error("Analysis error:",e);setProg(`Error: ${e.message || "try better photos"}`);setAnalysisFailed(true);}
  },[fI,bI,frontCroppedImage,backCroppedImage,ignoreCentering,gradingCompany,frontCenteringData,backCenteringData,frontQuality,backQuality]);

  // The free grade costs one of the month's free grades for free accounts (unlimited for Plus, trial and
  // lifetime) and needs an account. run() itself stays ungated: the paid-job restore path re-runs it.
  const refreshGradeAccess = useCallback(async () => {
    if (!auth.isAuthenticated || !auth.user?.id) { setGradeAccess(null); return; }
    try { const b = await getCreditsBalance(auth.user.id); setGradeAccess({ unlimited: !!b.unlimitedGrades, remaining: b.freeGrades?.remaining ?? null }); }
    catch { setGradeAccess(null); }
  }, [auth.isAuthenticated, auth.user?.id]);
  useEffect(() => { refreshGradeAccess(); }, [refreshGradeAccess]);

  const requestGrade = useCallback(async () => {
    if (!fI || !bI) return;
    if (!auth.isAuthenticated) { setGate({ kind: 'signin' }); setStep(1); return; }
    try {
      const r = await spendFreeGrade(auth.user.id);
      if (r?.freeGrades) setGradeAccess({ unlimited: false, remaining: r.freeGrades.remaining });
    } catch (e) {
      if (e.status === 402) { setGate({ kind: 'limit', freeGrades: e.data?.freeGrades }); setGradeAccess({ unlimited: false, remaining: 0 }); setStep(1); return; }
      if (e.status === 401) { setGate({ kind: 'signin' }); setStep(1); return; }
      setProg(`Error: ${e.message || 'could not start the grade'}`); setAnalysisFailed(true); setStep(1); return;
    }
    setGate(null);
    run();
  }, [fI, bI, auth.isAuthenticated, auth.user?.id, run]);

  // A signed-out user who tapped Grade and then signed in gets the grade without re-capturing
  useEffect(() => {
    if (auth.isAuthenticated && pendingGradeRef.current) { pendingGradeRef.current = false; requestGrade(); }
  }, [auth.isAuthenticated, requestGrade]);

  // Restore step 1: once the restored photos are in state, run the software analysis
  useEffect(() => {
    if (!pendingApplyRef.current || !fI || !bI || step !== 0) return;
    run();
  }, [fI, bI]); // eslint-disable-line react-hooks/exhaustive-deps
  // Restore step 2: once the software grade exists, apply the stored AI result and show the Grade tab
  useEffect(() => {
    const pa = pendingApplyRef.current;
    if (!pa || step !== 2 || !gradeResult) return;
    pendingApplyRef.current = null;
    cardKeyRef.current = pa.cardKey;
    forgetJob(pa.jobId);
    applyGradeResult(pa.gradeType, pa.result);
    setTab('grade');
  }, [step, gradeResult]); // eslint-disable-line react-hooks/exhaustive-deps
  // On sign-in / load: pick up jobs this browser started earlier (finished → offer, running → poll)
  useEffect(() => {
    if (!auth.user?.id) return;
    let cancelled = false;
    (async () => {
      for (const j of readJobs()) {
        if (Date.now() - (j.startedAt || 0) > 24 * 3600 * 1000) { forgetJob(j.jobId); continue; }
        const job = await getGradeJob(j.jobId);
        if (cancelled) return;
        if (!job) continue;
        if (job.status === 'error') { forgetJob(j.jobId); continue; }
        if (job.status === 'done') { setResumeJob({ jobId: j.jobId, gradeType: job.grade_type, job }); continue; }
        pollJob(j.jobId, job.grade_type, gradeRunRef.current);
      }
    })();
    return () => { cancelled = true; };
  }, [auth.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Combine image quality for grading confidence calculation
  const combinedImageQuality = useCallback(() => {
    // Take the worse metrics from front/back
    if (!frontQuality && !backQuality) return null;
    const fq = frontQuality?.metrics || {};
    const bq = backQuality?.metrics || {};
    return {
      metrics: {
        sharpness: Math.min(fq.sharpness || 999, bq.sharpness || 999),
        brightRatio: Math.max(fq.brightRatio || 0, bq.brightRatio || 0),
        darkRatio: Math.max(fq.darkRatio || 0, bq.darkRatio || 0),
        contrast: Math.min(fq.contrast || 255, bq.contrast || 255),
      },
      manualCentering: frontCenteringData?.didManualCenter || backCenteringData?.didManualCenter,
    };
  }, [frontQuality, backQuality, frontCenteringData, backCenteringData]);

  // Recompute grade when settings change and results exist
  useEffect(()=>{
    if(fR && bR){
      // Determine which centering to use for software grade
      // Priority: ignoreCentering > manual upload centering > AI centering > auto-detected
      let effFront, effBack;
      if (ignoreCentering) {
        effFront = PERFECT_CENTER;
        effBack = PERFECT_CENTER;
      } else if (frontCenteringData?.didManualCenter) {
        // Use manual centering from upload
        effFront = { lrRatio: frontCenteringData.lrRatio, tbRatio: frontCenteringData.tbRatio };
        effBack = backCenteringData?.didManualCenter
          ? { lrRatio: backCenteringData.lrRatio, tbRatio: backCenteringData.tbRatio }
          : bR.centering;
      } else if (useAiCentering && aiCentering?.front && aiCentering?.back) {
        // Use AI centering values (stored as numbers)
        effFront = { lrRatio: aiCentering.front.lrRatio, tbRatio: aiCentering.front.tbRatio };
        effBack = { lrRatio: aiCentering.back.lrRatio, tbRatio: aiCentering.back.tbRatio };
      } else {
        // Use software-detected centering
        effFront = fR.centering;
        effBack = bR.centering;
      }
      const imageQuality = combinedImageQuality();
      const grade = computeGrade(fR.allDings, bR.allDings, effFront, effBack, gradingCompany, imageQuality);
      setGradeResult(grade);
    }
  },[ignoreCentering, gradingCompany, fR, bR, useAiCentering, aiCentering, frontCenteringData, backCenteringData, combinedImageQuality]);

  // Everything the Grade tab derives from a card: software, AI and Deep AI results and their statuses.
  // Used by "New", "Scan New Card" and job restore, so no path can leave a stale status behind
  // (the Deep button used to stay disabled for the whole session after one Deep grade).
  const resetGradingState=()=>{setGradeResult(null);setFR(null);setBR(null);setFM(null);setBM(null);setCardInfo(null);setAiSubgrades(null);setAiOverall(null);setAiGrades(null);setAiConfidence(null);setAiGradingNotes(null);setAiSummary(null);setAiCentering(null);setAiDefects(null);setDeepAiSubgrades(null);setDeepAiOverall(null);setDeepAiGrades(null);setDeepAiConfidence(null);setDeepAiCentering(null);setDeepAiSummary(null);setDeepGradeStatus(null);setDeepGradeResult(null);setEnhancingStatus(null);setExtractingInfo(false);setGradeMode('software');setUseAiCentering(false);setCenteringConfirmed(false);setIgnoreCentering(false);setSavingStatus(null);setSavedScanId(null);savedScanIdRef.current=null;savedImagesRef.current=null;autosaveArmedRef.current=null;gradeRunRef.current+=1;};
  const reset=()=>{setGate(null);setStep(0);setFI(null);setBI(null);resetGradingState();setTab("scan");setFrontQuality(null);setBackQuality(null);setEnhancedCards(null);setShow3DViewer(false);setTcgdexData(null);setTcgdexImage(null);setShowCardIdentifier(false);setIdentifyingCard(false);setShowPostCaptureCentering(null);setFrontCenteringData(null);setBackCenteringData(null);setFrontCroppedImage(null);setBackCroppedImage(null);};

  // Analyze photo quality when images are captured
  const handleSetFrontImage = useCallback(async (img) => {
    setFI(img);
    if (img) {
      try {
        const quality = await analyzePhotoQuality(img);
        setFrontQuality(quality);
        // Show post-capture centering instead of directly triggering card identifier
        setShowPostCaptureCentering('front');
      } catch (e) {
        console.error('Quality analysis failed:', e);
        setFrontQuality(null);
        // Still show centering on error
        setShowPostCaptureCentering('front');
      }
    } else {
      setFrontQuality(null);
      setShowCardIdentifier(false);
      setShowPostCaptureCentering(null);
    }
  }, []);

  const handleSetBackImage = useCallback(async (img) => {
    setBI(img);
    if (img) {
      try {
        const quality = await analyzePhotoQuality(img);
        setBackQuality(quality);
        // Show post-capture centering for back too
        setShowPostCaptureCentering('back');
      } catch (e) {
        console.error('Quality analysis failed:', e);
        setBackQuality(null);
        setShowPostCaptureCentering('back');
      }
    } else {
      setBackQuality(null);
      setShowPostCaptureCentering(null);
    }
  }, []);
  const handleCam=d=>{if(camTarget==="front")handleSetFrontImage(d);else handleSetBackImage(d);setCamTarget(null);};

  // Handle post-capture centering confirm
  const handleCenteringConfirm = useCallback((side, result) => {
    if (side === 'front') {
      setFrontCroppedImage(result.croppedImage);
      setFrontCenteringData(result.centeringData);
    } else {
      setBackCroppedImage(result.croppedImage);
      setBackCenteringData(result.centeringData);
    }
    setShowPostCaptureCentering(null);

    // Only trigger CardIdentifier for front side
    if (side === 'front') {
      setShowCardIdentifier(true);
      setIdentifyingCard(true);
    }
  }, []);

  // Handle post-capture centering skip
  const handleCenteringSkip = useCallback((side) => {
    setShowPostCaptureCentering(null);

    // Only trigger CardIdentifier for front side (will use auto-crop)
    if (side === 'front') {
      setShowCardIdentifier(true);
      setIdentifyingCard(true);
    }
  }, []);

  // Handle card identification result from OCR + TCGDex
  const handleCardIdentified = (cardData) => {
    setShowCardIdentifier(false);
    setIdentifyingCard(false);
    if (cardData) {
      // Store TCGDex data
      setTcgdexData(cardData);
      setTcgdexImage(cardData.imageHigh);
      // Set card info from TCGDex - merge to preserve existing data but add pricing
      setCardInfo(prev => prev
        ? { ...prev, ...cardData.cardInfo } // Merge: TCGDex data (with pricing) overrides
        : cardData.cardInfo
      );
      console.log('Card identified:', cardData.name, '- Image:', cardData.imageHigh);
    }
  };

  // Build save data object (used by both direct save and crop flow)
  const buildSaveData = (userCardImage = null) => {
    // Save the grade the user is looking at (Deep or AI when selected, else software)
    const aiGradeForCompany = gradeMode === 'deep' ? deepAiGrades?.[gradingCompany] : gradeMode === 'ai' ? aiGrades?.[gradingCompany] : null;
    const gradeValue = aiGradeForCompany?.grade ?? gradeResult.grade.grade;
    const gradeLabel = aiGradeForCompany?.label ?? gradeResult.grade.label;

    // Enhanced images for vision modes - user's captured/cropped photos
    // Use cropped version if available, fall back to original capture
    const enhancedFrontToSave = frontCroppedImage || fI || null;
    const enhancedBackToSave = backCroppedImage || bI || null;

    console.log('[buildSaveData] Images:', {
      enhancedFront: enhancedFrontToSave ? 'HAS_IMAGE' : null,
      enhancedBack: enhancedBackToSave ? 'HAS_IMAGE' : null,
      tcgdexImage: tcgdexImage ? 'HAS_IMAGE' : null,
      sources: {
        'frontCroppedImage': !!frontCroppedImage,
        'backCroppedImage': !!backCroppedImage,
        'fI': !!fI,
        'bI': !!bI,
      }
    });

    return {
      gradingCompany,
      rawScore: gradeResult.rawScore,
      gradeValue,
      gradeLabel,
      subgrades: gradeResult.subgrades,
      companyGrades: gradeResult.companyGrades || null,   // F1: engine per-company grades
      frontCentering: fR?.centering,
      backCentering: bR?.centering,
      dings: gradeResult.allDings,
      enhancedFront: enhancedFrontToSave,
      enhancedBack: enhancedBackToSave,
      cardName: cardInfo?.name || null,
      cardSet: cardInfo?.setName || null,
      cardNumber: cardInfo?.cardNumber || null,
      cardGame: 'pokemon',
      // AI results (unified schema)
      aiSubgrades: aiSubgrades || null,
      aiOverall: aiOverall || null,
      aiGrades: aiGrades || null,
      aiConfidence: aiConfidence || null,
      aiSummary: aiSummary || null,
      // Deep AI results (unified schema)
      // Mobile debug: Log deep AI state at save time
      ...((() => {
        console.log('[buildSaveData] Deep AI state:', {
          hasDeepAiGrades: !!deepAiGrades,
          deepAiGradesKeys: deepAiGrades ? Object.keys(deepAiGrades) : [],
          hasDeepAiSubgrades: !!deepAiSubgrades,
          hasDeepAiSummary: !!deepAiSummary,
        });
        return {};
      })()),
      deepAiSubgrades: deepAiSubgrades || null,
      deepAiOverall: deepAiOverall || null,
      deepAiGrades: deepAiGrades || null,
      deepAiConfidence: deepAiConfidence || null,
      deepAiSummary: deepAiSummary || null,
      // Canonical records (subgrades, overall, confidence, DEFECT BOXES, centering) so saved cards
      // can show the damage report for AI / Deep grades (src/lib/grade-records.js)
      aiRecord: aiGrades ? { subgrades: aiSubgrades, overall: aiOverall, confidence: aiConfidence, defects: aiDefects, centering: aiCentering, gradedAt: new Date().toISOString() } : null,
      deepRecord: deepGradeResult ? aiRecordFromResult(deepGradeResult) : null,
      // Store centering in numeric format (lrRatio/tbRatio)
      aiCentering: aiCentering || null,
      cardInfo: cardInfo || null,
      tcgdexImage: tcgdexImage || null,
      tcgdexId: tcgdexData?.id || null,
      userCardImage: userCardImage,
    };
  };

  /**
   * Save the current card once: inserts on the first call, updates the same row after that.
   * Calls are queued so an AI result and a Deep result arriving back to back (or a tap on Save while an
   * auto-save runs) never create two rows. Unchanged images are not re-uploaded on updates.
   */
  const persistScan = (opts = {}) => {
    const run = async () => {
      if (!auth.user?.id || !gradeResult) return null;
      const existing = savedScanIdRef.current;
      const imagesKey = `${(frontCroppedImage || fI || '').length}:${(backCroppedImage || bI || '').length}:${opts.userCardImage ? 'u' : ''}`;
      const skipImages = !!existing && savedImagesRef.current === imagesKey;
      const scan = await upsertScan(auth.user.id, buildSaveData(opts.userCardImage ?? null), existing, { skipImages });
      savedScanIdRef.current = scan.id; setSavedScanId(scan.id);
      savedImagesRef.current = imagesKey;
      rememberSavedScan(cardKeyRef.current, scan.id);
      // Opt-in: keep the original photos + the confirmed card outline as a labelled sample
      // for the card model's real-photo validation set (Settings > Keep originals for training).
      if (trainingCaptureEnabled() && !skipImages) {
        captureForTraining({
          userId: auth.user.id, scanId: scan.id,
          front: { dataUrl: fI, centeringData: frontCenteringData },
          back: { dataUrl: bI, centeringData: backCenteringData },
        }).catch(() => {});
      }
      if (refreshCollectionStats) refreshCollectionStats();
      return scan;
    };
    const p = saveChainRef.current.then(run, run);
    saveChainRef.current = p.catch(() => {});
    return p;
  };

  // Auto-save after a paid grade lands (effect so buildSaveData sees the committed state)
  useEffect(() => {
    const armed = autosaveArmedRef.current;
    if (!armed || !auth.user?.id || !gradeResult) return;
    autosaveArmedRef.current = null;
    setSavingStatus('saving');
    persistScan({ userCardImage: tcgdexImage ? null : (frontCroppedImage || fI || null) })
      .then(() => { setSavingStatus('saved'); setTimeout(() => setSavingStatus(null), 2000); })
      .catch((e) => { console.error('[autosave] failed:', e); setSavingStatus('error'); setTimeout(() => setSavingStatus(null), 3000); });
  }, [aiGrades, deepAiGrades]); // eslint-disable-line react-hooks/exhaustive-deps

  // Save scan to user's collection (includes AI data and enhanced images)
  const handleSaveScan = async () => {
    if (!auth.isAuthenticated || !gradeResult) return;

    // Already saved (auto-save or an earlier tap): update that row, never insert again
    if (savedScanIdRef.current) {
      setSavingStatus('saving');
      try { await persistScan(); setSavingStatus('saved'); setTimeout(() => setSavingStatus(null), 2000); }
      catch (err) { console.error('Error updating saved scan:', err); setSavingStatus('error'); setTimeout(() => setSavingStatus(null), 3000); }
      return;
    }

    // Check if card was identified but has no TCGDex image
    const hasCardId = tcgdexData?.id || cardInfo?.name;
    const missingImage = !tcgdexImage && hasCardId;

    if (missingImage && fI) {
      // Log the missing image for us to fix later
      if (tcgdexData?.id) {
        logMissingImage(
          tcgdexData.id,
          cardInfo?.name || tcgdexData?.name,
          cardInfo?.setName || tcgdexData?.set?.name,
          cardInfo?.cardNumber || tcgdexData?.localId
        );
      }

      // If user already cropped during upload centering, use that image directly
      if (frontCroppedImage) {
        setSavingStatus('saving');
        try {
          await persistScan({ userCardImage: frontCroppedImage });
          setSavingStatus('saved');
          setTimeout(() => setSavingStatus(null), 2000);
        } catch (err) {
          console.error('Error saving scan with upload crop:', err);
          setSavingStatus('error');
          setTimeout(() => setSavingStatus(null), 3000);
        }
        return;
      }

      // No pre-cropped image - show crop modal
      setPendingSaveData(buildSaveData());
      setShowCropModal(true);
      return;
    }

    // Normal save flow
    setSavingStatus('saving');
    try {
      await persistScan();
      setSavingStatus('saved');
      setTimeout(() => setSavingStatus(null), 2000);
    } catch (err) {
      console.error('Error saving scan:', err);
      setSavingStatus('error');
      setTimeout(() => setSavingStatus(null), 3000);
    }
  };

  // Handle cropped image from crop modal
  const handleCropComplete = async (croppedDataUrl) => {
    setShowCropModal(false);
    setSavingStatus('saving');

    try {
      console.log('[CropComplete] Saving with user card image:', croppedDataUrl?.substring(0, 50) + '...');
      await persistScan({ userCardImage: croppedDataUrl });

      setSavingStatus('saved');
      setPendingSaveData(null);
      setTimeout(() => setSavingStatus(null), 2000);

      // Refresh collection stats to show updated card
      if (refreshCollectionStats) refreshCollectionStats();
    } catch (err) {
      console.error('Error saving scan with crop:', err);
      setSavingStatus('error');
      setTimeout(() => setSavingStatus(null), 3000);
    }
  };

  // Skip cropping and save without user image
  const handleCropSkip = async () => {
    setShowCropModal(false);
    setSavingStatus('saving');

    try {
      await persistScan();
      setSavingStatus('saved');
      setPendingSaveData(null);
      setTimeout(() => setSavingStatus(null), 2000);
    } catch (err) {
      console.error('Error saving scan:', err);
      setSavingStatus('error');
      setTimeout(() => setSavingStatus(null), 3000);
    }
  };

  // AI Grade - Claude analyzes card and returns grades (no SAM, no 3D)
  // Cost: 1 credit
  // ═══════════════════════════════════════════════════════════════════════════
  // AI / DEEP AI GRADES — durable, one-shot jobs
  //   The endpoint authenticates, spends the credit, records an ai_grade_jobs row for this
  //   user + card, runs, and refunds server-side on failure. The client just starts the job,
  //   applies the result, and polls the job row if the connection is lost (timeout, page
  //   change, second tab). A job started for a card that is no longer loaded is offered back
  //   via the "resume" banner. Buttons are disabled while a job runs (server refuses dupes too).
  // ═══════════════════════════════════════════════════════════════════════════
  const JOBS_KEY = 'slabsense_aiJobs';
  const readJobs = () => { try { return JSON.parse(localStorage.getItem(JOBS_KEY) || '[]'); } catch { return []; } };
  const writeJobs = (jobs) => { try { localStorage.setItem(JOBS_KEY, JSON.stringify(jobs)); } catch { /* ignore */ } };
  const rememberJob = (job) => writeJobs([...readJobs().filter((j) => j.jobId !== job.jobId), job]);
  const SAVED_KEY = 'slabsense_savedScans';                 // { [cardKey]: scanId } (last 30 cards)
  const savedScanFor = (cardKey) => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}')[cardKey] || null; } catch { return null; } };
  const rememberSavedScan = (cardKey, scanId) => {
    if (!cardKey || !scanId) return;
    try { const m = JSON.parse(localStorage.getItem(SAVED_KEY) || '{}'); m[cardKey] = scanId; const keys = Object.keys(m); if (keys.length > 30) delete m[keys[0]]; localStorage.setItem(SAVED_KEY, JSON.stringify(m)); } catch { /* ignore */ }
  };
  const forgetJob = (jobId) => writeJobs(readJobs().filter((j) => j.jobId !== jobId));

  /** Stable id for "this card" = hash of both photos. */
  const cardKeyFor = async (front, back) => {
    const data = new TextEncoder().encode(`${front}|${back}`);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  };
  useEffect(() => {
    let alive = true;
    cardKeyRef.current = null;
    if (fI && bI) cardKeyFor(fI, bI).then((k) => {
      if (!alive) return;
      cardKeyRef.current = k;
      const prior = savedScanFor(k);
      if (prior && !savedScanIdRef.current) { savedScanIdRef.current = prior; setSavedScanId(prior); }
    });
    return () => { alive = false; };
  }, [fI, bI]);

  const softwareCenteringFor = (side) => {
    const data = side === 'front' ? frontCenteringData : backCenteringData;
    const r = side === 'front' ? fR : bR;
    if (data?.didManualCenter) return { lrRatio: data.lrRatio, tbRatio: data.tbRatio };
    if (r?.centering) return { lrRatio: r.centering.lrRatio, tbRatio: r.centering.tbRatio };
    return null;
  };
  const centeringDisplay = (c) => {
    const one = (v) => v ? {
      lrRatio: v.lrRatio ?? 50, tbRatio: v.tbRatio ?? 50,
      lrDisplay: `${(v.lrRatio ?? 50).toFixed(1)}/${(100 - (v.lrRatio ?? 50)).toFixed(1)}`,
      tbDisplay: `${(v.tbRatio ?? 50).toFixed(1)}/${(100 - (v.tbRatio ?? 50)).toFixed(1)}`,
    } : null;
    return { front: one(c.front), back: one(c.back) };
  };

  /** Write an AI or Deep AI result (client-shaped) into state and show it. */
  const applyGradeResult = (gradeType, result) => {
    const isDeep = gradeType === 'deep';
    if (result.cardInfo) setCardInfo(prev => prev ? { ...prev, ...result.cardInfo, pricing: prev.pricing } : result.cardInfo);
    const centering = result.centering ? centeringDisplay(result.centering) : null;
    if (isDeep) {
      setDeepGradeResult(result);
      if (result.subgrades) setDeepAiSubgrades(result.subgrades);
      if (result.overall) setDeepAiOverall(result.overall);
      if (result.grades) setDeepAiGrades(result.grades); else console.warn('Deep AI result.grades is missing! keys:', Object.keys(result));
      if (result.confidence) setDeepAiConfidence(result.confidence);
      if (result.summary) setDeepAiSummary(result.summary);
      if (centering) setDeepAiCentering(centering);
      setGradeMode('deep');                      // the higher tier takes the view
      setDeepGradeStatus('done');
    } else {
      if (result.subgrades) setAiSubgrades(result.subgrades);
      if (result.overall) setAiOverall(result.overall);
      if (result.grades) setAiGrades(result.grades); else console.warn('AI result.grades is missing! keys:', Object.keys(result));
      if (result.confidence) setAiConfidence(result.confidence);
      if (result.defects) setAiDefects(result.defects);
      if (result.summary) {
        setAiSummary(result.summary);
        setAiGradingNotes({ positives: result.summary.positives || [], concerns: result.summary.concerns || [], estimatedGrade: result.overall?.grade || result.grades?.tag?.grade, recommendation: result.summary.recommendation });
      }
      if (centering) setAiCentering(centering);
      setGradeMode((m) => (m === 'deep' ? m : 'ai'));  // never pull the view away from a Deep result
      setEnhancingStatus('done');
      setExtractingInfo(false);
    }
    setProg('');
    if (window.refreshCreditBalance) window.refreshCreditBalance();
    autosaveArmedRef.current = gradeType;   // a paid result is always saved (see the auto-save effect)
    console.log(`[${gradeType}] grade applied:`, result.cardInfo?.name, result.grades?.tag?.grade);
  };
  const resultFromJob = (job) => (job.grade_type === 'deep' ? shapeDeepResult(job.result, { jobId: job.id }) : shapeAiResult(job.result, { jobId: job.id }));

  /** Poll a job row until it finishes (connection lost, 409 duplicate, or restored session). */
  const pollJob = async (jobId, gradeType, run) => {
    const isDeep = gradeType === 'deep';
    const setStatus = isDeep ? setDeepGradeStatus : setEnhancingStatus;
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const job = await getGradeJob(jobId);
      if (!job) continue;
      if (job.status === 'done') {
        if (run !== gradeRunRef.current || cardKeyRef.current !== job.card_key) {
          setStatus(null); setProg('');
          setResumeJob({ jobId, gradeType, job });   // belongs to a card that is no longer loaded
          return;
        }
        forgetJob(jobId);
        applyGradeResult(gradeType, resultFromJob(job));
        return;
      }
      if (job.status === 'error') {
        forgetJob(jobId); setStatus('error'); setProg('');
        setTimeout(() => setStatus(null), 3000);
        return;
      }
    }
    setStatus(null); setProg('');
  };

  const startGradeJob = async (gradeType) => {
    if (!fI || !bI) return;
    const isDeep = gradeType === 'deep';
    const setStatus = isDeep ? setDeepGradeStatus : setEnhancingStatus;
    if (!auth.user?.id) { setShowAuthModal(true); return; }

    const run = gradeRunRef.current;
    const cardKey = cardKeyRef.current || await cardKeyFor(fI, bI);
    const jobId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
    setStatus(isDeep ? 'grading' : 'enhancing');
    if (!isDeep) setExtractingInfo(true);
    setProg(isDeep ? 'AI grading card (two-pass inspection)...' : 'AI grading card...');
    rememberJob({ jobId, cardKey, gradeType, startedAt: Date.now() });

    const frontC = softwareCenteringFor('front'), backC = softwareCenteringFor('back');
    // Corner/edge model table from the software analysis, so the paid grade agrees with the free one.
    const cornerEdge = cornerEdgeRequest(fR?.modelSlots, bR?.modelSlots);
    try {
      const result = isDeep
        ? await deepGradingAnalysisV2(fI, bI, frontCroppedImage || fI, backCroppedImage || bI, 'pokemon', 'modern_holo', auth.user.id, frontC, backC, { jobId, cardKey, cornerEdge })
        : await claudeGradingAnalysis(fI, bI, 'pokemon', auth.user.id, frontC, backC, { jobId, cardKey, cornerEdge });
      if (run !== gradeRunRef.current) {
        // Card changed while the grade ran: the result is stored on the job; offer it back
        setStatus(null); setProg('');
        setResumeJob({ jobId: result.jobId || jobId, gradeType, job: null });
        return;
      }
      forgetJob(jobId);
      applyGradeResult(gradeType, result);
    } catch (err) {
      console.error(`[${gradeType}] grade failed:`, err);
      if (err.status === 402) {
        forgetJob(jobId);
        setInsufficientCredits({ type: gradeType, needed: err.data?.creditsRequired || GRADE_TIERS[gradeType].credits });
        setShowPricing(true);
        setStatus(null); setProg('');
      } else if (err.status === 401) {
        forgetJob(jobId); setStatus(null); setProg(''); setShowAuthModal(true);
      } else if (err.status === 409 && err.data?.jobId) {
        // Already running for this card (another tab or a retry): follow that job instead
        forgetJob(jobId); rememberJob({ jobId: err.data.jobId, cardKey, gradeType, startedAt: Date.now() });
        setProg('Grade already running — waiting for it...');
        await pollJob(err.data.jobId, gradeType, run);
      } else if (err.timeout || err.name === 'TypeError') {
        // Timeout or network drop: the server keeps going; pick the result up from the job row
        setProg('Still working — waiting for the result...');
        await pollJob(jobId, gradeType, run);
      } else {
        forgetJob(jobId); setStatus('error'); setProg('');
        setTimeout(() => setStatus(null), 3000);
      }
    } finally {
      if (!isDeep) setExtractingInfo(false);
    }
  };

  /** Bring a finished job's card back: photos from the bucket, centering from the request, then the stored result. */
  const restoreJob = async (rj) => {
    let job = rj.job || await getGradeJob(rj.jobId);
    if (!job || job.status !== 'done') { forgetJob(rj.jobId); setResumeJob(null); return; }
    const rq = job.request || {};
    const frontUrl = rq.frontOriginalUrl || rq.frontUrl, backUrl = rq.backOriginalUrl || rq.backUrl;
    if (!frontUrl || !backUrl) { forgetJob(job.id); setResumeJob(null); return; }
    const toDataUrl = async (url) => {
      const blob = await (await fetch(url)).blob();
      return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
    };
    try {
      setProg('Restoring card...');
      const [f, b, fc, bc] = await Promise.all([
        toDataUrl(frontUrl), toDataUrl(backUrl),
        rq.frontCroppedUrl ? toDataUrl(rq.frontCroppedUrl) : null, rq.backCroppedUrl ? toDataUrl(rq.backCroppedUrl) : null,
      ]);
      resetGradingState();
      const priorScan = savedScanFor(job.card_key);
      if (priorScan) { savedScanIdRef.current = priorScan; setSavedScanId(priorScan); }
      setStep(0); setTab('scan');
      setFrontCenteringData(rq.frontCentering ? { didManualCenter: true, lrRatio: rq.frontCentering.lrRatio, tbRatio: rq.frontCentering.tbRatio } : null);
      setBackCenteringData(rq.backCentering ? { didManualCenter: true, lrRatio: rq.backCentering.lrRatio, tbRatio: rq.backCentering.tbRatio } : null);
      setFrontCroppedImage(fc); setBackCroppedImage(bc);
      pendingApplyRef.current = { gradeType: job.grade_type, result: resultFromJob(job), jobId: job.id, cardKey: job.card_key };
      setFI(f); setBI(b);
      setResumeJob(null);
    } catch (e) {
      console.error('[resume] failed to restore card:', e);
      setProg('');
    }
  };

  // 3D View - SAM crops cards for 3D display (separate from grading)
  // 3D View - uses TCGDex images (free) or falls back to cropped/captured photos
  const handle3DView = () => {
    if (!fI || !bI) return;

    // Use TCGDex image if available, otherwise use upload-cropped or captured images
    setEnhancedCards({
      front: tcgdexImage || frontCroppedImage || fI,
      back: backCroppedImage || bI,
    });
    setShow3DViewer(true);
  };


  // Unified tab bar - navigation + analysis tabs combined
  const allTabs=[
    {id:"home",l:"Home",i:"⌂",free:true,nav:true},
    {id:"scan",l:"Scan",i:"◎",free:true,nav:true},
    {id:"cards",l:"Cards",i:"▤",free:true,nav:true},
    {id:"grade",l:"Grade",i:"★",free:true,analysis:true},
    {id:"centering",l:"Center",i:"⊞",free:true,analysis:true},
  ];
  const tabs = allTabs; // All tabs available to all users

  const gr = gradeResult;

  return(<div style={{minHeight:"100vh",maxWidth:480,margin:"0 auto",background:"#0a0b0e",color:"#e0e0e0",fontFamily:sans,display:"flex",flexDirection:"column"}}>
    {/* Auth Modal */}
    {resumeJob && (
      <div style={{position:"fixed",left:12,right:12,bottom:76,zIndex:1050,padding:"10px 12px",background:"#12141a",border:"1px solid #f9731666",borderRadius:10,display:"flex",alignItems:"center",gap:10,boxShadow:"0 6px 24px rgba(0,0,0,.5)"}}>
        <div style={{flex:1,fontFamily:mono,fontSize:10,color:"#ddd",lineHeight:1.4}}>Your {resumeJob.gradeType==='deep'?'AI':'AI (basic)'} grade from earlier is ready.</div>
        <button onClick={()=>restoreJob(resumeJob)} style={{padding:"7px 10px",borderRadius:6,border:"none",background:"#f97316",color:"#000",fontFamily:mono,fontSize:10,fontWeight:700,cursor:"pointer"}}>Load it</button>
        <button onClick={()=>{forgetJob(resumeJob.jobId);setResumeJob(null);}} aria-label="Dismiss" style={{padding:"7px 9px",borderRadius:6,border:"1px solid #333",background:"transparent",color:"#888",fontFamily:mono,fontSize:10,cursor:"pointer"}}>✕</button>
      </div>
    )}
    {showAuthModal && (
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onAuth={auth}
      />
    )}
    {/* Collection View */}
    {showCollection && (
      <CollectionView
        userId={auth.user?.id}
        onClose={() => setShowCollection(false)}
        onCollectionChange={refreshCollectionStats}
      />
    )}
    {/* Export Modal */}
    {showExport && gradeResult && (
      <ExportCard
        gradeResult={gradeResult}
        frontImage={fI}
        backImage={bI}
        gradingCompany={gradingCompany}
        onClose={() => setShowExport(false)}
      />
    )}
    {/* Damage Report Modal */}
    {showDamageReport && gradeResult && (
      <DamageReportModal
        isOpen={showDamageReport}
        onClose={() => setShowDamageReport(false)}
        frontImage={frontCroppedImage || fI}
        backImage={backCroppedImage || bI}
        frontMaps={fM}
        backMaps={bM}
        {...damageReportInputs({
          mode: gradeMode,
          dings: gradeResult.allDings,
          subgrades: gradeResult.subgrades,
          frontResult: fR, backResult: bR,
          ai: aiGrades ? { defects: aiDefects } : null,
          deep: deepGradeResult ? { defects: deepGradeResult.defects } : null,
        })}
      />
    )}
    {/* Card Crop Modal (for missing TCGDex images) */}
    {showCropModal && fI && (
      <CardCropModal
        image={fI}
        cardName={cardInfo?.name || tcgdexData?.name}
        onCrop={handleCropComplete}
        onCancel={handleCropSkip}
      />
    )}
    {/* Post-Capture Centering Modal */}
    {showPostCaptureCentering && (
      <PostCaptureCentering
        image={showPostCaptureCentering === 'front' ? fI : bI}
        side={showPostCaptureCentering}
        onConfirm={(result) => handleCenteringConfirm(showPostCaptureCentering, result)}
        onSkip={() => handleCenteringSkip(showPostCaptureCentering)}
        onCancel={() => setShowPostCaptureCentering(null)}   // keeps the photo, drops no data; the Center tab can reopen it (audit I-16)
        suggestOuter={modelGradingEnabled() ? suggestOuterCorners : null}
        suggestInner={modelGradingEnabled() ? suggestInnerCorners : null}
      />
    )}
    {/* Card Identifier Modal (OCR + TCGDex) */}
    {showCardIdentifier && fI && (
      <div style={{
        position:"fixed",
        inset:0,
        background:"rgba(0,0,0,0.9)",
        zIndex:1100,
        display:"flex",
        alignItems:"center",
        justifyContent:"center",
        padding:16,
      }}>
        <div style={{maxWidth:400,width:"100%"}}>
          <CardIdentifier
            cardImage={frontCroppedImage || fI}
            preCropped={!!frontCroppedImage}
            onCardIdentified={handleCardIdentified}
            onCancel={() => {setShowCardIdentifier(false);setIdentifyingCard(false);}}
          />
        </div>
      </div>
    )}
    {/* 3D Card Viewer Modal */}
    {show3DViewer && enhancedCards && (
      <div style={{
        position:"fixed",
        inset:0,
        background:"rgba(0,0,0,0.95)",
        zIndex:1000,
        display:"flex",
        flexDirection:"column",
        alignItems:"center",
        justifyContent:"center",
      }}>
        {/* Close button */}
        <button aria-label="Close 3D view"
          onClick={() => setShow3DViewer(false)}
          style={{
            position:"absolute",
            top:16,
            right:16,
            background:"rgba(255,255,255,0.1)",
            border:"none",
            borderRadius:"50%",
            width:40,
            height:40,
            color:"#fff",
            fontSize:20,
            cursor:"pointer",
            display:"flex",
            alignItems:"center",
            justifyContent:"center",
          }}
        >
          ✕
        </button>
        {/* Grade badge */}
        {gradeResult && (
          <div style={{
            position:"absolute",
            top:16,
            left:16,
            background:gradeResult.grade.bg,
            borderRadius:8,
            padding:"8px 16px",
            border:`1px solid ${gradeResult.grade.color}33`,
          }}>
            <div style={{fontFamily:mono,fontSize:24,fontWeight:800,color:gradeResult.grade.color}}>
              {Number.isInteger(gradeResult.grade.grade) ? gradeResult.grade.grade : gradeResult.grade.grade.toFixed(1)}
            </div>
            <div style={{fontFamily:mono,fontSize:11,color:gradeResult.grade.color,opacity:0.8}}>
              {gradeResult.grade.label}
            </div>
          </div>
        )}
        {/* 3D Viewer - always use actual card image, not TCGDex */}
        <CardViewer3D
          frontImage={frontCroppedImage || enhancedCards?.front || fI}
          backImage={backCroppedImage || enhancedCards.back}
          grade={gradeResult?.grade?.grade}
          gradeLabel={gradeResult?.grade?.label}
          gradingCompany={gradingCompany}
          cardInfo={cardInfo || tcgdexData?.cardInfo}
          subgrades={gradeResult?.subgrades}
        />
        {/* Info text */}
        <div style={{
          position:"absolute",
          bottom:20,
          fontFamily:mono,
          fontSize:10,
          color:"#555",
          textAlign:"center",
        }}>
          Card outline from your photo · perspective-corrected
        </div>
      </div>
    )}
    {/* New password after a reset email (Supabase PASSWORD_RECOVERY) */}
    {auth.recovery && (
      <SetPasswordModal onSubmit={auth.completePasswordReset} onClose={auth.dismissRecovery} />
    )}
    {/* Profile Settings Modal */}
    {showSettings && (
      <ProfileSettings
        user={auth.user}
        profile={auth.profile}
        onClose={() => setShowSettings(false)}
        onProfileUpdate={auth.refreshProfile}
        onSignOut={auth.signOut}
      />
    )}
    {/* Pricing/Credits Modal */}
    {showPricing && isNativeApp() && (
      <NativeStore userId={auth.user?.id} notice={creditNotice} onClose={() => { setShowPricing(false); setInsufficientCredits(null); refreshGradeAccess(); }} />
    )}
    {showPricing && !isNativeApp() && (
      <PricingPage
        userId={auth.user?.id}
        notice={creditNotice}
        onClose={() => {
          setShowPricing(false);
          setInsufficientCredits(null);
          if (window.refreshCreditBalance) window.refreshCreditBalance();
        }}
      />
    )}
    {/* Disclaimer Modal */}
    {showDisclaimer&&(
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
        <div style={{background:"#0d0f13",borderRadius:12,border:"1px solid #2a2d35",maxWidth:400,padding:24}}>
          <div style={{fontFamily:mono,fontSize:12,color:"#ff9944",textTransform:"uppercase",marginBottom:12}}>Important Disclaimer</div>
          <div style={{fontSize:13,color:"#999",lineHeight:1.6,marginBottom:16}}>
            <strong style={{color:"#fff"}}>SlabSense</strong> is an independent card analysis tool. We are <strong style={{color:"#ff6633"}}>NOT affiliated</strong> with any professional grading company (PSA, BGS, CGC, SGC, TAG, etc.).
          </div>
          <div style={{fontSize:13,color:"#777",lineHeight:1.5,marginBottom:12}}>
            All grades shown are <strong style={{color:"#ff9944"}}>estimates only</strong>. Actual grades from professional services may vary significantly. Do not make financial decisions based solely on these estimates.
          </div>
          <div style={{fontSize:12,color:"#666",lineHeight:1.5,marginBottom:20}}>
            The camera is used only to photograph your card. Read the <a href="/disclaimers" target="_blank" rel="noopener" style={{color:"#8b5cf6"}}>disclaimers</a>, <a href="/terms" target="_blank" rel="noopener" style={{color:"#8b5cf6"}}>terms</a> and <a href="/privacy" target="_blank" rel="noopener" style={{color:"#8b5cf6"}}>privacy policy</a>; they stay available under Settings.
          </div>
          <button onClick={()=>{localStorage.setItem('slabsense_disclaimer_acknowledged','true');setShowDisclaimer(false);}} style={{width:"100%",padding:"12px 0",borderRadius:8,border:"none",background:"linear-gradient(135deg,#00ff88,#0088ff)",color:"#000",fontFamily:mono,fontSize:12,fontWeight:700,cursor:"pointer",textTransform:"uppercase"}}>I Understand</button>
        </div>
      </div>
    )}
    {/* Camera Viewfinder Overlay */}
    {camTarget&&<CameraViewfinder side={camTarget} onCapture={handleCam} onClose={()=>setCamTarget(null)}/>}
    {/* Header */}
    <div style={{padding:"calc(14px + env(safe-area-inset-top)) 16px 14px",borderBottom:"1px solid #1a1c22",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,background:"#0a0b0e"}}>
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <HoloLogo
          size={32}
          gyroInput={gyroInputRef.current}
          config={{
            ...holoConfig.logo,
            availableOptions: holoConfig.availableOptions,
          }}
          showSparkles={true}
        />
        <div><div style={{fontSize:14,fontWeight:600}}>SlabSense</div><div style={{fontFamily:mono,fontSize:11,color:"#444",textTransform:"uppercase",letterSpacing:".1em"}}>v{__APP_VERSION__}</div></div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8}}>
        {/* Grading Company Selector */}
        <select value={gradingCompany} onChange={e=>setGradingCompany(e.target.value)} style={{background:"#1a1c22",border:"1px solid #2a2d35",borderRadius:6,color:"#888",fontFamily:mono,fontSize:10,padding:"5px 8px",cursor:"pointer",textTransform:"uppercase"}}>
          {getCompanyOptions().map(c=>(<option key={c.id} value={c.id}>{c.name}</option>))}
        </select>
        {step===2&&<button onClick={reset} style={{background:"transparent",border:"1px solid #2a2d35",borderRadius:6,color:"#666",fontFamily:mono,fontSize:10,padding:"5px 10px",cursor:"pointer",textTransform:"uppercase"}}>New</button>}
        {/* Credits Display */}
        {auth.isAuthenticated && (
          <CreditBalance userId={auth.user?.id} onBuyCredits={() => setShowPricing(true)} compact />
        )}
        {/* Auth UI */}
        {auth.isConfigured && (
          auth.isAuthenticated ? (
            <UserMenu user={auth.user} profile={auth.profile} onSignOut={auth.signOut} onOpenCollection={() => setShowCollection(true)} onOpenSettings={() => setShowSettings(true)} onBuyCredits={() => setShowPricing(true)} />
          ) : (
            <button onClick={() => setShowAuthModal(true)} style={{background:"linear-gradient(135deg,#6366f1,#8b5cf6)",border:"none",borderRadius:6,color:"#fff",fontFamily:mono,fontSize:10,padding:"6px 12px",cursor:"pointer",textTransform:"uppercase"}}>Sign In</button>
          )
        )}
      </div>
    </div>

    {/* UNIFIED TAB BAR */}
    <div style={{display:"flex",borderBottom:"1px solid #1a1c22",background:"#0a0b0e",position:"sticky",top:"calc(54px + env(safe-area-inset-top))",zIndex:99}}>
      {tabs.map(t=>{
        const isActive = tab===t.id;
        const isAnalysis = t.analysis;
        const hasResults = step===2 && !!gr;
        const isDisabled = isAnalysis && !hasResults;
        const activeColor = hasResults && gr?.grade?.color ? gr.grade.color : "#6366f1";
        return(
          <button key={t.id} onClick={()=>!isDisabled && setTab(t.id)} style={{
            flex:1,
            padding:"10px 0 8px",
            background:"transparent",
            border:"none",
            borderBottom:isActive?`2px solid ${activeColor}`:"2px solid transparent",
            color:isDisabled?"#333":isActive?"#ddd":"#666",
            fontFamily:mono,
            fontSize:11,
            cursor:isDisabled?"default":"pointer",
            textTransform:"uppercase",
            display:"flex",
            flexDirection:"column",
            alignItems:"center",
            gap:2,
            opacity:isDisabled?0.4:1,
            transition:"all .2s",
          }}>
            <span style={{fontSize:14}}>{t.i}</span>
            {t.l}
          </button>
        );
      })}
    </div>

    {/* CAPTURE - Vertical Layout */}
    {tab==="scan"&&step===0&&(<div style={{padding:16,flex:1}}>
      {/* Vertical stack of capture cards */}
      <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
        <CaptureCardVertical label="Front" side="front" image={fI} onImage={handleSetFrontImage} onOpenCamera={setCamTarget} quality={frontQuality}/>
        <CaptureCardVertical label="Back" side="back" image={bI} onImage={handleSetBackImage} onOpenCamera={setCamTarget} quality={backQuality}/>
      </div>
      {(()=>{const atCap=!!auth.isAuthenticated&&gradeAccess&&!gradeAccess.unlimited&&gradeAccess.remaining===0;const ready=fI&&bI;return <button onClick={atCap?()=>{setGate({kind:"limit",freeGrades:{used:10,limit:10,remaining:0}});setStep(1);}:requestGrade} disabled={!ready} style={{width:"100%",padding:"14px 0",borderRadius:10,border:"none",background:fI&&bI?"linear-gradient(135deg,#00ff88,#0088ff)":"#1a1c22",color:fI&&bI?"#000":"#444",fontFamily:mono,fontSize:13,fontWeight:700,cursor:fI&&bI?"pointer":"default",textTransform:"uppercase",letterSpacing:".08em",transition:"all .3s"}}>{gradeButtonLabel({hasPhotos:!!ready,signedIn:!!auth.isAuthenticated,unlimited:!!gradeAccess?.unlimited,remaining:gradeAccess?gradeAccess.remaining:null})}</button>;})()}
      <div style={{marginTop:16,padding:14,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
        <div style={{fontFamily:mono,fontSize:10,color:"#6366f1",textTransform:"uppercase",marginBottom:6}}>Multi-Company Grade Estimation</div>
        <div style={{fontSize:12,color:"#666",lineHeight:1.7}}>
          Analyze cards against <span style={{color:"#ff9944"}}>{GRADING_COMPANIES[gradingCompany]?.name || 'TAG'}</span> grading standards.
          Detects centering, corners, edges, and surface defects. Front defects weighted ~2x heavier than back.
          Holo card detection adjusts thresholds automatically.
        </div>
        <div style={{marginTop:8,fontSize:10,color:"#555",fontStyle:"italic"}}>
          Select grading company in header to compare against different scales.
        </div>
      </div>
    </div>)}

    {/* ANALYZING */}
    {tab==="scan"&&step===1&&gate&&(
      <GradeGate kind={gate.kind} freeGrades={gate.freeGrades}
        onSignIn={()=>{pendingGradeRef.current=true; setShowAuthModal(true);}}
        onPlus={()=>{setInsufficientCredits(null); setShowPricing(true);}}
        onBack={()=>{setGate(null); setStep(0);}} />
    )}
    {tab==="scan"&&step===1&&!gate&&(<div role="status" aria-live="polite" style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32}}>
      {analysisFailed
        ? <div aria-hidden="true" style={{width:48,height:48,borderRadius:"50%",border:"3px solid #ff4444",display:"flex",alignItems:"center",justifyContent:"center",color:"#ff4444",fontSize:22}}>!</div>
        : <div aria-hidden="true" style={{width:48,height:48,borderRadius:"50%",border:"3px solid #1a1c22",borderTopColor:"#00ff88",animation:"spin .8s linear infinite"}}/>}
      <div style={{fontFamily:mono,fontSize:12,color:analysisFailed?"#ff6666":"#666",marginTop:16,textAlign:"center"}}>{prog}</div>
      {analysisFailed&&<button onClick={()=>{setAnalysisFailed(false);setProg("");setStep(0);}} style={{marginTop:20,minHeight:44,padding:"12px 24px",borderRadius:10,border:"none",background:"#6366f1",color:"#fff",fontFamily:mono,fontSize:12,fontWeight:600,cursor:"pointer"}}>Try again with new photos</button>}
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>)}

    {/* SCAN TAB - After Analysis Complete */}
    {tab==="scan"&&step===2&&(<div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:48,marginBottom:12}}>✓</div>
        <div style={{fontFamily:sans,fontSize:18,fontWeight:600,color:"#00ff88",marginBottom:4}}>Analysis Complete</div>
        <div style={{fontFamily:mono,fontSize:12,color:"#666"}}>View results in Grade tab</div>
      </div>
      <button onClick={()=>{setStep(0);setFI(null);setBI(null);resetGradingState();}} style={{
        padding:"14px 32px",borderRadius:10,border:"none",
        background:"linear-gradient(135deg,#6366f1,#8b5cf6)",
        color:"#fff",fontFamily:mono,fontSize:13,fontWeight:700,cursor:"pointer",
        textTransform:"uppercase",letterSpacing:".08em"
      }}>◎ Scan New Card</button>
    </div>)}

    {/* GRADE TAB */}
    {tab==="grade"&&step===2&&gr&&(<div style={{flex:1,padding:16,overflowY:"auto"}}>
          {/* Card Info Header */}
          <div style={{marginBottom:16,textAlign:"center"}}>
            <div style={{fontFamily:sans,fontSize:20,fontWeight:700,color:"#fff",marginBottom:4}}>
              {cardInfo?.name || "Unknown Card"}
            </div>
            <div style={{fontFamily:mono,fontSize:11,color:"#888"}}>
              {cardInfo?.year && `${cardInfo.year} `}
              {cardInfo?.setName || ""}
              {cardInfo?.cardNumber && ` #${cardInfo.cardNumber}`}
            </div>
            {cardInfo?.rarity && (
              <div style={{fontFamily:mono,fontSize:10,color:"#fbbf24",marginTop:4}}>{cardInfo.rarity}</div>
            )}
            {/* Card Value from TCGDex */}
            {(tcgdexData?.pricing?.cardmarket || cardInfo?.pricing) && (() => {
              // tcgdexData has nested cardmarket, cardInfo.pricing is already flattened
              const pricing = tcgdexData?.pricing?.cardmarket || cardInfo?.pricing;
              const eurPrice = pricing?.trend || pricing?.avg || pricing?.low || null;
              if (!eurPrice) return null;
              const usdPrice = Math.round(eurPrice * 1.08 * 100) / 100;
              return (
                <div style={{marginTop:8,padding:"6px 12px",background:"rgba(0,255,136,0.1)",borderRadius:6,display:"inline-block"}}>
                  <span style={{fontFamily:mono,fontSize:14,fontWeight:700,color:"#00ff88"}}>${usdPrice.toFixed(2)}</span>
                  <span style={{fontFamily:mono,fontSize:10,color:"#00ff8866",marginLeft:6}}>raw value</span>
                </div>
              );
            })()}
          </div>

          {/* Software/AI/Deep Grade Toggle */}
          {(aiGrades || deepAiGrades) && (
            <div style={{display:"flex",justifyContent:"center",gap:6,marginBottom:12,flexWrap:"wrap"}}>
              <button onClick={()=>setGradeMode('software')} style={{
                padding:"8px 14px",borderRadius:6,border:"none",
                background:gradeMode==='software'?"#6366f1":"#1a1c22",
                color:gradeMode==='software'?"#fff":"#666",
                fontFamily:mono,fontSize:10,fontWeight:600,cursor:"pointer",
                transition:"all .2s"
              }}>Software</button>
              {aiGrades && (
                <button onClick={()=>setGradeMode('ai')} style={{
                  padding:"8px 14px",borderRadius:6,border:"none",
                  background:gradeMode==='ai'?"#8b5cf6":"#1a1c22",
                  color:gradeMode==='ai'?"#fff":"#666",
                  fontFamily:mono,fontSize:10,fontWeight:600,cursor:"pointer",
                  transition:"all .2s"
                }}>AI (basic)</button>
              )}
              {deepAiGrades && (
                <button onClick={()=>setGradeMode('deep')} style={{
                  padding:"8px 14px",borderRadius:6,border:"none",
                  background:gradeMode==='deep'?"#f97316":"#1a1c22",
                  color:gradeMode==='deep'?"#fff":"#666",
                  fontFamily:mono,fontSize:10,fontWeight:600,cursor:"pointer",
                  transition:"all .2s"
                }}>AI Grade</button>
              )}
            </div>
          )}

          {/* AI Centering removed - centering always comes from manual/software measurement */}

          {/* Score + Grade Display - Company specific */}
          {gradeMode === 'software' ? (
            <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:16,marginBottom:16,padding:20,background:"#0d0f13",borderRadius:10,border:`1px solid ${gr?.grade?.color || '#666'}33`}}>
              {/* TAG: Show raw score */}
              {gradingCompany === 'tag' && gr?.rawScore !== undefined && (
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:mono,fontSize:32,fontWeight:800,color:"#888"}}>{gr.rawScore}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:"#555"}}>/ 1000</div>
                </div>
              )}
              {/* Grade Number */}
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:mono,fontSize:48,fontWeight:900,color:gr?.grade?.color || '#00ff88'}}>{gr?.grade?.grade ?? '--'}</div>
                <div style={{fontFamily:mono,fontSize:12,fontWeight:600,color:gr?.grade?.color || '#00ff88',marginTop:2}}>{gr?.grade?.label || 'Grade'}</div>
              </div>
              {/* Company Badge */}
              <div style={{padding:"8px 12px",background:`${gr?.grade?.color || '#666'}15`,borderRadius:8,border:`1px solid ${gr?.grade?.color || '#666'}33`}}>
                <div style={{fontFamily:mono,fontSize:11,fontWeight:700,color:gr?.grade?.color || '#666'}}>{GRADING_COMPANIES[gradingCompany]?.name || 'TAG'}</div>
              </div>
            </div>
          ) : gradeMode === 'ai' ? (
            /* Standard AI Grade Display */
            <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:16,marginBottom:16,padding:20,background:"#0d0f13",borderRadius:10,border:"1px solid #8b5cf633"}}>
              {/* TAG: Show AI raw score if available */}
              {gradingCompany === 'tag' && aiGrades?.tag?.score !== undefined && (
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:mono,fontSize:32,fontWeight:800,color:"#888"}}>{aiGrades.tag.score}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:"#555"}}>/ 1000</div>
                </div>
              )}
              {/* AI Grade Number */}
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:mono,fontSize:48,fontWeight:900,color:"#8b5cf6"}}>{aiGrades?.[gradingCompany]?.grade ?? aiOverall?.grade ?? '--'}</div>
                <div style={{fontFamily:mono,fontSize:12,fontWeight:600,color:"#8b5cf6",marginTop:2}}>{aiGrades?.[gradingCompany]?.label || aiOverall?.label || 'AI Grade'}</div>
                {/* Confidence indicator - from unified schema confidence.value */}
                {aiConfidence?.value !== undefined && (
                  <div style={{fontFamily:mono,fontSize:10,color:aiConfidence.value >= 0.8 ? '#00ff88' : aiConfidence.value >= 0.6 ? '#ffcc00' : '#ff6633',marginTop:4}}>
                    {Math.round(aiConfidence.value * 100)}% confident
                  </div>
                )}
                {aiOverall?.capsApplied?.length > 0 && (
                  <div style={{fontFamily:mono,fontSize:11,color:'#888',marginTop:4}}>Limited by: {formatCaps(aiOverall.capsApplied)}</div>
                )}
              </div>
              {/* Company Badge with AI indicator */}
              <div style={{padding:"8px 12px",background:"rgba(139,92,246,0.15)",borderRadius:8,border:"1px solid rgba(139,92,246,0.3)"}}>
                <div style={{fontFamily:mono,fontSize:11,fontWeight:700,color:"#8b5cf6"}}>{GRADING_COMPANIES[gradingCompany]?.name || 'TAG'}</div>
                <div style={{fontFamily:mono,fontSize:11,color:"#6366f1",marginTop:2}}>AI ESTIMATE</div>
              </div>
            </div>
          ) : (
            /* Deep AI Grade Display */
            <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:16,marginBottom:16,padding:20,background:"#0d0f13",borderRadius:10,border:"1px solid #f9731633"}}>
              {/* TAG: Show Deep AI raw score if available */}
              {gradingCompany === 'tag' && deepAiGrades?.tag?.score !== undefined && (
                <div style={{textAlign:"center"}}>
                  <div style={{fontFamily:mono,fontSize:32,fontWeight:800,color:"#888"}}>{deepAiGrades.tag.score}</div>
                  <div style={{fontFamily:mono,fontSize:11,color:"#555"}}>/ 1000</div>
                </div>
              )}
              {/* Deep AI Grade Number */}
              <div style={{textAlign:"center"}}>
                <div style={{fontFamily:mono,fontSize:48,fontWeight:900,color:"#f97316"}}>{deepAiGrades?.[gradingCompany]?.grade ?? deepAiOverall?.grade ?? '--'}</div>
                <div style={{fontFamily:mono,fontSize:12,fontWeight:600,color:"#f97316",marginTop:2}}>{deepAiGrades?.[gradingCompany]?.label || deepAiOverall?.label || 'Deep AI'}</div>
                {/* Confidence indicator - from unified schema confidence.value */}
                {deepAiConfidence?.value !== undefined && (
                  <div style={{fontFamily:mono,fontSize:10,color:deepAiConfidence.value >= 0.8 ? '#00ff88' : deepAiConfidence.value >= 0.6 ? '#ffcc00' : '#ff6633',marginTop:4}}>
                    {Math.round(deepAiConfidence.value * 100)}% confident
                  </div>
                )}
                {deepAiOverall?.capsApplied?.length > 0 && (
                  <div style={{fontFamily:mono,fontSize:11,color:'#888',marginTop:4}}>Limited by: {formatCaps(deepAiOverall.capsApplied)}</div>
                )}
              </div>
              {/* Company Badge with Deep AI indicator */}
              <div style={{padding:"8px 12px",background:"rgba(249,115,22,0.15)",borderRadius:8,border:"1px solid rgba(249,115,22,0.3)"}}>
                <div style={{fontFamily:mono,fontSize:11,fontWeight:700,color:"#f97316"}}>{GRADING_COMPANIES[gradingCompany]?.name || 'TAG'}</div>
                <div style={{fontFamily:mono,fontSize:11,color:"#ea580c",marginTop:2}}>AI ESTIMATE</div>
              </div>
            </div>
          )}

          {/* Front + Back Card Images - Prefer cropped images */}
          <div style={{display:"flex",gap:8,marginBottom:12}}>
            <div style={{flex:1,aspectRatio:"2.5/3.5",borderRadius:8,overflow:"hidden",background:"#0a0a0a",position:"relative"}}>
              {/* Base image - cropped preferred over original */}
              <img src={frontCroppedImage || fI} alt="Front of card" style={{width:"100%",height:"100%",objectFit:"contain",position:"absolute",inset:0}}/>
              {/* Filtered overlay with intensity (maps are built from the same image shown below) */}
              {visionMode!=='normal'&&fM?.[visionMode]&&(
                <img src={fM[visionMode]} alt="" style={{width:"100%",height:"100%",objectFit:"contain",position:"absolute",inset:0,opacity:visionIntensity/100}}/>
              )}
              <div style={{position:"absolute",bottom:4,left:4,fontFamily:mono,fontSize:11,color:"#555",background:"rgba(0,0,0,0.7)",padding:"2px 6px",borderRadius:4,zIndex:1}}>FRONT</div>
            </div>
            <div style={{flex:1,aspectRatio:"2.5/3.5",borderRadius:8,overflow:"hidden",background:"#0a0a0a",position:"relative"}}>
              {/* Base image - cropped preferred over original */}
              <img src={backCroppedImage || bI} alt="Back of card" style={{width:"100%",height:"100%",objectFit:"contain",position:"absolute",inset:0}}/>
              {/* Filtered overlay with intensity (maps are built from the same image shown below) */}
              {visionMode!=='normal'&&bM?.[visionMode]&&(
                <img src={bM[visionMode]} alt="" style={{width:"100%",height:"100%",objectFit:"contain",position:"absolute",inset:0,opacity:visionIntensity/100}}/>
              )}
              <div style={{position:"absolute",bottom:4,right:4,fontFamily:mono,fontSize:11,color:"#555",background:"rgba(0,0,0,0.7)",padding:"2px 6px",borderRadius:4,zIndex:1}}>BACK</div>
            </div>
          </div>

          {/* Vision Intensity Slider */}
          <div style={{marginBottom:10}}>
            <input type="range" min="0" max="100" value={visionIntensity} onChange={e=>setVisionIntensity(Number(e.target.value))}
              style={{width:"100%",height:6,borderRadius:3,background:`linear-gradient(90deg,#6366f1 ${visionIntensity}%,#1a1c22 ${visionIntensity}%)`,appearance:"none",cursor:"pointer"}}/>
            <style>{`input[type=range]::-webkit-slider-thumb{appearance:none;width:14px;height:14px;borderRadius:50%;background:#8b5cf6;cursor:pointer;border:2px solid #0a0b0e;}`}</style>
          </div>

          {/* Vision Mode Buttons */}
          <div style={{display:"flex",gap:6,marginBottom:12}}>
            {[['normal','Normal'],['emboss','Emboss'],['highpass','Hi-Pass'],['edges','Edges']].map(([mode,label])=>(
              <button key={mode} onClick={()=>setVisionMode(mode)} style={{
                flex:1,padding:"8px 0",borderRadius:6,
                border:visionMode===mode?"1px solid #6366f1":"1px solid #2a2d35",
                background:visionMode===mode?"rgba(99,102,241,0.15)":"transparent",
                color:visionMode===mode?"#8b5cf6":"#666",
                fontFamily:mono,fontSize:11,cursor:"pointer",textTransform:"uppercase"
              }}>{label}</button>
            ))}
          </div>

          {/* Compact Action Icons */}
          <div style={{display:"flex",justifyContent:"center",gap:24,marginBottom:16}}>
            {auth.isAuthenticated && (
              <button onClick={handleSaveScan} disabled={savingStatus==='saving'} title={savedScanId ? "Update saved card" : "Save to Collection"} style={{
                background:"transparent",border:"none",cursor:"pointer",padding:8,color:savingStatus==='saved'?"#00ff88":"#666",fontSize:20,transition:"color .2s"
              }}>{savingStatus==='saving'?"⏳":savingStatus==='saved'?"✓":"💾"}</button>
            )}
            <button onClick={()=>setShowExport(true)} title="Share / Export" style={{
              background:"transparent",border:"none",cursor:"pointer",padding:8,color:"#666",fontSize:18,transition:"color .2s"
            }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 16v4h16v-4"/><path d="M12 4v12"/><path d="M8 8l4-4 4 4"/>
              </svg>
            </button>
            {/* One paid tier (2026-10-02): "AI Grade" runs the two-pass flow with TAG reference cards for one credit */}
            <button onClick={()=>startGradeJob(PAID_GRADE_TYPE)} disabled={deepGradeStatus==='grading'||deepGradeStatus==='done'} aria-label={`AI Grade, ${creditsLabel(GRADE_TIERS.deep.credits)}`} title={`AI Grade — two-pass inspection with TAG reference cards (${creditsLabel(GRADE_TIERS.deep.credits)})`} style={{
              background:"transparent",border:"none",cursor:deepGradeStatus==='grading'?"wait":"pointer",padding:4,minWidth:44,minHeight:44,transition:"opacity .2s",opacity:deepGradeStatus==='done'?0.5:1
            }}>
              {deepGradeStatus==='grading'?<span style={{fontSize:18,color:"#666"}}>⏳</span>:deepGradeStatus==='done'?<span style={{fontSize:18,color:"#00ff88"}}>✓</span>:(
                <div style={{display:"flex",flexDirection:"column",alignItems:"center",lineHeight:1.1}}>
                  <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:"#8b5cf6"}}>AI</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:"#6366f1"}}>Grade</span>
                </div>
              )}
            </button>
            <button onClick={handle3DView} title="3D Slab View" style={{
              background:"transparent",border:"none",cursor:"pointer",padding:4,color:tcgdexImage?"#8b5cf6":"#666",transition:"color .2s"
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="5" width="18" height="14" rx="2" fill="none"/>
                <rect x="5" y="7" width="14" height="10" rx="1" fill="currentColor" opacity="0.15"/>
                <line x1="3" y1="8" x2="21" y2="8" strokeWidth="1"/>
              </svg>
            </button>
            <button onClick={()=>setShowDamageReport(true)} title="Damage Report" style={{
              background:"transparent",border:"none",cursor:"pointer",padding:4,color:gr?.totalDings>0?"#ff6633":"#666",transition:"color .2s"
            }}>
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",lineHeight:1.1}}>
                <span style={{fontFamily:mono,fontSize:12,fontWeight:700,color:gr?.totalDings>0?"#ff6633":"#666"}}>⚠</span>
                <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:gr?.totalDings>0?"#ff9944":"#555"}}>Dings</span>
              </div>
            </button>
          </div>

          {/* 4 Score Boxes - uses subgrades based on gradeMode */}
          {(() => {
            // Select subgrades source based on mode
            const subgrades = gradeMode === 'deep' ? deepAiSubgrades : gradeMode === 'ai' ? aiSubgrades : gr?.subgrades;
            // Compute combined scores (average front+back, 0-100 scale → display as 0-100)
            const cornersScore = subgrades ? Math.round(((subgrades.frontCorners ?? 100) + (subgrades.backCorners ?? 100)) / 2) : null;
            const edgesScore = subgrades ? Math.round(((subgrades.frontEdges ?? 100) + (subgrades.backEdges ?? 100)) / 2) : null;
            const surfaceScore = subgrades ? Math.round(((subgrades.frontSurface ?? 100) + (subgrades.backSurface ?? 100)) / 2) : null;
            // Color thresholds for 0-100 scale
            const getColor = (val) => val >= 95 ? "#00ff88" : val >= 90 ? "#66dd44" : val >= 80 ? "#ffcc00" : "#ff6633";
            return (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
                <div style={{padding:12,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
                  <div style={{fontFamily:mono,fontSize:11,color:"#666",marginBottom:4}}>CORNERS</div>
                  <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:cornersScore ? getColor(cornersScore) : "#666"}}>{cornersScore ?? "--"}</div>
                </div>
                <div style={{padding:12,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
                  <div style={{fontFamily:mono,fontSize:11,color:"#666",marginBottom:4}}>EDGES</div>
                  <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:edgesScore ? getColor(edgesScore) : "#666"}}>{edgesScore ?? "--"}</div>
                </div>
                <div style={{padding:12,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
                  <div style={{fontFamily:mono,fontSize:11,color:"#666",marginBottom:4}}>SURFACE</div>
                  <div style={{fontFamily:mono,fontSize:18,fontWeight:700,color:surfaceScore ? getColor(surfaceScore) : "#666"}}>{surfaceScore ?? "--"}</div>
                </div>
                <div style={{padding:12,background:"#0d0f13",borderRadius:8,border:"1px solid #1a1c22"}}>
                  <div style={{fontFamily:mono,fontSize:11,color:"#666",marginBottom:4}}>CENTERING {frontCenteringData?.didManualCenter ? '(M)' : ''}</div>
                  <div style={{fontFamily:mono,fontSize:14,fontWeight:700,color:frontCenteringData?.didManualCenter ? "#ff9944" : "#00ff88"}}>{frontCenteringData?.didManualCenter ? Math.round(frontCenteringData.lrRatio) : (fR?.centering?.lrRatio||50)}/{frontCenteringData?.didManualCenter ? Math.round(100-frontCenteringData.lrRatio) : (100-(fR?.centering?.lrRatio||50))}</div>
                </div>
              </div>
            );
          })()}

          {/* Total Dings / defects — from whichever grade is being viewed */}
          {(() => {
            const count = gradeMode === 'deep' ? deepGradeResult?.defects?.counts?.total
              : gradeMode === 'ai' ? aiDefects?.counts?.total
              : gr?.totalDings;
            if (count === undefined || count === null) return null;
            return (
              <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",marginBottom:12}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontFamily:mono,fontSize:11,color:"#888"}}>{gradeMode === 'software' ? 'Defects found' : 'Defects found (AI Grade)'}</span>
                  <span style={{fontFamily:mono,fontSize:20,fontWeight:800,color:count===0?"#00ff88":count<=2?"#66dd44":count<=4?"#ffcc00":"#ff6633"}}>{count}</span>
                </div>
              </div>
            );
          })()}

          {/* Grade Analysis (software tips; AI modes show the model's notes below) */}
          {gradeMode === 'software' && gr?.rawScore !== undefined && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#888",textTransform:"uppercase",marginBottom:8}}>Grade Analysis</div>
              {(getNextGradeInfo(gr)||[]).map((tip,i,arr)=>(
                <div key={i} style={{display:"flex",gap:8,marginBottom:i<arr.length-1?8:0}}>
                  <div style={{width:3,borderRadius:2,background:tip?.color||'#666',flexShrink:0,marginTop:2}}/>
                  <div style={{fontFamily:sans,fontSize:12,color:"#aaa",lineHeight:1.5}}>{tip?.text||''}</div>
                </div>
              ))}
            </div>
          )}

          {/* Confidence Notes - Different for each mode */}
          {(()=>{
            try {
              // AI / Deep AI: the model's observations (concerns, positives, recommendation)
              if (gradeMode === 'ai' || gradeMode === 'deep') {
                const summary = gradeMode === 'deep' ? deepAiSummary : aiSummary;
                if (!summary) return null;
                const accent = gradeMode === 'deep' ? '#f97316' : '#8b5cf6';
                return (
                  <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${accent}33`,marginBottom:12}}>
                    <div style={{fontFamily:mono,fontSize:10,color:accent,textTransform:"uppercase",marginBottom:8}}>{gradeMode === 'deep' ? 'Deep AI' : 'AI'} Notes</div>
                    {(summary.concerns||[]).map((c,i)=>(<div key={`c${i}`} style={{fontFamily:sans,fontSize:11,color:"#ff9944",marginBottom:4}}>⚠ {c}</div>))}
                    {(summary.positives||[]).map((p,i)=>(<div key={`p${i}`} style={{fontFamily:sans,fontSize:11,color:"#888",marginBottom:4}}>• {p}</div>))}
                    {summary.recommendation && <div style={{fontFamily:sans,fontSize:11,color:"#aaa",marginTop:6,lineHeight:1.5}}>{summary.recommendation}</div>}
                  </div>
                );
              }
              // Software mode: show confidence analysis
              if (gradeMode === 'software' && gr && fR && bR) {
                const conf=calcConfidence(gr,fR,bR);
                return conf?.reasons?.length>0?(
                  <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${conf.color||'#666'}22`,marginBottom:12}}>
                    <div style={{fontFamily:mono,fontSize:10,color:conf.color||'#666',textTransform:"uppercase",marginBottom:8}}>Confidence Notes</div>
                    {conf.reasons.map((r,i)=>(
                      <div key={i} style={{fontFamily:sans,fontSize:11,color:"#777",marginBottom:4}}>• {r}</div>
                    ))}
                  </div>
                ):null;
              }
              return null;
            } catch(e) { return null; }
          })()}

          {/* TAG 8 Subgrades (DIG Report Style) - Software mode */}
          {gradingCompany === 'tag' && gradeMode === 'software' && gr?.subgrades && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #00ff8833",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#00ff88",textTransform:"uppercase",marginBottom:10}}>Subgrades (Software)</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  {k:"frontCentering",l:"Front Centering"},
                  {k:"backCentering",l:"Back Centering"},
                  {k:"frontCorners",l:"Front Corners"},
                  {k:"backCorners",l:"Back Corners"},
                  {k:"frontEdges",l:"Front Edges"},
                  {k:"backEdges",l:"Back Edges"},
                  {k:"frontSurface",l:"Front Surface"},
                  {k:"backSurface",l:"Back Surface"},
                ].map(({k,l})=>{
                  const val = gr?.subgrades?.[k];
                  if(val==null)return null;
                  const color = val>=95?"#00ff88":val>=90?"#66dd44":val>=80?"#ffcc00":"#ff6633"; // subgrades are 0-100
                  return(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                    <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>{l}</span>
                    <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color}}>{val}</span>
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* TAG 8 Subgrades (DIG Report Style) - AI or Deep AI */}
          {/* Uses top-level subgrades (0-100 scale) from unified schema */}
          {gradingCompany === 'tag' && (gradeMode === 'ai' ? aiSubgrades : gradeMode === 'deep' ? deepAiSubgrades : null) && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${gradeMode==='deep'?'#f97316':'#8b5cf6'}33`,marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:gradeMode==='deep'?'#f97316':'#8b5cf6',textTransform:"uppercase",marginBottom:10}}>Subgrades {gradeMode==='deep'?'(Deep AI)':'(AI)'}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  {k:"frontCentering",l:"Front Centering"},
                  {k:"backCentering",l:"Back Centering"},
                  {k:"frontCorners",l:"Front Corners"},
                  {k:"backCorners",l:"Back Corners"},
                  {k:"frontEdges",l:"Front Edges"},
                  {k:"backEdges",l:"Back Edges"},
                  {k:"frontSurface",l:"Front Surface"},
                  {k:"backSurface",l:"Back Surface"},
                ].map(({k,l})=>{
                  const subgrades = gradeMode==='deep' ? deepAiSubgrades : aiSubgrades;
                  const val = subgrades?.[k];
                  if(val==null)return null;
                  // 0-100 scale: 95+ green, 90+ lime, 80+ yellow
                  const color = val>=95?"#00ff88":val>=90?"#66dd44":val>=80?"#ffcc00":"#ff6633";
                  return(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                    <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>{l}</span>
                    <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color}}>{val?.toFixed?.(1) ?? val}</span>
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* BGS 4 Subgrades - AI or Deep AI */}
          {gradingCompany === 'bgs' && (gradeMode === 'ai' ? aiGrades?.bgs?.subgrades : gradeMode === 'deep' ? deepAiGrades?.bgs?.subgrades : null) && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${gradeMode==='deep'?'#f97316':'#ffd93d'}33`,marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:gradeMode==='deep'?'#f97316':'#ffd93d',textTransform:"uppercase",marginBottom:10}}>BGS Subgrades {gradeMode==='deep'?'(Deep AI)':'(AI)'}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  {k:"centering",l:"Centering"},
                  {k:"corners",l:"Corners"},
                  {k:"edges",l:"Edges"},
                  {k:"surface",l:"Surface"},
                ].map(({k,l})=>{
                  const grades = gradeMode==='deep' ? deepAiGrades : aiGrades;
                  const val = grades?.bgs?.subgrades?.[k];
                  if(val==null)return null;
                  const color = val>=9.5?"#00ff88":val>=9?"#66dd44":val>=8?"#ffcc00":"#ff6633";
                  return(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                    <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>{l}</span>
                    <span style={{fontFamily:mono,fontSize:12,fontWeight:600,color}}>{val}</span>
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* CGC 4 Subgrades - AI or Deep AI */}
          {gradingCompany === 'cgc' && (gradeMode === 'ai' ? aiGrades?.cgc?.subgrades : gradeMode === 'deep' ? deepAiGrades?.cgc?.subgrades : null) && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${gradeMode==='deep'?'#f97316':'#4d96ff'}33`,marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:gradeMode==='deep'?'#f97316':'#4d96ff',textTransform:"uppercase",marginBottom:10}}>CGC Subgrades {gradeMode==='deep'?'(Deep AI)':'(AI)'}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {[
                  {k:"centering",l:"Centering"},
                  {k:"corners",l:"Corners"},
                  {k:"edges",l:"Edges"},
                  {k:"surface",l:"Surface"},
                ].map(({k,l})=>{
                  const grades = gradeMode==='deep' ? deepAiGrades : aiGrades;
                  const val = grades?.cgc?.subgrades?.[k];
                  if(val==null)return null;
                  const color = val>=9.5?"#00ff88":val>=9?"#66dd44":val>=8?"#ffcc00":"#ff6633";
                  return(<div key={k} style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                    <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>{l}</span>
                    <span style={{fontFamily:mono,fontSize:12,fontWeight:600,color}}>{val}</span>
                  </div>);
                })}
              </div>
            </div>
          )}

          {/* Centering Measurements - Manual/Software only, no AI centering */}
          {(fR?.centering || bR?.centering) && (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:"1px solid #1a1c22",marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:"#666",textTransform:"uppercase",marginBottom:10}}>Centering Measurements</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div style={{padding:"8px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:11,color:"#666",marginBottom:4}}>FRONT {frontCenteringData?.didManualCenter ? '(Manual)' : '(Software)'}</div>
                  {frontCenteringData?.didManualCenter ? (
                    <>
                      <div style={{fontFamily:mono,fontSize:11,color:"#ff9944"}}>{Math.round(frontCenteringData.lrRatio*10)/10}/{Math.round((100-frontCenteringData.lrRatio)*10)/10} L/R</div>
                      <div style={{fontFamily:mono,fontSize:11,color:"#ff9944"}}>{Math.round(frontCenteringData.tbRatio*10)/10}/{Math.round((100-frontCenteringData.tbRatio)*10)/10} T/B</div>
                    </>
                  ) : (
                    <>
                      <div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>{fR?.centering?.lrRatio ? `${Math.round(fR.centering.lrRatio)}/${Math.round(100-fR.centering.lrRatio)}` : "50/50"} L/R</div>
                      <div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>{fR?.centering?.tbRatio ? `${Math.round(fR.centering.tbRatio)}/${Math.round(100-fR.centering.tbRatio)}` : "50/50"} T/B</div>
                    </>
                  )}
                </div>
                <div style={{padding:"8px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <div style={{fontFamily:mono,fontSize:11,color:"#666",marginBottom:4}}>BACK {backCenteringData?.didManualCenter ? '(Manual)' : '(Software)'}</div>
                  {backCenteringData?.didManualCenter ? (
                    <>
                      <div style={{fontFamily:mono,fontSize:11,color:"#ff9944"}}>{Math.round(backCenteringData.lrRatio*10)/10}/{Math.round((100-backCenteringData.lrRatio)*10)/10} L/R</div>
                      <div style={{fontFamily:mono,fontSize:11,color:"#ff9944"}}>{Math.round(backCenteringData.tbRatio*10)/10}/{Math.round((100-backCenteringData.tbRatio)*10)/10} T/B</div>
                    </>
                  ) : (
                    <>
                      <div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>{bR?.centering?.lrRatio ? `${Math.round(bR.centering.lrRatio)}/${Math.round(100-bR.centering.lrRatio)}` : "50/50"} L/R</div>
                      <div style={{fontFamily:mono,fontSize:11,color:"#00ff88"}}>{bR?.centering?.tbRatio ? `${Math.round(bR.centering.tbRatio)}/${Math.round(100-bR.centering.tbRatio)}` : "50/50"} T/B</div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* AI/Deep AI Condition Assessment - derived from subgrades (unified schema) */}
          {(()=>{
            const isDeep = gradeMode === 'deep';
            const subgrades = isDeep ? deepAiSubgrades : aiSubgrades;
            const overall = isDeep ? deepAiOverall : aiOverall;
            // Only show for AI/Deep modes when subgrades exist
            if (gradeMode === 'software' || !subgrades) return null;

            // Convert 0-100 subgrades to combined 1-10 scores
            const to10 = (val) => val != null ? (val / 10).toFixed(1) : null;
            const avg = (a, b) => a != null && b != null ? (a + b) / 2 : (a ?? b);
            const corners10 = to10(avg(subgrades.frontCorners, subgrades.backCorners));
            const edges10 = to10(avg(subgrades.frontEdges, subgrades.backEdges));
            const surface10 = to10(avg(subgrades.frontSurface, subgrades.backSurface));
            const centering10 = to10(avg(subgrades.frontCentering, subgrades.backCentering));
            const overall10 = overall?.score != null ? to10(overall.score) : null;

            const borderColor = isDeep ? '#f9731633' : '#8b5cf633';
            const getColor = (val) => parseFloat(val) >= 9 ? "#00ff88" : parseFloat(val) >= 7 ? "#ffcc00" : "#ff6633";

            return (
            <div style={{padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${borderColor}`,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                <div style={{fontFamily:mono,fontSize:10,color:"#666",textTransform:"uppercase"}}>Condition (1-10 Scale)</div>
                {isDeep && <span style={{fontFamily:mono,fontSize:11,color:"#f97316",background:"rgba(249,115,22,0.15)",padding:"2px 6px",borderRadius:4}}>DEEP AI</span>}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {corners10!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>Corners</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:getColor(corners10)}}>{corners10}/10</span>
                </div>)}
                {edges10!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>Edges</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:getColor(edges10)}}>{edges10}/10</span>
                </div>)}
                {surface10!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>Surface</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:getColor(surface10)}}>{surface10}/10</span>
                </div>)}
                {centering10!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>Centering</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:getColor(centering10)}}>{centering10}/10</span>
                </div>)}
                {overall10!=null&&(<div style={{display:"flex",justifyContent:"space-between",padding:"6px 10px",background:"#0a0b0e",borderRadius:6}}>
                  <span style={{fontFamily:mono,fontSize:11,color:"#666"}}>Overall</span>
                  <span style={{fontFamily:mono,fontSize:11,fontWeight:600,color:getColor(overall10)}}>{overall10}/10</span>
                </div>)}
              </div>
            </div>
            );
          })()}

          {/* AI/Deep AI Summary - Positives, Concerns, Recommendation */}
          {(()=>{
            const isDeep = gradeMode === 'deep';
            const summary = isDeep ? deepAiSummary : aiSummary;
            const notes = isDeep ? deepAiSummary : aiGradingNotes;
            const hasContent = notes?.positives?.length > 0 || notes?.concerns?.length > 0 || summary?.recommendation;
            if (!hasContent) return null;
            const accentColor = isDeep ? '#f97316' : '#8b5cf6';
            const borderColor = isDeep ? 'rgba(249,115,22,0.3)' : 'rgba(139,92,246,0.3)';
            return (
            <div style={{padding:14,background:"linear-gradient(135deg, #0d0f13 0%, #12141a 100%)",borderRadius:10,border:`1px solid ${borderColor}`,marginBottom:12}}>
              <div style={{fontFamily:mono,fontSize:10,color:accentColor,textTransform:"uppercase",marginBottom:10}}>{isDeep ? 'Deep AI' : 'AI'} Analysis Summary</div>
              {notes?.positives?.length > 0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontFamily:mono,fontSize:11,color:"#00ff88",marginBottom:6}}>✓ POSITIVES</div>
                  {notes.positives.map((p,i)=>(<div key={i} style={{fontFamily:sans,fontSize:12,color:"#aaa",paddingLeft:12,marginBottom:3}}>• {p}</div>))}
                </div>
              )}
              {notes?.concerns?.length > 0 && (
                <div style={{marginBottom:10}}>
                  <div style={{fontFamily:mono,fontSize:11,color:"#ff9944",marginBottom:6}}>⚠ CONCERNS</div>
                  {notes.concerns.map((c,i)=>(<div key={i} style={{fontFamily:sans,fontSize:12,color:"#999",paddingLeft:12,marginBottom:3}}>• {c}</div>))}
                </div>
              )}
              {summary?.recommendation && (
                <div style={{padding:"10px 12px",background:isDeep?"rgba(249,115,22,0.05)":"rgba(0,255,136,0.05)",borderRadius:8,border:isDeep?"1px solid rgba(249,115,22,0.2)":"1px solid rgba(0,255,136,0.2)"}}>
                  <div style={{fontFamily:mono,fontSize:11,color:isDeep?"#f97316":"#00ff88",marginBottom:6}}>💡 RECOMMENDATION</div>
                  <div style={{fontFamily:sans,fontSize:12,color:"#aaa",lineHeight:1.5}}>{summary.recommendation}</div>
                </div>
              )}
            </div>
            );
          })()}

    </div>)}

    {/* CENTERING TAB */}
    {tab==="centering"&&step===2&&gr&&fR&&bR&&(<div style={{flex:1,padding:16,overflowY:"auto"}}>
          {/* Manual Adjust toggle buttons */}
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            {[["front","Front"],["back","Back"]].map(([s,sl])=>(
              <button key={s} onClick={()=>setManualMode(s)}
                style={{flex:1,padding:"9px 0",borderRadius:7,
                  border:`1px solid ${manualMode===s?"#ff9944":"#333"}`,
                  background:manualMode===s?"rgba(255,153,68,.1)":"transparent",
                  color:manualMode===s?"#ff9944":"#666",
                  fontFamily:mono,fontSize:10,cursor:"pointer",textTransform:"uppercase",letterSpacing:".06em"}}>
                ✦ Adjust Borders {sl}
              </button>
            ))}
          </div>

          {/* Manual editors: the capture-time centering tool, reopened with the saved points */}
          {manualMode==="front"&&fI&&(
            <PostCaptureCentering image={fI} side="front"
              initial={frontCenteringData} initialCroppedImage={frontCroppedImage} initialMaps={fM}
              onConfirm={(result)=>handleTabCenteringConfirm("front",result)}
              onSkip={()=>setManualMode(null)} onCancel={()=>setManualMode(null)}/>
          )}
          {manualMode==="back"&&bI&&(
            <PostCaptureCentering image={bI} side="back"
              initial={backCenteringData} initialCroppedImage={backCroppedImage} initialMaps={bM}
              onConfirm={(result)=>handleTabCenteringConfirm("back",result)}
              onSkip={()=>setManualMode(null)} onCancel={()=>setManualMode(null)}/>
          )}

          {/* Confirm Alignment Button */}
          {!centeringConfirmed && (
            <button
              onClick={()=>setCenteringConfirmed(true)}
              style={{
                width:"100%",
                padding:"14px 0",
                marginBottom:16,
                borderRadius:8,
                border:"1px solid #00ff8844",
                background:"linear-gradient(135deg,rgba(0,255,136,0.1),rgba(0,255,136,0.05))",
                color:"#00ff88",
                fontFamily:mono,
                fontSize:12,
                fontWeight:600,
                cursor:"pointer",
                textTransform:"uppercase",
                letterSpacing:".05em",
              }}
            >
              ✓ Confirm Alignment & Calculate
            </button>
          )}

          {/* Centering Results - Only show after confirmation */}
          {centeringConfirmed ? (
            <>
              {[["Front",fR,"front"],["Back",bR,"back"]].map(([s,r,side])=>{
                const maxOff=Math.max(Math.max(r.centering.lrRatio,100-r.centering.lrRatio),Math.max(r.centering.tbRatio,100-r.centering.tbRatio));
                const hasDing=r.centerDings.length>0;
                const companyThresh = GRADING_COMPANIES[gradingCompany]?.centeringThresholds?.[side]?.[10];
                const threshVal = typeof companyThresh === 'object' ? (companyThresh.gem || companyThresh.pristine) : companyThresh;
                const threshDisplay = threshVal ? `${threshVal}/${100-threshVal}` : (side==="front"?"55/45":"65/35");
                return(<div key={s} style={{marginBottom:16,padding:14,background:"#0d0f13",borderRadius:10,border:`1px solid ${hasDing?"#ff663344":"#00ff8822"}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                    <span style={{fontFamily:mono,fontSize:11,color:"#00ff88",textTransform:"uppercase"}}>✓ {s} Centering</span>
                    {hasDing&&<span style={{fontFamily:mono,fontSize:10,color:"#ff6633",fontWeight:600}}>⚠ DING</span>}
                  </div>
                  <div style={{display:"flex",gap:16}}>
                    <div style={{flex:1}}><div style={{fontFamily:mono,fontSize:11,color:"#555",marginBottom:4}}>L / R</div><div style={{fontFamily:mono,fontSize:20,fontWeight:700,color:"#ccc"}}>{r.centering.lrRatio}/{Math.round((100-r.centering.lrRatio)*10)/10}</div></div>
                    <div style={{width:1,background:"#1a1c22"}}/>
                    <div style={{flex:1}}><div style={{fontFamily:mono,fontSize:11,color:"#555",marginBottom:4}}>T / B</div><div style={{fontFamily:mono,fontSize:20,fontWeight:700,color:"#ccc"}}>{r.centering.tbRatio}/{Math.round((100-r.centering.tbRatio)*10)/10}</div></div>
                  </div>
                  <div style={{marginTop:8,fontFamily:mono,fontSize:11,color:"#555"}}>
                    Worst axis: {maxOff.toFixed(1)}/{(100-maxOff).toFixed(1)} · {GRADING_COMPANIES[gradingCompany]?.name || 'TAG'} 10 threshold: {threshDisplay}
                  </div>
                </div>);
              })}

              {/* Reset Alignment */}
              <button
                onClick={()=>setCenteringConfirmed(false)}
                style={{
                  width:"100%",
                  padding:"10px 0",
                  marginBottom:14,
                  borderRadius:6,
                  border:"1px solid #333",
                  background:"transparent",
                  color:"#666",
                  fontFamily:mono,
                  fontSize:10,
                  cursor:"pointer",
                }}
              >
                ↺ Re-adjust Alignment
              </button>
            </>
          ) : (
            <div style={{padding:20,background:"rgba(255,153,68,0.05)",borderRadius:10,border:"1px solid rgba(255,153,68,0.2)",textAlign:"center",marginBottom:16}}>
              <div style={{fontFamily:mono,fontSize:11,color:"#ff9944",marginBottom:8}}>⚠ ALIGNMENT REQUIRED</div>
              <div style={{fontFamily:sans,fontSize:12,color:"#888",lineHeight:1.5}}>
                Adjust rotation and borders above, then click &quot;Confirm Alignment&quot; to calculate centering score.
              </div>
            </div>
          )}

          {/* Ignore Centering Option */}
          <div style={{marginBottom:14,padding:12,background:"#0d0f13",borderRadius:8,border:`1px solid ${ignoreCentering?"#ff994444":"#1a1c22"}`}}>
            <label style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}}>
              <input
                type="checkbox"
                checked={ignoreCentering}
                onChange={e=>setIgnoreCentering(e.target.checked)}
                style={{width:16,height:16,accentColor:"#ff9944",cursor:"pointer"}}
              />
              <span style={{fontFamily:mono,fontSize:11,color:ignoreCentering?"#ff9944":"#888",textTransform:"uppercase",letterSpacing:".04em"}}>
                Ignore Centering in Grade
              </span>
            </label>
            {ignoreCentering&&(
              <div style={{marginTop:10,padding:10,background:"rgba(255,153,68,.08)",borderRadius:6,border:"1px solid rgba(255,153,68,.2)"}}>
                <div style={{fontFamily:mono,fontSize:10,color:"#ff9944",fontWeight:600,marginBottom:4}}>⚠ WARNING</div>
                <div style={{fontFamily:sans,fontSize:11,color:"#aa7744",lineHeight:1.4}}>
                  Centering is set to 50/50 (perfect) and will NOT affect the grade.
                </div>
              </div>
            )}
          </div>
    </div>)}

    {/* HOME TAB */}
    {tab==="home"&&(
      <HomeTab
        auth={auth}
        onOpenCollection={()=>setTab("cards")}
        onStartScan={()=>setTab("scan")}
        collectionStats={collectionStats}
      />
    )}

    {/* COLLECTION TAB */}
    {tab==="cards"&&auth.isAuthenticated&&(
      <div style={{flex:1,overflowY:"auto"}}>
        <CollectionView
          userId={auth.user?.id}
          onClose={()=>setTab("scan")}
          isInline={true}
          onCollectionChange={refreshCollectionStats}
        />
      </div>
    )}
    {tab==="cards"&&!auth.isAuthenticated&&(
      <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:32}}>
        <div style={{fontSize:48,marginBottom:16}}>🔒</div>
        <div style={{fontFamily:mono,fontSize:14,color:"#888",marginBottom:8}}>Sign in to view your collection</div>
        <button onClick={()=>setShowAuthModal(true)} style={{marginTop:16,padding:"12px 24px",borderRadius:8,border:"none",background:"linear-gradient(135deg,#6366f1,#8b5cf6)",color:"#fff",fontFamily:mono,fontSize:12,fontWeight:600,cursor:"pointer"}}>Sign In</button>
      </div>
    )}

    <div style={{padding:"10px 16px",borderTop:"1px solid #1a1c22",textAlign:"center"}}><div style={{fontFamily:mono,fontSize:11,color:"#666",textTransform:"uppercase",letterSpacing:".12em",paddingBottom:"env(safe-area-inset-bottom)"}}>Pre-grade estimate · Not affiliated with any grading company</div></div>
  </div>);
}
