-- Migration 005 — seed the rates table (PLAN.md Part 4, CLAUDE.md rule 1).
--
-- GENERATED FILE — do not edit by hand.
-- Source of truth: config/rates/rps-2022.json
-- Regenerate:      pnpm rates:generate
--
-- ############################################################################
-- #  EVERY UNVERIFIED VALUE IN THIS FILE IS UNCONFIRMED.                     #
-- #                                                                          #
-- #  A row is confirmed only when source_go.verified is true in the JSON,    #
-- #  meaning a person opened that Government Order and checked the figure    #
-- #  and its effective date. Everything else came from public summaries.     #
-- #                                                                          #
-- #  payload->'_unverified' is true on every unconfirmed row. The            #
-- #  calculators read it and show a warning, so an unchecked rate cannot     #
-- #  quietly present itself as authoritative. Run pnpm rates:worksheet to    #
-- #  see what is left.                                                       #
-- ############################################################################
--
-- source_go stays null: it references documents(id), and the GOs may not be
-- ingested yet. The GO number travels in payload->'_source_go' so the admin can
-- link the row once the document exists.

-- Idempotent: re-running replaces the seed rather than duplicating it. Rows an
-- admin has since verified in the database are preserved.
delete from rates where payload ->> '_unverified' = 'true';


-- DA
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2018-07-01'::date, '2018-12-31'::date, '{"percent":0,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":"Base; merged into RPS-2022 fitment"}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2019-01-01'::date, '2019-06-30'::date, '{"percent":2.73,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2019-07-01'::date, '2019-12-31'::date, '{"percent":7.28,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2020-01-01'::date, '2020-06-30'::date, '{"percent":10.92,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2020-07-01'::date, '2020-12-31'::date, '{"percent":13.65,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2021-01-01'::date, '2021-06-30'::date, '{"percent":17.29,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2021-07-01'::date, '2021-12-31'::date, '{"percent":20.02,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2022-01-01'::date, '2022-06-30'::date, '{"percent":22.75,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.66","go_date":"2023-05-01","verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2022-07-01'::date, '2022-12-31'::date, '{"percent":26.39,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.113","go_date":null,"verified":false,"note":"GO number from research; date unconfirmed"}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2023-01-01'::date, '2023-06-30'::date, '{"percent":30.03,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.28","go_date":null,"verified":false,"note":"CANDIDATE from web search, not confirmed — two searches place No.28 at 26.39%→30.03% w.e.f. 01-01-2023, an earlier one placed it at 22.75%→26.39% w.e.f. 01-07-2022. Confirm against the PDF before trusting either."}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2023-07-01'::date, '2023-12-31'::date, '{"percent":33.67,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.30","go_date":null,"verified":false,"note":null}}'::jsonb, null);
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('DA', '2024-01-01'::date, null, '{"percent":37.31,"applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.60","go_date":"2025-10-20","verified":false,"note":"Modified by G.O.Ms.No.62"}}'::jsonb, null);

-- HRA
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('HRA', '2022-01-01'::date, null, '{"slabs":[{"percent":24,"band":"Population above 50 lakh","examples":["Hyderabad","New Delhi"]},{"percent":16,"band":"Population 5-50 lakh","examples":["Visakhapatnam (GVMC)","Vijayawada","Guntur","Nellore","Velagapudi Secretariat"]},{"percent":12,"band":"Population 50,000-5 lakh","examples":[]},{"percent":10,"band":"Population below 50,000","examples":[]}],"census":"2011","applies_to":"basic_pay","_unverified":true,"_source_go":{"go_number":"G.O.27","go_date":null,"verified":false,"note":"Revised the original 8/16/24% slabs in G.O.Ms.No.1; date and exact population bands UNCONFIRMED"}}'::jsonb, null);

-- MASTER_SCALE
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('MASTER_SCALE', '2022-07-01'::date, null, '{"segments":"20000-600-21800-660-23780-720-25940-780-28280-850-30830-920-33590-990-36560-1080-39800-1170-43310-1260-47090-1350-51140-1460-55520-1580-60260-1700-65360-1830-70850-1960-76730-2090-83000-2240-89720-2390-96890-2540-104510-2700-112610-2890-121280-3100-130580-3320-140540-3610-154980-3900-170580-4210-179000","stages":[20000,20600,21200,21800,22460,23120,23780,24500,25220,25940,26720,27500,28280,29130,29980,30830,31750,32670,33590,34580,35570,36560,37640,38720,39800,40970,42140,43310,44570,45830,47090,48440,49790,51140,52600,54060,55520,57100,58680,60260,61960,63660,65360,67190,69020,70850,72810,74770,76730,78820,80910,83000,85240,87480,89720,92110,94500,96890,99430,101970,104510,107210,109910,112610,115500,118390,121280,124380,127480,130580,133900,137220,140540,144150,147760,151370,154980,158880,162780,166680,170580,174790,179000],"stage_count":83,"grades":32,"minimum":20000,"maximum":179000,"ir_counts_as_pay_for_fixation":false,"_unverified":true,"_source_go":{"go_number":"G.O.Ms.No.1","go_date":"2022-01-17","verified":false,"note":"AP Revised Scales of Pay Rules 2022; 23% fitment, 30.392% DA merged"}}'::jsonb, null);

-- NPS
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('NPS', '2004-09-01'::date, null, '{"employee_percent":10,"government_percent":14,"base":"basic_pay_plus_da","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":"Contribution rates widely reported; sanctioning GO NOT identified — verify before the CPS projector ships"}}'::jsonb, null);

-- IT_SLAB
insert into rates (kind, effective_from, effective_to, payload, source_go) values
  ('IT_SLAB', '2025-04-01'::date, '2026-03-31'::date, '{"regime":"new","fy":"2025-26","slabs":[{"upto":400000,"percent":0},{"upto":800000,"percent":5},{"upto":1200000,"percent":10},{"upto":1600000,"percent":15},{"upto":2000000,"percent":20},{"upto":2400000,"percent":25},{"upto":null,"percent":30}],"standard_deduction":75000,"rebate_87a_upto":1200000,"cess_percent":4,"surcharge":"as per Finance Act","_unverified":true,"_source_go":{"go_number":null,"go_date":null,"verified":false,"note":"Union Budget 2025 new regime — central, not an AP GO. Verify against the Finance Act."}}'::jsonb, null);
