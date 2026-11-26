-- Only Android devices that confirmed the overlay permission receive headless offer pushes.
-- Older app builds and users who skip/revoke the permission keep normal visible notifications.
ALTER TABLE public.user_push_tokens
  ADD COLUMN IF NOT EXISTS overlay_capable boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.enqueue_notification_push()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE v_request_id uuid; v_provider_offer boolean;
BEGIN
  IF NEW.type = 'request_offer' THEN RETURN NEW; END IF;
  IF (NEW.data->>'request_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_request_id := (NEW.data->>'request_id')::uuid;
  END IF;
  v_provider_offer := NEW.type IN ('service_offer', 'ride_offer');
  INSERT INTO public.push_delivery_outbox(notification_id, request_id, provider_id, expo_push_token, payload)
  SELECT NEW.id, v_request_id, NEW.user_id, t.expo_push_token,
    CASE
      WHEN v_provider_offer AND lower(coalesce(t.device_platform, '')) = 'android' AND t.overlay_capable THEN
        jsonb_build_object('to', t.expo_push_token, 'priority', 'high', 'ttl', 180,
          'data', jsonb_build_object(
            'type', 'provider_request_overlay', 'notification_type', NEW.type,
            'notification_id', NEW.id, 'request_id', NEW.data->>'request_id',
            'offer_id', NEW.data->>'offer_id', 'overlay_title', NEW.title,
            'overlay_body', NEW.body, 'sound_enabled', coalesce(t.sound_enabled, true),
            'vibration_enabled', coalesce(t.vibration_enabled, true), 'url', coalesce(NEW.link, '/profile')))
      ELSE
        jsonb_strip_nulls(jsonb_build_object(
          'to', t.expo_push_token, 'title', NEW.title, 'body', NEW.body,
          'sound', CASE WHEN coalesce(t.sound_enabled, true) THEN 'default' ELSE NULL END,
          'priority', CASE WHEN NEW.type IN ('urgent_request', 'request_accepted') OR NEW.data->>'plan' = 'gold' THEN 'high' ELSE 'normal' END,
          'channelId', CASE
            WHEN coalesce(t.sound_enabled, true) AND coalesce(t.vibration_enabled, true) THEN 'mamnoon_sound_vibrate'
            WHEN coalesce(t.sound_enabled, true) THEN 'mamnoon_sound_only'
            WHEN coalesce(t.vibration_enabled, true) THEN 'mamnoon_vibrate_only'
            ELSE 'mamnoon_silent' END,
          'data', jsonb_build_object('type', NEW.type, 'notification_id', NEW.id,
            'request_id', NEW.data->>'request_id', 'url', coalesce(NEW.link, '/profile'))))
    END
  FROM public.user_push_tokens t
  WHERE t.user_id = NEW.user_id
    AND (t.expo_push_token LIKE 'ExpoPushToken[%' OR t.expo_push_token LIKE 'ExponentPushToken[%')
  ON CONFLICT (notification_id, expo_push_token) WHERE notification_id IS NOT NULL DO NOTHING;
  PERFORM public.process_mamnoon_push_outbox();
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enqueue_notification_push() FROM PUBLIC, anon, authenticated;
