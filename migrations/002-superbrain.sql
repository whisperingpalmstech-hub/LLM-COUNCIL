create table if not exists pipelines (
  id text primary key,
  name text not null,
  stages_json text not null,
  created_at text not null
);

create table if not exists interviews (
  id text primary key,
  session_id text not null,
  turn_number integer default 1,
  user_message text,
  llm_response text,
  is_satisfied integer default 0,
  refined_topic text,
  created_at text not null,
  foreign key(session_id) references sessions(id) on delete cascade
);

alter table sessions add column pipeline_id text;
alter table sessions add column stage_index integer default 0;
alter table sessions add column execution_payload text;
alter table sessions add column handoff_status text;
