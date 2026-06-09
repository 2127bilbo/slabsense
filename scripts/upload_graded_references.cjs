/**
 * Upload Graded References to Supabase
 *
 * Transforms training.json (509 TAG-graded cards) into the graded_references table format
 * and uploads to Supabase for the two-pass grading system.
 *
 * Usage: node scripts/upload_graded_references.cjs
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables manually (handles Windows CRLF)
function loadEnv(filepath) {
  if (!fs.existsSync(filepath)) return;
  const content = fs.readFileSync(filepath, 'utf8');
  content.split(/\r?\n/).forEach(line => {
    line = line.trim();
    if (!line || line.startsWith('#')) return;
    const eqIndex = line.indexOf('=');
    if (eqIndex > 0) {
      const key = line.substring(0, eqIndex).trim();
      const value = line.substring(eqIndex + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  });
}

// Load from project root (try multiple paths)
const projectRoot = path.resolve(__dirname, '..');
const envLocal = path.join(projectRoot, '.env.local');
const envFile = path.join(projectRoot, '.env');

// Also try current working directory
loadEnv('.env.local');
loadEnv('.env');
loadEnv(envLocal);
loadEnv(envFile);

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  console.error('Add these to your .env.local file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Load training data
const trainingPath = path.join(__dirname, 'Tag scraper', 'training.json');
const training = JSON.parse(fs.readFileSync(trainingPath, 'utf8'));

/**
 * Convert grade string to numeric value
 */
function gradeToNumeric(grade) {
  const mapping = {
    '10 PRISTINE': 10.0,
    '10 GEM MINT': 10.0,
    '9.5 MINT+': 9.5,
    '9 MINT': 9.0,
    '8.5 NM MT+': 8.5,
    '8.5 NM-MT+': 8.5,
    '8 NM MT': 8.0,
    '8 NM-MT': 8.0,
    '7.5 NEAR MINT+': 7.5,
    '7.5 NM+': 7.5,
    '7 NEAR MINT': 7.0,
    '7 NM': 7.0,
    '6.5 EX MT+': 6.5,
    '6 EX MT': 6.0,
    '5.5 EXCELLENT+': 5.5,
    '5 EXCELLENT': 5.0,
    '4.5 VG EX+': 4.5,
    '4 VG EX': 4.0,
    '3.5 VG+': 3.5,
    '3 VG': 3.0,
    '2.5 GOOD+': 2.5,
    '2 GOOD': 2.0,
    '1.5 FAIR': 1.5,
    '1 POOR': 1.0,
  };

  // Try exact match first
  if (mapping[grade]) return mapping[grade];

  // Try to extract numeric from grade string
  const match = grade.match(/^(\d+\.?\d*)/);
  if (match) return parseFloat(match[1]);

  console.warn(`Unknown grade: ${grade}, defaulting to 5.0`);
  return 5.0;
}

/**
 * Calculate centering deviation percentage from raw pixel measurements
 */
function calcDeviation(a, b) {
  if (!a || !b || (a + b) === 0) return null;
  return Math.abs(a - b) / (a + b) * 100;
}

/**
 * Determine card type based on set year
 */
function getCardType(setYear) {
  if (!setYear) return 'modern_holo';
  if (setYear <= 2002) return 'vintage_holo';
  return 'modern_holo';
}

/**
 * Transform a card from training.json format to Supabase format
 */
function transformCard(card, grade) {
  const centering = card.centering || {};
  const front = centering.front || {};
  const back = centering.back || {};
  const defects = card.defects || {};
  const images = card.images || {};

  // Calculate centering deviations
  const centeringFrontLR = calcDeviation(front.left, front.right);
  const centeringFrontTB = calcDeviation(front.top, front.bottom);
  const centeringBackLR = calcDeviation(back.left, back.right);
  const centeringBackTB = calcDeviation(back.top, back.bottom);

  // Sum defects
  const cornerDefects = (defects.corners?.front || 0) + (defects.corners?.back || 0);
  const edgeDefects = (defects.edges?.front || 0) + (defects.edges?.back || 0);
  const surfaceDefects = (defects.surface?.front || 0) + (defects.surface?.back || 0);

  // Build defect details (filter out CENTERING type)
  const defectDetails = (defects.dings || [])
    .filter(d => d.type !== 'CENTERING')
    .map(d => ({
      side: d.side,
      type: d.type,
      location: d.location,
    }));

  return {
    cert: card.cert,
    card_name: card.card_name,
    card_number: card.card_number,
    set_name: card.set_name,
    set_year: card.set_year || null,
    grade: grade,
    grade_numeric: gradeToNumeric(grade),
    score: card.score_total || null,
    centering_front_lr: centeringFrontLR ? parseFloat(centeringFrontLR.toFixed(2)) : null,
    centering_front_tb: centeringFrontTB ? parseFloat(centeringFrontTB.toFixed(2)) : null,
    centering_back_lr: centeringBackLR ? parseFloat(centeringBackLR.toFixed(2)) : null,
    centering_back_tb: centeringBackTB ? parseFloat(centeringBackTB.toFixed(2)) : null,
    defect_count: defects.total_dings || 0,
    corner_defects: cornerDefects,
    edge_defects: edgeDefects,
    surface_defects: surfaceDefects,
    defect_details: defectDetails.length > 0 ? defectDetails : null,
    card_type: getCardType(card.set_year),
    img_front: images.front || null,
    img_back: images.back || null,
    img_surface_front: images.surface_front || null,
    img_surface_back: images.surface_back || null,
  };
}

async function main() {
  console.log('='.repeat(60));
  console.log('  Upload Graded References to Supabase');
  console.log('='.repeat(60));
  console.log('');

  // Collect all cards from training data (deduplicate by cert)
  const cardMap = new Map();

  for (const [grade, cards] of Object.entries(training.cards_by_grade)) {
    for (const card of cards) {
      if (!cardMap.has(card.cert)) {
        cardMap.set(card.cert, transformCard(card, grade));
      }
    }
  }

  const allCards = Array.from(cardMap.values());

  console.log(`Total cards to upload: ${allCards.length}`);
  console.log('');

  // Show grade distribution
  const gradeCount = {};
  allCards.forEach(c => {
    gradeCount[c.grade] = (gradeCount[c.grade] || 0) + 1;
  });
  console.log('Grade distribution:');
  Object.entries(gradeCount)
    .sort((a, b) => gradeToNumeric(b[0]) - gradeToNumeric(a[0]))
    .forEach(([grade, count]) => {
      console.log(`  ${grade.padEnd(20)} ${count} cards`);
    });
  console.log('');

  // Show card type distribution
  const typeCount = {};
  allCards.forEach(c => {
    typeCount[c.card_type] = (typeCount[c.card_type] || 0) + 1;
  });
  console.log('Card type distribution:');
  Object.entries(typeCount).forEach(([type, count]) => {
    console.log(`  ${type.padEnd(20)} ${count} cards`);
  });
  console.log('');

  // Check for existing data
  const { count: existingCount } = await supabase
    .from('graded_references')
    .select('*', { count: 'exact', head: true });

  if (existingCount > 0) {
    console.log(`Warning: Table already has ${existingCount} records.`);
    console.log('   Deleting existing records before upload...');

    const { error: deleteError } = await supabase
      .from('graded_references')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all

    if (deleteError) {
      console.error('Delete error:', deleteError);
      process.exit(1);
    }
    console.log('   Deleted existing records.');
    console.log('');
  }

  // Upload in batches of 25 using upsert to handle any duplicates
  const batchSize = 25;
  let uploaded = 0;
  let errors = 0;

  console.log('Uploading (using upsert)...');

  for (let i = 0; i < allCards.length; i += batchSize) {
    const batch = allCards.slice(i, i + batchSize);

    const { data, error } = await supabase
      .from('graded_references')
      .upsert(batch, { onConflict: 'cert' })
      .select('cert');

    if (error) {
      console.error(`\nBatch ${i}-${i + batch.length} error:`, error.message);
      errors += batch.length;
    } else {
      uploaded += data.length;
      process.stdout.write(`\r  Progress: ${uploaded}/${allCards.length} (${Math.round(uploaded/allCards.length*100)}%)`);
    }
  }

  console.log('\n');
  console.log('='.repeat(60));
  console.log(`  Upload Complete`);
  console.log(`  Uploaded: ${uploaded}`);
  if (errors > 0) console.log(`  Errors: ${errors}`);
  console.log('='.repeat(60));

  // Verify
  const { count: finalCount } = await supabase
    .from('graded_references')
    .select('*', { count: 'exact', head: true });

  console.log(`\nVerification: ${finalCount} records in table`);
}

main().catch(console.error);
