create table if not exists prompt_registry (
  id text primary key,
  name text not null,
  description text not null default '',
  prompt_text text not null,
  default_text text not null,
  version integer not null default 1,
  scope text not null default 'council',
  expected_schema text not null default '{}',
  recommended_model text not null default '',
  updated_at text not null
);

create table if not exists execution_plans (
  id text primary key,
  session_id text not null,
  conversation_id text,
  version integer not null default 1,
  parent_plan_id text,
  status text not null default 'CURRENT',
  plan_json text not null,
  executor_handoff_json text not null,
  readiness_json text not null,
  revision_reason text,
  created_at text not null,
  foreign key(session_id) references sessions(id) on delete cascade
);

create unique index if not exists idx_execution_plan_session_version on execution_plans(session_id, version);
create index if not exists idx_execution_plan_conversation on execution_plans(conversation_id, created_at);
