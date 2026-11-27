import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, Animated, Linking, PanResponder, Platform, Pressable,
  StyleSheet, Text, View, useWindowDimensions,
} from "react-native";
import MapView, { AnimatedRegion, Marker, Polyline, PROVIDER_GOOGLE, Region } from "react-native-maps";
import * as Location from "expo-location";
import { supabase } from "@/lib/supabase";
import { haversineMeters, LatLng, RouteResult, routeFromProxy } from "@/lib/live-navigation";

export type MamnoonRole = "customer" | "captain" | "naqil" | "usta";
type Props = {
  requestId: string;
  role: MamnoonRole;
  pickup: LatLng;
  destination: LatLng;
  customerName?: string;
  providerName?: string;
  phone?: string;
  initialPhase?: "to_pickup" | "to_destination" | "service_work" | "to_workshop";
  onMainAction?: () => void;
  onWorkshopDestination?: (point: LatLng) => void;
};

// أسماء المراحل موحدة؛ كل تطبيق يمرر role الخاص به ولا يخلط هويته مع التطبيقات الأخرى.
const ROLE_ICON: Record<MamnoonRole, string> = {
  customer: "📍", captain: "🚕", naqil: "🚚", usta: "🧰",
};
const ROLE_TITLE: Record<MamnoonRole, string> = {
  customer: "رحلتك", captain: "ملاحة الكابتن", naqil: "ملاحة الناقل", usta: "ملاحة الأسطة",
};
const TASK_NAME = "MAMNOON_LIVE_TRIP_LOCATION_V1";

export default function LiveNavigationScreen(props: Props) {
  const { width, height } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);
  const providerMode = props.role !== "customer";
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [phase, setPhase] = useState(props.initialPhase ?? "to_pickup");
  const [live, setLive] = useState<LatLng | null>(null);
  const [heading, setHeading] = useState(0);
  const [street, setStreet] = useState("");
  const [maneuver, setManeuver] = useState("تابع السير");
  const [eta, setEta] = useState(0);
  const [distance, setDistance] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const animatedCoordinate = useRef(new AnimatedRegion({
    latitude: props.pickup.latitude,
    longitude: props.pickup.longitude,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  })).current;
  const lastRoutePoint = useRef<LatLng | null>(null);
  const lastRouteAt = useRef(0);
  const lastBroadcastAt = useRef(0);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const target = useMemo(() => {
    // الأسطة لا يواصل إلى وجهة افتراضية بعد الوصول؛ ينتقل لوضع تنفيذ الخدمة.
    return phase === "to_destination" || phase === "to_workshop"
      ? props.destination
      : props.pickup;
  }, [phase, props.destination, props.pickup]);

  const fetchRoadRoute = useCallback(async (from: LatLng, to: LatLng) => {
    const { data, error: invokeError } = await supabase.functions.invoke("maps-proxy", {
      body: {
        action: "route",
        from: { lat: from.latitude, lng: from.longitude },
        to: { lat: to.latitude, lng: to.longitude },
        includeGeometry: true,
      },
    });
    if (invokeError) throw invokeError;
    const parsed = routeFromProxy(data);
    if (parsed.routePoints.length < 2) throw new Error("لم يصل مسار صالح من خدمة الخرائط");
    setRoute(parsed);
    setEta(Math.ceil(parsed.durationMin));
    setDistance(Math.round(parsed.distanceKm * 1000));
    lastRoutePoint.current = from;
    lastRouteAt.current = Date.now();

    // يحفظ المزود بيانات الطريق في الجدول المنفصل؛ الزبون يقرأها فقط.
    if (providerMode) {
      const { data: authData } = await supabase.auth.getUser();
      await supabase.from("request_navigation").upsert({
        request_id: props.requestId,
        route_phase: phase,
        route_polyline: JSON.stringify(parsed.routePoints),
        route_points: parsed.routePoints,
        route_steps: parsed.routeSteps,
        eta_minutes: parsed.durationMin,
        distance_meters: Math.round(parsed.distanceKm * 1000),
        next_maneuver: parsed.routeSteps[0]?.instruction ?? null,
        updated_by: authData.user?.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: "request_id" });
    }
  }, [phase, props.requestId, providerMode]);

  // استقبال بث المركبة وبيانات الطريق عند الزبون، من دون استدعاء Google من جهازه.
  useEffect(() => {
    const channel = supabase.channel(`trip_tracking:${props.requestId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    channelRef.current = channel;
    channel.on("broadcast", { event: "location" }, ({ payload }) => {
      if (providerMode) return;
      const point = { latitude: Number(payload.lat), longitude: Number(payload.lng) };
      if (!Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) return;
      setLive(point);
      setHeading(Number(payload.heading ?? 0));
      setEta(Number(payload.eta_minutes ?? 0));
      setDistance(Number(payload.distance_meters ?? 0));
      setStreet(String(payload.current_street ?? ""));
      setManeuver(String(payload.next_maneuver ?? ""));
      animatedCoordinate.timing({ ...point, duration: 2800, useNativeDriver: false }).start();
    });
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [props.requestId, providerMode, animatedCoordinate]);

  // تحميل المسار المحفوظ للزبون، أو حسابه للمزود عبر maps-proxy.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (providerMode) {
          const permission = await Location.requestForegroundPermissionsAsync();
          if (permission.status !== "granted") throw new Error("يرجى السماح بالوصول إلى الموقع");
          const here = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const point = { latitude: here.coords.latitude, longitude: here.coords.longitude };
          if (!active) return;
          setLive(point);
          setHeading(here.coords.heading ?? 0);
          await fetchRoadRoute(point, target);
        } else {
          const { data, error: readError } = await supabase.from("request_navigation")
            .select("route_phase,route_points,route_steps,eta_minutes,distance_meters,current_street,next_maneuver")
            .eq("request_id", props.requestId).maybeSingle();
          if (readError) throw readError;
          if (data) {
            const points = Array.isArray(data.route_points) ? data.route_points : [];
            setRoute({
              routePoints: points.map((p: any) => ({ latitude: Number(p.latitude ?? p.lat), longitude: Number(p.longitude ?? p.lng) })),
              routeSteps: Array.isArray(data.route_steps) ? data.route_steps : [],
              distanceKm: Number(data.distance_meters ?? 0) / 1000,
              durationMin: Number(data.eta_minutes ?? 0),
            });
            setEta(Number(data.eta_minutes ?? 0));
            setDistance(Number(data.distance_meters ?? 0));
            setManeuver(String(data.next_maneuver ?? ""));
            setStreet(String(data.current_street ?? ""));
          }
        }
      } catch (e: any) {
        if (active) setError(e?.message ?? "تعذّر تشغيل الملاحة");
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => { active = false; };
  }, [props.requestId, providerMode, fetchRoadRoute, target]);

  // تتبع المزود: يحدّث الموقع كل 3 ثوانٍ ويعيد حساب الطريق فقط عند انحراف 50م
  // أو مرور 30 ثانية، مع حفظ آخر موقع في live_locations عند كل بث.
  useEffect(() => {
    if (!providerMode || phase === "service_work" || phase === "completed") return;
    let subscription: Location.LocationSubscription | null = null;
    let alive = true;
    (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") return;
      subscription = await Location.watchPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 3000,
        distanceInterval: 3,
      }, async (position) => {
        if (!alive) return;
        const point = { latitude: position.coords.latitude, longitude: position.coords.longitude };
        const course = Number(position.coords.heading ?? 0);
        setLive(point);
        setHeading(course);
        animatedCoordinate.timing({ ...point, duration: 2600, useNativeDriver: false }).start();

        const now = Date.now();
        if (now - lastBroadcastAt.current >= 3000) {
          lastBroadcastAt.current = now;
          const { data: auth } = await supabase.auth.getUser();
          const userId = auth.user?.id;
          if (userId) {
            await supabase.from("live_locations").upsert({
              request_id: props.requestId, user_id: userId, role: "provider",
              lat: point.latitude, lng: point.longitude, heading: course,
              updated_at: new Date().toISOString(),
            }, { onConflict: "request_id,user_id" });
          }
          await channelRef.current?.send({
            type: "broadcast", event: "location",
            payload: {
              lat: point.latitude, lng: point.longitude, heading: course,
              speed: position.coords.speed ?? 0, eta_minutes: eta,
              distance_meters: distance, current_street: street,
              next_maneuver: maneuver,
            },
          });
        }

        const drift = lastRoutePoint.current ? haversineMeters(lastRoutePoint.current, point) : 9999;
        if (drift > 50 || now - lastRouteAt.current >= 30000) {
          try { await fetchRoadRoute(point, target); } catch (e) { console.warn("[mamnoon-navigation] reroute", e); }
        }
      });
    })().catch((e) => setError(e?.message ?? "تعذّر تفعيل تتبع الموقع"));
    return () => { alive = false; subscription?.remove(); };
  }, [providerMode, phase, props.requestId, target, fetchRoadRoute, animatedCoordinate, eta, distance, street, maneuver]);

  // مزامنة معلومات الانعطاف مع أول خطوة متبقية.
  useEffect(() => {
    if (route?.routeSteps?.length) {
      setManeuver(route.routeSteps[0].instruction || "تابع السير");
    }
  }, [route]);

  // عند انتقال الأسطة لوضع العمل لا تبقى كاميرا الملاحة ولا طلبات الموقع فعالة.
  const onArrived = () => {
    if (props.role === "usta") {
      setPhase("service_work");
      void supabase.auth.getUser().then(({ data }) => supabase.from("request_navigation").upsert({
        request_id: props.requestId, route_phase: "service_work", updated_by: data.user?.id,
        route_points: [], route_steps: [], eta_minutes: 0, distance_meters: 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: "request_id" }));
    } else if ((props.role === "captain" || props.role === "naqil") && phase === "to_pickup") {
      setPhase("to_destination");
      lastRoutePoint.current = null;
      void fetchRoadRoute(live ?? props.pickup, props.destination);
    } else if (props.role === "captain" || props.role === "naqil") {
      setPhase("completed");
      void supabase.auth.getUser().then(({ data }) => supabase.from("request_navigation").upsert({
        request_id: props.requestId, route_phase: "completed", route_points: [],
        route_steps: [], eta_minutes: 0, distance_meters: 0, updated_by: data.user?.id,
      }, { onConflict: "request_id" }));
    }
    props.onMainAction?.();
  };

  const recenter = () => {
    if (!live || !mapRef.current) return;
    mapRef.current.animateCamera({
      center: live,
      heading: providerMode ? heading : 0,
      pitch: providerMode ? 55 : 0,
      zoom: providerMode ? 17.5 : 15,
    }, { duration: 650 });
  };

  const fitRoute = () => {
    if (route?.routePoints && route.routePoints.length > 1) {
      mapRef.current?.fitToCoordinates(route.routePoints, {
        edgePadding: { top: 130, right: 45, bottom: expanded ? 300 : 190, left: 45 },
        animated: true,
      });
    }
  };

  const pan = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 8,
    onPanResponderMove: (_, g) => pan.setValue(g.dy),
    onPanResponderRelease: (_, g) => {
      const open = g.dy < -45;
      setExpanded(open);
      Animated.spring(pan, { toValue: 0, useNativeDriver: true }).start();
    },
  })).current;

  const icon = ROLE_ICON[props.role];
  const serviceWork = props.role === "usta" && phase === "service_work";
  const sheetHeight = serviceWork ? height * 0.30 : expanded ? height * 0.55 : height * 0.28;
  const mapInitial: Region = {
    ...props.pickup, latitudeDelta: 0.018, longitudeDelta: 0.018,
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        initialRegion={mapInitial}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
        mapPadding={{ top: 105, right: 18, bottom: sheetHeight + 20, left: 18 }}
        onMapReady={fitRoute}
      >
        {route?.routePoints && route.routePoints.length > 1 && <>
          <Polyline coordinates={route.routePoints} strokeColor="#172554" strokeWidth={9} lineCap="round" lineJoin="round" />
          <Polyline coordinates={route.routePoints} strokeColor="#3978F6" strokeWidth={5} lineCap="round" lineJoin="round" />
        </>}
        <Marker coordinate={props.pickup} title="موقع الاستلام"><View style={styles.pin}><Text>🟢</Text></View></Marker>
        <Marker coordinate={props.destination} title="الوجهة"><View style={styles.pin}><Text>🏁</Text></View></Marker>
        {(providerMode ? live : live) && (
          <Marker.Animated coordinate={animatedCoordinate} flat={true} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.vehicle}><Text style={{ fontSize: 27 }}>{icon}</Text></View>
          </Marker.Animated>
        )}
      </MapView>

      <View style={styles.topPill}>
        <Text style={styles.topMain}>{serviceWork ? "الخدمة قيد التنفيذ" : `${eta} دقيقة`}</Text>
        <Text style={styles.topSub}>{serviceWork ? "الملاحة متوقفة" : `${(distance / 1000).toFixed(1)} كم • ${maneuver || street || "جاري تحديد الطريق"}`}</Text>
      </View>
      <Pressable style={styles.backButton} onPress={() => Linking.openURL("mamnoon://")}>
        <Text style={styles.buttonText}>‹</Text>
      </Pressable>
      <Pressable style={styles.recenter} onPress={recenter}><Text style={styles.buttonText}>◎</Text></Pressable>

      <Animated.View
        {...panResponder.panHandlers}
        style={[styles.sheet, { height: sheetHeight, transform: [{ translateY: pan }] }]}
      >
        <View style={styles.handle} />
        <Text style={styles.sheetTitle}>{ROLE_TITLE[props.role]}</Text>
        <Text style={styles.status}>{serviceWork ? "وصل الأسطة — جاري تنفيذ الخدمة" : phase === "to_destination" ? "بدأت مرحلة التوصيل" : "بالطريق إلى موقع الزبون"}</Text>
        <Text style={styles.detail}>{props.role === "customer" ? (props.providerName ?? "المزود") : (props.customerName ?? "الزبون")}</Text>
        {!!street && <Text style={styles.detail}>الشارع الحالي: {street}</Text>}
        <View style={styles.actions}>
          {!!props.phone && <Pressable style={styles.secondary} onPress={() => Linking.openURL(`tel:${props.phone}`)}><Text style={styles.actionText}>اتصال</Text></Pressable>}
          <Pressable style={styles.secondary} onPress={() => setExpanded(v => !v)}><Text style={styles.actionText}>{expanded ? "تصغير" : "التفاصيل"}</Text></Pressable>
          {providerMode && !serviceWork && <Pressable style={styles.primary} onPress={onArrived}><Text style={styles.actionText}>{props.role === "usta" ? "وصلت — بدء التنفيذ" : phase === "to_destination" ? "إنهاء الرحلة" : "وصلت لموقع الاستلام"}</Text></Pressable>}
          {serviceWork && <Pressable style={styles.primary} onPress={() => props.onWorkshopDestination?.(props.destination)}><Text style={styles.actionText}>التوجه لوجهة ثانية / ورشة</Text></Pressable>}
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}
        {busy && <ActivityIndicator />}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: "#eef2f7" },
  topPill: { position: "absolute", top: Platform.OS === "ios" ? 58 : 28, alignSelf: "center", width: "82%", backgroundColor: "#fff", borderRadius: 24, paddingVertical: 12, paddingHorizontal: 18, elevation: 7, alignItems: "center" },
  topMain: { color: "#111827", fontSize: 20, fontWeight: "800" },
  topSub: { color: "#475569", fontSize: 12, marginTop: 3, textAlign: "center" },
  backButton: { position: "absolute", top: Platform.OS === "ios" ? 58 : 28, left: 18, width: 44, height: 44, borderRadius: 22, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 6 },
  recenter: { position: "absolute", right: 18, bottom: 230, width: 48, height: 48, borderRadius: 24, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", elevation: 6 },
  buttonText: { fontSize: 25, color: "#111827", fontWeight: "800" },
  sheet: { position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: "#fff", borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 10, elevation: 18 },
  handle: { width: 42, height: 5, borderRadius: 4, backgroundColor: "#cbd5e1", alignSelf: "center", marginBottom: 12 },
  sheetTitle: { fontSize: 18, fontWeight: "800", color: "#111827", textAlign: "right" },
  status: { fontSize: 14, color: "#2563eb", marginTop: 8, textAlign: "right", fontWeight: "700" },
  detail: { fontSize: 13, color: "#475569", marginTop: 7, textAlign: "right" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 16, justifyContent: "flex-end" },
  primary: { backgroundColor: "#166534", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  secondary: { backgroundColor: "#e2e8f0", borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  actionText: { color: "#fff", fontWeight: "700" },
  pin: { backgroundColor: "#fff", borderRadius: 18, padding: 6, elevation: 4 },
  vehicle: { backgroundColor: "#fff", borderRadius: 24, padding: 7, borderWidth: 2, borderColor: "#2563eb", elevation: 5 },
  error: { color: "#b91c1c", marginTop: 8, textAlign: "right" },
});
