-- Proof that a Site Sketch Pack cannot state a measurement.
--
-- This is the rule the whole product rests on. A phone video carries no scale,
-- so any dimension taken from one is invented, and producing measured drawings
-- for reward is regulated work in Jamaica. The pack is allowed to say "a full
-- height crack". It is never allowed to say "a 2.1m crack".
--
-- Three layers enforce it: the prompt forbids it, the scrubber in
-- supabase/functions/_shared/measurements.ts removes whatever the model says
-- anyway, and has_measurement() here refuses the approval. This file tests the
-- third. measurements_test.ts proves the second, and proves the pattern in the
-- migration is character for character the one in the shared module.
--
-- Note on test 3: the session running this has no admin JWT, so the admin
-- check in the trigger fires before the measurement check. The measurement
-- rule itself is proved directly by tests 2, 4, 5 and 6, which call
-- sketch_offending_text() rather than going through the trigger.
do $$
declare v text;
begin
  create temp table t(n int generated always as identity, name text, result text) on commit drop;
  delete from public.sketch_packs where id like 'TEST-%';

  insert into public.sketch_packs (id, property_label, rooms, frames, sketch_svg)
  values ('TEST-SKP-1','The Portmore house',
    '[{"key":"living","name":"Living room","observations":[{"note":"Two hairline cracks above the window","category":"cosmetic","severity":"low"}]},
      {"key":"kitchen","name":"Kitchen","observations":[{"note":"Sealant missing behind the sink","category":"maintenance","severity":"medium"}]}]'::jsonb,
    '[{"n":1,"caption":"Wide shot of the living room, curtains open"}]'::jsonb,
    '<svg>Nothing here is to scale</svg>');

  select public.sketch_offending_text(rooms, frames, sketch_svg) into v from public.sketch_packs where id='TEST-SKP-1';
  insert into t(name,result) values ('1. a clean pack is clean', case when v is null then 'PASS' else 'FAIL: '||v end);

  update public.sketch_packs set rooms = jsonb_set(rooms,'{0,observations,0,note}','"Crack runs about 40 cm down the column"') where id='TEST-SKP-1';
  select public.sketch_offending_text(rooms, frames, sketch_svg) into v from public.sketch_packs where id='TEST-SKP-1';
  insert into t(name,result) values ('2. measurement in an observation', case when v is not null then 'PASS: '||left(v,42) else 'FAIL, missed it' end);

  begin
    update public.sketch_packs set status='approved' where id='TEST-SKP-1';
    insert into t(name,result) values ('3. approval refused','FAIL, approved');
  exception when others then
    insert into t(name,result) values ('3. approval refused','PASS: '||left(SQLERRM,48));
  end;

  update public.sketch_packs set rooms = jsonb_set(rooms,'{0,observations,0,note}','"Two hairline cracks above the window"'),
                                 frames = '[{"n":1,"caption":"Ceiling height 8 ft"}]'::jsonb where id='TEST-SKP-1';
  select public.sketch_offending_text(rooms, frames, sketch_svg) into v from public.sketch_packs where id='TEST-SKP-1';
  insert into t(name,result) values ('4. measurement in a photo caption', case when v is not null then 'PASS: '||left(v,42) else 'FAIL, missed it' end);

  update public.sketch_packs set frames='[{"n":1,"caption":"Wide shot"}]'::jsonb, sketch_svg='<svg><text>3.5m</text></svg>' where id='TEST-SKP-1';
  select public.sketch_offending_text(rooms, frames, sketch_svg) into v from public.sketch_packs where id='TEST-SKP-1';
  insert into t(name,result) values ('5. measurement in the drawing', case when v is not null then 'PASS: '||left(v,42) else 'FAIL, missed it' end);

  update public.sketch_packs set sketch_svg='<svg/>', rooms = jsonb_set(rooms,'{0,name}','"The 12 ft room"') where id='TEST-SKP-1';
  select public.sketch_offending_text(rooms, frames, sketch_svg) into v from public.sketch_packs where id='TEST-SKP-1';
  insert into t(name,result) values ('6. measurement in a room name', case when v is not null then 'PASS: '||left(v,42) else 'FAIL, missed it' end);

  -- Added 5 September 2026. The label is the title of the client's document
  -- and the scan never read it.
  update public.sketch_packs set rooms = jsonb_set(rooms,'{0,name}','"Living room"'), property_label='The 40 ft house at Braeton' where id='TEST-SKP-1';
  select public.sketch_offending_text(rooms, frames, sketch_svg, property_label) into v from public.sketch_packs where id='TEST-SKP-1';
  insert into t(name,result) values ('6a. measurement in the property label', case when v is not null then 'PASS: '||left(v,42) else 'FAIL, missed it' end);
  update public.sketch_packs set property_label='The Portmore house' where id='TEST-SKP-1';

  insert into public.sketch_packs (id, property_label) values ('TEST-SKP-2','Empty');
  begin
    update public.sketch_packs set status='approved' where id='TEST-SKP-2';
    insert into t(name,result) values ('7. empty pack cannot be approved','FAIL, approved');
  exception when others then
    insert into t(name,result) values ('7. empty pack cannot be approved','PASS, refused');
  end;

  begin
    update public.sketch_packs set status='issued' where id='TEST-SKP-2';
    insert into t(name,result) values ('8. cannot issue an unapproved pack','FAIL, issued');
  exception when others then
    insert into t(name,result) values ('8. cannot issue an unapproved pack','PASS: '||left(SQLERRM,42));
  end;

  update public.sketch_packs set rooms='[{"key":"a","name":"Hallway","observations":[]}]'::jsonb where id='TEST-SKP-2';
  insert into t(name,result) values ('9. a draft stays editable','PASS');

  create table if not exists public._sk_out(n int, name text, result text);
  delete from public._sk_out; insert into public._sk_out select n,name,result from t;
  delete from public.sketch_packs where id like 'TEST-%';
end $$;
select name, result from public._sk_out order by n;
drop table public._sk_out;

-- The wording test. The full case list, and the one that is run on every push,
-- lives in supabase/functions/_shared/measurements_test.ts against the same
-- pattern; this is the same list pointed at the live function. "1 in 5 tiles"
-- is the one that breaks a naive pattern, which is why bare "in" is not a unit.
--
-- The second block was added 5 September 2026, the day this was tested by
-- hand and "a 2-metre crack" walked straight through every layer. If a
-- sentence is added here it goes in measurements_test.ts as well.
with cases(txt, should_flag) as (values
  ('Rear wall approximately 3.5m long', true), ('Crack runs about 40 cm down the column', true),
  ('Ceiling height 8 ft', true), ('Room is roughly 12 feet by 10 feet', true),
  ('Gap of 2 inches under the door', true), ('Floor area around 200 sq ft', true),
  ('Roughly 18 m2 of tiling', true), ('Opening measures 6''', true),
  ('Skirting damaged for 1.2 metres', true),
  -- the hyphen, the number word, the missing units, the feet and inches mark
  ('Ceiling is 9-foot high', true), ('A 2-metre crack down the column', true),
  ('A 10-ft run of skirting', true), ('The room is twelve feet by ten feet', true),
  ('Crack about half a metre long', true), ('Two and a half metres of coping is loose', true),
  ('Plot is about 0.25 acres', true), ('About 30 yds of fencing', true),
  ('Around 20 sq yards of paving', true), ('Floor is 120 ft2 of tiling', true),
  ('Rear boundary runs 0.2 km', true), ('Doorway 6''6" clear', true),
  ('Two hairline cracks above the window', false), ('1 in 5 tiles is cracked', false),
  ('Three sockets, one with a damaged faceplate', false),
  ('Water staining on the ceiling, worse in the corner', false),
  ('Rust visible on the zinc, front slope', false), ('Second bedroom, north side', false),
  ('Paint flaking around 4 windows', false), ('Bathroom on the 1st floor', false),
  ('Sealant missing on the right column', false),
  -- the words that look like units and are not
  ('Meter box on the outside wall is damaged', false),
  ('Two meters on the outside wall, one cracked', false),
  ('Damp at the foot of the wall', false), ('1970s block construction', false)
)
select txt, should_flag, public.has_measurement(txt) as flagged,
       case when public.has_measurement(txt) = should_flag then 'PASS' else 'FAIL' end as verdict
from cases order by should_flag desc, txt;
