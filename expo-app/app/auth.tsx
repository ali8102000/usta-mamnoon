import { useEffect, useRef, useState } from "react";
import { router } from "expo-router";
import {
  View, Text, StyleSheet, ScrollView, Alert, Pressable, Image,
  KeyboardAvoidingView, Platform, Modal, ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "@/lib/supabase";
import { normalizePhone, isValidPhone, toEnglishDigits } from "@/lib/phone";
import { useAuth } from "@/lib/auth-context";
import { Button, RealInput } from "@/components/ui";
import { palette, space } from "@/styles/theme";
import { Image as ExpoImage } from "expo-image";
import { useCompanyBranding } from "@/lib/company-branding";
import { APP_VARIANT } from "@/lib/app-variant";

type AuthStep = "phone" | "otp";

export default function AuthScreen() {
  const [step, setStep] = useState<AuthStep>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [otp, setOtp] = useState("");
  const [busy, setBusy] = useState(false);
  const [adminVisible, setAdminVisible] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminBusy, setAdminBusy] = useState(false);
  const tapCount = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refresh } = useAuth();
  const { companyName, logoUrl, welcomeMessage, welcomeVisualUrl, welcomeVisualAnimated } = useCompanyBranding();

  useEffect(() => () => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
  }, []);

  function handleLogoTap() {
    if (APP_VARIANT !== "customer") return;
    tapCount.current += 1;
    if (tapTimer.current) clearTimeout(tapTimer.current);
    if (tapCount.current >= 15) {
      tapCount.current = 0;
      tapTimer.current = null;
      setAdminVisible(true);
      return;
    }
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0;
      tapTimer.current = null;
    }, 5000);
  }

  async function sendOtp() {
    if (busy) return;
    const normalized = normalizePhone(phoneInput);
    if (!isValidPhone(normalized)) {
      Alert.alert("رقم الهاتف غير صحيح", "أدخل رقم هاتف عراقي يبدأ بـ 07 ويتكوّن من 11 رقماً.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({
        phone: normalized,
        options: { shouldCreateUser: true, data: { phone: normalized } },
      });
      if (error) throw error;
      setPhoneInput(normalized);
      setStep("otp");
      Alert.alert("تم إرسال الرمز", "أرسلنا رمز التحقق إلى رقم هاتفك.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "تعذّر إرسال رمز التحقق.";
      Alert.alert("تعذّر إرسال الرمز", /sms|phone provider|not configured/i.test(message)
        ? "خدمة الرسائل النصية غير مهيأة في إعدادات Supabase. حاول لاحقاً أو تواصل مع الدعم."
        : message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp() {
    if (busy) return;
    const normalized = normalizePhone(phoneInput);
    const code = toEnglishDigits(otp).replace(/\D/g, "");
    if (!isValidPhone(normalized)) {
      setStep("phone");
      Alert.alert("رقم الهاتف غير صحيح", "أعد إدخال رقم هاتف عراقي صحيح.");
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      Alert.alert("رمز غير مكتمل", "أدخل رمز التحقق المكوّن من 6 أرقام.");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: normalized,
        token: code,
        type: "sms",
      });
      if (error) throw error;
      const userId = data.user?.id ?? data.session?.user.id;
      if (!userId) throw new Error("تم التحقق لكن تعذّر تحميل الحساب. حاول تسجيل الدخول مرة أخرى.");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id,full_name")
        .eq("id", userId)
        .maybeSingle();
      if (profileError) throw profileError;

      await refresh();
      if (!profile || !String(profile.full_name ?? "").trim()) {
        router.replace("/complete-profile");
      } else {
        router.replace("/");
      }
    } catch (error) {
      Alert.alert("فشل التحقق", error instanceof Error ? error.message : "رمز التحقق غير صحيح أو منتهي الصلاحية.");
    } finally {
      setBusy(false);
    }
  }

  async function signInAdmin() {
    if (adminBusy) return;
    const email = adminEmail.trim().toLowerCase();
    if (!email || !adminPassword) {
      Alert.alert("بيانات ناقصة", "أدخل بريد الإدارة وكلمة المرور.");
      return;
    }
    setAdminBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password: adminPassword });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) throw new Error("تعذّر تحديد حساب الإدارة.");

      const { data: adminRole, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .eq("role", "admin")
        .maybeSingle();

      if (roleError || !adminRole) {
        await supabase.auth.signOut();
        throw new Error("هذا الحساب لا يملك صلاحية الإدارة. تم تسجيل الخروج.");
      }

      await refresh();
      setAdminVisible(false);
      setAdminPassword("");
      router.replace("/admin");
    } catch (error) {
      Alert.alert("تعذّر دخول الإدارة", error instanceof Error ? error.message : "بيانات الدخول غير صحيحة.");
    } finally {
      setAdminBusy(false);
    }
  }

  const brandMark = logoUrl
    ? <Image source={{ uri: logoUrl }} style={styles.companyLogo} resizeMode="contain" />
    : <LinearGradient colors={[palette.brand, palette.brandGlow]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.brandMark}><Text style={styles.brandLetter}>م</Text></LinearGradient>;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.brandTop}>
            {welcomeVisualUrl ? <ExpoImage source={{ uri: welcomeVisualUrl }} style={styles.companyWelcomeVisual} contentFit="contain" autoplay={welcomeVisualAnimated} /> : null}
            <Pressable onPress={handleLogoTap} accessibilityRole="image" accessibilityLabel="شعار ممنون">
              {brandMark}
            </Pressable>
            <Text style={styles.brandName}>{companyName}</Text>
            <Text style={styles.brandCaption}>{welcomeMessage}</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.heading}>{step === "phone" ? "تسجيل الدخول برقم الهاتف" : "تأكيد رقم الهاتف"}</Text>
            <Text style={styles.description}>{step === "phone"
              ? "أدخل رقم هاتفك العراقي وسنرسل لك رمز تحقق برسالة نصية."
              : "أدخل رمز التحقق الذي وصل برسالة نصية إلى رقمك."}</Text>

            {step === "phone" ? (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>رقم الهاتف العراقي</Text>
                <View style={styles.inputWrap}>
                  <RealInput
                    value={phoneInput}
                    onChangeText={(value) => setPhoneInput(toEnglishDigits(value))}
                    placeholder="07XXXXXXXXX"
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    maxLength={18}
                    style={styles.input}
                  />
                </View>
                <Text style={styles.hint}>سيُحوّل الرقم تلقائياً إلى الصيغة الدولية ‎+964 عند الإرسال</Text>
              </View>
            ) : (
              <>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>رقم الهاتف</Text>
                  <Text style={styles.phoneValue}>{normalizePhone(phoneInput)}</Text>
                </View>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>رمز التحقق</Text>
                  <RealInput
                    value={otp}
                    onChangeText={(value) => setOtp(toEnglishDigits(value).replace(/\D/g, "").slice(0, 6))}
                    placeholder="------"
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="sms-otp"
                    maxLength={6}
                    style={[styles.input, styles.otpInput]}
                  />
                </View>
                <Pressable onPress={() => { setStep("phone"); setOtp(""); }} style={styles.textAction}>
                  <Text style={styles.textActionLabel}>تغيير رقم الهاتف</Text>
                </Pressable>
              </>
            )}

            <Button
              title={busy ? "جارٍ المتابعة..." : step === "phone" ? "إرسال رمز التحقق" : "تأكيد الرمز والدخول"}
              onPress={step === "phone" ? sendOtp : verifyOtp}
              loading={busy}
              style={styles.submit}
            />
            {step === "otp" ? (
              <Pressable onPress={sendOtp} disabled={busy} style={styles.resend}>
                <Text style={styles.textActionLabel}>إعادة إرسال الرمز</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {APP_VARIANT === "customer" ? (
        <Modal visible={adminVisible} transparent animationType="fade" onRequestClose={() => setAdminVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.adminCard}>
              <Text style={styles.adminTitle}>دخول الإدارة</Text>
              <Text style={styles.adminDescription}>هذه الواجهة مخصصة لحسابات الإدارة المصرّح بها فقط.</Text>
              <RealInput value={adminEmail} onChangeText={setAdminEmail} placeholder="البريد الإلكتروني" keyboardType="email-address" autoCapitalize="none" autoComplete="email" style={styles.input} />
              <RealInput value={adminPassword} onChangeText={setAdminPassword} placeholder="كلمة المرور" secureTextEntry autoCapitalize="none" style={[styles.input, styles.adminPassword]} />
              <Button title="دخول لوحة الإدارة" onPress={signInAdmin} loading={adminBusy} style={styles.submit} />
              <Pressable onPress={() => { setAdminVisible(false); setAdminPassword(""); }} style={styles.cancelAdmin}>
                <Text style={styles.textActionLabel}>إلغاء</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.pageCanvas },
  flex: { flex: 1 },
  content: { flexGrow: 1, width: "100%", maxWidth: 480, alignSelf: "center", paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.xxl },
  brandTop: { alignItems: "center", paddingBottom: 28 },
  companyWelcomeVisual: { width: "100%", maxWidth: 320, height: 140, marginBottom: 12 },
  companyLogo: { width: 88, height: 88, borderRadius: 24, backgroundColor: "#FFFFFF", marginBottom: 6 },
  brandMark: { width: 80, height: 80, borderRadius: 24, alignItems: "center", justifyContent: "center", shadowColor: palette.brand, shadowOpacity: 0.2, shadowRadius: 18, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  brandLetter: { color: palette.white, fontSize: 34, fontWeight: "900" },
  brandName: { color: palette.ink, fontSize: 36, fontWeight: "900", marginTop: 12, letterSpacing: -0.5, width: "100%", maxWidth: 320, textAlign: "center", lineHeight: 44, flexShrink: 1 },
  brandCaption: { color: palette.muted, fontSize: 13, fontWeight: "600", marginTop: 7, width: "100%", maxWidth: 320, textAlign: "center", lineHeight: 24, flexShrink: 1 },
  form: { flex: 1 },
  heading: { color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "center", marginBottom: 8 },
  description: { color: palette.muted, fontSize: 13, fontWeight: "600", lineHeight: 23, textAlign: "center", marginBottom: 24 },
  field: { marginBottom: 18 },
  fieldLabel: { color: palette.ink, fontSize: 14, fontWeight: "800", marginBottom: 10 },
  inputWrap: { position: "relative", justifyContent: "center" },
  input: { minHeight: 62, borderRadius: 12, paddingHorizontal: 16, textAlign: "left", fontSize: 17, borderColor: palette.line, backgroundColor: palette.surfaceSoft },
  otpInput: { textAlign: "center", letterSpacing: 10, fontSize: 22, fontWeight: "900" },
  phoneValue: { color: palette.ink, fontSize: 17, fontWeight: "800", textAlign: "center", paddingVertical: 14, backgroundColor: palette.surfaceSoft, borderRadius: 12 },
  hint: { color: palette.muted, fontSize: 11, fontWeight: "600", marginTop: 8, lineHeight: 18 },
  submit: { width: "100%", minHeight: 56, borderRadius: 12, marginTop: 8 },
  textAction: { alignSelf: "flex-start", paddingVertical: 8, marginTop: -8, marginBottom: 6 },
  textActionLabel: { color: palette.brand, fontSize: 13, fontWeight: "800" },
  resend: { alignSelf: "center", padding: 14 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", padding: 24 },
  adminCard: { width: "100%", maxWidth: 420, alignSelf: "center", backgroundColor: palette.surface, borderRadius: 18, padding: 22, borderWidth: 1, borderColor: palette.line },
  adminTitle: { color: palette.ink, fontSize: 20, fontWeight: "900", textAlign: "center", marginBottom: 8 },
  adminDescription: { color: palette.muted, fontSize: 12, lineHeight: 20, textAlign: "center", marginBottom: 18 },
  adminPassword: { marginTop: 12 },
  cancelAdmin: { alignSelf: "center", padding: 12 },
});
