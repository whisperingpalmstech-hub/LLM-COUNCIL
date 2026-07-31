create table if not exists execution_results (
  id text primary key,
  session_id text not null,
  status text not null,
  metrics_json text default '{}',
  logs text,
  created_at text not null,
  foreign key(session_id) references sessions(id) on delete cascade
);
