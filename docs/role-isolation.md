# Mamnoon provider-role isolation

## Identity model
One Supabase Auth user may hold multiple provider roles. Roles are never converted into one another and each app loads only its own role profile:

| App | Role | Profile table |
|---|---|---|
| Customer | `customer` | `profiles` |
| Captain / taxi | `driver` | `driver_profiles` |
| Carrier / large vehicle | `large_driver` | `naqil_profiles` |
| Usta / technician | `worker` | `worker_profiles` |

`user_roles` remains multi-role per user (unique by `user_id, role`). Provider verification is role-scoped by `provider_type`; approval of one profile does not approve another. Existing large-vehicle profile data was copied to `naqil_profiles` and removed from the taxi-only `driver_profiles` table so the same user can create both profiles independently.

## Presence and dispatch
- `provider_presence_roles` uses the composite key `(user_id, role)` and stores an independent `online / offline / in_trip` state and location for each provider role.
- Taxi dispatch reads only `driver` presence and `driver_profiles`.
- Large-vehicle dispatch reads only `large_driver` presence and `naqil_profiles`.
- Service dispatch reads only `worker` presence and `worker_profiles`.
- A user can have one active request per role; an active trip in one role does not block a different role.
- `request_offers.provider_role` and `service_requests.provider_role` bind each offer and accepted request to the role that owns it.

## Tracking remains shared
The existing `service_requests`, `live_locations`, `trip_location_points`, and `request_navigation` tables remain in place. The route, Google Maps proxy, private Realtime topic, and navigation lifecycle are unchanged. `provider_role` metadata on request/location records and role-aware RLS policies prevent one provider role from writing another role's location or navigation data. Service-team members are still recognized as `worker` members of their assigned request.

## Database migrations applied
The Supabase project migration history is the source of truth for the role-isolation deployment. Applied migrations:

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

Do not reintroduce large-vehicle rows into `driver_profiles`, do not use the legacy unkeyed `provider_presence` for provider dispatch, and do not remove `provider_role` checks from RLS.
