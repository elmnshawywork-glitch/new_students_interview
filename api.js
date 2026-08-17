/* ============================================================
 *  API client — يتصل بالـ backend الحقيقي أو يستخدم محاكيًا محليًا
 * ============================================================ */
var API = (function () {
  var creds = { username: "", password: "" };
  function setCreds(u, p) { creds.username = u; creds.password = p; }

  async function call(action, params) {
    params = params || {};
    var body = Object.assign({ action: action }, creds, params);
    var url = (window.APP_CONFIG.BACKEND_URL || "").trim();
    if (!url) return Demo.handle(body);         // وضع تجريبي
    var res = await fetch(url, {
      method: "POST",
      // text/plain لتفادي preflight CORS مع Apps Script
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
      redirect: "follow"
    });
    var text = await res.text();
    try { return JSON.parse(text); }
    catch (e) { return { ok: false, error: "استجابة غير متوقعة من الخادم: " + text.slice(0, 120) }; }
  }
  return { call: call, setCreds: setCreds, isDemo: function(){ return !(window.APP_CONFIG.BACKEND_URL||"").trim(); } };
})();

/* ============================================================
 *  Demo backend (في الذاكرة) — يطابق منطق Code.gs
 * ============================================================ */
var Demo = (function () {
  var DEFAULT_CONFIG = {
    unitTotalGrade: "100", unitPassGrade: "50", unitPassMandatory: "false",
    excelImportEnabled: "true", indicatorMax: "10",
    indicators: JSON.stringify([
      "الثقة بالنفس ووضوح التعبير والتواصل",
      "الدافعية والميل نحو المجال الفني/التكنولوجي",
      "القدرة على التفكير وحل المشكلات وسرعة البديهة",
      "المظهر العام",
      "قدرة الطالب على التعامل مع التكنولوجيا (حاسب آلي/ذكاء اصطناعي)",
      "العمل ضمن فريق والتواصل مع الآخرين",
      "الالتزام والانضباط وتحمّل المسؤولية",
      "الميول والاستعداد للمجال المهني واليدوي"
    ]),
    weightInterview: "50", weightUnit: "30", weightLang: "20",
    acceptanceScore: "60",
    schools: JSON.stringify([
      "مدرسة القاهرة للتكنولوجيا التطبيقية",
      "مدرسة السويس للتكنولوجيا التطبيقية",
      "مدرسة الإسكندرية للتكنولوجيا التطبيقية"
    ]),
    importHeaders: JSON.stringify({
      name:"الاسم", nationalId:"الرقم القومي", school:"المدرسة",
      studentPhone:"موبايل الطالب", guardianPhone:"موبايل ولي الأمر", email:"الايميل"
    }),
    voiceEn:"", voiceAr:"", sentenceGap:"3", indicatorWeights:"", evaluatorWeights:""
  };

  var db = {
    users: [
      { username: "admin", password: "ebda2026", name: "مدير البرنامج", role: "admin" },
      { username: "ats", password: "123456", name: "ممثل وحدة المدارس التكنولوجية", role: "committee" },
      { username: "aca", password: "123456", name: "ممثل الشريك الأكاديمي", role: "committee" },
      { username: "ind", password: "123456", name: "ممثل الشريك الصناعي", role: "committee" }
    ],
    config: Object.assign({}, DEFAULT_CONFIG),
    students: [
      { nationalId: "30201011200123", name: "أحمد محمود علي حسن", school: "مدرسة السويس للتكنولوجيا التطبيقية", studentPhone: "01000000001", guardianPhone: "01000000010", email: "ahmed@example.com", createdAt: Date.now() },
      { nationalId: "30303022300456", name: "منة الله حسن سيد عبد الله", school: "مدرسة القاهرة للتكنولوجيا التطبيقية", studentPhone: "01000000002", guardianPhone: "01000000020", email: "mennah@example.com", createdAt: Date.now() }
    ],
    unitGrades: [ { nationalId: "30201011200123", name: "أحمد محمود علي", grade: 72 } ],
    langResults: [],
    interviews: [],
    retakes: [],
    passages: (window.PASSAGES || []).slice()
  };

  function ok(o){ return Object.assign({ ok: true }, o); }
  function err(m){ return { ok: false, error: m }; }
  function isAdmin(b){ return db.users.some(function(u){return u.username===b.username&&u.password===b.password&&u.role==="admin";}); }
  function validNid(id){ return /^\d{6,20}$/.test(String(id||"").replace(/[^\d]/g,"")); }
  function norm(s){ return String(s||"").replace(/[\u064B-\u0652]/g,"").replace(/[إأآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/\s+/g," ").trim(); }

  function tokens(s){
    return String(s||"").toLowerCase()
      .replace(/[\u064B-\u0652\u0640]/g,"")
      .replace(/[إأآٱ]/g,"ا").replace(/ى/g,"ي").replace(/ة/g,"ه").replace(/ؤ/g,"و").replace(/ئ/g,"ي").replace(/ء/g,"")
      .replace(/[^\u0600-\u06FFa-z0-9\s]/g," ")
      .replace(/\s+/g," ").trim()
      .split(/\s+/).filter(Boolean);
  }
  function scoreTx(ref, ans){
    var a=tokens(ref), b=tokens(ans); if(!a.length) return 0;
    var m={}; b.forEach(function(w){m[w]=(m[w]||0)+1;});
    var hit=0; a.forEach(function(w){ if(m[w]>0){hit++;m[w]--;} });
    return Math.round(hit/a.length*100);
  }
  function pById(id){ return db.passages.filter(function(p){return String(p.id)===String(id);})[0]; }
  function unitGrade(nid){ var g=db.unitGrades.filter(function(x){return String(x.nationalId)===String(nid);})[0]; return g?Number(g.grade):null; }

  function computeResult(nid){
    var c=db.config, iMax=Number(c.indicatorMax)||10;
    var indW=[]; try{indW=JSON.parse(c.indicatorWeights);}catch(e){indW=[];}
    var evW={}; try{evW=JSON.parse(c.evaluatorWeights);}catch(e){evW={};}
    var ivs=db.interviews.filter(function(x){return String(x.nationalId)===String(nid);});
    var interviewPct=null;
    if(ivs.length){
      var wsum=0,wtot=0;
      ivs.forEach(function(v){
        var arr=v.scores||[]; var s=0,w=0;
        arr.forEach(function(sc,i){ var iw=(indW[i]!=null&&indW[i]!=="")?Number(indW[i]):1; s+=(Number(sc)||0)*iw; w+=iw; });
        var pct=w?(s/w)/iMax*100:(Number(v.avg)/iMax*100);
        var ew=(evW[v.evaluator]!=null&&evW[v.evaluator]!=="")?Number(evW[v.evaluator]):1;
        wsum+=pct*ew; wtot+=ew;
      });
      interviewPct=wtot?wsum/wtot:null;
    }
    var ug=unitGrade(nid), uTot=Number(c.unitTotalGrade)||100;
    var unitPct= ug===null?null:(ug/uTot)*100;
    var lang=db.langResults.filter(function(x){return String(x.nationalId)===String(nid);})[0];
    var langPct= lang?Number(lang.langTotal):null;
    var langDetail= lang?{enListen:Number(lang.enListenScore),translate:Number(lang.translateScore),arListen:Number(lang.arListenScore)}:null;
    var langDate= lang&&lang.timestamp? new Date(lang.timestamp).toISOString():null;
    var wI=Number(c.weightInterview)||50, wU=Number(c.weightUnit)||30, wL=Number(c.weightLang)||20;
    var final=0, missing=[];
    final+=((interviewPct||0)/100)*wI; if(interviewPct===null) missing.push("المقابلة");
    final+=((unitPct||0)/100)*wU; if(unitPct===null) missing.push("امتحان الوحدة");
    final+=((langPct||0)/100)*wL; if(langPct===null) missing.push("الامتحان اللغوي");
    var r1=function(x){return x===null?null:Math.round(x*10)/10;};
    var acceptanceScore=Number(c.acceptanceScore)||0;
    return { nationalId:nid, interviewPct:r1(interviewPct), unitPct:r1(unitPct), langPct:r1(langPct),
      unitGrade:ug, langDetail:langDetail, langDate:langDate, weights:{interview:wI,unit:wU,lang:wL}, finalScore:r1(final),
      complete:missing.length===0, missing:missing, evaluatorsCount:ivs.length,
      acceptanceScore:acceptanceScore, accepted:r1(final)>=acceptanceScore,
      retakeGranted: db.retakes.some(function(x){return String(x.nationalId)===String(nid);}) };
  }

  function handle(b){
    return new Promise(function(resolve){
      setTimeout(function(){ resolve(route(b)); }, 180); // محاكاة زمن الشبكة
    });
  }

  function route(b){
    switch(b.action){
      case "login": {
        var u=db.users.filter(function(x){return x.username===b.username&&x.password===b.password;})[0];
        return u?ok({user:{username:u.username,name:u.name,role:u.role}}):err("اسم المستخدم أو كلمة المرور غير صحيحة");
      }
      case "getConfig": return ok({config:Object.assign({},db.config)});
      case "setConfig": {
        if(!isAdmin(b)) return err("تتطلب صلاحية مدير");
        Object.assign(db.config,b.config||{}); return ok({config:Object.assign({},db.config)});
      }
      case "listUsers": return ok({users:db.users.map(function(u){return {username:u.username,name:u.name,role:u.role};})});
      case "createUser": {
        if(!isAdmin(b)) return err("تتطلب صلاحية مدير");
        if(!b.newUsername||!b.newPassword) return err("اسم المستخدم وكلمة المرور مطلوبان");
        if(db.users.some(function(u){return u.username===b.newUsername;})) return err("اسم المستخدم موجود بالفعل");
        db.users.push({username:b.newUsername,password:b.newPassword,name:b.name||b.newUsername,role:b.role||"committee"});
        return ok();
      }
      case "deleteUser": {
        if(!isAdmin(b)) return err("تتطلب صلاحية مدير");
        if(b.target==="admin") return err("لا يمكن حذف حساب المدير الأساسي");
        db.users=db.users.filter(function(u){return u.username!==b.target;}); return ok();
      }
      case "listStudents": return ok({students:db.students.slice()});
      case "registerStudent": {
        var s=b.student||{};
        if(!validNid(s.nationalId)) return err("الرقم القومي يجب أن يكون 14 رقمًا");
        if(!s.name) return err("الاسم مطلوب");
        var ex=db.students.filter(function(x){return x.nationalId===s.nationalId;})[0];
        if(ex) Object.assign(ex,s); else db.students.push(Object.assign({createdAt:Date.now()},s));
        return ok({student:{nationalId:s.nationalId,name:s.name}});
      }
      case "importStudents": {
        if(!isAdmin(b)) return err("تتطلب صلاحية مدير");
        var added=0,updated=0,skipped=0;
        (b.rows||[]).forEach(function(s){
          if(!validNid(s.nationalId)||!s.name){skipped++;return;}
          var nid=String(s.nationalId).replace(/[^\d]/g,"");
          var ex=db.students.filter(function(x){return String(x.nationalId)===nid;})[0];
          if(ex){ Object.assign(ex,s,{nationalId:nid}); updated++; } else { db.students.push(Object.assign({createdAt:Date.now()},s,{nationalId:nid})); added++; }
          if(s.unitGrade!=="" && s.unitGrade!=null && !isNaN(Number(s.unitGrade))){
            var g=db.unitGrades.filter(function(x){return String(x.nationalId)===nid;})[0];
            if(g){g.grade=Number(s.unitGrade);g.name=s.name;} else db.unitGrades.push({nationalId:nid,name:s.name,grade:Number(s.unitGrade)});
          }
        });
        return ok({added:added,updated:updated,skipped:skipped});
      }
      case "getStudent": {
        var st=db.students.filter(function(x){return String(x.nationalId)===String(b.nationalId);})[0];
        return st?ok({student:st}):err("الطالب غير مسجّل");
      }
      case "setUnitGrade": {
        if(!isAdmin(b)) return err("تتطلب صلاحية مدير");
        var g=db.unitGrades.filter(function(x){return x.nationalId===b.nationalId;})[0];
        if(g){g.grade=Number(b.grade)||0;g.name=b.name||g.name;} else db.unitGrades.push({nationalId:b.nationalId,name:b.name||"",grade:Number(b.grade)||0});
        return ok();
      }
      case "importUnitGrades": {
        if(!isAdmin(b)) return err("تتطلب صلاحية مدير");
        var linked=0,skipped=0;
        (b.rows||[]).forEach(function(r){
          var nid=String(r.nationalId||"").trim();
          if(!/^\d{6,20}$/.test(nid)&&r.name){ var m=db.students.filter(function(s){return norm(s.name)===norm(r.name);})[0]; if(m)nid=String(m.nationalId); }
          if(!nid){skipped++;return;}
          var g=db.unitGrades.filter(function(x){return String(x.nationalId)===nid;})[0];
          if(g){g.grade=Number(r.grade)||0;g.name=r.name||g.name;} else db.unitGrades.push({nationalId:nid,name:r.name||"",grade:Number(r.grade)||0});
          linked++;
        });
        return ok({linked:linked,skipped:skipped});
      }
      case "startExam": {
        var prev=db.langResults.filter(function(x){return String(x.nationalId)===String(b.nationalId);})[0];
        if(prev) return {ok:false,blocked:true,taken:true,error:"سبق للطالب أداء الامتحان اللغوي، ولا يُسمح بأدائه أكثر من مرة."};
        var c=db.config;
        if(c.unitPassMandatory==="true"){
          var ug=unitGrade(b.nationalId);
          if(ug===null) return {ok:false,blocked:true,error:"لا توجد درجة امتحان وحدة مسجّلة لهذا الطالب"};
          if(ug<Number(c.unitPassGrade)) return {ok:false,blocked:true,error:"الطالب لم يجتز درجة النجاح في امتحان الوحدة ("+c.unitPassGrade+")"};
        }
        var en=db.passages.filter(function(p){return p.lang==="en";});
        var tr=db.passages.filter(function(p){return p.lang==="tr";}); if(!tr.length) tr=en;
        var ar=db.passages.filter(function(p){return p.lang==="ar";});
        var pick=function(a){return a[Math.floor(Math.random()*a.length)];};
        var enL=pick(en), trp=pick(tr), arL=pick(ar);
        return ok({exam:{ enListen:{id:enL.id,text:enL.text}, translate:{id:trp.id,text:trp.text}, arListen:{id:arL.id,text:arL.text} }});
      }
      case "resetLangExam": {
        if(!isAdmin(b)) return err("تتطلب صلاحية مدير");
        db.langResults=db.langResults.filter(function(x){return String(x.nationalId)!==String(b.nationalId);});
        if(!db.retakes.some(function(x){return String(x.nationalId)===String(b.nationalId);})) db.retakes.push({nationalId:b.nationalId,by:b.username||"admin",timestamp:Date.now()});
        return ok();
      }
      case "gradeExam": {
        var enP=pById(b.enListenId), trP=pById(b.translateId), arP=pById(b.arListenId);
        var enScore=scoreTx(enP?enP.text:"",b.enListenAnswer);
        var arScore=scoreTx(arP?arP.text:"",b.arListenAnswer);
        var trScore=scoreTx(trP?trP.ref_ar:"",b.translateAnswer);
        var langTotal=Math.round((enScore+trScore+arScore)/3);
        var answers={
          enListen:{id:b.enListenId,text:enP?enP.text:"",answer:b.enListenAnswer||"",score:enScore},
          translate:{id:b.translateId,text:trP?trP.text:"",ref:trP?trP.ref_ar:"",answer:b.translateAnswer||"",score:trScore},
          arListen:{id:b.arListenId,text:arP?arP.text:"",answer:b.arListenAnswer||"",score:arScore}
        };
        var row={nationalId:b.nationalId,enListenId:b.enListenId,enListenScore:enScore,translateId:b.translateId,translateScore:trScore,arListenId:b.arListenId,arListenScore:arScore,langTotal:langTotal,feedback:"",answers:answers,timestamp:Date.now()};
        var ex=db.langResults.filter(function(x){return x.nationalId===b.nationalId;})[0];
        if(ex) Object.assign(ex,row); else db.langResults.push(row);
        return ok({scores:{enListen:enScore,translate:trScore,arListen:arScore,langTotal:langTotal},feedback:"(الوضع التجريبي يستخدم التصحيح الآلي البسيط. في النسخة الحقيقية يصحّح الذكاء الاصطناعي.)",method:"auto"});
      }
      case "getLangAnswers": {
        if(!db.users.some(function(u){return u.username===b.username&&u.password===b.password;})) return err("غير مصرّح");
        var lr=db.langResults.filter(function(x){return String(x.nationalId)===String(b.nationalId);})[0];
        if(!lr) return err("لا توجد نتيجة امتحان لغوي لهذا الطالب");
        var st=db.students.filter(function(x){return String(x.nationalId)===String(b.nationalId);})[0]||{};
        return ok({student:{nationalId:b.nationalId,name:st.name||"",school:st.school||""},answers:lr.answers||{},langTotal:lr.langTotal||0,timestamp:lr.timestamp});
      }
      case "submitInterview": {
        var scores=(b.scores||[]).map(Number);
        var avg=scores.length? scores.reduce(function(a,n){return a+n;},0)/scores.length : 0;
        var ex2=db.interviews.filter(function(x){return x.nationalId===b.nationalId&&x.evaluator===b.evaluator;})[0];
        var rec={nationalId:b.nationalId,evaluator:b.evaluator,role:b.role||"",scores:scores,avg:avg,timestamp:Date.now()};
        if(ex2) Object.assign(ex2,rec); else db.interviews.push(rec);
        return ok();
      }
      case "getResult": {
        var stu=db.students.filter(function(x){return String(x.nationalId)===String(b.nationalId);})[0];
        if(!stu) return err("الطالب غير مسجّل");
        var r=computeResult(b.nationalId); r.name=stu.name; return ok({result:r});
      }
      case "listResults":
        return ok({results:db.students.map(function(s){var r=computeResult(s.nationalId);r.name=s.name;return r;})});
      case "bootstrap": {
        var rows=db.students.map(function(s){
          var r=computeResult(s.nationalId);
          r.name=s.name; r.school=s.school||""; r.studentPhone=s.studentPhone||"";
          r.guardianPhone=s.guardianPhone||""; r.email=s.email||""; r.createdAt=s.createdAt||"";
          return r;
        });
        return ok({config:Object.assign({},db.config), rows:rows});
      }
      case "exportResultsSheet":
        if(!isAdmin(b)) return err("تتطلب صلاحية مدير");
        return ok({count:db.students.length, demo:true});
      default: return err("إجراء غير معروف: "+b.action);
    }
  }

  return { handle: handle };
})();
