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

async function check() {
  const { count } = await supabase.from('graded_references').select('*', { count: 'exact', head: true });
  console.log('Total records:', count);

  // Grade distribution
  const { data } = await supabase.from('graded_references').select('grade, card_type');
  const grades = {};
  const types = {};
  data.forEach(r => {
    grades[r.grade] = (grades[r.grade] || 0) + 1;
    types[r.card_type] = (types[r.card_type] || 0) + 1;
  });

  console.log('\nGrade distribution:');
  Object.entries(grades)
    .sort((a, b) => {
      const numA = parseFloat(a[0].match(/[\d.]+/)?.[0] || 0);
      const numB = parseFloat(b[0].match(/[\d.]+/)?.[0] || 0);
      return numB - numA;
    })
    .forEach(([g, c]) => console.log(' ', g.padEnd(20), c));

  console.log('\nCard type distribution:');
  Object.entries(types).forEach(([t, c]) => console.log(' ', t.padEnd(20), c));
}

check().catch(console.error);
