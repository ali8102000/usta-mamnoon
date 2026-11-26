-- Android providers that explicitly granted SYSTEM_ALERT_WINDOW use a data-only
-- push so the headless task can display a native overlay. Other devices keep the
-- existing visible notification payload (including sound/vibration preferences).
ALTER TABLE public.user_push_tokens
  ADD COLUMN IF NOT EXISTS overlay_capable boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.enqueue_request_offer_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_type text;
  v_pickup text;
  v_title text;
  v_body text;
  v_urgency smallint;
  v_price numeric;
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT r.type::text, r.pickup_text, r.urgency_multiplier,
         CASE WHEN r.type::text = 'taxi' AND r.vehicle_category::text <> 'large'
           THEN coalesce(r.customer_payable, r.price_estimate)
           ELSE r.customer_price END
  INTO v_type, v_pickup, v_urgency, v_price
  FROM public.service_requests r
  WHERE r.id = NEW.request_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF coalesce(v_urgency, 1) > 1 THEN
    v_title := 'طلب عاجل ×' || v_urgency::text;
    v_body := 'الزبون فعّل وضع الاستعجال ورفع الأجر إلى ' ||
      to_char(coalesce(v_price, 0), 'FM999,999,999') || ' د.ع. افتح ممنون لقبول الطلب.';
  ELSIF v_type = 'taxi' THEN
    v_title := 'طلب رحلة جديد';
    v_body := 'وصلتك رحلة جديدة' ||
      CASE WHEN nullif(trim(v_pickup), '') IS NOT NULL
        THEN ' من ' || left(trim(v_pickup), 90) ELSE '' END || '. افتح ممنون للرد.';
  ELSE
    v_title := 'طلب خدمة جديد';
    v_body := 'وصلك طلب خدمة جديد من زبون قريب. افتح ممنون للتفاصيل.';
  END IF;

  -- Requeued offers reuse their original in-app notification.
  IF NOT EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.user_id = NEW.provider_id
      AND n.type = 'request_offer'
      AND n.data->>'offer_id' = NEW.id::text
  ) THEN
    INSERT INTO public.notifications(user_id, type, title, body, link, data)
    VALUES (
      NEW.provider_id, 'request_offer', v_title, v_body,
      '/request/' || NEW.request_id::text,
      jsonb_build_object(
        'type', 'request_offer',
        'request_id', NEW.request_id,
        'offer_id', NEW.id,
        'urgency_multiplier', coalesce(v_urgency, 1)
      )
    );
  END IF;

  INSERT INTO public.push_delivery_outbox(offer_id, request_id, provider_id, expo_push_token, payload)
  SELECT
    NEW.id, NEW.request_id, NEW.provider_id, t.expo_push_token,
    CASE
      WHEN lower(coalesce(t.device_platform, '')) = 'android' AND t.overlay_capable THEN
        jsonb_build_object(
          'to', t.expo_push_token,
          'priority', 'high',
          'ttl', 180,
          'data', jsonb_build_object(
            'type', 'provider_request_overlay',
            'request_id', NEW.request_id,
            'offer_id', NEW.id,
            'urgency_multiplier', coalesce(v_urgency, 1),
            'overlay_title', v_title,
            'overlay_body', v_body,
            'sound_enabled', coalesce(t.sound_enabled, true),
            'vibration_enabled', coalesce(t.vibration_enabled, true),
            'url', '/request/' || NEW.request_id::text
          )
        )
      ELSE
        jsonb_strip_nulls(jsonb_build_object(
          'to', t.expo_push_token,
          'title', v_title,
          'body', v_body,
          'sound', CASE WHEN coalesce(t.sound_enabled, true) THEN 'default' ELSE NULL END,
          'priority', 'high',
          'channelId', CASE
            WHEN coalesce(t.sound_enabled, true) AND coalesce(t.vibration_enabled, true) THEN 'mamnoon_sound_vibrate'
            WHEN coalesce(t.sound_enabled, true) THEN 'mamnoon_sound_only'
            WHEN coalesce(t.vibration_enabled, true) THEN 'mamnoon_vibrate_only'
            ELSE 'mamnoon_silent'
          END,
          'data', jsonb_build_object(
            'type', 'request_offer',
            'request_id', NEW.request_id,
            'offer_id', NEW.id,
            'urgency_multiplier', coalesce(v_urgency, 1),
            'url', '/request/' || NEW.request_id::text
          )
        ))
    END
  FROM public.user_push_tokens t
  WHERE t.user_id = NEW.provider_id
    AND (t.expo_push_token LIKE 'ExpoPushToken[%' OR t.expo_push_token LIKE 'ExponentPushToken[%')
  ON CONFLICT (offer_id, expo_push_token) DO NOTHING;

  PERFORM public.process_mamnoon_push_outbox();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.enqueue_request_offer_push() FROM PUBLIC, anon, authenticated;
