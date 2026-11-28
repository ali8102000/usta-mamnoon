-- Restrict direct RPC execution for administrative and trigger-only functions.
-- Admin RPCs require an authenticated session and perform their own admin permission checks.
REVOKE ALL ON FUNCTION public.admin_update_dispatch_zone_settings(
  text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric,
  integer, integer, integer, integer, integer, integer
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_dispatch_zone_settings(
  text, text, text,
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric,
  integer, integer, integer, integer, integer, integer
) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_update_provider_cancellation_penalty_settings(boolean, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_provider_cancellation_penalty_settings(boolean, integer, numeric) TO authenticated;

REVOKE ALL ON FUNCTION public.get_provider_cancellation_penalty_preview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_provider_cancellation_penalty_preview(uuid) TO authenticated;

-- These functions are invoked by PostgreSQL triggers, not as client-callable RPCs.
REVOKE ALL ON FUNCTION public.capture_provider_cancellation_acceptance_time() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_accepted_worker_request_team_member() FROM PUBLIC, anon, authenticated;
