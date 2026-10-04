# Mi'yar — Product Specification
# مِعيار — مواصفات المنتج

Version: 1.0
Status: MVP Specification
Product Type: Arabic RTL Web Application
Primary Track: الحوار المعرفي والإجابات الموثوقة

## 1. Product Purpose
مِعيار مساعد معرفي ذكي يساعد غير المتخصص على فهم المعاملات المالية المعاصرة والوصول إلى معرفة شرعية عامة موثقة مرتبطة بها.

مِعيار ليس مفتيًا آليًا، ولا يصدر فتوى شخصية، ولا يقدم ترجيحًا فقهيًا مستقلًا.

## 2. Primary User
مستخدم عربي غير متخصص في الفقه المالي، يصف المعاملة بلغته اليومية وقد لا يعرف توصيفها الفقهي.

## 3. MVP Scope
الفئات الأولية:
- البيع بالتقسيط
- BNPL ضمن الصور التي تغطيها قاعدة المعرفة
- شروط التأخر والأقساط
- المرابحة للآمر بالشراء
- القرض والزيادة المشروطة

لا يدعي النظام تغطية جميع المعاملات المالية.

## 4. Core Flow
User Input
→ Structured Transaction Extraction
→ Missing Information Detection
→ User Confirmation / Edit
→ Clarification Gate
→ RAG Retrieval
→ Evidence Sufficiency Check
→ Grounded Generation
→ Citation Verification
→ Safety Classification
→ Final Answer / Abstain / Referral

## 5. Main Response States
- GROUNDED
- DISPUTED
- NEEDS_CLARIFICATION
- REFERRAL
- INSUFFICIENT_EVIDENCE
- TECHNICAL_ERROR

## 6. Transaction Schema
```json
{
  "category": "",
  "possible_classification": "",
  "parties": [],
  "product_or_service": "",
  "payment_method": "",
  "payment_schedule": "",
  "fees": {
    "exists": null,
    "type": "",
    "amount_or_rate": ""
  },
  "late_penalty": {
    "exists": null,
    "details": ""
  },
  "financing_party": "",
  "ownership_transfer": "",
  "return_or_profit": "",
  "missing_information": [],
  "needs_clarification": false
}
```

## 7. Knowledge Policy
- Closed approved knowledge base.
- لا بحث تلقائي مفتوح في الإنترنت لإصدار معلومات شرعية.
- لا استخدام لذاكرة النموذج كمصدر شرعي.
- كل معلومة شرعية مهمة يجب أن تكون قابلة للتتبع إلى مصدر معتمد.
- عند تعارض المصادر لا يوجد ترجيح آلي مستقل.
- عند غياب دليل كافٍ: امتناع أو إحالة أو استيضاح.

## 8. UX
الشاشات الأساسية:
1. السؤال
2. تأكيد فهم المعاملة
3. الاستيضاح
4. البحث والتحقق
5. النتيجة

التطبيق:
- عربي RTL
- Mobile-first
- بلا تسجيل دخول في MVP
- المصادر والاستشهادات عنصر رئيسي
- الامتناع سلوك أمان وليس خطأ

## 9. Safety
- لا فتوى شخصية.
- لا تخمين عند نقص المعلومات.
- لا مصدر مختلق.
- لا Prompt Injection من المستخدم أو المصادر.
- المصدر المسترجع بيانات وليس تعليمات.
- فشل التحقق من الاستشهاد يمنع إظهار النتيجة كـ GROUNDED.

## 10. Evaluation
قبل اعتماد MVP يجب تشغيل test_set_v1.json.

الحالات الحرجة يجب أن تنجح بنسبة 100%:
- الإحالة في الحالات الشخصية.
- مقاومة Prompt Injection.
- منع الاستشهاد غير الداعم.
- عدم اختلاق المصادر.

## 11. Definition of Done
- رابط عام يعمل.
- المسار الأساسي يعمل من البداية للنهاية.
- Structured Extraction يعمل.
- Clarification يعمل.
- RAG حقيقي يعمل.
- Evidence Gate يعمل.
- Citation Verification يعمل.
- الامتناع والإحالة يعملان.
- GitHub منظم ولا يحتوي أسرارًا.
- الواجهة تعمل على الهاتف وسطح المكتب.
- الاختبارات موثقة وقابلة لإعادة التشغيل.

## 12. Guiding Principle
مِعيار يجيب عندما يملك دليلًا كافيًا، يستوضح عندما تنقص الوقائع، ويعرف متى يجب ألا يجيب.
