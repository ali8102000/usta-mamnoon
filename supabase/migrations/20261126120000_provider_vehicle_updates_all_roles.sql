-- Vehicle updates for all approved provider apps, reviewed by the existing admin workflow.
BEGIN;

ALTER TABLE public.worker_profiles
  ADD COLUMN IF NOT EXISTS vehicle_make text,
  ADD COLUMN IF NOT EXISTS vehicle_model text,
  ADD COLUMN IF NOT EXISTS vehicle_year integer,
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS vehicle_color text;

ALTER TABLE public.provider_change_requests
  DROP CONSTRAINT IF EXISTS provider_change_requests_payload_check;
ALTER TABLE public.provider_change_requests
  ADD CONSTRAINT provider_change_requests_payload_check CHECK (
    (provider_type = 'worker' AND (
      jsonb_typeof(requested_data->'service_ids') = 'array'
      OR jsonb_typeof(requested_data->'vehicle_update') = 'object'
    ))
    OR (provider_type = 'driver' AND (
      requested_data->>'vehicle_category' IN ('economy','premium','luxury')
      OR jsonb_typeof(requested_data->'vehicle_update') = 'object'
      OR jsonb_typeof(requested_data->'documents') = 'object'
    ))
    OR (provider_type = 'large_driver' AND (
      requested_data->>'vehicle_type' IN ('kia_cargo','kia_passenger','bus')
      OR jsonb_typeof(requested_data->'vehicle_update') = 'object'
      OR jsonb_typeof(requested_data->'documents') = 'object'
    ))
  );

CREATE OR REPLACE FUNCTION public.guard_worker_vehicle_profile_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_governorate text;
BEGIN
  IF auth.uid() IS NULL OR public.has_admin_access(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'approved' AND (
    NEW.vehicle_make IS DISTINCT FROM OLD.vehicle_make OR
    NEW.vehicle_model IS DISTINCT FROM OLD.vehicle_model OR
    NEW.vehicle_year IS DISTINCT FROM OLD.vehicle_year OR
    NEW.vehicle_plate IS DISTINCT FROM OLD.vehicle_plate OR
    NEW.vehicle_color IS DISTINCT FROM OLD.vehicle_color
  ) THEN
    SELECT governorate_key INTO v_governorate
    FROM public.profiles WHERE id = OLD.user_id;

    IF NOT public.admin_has_permission(
      'providers.verify',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    ) THEN
      RAISE EXCEPTION 'approved_vehicle_changes_require_admin_review';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_worker_vehicle_profile_changes_trigger ON public.worker_profiles;
CREATE TRIGGER guard_worker_vehicle_profile_changes_trigger
BEFORE UPDATE ON public.worker_profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_worker_vehicle_profile_changes();
REVOKE ALL ON FUNCTION public.guard_worker_vehicle_profile_changes() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_worker_vehicle_change_request(_vehicle_update jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT public.has_role(auth.uid(), 'worker'::public.app_role) THEN
    RAISE EXCEPTION 'approved_provider_role_required';
  END IF;
  IF _vehicle_update IS NULL OR jsonb_typeof(_vehicle_update) IS DISTINCT FROM 'object'
     OR _vehicle_update = '{}'::jsonb THEN
    RAISE EXCEPTION 'empty_vehicle_change_request';
  END IF;
  IF (_vehicle_update ? 'vehicle_make' AND length(trim(coalesce(_vehicle_update->>'vehicle_make',''))) NOT BETWEEN 2 AND 40)
     OR (_vehicle_update ? 'vehicle_model' AND length(trim(coalesce(_vehicle_update->>'vehicle_model',''))) NOT BETWEEN 1 AND 60)
     OR (_vehicle_update ? 'vehicle_plate' AND length(trim(coalesce(_vehicle_update->>'vehicle_plate',''))) NOT BETWEEN 2 AND 30)
     OR (_vehicle_update ? 'vehicle_color' AND length(trim(coalesce(_vehicle_update->>'vehicle_color',''))) > 40) THEN
    RAISE EXCEPTION 'invalid_vehicle_update';
  END IF;
  IF _vehicle_update ? 'vehicle_year' THEN
    IF (_vehicle_update->>'vehicle_year') !~ '^[0-9]{4}$'
       OR (_vehicle_update->>'vehicle_year')::integer < 1900
       OR (_vehicle_update->>'vehicle_year')::integer > EXTRACT(YEAR FROM now())::integer + 1 THEN
      RAISE EXCEPTION 'invalid_vehicle_year';
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.worker_profiles
    WHERE user_id = auth.uid() AND status = 'approved'
  ) THEN
    RAISE EXCEPTION 'approved_worker_profile_required';
  END IF;

  INSERT INTO public.provider_change_requests(user_id, provider_type, requested_data)
  VALUES (auth.uid(), 'worker', jsonb_build_object('vehicle_update', _vehicle_update))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_worker_vehicle_change_request(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_worker_vehicle_change_request(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_review_provider_change_request(
  _request_id uuid,
  _status text,
  _reason text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
  r public.provider_change_requests%ROWTYPE;
  v_governorate text;
  v_vehicle jsonb;
  v_documents jsonb;
  v_updated integer;
  v_verification_type text;
BEGIN
  IF _request_id IS NULL OR _status IS NULL OR _status NOT IN ('approved','rejected') THEN
    RAISE EXCEPTION 'invalid_review_status';
  END IF;
  IF _status = 'rejected' AND NULLIF(trim(coalesce(_reason,'')),'') IS NULL THEN
    RAISE EXCEPTION 'rejection_reason_required';
  END IF;

  SELECT * INTO r FROM public.provider_change_requests
  WHERE id = _request_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'change_request_unavailable'; END IF;

  SELECT governorate_key INTO v_governorate
  FROM public.profiles WHERE id = r.user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'change_request_unavailable'; END IF;

  IF auth.uid() IS NULL OR NOT (
    public.has_admin_access(auth.uid())
    OR public.admin_has_permission(
      'providers.verify',
      CASE WHEN v_governorate IS NULL THEN 'global' ELSE 'governorate' END,
      v_governorate
    )
  ) THEN
    RAISE EXCEPTION 'change_request_unavailable';
  END IF;

  IF _status = 'approved' THEN
    IF r.provider_type = 'worker' THEN
      IF r.requested_data ? 'service_ids' THEN
        DELETE FROM public.worker_services WHERE worker_id = r.user_id;
        INSERT INTO public.worker_services(worker_id, service_id)
        SELECT r.user_id, item.value::uuid
        FROM jsonb_array_elements_text(r.requested_data->'service_ids') AS item(value)
        ON CONFLICT(worker_id,service_id) DO NOTHING;
      END IF;

      v_vehicle := COALESCE(r.requested_data->'vehicle_update', '{}'::jsonb);
      IF v_vehicle <> '{}'::jsonb THEN
        UPDATE public.worker_profiles
        SET vehicle_make = CASE WHEN v_vehicle ? 'vehicle_make' THEN v_vehicle->>'vehicle_make' ELSE vehicle_make END,
            vehicle_model = CASE WHEN v_vehicle ? 'vehicle_model' THEN v_vehicle->>'vehicle_model' ELSE vehicle_model END,
            vehicle_year = CASE WHEN v_vehicle ? 'vehicle_year' THEN (v_vehicle->>'vehicle_year')::integer ELSE vehicle_year END,
            vehicle_plate = CASE WHEN v_vehicle ? 'vehicle_plate' THEN v_vehicle->>'vehicle_plate' ELSE vehicle_plate END,
            vehicle_color = CASE WHEN v_vehicle ? 'vehicle_color' THEN v_vehicle->>'vehicle_color' ELSE vehicle_color END
        WHERE user_id = r.user_id AND status = 'approved';
        IF NOT FOUND THEN RAISE EXCEPTION 'approved_worker_profile_required'; END IF;
      END IF;
    ELSIF r.provider_type IN ('driver','large_driver') THEN
      v_vehicle := COALESCE(r.requested_data->'vehicle_update', '{}'::jsonb);
      IF r.provider_type = 'driver' AND r.requested_data ? 'vehicle_category' THEN
        v_vehicle := v_vehicle || jsonb_build_object('vehicle_category', r.requested_data->>'vehicle_category');
      ELSIF r.provider_type = 'large_driver' AND r.requested_data ? 'vehicle_type' THEN
        v_vehicle := v_vehicle || jsonb_build_object(
          'vehicle_type', r.requested_data->>'vehicle_type',
          'vehicle_model', CASE r.requested_data->>'vehicle_type'
            WHEN 'kia_cargo' THEN 'كيا حمل'
            WHEN 'kia_passenger' THEN 'كيا ركاب'
            ELSE 'باص' END
        );
      END IF;
      v_documents := COALESCE(r.requested_data->'documents', '{}'::jsonb);

      UPDATE public.driver_profiles
      SET vehicle_make = CASE WHEN v_vehicle ? 'vehicle_make' THEN v_vehicle->>'vehicle_make' ELSE vehicle_make END,
          vehicle_model = CASE WHEN v_vehicle ? 'vehicle_model' THEN v_vehicle->>'vehicle_model' ELSE vehicle_model END,
          vehicle_year = CASE WHEN v_vehicle ? 'vehicle_year' THEN (v_vehicle->>'vehicle_year')::integer ELSE vehicle_year END,
          vehicle_plate = CASE WHEN v_vehicle ? 'vehicle_plate' THEN v_vehicle->>'vehicle_plate' ELSE vehicle_plate END,
          vehicle_color = CASE WHEN v_vehicle ? 'vehicle_color' THEN v_vehicle->>'vehicle_color' ELSE vehicle_color END,
          vehicle_category = CASE WHEN v_vehicle ? 'vehicle_category' THEN (v_vehicle->>'vehicle_category')::public.vehicle_category ELSE vehicle_category END,
          vehicle_type = CASE WHEN v_vehicle ? 'vehicle_type' THEN v_vehicle->>'vehicle_type' ELSE vehicle_type END,
          updated_at = now()
      WHERE user_id = r.user_id AND status = 'approved'
        AND ((r.provider_type = 'driver' AND vehicle_category::text <> 'large')
          OR (r.provider_type = 'large_driver' AND vehicle_category::text = 'large'));
      IF NOT FOUND THEN RAISE EXCEPTION 'approved_driver_profile_not_found'; END IF;

      v_verification_type := r.provider_type;
      IF r.provider_type = 'large_driver' AND NOT EXISTS (
        SELECT 1 FROM public.provider_verifications
        WHERE user_id = r.user_id AND provider_type = 'large_driver'
      ) THEN
        v_verification_type := 'driver';
      END IF;

      UPDATE public.provider_verifications
      SET vehicle_document_path = CASE WHEN v_documents ? 'vehicle_document' THEN v_documents->>'vehicle_document' ELSE vehicle_document_path END,
          metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
            'vehicleMake', v_vehicle->'vehicle_make',
            'vehicleModel', v_vehicle->'vehicle_model',
            'vehicleYear', v_vehicle->'vehicle_year',
            'vehiclePlate', v_vehicle->'vehicle_plate',
            'vehicleColor', v_vehicle->'vehicle_color',
            'vehicleCategory', v_vehicle->'vehicle_category',
            'vehicleType', v_vehicle->'vehicle_type'
          )),
          updated_at = now()
      WHERE user_id = r.user_id AND provider_type = v_verification_type;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
      IF v_documents <> '{}'::jsonb AND v_updated = 0 THEN
        RAISE EXCEPTION 'provider_verification_record_not_found';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid_provider_type';
    END IF;
  END IF;

  UPDATE public.provider_change_requests
  SET status = _status,
      rejection_reason = CASE WHEN _status = 'rejected' THEN left(trim(_reason),500) ELSE NULL END,
      reviewed_by = auth.uid(), reviewed_at = now()
  WHERE id = _request_id;

  INSERT INTO public.notifications(user_id,type,title,body,link,data)
  VALUES (
    r.user_id,
    CASE WHEN _status = 'approved' THEN 'provider_change_approved' ELSE 'provider_change_rejected' END,
    CASE WHEN _status = 'approved' THEN 'تمت الموافقة على تحديث بياناتك' ELSE 'طلب تحديث البيانات يحتاج إلى تعديل' END,
    CASE WHEN _status = 'approved'
      THEN 'وافقت الإدارة على تحديث بيانات المركبة أو المستندات أو الاختصاصات. تم تفعيل التحديث.'
      ELSE 'سبب الرفض: ' || left(trim(_reason),500) END,
    '/account-settings',
    jsonb_build_object('request_id',r.id,'provider_type',r.provider_type,'status',_status)
  );
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_review_provider_change_request(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_review_provider_change_request(uuid,text,text) TO authenticated;

COMMIT;
