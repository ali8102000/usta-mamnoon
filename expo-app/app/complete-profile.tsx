import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { normalizePhone } from "@/lib/phone";
import { Button, RealInput } from "@/components/ui";
import { palette, space } from "@/styles/theme";

export default function CompleteProfileScreen() {
  const { user, refresh } = useAuth();
  const [fullName, setFullName] = useState(String(user?.user_metadata?.full_name ?? ""));
  const [busy, setBusy] = useState(false);

  async function saveProfile() {
    if (busy) return;
    const name = fullName.trim().replace(/\s+/g, " ");
    if (name.length < 2) {
      Alert.alert("الاسم مطلوب", "اكتب اسمك الكامل حتى نكمل إنشاء الحساب.");
      return;
    }
    if (!user?.id) {
      Alert.alert("الجلسة غير موجودة", "ارجع وسجّل الدخول برقم هاتفك مرة ثانية.");
      router.replace("/auth");
      return;
    }

    setBusy(true);
    try {
      const { data: existing, error: readError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", user.id)
        .maybeSingle();
      if (readError) throw readError;

      if (existing) {
        const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
        if (error) throw error;
      } else {
        const phone = normalizePhone(String(user.phone ?? user.user_metadata?.phone ?? ""));
        if (!phone) throw new Error("تعذّر تحديد رقم الهاتف المرتبط بالحساب.");
        const { error } = await supabase.from("profiles").insert({ id: user.id, phone, full_name: name });
        if (error) throw error;
      }

      const { error: metadataError } = await supabase.auth.updateUser({ data: { full_name: name } });
      if (metadataError) throw metadataError;
      await refresh();
      router.replace("/");
    } catch (error) {
      Alert.alert("تعذّر حفظ البيانات", error instanceof Error ? error.message : "حاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.content}>
          <Text style={styles.title}>إكمال بيانات الحساب</Text>
          <Text style={styles.description}>اكتب اسمك الكامل مرة واحدة. بعد الحفظ نفتح لك التطبيق المناسب لحسابك.</Text>
          <Text style={styles.label}>الاسم الكامل</Text>
          <RealInput value={fullName} onChangeText={setFullName} placeholder="الاسم الثلاثي أو الكامل" autoCapitalize="words" textContentType="name" maxLength={100} style={styles.input} />
          <Button title="حفظ ومتابعة" onPress={saveProfile} loading={busy} style={styles.submit} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.pageCanvas },
  flex: { flex: 1 },
  content: { flex: 1, width: "100%", maxWidth: 480, alignSelf: "center", justifyContent: "center", paddingHorizontal: space.xl },
  title: { color: palette.ink, fontSize: 24, fontWeight: "900", textAlign: "center", marginBottom: 12 },
  description: { color: palette.muted, fontSize: 14, lineHeight: 24, textAlign: "center", marginBottom: 30 },
  label: { color: palette.ink, fontSize: 14, fontWeight: "800", marginBottom: 10 },
  input: { minHeight: 60, borderRadius: 12, paddingHorizontal: 16, textAlign: "right", fontSize: 16, borderColor: palette.line, backgroundColor: palette.surfaceSoft },
  submit: { width: "100%", minHeight: 56, borderRadius: 12, marginTop: 20 },
});
