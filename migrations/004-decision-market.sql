create table if not exists persona_stats (
  role_type text primary key,
  total_predictions integer default 0,
  successful_predictions integer default 0,
  average_confidence real default 0.0,
  accuracy_weight real default 1.0,
  updated_at text not null
);
