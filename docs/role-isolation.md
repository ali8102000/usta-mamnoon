# Mamnoon provider-role isolation

## Identity model
One Supabase Auth user may hold multiple provider roles. Roles are never converted into one another and each app loads only its own role profile:

| App | Role | Profile table |
|---|---|---|
| Customer | `customer` | `profiles` |
| Captain / taxi | `driver` | `driver_profiles` |
| Carrier / large vehicle | `large_driver` | `naqil_profiles` |
| Usta / technician | `worker` | `worker_profiles` |

`user_roles` remains multi-role per user (unique by `user_id, role`). Provider verification and approval remain scoped by `provider_type`; approval of one profile does not approve another. Existing large-vehicle profile data was copied to `naqil_profiles` and removed from the taxi-only `driver_profiles` table, allowing the same user to create both profiles independently.

## Presence and dispatch
- `provider_presence_roles` uses the composite key `(user_id, role)` and stores independent `online / offline / in_trip` state and location for each provider role.
- Taxi dispatch reads only `driver` presence and `driver_profiles`.
- Large-vehicle dispatch reads only `large_driver` presence and `naqil_profiles`.
- Service dispatch reads only `worker` presence and `worker_profiles`.
- A user can have one active request per role; an active trip in one role does not block another role. Worker team assignments are also role-scoped and prevent a worker from being assigned to a second active service job.
- `request_offers.provider_role` and `service_requests.provider_role` bind each offer and accepted request to the role that owns it.
- The legacy unkeyed `provider_presence` is not used for provider dispatch.

## Tracking remains shared
The existing `service_requests`, `live_locations`, `trip_location_points`, and `request_navigation` tables remain in place. The route, Google Maps proxy, full-screen map, navigation lifecycle, and private Realtime topic are unchanged. Role metadata on requests and location records plus role-aware RLS policies prevent one provider role from writing another role's location or navigation data. Assigned service-team members remain recognized as `worker` members of their request.

## Database migrations applied
The shared Supabase project's migration history is the source of truth for the database deployment. Applied migration identifiers:

- `role_profiles_presence_v1`
- `role_request_binding_v1`
- `role_request_rls_v1`
- `role_isolation_dispatch_v1`
- `role_isolation_profile_workflows_v1`
- `role_isolation_taxi_presence_notifications_v1`
- `role_isolation_pricing_metrics_v1`
- `role_isolation_completion_stats_v1`
- `role_isolation_admin_reporting_v1`
- `role_isolation_multi_role_eligibility_v1`
- `role_isolation_service_dispatch_v1`
- `role_isolation_worker_team_tracking_v1`
- `role_isolation_tracking_role_compat_v1`
- `role_isolation_realtime_policy_v1`
- `role_isolation_live_location_delete_policy_v1`
- `role_isolation_taxi_pricing_presence_v1`
- `role_isolation_request_role_history_v1`
- `role_isolation_worker_team_assignment_guard_v1`
- `role_isolation_primary_and_team_participant_helper_v1`
- `role_isolation_worker_team_read_policies_v1`
- `role_isolation_member_helper_privacy_v1`
- `role_isolation_worker_presence_global_active_v1`
- `role_isolation_worker_team_approval_guard_v1`

Do not reintroduce large-vehicle rows into `driver_profiles`, do not use the legacy unkeyed presence table for dispatch, and do not remove `provider_role` checks from RLS.
