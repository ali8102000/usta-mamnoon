import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import Constants from "expo-constants";
import { AppState, Platform } from "react-native";
import { requireNativeModule } from "expo-modules-core";

const TASK_NAME = "MAMNOON_PROVIDER_REQUEST_OVERLAY";
type OverlayNativeModule = {
  isPermissionGranted(): boolean;
  showRequestOverlay(title: string, body: string, deepLink: string, soundEnabled: boolean, vibrationEnabled: boolean): boolean;
  hideRequestOverlay(): boolean;
};
const OverlayNative = Platform.OS === "android" ? requireNativeModule<OverlayNativeModule>("MamnoonOverlayPermission") : null;

TaskManager.defineTask<Notifications.NotificationTaskPayload>(TASK_NAME, async ({ data, error }) => {
  if (Platform.OS !== "android" || !OverlayNative || error || !data) return;
  try {
    if (AppState.currentState === "active") return;
    const raw = (data as any)?.data?.dataString;
    if (typeof raw !== "string") return;
    const payload = JSON.parse(raw) as {
      type?: string; request_id?: string; overlay_title?: string; overlay_body?: string;
      sound_enabled?: boolean; vibration_enabled?: boolean;
    };
    if (payload.type !== "provider_request_overlay" || typeof payload.request_id !== "string") return;
    if (!OverlayNative.isPermissionGranted()) return;
    const scheme = Constants.expoConfig?.scheme;
    if (!scheme) return;
    OverlayNative.showRequestOverlay(
      payload.overlay_title || "طلب جديد من ممنون",
      payload.overlay_body || "وصلك طلب جديد. اضغط قبول للرد فوراً.",
      `${scheme}://request/${payload.request_id}?accept=1`,
      payload.sound_enabled !== false,
      payload.vibration_enabled !== false
    );
  } catch (taskError) {
    console.warn("[overlay-push] Background request overlay failed:", taskError);
  }
});

if (Platform.OS === "android") {
  void TaskManager.isTaskRegisteredAsync(TASK_NAME)
    .then((registered) => registered ? null : Notifications.registerTaskAsync(TASK_NAME))
    .catch((registrationError) => console.warn("[overlay-push] Could not register background task:", registrationError));
}
