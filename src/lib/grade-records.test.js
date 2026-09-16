/** Run: node src/lib/grade-records.test.js */
import { aiRecordFromResult, scanAiColumns, savedAi, savedGradeMode, conditionScores, damageReportInputs } from './grade-records.js';

let passed = 0, failed = 0;
const check = (n, ok, extra = '') => { if (ok) { passed++; console.log(`  ✓ ${n}`); } else { failed++; console.log(`  ✗ ${n} ${extra}`); } };

const aiResult = { subgrades: { frontCorners: 96, backCorners: 90, frontEdges: 100, backEdges: 100, frontSurface: 98, backSurface: 94, frontCentering: 97, backCentering: 92 }, overall: { grade: 9 }, confidence: { value: 0.9 }, defects: { counts: { total: 1 }, items: [{ id: 'd1', side: 'FRONT', type: 'CORNER', severity: 'minor', x: 4, y: 3, width: 5, height: 5 }] }, centering: { front: { lrRatio: 52 } }, grades: { tag: { grade: 9 }, psa: { grade: 8 } }, summary: { positives: ['a'], concerns: [], recommendation: 'r' } };
const deepResult = { ...aiResult, overall: { grade: 8.5 }, defects: { counts: { total: 2 }, items: [aiResult.defects.items[0], { id: 'd2', side: 'BACK', type: 'EDGE', severity: 'minor', x: 50, y: 97 }] }, grades: { tag: { grade: 8.5 } }, summary: { positives: [], concerns: ['edge'], recommendation: 'x' } };

console.log('— records');
const rec = aiRecordFromResult(aiResult);
check('record keeps subgrades/overall/confidence/defects/centering', rec.subgrades.frontCorners === 96 && rec.overall.grade === 9 && rec.defects.items.length === 1 && rec.centering.front.lrRatio === 52 && typeof rec.gradedAt === 'string');
check('null result → null', aiRecordFromResult(null) === null);

console.log('— scan columns');
const cols1 = scanAiColumns({ ai: rec, aiGrades: aiResult.grades, aiSummary: aiResult.summary, aiCentering: aiResult.centering });
check('standard AI at top level, no __deep__', cols1.ai_condition.defects.items.length === 1 && cols1.ai_grades.psa.grade === 8 && cols1.ai_grades.__deep__ === undefined && cols1.ai_summary.positives[0] === 'a');
const row1 = { ai_grades: cols1.ai_grades, ai_condition: cols1.ai_condition, ai_summary: cols1.ai_summary, ai_centering: cols1.ai_centering };
const cols2 = scanAiColumns({ deep: aiRecordFromResult(deepResult), deepGrades: deepResult.grades, deepSummary: deepResult.summary, existing: row1 });
check('deep re-grade keeps the standard AI data and adds __deep__', cols2.ai_grades.psa.grade === 8 && cols2.ai_grades.__deep__.tag.grade === 8.5 && cols2.ai_condition.defects.items.length === 1 && cols2.ai_condition.__deep__.defects.items.length === 2 && cols2.ai_summary.__deep__.concerns[0] === 'edge', JSON.stringify(cols2.ai_grades));
check('centering carried from existing when not supplied', cols2.ai_centering.front.lrRatio === 52);
const row2 = { ...row1, ...cols2 };
const cols3 = scanAiColumns({ ai: aiRecordFromResult({ ...aiResult, overall: { grade: 9.5 } }), aiGrades: { tag: { grade: 9.5 } }, existing: row2 });
check('AI re-grade replaces top level but keeps __deep__', cols3.ai_condition.overall.grade === 9.5 && cols3.ai_condition.__deep__.defects.items.length === 2 && cols3.ai_grades.__deep__.tag.grade === 8.5 && cols3.ai_summary.__deep__.concerns[0] === 'edge');
check('empty input → nulls', JSON.stringify(scanAiColumns({})) === JSON.stringify({ ai_grades: null, ai_condition: null, ai_summary: null, ai_centering: null }));

console.log('— read back');
const back = savedAi(row2);
check('savedAi splits tiers', back.ai.overall.grade === 9 && back.deep.overall.grade === 8.5 && back.aiGrades.psa.grade === 8 && back.deepGrades.tag.grade === 8.5 && back.deepSummary.concerns[0] === 'edge');
check('savedGradeMode: deep > ai > software', savedGradeMode(row2) === 'deep' && savedGradeMode(row1) === 'ai' && savedGradeMode({ dings: [] }) === 'software');
check('legacy row with only __deep__ condition (old collection flow) reads as deep', savedGradeMode({ ai_condition: { __deep__: { defects: [] } } }) === 'deep');

console.log('— condition + damage report');
const cs = conditionScores(aiResult.subgrades);
check('conditionScores averages front/back', cs.corners === 93 && cs.edges === 100 && cs.surface === 96 && cs.centering === 95, JSON.stringify(cs));
check('conditionScores null on garbage', conditionScores(null) === null && conditionScores({}) === null);
const dings = [{ side: 'FRONT', type: 'CORNER WEAR', location: 'FRONT / TOP LEFT', severity: 1 }];
const sw = damageReportInputs({ mode: 'software', dings, subgrades: aiResult.subgrades, frontCentering: { lrRatio: 51, tbRatio: 50 } });
check('software mode plots dings, no tagDefects', sw.tagDefects === null && sw.gradeResult.allDings.length === 1 && sw.gradeResult.defectCounts.total === 1 && sw.frontResult.centering.lrRatio === 51);
const dp = damageReportInputs({ mode: 'deep', dings, ai: back.ai, deep: back.deep });
check('deep mode plots the deep items with counts', dp.tagDefects.length === 2 && dp.gradeResult.defectCounts.total === 2);
const ap = damageReportInputs({ mode: 'ai', dings, ai: back.ai, deep: back.deep, frontResult: { centering: { lrRatio: 55 }, corners: { details: [] } } });
check('ai mode plots the AI items; live frontResult override wins', ap.tagDefects.length === 1 && ap.frontResult.corners !== undefined);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
