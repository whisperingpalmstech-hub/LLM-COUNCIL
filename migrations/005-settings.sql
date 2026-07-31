create table if not exists system_settings (
  key text primary key,
  value text not null
);

insert or ignore into system_settings (key, value) values ('ANYTHINGLLM_BASE_URL', 'http://localhost:3001/api/v1');
insert or ignore into system_settings (key, value) values ('ANYTHINGLLM_API_KEY', '');
insert or ignore into system_settings (key, value) values ('KELLY_CIRCUIT_BREAKER_PERCENT', '5');
insert or ignore into system_settings (key, value) values ('ENTROPY_THRESHOLD', '30');
