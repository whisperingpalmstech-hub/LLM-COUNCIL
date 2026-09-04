alter table sessions add column conversation_id text;
alter table sessions add column budget_limit_usd real;
alter table sessions add column estimated_cost_usd real default 0;
alter table sessions add column spent_cost_usd real default 0;
alter table sessions add column budget_approval_required integer default 0;

create table if not exists conversations (
  id text primary key,
  title text not null,
  tone text,
  use_memory integer default 1,
  desired_outcome text,
  persona_brief text,
  created_at text not null,
  updated_at text not null
);

create table if not exists cost_events (
  id text primary key,
  session_id text not null,
  call_type text not null,
  estimated_cost_usd real not null,
  metadata text default '{}',
  created_at text not null,
  foreign key(session_id) references sessions(id) on delete cascade
);

create index if not exists idx_sessions_conversation_id on sessions(conversation_id);
create index if not exists idx_cost_events_session_id on cost_events(session_id);

insert or ignore into system_settings (key, value) values ('COST_SAFETY_MULTIPLIER', '1.5');
insert or ignore into system_settings (key, value) values ('DEFAULT_CONVERSATION_BUDGET_USD', '1.00');
