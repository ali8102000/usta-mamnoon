# نظام الملاحة والتتبع الحي — ممنون

## عزل النسخ
- `mamnoon`: customer، ويضم الإدارة.
- `usta-mamnoon`: worker / usta.
- `captain-mamnoon`: driver / captain.
- `naql-mamnoon`: large_driver / naqil.
- لكل تطبيق bundle id وscheme وEAS projectId مستقل؛ لا تنقل إعدادات أو هوية نسخة إلى الأخرى.

## مصدر الموقع الوحيد
صفحة الطلب النشط `app/request/[id].tsx` هي المالك الوحيد لـ GPS:
- تشغّل foreground location وBackground Location الموجودين مسبقاً.
- تكتب إلى `live_locations` و`trip_location_points`.
- تستقبل الطرف الآخر عبر Supabase Realtime.
- لا تشغّل شاشة الملاحة مراقب GPS إضافياً ولا تكتب نسخة ثانية من الموقع.

## ملفات الملاحة
- `src/lib/live-navigation.ts`: فك polyline وحساب المسافة وتحويل استجابة `maps-proxy`.
- `src/components/LiveNavigationScreen.tsx`: واجهة ملاحة مستقلة قيد الدمج، لا تُركّب حالياً فوق خريطة الطلب القديمة.
- الشاشة عند ربطها يجب أن تستقبل `requestId`, `role`, `pickup`, `destination`, و`liveLocation` و`liveHeading` من صفحة الطلب؛ لا تطلب GPS بنفسها.
- الزبون يقرأ المسار من `request_navigation` ويستقبل تحديثات المزود؛ لا يستدعي Google Routes.

## منع التداخل
1. لا تعرض `LiveNavigationScreen` وخريطة `acceptedMapMode` معاً؛ يجب استبدال طبقة الخريطة فقط بعد توصيل أزرار الطلب والدردشة والدفع والإكمال.
2. لا تضف `watchPositionAsync` أو upsert إلى `live_locations` داخل شاشة الملاحة؛ صفحة الطلب هي مصدر GPS الوحيد.
3. لا تغيّر `APP_VARIANT` أو `bundleIdentifier` أو `android.package` أو `scheme` أو `eas.projectId` الخاص بكل نسخة.
4. لا تنشئ جدول `orders`؛ الطلبات في `service_requests`.
5. خرائط Google تمر عبر Edge Function `maps-proxy`؛ لا تضع مفتاح Google داخل التطبيق.
6. أعد حساب الطريق عند الانحراف فوق 50 متراً أو مرور 30 ثانية.
7. الأسطة يتوقف عند الوصول ويتحول إلى `service_work`؛ لا يُرسل إلى وجهة افتراضية. خيار الورشة يحتاج منتقي وجهة حقيقي من الشاشة المستضيفة.

## حالة التحقق
- فحوصات TypeScript وAPP_VARIANT/role isolation تُشغّل عبر GitHub Actions على كل مستودع بشكل مستقل.
- نجاح CI لا يثبت تشغيل GPS بالخلفية أو الملاحة بين جهازين؛ يلزم اختبار فعلي على جهازين قبل إصدار APK.
