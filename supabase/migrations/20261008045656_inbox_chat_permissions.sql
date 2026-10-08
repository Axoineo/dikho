-- ============================================================================
-- WHATSAPP INBOX: permissions for Clear chat, Delete chat and Block.
--
--   inbox.delete  Clear and delete chats, and delete single messages. Hides
--                 them for the whole team
--                 (D1 migration 0011 keeps the rows; the customer keeps their
--                 own copy on WhatsApp).
--   inbox.block   Block and unblock customers on the business's WhatsApp
--                 number, through Meta's block list.
--
-- Both are more than "reply to customers", so neither comes with inbox.reply.
-- Owners and developers hold them automatically (effective_permissions_for
-- reads this catalogue). Of the built-in templates only Administrator, which
-- holds every business permission, gets them; anyone else needs them granted
-- under User Management.
--
-- ORDER: harmless on its own (nothing asks for these keys until the API that
-- checks them is deployed), so apply it before or with that API deploy. Until
-- it is applied, the API refuses both actions for everyone, Owners included,
-- and the dashboard hides the controls.
--
-- If this is applied with the Supabase MCP `apply_migration` tool, rename this
-- file to the version it records (see supabase/AGENTS.md).
-- ============================================================================

insert into public.permissions (key, module, action, label, description, allowed_scopes, developer_only, min_developer_level, sort_order) values
  ('inbox.delete', 'WhatsApp Inbox', 'delete',  'Clear and delete chats and messages',
   'Hides chats or single messages for the whole team. The customer keeps their copy.', array['all'], false, null, 172),
  ('inbox.block',  'WhatsApp Inbox', 'approve', 'Block and unblock customers',
   'A blocked number cannot message the business, and the business cannot message it.', array['all'], false, null, 173)
on conflict (key) do update set
  module = excluded.module, action = excluded.action, label = excluded.label,
  description = excluded.description, allowed_scopes = excluded.allowed_scopes,
  developer_only = excluded.developer_only, min_developer_level = excluded.min_developer_level,
  sort_order = excluded.sort_order;

insert into public.template_permissions (template_id, permission_key, scope)
select t.id, p.key, 'all'
from public.permission_templates t
join public.permissions p on p.key in ('inbox.delete', 'inbox.block')
where t.key = 'administrator'
on conflict do nothing;
