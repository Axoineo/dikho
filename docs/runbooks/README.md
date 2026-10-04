# Operations Runbooks

These runbooks provide safe starting procedures for stressful operational
events. They deliberately use placeholders and never contain credentials,
production identifiers, personal data or copied provider output.

- [Incident response](incident-response.md)
- [Credential rotation](credential-rotation.md)
- [Application and migration rollback](rollback.md)

Before an event, assign owners for Cloudflare, Supabase, Meta/WhatsApp and any
email or GST provider. Store the contact path and environment inventory in the
organization's approved private operations system, not this repository.

These documents do not authorize production changes. The incident commander or
system owner must approve destructive actions, credential changes, remote
migrations and production deployments.
