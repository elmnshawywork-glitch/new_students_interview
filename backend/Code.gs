/**
 * نظام امتحانات ومقابلات قبول الطلاب — المدارس التكنولوجية التطبيقية
 * Backend (Google Apps Script) — يحوّل Google Sheet إلى API ويقوم بالتصحيح الآلي.
 *
 * الإعداد:
 *   1) افتح Google Sheet الخاص بك > Extensions > Apps Script.
 *   2) الصق هذا الملف (Code.gs) وملف Passages.gs.
 *   3) شغّل الدالة setup() مرة واحدة (تنشئ التبويبات وحساب المدير وتزرع القطع).
 *   4) Deploy > New deployment > Web app > Execute as: Me > Who has access: Anyone.
 *   5) انسخ رابط الـ Web app وضعه في frontend/config.js (BACKEND_URL).
 *   6) لتفعيل تصحيح الـ AI: Project Settings > Script Properties > أضف ANTHROPIC_API_KEY.
 *
 * ملاحظة أمان: كلمات المرور مخزّنة كنص هنا (نموذج أولي). فعّل التجزئة (hashing) قبل الإنتاج.
 */

var API_VERSION = '2023-06-01';
var GRADING_MODEL = 'claude-haiku-4-5';   // بدّله بـ claude-sonnet-4-5 لدقة ترجمة أعلى
var API_URL = 'https://api.anthropic.com/v1/messages';

// معرّف Google Sheet الخاص بك (من رابط الشيت).
// إن ربطت السكربت بالشيت مباشرة (Extensions ← Apps Script) يمكن تركه كما هو أو جعله '' .
var SHEET_ID = '1pTsSBYXpm2kYX3Z2OU4qtsx2ogN00qaBgFYMCQpIp7I';
function ss_() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

/* =========================================================================
 * SHEET SCHEMA
 * ========================================================================= */
var SHEETS = {
  Users:      ['username', 'password', 'name', 'role', 'createdAt'],
  Config:     ['key', 'value'],
  Students:   ['nationalId', 'name', 'school', 'studentPhone', 'guardianPhone', 'email', 'createdAt'],
  UnitGrades: ['nationalId', 'name', 'grade'],
  LangResults:['nationalId', 'enListenId', 'enListenScore', 'translateId', 'translateScore', 'arListenId', 'arListenScore', 'langTotal', 'feedback', 'answers', 'timestamp'],
  Interviews: ['nationalId', 'evaluator', 'role', 'scores', 'avg', 'timestamp'],
  Passages:   ['id', 'lang', 'text', 'ref_ar', 'level'],
  Retakes:    ['nationalId', 'by', 'timestamp']
};

var DEFAULT_CONFIG = {
  unitTotalGrade: '100',
  unitPassGrade: '50',
  unitPassMandatory: 'false',
  excelImportEnabled: 'false',
  indicatorMax: '10',
  indicators: JSON.stringify([
    'الثقة بالنفس ووضوح التعبير والتواصل',
    'الدافعية والميل نحو المجال الفني/التكنولوجي',
    'القدرة على التفكير وحل المشكلات وسرعة البديهة',
    'المظهر العام',
    'قدرة الطالب على التعامل مع التكنولوجيا (حاسب آلي/ذكاء اصطناعي)',
    'العمل ضمن فريق والتواصل مع الآخرين',
    'الالتزام والانضباط وتحمّل المسؤولية',
    'الميول والاستعداد للمجال المهني واليدوي'
  ]),
  weightInterview: '50',
  weightUnit: '30',
  weightLang: '20',
  acceptanceScore: '60',
  schools: JSON.stringify([
    'مدرسة القاهرة للتكنولوجيا التطبيقية',
    'مدرسة السويس للتكنولوجيا التطبيقية',
    'مدرسة الإسكندرية للتكنولوجيا التطبيقية'
  ]),
  importHeaders: JSON.stringify({
    name: 'الاسم', nationalId: 'الرقم القومي', school: 'المدرسة',
    studentPhone: 'موبايل الطالب', guardianPhone: 'موبايل ولي الأمر', email: 'الايميل'
  }),
  voiceEn: '',
  voiceAr: '',
  sentenceGap: '3',
  indicatorWeights: '',
  evaluatorWeights: ''
};

/* =========================================================================
 * SETUP  (شغّلها مرة واحدة)
 * ========================================================================= */
function setup() {
  var ss = ss_();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SHEETS[name]);
      sh.setFrozenRows(1);
    }
  });
  // زرع إعدادات افتراضية
  var cfg = ss.getSheetByName('Config');
  if (cfg.getLastRow() <= 1) {
    Object.keys(DEFAULT_CONFIG).forEach(function (k) {
      cfg.appendRow([k, DEFAULT_CONFIG[k]]);
    });
  }
  // زرع حساب مدير + أعضاء لجنة المقابلة
  var users = ss.getSheetByName('Users');
  if (users.getLastRow() <= 1) {
    users.appendRow(['admin', 'ebda2026', 'مدير البرنامج', 'admin', new Date()]);
    users.appendRow(['ats', '123456', 'ممثل وحدة المدارس التكنولوجية', 'committee', new Date()]);
    users.appendRow(['aca', '123456', 'ممثل الشريك الأكاديمي', 'committee', new Date()]);
    users.appendRow(['ind', '123456', 'ممثل الشريك الصناعي', 'committee', new Date()]);
  }
  // زرع بنك القطع
  seedPassages_();
  // حذف الورقة الافتراضية Sheet1 إن كانت فارغة
  var s1 = ss.getSheetByName('Sheet1');
  if (s1 && s1.getLastRow() === 0) ss.deleteSheet(s1);
  SpreadsheetApp.getUi && Logger.log('Setup complete. Admin: admin / ebda2026');
}

function seedPassages_() {
  var sh = ss_().getSheetByName('Passages');
  if (sh.getLastRow() > 1) return; // مزروعة بالفعل
  var rows = PASSAGES.map(function (p) {
    return [p.id, p.lang, p.text, p.ref_ar || '', p.level || 'easy'];
  });
  if (rows.length) sh.getRange(2, 1, rows.length, 5).setValues(rows);
}

/* =========================================================================
 * ROUTING
 * ========================================================================= */
function doGet(e) {
  return json_({ ok: true, service: 'applied-tech-admissions', version: 1 });
}

function doPost(e) {
  var req = {};
  try { req = JSON.parse(e.postData.contents); } catch (err) {}
  var action = req.action || '';
  var WRITES = { setConfig:1, createUser:1, deleteUser:1, registerStudent:1, importStudents:1, setUnitGrade:1, importUnitGrades:1, gradeExam:1, submitInterview:1, resetLangExam:1 };
  if (WRITES[action]) bustCache_();
  try {
    switch (action) {
      case 'login':           return json_(login_(req));
      case 'getConfig':       return json_({ ok: true, config: getConfig_() });
      case 'setConfig':       return json_(setConfig_(req));
      case 'listUsers':       return json_({ ok: true, users: listUsers_() });
      case 'createUser':      return json_(createUser_(req));
      case 'deleteUser':      return json_(deleteUser_(req));
      case 'listStudents':    return json_({ ok: true, students: listStudents_() });
      case 'registerStudent': return json_(registerStudent_(req));
      case 'importStudents':  return json_(importStudents_(req));
      case 'getStudent':      return json_(getStudent_(req));
      case 'setUnitGrade':    return json_(setUnitGrade_(req));
      case 'importUnitGrades':return json_(importUnitGrades_(req));
      case 'startExam':       return json_(startExam_(req));
      case 'gradeExam':       return json_(gradeExam_(req));
      case 'resetLangExam':   return json_(resetLangExam_(req));
      case 'getLangAnswers':  return json_(getLangAnswers_(req));
      case 'submitInterview': return json_(submitInterview_(req));
      case 'getResult':       return json_(getResult_(req));
      case 'listResults':     return json_({ ok: true, results: listResults_() });
      case 'bootstrap':       return json_(bootstrap_());
      case 'exportResultsSheet': return json_(exportResultsSheet_(req));
      default:                return json_({ ok: false, error: 'إجراء غير معروف: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  }
}

/* =========================================================================
 * DATA HELPERS
 * ========================================================================= */
function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) {                                   // إنشاء التبويب تلقائيًا لو غير موجود
    sh = ss_().insertSheet(name);
    if (SHEETS[name]) sh.appendRow(SHEETS[name]);
  }
  return sh;
}

function readAll_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function findRowIndex_(name, key, value) {
  var sh = sheet_(name);
  var col = SHEETS[name].indexOf(key) + 1;
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var vals = sh.getRange(2, col, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(value)) return i + 2; // رقم الصف الفعلي
  }
  return -1;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* =========================================================================
 * AUTH & USERS
 * ========================================================================= */
function login_(req) {
  var u = readAll_('Users').filter(function (x) {
    return String(x.username) === String(req.username) && String(x.password) === String(req.password);
  })[0];
  if (!u) return { ok: false, error: 'اسم المستخدم أو كلمة المرور غير صحيحة' };
  return { ok: true, user: { username: u.username, name: u.name, role: u.role } };
}

function requireAdmin_(req) {
  var u = readAll_('Users').filter(function (x) {
    return String(x.username) === String(req.username) && String(x.password) === String(req.password) && x.role === 'admin';
  })[0];
  if (!u) throw new Error('هذه العملية تتطلب صلاحية مدير البرنامج');
  return u;
}

function listUsers_() {
  return readAll_('Users').map(function (u) {
    return { username: u.username, name: u.name, role: u.role };
  });
}

function createUser_(req) {
  requireAdmin_(req);
  if (!req.newUsername || !req.newPassword) return { ok: false, error: 'اسم المستخدم وكلمة المرور مطلوبان' };
  if (findRowIndex_('Users', 'username', req.newUsername) !== -1)
    return { ok: false, error: 'اسم المستخدم موجود بالفعل' };
  var role = req.role || 'committee';
  sheet_('Users').appendRow([req.newUsername, req.newPassword, req.name || req.newUsername, role, new Date()]);
  return { ok: true };
}

function deleteUser_(req) {
  requireAdmin_(req);
  if (req.target === 'admin') return { ok: false, error: 'لا يمكن حذف حساب المدير الأساسي' };
  var idx = findRowIndex_('Users', 'username', req.target);
  if (idx === -1) return { ok: false, error: 'المستخدم غير موجود' };
  sheet_('Users').deleteRow(idx);
  return { ok: true };
}

/* =========================================================================
 * CONFIG
 * ========================================================================= */
function getConfig_() {
  var rows = readAll_('Config');
  var cfg = {};
  rows.forEach(function (r) { cfg[r.key] = String(r.value); });
  Object.keys(DEFAULT_CONFIG).forEach(function (k) { if (!(k in cfg)) cfg[k] = DEFAULT_CONFIG[k]; });
  return cfg;
}

function setConfig_(req) {
  requireAdmin_(req);
  var updates = req.config || {};
  var sh = sheet_('Config');
  Object.keys(updates).forEach(function (k) {
    var idx = findRowIndex_('Config', 'key', k);
    if (idx === -1) sh.appendRow([k, String(updates[k])]);
    else sh.getRange(idx, 2).setValue(String(updates[k]));
  });
  return { ok: true, config: getConfig_() };
}

/* =========================================================================
 * STUDENTS
 * ========================================================================= */
function validNationalId_(id) { return /^\d{6,20}$/.test(String(id).replace(/[^\d]/g,"")); }

function listStudents_() { return readAll_('Students'); }

function registerStudent_(req) {
  var s = req.student || {};
  if (!validNationalId_(s.nationalId)) return { ok: false, error: 'الرقم القومي يجب أن يكون 14 رقمًا' };
  if (!s.name) return { ok: false, error: 'الاسم مطلوب' };
  var idx = findRowIndex_('Students', 'nationalId', s.nationalId);
  var row = [s.nationalId, s.name, s.school || '', s.studentPhone || '', s.guardianPhone || '', s.email || '', new Date()];
  if (idx === -1) sheet_('Students').appendRow(row);
  else sheet_('Students').getRange(idx, 1, 1, row.length).setValues([row]);
  return { ok: true, student: { nationalId: s.nationalId, name: s.name } };
}

function importStudents_(req) {
  requireAdmin_(req);
  var rows = req.rows || [];
  var sh = sheet_('Students');
  var existing = readAll_('Students');
  var rowByNid = {};
  existing.forEach(function (s, i) { rowByNid[String(s.nationalId)] = i + 2; }); // رقم الصف الفعلي
  var toAppend = [], added = 0, updated = 0, skipped = 0;
  var seenNew = {};
  var gradeUpserts = [];
  rows.forEach(function (s) {
    var nid = String(s.nationalId || '').replace(/[^\d]/g, '');
    if (!validNationalId_(nid) || !s.name) { skipped++; return; }
    var row = [nid, String(s.name).trim(), s.school || '', s.studentPhone || '', s.guardianPhone || '', s.email || '', new Date()];
    var rn = rowByNid[nid];
    if (rn) { sh.getRange(rn, 1, 1, row.length).setValues([row]); updated++; }
    else if (seenNew[nid] != null) { toAppend[seenNew[nid]] = row; }
    else { seenNew[nid] = toAppend.length; toAppend.push(row); added++; }
    if (s.unitGrade !== '' && s.unitGrade != null && !isNaN(Number(s.unitGrade))) {
      gradeUpserts.push({ nationalId: nid, name: String(s.name).trim(), grade: Number(s.unitGrade) });
    }
  });
  if (toAppend.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, toAppend.length, 7).setValues(toAppend);
  }
  if (gradeUpserts.length) importUnitGrades_({ username: req.username, password: req.password, rows: gradeUpserts, _internal: true });
  return { ok: true, added: added, updated: updated, skipped: skipped, grades: gradeUpserts.length };
}

function getStudent_(req) {
  var s = readAll_('Students').filter(function (x) { return String(x.nationalId) === String(req.nationalId); })[0];
  if (!s) return { ok: false, error: 'الطالب غير مسجّل' };
  return { ok: true, student: s };
}

/* =========================================================================
 * UNIT GRADES
 * ========================================================================= */
function setUnitGrade_(req) {
  requireAdmin_(req);
  var idx = findRowIndex_('UnitGrades', 'nationalId', req.nationalId);
  var row = [req.nationalId, req.name || '', Number(req.grade) || 0];
  if (idx === -1) sheet_('UnitGrades').appendRow(row);
  else sheet_('UnitGrades').getRange(idx, 1, 1, 3).setValues([row]);
  return { ok: true };
}

function importUnitGrades_(req) {
  requireAdmin_(req);
  var rows = req.rows || []; // [{nationalId?,name,grade}]
  var students = readAll_('Students');
  var nidByName = {};
  students.forEach(function (s) { nidByName[normalizeName_(s.name)] = String(s.nationalId); });
  var sh = sheet_('UnitGrades');
  var existing = readAll_('UnitGrades');
  var rowByNid = {};
  existing.forEach(function (g, i) { rowByNid[String(g.nationalId)] = i + 2; });
  var toAppend = [], appendIdxByNid = {}, linked = 0, skipped = 0;
  rows.forEach(function (r) {
    var nid = String(r.nationalId || '').trim();
    if (!/^\d{6,20}$/.test(nid) && r.name) { nid = nidByName[normalizeName_(r.name)] || ''; } // ربط بالاسم
    if (!nid) { skipped++; return; }
    var row = [nid, r.name || '', Number(r.grade) || 0];
    var rn = rowByNid[nid];
    if (rn) { sh.getRange(rn, 1, 1, 3).setValues([row]); }
    else if (appendIdxByNid[nid] != null) { toAppend[appendIdxByNid[nid]] = row; }
    else { appendIdxByNid[nid] = toAppend.length; toAppend.push(row); }
    linked++;
  });
  if (toAppend.length) {
    var start = sh.getLastRow() + 1;
    sh.getRange(start, 1, toAppend.length, 3).setValues(toAppend);
  }
  return { ok: true, linked: linked, skipped: skipped };
}

// توحيد الاسم العربي للربط (إزالة تشكيل + توحيد الألف/الياء/التاء المربوطة + المسافات)
function normalizeName_(s) {
  s = String(s || '');
  s = s.replace(/[\u064B-\u0652]/g, '');
  s = s.replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function getUnitGrade_(nationalId) {
  var g = readAll_('UnitGrades').filter(function (x) { return String(x.nationalId) === String(nationalId); })[0];
  return g ? Number(g.grade) : null;
}

/* =========================================================================
 * LANGUAGE EXAM
 * ========================================================================= */
function getPassages_() { return readAll_('Passages'); }

function pick_(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function startExam_(req) {
  // منع تكرار الامتحان: إن وُجدت نتيجة سابقة يُمنع إلا إذا أعاد المدير فتحه (resetLangExam)
  var prev = readAll_('LangResults').filter(function (x) { return String(x.nationalId) === String(req.nationalId); })[0];
  if (prev) return { ok: false, blocked: true, taken: true, error: 'سبق للطالب أداء الامتحان اللغوي، ولا يُسمح بأدائه أكثر من مرة.' };

  // شرط النجاح في امتحان الوحدة (إن كان إجباريًا)
  var cfg = getConfig_();
  if (cfg.unitPassMandatory === 'true') {
    var grade = getUnitGrade_(req.nationalId);
    if (grade === null) return { ok: false, blocked: true, error: 'لا توجد درجة امتحان وحدة مسجّلة لهذا الطالب' };
    if (grade < Number(cfg.unitPassGrade)) {
      return { ok: false, blocked: true, error: 'الطالب لم يجتز درجة النجاح في امتحان الوحدة (' + cfg.unitPassGrade + ')' };
    }
  }
  var all = getPassages_();
  var en = all.filter(function (p) { return p.lang === 'en'; });
  var tr = all.filter(function (p) { return p.lang === 'tr'; });
  if (!tr.length) tr = en;                 // احتياطي
  var ar = all.filter(function (p) { return p.lang === 'ar'; });
  var enListen = pick_(en);
  var translate = pick_(tr);               // قطعة الترجمة من مجموعة الـ5 جمل
  var arListen = pick_(ar);
  return {
    ok: true,
    exam: {
      enListen:  { id: enListen.id, text: enListen.text },     // النص للنطق الصوتي (TTS)
      translate: { id: translate.id, text: translate.text },   // يُعرض ليترجمه الطالب
      arListen:  { id: arListen.id, text: arListen.text }
    }
  };
}

function passageById_(id) {
  return getPassages_().filter(function (p) { return String(p.id) === String(id); })[0];
}

function gradeExam_(req) {
  var enP = passageById_(req.enListenId);
  var trP = passageById_(req.translateId);
  var arP = passageById_(req.arListenId);

  var enScore = scoreTranscription_(enP ? enP.text : '', req.enListenAnswer || '');
  var arScore = scoreTranscription_(arP ? arP.text : '', req.arListenAnswer || '');
  var trResult = scoreTranslation_(trP, req.translateAnswer || '');

  // محاولة تحسين الدرجات عبر الذكاء الاصطناعي (إن توفّر مفتاح)
  var feedback = '';
  var ai = aiGrade_(enP, req.enListenAnswer, trP, req.translateAnswer, arP, req.arListenAnswer);
  if (ai) {
    if (typeof ai.enListen === 'number') enScore = ai.enListen;
    if (typeof ai.translate === 'number') trResult.score = ai.translate;
    if (typeof ai.arListen === 'number') arScore = ai.arListen;
    feedback = ai.feedback || '';
  }

  var langTotal = Math.round((enScore + trResult.score + arScore) / 3);
  var answers = {
    enListen:  { id: req.enListenId, text: enP ? enP.text : '', answer: req.enListenAnswer || '', score: enScore },
    translate: { id: req.translateId, text: trP ? trP.text : '', ref: trP ? trP.ref_ar : '', answer: req.translateAnswer || '', score: trResult.score },
    arListen:  { id: req.arListenId, text: arP ? arP.text : '', answer: req.arListenAnswer || '', score: arScore }
  };
  var row = [req.nationalId, req.enListenId, enScore, req.translateId, trResult.score,
             req.arListenId, arScore, langTotal, feedback, JSON.stringify(answers), new Date()];
  var idx = findRowIndex_('LangResults', 'nationalId', req.nationalId);
  if (idx === -1) sheet_('LangResults').appendRow(row);
  else sheet_('LangResults').getRange(idx, 1, 1, row.length).setValues([row]);

  return {
    ok: true,
    scores: { enListen: enScore, translate: trResult.score, arListen: arScore, langTotal: langTotal },
    feedback: feedback,
    method: ai ? 'ai' : 'auto'
  };
}

// إعادة فتح الامتحان لطالب (مدير فقط) بحذف نتيجته اللغوية
function resetLangExam_(req) {
  requireAdmin_(req);
  var idx = findRowIndex_('LangResults', 'nationalId', req.nationalId);
  if (idx !== -1) sheet_('LangResults').deleteRow(idx);
  var rIdx = findRowIndex_('Retakes', 'nationalId', req.nationalId);
  var row = [req.nationalId, req.username || 'admin', new Date()];
  if (rIdx === -1) sheet_('Retakes').appendRow(row);
  else sheet_('Retakes').getRange(rIdx, 1, 1, 3).setValues([row]);
  return { ok: true };
}

function isUser_(req) {
  return readAll_('Users').some(function (x) {
    return String(x.username) === String(req.username) && String(x.password) === String(req.password);
  });
}

// جلب أسئلة وإجابات المتقدّم لطباعتها (للجنة/الإدارة فقط)
function getLangAnswers_(req) {
  if (!isUser_(req)) return { ok: false, error: 'غير مصرّح' };
  var lr = readAll_('LangResults').filter(function (x) { return String(x.nationalId) === String(req.nationalId); })[0];
  if (!lr) return { ok: false, error: 'لا توجد نتيجة امتحان لغوي لهذا الطالب' };
  var answers = {};
  try { answers = JSON.parse(lr.answers || '{}'); } catch (e) {}
  var s = readAll_('Students').filter(function (x) { return String(x.nationalId) === String(req.nationalId); })[0] || {};
  return {
    ok: true,
    student: { nationalId: req.nationalId, name: s.name || '', school: s.school || '' },
    answers: answers,
    langTotal: Number(lr.langTotal) || 0,
    timestamp: lr.timestamp
  };
}

/* درجة الاستماع/النسخ: تشابه على مستوى الكلمات (متسامح مع أخطاء بسيطة) */
function scoreTranscription_(ref, ans) {
  var a = tokens_(ref), b = tokens_(ans);
  if (!a.length) return 0;
  var bSet = {};
  b.forEach(function (w) { bSet[w] = (bSet[w] || 0) + 1; });
  var hit = 0;
  a.forEach(function (w) { if (bSet[w] > 0) { hit++; bSet[w]--; } });
  return Math.round((hit / a.length) * 100);
}

function scoreTranslation_(passage, ans) {
  if (!passage) return { score: 0 };
  var ref = passage.ref_ar || '';
  var s = scoreTranscription_(ref, ans);
  return { score: s };
}

function tokens_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')                 // إزالة التشكيل والتطويل
    .replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ء/g, '')
    .replace(/[^\u0600-\u06FFa-z0-9\s]/g, ' ')             // إزالة كل علامات الترقيم (فاصلة/نقطة/…)
    .replace(/\s+/g, ' ').trim()
    .split(/\s+/).filter(Boolean);
}

/* التصحيح بالذكاء الاصطناعي عبر Claude API (اختياري) */
function aiGrade_(enP, enAns, trP, trAns, arP, arAns) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return null;
  var prompt =
    'أنت مصحّح امتحان لغوي بسيط لطالب ضعيف منتهٍ من المرحلة الإعدادية. صحّح الأقسام الثلاثة بتسامح مع الأخطاء الإملائية البسيطة.\n' +
    'مهم جدًا في قسم الترجمة: قيّم حسب المعنى والسياق لا حرفيًّا. اقبل المرادفات واختلاف الصياغة وترتيب الكلمات ما دام المعنى العام صحيحًا، ولا تخصم لمجرد اختلاف الألفاظ عن الترجمة المرجعية. ركّز على: هل نقل الطالب المعنى الصحيح لكل جملة؟\n' +
    'في الاستماع الإنجليزي: قيّم حسب المعنى والسياق أيضًا، وتسامح مع الأخطاء الإملائية البسيطة وعلامات الترقيم، ما دامت الكلمات المسموعة قد نُقلت بمعناها.\n' +
    'في الاستماع العربي: لا تحاسب الطالب على التنوين ولا علامات الترقيم (الفاصلة، النقطة، وغيرها) ولا التشكيل؛ قيّم الكلمات ومعناها فقط.\n' +
    'في كل الأقسام: تجاهل تمامًا علامات الترقيم وفواصل الأسطر والكتابة في سطر واحد أو أسطر متعددة؛ العبرة بالكلمات والمعنى فقط، وكن متسامحًا وسخيًّا في التقدير مع الطالب المبتدئ.\n' +
    'أعطِ لكل قسم درجة من 100. أعد النتيجة بصيغة JSON فقط دون أي نص إضافي بالشكل: ' +
    '{"enListen":<0-100>,"translate":<0-100>,"arListen":<0-100>,"feedback":"جملة قصيرة بالعربية"}\n\n' +
    '--- القسم 1: استماع إنجليزي ---\nالنص الأصلي: ' + (enP ? enP.text : '') + '\nما كتبه الطالب: ' + (enAns || '') + '\n\n' +
    '--- القسم 2: ترجمة إلى العربية (قيّم بالمعنى والسياق) ---\nالنص الإنجليزي: ' + (trP ? trP.text : '') + '\nترجمة مرجعية للاسترشاد فقط (ليست إلزامية حرفيًّا): ' + (trP ? trP.ref_ar : '') + '\nترجمة الطالب: ' + (trAns || '') + '\n\n' +
    '--- القسم 3: استماع عربي ---\nالنص الأصلي: ' + (arP ? arP.text : '') + '\nما كتبه الطالب: ' + (arAns || '') + '\n';

  var payload = {
    model: GRADING_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content: prompt }]
  };
  try {
    var res = UrlFetchApp.fetch(API_URL, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': API_VERSION },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() !== 200) return null;
    var data = JSON.parse(res.getContentText());
    var text = (data.content || []).map(function (b) { return b.text || ''; }).join('');
    text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    var m = text.match(/\{[\s\S]*\}/);          // استخراج كائن JSON فقط
    var parsed = JSON.parse(m ? m[0] : text);
    return parsed;
  } catch (err) {
    return null;
  }
}

/* =========================================================================
 * INTERVIEW
 * ========================================================================= */
function submitInterview_(req) {
  var scores = req.scores || [];
  var sum = 0; scores.forEach(function (n) { sum += Number(n) || 0; });
  var avg = scores.length ? sum / scores.length : 0;
  var idx = findInterviewRow_(req.nationalId, req.evaluator);
  var row = [req.nationalId, req.evaluator, req.role || '', JSON.stringify(scores), avg, new Date()];
  if (idx === -1) sheet_('Interviews').appendRow(row);
  else sheet_('Interviews').getRange(idx, 1, 1, row.length).setValues([row]);
  return { ok: true };
}

function findInterviewRow_(nationalId, evaluator) {
  var sh = sheet_('Interviews');
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var vals = sh.getRange(2, 1, last - 1, 2).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0]) === String(nationalId) && String(vals[i][1]) === String(evaluator)) return i + 2;
  }
  return -1;
}

/* =========================================================================
 * RESULTS  (الدرجة النهائية: 50% مقابلة + 30% وحدة + 20% لغوي)
 * ========================================================================= */
function computeResult_(nationalId, cfg, ctx) {
  cfg = cfg || getConfig_();
  if (!ctx) ctx = { interviews: readAll_('Interviews'), unitGrades: readAll_('UnitGrades'), lang: readAll_('LangResults'), retakes: readAll_('Retakes') };
  var indicatorMax = Number(cfg.indicatorMax) || 10;
  var indWeights = []; try { indWeights = JSON.parse(cfg.indicatorWeights); } catch (e) { indWeights = []; }
  var evWeights = {}; try { evWeights = JSON.parse(cfg.evaluatorWeights); } catch (e) { evWeights = {}; }

  // مقابلة: لكل مقيّم متوسط مؤشرات مُوزّن، ثم متوسط المقيّمين مُوزّن
  var ivs = ctx.interviews.filter(function (x) { return String(x.nationalId) === String(nationalId); });
  var interviewPct = null;
  if (ivs.length) {
    var wsum = 0, wtot = 0;
    ivs.forEach(function (v) {
      var arr = []; try { arr = JSON.parse(v.scores); } catch (e) { arr = []; }
      var s = 0, w = 0;
      arr.forEach(function (sc, i) {
        var iw = (indWeights[i] != null && indWeights[i] !== '') ? Number(indWeights[i]) : 1;
        s += (Number(sc) || 0) * iw; w += iw;
      });
      var pct = w ? (s / w) / indicatorMax * 100 : (Number(v.avg) / indicatorMax * 100);
      var ew = (evWeights[v.evaluator] != null && evWeights[v.evaluator] !== '') ? Number(evWeights[v.evaluator]) : 1;
      wsum += pct * ew; wtot += ew;
    });
    interviewPct = wtot ? wsum / wtot : null;
  }

  // وحدة: نسبة مئوية من الدرجة الكلية
  var ug = ctx.unitGrades.filter(function (x) { return String(x.nationalId) === String(nationalId); })[0];
  var unitGrade = ug ? Number(ug.grade) : null;
  var unitTotal = Number(cfg.unitTotalGrade) || 100;
  var unitPct = unitGrade === null ? null : (unitGrade / unitTotal) * 100;

  // لغوي: نسبة مئوية (langTotal أصلًا من 100)
  var lang = ctx.lang.filter(function (x) { return String(x.nationalId) === String(nationalId); })[0];
  var langPct = lang ? Number(lang.langTotal) : null;
  var langDetail = lang ? { enListen: Number(lang.enListenScore), translate: Number(lang.translateScore), arListen: Number(lang.arListenScore) } : null;
  var langDate = lang && lang.timestamp ? new Date(lang.timestamp).toISOString() : null;

  var wI = Number(cfg.weightInterview) || 50;
  var wU = Number(cfg.weightUnit) || 30;
  var wL = Number(cfg.weightLang) || 20;

  var final = 0, missing = [];
  final += ((interviewPct === null ? 0 : interviewPct) / 100) * wI; if (interviewPct === null) missing.push('المقابلة');
  final += ((unitPct === null ? 0 : unitPct) / 100) * wU; if (unitPct === null) missing.push('امتحان الوحدة');
  final += ((langPct === null ? 0 : langPct) / 100) * wL; if (langPct === null) missing.push('الامتحان اللغوي');

  var acceptanceScore = Number(cfg.acceptanceScore) || 0;
  var retakes = ctx.retakes || [];
  var retakeGranted = retakes.some(function (x) { return String(x.nationalId) === String(nationalId); });
  return {
    nationalId: nationalId,
    interviewPct: round1_(interviewPct),
    unitPct: round1_(unitPct),
    langPct: round1_(langPct),
    unitGrade: unitGrade,
    langDetail: langDetail,
    langDate: langDate,
    weights: { interview: wI, unit: wU, lang: wL },
    finalScore: round1_(final),
    complete: missing.length === 0,
    missing: missing,
    evaluatorsCount: ivs.length,
    acceptanceScore: acceptanceScore,
    accepted: round1_(final) >= acceptanceScore,
    retakeGranted: retakeGranted
  };
}

function round1_(x) { return x === null ? null : Math.round(x * 10) / 10; }

function loadCtx_() {
  return { interviews: readAll_('Interviews'), unitGrades: readAll_('UnitGrades'), lang: readAll_('LangResults'), retakes: readAll_('Retakes') };
}

function getResult_(req) {
  var s = readAll_('Students').filter(function (x) { return String(x.nationalId) === String(req.nationalId); })[0];
  if (!s) return { ok: false, error: 'الطالب غير مسجّل' };
  var r = computeResult_(req.nationalId, null, loadCtx_());
  r.name = s.name;
  return { ok: true, result: r };
}

function listResults_() {
  var cfg = getConfig_();
  var ctx = loadCtx_();                 // قراءة الشيتات مرة واحدة فقط
  return readAll_('Students').map(function (s) {
    var r = computeResult_(s.nationalId, cfg, ctx);
    r.name = s.name;
    return r;
  });
}

// إبطال كاش الخادم بعد أي تعديل
function bustCache_() { try { CacheService.getScriptCache().remove('bootstrap'); } catch (e) {} }

// قائمة داخل Google Sheet لتشغيل الأدوات يدويًا
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('منظومة القبول')
      .addItem('تهيئة النظام (setup)', 'setup')
      .addItem('تحديث كشف النتائج الآن', 'buildResultsSheet')
      .addItem('تفعيل التحديث التلقائي (كل 5 دقائق)', 'installAutoSync')
      .addToUi();
  } catch (e) {}
}

// مزامنة تلقائية لكشف النتائج (مُشغّل زمني) — لا تُبطئ عمليات الحفظ
function installAutoSync() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'buildResultsSheet') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('buildResultsSheet').timeBased().everyMinutes(5).create();
  try { SpreadsheetApp.getUi().alert('تم تفعيل التحديث التلقائي لكشف النتائج كل 5 دقائق.'); } catch (e) {}
}

// بناء/تحديث «كشف النتائج» في نفس الملف: كل بيانات الطالب ودرجاته (وحدة/لغوي مفصّل/مقابلة حسب المؤشرات/الإجمالي)
function buildResultsSheet() {
  var cfg = getConfig_();
  var indicators = []; try { indicators = JSON.parse(cfg.indicators); } catch (e) { indicators = []; }
  var indicatorMax = Number(cfg.indicatorMax) || 10;
  var students = readAll_('Students');
  var ctx = loadCtx_();

  var header = ['م', 'الاسم', 'الرقم القومي', 'المدرسة', 'موبايل الطالب', 'موبايل ولي الأمر', 'الايميل',
    'درجة الوحدة', 'الوحدة %', 'استماع إنجليزي %', 'ترجمة %', 'استماع عربي %', 'اللغوي الإجمالي %'];
  indicators.forEach(function (q) { header.push('مقابلة: ' + q + ' %'); });
  header.push('المقابلة الإجمالي %', 'عدد المقيّمين', 'الدرجة الكلية', 'حالة القبول');

  var out = [header];
  students.forEach(function (s, i) {
    var r = computeResult_(s.nationalId, cfg, ctx);
    var d = r.langDetail || {};
    // متوسط كل مؤشر عبر المقيّمين
    var ivs = ctx.interviews.filter(function (x) { return String(x.nationalId) === String(s.nationalId); });
    var perInd = indicators.map(function (_, idx) {
      var sum = 0, n = 0;
      ivs.forEach(function (v) {
        var arr = []; try { arr = JSON.parse(v.scores); } catch (e) {}
        if (arr && arr[idx] != null) { sum += (Number(arr[idx]) / indicatorMax) * 100; n++; }
      });
      return n ? Math.round((sum / n) * 10) / 10 : '';
    });
    var row = [i + 1, s.name || '', s.nationalId, s.school || '', s.studentPhone || '', s.guardianPhone || '', s.email || '',
      (r.unitGrade == null ? '' : r.unitGrade), (r.unitPct == null ? '' : r.unitPct),
      (d.enListen == null ? '' : d.enListen), (d.translate == null ? '' : d.translate), (d.arListen == null ? '' : d.arListen),
      (r.langPct == null ? '' : r.langPct)];
    row = row.concat(perInd);
    row.push((r.interviewPct == null ? '' : r.interviewPct), r.evaluatorsCount || 0,
      (r.finalScore == null ? '' : r.finalScore),
      (r.complete ? (r.accepted ? 'مقبول' : 'علي قائمة الانتظار') : 'غير مكتمل'));
    out.push(row);
  });

  var name = 'كشف النتائج';
  var sh = ss_().getSheetByName(name) || ss_().insertSheet(name);
  sh.clear();
  sh.getRange(1, 1, out.length, header.length).setValues(out);
  sh.setFrozenRows(1);
  try { sh.getRange(1, 1, 1, header.length).setFontWeight('bold'); } catch (e) {}
  return out.length - 1;
}

function exportResultsSheet_(req) {
  requireAdmin_(req);
  var count = buildResultsSheet();
  return { ok: true, count: count };
}

// نداء مجمّع: الإعدادات + صفوف مدمجة (بيانات الطالب + كل درجاته) — مع كاش خادم قصير
function bootstrap_() {
  var cache = null;
  try { cache = CacheService.getScriptCache(); var hit = cache.get('bootstrap'); if (hit) return JSON.parse(hit); } catch (e) {}
  var cfg = getConfig_();
  var students = readAll_('Students');
  var ctx = loadCtx_();
  var rows = students.map(function (s) {
    var r = computeResult_(s.nationalId, cfg, ctx);
    r.name = s.name; r.school = s.school || ''; r.studentPhone = s.studentPhone || '';
    r.guardianPhone = s.guardianPhone || ''; r.email = s.email || ''; r.createdAt = s.createdAt || '';
    return r;
  });
  var payload = { ok: true, config: cfg, rows: rows };
  try { if (cache) cache.put('bootstrap', JSON.stringify(payload), 20); } catch (e) {}  // 20s، يُتجاهل لو كبير
  return payload;
}
