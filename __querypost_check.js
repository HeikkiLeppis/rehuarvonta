const PUSH_CLOUD_URL  = "https://defaultd454dc7d3d94429488602365011a91.37.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/95b546a295fc4c22b535248cb84d818b/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=cA97TJtRIIVR9SiAsexW9G3tW7RJjeBwbk4MmP2Q0HY";
const FETCH_ACTIVE_EVENT_URL = "https://defaultd454dc7d3d94429488602365011a91.37.environment.api.powerplatform.com:443/powerautomate/automations/direct/workflows/5bc1bf8dc7c14346b79f02eed6d760f0/triggers/manual/paths/invoke?api-version=1&sp=%2Ftriggers%2Fmanual%2Frun&sv=1.0&sig=jWHVaFplYVZ90inDomT5pPyn_GmKqCB9TbL6JctotTI";

/* ========= POSTINUMERO -> POSTITOIMIPAIKKA =========
   postinumerot.json on palvelimen juuressa.
*/
let POSTAL_MAP = {};
let POSTAL_READY = false;

function fixFinnishMojibake(s){
  const t = String(s ?? "");
  // Common UTF-8->Latin1 mojibake repairs for Nordic characters.
  return t
    .replaceAll("Ã„","Ä")
    .replaceAll("Ã–","Ö")
    .replaceAll("Ã…","Å")
    .replaceAll("Ã¤","ä")
    .replaceAll("Ã¶","ö")
    .replaceAll("Ã¥","å")
    .replaceAll("Ã©","é");
}

if(window.POSTAL_DATA && typeof window.POSTAL_DATA === "object"){
  POSTAL_MAP = window.POSTAL_DATA;
  POSTAL_READY = true;
}else{
  fetch("postinumerot.json", { cache:"no-store" })
    .then(async r => {
      if(!r.ok) throw new Error("HTTP " + r.status);
      const t = await r.text();
      const cleaned = String(t || "").replace(/^\uFEFF/, "");
      return JSON.parse(cleaned);
    })
    .then(j => {
      POSTAL_MAP = j || {};
      POSTAL_READY = true;
    })
    .catch(e => {
      console.error("Postinumerot eivät latautuneet", e);
      POSTAL_MAP = {};
      POSTAL_READY = false;
    });
}

/* ========= Lomake ========= */
const URL_PARAMS = new URLSearchParams(location.search);
const CAMPAIGN =
  URL_PARAMS.get("campaign") ||
  "Rehuarvonta";
const DEFAULT_SOURCE =
  URL_PARAMS.get("source") ||
  URL_PARAMS.get("event") ||
  "";
let ACTIVE_EVENT_NAME = "";
let ACTIVE_EVENT_RESPONSE = null;

const STEPS = [
  { key:"name", type:"text", title:"Etu- ja sukunimi", required:true },
  { key:"farmName", type:"text", title:"Yrityksen / tilan nimi", required:false },

  { key:"phone", type:"tel", title:"Puhelinnumero", required:true },

  { key:"interest", type:"multi", title:"Mistä olet kiinnostunut? (voit valita useamman)", required:false,
    options:[
      "Ruokintasuunnitelma",
      "Tilakäynti",
      "Rehutarjous",
      { value:"Muu", label:"Jokin muu, mikä?" }
    ]
  },

  { key:"email", type:"email", title:"Sähköposti (valinnainen)", required:false, modes:["Tarkempi"] },
  { key:"address", type:"text", title:"Osoite (valinnainen)", required:false, modes:["Tarkempi"] },

  /* Postinumero-askel (näyttää postitoimipaikan samalla sivulla) */
  { key:"postalCode", type:"postal", title:"Postinumero", required:true, modes:["Tarkempi"] },

  { key:"hasAnimals", type:"yesno", title:"Onko sinulla karjaa?", required:true, modes:["Tarkempi"] },

  { key:"production", type:"select", title:"Millainen tila sinulla on? (päätuotantosuunta)", required:true, modes:["Tarkempi"],
    options:[
      "Lypsykarjatila","Lihakarjatila","Emolehmätila",
      "Vasikka / Välikasvattamo","Lammastila","Porotila","Muu"
    ],
    requiredIf: s => s.hasAnimals === "Kyllä"
  },

  { key:"countAnimals", type:"number", title:"Eläinmäärä", requiredIf: s => s.hasAnimals === "Kyllä", modes:["Tarkempi"] },

  { key:"notes", type:"textarea", title:"Vapaa sana (valinnainen)", required:false },
  { key:"privacyAccepted", type:"consent", title:"Tietosuojan hyväksyntä", required:true }
];

let idx = 0;
let state = { mode:"Tarkempi", interest: [], interestOther: "", privacyAccepted:false };

const modeQuickBtn = document.getElementById("modeQuick");
const modeFullBtn = document.getElementById("modeFull");
const modeRow = document.getElementById("modeRow");

function updateModeUI(){
  const quick = state.mode !== "Tarkempi";
  modeQuickBtn.classList.toggle("active", quick);
  modeFullBtn.classList.toggle("active", !quick);
}

function setMode(mode){
  state.mode = "Tarkempi";
  idx = 0;

  // Keep payload lean in Pikakirjaus mode.
  if(state.mode !== "Tarkempi"){
    ["email","address","postalCode","city","hasAnimals","production",
     "countAnimals","countDairy","countBeef","countCows","countCalves","countSheep","countReindeer","countOther"]
      .forEach(k => delete state[k]);
  }

  updateModeUI();
  render();
}

modeQuickBtn.onclick = ()=> setMode("Tarkempi");
modeFullBtn.onclick  = ()=> setMode("Tarkempi");
updateModeUI();

async function initModeFromSettings(){
  modeRow.style.display = "none";
  setMode("Tarkempi");
}

function normalizePhone(v){
  const p = String(v || "").trim();
  if(!p) return "";
  let cleaned = p.replace(/[^\d+]/g,"");
  if(cleaned.startsWith("00")) cleaned = "+" + cleaned.slice(2);
  if(cleaned.startsWith("358")) cleaned = "+" + cleaned;
  if(cleaned.startsWith("+358") || cleaned.startsWith("0")) return cleaned;
  if(cleaned.startsWith("+")) return cleaned;
  return "0" + cleaned;
}

async function fetchActiveEventInfo(){
  if(String(FETCH_ACTIVE_EVENT_URL || "").startsWith("PASTE_")) return null;
  try{
    const req = {
      now: new Date().toISOString(),
      want: "activeEvent",
      page: "QueryPost"
    };
    const res = await fetch(FETCH_ACTIVE_EVENT_URL,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Accept":"application/json"
      },
      mode:"cors",
      credentials:"omit",
      body: JSON.stringify(req),
      cache:"no-store"
    });
    const text = await res.text().catch(()=> "");
    let data = null;
    try{
      data = text ? JSON.parse(text) : null;
    }catch(_){
      data = text;
    }
    ACTIVE_EVENT_RESPONSE = data;
    window.__queryPostActiveEventRequest = req;
    window.__queryPostActiveEventResponse = data;
    console.log("QueryPost active event request", req);
    console.log("QueryPost active event response", data);
    const root = (data && typeof data === "object" && data.body && typeof data.body === "object")
      ? data.body
      : data;
    const firstRow = Array.isArray(root)
      ? (root[0] || null)
      : (Array.isArray(root?.value) ? (root.value[0] || null) : null);
    const eventName = String(
      root?.event ||
      root?.Event ||
      firstRow?.event ||
      firstRow?.Event ||
      ""
    ).trim();
    if(eventName){
      ACTIVE_EVENT_NAME = eventName;
    }
    return data;
  }catch(e){
    console.warn("Aktiivisen tapahtuman haku epäonnistui", e);
    ACTIVE_EVENT_RESPONSE = null;
    return null;
  }
}

/* ========= UI ========= */
const host = document.getElementById("stepHost");
const backBtn = document.getElementById("backBtn");
const nextBtn = document.getElementById("nextBtn");
const bar = document.getElementById("bar");
const hint = document.getElementById("hint");
const privacyModal = document.getElementById("privacyModal");
const privacyCloseBtn = document.getElementById("privacyCloseBtn");
let submitting = false;

function updateConnectivityBadge(){
  return;
}

function openPrivacyModal(){
  privacyModal.style.display = "flex";
  privacyModal.setAttribute("aria-hidden","false");
}
function closePrivacyModal(){
  privacyModal.style.display = "none";
  privacyModal.setAttribute("aria-hidden","true");
}
privacyCloseBtn.onclick = closePrivacyModal;
privacyModal.addEventListener("click", (e)=>{ if(e.target === privacyModal) closePrivacyModal(); });
window.addEventListener("online", updateConnectivityBadge);
window.addEventListener("offline", updateConnectivityBadge);

function visibleSteps(){
  return STEPS.filter(st => {
    if(st.modes && !st.modes.includes(state.mode)) return false;
    const isAnimalSection = (st.key==="production" || st.key.startsWith("count"));
    if(isAnimalSection && state.hasAnimals==="Ei") return false;

    if(st.key.startsWith("count") && st.requiredIf && !st.requiredIf(state)) return false;
    if(st.key==="production" && st.requiredIf && !st.requiredIf(state)) return false;

    return true;
  });
}

// normalizePhone is declared above (used also for cloud sync)

function postalLabel(){
  const pc = (state.postalCode || "").trim();
  if(!pc) return "Syötä 5-numeroinen postinumero.";
  if(pc.length < 5) return "Syötä 5 numeroa.";
  if(!POSTAL_READY) return "Postinumerotietokanta ei ole vielä latautunut...";
  const city = fixFinnishMojibake(POSTAL_MAP[pc]);
  if(city){
    return `Postitoimipaikka: ${city}`;
  }
  return "Tuntematon postinumero.";
}

function render(){
  const steps = visibleSteps();
  if(idx < 0) idx = 0;
  if(idx > steps.length-1) idx = steps.length-1;

  const step = steps[idx];

  bar.style.width = Math.round((idx+1)/steps.length*100) + "%";
  backBtn.style.display = idx===0 ? "none" : "block";
  nextBtn.textContent = idx>=steps.length-1 ? "Valmis" : "Seuraava";
  hint.textContent = "";
  host.innerHTML = "";

  const t = document.createElement("div");
  t.className = "step-title";
  t.textContent = step.title;
  host.appendChild(t);

  let el;

  if(step.type==="text" || step.type==="email" || step.type==="number" || step.type==="tel"){
    el = document.createElement("input");
    if(step.type==="tel"){
      el.type = "tel";
      el.inputMode = "tel";
      el.placeholder = "esim. 0401234567";
    }else{
      el.type = (step.type==="number") ? "number" : step.type;  // email säilyy emailinä
      el.inputMode = (step.type==="number") ? "numeric" : "text";
    }
    el.value = state[step.key] ?? "";
    el.oninput = () =>{
      if(step.key === "phone"){
        // Allow + and digits only; keep it fast on touch keyboards.
        el.value = el.value.replace(/[^\d+]/g,"").slice(0,20);
      }
      state[step.key] = el.value;
    };
    el.onblur = () =>{
      if(step.key === "phone"){
        const fixed = normalizePhone(el.value);
        state[step.key] = fixed;
        el.value = fixed;
      }
    };
    el.addEventListener("keydown", (e)=>{
      if(e.key === "Enter") nextBtn.click();
    });
    host.appendChild(el);
    setTimeout(()=>{ try{ el.focus(); }catch(_){} }, 0);
  }

  if(step.type==="textarea"){
    el = document.createElement("textarea");
    el.value = state[step.key] ?? "";
    el.oninput = () => state[step.key] = el.value;
    host.appendChild(el);
    setTimeout(()=>{ try{ el.focus(); }catch(_){} }, 0);
  }

  if(step.type==="select"){
    el = document.createElement("select");
    el.innerHTML = '<option value="">&mdash; valitse &mdash;</option>' +
      step.options.map(o=>`<option value="${o}">${o}</option>`).join("");
    el.value = state[step.key] ?? "";
    el.onchange = () =>{
      state[step.key] = el.value;

      // Kun tuotantosuunta vaihtuu, tyhjennä vanhat eläinmäärät
      if(step.key==="production"){
        ["countAnimals","countDairy","countBeef","countCows","countCalves","countSheep","countReindeer","countOther"]
          .forEach(k => delete state[k]);
      }
      render();
    };
    host.appendChild(el);
    setTimeout(()=>{ try{ el.focus(); }catch(_){} }, 0);
  }

  if(step.type==="yesno"){
    el = document.createElement("div");
    el.className = "pills";
    ["Kyllä","Ei"].forEach(v=>{
      const b = document.createElement("button");
      b.type="button";
      b.className = "pill" + ((state[step.key]===v) ? " active" : "");
      b.textContent = v;
      b.onclick = () =>{
        state[step.key] = v;

        // Jos ei ole karjaa, tyhjennetään eläin-/tuotantotiedot
        if(step.key==="hasAnimals" && v==="Ei"){
          delete state.production;
          ["countAnimals","countDairy","countBeef","countCows","countCalves","countSheep","countReindeer","countOther"]
            .forEach(k => delete state[k]);
        }
        render();
      };
      el.appendChild(b);
    });
    host.appendChild(el);
  }

  if(step.type==="multi"){
    el = document.createElement("div");
    el.className = "pills";
    step.options.forEach(opt=>{
      const v = (opt && typeof opt === "object") ? String(opt.value || "") : String(opt);
      const label = (opt && typeof opt === "object") ? String(opt.label || v) : v;
      const b = document.createElement("button");
      b.type="button";
      const active = (state[step.key] || []).includes(v);
      b.className = "pill" + (active ? " active" : "");
      b.textContent = label;
      b.onclick = () =>{
        state[step.key] = state[step.key] || [];
        if(state[step.key].includes(v)){
          state[step.key] = state[step.key].filter(x=>x!==v);
          if(step.key === "interest" && v === "Muu"){
            state.interestOther = "";
          }
        }else{
          state[step.key].push(v);
        }
        render();
      };
      el.appendChild(b);
    });
    host.appendChild(el);

    if(step.key === "interest" && (state.interest || []).includes("Muu")){
      const wrap = document.createElement("div");
      wrap.style.marginTop = "12px";

      const lbl = document.createElement("div");
      lbl.className = "helper";
      lbl.textContent = "Jokin muu, mikä?";

      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "Kirjoita tähän";
      input.value = state.interestOther || "";
      input.oninput = () => { state.interestOther = input.value; };

      wrap.appendChild(lbl);
      wrap.appendChild(input);
      host.appendChild(wrap);
      setTimeout(()=>{ try{ input.focus(); }catch(_){} }, 0);
    }
  }

  /* ===== Postinumero-askel: näytä postitoimipaikka samalla sivulla ===== */
  if(step.type==="postal"){
    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "numeric";
    input.placeholder = "esim. 90100";
    input.value = state.postalCode ?? "";

    const helper = document.createElement("div");
    helper.className = "helper";
    helper.textContent = postalLabel();

    input.oninput = () => {
      const v = input.value.replace(/\D/g,"").slice(0,5);
      input.value = v;
      state.postalCode = v;

      if(v.length === 5 && POSTAL_READY && POSTAL_MAP[v]){
        state.city = fixFinnishMojibake(POSTAL_MAP[v]);
      } else {
        state.city = "";
      }

      helper.textContent = postalLabel();
    };

    host.appendChild(input);
    host.appendChild(helper);
  }

  if(step.type==="consent"){
    const box = document.createElement("div");
    box.className = "consentBox";
    const row = document.createElement("label");
    row.className = "consentRow";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!state.privacyAccepted;
    cb.onchange = ()=>{ state.privacyAccepted = !!cb.checked; };
    const text = document.createElement("div");
    text.className = "consentText";
    text.innerHTML = 'Hyväksyn <a href="#" id="privacyLink">Kinnusen Mylly Oy:n tietosuojakäytännön</a>.';
    row.appendChild(cb);
    row.appendChild(text);
    box.appendChild(row);
    const helper = document.createElement("div");
    helper.className = "helper";
    helper.textContent = "Tietosuojakäytännön hyväksyntä vaaditaan ennen lähettämistä.";
    box.appendChild(helper);
    host.appendChild(box);
    const link = text.querySelector("#privacyLink");
    if(link){
      link.onclick = (e)=>{
        e.preventDefault();
        openPrivacyModal();
      };
    }
  }
}

function validate(){
  const steps = visibleSteps();
  const step = steps[idx];
  const v = state[step.key];

  if(step.required){
    if(Array.isArray(v) && v.length===0){ hint.textContent="Valitse vähintään yksi."; return false; }
    if(!v){ hint.textContent="Täytä tämä kenttä."; return false; }
  }

  if(step.key === "privacyAccepted" && !state.privacyAccepted){
    hint.textContent = "Hyväksy tietosuojakäytäntö ennen lähettämistä.";
    return false;
  }

  if(step.requiredIf && step.requiredIf(state)){
    if(!v){ hint.textContent="Täytä tämä kenttä."; return false; }
  }

  if(step.key === "interest"){
    const values = Array.isArray(state.interest) ? state.interest : [];
    if(values.includes("Muu")){
      if(!String(state.interestOther || "").trim()){
        hint.textContent = "Kirjoita mihin muuhun olet kiinnostunut.";
        return false;
      }
    }
  }

  if(step.key === "phone"){
    const digits = String(state.phone || "").replace(/[^\d]/g,"");
    if(digits.length < 7){
      hint.textContent = "Syötä puhelinnumero.";
      return false;
    }
  }

  // Postinumero: pakollinen + tunnettu
  if(step.key === "postalCode"){
    const pc = (state.postalCode || "").trim();
    if(pc.length !== 5){
      hint.textContent = "Syötä 5-numeroinen postinumero.";
      return false;
    }
    if(!POSTAL_READY){
      hint.textContent = "Postinumerotietokanta ei ole vielä latautunut.";
      return false;
    }
    if(!POSTAL_MAP[pc]){
      hint.textContent = "Tuntematon postinumero.";
      return false;
    }
    // varmistetaan että city on set
    state.city = fixFinnishMojibake(POSTAL_MAP[pc]);
  }

  return true;
}

async function finish(){
  const payload = { campaign: CAMPAIGN, ...state };
  const createdAt = new Date().toISOString();
  if(payload.privacyAccepted !== undefined){
    delete payload.privacyAccepted;
  }
  if(String(PUSH_CLOUD_URL || "").startsWith("PASTE_")){
    throw new Error("Vaihda PUSH_CLOUD_URL julkisen Power Automate -flow'n osoitteeksi.");
  }
  const row = {
    createdAt: createdAt,
    CreatedAt: createdAt,
    campaign: payload.campaign || CAMPAIGN,
    source: payload.source || ACTIVE_EVENT_NAME || DEFAULT_SOURCE || "",
    Source: payload.source || ACTIVE_EVENT_NAME || DEFAULT_SOURCE || "",
    name: payload.name || "",
    farmName: payload.farmName || "",
    phone: normalizePhone(payload.phone || "") || (payload.phone || ""),
    email: payload.email || "",
    address: payload.address || "",
    Address: payload.address || "",
    postalCode: payload.postalCode || "",
    city: payload.city || "",
    hasAnimals: payload.hasAnimals || "",
    HasAnimals: payload.hasAnimals || "",
    countAnimals: payload.countAnimals || payload.countDairy || "",
    CountAnimals: payload.countAnimals || payload.countDairy || "",
    production: payload.production || "",
    interest: Array.isArray(payload.interest)
      ? payload.interest.map(x => (String(x) === "Muu" && String(payload.interestOther || "").trim()) ? `Muu: ${String(payload.interestOther).trim()}` : String(x)).join(", ")
      : (payload.interest || ""),
    notes: payload.notes || ""
  };
  const requestBody = JSON.stringify({ rows:[row] });
  try{
    const res = await fetch(PUSH_CLOUD_URL,{
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: requestBody,
      cache:"no-store"
    });
    if(!res.ok){
      const t = await res.text().catch(()=> "");
      throw new Error(t || ("HTTP " + res.status));
    }
  }catch(e){
    try{
      await fetch(PUSH_CLOUD_URL,{
        method:"POST",
        mode:"no-cors",
        headers:{ "Content-Type":"text/plain" },
        body: requestBody,
        cache:"no-store"
      });
    }catch(e2){
      throw new Error(((e && e.message) ? String(e.message) : String(e)) + " / " + ((e2 && e2.message) ? String(e2.message) : String(e2)));
    }
  }

  document.body.innerHTML = `
    <div class="center">
      <div>
        <div style="font-size:36px;font-weight:900;color:${getComputedStyle(document.documentElement).getPropertyValue('--brand')}">
          Kiitos! &#x2705;
        </div>
        <p style="font-size:18px;color:#333;margin-top:10px">Osallistumisesi on tallennettu.</p>
        <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:18px">
          <button class="nav secondary" type="button" onclick="location.href='QueryPost.html'">Seuraava osallistuja</button>
        </div>
      </div>
    </div>`;
}

backBtn.onclick = ()=>{ if(submitting) return; idx--; render(); };

nextBtn.onclick = async ()=>{
  if(submitting) return;
  if(!validate()) return;

  const steps = visibleSteps();
  if(idx >= steps.length-1){
    submitting = true;
    nextBtn.disabled = true;
    backBtn.disabled = true;
    nextBtn.textContent = "Lähetetään...";
    hint.textContent = "Lähetetään...";
    try{
      await finish();
    }catch(e){
      submitting = false;
      nextBtn.disabled = false;
      backBtn.disabled = false;
      nextBtn.textContent = "Valmis";
      hint.textContent = "Tallennus epäonnistui: " + (e.message || e);
    }
  } else {
    idx++;
    render();
  }
};

(async ()=>{
  await fetchActiveEventInfo();
  await initModeFromSettings();
})();


