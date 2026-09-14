-- F1: store the engine's per-company software grades so the collection view
-- can show PSA/BGS/CGC/SGC without recomputing from the TAG score.
alter table public.scans
  add column if not exists company_grades jsonb;

comment on column public.scans.company_grades is
  'gradingEngine companyGrades: { tag:{grade,label,displayGrade,score}, psa:{grade,label,subgrades}, bgs, cgc, sgc }';
