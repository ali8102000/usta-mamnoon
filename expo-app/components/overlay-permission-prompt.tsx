import { useCallback, useEffect, useState } from "react";
import { AppState, Image, Modal, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { requireNativeModule } from "expo-modules-core";
import { APP_VARIANT } from "@/lib/app-variant";

type OverlayPermissionNative = { isPermissionGranted(): boolean; openAppSettings(): boolean };
const OverlayNative = Platform.OS === "android" ? requireNativeModule<OverlayPermissionNative>("MamnoonOverlayPermission") : null;
const visuals = {
  worker: { image: "https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?w=1000&auto=format&fit=crop", fallback: "🧰", caption: "خدمات مهنية وحرفية" },
  driver: { image: "https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?w=1000&auto=format&fit=crop", fallback: "🚕", caption: "رحلات التكسي" },
  large_driver: { image: "https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?w=1000&auto=format&fit=crop", fallback: "🚚", caption: "النقل والحمولات" },
} as const;

export function OverlayPermissionPrompt() {
  const [visible, setVisible] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const visual = visuals[APP_VARIANT === "worker" ? "worker" : APP_VARIANT === "large_driver" ? "large_driver" : "driver"];
  const refreshPermission = useCallback(() => {
    if (Platform.OS !== "android" || !OverlayNative) return;
    try { setVisible(!OverlayNative.isPermissionGranted()); }
    catch (error) { console.warn("[overlay] Permission check failed:", error); }
  }, []);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    refreshPermission();
    const subscription = AppState.addEventListener("change", state => { if (state === "active") refreshPermission(); });
    return () => subscription.remove();
  }, [refreshPermission]);
  const openSettings = () => {
    try { OverlayNative?.openAppSettings(); }
    catch (error) { console.warn("[overlay] Could not open app-specific overlay settings:", error); }
  };
  if (Platform.OS !== "android" || !visible || skipped) return null;
  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => setSkipped(true)}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>اسمح للتطبيق بالظهور فوق بقية التطبيقات</Text>
          <Text style={styles.description}>لكي تستطيع الحصول على الطلبات والرحلات فوراً حتى وإن كنت تستخدم تطبيقات أخرى أو كانت الشاشة مغلقة.</Text>
          <View style={styles.visualFrame}>
            {imageFailed ? <Text style={styles.fallback}>{visual.fallback}</Text> : <Image source={{ uri: visual.image }} onError={() => setImageFailed(true)} style={styles.image} resizeMode="cover" />}
            <View style={styles.captionPill}><Text style={styles.caption}>{visual.caption}</Text></View>
          </View>
          <Pressable accessibilityRole="button" onPress={openSettings} style={styles.primary}><Text style={styles.primaryText}>الذهاب إلى الإعدادات للتفعيل</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setSkipped(true)} style={styles.skip}><Text style={styles.skipText}>تخطي الآن</Text></Pressable>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(7,15,30,0.72)", justifyContent: "center", padding: 20 },
  sheet: { backgroundColor: "#FFFFFF", borderRadius: 26, padding: 22, alignItems: "center", elevation: 18 },
  title: { color: "#14243A", fontSize: 22, fontWeight: "900", textAlign: "center", lineHeight: 34 },
  description: { color: "#526174", fontSize: 15, fontWeight: "600", textAlign: "center", lineHeight: 27, marginTop: 10 },
  visualFrame: { width: "100%", height: 190, marginTop: 18, borderRadius: 18, overflow: "hidden", backgroundColor: "#EAF1FA", alignItems: "center", justifyContent: "center" },
  image: { width: "100%", height: "100%" }, fallback: { fontSize: 76 },
  captionPill: { position: "absolute", bottom: 10, alignSelf: "center", backgroundColor: "rgba(8,20,38,0.78)", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 30 },
  caption: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
  primary: { width: "100%", minHeight: 54, borderRadius: 15, backgroundColor: "#0066FF", alignItems: "center", justifyContent: "center", marginTop: 20, borderWidth: 1, borderColor: "#0056D6" },
  primaryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "900" },
  skip: { paddingHorizontal: 22, paddingVertical: 13, marginTop: 5 }, skipText: { color: "#6B7280", fontSize: 14, fontWeight: "700" },
});
