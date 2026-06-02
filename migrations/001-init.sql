create table if not exists sessions (
  id text primary key,
  topic text not null,
  status text not null default 'CREATED',
  mode text default 'standard',
  max_rounds integer default 4 check(max_rounds between 1 and 5),
  current_round integer default 0,
  compact_internal integer default 1,
  council_id text,
  council_snapshot text,
  consensus real,
  verdict text,
  warnings text default '[]',
  created_at text not null,
  updated_at text not null,
  completed_at text
);

create table if not exists roles (
  id text primary key,
  session_id text not null,
  role_type text not null,
  display_name text not null,
  priority integer default 1,
  knowledge_source_type text default 'TRAINING',
  workspace_id text,
  model_name text,
  confidence_weight real default 1,
  veto_capable integer default 0,
  status text default 'PENDING',
  foreign key(session_id) references sessions(id) on delete cascade
);

create table if not exists messages (
  id text primary key,
  session_id text not null,
  role_id text,
  round_number integer not null,
  model_name text,
  compact integer default 1,
  payload text not null,
  content text not null,
  created_at text not null,
  foreign key(session_id) references sessions(id) on delete cascade
);

create table if not exists councils (
  id text primary key,
  name text not null,
  description text,
  role_manifest text not null,
  hierarchy text default '{}',
  model_overrides text default '{}',
  default_config text default '{}',
  is_active integer default 1,
  created_at text not null,
  updated_at text not null
);

create table if not exists models (
  id text primary key,
  provider text not null,
  model_name text not null,
  display_name text,
  supports_web integer default 0,
  supports_rag integer default 1,
  reasoning_score integer default 5,
  cost_per_1k real default 0,
  active integer default 1
);

create table if not exists workspaces (
  id text primary key,
  external_id text unique,
  name text not null,
  description text,
  tags text default '[]',
  health_status text default 'healthy'
);

create table if not exists audit_logs (
  id text primary key,
  session_id text,
  event_type text not null,
  payload text default '{}',
  created_at text not null
);
