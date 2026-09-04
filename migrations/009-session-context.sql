alter table sessions add column desired_outcome text;
alter table sessions add column persona_brief text;

insert or ignore into system_settings (key, value) values ('COMPANION_PERSONA_BRIEF', 'Be candid, empathetic, and practical. Challenge weak logic without being dismissive.');
insert or ignore into system_settings (key, value) values ('COMPANION_DEFAULT_OUTCOME', 'A clear, evidence-aware next step I can act on.');
insert or ignore into system_settings (key, value) values ('SHOW_ACTIVE_CONTEXT', 'true');
