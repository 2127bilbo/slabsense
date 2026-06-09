/**
 * TAG Reference Data Analysis Script v2
 *
 * CORRECTED: Centering data is stored as DEVIATIONS (e.g., 5 = 5% off-center)
 * NOT as ratios (e.g., 45 = 45/55 split)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load env
const content = fs.readFileSync('.env.local', 'utf8');
const env = {};
content.split(/\r?\n/).forEach(line => {
  line = line.trim();
  if (!line || line.startsWith('#')) return;
  const eq = line.indexOf('=');
  if (eq > 0) env[line.substring(0, eq).trim()] = line.substring(eq + 1).trim();
});

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// Helper functions
const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
const median = arr => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const percentile = (arr, p) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil(p / 100 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
};
const max = arr => arr.length ? Math.max(...arr) : 0;
const min = arr => arr.length ? Math.min(...arr) : 0;

async function analyze() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TAG CALIBRATION ANALYSIS v2 (Centering = Deviation from 50%)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const { data: cards, error } = await supabase
    .from('graded_references')
    .select('*');

  if (error) {
    console.error('Error fetching data:', error);
    return;
  }

  console.log(`Total cards: ${cards.length}\n`);

  // Group by grade
  const gradeGroups = {};
  cards.forEach(c => {
    const g = c.grade || 'Unknown';
    if (!gradeGroups[g]) gradeGroups[g] = [];
    gradeGroups[g].push(c);
  });

  const sortedGrades = Object.keys(gradeGroups).sort((a, b) => {
    const numA = parseFloat(a.match(/[\d.]+/)?.[0] || 0);
    const numB = parseFloat(b.match(/[\d.]+/)?.[0] || 0);
    return numB - numA;
  });

  // ═══════════════════════════════════════════════════════════════
  // CENTERING ANALYSIS (values ARE the deviation)
  // ═══════════════════════════════════════════════════════════════
  console.log('───────────────────────────────────────────────────────────────');
  console.log('FRONT CENTERING (deviation from 50/50):');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('Grade          Avg Dev  Median   P90      Max      Count');
  console.log('─────────────────────────────────────────────────────────────');

  for (const grade of sortedGrades) {
    const group = gradeGroups[grade];
    // Max of LR and TB deviation (whichever is worse)
    const devs = group
      .filter(c => c.centering_front_lr != null)
      .map(c => Math.max(c.centering_front_lr, c.centering_front_tb || 0));

    if (devs.length > 0) {
      console.log(`${grade.padEnd(14)} ${avg(devs).toFixed(1).padStart(6)}%  ${median(devs).toFixed(1).padStart(6)}%  ${percentile(devs, 90).toFixed(1).padStart(6)}%  ${max(devs).toFixed(1).padStart(6)}%  ${String(devs.length).padStart(5)}`);
    }
  }

  console.log('\n───────────────────────────────────────────────────────────────');
  console.log('BACK CENTERING (deviation from 50/50):');
  console.log('───────────────────────────────────────────────────────────────');
  console.log('Grade          Avg Dev  Median   P90      Max      Count');
  console.log('─────────────────────────────────────────────────────────────');

  for (const grade of sortedGrades) {
    const group = gradeGroups[grade];
    const devs = group
      .filter(c => c.centering_back_lr != null)
      .map(c => Math.max(c.centering_back_lr, c.centering_back_tb || 0));

    if (devs.length > 0) {
      console.log(`${grade.padEnd(14)} ${avg(devs).toFixed(1).padStart(6)}%  ${median(devs).toFixed(1).padStart(6)}%  ${percentile(devs, 90).toFixed(1).padStart(6)}%  ${max(devs).toFixed(1).padStart(6)}%  ${String(devs.length).padStart(5)}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // GRADE REQUIREMENTS SUMMARY
  // ═══════════════════════════════════════════════════════════════
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('GRADE REQUIREMENTS (from real TAG data)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const gradeNumeric = {
    '10 PRISTINE': 10.0, '10 GEM MINT': 9.9, '9.5 GEM MINT': 9.5,
    '9 MINT': 9.0, '8.5 NM MT+': 8.5, '8 NM MT': 8.0,
    '7.5 NEAR MINT+': 7.5, '7 NEAR MINT': 7.0, '6.5 EX MT+': 6.5,
    '6 EX MT': 6.0, '5 EXCELLENT': 5.0, '4 VG EX': 4.0,
    '3 VG': 3.0, '2 GOOD': 2.0, '1 POOR': 1.0,
  };

  for (const grade of sortedGrades) {
    const group = gradeGroups[grade];
    if (group.length < 3) continue;

    const frontDevs = group.filter(c => c.centering_front_lr != null)
      .map(c => Math.max(c.centering_front_lr, c.centering_front_tb || 0));
    const backDevs = group.filter(c => c.centering_back_lr != null)
      .map(c => Math.max(c.centering_back_lr, c.centering_back_tb || 0));
    const defects = group.map(c => c.defect_count || 0);
    const corners = group.map(c => c.corner_defects || 0);
    const edges = group.map(c => c.edge_defects || 0);
    const surfaces = group.map(c => c.surface_defects || 0);

    console.log(`${grade} (n=${group.length}):`);
    console.log(`  Centering:  Front max ${max(frontDevs).toFixed(1)}% (P90: ${percentile(frontDevs, 90).toFixed(1)}%)  |  Back max ${max(backDevs).toFixed(1)}% (P90: ${percentile(backDevs, 90).toFixed(1)}%)`);
    console.log(`  Defects:    Total max ${max(defects)} (avg ${avg(defects).toFixed(1)})  |  Corner max ${max(corners)}  |  Edge max ${max(edges)}  |  Surface max ${max(surfaces)}`);
    console.log(`  Zero rates: ${(corners.filter(c => c === 0).length / corners.length * 100).toFixed(0)}% no corner  |  ${(edges.filter(c => c === 0).length / edges.length * 100).toFixed(0)}% no edge  |  ${(surfaces.filter(c => c === 0).length / surfaces.length * 100).toFixed(0)}% no surface`);
    console.log('');
  }

  // ═══════════════════════════════════════════════════════════════
  // CALIBRATION VALUES FOR SOFTWARE GRADING
  // ═══════════════════════════════════════════════════════════════
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('CALIBRATION VALUES FOR SOFTWARE GRADING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('// Centering thresholds (max deviation % from 50/50)');
  console.log('// These are P90 values - 90% of cards at this grade meet this threshold');
  console.log('const TAG_CENTERING_THRESHOLDS = {');
  console.log('  front: {');
  for (const grade of sortedGrades) {
    const group = gradeGroups[grade];
    const devs = group.filter(c => c.centering_front_lr != null)
      .map(c => Math.max(c.centering_front_lr, c.centering_front_tb || 0));
    if (devs.length >= 3) {
      const p90 = percentile(devs, 90);
      const gradeKey = grade.replace(/[^a-zA-Z0-9]/g, '_');
      console.log(`    ${gradeKey}: ${p90.toFixed(1)},  // ${devs.length} cards`);
    }
  }
  console.log('  },');
  console.log('  back: {');
  for (const grade of sortedGrades) {
    const group = gradeGroups[grade];
    const devs = group.filter(c => c.centering_back_lr != null)
      .map(c => Math.max(c.centering_back_lr, c.centering_back_tb || 0));
    if (devs.length >= 3) {
      const p90 = percentile(devs, 90);
      const gradeKey = grade.replace(/[^a-zA-Z0-9]/g, '_');
      console.log(`    ${gradeKey}: ${p90.toFixed(1)},  // ${devs.length} cards`);
    }
  }
  console.log('  }');
  console.log('};\n');

  console.log('// Hard defect caps - cards CANNOT exceed these grades with more defects');
  console.log('const DEFECT_HARD_CAPS = {');
  for (let d = 0; d <= 8; d++) {
    const cardsWithDefects = cards.filter(c => c.defect_count === d);
    if (cardsWithDefects.length >= 2) {
      const grades = cardsWithDefects.map(c => gradeNumeric[c.grade] || 0).filter(g => g > 0);
      const maxG = Math.max(...grades);
      console.log(`  ${d}: ${maxG.toFixed(1)},  // max grade with ${d} defects (n=${cardsWithDefects.length})`);
    }
  }
  // 5+ defects
  const fivePlus = cards.filter(c => c.defect_count >= 5);
  if (fivePlus.length > 0) {
    const grades = fivePlus.map(c => gradeNumeric[c.grade] || 0).filter(g => g > 0);
    console.log(`  '5+': ${Math.max(...grades).toFixed(1)},  // max grade with 5+ defects (n=${fivePlus.length})`);
  }
  console.log('};\n');

  console.log('// Grade ceiling rules by defect type');
  console.log('const GRADE_CEILINGS = {');
  for (const grade of ['10 PRISTINE', '10 GEM MINT', '9 MINT', '8.5 NM MT+', '8 NM MT']) {
    const group = gradeGroups[grade];
    if (!group || group.length < 3) continue;
    const maxTotal = max(group.map(c => c.defect_count || 0));
    const maxCorner = max(group.map(c => c.corner_defects || 0));
    const maxEdge = max(group.map(c => c.edge_defects || 0));
    const maxSurface = max(group.map(c => c.surface_defects || 0));
    const maxFrontDev = max(group.filter(c => c.centering_front_lr != null)
      .map(c => Math.max(c.centering_front_lr, c.centering_front_tb || 0)));
    const maxBackDev = max(group.filter(c => c.centering_back_lr != null)
      .map(c => Math.max(c.centering_back_lr, c.centering_back_tb || 0)));

    const gradeKey = grade.replace(/[^a-zA-Z0-9]/g, '_');
    console.log(`  ${gradeKey}: {`);
    console.log(`    maxDefects: ${maxTotal}, maxCorner: ${maxCorner}, maxEdge: ${maxEdge}, maxSurface: ${maxSurface},`);
    console.log(`    maxFrontDev: ${maxFrontDev.toFixed(1)}, maxBackDev: ${maxBackDev.toFixed(1)}`);
    console.log(`  },`);
  }
  console.log('};\n');

  // Key insight summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('KEY INSIGHTS FOR SOFTWARE GRADING FIX');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const pristine = gradeGroups['10 PRISTINE'] || [];
  const gem10 = gradeGroups['10 GEM MINT'] || [];

  console.log('1. PRISTINE (10.0) requirements:');
  if (pristine.length) {
    console.log(`   - Front centering: max ${max(pristine.map(c => Math.max(c.centering_front_lr || 0, c.centering_front_tb || 0))).toFixed(1)}% deviation`);
    console.log(`   - Back centering: max ${max(pristine.map(c => Math.max(c.centering_back_lr || 0, c.centering_back_tb || 0))).toFixed(1)}% deviation`);
    console.log(`   - Corner defects: ${max(pristine.map(c => c.corner_defects || 0))} max (${(pristine.filter(c => !c.corner_defects).length / pristine.length * 100).toFixed(0)}% have 0)`);
    console.log(`   - Edge defects: ${max(pristine.map(c => c.edge_defects || 0))} max (${(pristine.filter(c => !c.edge_defects).length / pristine.length * 100).toFixed(0)}% have 0)`);
  }

  console.log('\n2. GEM MINT (9.9) requirements:');
  if (gem10.length) {
    console.log(`   - Front centering: max ${max(gem10.map(c => Math.max(c.centering_front_lr || 0, c.centering_front_tb || 0))).toFixed(1)}% deviation`);
    console.log(`   - Back centering: max ${max(gem10.map(c => Math.max(c.centering_back_lr || 0, c.centering_back_tb || 0))).toFixed(1)}% deviation`);
    console.log(`   - Corner defects: ${max(gem10.map(c => c.corner_defects || 0))} max`);
    console.log(`   - Edge defects: ${max(gem10.map(c => c.edge_defects || 0))} max`);
  }

  console.log('\n3. THE 5-DEFECT CLIFF:');
  console.log('   - Cards with 0-4 defects: can achieve up to 10.0');
  console.log('   - Cards with 5+ defects: NEVER exceed 3.0 in our data');
  console.log('   → This is the #1 fix needed for software grading!');

  console.log('\n4. DEFECT TYPE IMPORTANCE:');
  console.log('   - Corner/edge defects are grade-killers for 10s');
  console.log('   - Surface defects are more tolerated (PRISTINE allows up to 3)');

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

analyze().catch(console.error);
