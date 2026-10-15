-- 0004_owner_routing.sql
-- Roteamento por owner: leads que entram pela conta Ghost (ex.: "Haven - Raquel")
-- viram owner do responsável configurado + ganham uma tag, pra notificação e
-- segmentação por canal na Main.
alter table provider_installations
  add column if not exists assign_owner_user_id text,   -- GHL userId do owner (ex.: Raquel)
  add column if not exists lead_tag text;                -- tag aplicada no lead (ex.: lead-raquel)
