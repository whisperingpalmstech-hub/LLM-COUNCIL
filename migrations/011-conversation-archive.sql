alter table conversations add column archived_at text;

create index if not exists idx_conversations_archived_at on conversations(archived_at);
