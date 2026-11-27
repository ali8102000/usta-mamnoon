# نظام الملاحة والتتبع الحي — ممنون

## النسخ
- customer: يستقبل بث المزود ويقرأ المسار من request_navigation.
- captain: يحسب مسار الاستلام ثم مسار الوجهة.
- naqil: نفس مرحلتي الكابتن مع أيقونة الشاحنة.
- usta: ملاحة إلى الزبون، ثم service_work. زر الورشة اختياري.

## الملفات
- src/lib/live-navigation.ts: فك polyline وحساب المسافة وتحويل استجابة maps-proxy.
- src/components/LiveNavigationScreen.tsx: الخريطة والطبقات والمركبة والبطاقة والبث.

## الربط
مرر requestId وrole وpickup وdestination إلى LiveNavigationScreen من شاشة الطلب النشط.
يجب أن تكون إحداثيات pickup/destination بالشكل { latitude, longitude }.
استخدم الشاشة ضمن جذر الشاشة النشط (بدون Header أو حاوية تحد من الارتفاع).

## ملاحظات تشغيلية مهمة
1. الخرائط تستعمل maps-proxy، ومفتاح Google يبقى في أسرار Edge Function.
2. live_locations هو سجل آخر موقع، وrequest_navigation يخزن هندسة الطريق وتعليماته.
3. القناة trip_tracking:<requestId> ترسل تحديثات الموقع كل 3 ثوانٍ.
4. إعادة حساب الطريق عند الانحراف فوق 50 متراً أو مرور 30 ثانية.
5. هذا الإصدار يشغّل watchPositionAsync أثناء وجود شاشة الملاحة في المقدمة. تشغيل الموقع بعد إغلاق الشاشة/قتل التطبيق يحتاج تفعيل Background Location في إعدادات Expo Android وإعداد مهمة TaskManager مستقلة واختبار إشعار Foreground Service على جهاز حقيقي؛ لا تعتبره مضموناً بمجرد تشغيل هذا المكوّن.
6. زر الورشة يستدعي onWorkshopDestination. يجب على الشاشة المستضيفة فتح اختيار الوجهة ثم تمرير الإحداثيات الجديدة وتحديث phase إلى to_workshop قبل استدعاء maps-proxy.
7. لا يكتب العميل إلى جدول request_navigation ولا يطلب Google Routes مباشرة.

## خطوات الدمج
- استدع الشاشة من route الطلب النشط بعد تأكيد أن الطلب accepted أو in_progress.
- لا تحذف شاشة الطلب القديمة أو تدفق الدفع/إكمال الطلب؛ استبدل جزء الخريطة فقط.
- اختبر بحساب زبون وحساب مزود مرتبطين بالطلب نفسه.
