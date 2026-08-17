/* ============================================================
 *  منظومة قبول المدارس التكنولوجية التطبيقية — منطق الواجهة
 * ============================================================ */
var state = { user: null, screen: "dashboard", timer: null };
var $ = function (id) { return document.getElementById(id); };
var screenEl = function () { return $("screen"); };

/* ---------- أدوات ---------- */
function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];}); }
function toast(msg, kind){
  var t=$("toast"); t.textContent=msg; t.className=(kind||"")+" show";
  clearTimeout(toast._t); toast._t=setTimeout(function(){t.className=t.className.replace("show","");},2800);
}
var READCACHE={};
var WRITE_ACTIONS={setConfig:1,createUser:1,deleteUser:1,registerStudent:1,importStudents:1,setUnitGrade:1,importUnitGrades:1,gradeExam:1,submitInterview:1,resetLangExam:1};
async function api(action, params){
  var r = await API.call(action, params);
  if(!r){ toast("لا توجد استجابة من الخادم","err"); return {ok:false}; }
  if(WRITE_ACTIONS[action]){ READCACHE={}; invalidateStore(); }   // أي تعديل يلغي الكاش
  return r;
}
// نداء مقروء مع كاش
async function apiC(action, params){
  if(READCACHE[action]) return READCACHE[action];
  var r=await api(action, params);
  if(r && r.ok!==false) READCACHE[action]=r;
  return r;
}
// مخزن الجلسة: يجلب (الإعدادات+الصفوف) بنداء واحد ويعيد استخدامها، مع حفظ في sessionStorage
var STORE={ data:null, at:0 };
function _saveStore(){ try{ sessionStorage.setItem("STORE", JSON.stringify(STORE)); }catch(e){} }
function _loadStore(){ try{ var s=sessionStorage.getItem("STORE"); if(s){ var o=JSON.parse(s); if(o&&o.data&&(Date.now()-o.at)<120000){ STORE=o; return true; } } }catch(e){} return false; }
async function boot(force){
  if(!force && STORE.data) return STORE.data;
  if(!force && _loadStore()) return STORE.data;
  var r=await api("bootstrap");
  if(r && r.ok!==false){
    var rows=r.rows||[];
    STORE.data={config:r.config||{}, students:rows, results:rows, rows:rows};
  } else STORE.data={config:{},students:[],results:[],rows:[]};
  STORE.at=Date.now(); _saveStore();
  return STORE.data;
}
function invalidateStore(){ STORE.data=null; try{ sessionStorage.removeItem("STORE"); }catch(e){} }

/* ---------- تفضيل الصوت ---------- */
window.VOICE_PREF = { en:"", ar:"" };
async function loadVoicePref(){
  try{
    var c=(await apiC("getConfig")).config||{};
    window.VOICE_PREF={ en:c.voiceEn||"", ar:c.voiceAr||"" };
    window.SENTENCE_GAP=(Number(c.sentenceGap)||3)*1000;
  }catch(e){}
}
if("speechSynthesis" in window){ try{ window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged=function(){}; }catch(e){} }

/* ---------- تسجيل الدخول ---------- */
function initLogin(){
  $("demo-note").innerHTML = "";
  $("demo-note").classList.add("hidden");
  $("lg-btn").onclick = doLogin;
  $("lg-pass").addEventListener("keydown", function(e){ if(e.key==="Enter") doLogin(); });

  // تبويبات: لجنة/إدارة vs طالب
  $("tab-staff").onclick=function(){ swapTab(true); };
  $("tab-student").onclick=function(){ swapTab(false); };
  $("st-btn").onclick=studentStart;
  $("st-nid").addEventListener("keydown",function(e){ if(e.key==="Enter") studentStart(); });
}
function swapTab(staff){
  $("tab-staff").classList.toggle("active",staff);
  $("tab-student").classList.toggle("active",!staff);
  $("form-staff").classList.toggle("hidden",!staff);
  $("form-student").classList.toggle("hidden",staff);
}
async function doLogin(){
  var u=$("lg-user").value.trim(), p=$("lg-pass").value;
  if(!u||!p){ toast("أدخل اسم المستخدم وكلمة المرور","err"); return; }
  $("lg-btn").disabled=true; $("lg-btn").textContent="جاري الدخول...";
  API.setCreds(u,p);
  var r=await api("login",{username:u,password:p});
  $("lg-btn").disabled=false; $("lg-btn").textContent="دخول";
  if(!r.ok){ toast(r.error||"فشل الدخول","err"); return; }
  state.user=r.user;
  enterApp();
}
function enterApp(){
  $("login").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("nav-name").textContent=state.user.name;
  $("nav-role").textContent=state.user.role==="admin"?"مدير البرنامج":"عضو لجنة المقابلة";
  $("page-role").textContent=state.user.role==="admin"?"مدير البرنامج":"عضو لجنة المقابلة";
  buildNav();
  loadVoicePref();
  $("logout").onclick=function(){ location.reload(); };
  go(state.user.role==="admin"?"dashboard":"interview");
}

/* ---------- التنقل ---------- */
var SCREENS = {
  dashboard:{title:"لوحة المعلومات", icon:"▤", roles:["admin"]},
  students: {title:"الطلاب", icon:"👥", roles:["admin"]},
  unit:     {title:"درجات امتحان الوحدة", icon:"▦", roles:["admin"]},
  interview:{title:"تقييم المقابلة", icon:"★", roles:["admin","committee"]},
  report:   {title:"تقرير", icon:"📄", roles:["admin","committee"]},
  results:  {title:"النتائج النهائية", icon:"◈", roles:["admin"]},
  users:    {title:"المستخدمون", icon:"⚙", roles:["admin"]},
  settings: {title:"الإعدادات", icon:"⛭", roles:["admin"]}
};
function buildNav(){
  var nav=$("nav"); nav.innerHTML="";
  Object.keys(SCREENS).forEach(function(k){
    var s=SCREENS[k];
    if(s.roles.indexOf(state.user.role)===-1) return;
    var b=document.createElement("button");
    b.className="nav-item"; b.dataset.k=k;
    b.innerHTML='<span class="ic">'+s.icon+'</span> '+esc(s.title);
    b.onclick=function(){ go(k); };
    nav.appendChild(b);
  });
}
function go(k){
  if(state.timer){ clearInterval(state.timer); state.timer=null; }
  stopSpeak();
  state.screen=k;
  $("page-title").textContent=SCREENS[k].title;
  Array.prototype.forEach.call($("nav").children,function(b){ b.classList.toggle("active",b.dataset.k===k); });
  screenEl().innerHTML='<div class="loader"><div class="spinner"></div><div class="loader-txt">جارٍ التحميل…</div></div>';
  RENDER[k]().catch(function(e){ screenEl().innerHTML='<div class="empty">تعذّر التحميل. حاول مرة أخرى.</div>'; });
}

/* ---------- تحميل مكتبة Excel عند الحاجة فقط (لتسريع الفتح) ---------- */
function ensureXLSX(){
  return new Promise(function(res,rej){
    if(window.XLSX) return res();
    var s=document.createElement("script");
    s.src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload=function(){ res(); };
    s.onerror=function(){ toast("تعذّر تحميل مكتبة Excel","err"); rej(new Error("xlsx")); };
    document.head.appendChild(s);
  });
}
/* ---------- استيراد Excel ---------- */
function readExcel(file, cb){
  ensureXLSX().then(function(){
    var reader=new FileReader();
    reader.onload=function(e){
      try{
        var wb=XLSX.read(new Uint8Array(e.target.result),{type:"array"});
        var sh=wb.Sheets[wb.SheetNames[0]];
        cb(XLSX.utils.sheet_to_json(sh,{defval:""}));
      }catch(err){ toast("تعذّر قراءة الملف","err"); }
    };
    reader.readAsArrayBuffer(file);
  }).catch(function(){});
}
function pickField(row, candidates){
  var keys=Object.keys(row);
  for(var i=0;i<candidates.length;i++){
    for(var j=0;j<keys.length;j++){
      if(String(keys[j]).replace(/\s+/g,"").toLowerCase().indexOf(candidates[i])>-1) return row[keys[j]];
    }
  }
  return "";
}

/* ============================================================
 *  الشاشات
 * ============================================================ */
var RENDER = {};

/* ---- لوحة المعلومات ---- */
RENDER.dashboard = async function(){
  var b=await boot(); var rs=b.results; var cfg=b.config;
  var st=rs; // عدد الطلاب = عدد النتائج
  var done=rs.filter(function(r){return r.complete;});
  var avg=done.length? Math.round(done.reduce(function(a,r){return a+r.finalScore;},0)/done.length*10)/10 : "—";
  var html=''+
    '<div class="stats">'+
      stat(st.length,"إجمالي الطلاب")+
      stat(done.length,"مكتملو التقييم")+
      statAccent(avg,"متوسط الدرجة النهائية")+
      stat(cfg.unitPassMandatory==="true"?"مُفعّل":"غير مُفعّل","شرط النجاح في الوحدة")+
    '</div>';
  html+='<div class="card"><div class="section-head"><h3>أحدث النتائج</h3>'+
    '<button class="btn btn-ghost btn-sm" onclick="go(\'results\')">عرض الكل</button></div>'+
    resultsTable(rs.slice(0,6))+'</div>';
  screenEl().innerHTML=html;
};
function stat(n,l){ return '<div class="stat"><div class="n">'+esc(n)+'</div><div class="l">'+esc(l)+'</div></div>'; }
function statAccent(n,l){ return '<div class="stat accent"><div class="n">'+esc(n)+'</div><div class="l">'+esc(l)+'</div></div>'; }

/* ---- الطلاب ---- */
RENDER.students = async function(){
  var b=await boot(); var cfg=b.config; var students=b.students;
  var isAdmin=state.user.role==="admin";
  var importOn = isAdmin;   // الاستيراد متاح دائمًا للمدير بجانب الإضافة اليدوية
  var schools=[]; try{ schools=JSON.parse(cfg.schools); }catch(e){ schools=[]; }

  var html='<div class="card"><div class="section-head"><h3>تسجيل بيانات الطالب</h3>'+
    (isAdmin?'<label class="btn btn-accent btn-sm" style="margin:0">⬆ استيراد من Excel<input type="file" id="imp-students" accept=".xlsx,.xls,.csv" hidden></label>':'')+
    '</div>'+
    '<p class="card-sub">أضف طالبًا يدويًا من الحقول بالأسفل، أو استورد دفعة من ملف Excel — الاستيراد يضيف/يحدّث دون حذف الموجود. يمكن أن يحتوي الملف على عمود «درجة الوحدة» فتُستورد الدرجة تلقائيًا مع الطالب.</p>';

  if(importOn && students.length){
    html+='<div class="field"><label>اختيار طالب مسجّل (تظهر بياناته تلقائيًا)</label>'+
      '<select id="stu-pick"><option value="">— اكتب البيانات يدويًا —</option>'+
      students.map(function(s){return '<option value="'+esc(s.nationalId)+'">'+esc(s.name)+' — '+esc(s.nationalId)+'</option>';}).join("")+
      '</select></div>';
  }

  html+='<div class="grid-2">'+
    field("stu-name","الاسم الرباعي","text","",true)+
    field("stu-nid","الرقم القومي (14 رقمًا)","text","",true)+
    '<div class="field"><label>المدرسة المتقدِّم عليها</label><select id="stu-school">'+
      '<option value="">— اختر المدرسة —</option>'+
      schools.map(function(s){return '<option value="'+esc(s)+'">'+esc(s)+'</option>';}).join("")+
      '<option value="__other__">أخرى (إضافة يدويًا)…</option></select>'+
      '<input id="stu-school-other" class="hidden" style="margin-top:8px" placeholder="اكتب اسم المدرسة"></div>'+
    field("stu-sphone","موبايل الطالب","text","")+
    field("stu-gphone","موبايل ولي الأمر","text","")+
    field("stu-email","الايميل","email","")+'</div>'+
    '<button class="btn btn-primary" id="stu-save">حفظ الطالب</button></div>';

  html+='<div class="card"><h3>الطلاب المسجّلون ('+students.length+')</h3>'+
    (students.length? studentsTable(students) : '<div class="empty"><div class="big">👥</div>لا يوجد طلاب بعد</div>')+'</div>';

  screenEl().innerHTML=html;

  $("stu-school").onchange=function(){
    $("stu-school-other").classList.toggle("hidden", this.value!=="__other__");
  };
  function schoolValue(){
    var v=$("stu-school").value;
    return v==="__other__" ? $("stu-school-other").value.trim() : v;
  }
  function setSchool(val){
    if(!val) return;
    if(schools.indexOf(val)>-1){ $("stu-school").value=val; $("stu-school-other").classList.add("hidden"); }
    else { $("stu-school").value="__other__"; $("stu-school-other").classList.remove("hidden"); $("stu-school-other").value=val; }
  }

  if($("stu-pick")) $("stu-pick").onchange=function(){
    var val=this.value;
    var s=students.filter(function(x){return String(x.nationalId)===val;})[0];
    if(!s) return;
    $("stu-name").value=s.name||""; $("stu-nid").value=s.nationalId||"";
    setSchool(s.school||""); $("stu-sphone").value=s.studentPhone||"";
    $("stu-gphone").value=s.guardianPhone||""; $("stu-email").value=s.email||"";
  };
  $("stu-save").onclick=async function(){
    var nid=$("stu-nid").value.trim();
    if(!/^\d{6,20}$/.test(nid)){ toast("الرقم القومي غير صحيح (أرقام فقط)","err"); return; }
    if(!$("stu-name").value.trim()){ toast("الاسم الرباعي مطلوب","err"); return; }
    var obj={ nationalId:nid, name:$("stu-name").value.trim(), school:schoolValue(),
      studentPhone:$("stu-sphone").value.trim(), guardianPhone:$("stu-gphone").value.trim(), email:$("stu-email").value.trim() };
    var snapCfg=(STORE.data?STORE.data.config:cfg), snapRows=(STORE.data?STORE.data.rows.slice():null);
    var r=await api("registerStudent",{student:obj});           // يحفظ ويُبطل الكاش
    if(!r.ok){ toast(r.error||"خطأ","err"); return; }
    toast("تم حفظ الطالب","ok");
    if(snapRows){                                                // تحديث تفاؤلي فوري بدون نداء شبكة
      var row=Object.assign({unitGrade:null,unitPct:null,langPct:null,interviewPct:null,finalScore:null,complete:false,accepted:false,langDetail:null}, obj);
      var i=snapRows.map(function(x){return String(x.nationalId);}).indexOf(nid);
      if(i>=0) snapRows[i]=Object.assign(snapRows[i],row); else snapRows.push(row);
      STORE.data={config:snapCfg, students:snapRows, results:snapRows, rows:snapRows}; STORE.at=Date.now(); _saveStore();
    }
    go("students");
  };
  if($("imp-students")) $("imp-students").onchange=function(e){
    var f=e.target.files[0]; if(!f) return;
    var H={}; try{ H=JSON.parse(cfg.importHeaders); }catch(e2){ H={}; }
    readExcel(f,async function(rows){
      var mapped=rows.map(function(r){return {
        nationalId:String(byHeader(r,H.nationalId,["nationalid","الرقمالقومي","قومي","رقمقومي"])).replace(/[^\d]/g,""),
        name:String(byHeader(r,H.name,["name","الاسم","اسم","الرباعي"])||"").trim(),
        school:byHeader(r,H.school,["school","المدرسة","مدرسه"]),
        studentPhone:normPhone(byHeader(r,H.studentPhone,["موبايلالطالب","هاتفالطالب","تليفونالطالب","studentphone","phone"])),
        guardianPhone:normPhone(byHeader(r,H.guardianPhone,["ولي","guardian","parent","موبايلولي"])),
        email:byHeader(r,H.email,["email","ايميل","بريد","الايميل"]),
        unitGrade:byHeader(r,"",["درجةالوحدة","الوحدة","درجهالوحده","unitgrade","grade","الدرجة"])
      };}).filter(function(x){return x.nationalId || x.name;});
      var res=await api("importStudents",{rows:mapped});
      if(res.ok){ toast("استيراد الطلاب: أُضيف "+res.added+"، حُدّث "+(res.updated||0)+(res.grades?("، درجات وحدة: "+res.grades):"")+"، تخطّي "+res.skipped,"ok"); go("students"); }
      else toast(res.error||"تعذّر الاستيراد","err");
    });
  };
};
// مطابقة العمود: أولًا بالرأس المحدَّد في الإعدادات، ثم مطابقة ذكية احتياطية
function byHeader(row, header, fallbacks){
  if(header){
    var keys=Object.keys(row);
    for(var i=0;i<keys.length;i++){ if(norm2(keys[i])===norm2(header)) return row[keys[i]]; }
  }
  return pickField(row, fallbacks||[]);
}
function norm2(s){ return String(s||"").replace(/\s+/g,"").toLowerCase(); }
// تطبيع رقم الهاتف (استرجاع الصفر الأول لو ضاع في Excel)
function normPhone(v){
  var d=String(v==null?"":v).replace(/[^\d]/g,"");
  if(d.length===10 && d.charAt(0)==="1") d="0"+d;   // 1xxxxxxxxx → 01xxxxxxxxx
  return d;
}
function studentsTable(students){
  return '<div class="table-wrap"><table><thead><tr><th>الاسم الرباعي</th><th>الرقم القومي</th><th>المدرسة</th><th>موبايل الطالب</th><th>موبايل ولي الأمر</th></tr></thead><tbody>'+
    students.map(function(s){return '<tr><td><b>'+esc(s.name)+'</b><br><span style="font-size:12px;color:var(--muted)">'+esc(s.email||"")+'</span></td><td>'+esc(s.nationalId)+'</td><td>'+esc(s.school||"—")+'</td><td>'+esc(s.studentPhone||"—")+'</td><td>'+esc(s.guardianPhone||"—")+'</td></tr>';}).join("")+
    '</tbody></table></div>';
}
function field(id,label,type,val,req){
  return '<div class="field"><label>'+esc(label)+(req?' <span style="color:var(--danger)">*</span>':'')+'</label>'+
    '<input id="'+id+'" type="'+(type||"text")+'" value="'+esc(val||"")+'"></div>';
}

/* ---- درجات امتحان الوحدة ---- */
RENDER.unit = async function(){
  var b=await boot(); var cfg=b.config; var students=b.students; var results=b.results;
  var gradeOf={}; results.forEach(function(r){ gradeOf[r.nationalId]=r.unitGrade; });

  var html='<div class="card"><div class="section-head"><h3>درجات امتحان الوحدة</h3>'+
    '<label class="btn btn-accent btn-sm" style="margin:0">استيراد من Excel<input type="file" id="imp-unit" accept=".xlsx,.xls,.csv" hidden></label></div>'+
    '<p class="card-sub">الدرجة الكلية للامتحان: <b>'+esc(cfg.unitTotalGrade)+'</b> • درجة النجاح: <b>'+esc(cfg.unitPassGrade)+'</b> • '+
    'النجاح إجباري للدخول: <b>'+(cfg.unitPassMandatory==="true"?"نعم":"لا")+'</b> (يُضبط من الإعدادات)</p>'+
    '<p class="hint">الاستيراد يربط الدرجة تلقائيًا بالطالب عبر الرقم القومي أو الاسم، ويضيف/يحدّث دون حذف باقي البيانات.</p>';

  if(!students.length){ html+='<div class="empty">سجّل طلابًا أولًا</div></div>'; screenEl().innerHTML=html; return; }

  html+='<div class="table-wrap"><table><thead><tr><th>الاسم</th><th>الرقم القومي</th><th>الدرجة</th><th></th></tr></thead><tbody>'+
    students.map(function(s){
      var g=gradeOf[s.nationalId]; g=(g==null?"":g);
      return '<tr><td><b>'+esc(s.name)+'</b></td><td>'+esc(s.nationalId)+'</td>'+
        '<td style="width:130px"><input type="number" min="0" value="'+esc(g)+'" data-nid="'+esc(s.nationalId)+'" data-name="'+esc(s.name)+'" class="unit-inp"></td>'+
        '<td><button class="btn btn-primary btn-sm unit-save" data-nid="'+esc(s.nationalId)+'">حفظ</button></td></tr>';
    }).join("")+'</tbody></table></div></div>';
  screenEl().innerHTML=html;

  Array.prototype.forEach.call(document.getElementsByClassName("unit-save"),function(btn){
    btn.onclick=async function(){
      var inp=document.querySelector('.unit-inp[data-nid="'+btn.dataset.nid+'"]');
      var r=await api("setUnitGrade",{nationalId:btn.dataset.nid,name:inp.dataset.name,grade:inp.value});
      if(r.ok) toast("تم حفظ الدرجة","ok"); else toast(r.error||"خطأ","err");
    };
  });
  if($("imp-unit")) $("imp-unit").onchange=function(e){
    var f=e.target.files[0]; if(!f) return;
    readExcel(f,async function(rows){
      var mapped=rows.map(function(r){return {
        nationalId:String(pickField(r,["nationalid","الرقمالقومي","قومي"])).trim(),
        name:pickField(r,["name","الاسم","اسم"]),
        grade:pickField(r,["grade","الدرجة","درجة","score"])
      };});
      var res=await api("importUnitGrades",{rows:mapped});
      if(res.ok){ toast("ربط الدرجات: "+res.linked+" (تخطّي "+res.skipped+" بلا مطابقة)","ok"); go("unit"); }
      else toast(res.error||"تعذّر الاستيراد","err");
    });
  };
};

/* ---- الامتحان اللغوي ---- */
RENDER.lang = async function(){
  var students=(await boot()).students;
  var html='<div class="card"><h3>الامتحان اللغوي (أثناء المقابلة)</h3>'+
    '<p class="card-sub">مدة الامتحان '+APP_CONFIG.EXAM_MINUTES+' دقيقة • 3 أقسام: استماع إنجليزي، ترجمة، استماع عربي • كل طالب يحصل على قطع مختلفة.</p>'+
    '<div class="picker"><div class="field"><label>اختر الطالب</label><select id="lang-stu">'+
    '<option value="">— اختر —</option>'+students.map(function(s){return '<option value="'+esc(s.nationalId)+'">'+esc(s.name)+' — '+esc(s.nationalId)+'</option>';}).join("")+
    '</select></div><button class="btn btn-primary" id="lang-start">بدء الامتحان</button></div>'+
    '<div id="exam-area"></div></div>';
  screenEl().innerHTML=html;
  $("lang-start").onclick=startExam;
};
async function startExam(){
  var nid=$("lang-stu").value;
  if(!nid){ toast("اختر الطالب أولًا","err"); return; }
  var r=await api("startExam",{nationalId:nid});
  if(r.blocked){
    var msg='<div class="card" style="border-color:#f0dfb4;background:var(--danger-bg)"><b style="color:var(--danger)">⛔ '+esc(r.error)+'</b>';
    if(r.taken && state.user.role==="admin")
      msg+='<div style="margin-top:12px"><button class="btn btn-accent btn-sm" id="reset-exam">إعادة فتح الامتحان لهذا الطالب (مدير)</button><div class="hint" style="margin-top:6px">استخدمها فقط في حال وجود مشكلة أثناء الأداء.</div></div>';
    msg+='</div>';
    $("exam-area").innerHTML=msg;
    if($("reset-exam")) $("reset-exam").onclick=async function(){
      if(!confirm("سيتم حذف نتيجة الطالب اللغوية والسماح بإعادة الامتحان. متابعة؟")) return;
      var rr=await api("resetLangExam",{nationalId:nid});
      if(rr.ok){ toast("تم إعادة فتح الامتحان","ok"); startExam(); } else toast(rr.error||"خطأ","err");
    };
    return;
  }
  if(!r.ok){ toast(r.error||"خطأ","err"); return; }
  renderExam(nid, r.exam, "exam-area", staffExamComplete);
}
// تكمِلة امتحان اللجنة/الإدارة: عرض الدرجات + روابط التنقل
function staffExamComplete(container, sc, r){
  container.innerHTML='<div class="card"><h3>✅ تم تصحيح الامتحان اللغوي</h3>'+
    '<p class="card-sub">طريقة التصحيح: '+(r.method==="ai"?"الذكاء الاصطناعي":"آلي مبسّط")+'</p>'+
    '<div class="breakdown" style="border-radius:12px;overflow:hidden;border:1px solid var(--line)">'+
      miniScore("استماع إنجليزي",sc.enListen)+miniScore("الترجمة",sc.translate)+miniScore("استماع عربي",sc.arListen)+
    '</div>'+
    '<div style="text-align:center;margin-top:18px"><div style="color:var(--muted);font-size:13px">الدرجة الكلية للامتحان اللغوي</div>'+
    '<div style="font-family:Cairo;font-size:40px;font-weight:800;color:var(--teal-700)">'+sc.langTotal+'<small style="font-size:18px;color:var(--muted)"> / 100</small></div></div>'+
    (r.feedback?'<div class="hint" style="margin-top:10px;text-align:center">'+esc(r.feedback)+'</div>':'')+
    '<div class="divider"></div><button class="btn btn-ghost" onclick="go(\'lang\')">امتحان طالب آخر</button> '+
    '<button class="btn btn-primary" onclick="go(\'results\')">عرض النتائج</button></div>';
}
function renderExam(nid, ex, containerId, onComplete){
  state.exam={ nid:nid, ex:ex, container:containerId, onComplete:onComplete };
  var html=''+
    '<div class="section-head"><div class="stepline" style="flex:1;margin:0"><div class="st active" id="stp0"></div><div class="st" id="stp1"></div><div class="st" id="stp2"></div></div>'+
    '<span class="exam-timer" id="timer">--:--</span></div>'+

    '<div class="card"><span class="exam-part-label">القسم 1 — استماع إنجليزي</span>'+
    '<p class="card-sub">اضغط الاستماع ثم اكتب ما سمعته بالإنجليزية.</p>'+
    playBox("btn-en","🔊 استمع للقطعة الإنجليزية")+
    '<textarea id="ans-en" placeholder="Write what you hear..." dir="ltr" oninput="markStep()"></textarea></div>'+

    '<div class="card"><span class="exam-part-label">القسم 2 — الترجمة</span>'+
    '<p class="card-sub">اقرأ القطعة الإنجليزية التالية وترجمها إلى العربية.</p>'+
    '<div class="source-text">'+esc(ex.translate.text)+'</div>'+
    '<textarea id="ans-tr" placeholder="اكتب الترجمة بالعربية هنا..." oninput="markStep()"></textarea></div>'+

    '<div class="card"><span class="exam-part-label">القسم 3 — استماع عربي</span>'+
    '<p class="card-sub">اضغط الاستماع ثم اكتب ما سمعته بالعربية.</p>'+
    playBox("btn-ar","🔊 استمع للقطعة العربية")+
    '<textarea id="ans-ar" placeholder="اكتب ما تسمعه بالعربية..." oninput="markStep()"></textarea></div>'+

    '<button class="btn btn-accent btn-block" id="exam-submit" style="font-size:16px;padding:14px">إنهاء وتسليم الامتحان</button>';
  $(containerId).innerHTML=html;

  $("btn-en").onclick=function(){ speak(ex.enListen.text, "en", 0.45); };
  $("btn-ar").onclick=function(){ speak(ex.arListen.text, "ar", 0.5); };
  $("exam-submit").onclick=function(){ submitExam(nid, ex); };
  startTimer(APP_CONFIG.EXAM_MINUTES*60, function(){ submitExam(nid, ex, true); });
}
function playBox(id,label){
  return '<div class="play-box"><button class="play-btn" id="'+id+'">▶</button><div class="play-meta">'+esc(label)+'<br><span style="opacity:.7">تُنطق جملةً جملةً مع مهلة للكتابة — ويمكن إعادة الاستماع</span></div></div>';
}
function markStep(){
  var v=function(id){return ($(id).value||"").trim().length>0;};
  toggle("stp0",v("ans-en")); toggle("stp1",v("ans-tr")); toggle("stp2",v("ans-ar"));
  function toggle(id,done){ var e=$(id); if(!e)return; e.className="st "+(done?"done":"active"); }
}
function pickVoice(base){
  var voices=(window.speechSynthesis&&window.speechSynthesis.getVoices())||[];
  var pref=window.VOICE_PREF||{};
  var want = base==="en" ? pref.en : pref.ar;
  if(want){ var byName=voices.filter(function(v){return v.name===want;})[0]; if(byName) return byName; }
  if(base==="en"){
    var en=voices.filter(function(v){return /^en/i.test(v.lang);});
    var male=en.filter(function(v){return /(\bmale\b|david|mark|guy|george|daniel|rishi|ravi|fred|oliver|william|james|thomas|arthur|_m\b|#male)/i.test(v.name);});
    var neutralMale=male.filter(function(v){return !/en-US|en-GB/i.test(v.lang);}); // محاولة تجنّب اللكنة الأمريكية/البريطانية
    return neutralMale[0] || male[0] || en.filter(function(v){return !/en-US|en-GB/i.test(v.lang);})[0] || en[0] || null;
  } else {
    // عربية: تفضيل صوت رجالي مصري
    var ar=voices.filter(function(v){return /^ar/i.test(v.lang);});
    var eg=ar.filter(function(v){return /ar-EG/i.test(v.lang) || /(egypt|egyptian|مصر)/i.test(v.name);});
    var maleRe=/(\bmale\b|shakir|shaker|hamed|hamid|naayf|nayef|majed|maged|tarek|tariq|fares|_m\b|#male|شاكر|حامد|فارس)/i;
    var egMale=eg.filter(function(v){return maleRe.test(v.name);});
    var arMale=ar.filter(function(v){return maleRe.test(v.name);});
    return egMale[0] || arMale[0] || eg[0] || ar[0] || null;
  }
}
function endCue(){
  try{
    var ctx=window._ac || (window._ac=new (window.AudioContext||window.webkitAudioContext)());
    [880,660].forEach(function(f,k){
      var o=ctx.createOscillator(), g=ctx.createGain();
      o.type="sine"; o.frequency.value=f; g.gain.setValueAtTime(0.0001,ctx.currentTime+k*0.28);
      g.gain.exponentialRampToValueAtTime(0.2,ctx.currentTime+k*0.28+0.02);
      g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+k*0.28+0.25);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime+k*0.28); o.stop(ctx.currentTime+k*0.28+0.26);
    });
  }catch(e){}
}
var _speakSeq = 0;
function stopSpeak(){ _speakSeq++; if(window.speechSynthesis) window.speechSynthesis.cancel(); }
function speak(text, base, rate){
  if(!("speechSynthesis" in window)){ toast("المتصفح لا يدعم النطق الصوتي","err"); return; }
  stopSpeak();
  var mySeq=_speakSeq;
  var voice=pickVoice(base);
  var lang = voice ? voice.lang : (base==="en"?"en":"ar-EG");
  var parts=String(text).split(/(?<=[.!؟])\s+|(?<=،)\s+/).filter(Boolean);
  if(!parts.length) parts=[text];
  var gap = (window.SENTENCE_GAP!=null ? window.SENTENCE_GAP : 3000); // مهلة بين الجُمل
  var i=0;
  function next(){
    if(mySeq!==_speakSeq) return;           // أُلغي أو استُبدل
    if(i>=parts.length) return;
    var u=new SpeechSynthesisUtterance(parts[i]);
    u.lang=lang; u.rate=(rate||0.5); u.pitch=1;
    if(voice) u.voice=voice;
    u.onend=function(){
      if(mySeq!==_speakSeq) return;
      i++;
      if(i<parts.length){ setTimeout(next, gap); }
      else { endCue(); toast("انتهى هذا الجزء — يمكنك الضغط على زر التشغيل للاستماع مرة أخرى","ok"); }
    };
    window.speechSynthesis.speak(u);
  }
  next();
}
function startTimer(secs, onEnd){
  var t=$("timer"); var left=secs;
  function tick(){
    var m=Math.floor(left/60), s=left%60;
    t.textContent=(m<10?"0":"")+m+":"+(s<10?"0":"")+s;
    t.classList.toggle("low", left<=60);
    if(left<=0){ clearInterval(state.timer); state.timer=null; toast("انتهى الوقت — يتم التسليم","err"); onEnd(); return; }
    left--;
  }
  tick(); state.timer=setInterval(tick,1000);
}
async function submitExam(nid, ex, auto){
  if(state.timer){ clearInterval(state.timer); state.timer=null; }
  stopSpeak();
  var btn=$("exam-submit"); if(btn){ btn.disabled=true; btn.textContent="جاري التصحيح…"; }
  var r=await api("gradeExam",{
    nationalId:nid,
    enListenId:ex.enListen.id, enListenAnswer:$("ans-en").value,
    translateId:ex.translate.id, translateAnswer:$("ans-tr").value,
    arListenId:ex.arListen.id, arListenAnswer:$("ans-ar").value
  });
  if(!r.ok){ toast(r.error||"خطأ في التصحيح","err"); if(btn){btn.disabled=false;btn.textContent="إعادة المحاولة";} return; }
  var container=$(state.exam.container);
  (state.exam.onComplete||staffExamComplete)(container, r.scores, r);
}
function miniScore(l,v){ return '<div class="b"><div class="lab">'+esc(l)+'</div><div class="v">'+v+'<span style="font-size:13px;color:var(--muted)">%</span></div></div>'; }

/* ============================================================
 *  واجهة الطالب — دخول بالرقم القومي ثم أداء الامتحان
 * ============================================================ */
async function studentStart(){
  var nid=($("st-nid").value||"").trim();
  if(!/^\d{6,20}$/.test(nid)){ toast("أدخل رقمًا قوميًا صحيحًا","err"); return; }
  $("st-btn").disabled=true; $("st-btn").textContent="جارٍ التحقق…";
  var r=await api("getStudent",{nationalId:nid});
  $("st-btn").disabled=false; $("st-btn").textContent="ابدأ الامتحان";
  if(!r.ok){ toast(r.error||"لم يتم العثور على الطالب","err"); return; }
  var student=r.student;
  // منع إعادة الأداء إذا سبق تسجيل نتيجة
  var res=await api("getResult",{nationalId:nid});
  var already = res.ok && res.result && res.result.langPct!=null;
  $("login").classList.add("hidden");
  $("student").classList.remove("hidden");
  $("student-who").textContent=student.name;
  loadVoicePref();
  if(already){ studentAlreadyDone(student); return; }
  studentWelcome(student);
}
function studentExit(){ location.reload(); }
function studentWelcome(student){
  $("student-body").innerHTML=
    '<div class="student-hero">'+
    '<div class="big-ic"><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM3 20a6 6 0 0 1 12 0" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="m16 4 3 3 5-5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'+
    '<h2>أهلًا '+esc(student.name)+'</h2>'+
    '<p>أنت على وشك بدء الامتحان اللغوي. اقرأ التعليمات جيدًا قبل أن تبدأ.</p>'+
    '<ul class="instructions">'+
      '<li>مدة الامتحان <b>'+APP_CONFIG.EXAM_MINUTES+' دقيقة</b>، يبدأ العدّ فور الضغط على «ابدأ».</li>'+
      '<li>الامتحان ثلاثة أقسام: <b>استماع إنجليزي</b>، ثم <b>ترجمة</b>، ثم <b>استماع عربي</b>.</li>'+
      '<li>في قسمَي الاستماع اضغط زر الصوت واستمع جيدًا، ويمكنك إعادة الاستماع أكثر من مرة.</li>'+
      '<li>عند انتهاء الوقت يُسلَّم الامتحان تلقائيًا.</li>'+
    '</ul>'+
    '<button class="btn btn-primary btn-block" id="st-begin" style="font-size:16px;padding:14px">ابدأ الامتحان الآن</button>'+
    '<button class="btn btn-ghost" style="margin-top:10px" onclick="studentExit()">خروج</button>'+
    '</div>';
  $("st-begin").onclick=async function(){
    var r=await api("startExam",{nationalId:student.nationalId});
    if(r.blocked){ $("student-body").innerHTML='<div class="student-hero"><h2>تعذّر بدء الامتحان</h2><p style="color:var(--danger)">'+esc(r.error)+'</p><button class="btn btn-ghost" onclick="studentExit()">خروج</button></div>'; return; }
    if(!r.ok){ toast(r.error||"خطأ","err"); return; }
    renderExam(student.nationalId, r.exam, "student-body", studentExamComplete);
  };
}
function studentAlreadyDone(student){
  $("student-body").innerHTML='<div class="done-hero">'+
    '<div class="check"><svg width="38" height="38" viewBox="0 0 24 24" fill="none"><path d="m5 12 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'+
    '<h2>سبق أداء الامتحان</h2><p style="color:var(--muted)">تم تسجيل امتحانك اللغوي مسبقًا. لا حاجة لإعادته.</p>'+
    '<button class="btn btn-ghost" style="margin-top:14px" onclick="studentExit()">خروج</button></div>';
}
// تكمِلة امتحان الطالب: شاشة شكر بدون كشف الدرجات
function studentExamComplete(container, sc, r){
  container.innerHTML='<div class="done-hero">'+
    '<div class="check"><svg width="38" height="38" viewBox="0 0 24 24" fill="none"><path d="m5 12 4.5 4.5L19 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>'+
    '<h2>تم تسليم امتحانك بنجاح</h2>'+
    '<p style="color:var(--muted)">شكرًا لك. تم استلام إجاباتك وستُراجَع ضمن تقييم القبول. يمكنك الآن مغادرة الشاشة.</p>'+
    '<button class="btn btn-primary" style="margin-top:16px" onclick="studentExit()">إنهاء</button></div>';
}

/* ---- تقييم المقابلة ---- */
RENDER.interview = async function(){
  var b=await boot(); var cfg=b.config; var students=b.students;
  var inds=[]; try{ inds=JSON.parse(cfg.indicators); }catch(e){ inds=["المؤشر 1"]; }
  var max=Number(cfg.indicatorMax)||10;

  var html='<div class="card"><h3>تقييم المقابلة</h3>'+
    '<p class="card-sub">قيّم سلوك الطالب المنتقل من الإعدادية إلى التعليم الفني (كل مؤشر من '+max+'). المقابلة تمثّل '+esc(cfg.weightInterview)+'% من الدرجة.</p>'+
    '<div class="field"><label>اختر الطالب</label><select id="iv-stu"><option value="">— اختر —</option>'+
    students.map(function(s){return '<option value="'+esc(s.nationalId)+'">'+esc(s.name)+' — '+esc(s.nationalId)+'</option>';}).join("")+'</select></div>'+
    '<div id="iv-head"></div>'+
    '<div id="iv-form" class="hidden">';
  inds.forEach(function(q,i){
    html+='<div class="indicator"><div class="q">'+(i+1)+'. '+esc(q)+'</div><div class="rating" id="rate'+i+'">';
    for(var n=1;n<=max;n++) html+='<button class="r" data-i="'+i+'" data-v="'+n+'">'+n+'</button>';
    html+='</div></div>';
  });
  html+='<button class="btn btn-primary" id="iv-save">حفظ تقييم المقابلة</button>'+
    '<div id="iv-decision"></div></div></div>';
  screenEl().innerHTML=html;

  var vals=inds.map(function(){return 0;});
  var current=null;
  $("iv-stu").onchange=async function(){
    vals=inds.map(function(){return 0;});
    $("iv-decision").innerHTML="";
    if(!this.value){ $("iv-form").classList.add("hidden"); $("iv-head").innerHTML=""; return; }
    current=students.filter(function(s){return String(s.nationalId)===$("iv-stu").value;})[0];
    var res=await api("getResult",{nationalId:$("iv-stu").value});
    var r=res.ok?res.result:{};
    $("iv-head").innerHTML=studentHeader(current, r);
    $("iv-form").classList.remove("hidden");
    // إعادة ضبط أزرار التقييم
    inds.forEach(function(_,i){ Array.prototype.forEach.call($("rate"+i).children,function(c){c.classList.remove("on");}); });
  };
  Array.prototype.forEach.call(document.getElementsByClassName("r"),function(btn){
    btn.onclick=function(){
      var i=+btn.dataset.i, v=+btn.dataset.v; vals[i]=v;
      Array.prototype.forEach.call($("rate"+i).children,function(c){ c.classList.toggle("on",+c.dataset.v<=v); });
    };
  });
  $("iv-save").onclick=async function(){
    if(!$("iv-stu").value){ toast("اختر الطالب","err"); return; }
    if(vals.some(function(v){return v===0;})){ toast("قيّم كل المؤشرات ("+inds.length+")","err"); return; }
    var r=await api("submitInterview",{nationalId:$("iv-stu").value,evaluator:state.user.username,role:state.user.name,scores:vals});
    if(!r.ok){ toast(r.error||"خطأ","err"); return; }
    toast("تم حفظ تقييمك للمقابلة","ok");
    var res=await api("getResult",{nationalId:$("iv-stu").value});
    if(res.ok) showDecision(res.result);
  };
};
function studentHeader(s, r){
  s=s||{};
  var cell=function(l,v){ return '<div class="ih-cell"><div class="ih-l">'+esc(l)+'</div><div class="ih-v">'+esc(v)+'</div></div>'; };
  var pct=function(v){ return v==null?"—":v+"%"; };
  var d=(r&&r.langDetail)||{};
  return '<div class="ih">'+
    '<div class="ih-row">'+
      cell("الاسم", s.name||"—")+ cell("الرقم القومي", s.nationalId||"—")+ cell("المدرسة", s.school||"—")+
    '</div>'+
    '<div class="ih-row ih-grades">'+
      cell("امتحان الوحدة", r&&r.unitGrade!=null? r.unitGrade+" ("+pct(r.unitPct)+")" : "لم تُدخل")+
      cell("الامتحان اللغوي (الإجمالي)", r? pct(r.langPct) : "—")+
      cell("موبايل ولي الأمر", s.guardianPhone||"—")+
    '</div>'+
    (r&&r.langDetail? '<div class="ih-row ih-grades">'+
      cell("استماع إنجليزي", pct(d.enListen))+ cell("الترجمة", pct(d.translate))+ cell("استماع عربي", pct(d.arListen))+
    '</div>' : '')+
    (r&&r.retakeGranted? '<div class="ih-retake">↻ مُنِح هذا الطالب فرصة إعادة الامتحان اللغوي من مدير البرنامج'+(r.langPct==null?' (بانتظار إعادة الأداء)':'')+'</div>' : '')+
    '</div>';
}
function showDecision(r){
  var box=$("iv-decision");
  var accepted=r.accepted;
  box.innerHTML='<div class="divider"></div>'+
    '<div class="decision '+(accepted?"acc":"rej")+'">'+
      '<div class="decision-final"><span>الدرجة الكلية</span><b>'+(r.finalScore==null?"—":r.finalScore)+' / 100</b></div>'+
      '<div class="decision-badge">'+(r.complete? (accepted?"مقبول مبدئيًا (اجتاز درجة القبول '+r.acceptanceScore+')":"أقل من درجة القبول ("+r.acceptanceScore+")") : "التقييم غير مكتمل بعد: "+esc((r.missing||[]).join("، ")))+'</div>'+
    '</div>'+
    '<div class="note-box">ملحوظة للجنة: حصول الطالب على درجة القبول لا يعني بالضرورة الالتحاق، إذ سيتم إجراء تنسيق باختيار أفضل الدرجات بعد ترتيب المتقدّمين الذين اجتازوا الاختبارات والمقابلة من الأعلى إلى الأقل.</div>';
  box.scrollIntoView({behavior:"smooth",block:"nearest"});
}

/* ---- النتائج ---- */
RENDER.results = async function(){
  var b=await boot(); var rs=b.results; var students=b.students;
  var passedCount=rs.filter(function(r){return r.complete&&r.accepted;}).length;
  var html='<div class="card"><div class="section-head"><h3>النتائج النهائية</h3>'+
    '<button class="btn btn-accent btn-sm" id="exp-results">⬇ تصدير المجتازين (Excel)</button></div>'+
    '<p class="card-sub">المعادلة: 50% مقابلة + 30% امتحان الوحدة + 20% الامتحان اللغوي. عدد المجتازين لدرجة القبول: <b>'+passedCount+'</b>.</p>'+
    (rs.length? resultsTable(rs) : '<div class="empty"><div class="big">◈</div>لا توجد نتائج بعد</div>')+'</div>'+
    '<div id="scorecard-area"></div>';
  screenEl().innerHTML=html;

  $("exp-results").onclick=function(){ exportPassed(rs, students); };
};
// تصدير المجتازين (اكتمل تقييمهم + اجتازوا درجة القبول) مرتّبين من الأعلى للأقل — لأغراض التنسيق
async function exportPassed(rs, students){
  await ensureXLSX();
  if(typeof XLSX==="undefined"){ toast("مكتبة Excel غير متاحة","err"); return; }
  var byId={}; (students||[]).forEach(function(s){ byId[String(s.nationalId)]=s; });
  var passed=rs.filter(function(r){return r.complete&&r.accepted;})
               .sort(function(a,b){return (b.finalScore||0)-(a.finalScore||0);});
  if(!passed.length){ toast("لا يوجد طلاب مجتازون للتصدير","err"); return; }
  var rows=passed.map(function(r,i){
    var s=byId[String(r.nationalId)]||{};
    return {
      "الترتيب": i+1,
      "الاسم الرباعي": r.name||s.name||"",
      "الرقم القومي": r.nationalId,
      "المدرسة المتقدَّم عليها": s.school||"",
      "موبايل الطالب": s.studentPhone||"",
      "موبايل ولي الأمر": s.guardianPhone||"",
      "الايميل": s.email||"",
      "امتحان الوحدة %": r.unitPct==null?"":r.unitPct,
      "الامتحان اللغوي %": r.langPct==null?"":r.langPct,
      "المقابلة %": r.interviewPct==null?"":r.interviewPct,
      "الدرجة الكلية": r.finalScore==null?"":r.finalScore,
      "درجة القبول": r.acceptanceScore,
      "الحالة": "مجتاز"
    };
  });
  var ws=XLSX.utils.json_to_sheet(rows);
  ws["!views"]=[{RTL:true}];
  ws["!cols"]=[{wch:7},{wch:26},{wch:16},{wch:28},{wch:14},{wch:14},{wch:22},{wch:13},{wch:15},{wch:12},{wch:12},{wch:10},{wch:9}];
  var wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "التنسيق");
  var d=new Date(), pad=function(n){return (n<10?"0":"")+n;};
  var fname="نتائج_التنسيق_"+d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())+".xlsx";
  XLSX.writeFile(wb, fname);
  toast("تم تصدير "+passed.length+" طالبًا مجتازًا","ok");
}
function resultsTable(rs){
  if(!rs.length) return '<div class="empty">لا توجد بيانات</div>';
  return '<div class="table-wrap"><table><thead><tr><th>الطالب</th><th>الوحدة<br><small>30%</small></th><th>لغوي<br><small>20%</small></th><th>مقابلة<br><small>50%</small></th><th>النهائية</th><th>الحالة</th></tr></thead><tbody>'+
    rs.map(function(r){
      return '<tr style="cursor:pointer" onclick=\'showScorecard('+JSON.stringify(r).replace(/'/g,"&#39;")+')\'>'+
        '<td><b>'+esc(r.name)+'</b><br><span style="font-size:12px;color:var(--muted)">'+esc(r.nationalId)+'</span></td>'+
        '<td>'+cell(r.unitPct)+'</td><td>'+cell(r.langPct)+'</td>'+
        '<td>'+cell(r.interviewPct)+(r.evaluatorsCount?' <span style="font-size:11px;color:var(--muted)">('+r.evaluatorsCount+' مقيّم)</span>':'')+'</td>'+
        '<td><b style="font-family:Cairo;font-size:16px;color:var(--teal-700)">'+(r.finalScore==null?"—":r.finalScore)+'</b></td>'+
        '<td>'+(r.complete?(r.accepted?'<span class="pill pill-ok">مقبول</span>':'<span class="pill pill-no">غير مقبول</span>'):'<span class="pill pill-wait">ناقص</span>')+'</td></tr>';
    }).join("")+'</tbody></table></div>';
}
function cell(v){ return v==null?'<span style="color:var(--muted)">—</span>':(v+'%'); }
function showScorecard(r){
  var w=r.weights||{interview:50,unit:30,lang:20};
  var iC=(r.interviewPct||0)/100*w.interview, uC=(r.unitPct||0)/100*w.unit, lC=(r.langPct||0)/100*w.lang;
  var area=$("scorecard-area");
  area.innerHTML='<div class="card"><h3>بطاقة درجات الطالب</h3><div class="scorecard">'+
    '<div class="top"><div class="who">'+esc(r.name)+' — '+esc(r.nationalId)+'</div>'+
    '<div class="final">'+(r.finalScore==null?"—":r.finalScore)+'<small> / 100</small></div>'+
    '<div class="segbar"><span class="seg-i" style="width:'+iC+'%"></span><span class="seg-u" style="width:'+uC+'%"></span><span class="seg-l" style="width:'+lC+'%"></span></div>'+
    '<div style="font-size:12.5px;opacity:.9">'+(r.complete?"التقييم مكتمل":"ناقص: "+esc((r.missing||[]).join("، ")))+'</div></div>'+
    '<div class="breakdown">'+
      segCard("المقابلة",r.interviewPct,w.interview,"var(--teal-500)")+
      segCard("امتحان الوحدة",r.unitPct,w.unit,"var(--amber)")+
      segCard("الامتحان اللغوي",r.langPct,w.lang,"var(--success)")+
    '</div></div>'+
    '<div style="margin-top:14px"><button class="btn btn-ghost btn-sm" id="print-ans" data-nid="'+esc(r.nationalId)+'" data-name="'+esc(r.name||"")+'">🖨 طباعة أسئلة وإجابات المتقدّم</button></div>'+
    '</div>';
  area.scrollIntoView({behavior:"smooth"});
  if($("print-ans")) $("print-ans").onclick=function(){ printAnswers(this.dataset.nid); };
}
async function printAnswers(nid){
  var r=await api("getLangAnswers",{nationalId:nid});
  if(!r.ok){ toast(r.error||"لا توجد إجابات","err"); return; }
  var a=r.answers||{};
  var sec=function(title,qDir,q,aDir,ans,score){
    return '<div class="print-q"><div class="pq-title">'+esc(title)+' <span class="pq-score">('+ (score==null?"—":score) +'/100)</span></div>'+
      '<div class="pq-label">النص:</div><div class="pq-text" dir="'+qDir+'">'+esc(q||"—")+'</div>'+
      '<div class="pq-label">إجابة المتقدّم:</div><div class="pq-ans" dir="'+aDir+'">'+esc(ans&&ans.trim()?ans:"(لا توجد إجابة)")+'</div></div>';
  };
  var when = r.timestamp? new Date(r.timestamp).toLocaleString('ar-EG') : "";
  var doc='<div class="print-doc">'+
    '<div class="print-head"><h2>كشف إجابات المتقدّم في الامتحان اللغوي</h2>'+
    '<div class="print-meta">الاسم: <b>'+esc(r.student.name)+'</b> • الرقم القومي: <b>'+esc(r.student.nationalId)+'</b>'+
    (r.student.school?' • المدرسة: <b>'+esc(r.student.school)+'</b>':'')+'<br>الدرجة الكلية للامتحان اللغوي: <b>'+esc(r.langTotal)+'/100</b>'+(when?' • التاريخ: '+esc(when):'')+'</div></div>'+
    sec("القسم 1 — استماع إنجليزي","ltr",a.enListen&&a.enListen.text,"ltr",a.enListen&&a.enListen.answer,a.enListen&&a.enListen.score)+
    sec("القسم 2 — الترجمة (نص إنجليزي → عربي)","ltr",a.translate&&a.translate.text,"rtl",a.translate&&a.translate.answer,a.translate&&a.translate.score)+
    sec("القسم 3 — استماع عربي","rtl",a.arListen&&a.arListen.text,"rtl",a.arListen&&a.arListen.answer,a.arListen&&a.arListen.score)+
    '<div class="print-sign">توقيع لجنة المقابلة: ............................</div>'+
    '</div>';
  var ov=$("print-overlay");
  if(!ov){ ov=document.createElement("div"); ov.id="print-overlay"; document.body.appendChild(ov); }
  ov.innerHTML='<div class="print-toolbar no-print"><button class="btn btn-primary btn-sm" onclick="window.print()">🖨 طباعة</button>'+
    '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'print-overlay\').remove()">إغلاق</button></div>'+doc;
  ov.style.display="block";
}
function segCard(l,pct,w,color){
  return '<div class="b"><div class="lab"><span class="dot" style="background:'+color+'"></span>'+esc(l)+'</div>'+
    '<div class="v">'+(pct==null?"—":pct+"%")+'</div><div class="w">الوزن '+w+'%</div></div>';
}

/* ---- تقرير ---- */
RENDER.report = async function(){
  var b=await boot(); var cfg=b.config;
  var schools=[]; try{ schools=JSON.parse(cfg.schools); }catch(e){ schools=[]; }
  var rs=b.results;
  var students=b.students;
  var byId={}; students.forEach(function(s){ byId[String(s.nationalId)]=s; });
  // دمج بيانات الطالب في النتيجة
  rs.forEach(function(r){ var s=byId[String(r.nationalId)]||{}; r.school=s.school||""; r.studentPhone=s.studentPhone||""; r.guardianPhone=s.guardianPhone||""; r.email=s.email||""; });
  window._REPORT_ROWS=rs;

  var html='<div class="card"><h3>تقرير النتائج</h3>'+
    '<p class="card-sub">فلترة النتائج ثم تصديرها. «تصدير ملف الوحدة» يخرج كشفًا بصيغة الوحدة (مقبول/قائمة انتظار).</p>'+
    '<div class="grid-2">'+
      '<div class="field"><label>بحث بالاسم</label><select id="rp-name"><option value="">الكل</option>'+
        students.map(function(s){return '<option value="'+esc(s.name)+'">'+esc(s.name)+'</option>';}).join("")+'</select></div>'+
      '<div class="field"><label>الرقم القومي (المسجّلون)</label><select id="rp-nid"><option value="">الكل</option>'+
        students.map(function(s){return '<option value="'+esc(s.nationalId)+'">'+esc(s.nationalId)+' — '+esc(s.name)+'</option>';}).join("")+'</select></div>'+
      '<div class="field"><label>المدرسة</label><select id="rp-school"><option value="">الكل</option>'+schools.map(function(s){return '<option>'+esc(s)+'</option>';}).join("")+'</select></div>'+
      '<div class="field"><label>يوم الامتحان اللغوي</label><input id="rp-date" type="date"></div>'+
      '<div class="field"><label>الحالة</label><select id="rp-status"><option value="">الكل</option><option value="acc">مقبول</option><option value="rej">غير مقبول</option><option value="done">مكتمل التقييم فقط</option></select></div>'+
      '<div class="field"><label>فلترة حسب امتحان</label><select id="rp-exam"><option value="final">الدرجة الكلية</option><option value="unit">امتحان الوحدة</option><option value="lang">الامتحان اللغوي</option><option value="interview">المقابلة</option></select></div>'+
      '<div class="field"><label>الحد الأدنى للنسبة/الدرجة</label><input id="rp-min" type="number" min="0" placeholder="مثال: 60"></div>'+
    '</div>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap">'+
      '<button class="btn btn-primary btn-sm" id="rp-apply">تطبيق الفلترة</button>'+
      '<button class="btn btn-ghost btn-sm" id="rp-reset">إلغاء الفلترة</button>'+
      '<span style="flex:1"></span>'+
      '<button class="btn btn-ghost btn-sm" id="rp-xlsx">⬇ Excel</button>'+
      '<button class="btn btn-ghost btn-sm" id="rp-pdf">⬇ PDF</button>'+
      '<button class="btn btn-ghost btn-sm" id="rp-word">⬇ Word</button>'+
      '<button class="btn btn-accent btn-sm" id="rp-unit">⬇ تصدير ملف الوحدة</button>'+
      '<button class="btn btn-primary btn-sm" id="rp-sheet">🗂 تحديث كشف Google Sheet</button>'+
    '</div></div>'+
    '<div class="card"><div id="rp-count" class="card-sub"></div><div id="rp-table"></div></div>';
  screenEl().innerHTML=html;

  function filtered(){
    var nm=($("rp-name").value||"").trim();
    var nid=($("rp-nid").value||"").trim();
    var sch=$("rp-school").value, st=$("rp-status").value, day=$("rp-date").value;
    var exam=$("rp-exam").value, min=$("rp-min").value!==""?Number($("rp-min").value):null;
    var val=function(r){ return exam==="unit"?r.unitPct : exam==="lang"?r.langPct : exam==="interview"?r.interviewPct : r.finalScore; };
    return window._REPORT_ROWS.filter(function(r){
      if(nm && String(r.name||"")!==nm) return false;
      if(nid && String(r.nationalId)!==nid) return false;
      if(sch && r.school!==sch) return false;
      if(st==="acc" && !(r.complete&&r.accepted)) return false;
      if(st==="rej" && !(r.complete&&!r.accepted)) return false;
      if(st==="done" && !r.complete) return false;
      if(day){ var d=r.langDate?new Date(r.langDate):null; if(!d) return false; if(d.toISOString().slice(0,10)!==day) return false; }
      if(min!=null){ var v=val(r); if(v==null || v<min) return false; }
      return true;
    }).sort(function(a,b){return (b.finalScore||0)-(a.finalScore||0);});
  }
  function draw(){
    var rows=filtered(); window._REPORT_FILTERED=rows;
    $("rp-count").textContent="عدد النتائج: "+rows.length;
    $("rp-table").innerHTML = rows.length? reportTable(rows) : '<div class="empty">لا نتائج مطابقة</div>';
  }
  $("rp-apply").onclick=draw;
  $("rp-reset").onclick=function(){ ["rp-name","rp-nid","rp-school","rp-date","rp-status","rp-min"].forEach(function(id){$(id).value="";}); $("rp-exam").value="final"; draw(); };
  ["rp-name","rp-nid"].forEach(function(id){ $(id).addEventListener("change", draw); });
  $("rp-xlsx").onclick=function(){ exportReportExcel(window._REPORT_FILTERED||[]); };
  $("rp-pdf").onclick=function(){ exportReportPrint(window._REPORT_FILTERED||[], "pdf"); };
  $("rp-word").onclick=function(){ exportReportWord(window._REPORT_FILTERED||[]); };
  $("rp-unit").onclick=function(){ exportUnitFile(window._REPORT_FILTERED||[], $("rp-school").value); };
  $("rp-sheet").onclick=async function(){
    this.disabled=true; this.textContent="جارٍ التحديث…";
    var r=await api("exportResultsSheet");
    this.disabled=false; this.textContent="🗂 تحديث كشف Google Sheet";
    if(r.ok) toast(r.demo?"(الوضع التجريبي) لا يوجد شيت حقيقي":"تم تحديث «كشف النتائج» في Google Sheet ("+r.count+" طالب)","ok");
    else toast(r.error||"تعذّر التحديث","err");
  };
  draw();
};
function reportTable(rows){
  return '<div class="table-wrap"><table><thead><tr><th>م</th><th>الاسم</th><th>الرقم القومي</th><th>المدرسة</th><th>وحدة%</th><th>لغوي%</th><th>مقابلة%</th><th>الكلية</th><th>الحالة</th><th>يوم الامتحان</th><th></th></tr></thead><tbody>'+
    rows.map(function(r,i){
      var day=r.langDate?new Date(r.langDate).toLocaleDateString('ar-EG'):"—";
      var c=function(v){return v==null?"—":v;};
      return '<tr><td>'+(i+1)+'</td><td><b>'+esc(r.name)+'</b></td><td>'+esc(r.nationalId)+'</td><td>'+esc(r.school||"—")+'</td>'+
        '<td>'+c(r.unitPct)+'</td><td>'+c(r.langPct)+'</td><td>'+c(r.interviewPct)+'</td>'+
        '<td><b>'+c(r.finalScore)+'</b></td>'+
        '<td>'+(r.complete?(r.accepted?'<span class="pill pill-ok">مقبول</span>':'<span class="pill pill-no">غير مقبول</span>'):'<span class="pill pill-wait">ناقص</span>')+'</td>'+
        '<td>'+esc(day)+'</td>'+
        '<td><button class="btn btn-ghost btn-sm" onclick="studentReport(\''+esc(r.nationalId)+'\')">📄 تقرير</button></td></tr>';
    }).join("")+'</tbody></table></div>';
}
// تقرير طالب فردي مرفق بإجاباته في الامتحان اللغوي
async function studentReport(nid){
  var res=await api("getResult",{nationalId:nid});
  if(!res.ok){ toast(res.error||"خطأ","err"); return; }
  var r=res.result;
  var s=(window._REPORT_ROWS||[]).filter(function(x){return String(x.nationalId)===String(nid);})[0]||{};
  var la=await api("getLangAnswers",{nationalId:nid});
  var a=(la.ok?la.answers:null)||{};
  var pct=function(v){return v==null?"—":v+"%";};
  var d=r.langDetail||{};
  var scoreRow=function(l,v){return '<tr><td style="border:1px solid #333;padding:6px">'+esc(l)+'</td><td style="border:1px solid #333;padding:6px;text-align:center">'+v+'</td></tr>';};
  var scores='<table style="border-collapse:collapse;width:100%;font-size:13px" dir="rtl">'+
    scoreRow("امتحان الوحدة", (r.unitGrade!=null? r.unitGrade+" ("+pct(r.unitPct)+")":"—"))+
    scoreRow("الاستماع الإنجليزي", pct(d.enListen))+
    scoreRow("الترجمة", pct(d.translate))+
    scoreRow("الاستماع العربي", pct(d.arListen))+
    scoreRow("الامتحان اللغوي (الإجمالي)", pct(r.langPct))+
    scoreRow("المقابلة", pct(r.interviewPct)+(r.evaluatorsCount?(" — "+r.evaluatorsCount+" مقيّم"):""))+
    scoreRow("<b>الدرجة الكلية</b>", "<b>"+(r.finalScore==null?"—":r.finalScore)+" / 100</b>")+
    scoreRow("حالة القبول", r.complete?(r.accepted?"مقبول":"علي قائمة الانتظار"):"غير مكتمل")+
    '</table>';
  var sec=function(title,qDir,q,aDir,ans){
    return '<div class="print-q"><div class="pq-title">'+esc(title)+'</div>'+
      '<div class="pq-label">النص:</div><div class="pq-text" dir="'+qDir+'">'+esc(q||"—")+'</div>'+
      '<div class="pq-label">إجابة المتقدّم:</div><div class="pq-ans" dir="'+aDir+'">'+esc(ans&&String(ans).trim()?ans:"(لا توجد إجابة)")+'</div></div>';
  };
  var answersHTML = la.ok ? (
    '<h3 style="margin:18px 0 8px">إجابات الامتحان اللغوي</h3>'+
    sec("استماع إنجليزي","ltr",a.enListen&&a.enListen.text,"ltr",a.enListen&&a.enListen.answer)+
    sec("الترجمة (إنجليزي → عربي)","ltr",a.translate&&a.translate.text,"rtl",a.translate&&a.translate.answer)+
    sec("استماع عربي","rtl",a.arListen&&a.arListen.text,"rtl",a.arListen&&a.arListen.answer)
  ) : '<div class="hint" style="margin-top:12px">لا توجد إجابات امتحان لغوي محفوظة لهذا الطالب.</div>';

  var head='<div style="text-align:center;margin-bottom:10px">'+
    '<div style="font-weight:800;font-size:18px">وزارة التربية والتعليم والتعليم الفني</div>'+
    '<div style="font-weight:700">وحدة تشغيل وإدارة مدارس التكنولوجيا التطبيقية</div>'+
    '<div style="margin-top:4px">تقرير نتيجة الطالب</div></div>';
  var info='<div class="print-meta" style="margin-bottom:12px">الاسم: <b>'+esc(r.name)+'</b> • الرقم القومي: <b>'+esc(r.nationalId)+'</b>'+
    (s.school?' • المدرسة: <b>'+esc(s.school)+'</b>':'')+
    (s.studentPhone?'<br>موبايل الطالب: '+esc(s.studentPhone):'')+(s.guardianPhone?' • موبايل ولي الأمر: '+esc(s.guardianPhone):'')+'</div>';

  var adminBtn = (state.user.role==="admin")?
    '<button class="btn btn-accent btn-sm no-print" id="rt-grant" data-nid="'+esc(r.nationalId)+'">↻ منح فرصة إعادة الامتحان اللغوي</button>' : '';

  var ov=$("print-overlay");
  if(!ov){ ov=document.createElement("div"); ov.id="print-overlay"; document.body.appendChild(ov); }
  ov.innerHTML='<div class="print-toolbar no-print"><button class="btn btn-primary btn-sm" onclick="window.print()">🖨 طباعة / حفظ PDF</button>'+
    adminBtn+
    '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'print-overlay\').remove()">إغلاق</button></div>'+
    '<div class="print-doc">'+head+info+scores+answersHTML+'</div>';
  ov.style.display="block";
  if($("rt-grant")) $("rt-grant").onclick=async function(){
    if(!confirm("سيتم فتح الامتحان اللغوي لهذا الطالب لأدائه مرة أخرى، وسيظهر ذلك للمقيّمين. متابعة؟")) return;
    var rr=await api("resetLangExam",{nationalId:this.dataset.nid});
    if(rr.ok){ toast("تم منح فرصة إعادة الامتحان","ok"); document.getElementById("print-overlay").remove(); }
    else toast(rr.error||"خطأ","err");
  };
}
function reportRows(rows){
  return rows.map(function(r,i){
    return {
      "م": i+1, "الاسم": r.name||"", "الرقم القومي": r.nationalId,
      "المدرسة": r.school||"", "موبايل الطالب": r.studentPhone||"", "موبايل ولي الأمر": r.guardianPhone||"",
      "امتحان الوحدة %": r.unitPct==null?"":r.unitPct, "الامتحان اللغوي %": r.langPct==null?"":r.langPct,
      "المقابلة %": r.interviewPct==null?"":r.interviewPct, "الدرجة الكلية": r.finalScore==null?"":r.finalScore,
      "الحالة": r.complete?(r.accepted?"مقبول":"غير مقبول"):"ناقص",
      "يوم الامتحان": r.langDate?new Date(r.langDate).toLocaleDateString('ar-EG'):""
    };
  });
}
async function exportReportExcel(rows){
  if(!rows.length){ toast("لا نتائج للتصدير","err"); return; }
  await ensureXLSX();
  var ws=XLSX.utils.json_to_sheet(reportRows(rows)); ws["!views"]=[{RTL:true}];
  ws["!cols"]=[{wch:5},{wch:26},{wch:16},{wch:26},{wch:14},{wch:14},{wch:13},{wch:15},{wch:11},{wch:12},{wch:11},{wch:13}];
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "تقرير");
  XLSX.writeFile(wb, "تقرير_النتائج_"+dateStamp()+".xlsx");
  toast("تم تصدير Excel","ok");
}
// كشف بصيغة الوحدة (يشبه نموذج مدينة نصر)
async function exportUnitFile(rows, school){
  if(!rows.length){ toast("لا نتائج للتصدير","err"); return; }
  await ensureXLSX();
  var title1="وزارة التربية والتعليم والتعليم الفني";
  var title2="وحدة تشغيل وإدارة مدارس التكنولوجيا التطبيقية";
  var title3="كشف نتائج الطلاب بعد إجراء المقابلات"+(school?(" — "+school):"");
  var head=["م","اسم الطالب","كود الطالب","رقم الموبيل","درجة القبول (العظمى 100)","حالة القبول","ملاحظات"];
  var aoa=[[title1],[title2],[title3],[],head];
  rows.forEach(function(r,i){
    aoa.push([ i+1, r.name||"", r.nationalId, r.studentPhone||"",
      (r.finalScore==null?"":r.finalScore),
      (r.complete?(r.accepted?"مقبول":"علي قائمة الانتظار"):"غير مكتمل"), "" ]);
  });
  var ws=XLSX.utils.aoa_to_sheet(aoa); ws["!views"]=[{RTL:true}];
  ws["!cols"]=[{wch:5},{wch:28},{wch:16},{wch:14},{wch:20},{wch:16},{wch:14}];
  ws["!merges"]=[
    {s:{r:0,c:0},e:{r:0,c:6}},{s:{r:1,c:0},e:{r:1,c:6}},{s:{r:2,c:0},e:{r:2,c:6}}
  ];
  var wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "كشف الوحدة");
  XLSX.writeFile(wb, "كشف_الوحدة_"+dateStamp()+".xlsx");
  toast("تم تصدير ملف الوحدة","ok");
}
function reportDocHTML(rows, forPrint){
  var head='<div style="text-align:center;margin-bottom:10px">'+
    '<div style="font-weight:800;font-size:18px">وزارة التربية والتعليم والتعليم الفني</div>'+
    '<div style="font-weight:700">وحدة تشغيل وإدارة مدارس التكنولوجيا التطبيقية</div>'+
    '<div style="margin-top:4px">كشف نتائج الطلاب بعد إجراء المقابلات</div></div>';
  var th=function(t){return '<th style="border:1px solid #333;padding:6px;background:#eee">'+t+'</th>';};
  var td=function(t){return '<td style="border:1px solid #333;padding:6px;text-align:center">'+t+'</td>';};
  var rowsHtml=rows.map(function(r,i){
    var status=r.complete?(r.accepted?"مقبول":"علي قائمة الانتظار"):"غير مكتمل";
    return '<tr>'+td(i+1)+td(esc(r.name||""))+td(esc(r.nationalId))+td(esc(r.studentPhone||""))+
      td(r.finalScore==null?"—":r.finalScore)+td(status)+td("")+'</tr>';
  }).join("");
  var table='<table style="border-collapse:collapse;width:100%;font-family:Tajawal,Arial,sans-serif;font-size:13px" dir="rtl">'+
    '<thead><tr>'+th("م")+th("اسم الطالب")+th("كود الطالب")+th("رقم الموبيل")+th("درجة القبول (العظمى 100)")+th("حالة القبول")+th("ملاحظات")+'</tr></thead>'+
    '<tbody>'+rowsHtml+'</tbody></table>';
  return '<div dir="rtl" style="font-family:Tajawal,Arial,sans-serif">'+head+table+
    '<div style="margin-top:20px;font-size:13px">عدد الطلاب: '+rows.length+'</div></div>';
}
function exportReportWord(rows){
  if(!rows.length){ toast("لا نتائج للتصدير","err"); return; }
  var html='<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body dir="rtl">'+reportDocHTML(rows)+'</body></html>';
  var blob=new Blob(['\ufeff'+html], {type:"application/msword"});
  var url=URL.createObjectURL(blob); var a=document.createElement("a");
  a.href=url; a.download="تقرير_النتائج_"+dateStamp()+".doc"; document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  toast("تم تصدير Word","ok");
}
function exportReportPrint(rows){
  if(!rows.length){ toast("لا نتائج للتصدير","err"); return; }
  var ov=$("print-overlay");
  if(!ov){ ov=document.createElement("div"); ov.id="print-overlay"; document.body.appendChild(ov); }
  ov.innerHTML='<div class="print-toolbar no-print"><button class="btn btn-primary btn-sm" onclick="window.print()">🖨 طباعة / حفظ PDF</button>'+
    '<button class="btn btn-ghost btn-sm" onclick="document.getElementById(\'print-overlay\').remove()">إغلاق</button></div>'+
    '<div class="print-doc">'+reportDocHTML(rows,true)+'</div>';
  ov.style.display="block";
}
function dateStamp(){ var d=new Date(),p=function(n){return(n<10?"0":"")+n;}; return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate()); }

/* ---- المستخدمون ---- */
RENDER.users = async function(){
  var users=(await apiC("listUsers")).users||[];
  var html='<div class="card"><h3>إضافة مستخدم</h3>'+
    '<div class="grid-2">'+field("u-user","اسم المستخدم","text","",true)+field("u-pass","كلمة المرور","text","",true)+
    field("u-name","الاسم المعروض","text","")+
    '<div class="field"><label>الدور</label><select id="u-role"><option value="committee">عضو لجنة مقابلة</option><option value="admin">مدير برنامج</option></select></div></div>'+
    '<button class="btn btn-primary" id="u-add">إضافة المستخدم</button></div>'+
    '<div class="card"><h3>المستخدمون ('+users.length+')</h3><div class="table-wrap"><table><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th></th></tr></thead><tbody>'+
    users.map(function(u){return '<tr><td><b>'+esc(u.name)+'</b></td><td>'+esc(u.username)+'</td><td>'+(u.role==="admin"?"مدير برنامج":"عضو لجنة")+'</td>'+
      '<td>'+(u.username==="admin"?"":'<button class="btn btn-danger btn-sm u-del" data-u="'+esc(u.username)+'">حذف</button>')+'</td></tr>';}).join("")+
    '</tbody></table></div></div>';
  screenEl().innerHTML=html;
  $("u-add").onclick=async function(){
    if(!$("u-user").value.trim()||!$("u-pass").value){ toast("اسم المستخدم وكلمة المرور مطلوبان","err"); return; }
    var r=await api("createUser",{newUsername:$("u-user").value.trim(),newPassword:$("u-pass").value,name:$("u-name").value.trim(),role:$("u-role").value});
    if(r.ok){ toast("تمت إضافة المستخدم","ok"); go("users"); } else toast(r.error||"خطأ","err");
  };
  Array.prototype.forEach.call(document.getElementsByClassName("u-del"),function(b){
    b.onclick=async function(){ var r=await api("deleteUser",{target:b.dataset.u}); if(r.ok){toast("تم الحذف","ok");go("users");} else toast(r.error||"خطأ","err"); };
  });
};

/* ---- الإعدادات ---- */
RENDER.settings = async function(){
  var cfg=(await boot()).config;
  var inds=[]; try{ inds=JSON.parse(cfg.indicators); }catch(e){ inds=[]; }
  var indW=[]; try{ indW=JSON.parse(cfg.indicatorWeights); }catch(e){ indW=[]; }
  while(indW.length<inds.length) indW.push(1);
  var evW={}; try{ evW=JSON.parse(cfg.evaluatorWeights)||{}; }catch(e){ evW={}; }
  var users=(await apiC("listUsers")).users||[];
  var committee=users.filter(function(u){return u.role==="committee";});
  var schools=[]; try{ schools=JSON.parse(cfg.schools); }catch(e){ schools=[]; }
  var H={}; try{ H=JSON.parse(cfg.importHeaders); }catch(e){ H={}; }

  var html='<div class="card"><h3>إعدادات امتحان الوحدة والقبول</h3>'+
    '<div class="grid-2">'+
      field("cf-total","الدرجة الكلية لامتحان الوحدة","number",cfg.unitTotalGrade)+
      field("cf-pass","درجة النجاح المقررة لامتحان الوحدة","number",cfg.unitPassGrade)+
      field("cf-accept","درجة القبول الكلية (من 100)","number",cfg.acceptanceScore||"60")+
    '</div>'+
    toggleHtml("cf-mand","النجاح في امتحان الوحدة شرط إجباري للدخول للمقابلة","إن فُعّل، يُمنع الطالب الذي لم يجتز درجة النجاح.",cfg.unitPassMandatory==="true")+
    toggleHtml("cf-excel","السماح برفع بيانات الطلاب من Excel","يظهر اختيار الطالب المسجّل فتظهر بياناته تلقائيًا.",cfg.excelImportEnabled==="true")+
    '</div>'+

    '<div class="card"><div class="section-head"><h3>مؤشرات المقابلة</h3>'+
      '<div style="display:flex;gap:6px"><button class="btn btn-ghost btn-sm" id="ind-guide">+ المؤشرات الاسترشادية (3)</button>'+
      '<button class="btn btn-ghost btn-sm" id="ind-add">+ إضافة مؤشر</button></div></div>'+
    '<div class="field"><label>الحد الأقصى لدرجة كل مؤشر</label><input id="cf-imax" type="number" value="'+esc(cfg.indicatorMax)+'"></div>'+
    '<p class="hint">لكل مؤشر «وزن» يحدّد أهميته في حساب درجة المقابلة (الافتراضي 1).</p>'+
    '<div class="list-editor" id="ind-list"></div></div>'+

    '<div class="card"><h3>أوزان أعضاء لجنة المقابلة</h3>'+
    '<p class="card-sub">حدِّد وزن كل مقيّم في متوسط المقابلة (الافتراضي 1). اتركه فارغًا ليساوي 1.</p>'+
    '<div class="list-editor" id="ev-list">'+
      (committee.length? committee.map(function(u){
        return '<div class="le-row"><input value="'+esc(u.name)+' ('+esc(u.username)+')" disabled style="flex:2">'+
          '<input type="number" step="0.1" min="0" placeholder="1" value="'+esc(evW[u.username]!=null?evW[u.username]:"")+'" data-ev="'+esc(u.username)+'" style="flex:1"></div>';
      }).join("") : '<p class="hint">لا يوجد أعضاء لجنة. أضِفهم من تبويب المستخدمون.</p>')+
    '</div></div>'+

    '<div class="card"><div class="section-head"><h3>المدارس المتاحة</h3>'+
      '<button class="btn btn-ghost btn-sm" id="sch-add">+ إضافة مدرسة</button></div>'+
    '<p class="card-sub">تظهر كقائمة منسدلة في تسجيل الطالب، مع خيار «أخرى» للإضافة اليدوية.</p>'+
    '<div class="list-editor" id="sch-list"></div></div>'+

    '<div class="card"><h3>رؤوس أعمدة ملف استيراد الطلاب</h3>'+
    '<p class="card-sub">حدِّد اسم العمود في ملف Excel المُصدَّر ليُطابَق مع كل حقل عند الاستيراد.</p>'+
    '<div class="grid-2">'+
      field("h-name","عمود: الاسم الرباعي","text",H.name||"")+
      field("h-nid","عمود: الرقم القومي","text",H.nationalId||"")+
      field("h-school","عمود: المدرسة","text",H.school||"")+
      field("h-sphone","عمود: موبايل الطالب","text",H.studentPhone||"")+
      field("h-gphone","عمود: موبايل ولي الأمر","text",H.guardianPhone||"")+
      field("h-email","عمود: الايميل","text",H.email||"")+
    '</div></div>'+

    '<div class="card"><div class="section-head"><h3>إعدادات الصوت</h3>'+
      '<button class="btn btn-ghost btn-sm" id="v-refresh">تحديث القائمة</button></div>'+
    '<p class="card-sub">اختر الصوت المثبّت على جهاز الامتحان. للإنجليزية اختر صوتًا رجاليًا واضحًا، جرّبه ثم احفظ الأنسب. القائمة تعتمد على الأصوات المتوفّرة في المتصفح/النظام.</p>'+
    '<div class="field"><label>المهلة بين الجُمل أثناء الاستماع (ثوانٍ) — لإتاحة وقت الكتابة</label>'+
      '<input id="v-gap" type="number" min="0" step="1" value="'+esc(cfg.sentenceGap||"3")+'"></div>'+
    '<div class="grid-2">'+
      '<div class="field"><label>صوت اللغة الإنجليزية</label><select id="v-en"></select>'+
        '<button class="btn btn-ghost btn-sm" id="v-en-test" style="margin-top:8px">▶ تجربة الصوت</button></div>'+
      '<div class="field"><label>صوت اللغة العربية</label><select id="v-ar"></select>'+
        '<button class="btn btn-ghost btn-sm" id="v-ar-test" style="margin-top:8px">▶ تجربة الصوت</button></div>'+
    '</div></div>'+

    '<div class="card"><h3>أوزان الدرجة النهائية</h3><p class="card-sub">يجب أن يكون المجموع 100.</p>'+
    '<div class="grid-2">'+field("cf-wI","وزن المقابلة %","number",cfg.weightInterview)+
    field("cf-wU","وزن امتحان الوحدة %","number",cfg.weightUnit)+
    field("cf-wL","وزن الامتحان اللغوي %","number",cfg.weightLang)+'</div>'+
    '<button class="btn btn-primary" id="cf-save">حفظ كل الإعدادات</button></div>';
  screenEl().innerHTML=html;

  // محرّر عام (المدارس)
  function drawList(containerId, arr, placeholder){
    var c=$(containerId); c.innerHTML="";
    arr.forEach(function(val,i){
      var row=document.createElement("div"); row.className="le-row";
      row.innerHTML='<input value="'+esc(val)+'" placeholder="'+esc(placeholder)+'"><button class="btn btn-danger btn-sm">حذف</button>';
      row.querySelector("button").onclick=function(){ arr.splice(i,1); drawList(containerId,arr,placeholder); };
      row.querySelector("input").oninput=function(){ arr[i]=this.value; };
      c.appendChild(row);
    });
    if(!arr.length) c.innerHTML='<p class="hint">لا يوجد عناصر بعد.</p>';
  }
  // محرّر المؤشرات (نص + وزن)
  function drawIndicators(){
    var c=$("ind-list"); c.innerHTML="";
    inds.forEach(function(val,i){
      var row=document.createElement("div"); row.className="le-row";
      row.innerHTML='<input value="'+esc(val)+'" placeholder="نص المؤشر" style="flex:3">'+
        '<input type="number" step="0.1" min="0" value="'+esc(indW[i]!=null?indW[i]:1)+'" title="الوزن" style="flex:1;max-width:90px">'+
        '<button class="btn btn-danger btn-sm">حذف</button>';
      var ins=row.querySelectorAll("input");
      ins[0].oninput=function(){ inds[i]=this.value; };
      ins[1].oninput=function(){ indW[i]=this.value; };
      row.querySelector("button").onclick=function(){ inds.splice(i,1); indW.splice(i,1); drawIndicators(); };
      c.appendChild(row);
    });
    if(!inds.length) c.innerHTML='<p class="hint">لا يوجد مؤشرات بعد.</p>';
  }
  drawIndicators();
  drawList("sch-list", schools, "اسم المدرسة");
  $("ind-add").onclick=function(){ inds.push(""); indW.push(1); drawIndicators(); };
  $("ind-guide").onclick=function(){
    var guide=["العمل ضمن فريق والتواصل مع الآخرين","الالتزام والانضباط وتحمّل المسؤولية","الميول والاستعداد للمجال المهني واليدوي"];
    guide.forEach(function(g){ if(inds.map(function(x){return String(x).trim();}).indexOf(g)<0){ inds.push(g); indW.push(1); } });
    drawIndicators();
    toast("تمت إضافة المؤشرات الاسترشادية — لا تنسَ الحفظ","ok");
  };
  $("sch-add").onclick=function(){ schools.push(""); drawList("sch-list",schools,"اسم المدرسة"); };

  // اختيار الأصوات
  function fillVoices(){
    var voices=("speechSynthesis" in window)? window.speechSynthesis.getVoices() : [];
    function fill(base, selId, curVal){
      var list=voices.filter(function(v){return new RegExp("^"+base,"i").test(v.lang);});
      $(selId).innerHTML='<option value="">(تلقائي — أوضح صوت متاح)</option>'+
        list.map(function(v){return '<option value="'+esc(v.name)+'"'+(v.name===curVal?' selected':'')+'>'+esc(v.name)+' — '+esc(v.lang)+'</option>';}).join("");
    }
    fill("en","v-en",cfg.voiceEn||""); fill("ar","v-ar",cfg.voiceAr||"");
  }
  fillVoices();
  if("speechSynthesis" in window) window.speechSynthesis.onvoiceschanged=fillVoices;
  $("v-refresh").onclick=fillVoices;
  function testVoice(base){
    window.VOICE_PREF=window.VOICE_PREF||{en:"",ar:""};
    window.SENTENCE_GAP=(Number($("v-gap").value)||3)*1000;
    if(base==="en"){ window.VOICE_PREF.en=$("v-en").value; speak("This is the first sentence. This is the second sentence. This is the third sentence.","en",0.45); }
    else { window.VOICE_PREF.ar=$("v-ar").value; speak("هَذِهِ هِيَ الجُمْلَةُ الأُولَى. وَهَذِهِ هِيَ الجُمْلَةُ الثَّانِيَةُ. وَهَذِهِ هِيَ الجُمْلَةُ الثَّالِثَةُ.","ar",0.5); }
  }
  $("v-en-test").onclick=function(){ testVoice("en"); };
  $("v-ar-test").onclick=function(){ testVoice("ar"); };

  wireToggle("cf-mand"); wireToggle("cf-excel");
  $("cf-save").onclick=async function(){
    var wI=+$("cf-wI").value, wU=+$("cf-wU").value, wL=+$("cf-wL").value;
    if(wI+wU+wL!==100){ toast("مجموع الأوزان يجب أن يساوي 100 (حاليًا "+(wI+wU+wL)+")","err"); return; }
    var cleanInds=[], cleanIndW=[];
    inds.forEach(function(x,i){ var t=String(x).trim(); if(t){ cleanInds.push(t); var w=Number(indW[i]); cleanIndW.push(isNaN(w)||indW[i]===""?1:w); } });
    var cleanSch=schools.map(function(x){return String(x).trim();}).filter(Boolean);
    if(!cleanInds.length){ toast("أضف مؤشر مقابلة واحدًا على الأقل","err"); return; }
    var evOut={};
    Array.prototype.forEach.call(document.querySelectorAll('[data-ev]'),function(inp){
      var v=inp.value.trim(); if(v!==""){ var n=Number(v); if(!isNaN(n)) evOut[inp.getAttribute("data-ev")]=n; }
    });
    var config={
      unitTotalGrade:$("cf-total").value, unitPassGrade:$("cf-pass").value, acceptanceScore:$("cf-accept").value,
      unitPassMandatory:$("cf-mand").dataset.on, excelImportEnabled:$("cf-excel").dataset.on,
      indicatorMax:$("cf-imax").value,
      indicators:JSON.stringify(cleanInds),
      indicatorWeights:JSON.stringify(cleanIndW),
      evaluatorWeights:JSON.stringify(evOut),
      schools:JSON.stringify(cleanSch),
      importHeaders:JSON.stringify({
        name:$("h-name").value.trim(), nationalId:$("h-nid").value.trim(), school:$("h-school").value.trim(),
        studentPhone:$("h-sphone").value.trim(), guardianPhone:$("h-gphone").value.trim(), email:$("h-email").value.trim()
      }),
      weightInterview:String(wI), weightUnit:String(wU), weightLang:String(wL),
      voiceEn:$("v-en").value, voiceAr:$("v-ar").value, sentenceGap:$("v-gap").value
    };
    var r=await api("setConfig",{config:config});
    if(r.ok){ window.VOICE_PREF={en:config.voiceEn,ar:config.voiceAr}; window.SENTENCE_GAP=(Number(config.sentenceGap)||3)*1000; toast("تم حفظ الإعدادات","ok"); } else toast(r.error||"خطأ","err");
  };
};
function toggleHtml(id,title,sub,on){
  return '<div class="toggle'+(on?" on":"")+'" id="'+id+'" data-on="'+(on?"true":"false")+'"><div class="sw"></div>'+
    '<div class="tx"><b>'+esc(title)+'</b><span>'+esc(sub)+'</span></div></div>';
}
function wireToggle(id){
  $(id).onclick=function(){ var on=this.dataset.on!=="true"; this.dataset.on=on?"true":"false"; this.classList.toggle("on",on); };
}

/* ---------- إقلاع ---------- */
initLogin();
