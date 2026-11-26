import { useEffect, useRef } from "react";
import { Alert, Linking } from "react-native";
import { router } from "expo-router";
import { APP_VARIANT } from "@/lib/app-variant";
import { supabase } from "@/lib/supabase";

export function OverlayAcceptLinkHandler() {
  const handled = useRef(new Set<string>());
  useEffect(() => {
    const handleUrl = async (url: string | null) => {
      if (!url || !url.includes("accept=1")) return;
      const match = url.match(/request\/([0-9a-f-]{36})/i);
      const requestId = match?.[1];
      if (!requestId || handled.current.has(requestId)) return;
      handled.current.add(requestId);
      try {
        const rpc = APP_VARIANT === "large_driver"
          ? "accept_large_vehicle_request"
          : "accept_service_request";
        const { error } = await supabase.rpc(rpc, { _request_id: requestId });
        if (error) {
          handled.current.delete(requestId);
          Alert.alert("تعذّر قبول الطلب", error.message || "قد يكون الطلب انتهى أو قبله مزوّد آخر.");
          router.replace({ pathname: "/request/[id]", params: { id: requestId } });
          return;
        }
        router.replace({ pathname: "/request/[id]", params: { id: requestId } });
      } catch (error) {
        handled.current.delete(requestId);
        Alert.alert("تعذّر قبول الطلب", error instanceof Error ? error.message : "حاول مرة ثانية.");
      }
    };
    const subscription = Linking.addEventListener("url", ({ url }) => { void handleUrl(url); });
    void Linking.getInitialURL().then(handleUrl).catch((error) => console.warn("[overlay-link] Initial URL failed:", error));
    return () => subscription.remove();
  }, []);
  return null;
}
