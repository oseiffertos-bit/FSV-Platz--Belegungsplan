import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabaseClient.js";

// ── Constants ─────────────────────────────────────────────────────────────────
const HOURS      = Array.from({ length: 16 }, (_, i) => i + 7);
const DAYS_SHORT  = ["Mo","Di","Mi","Do","Fr","Sa","So"];
const DAYS_LONG   = ["Montag","Dienstag","Mittwoch","Donnerstag","Freitag","Samstag","Sonntag"];
const MONTHS      = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"];
const ROW_H       = 48;
const TEAM_COLORS = ["#2563eb","#16a34a","#dc2626","#d97706","#7c3aed","#0891b2","#be185d","#65a30d"];
const RECUR_OPTIONS = [
  { value:"none",     label:"Kein Serientermin" },
  { value:"weekly",   label:"Wöchentlich" },
  { value:"biweekly", label:"Alle 2 Wochen" },
  { value:"monthly",  label:"Monatlich" },
];

// ── Date helpers ──────────────────────────────────────────────────────────────
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1));
  d.setHours(0,0,0,0);
  return d;
}
function addDays(date, n) { const d = new Date(date); d.setDate(d.getDate()+n); return d; }
function fmtDate(d)        { return d.toISOString().split("T")[0]; }
function fmtDisplay(d)     { return `${d.getDate()}. ${MONTHS[d.getMonth()]}`; }
function getDaysInMonth(y,m){ return new Date(y, m+1, 0).getDate(); }

function expandRecurring(tpl) {
  const dates = [];
  const start = new Date(tpl.date);
  const until = tpl.recurUntil ? new Date(tpl.recurUntil) : addDays(start, 365);
  let cur = new Date(start);
  const step = tpl.recurType === "weekly" ? 7 : tpl.recurType === "biweekly" ? 14 : null;
  if (tpl.recurType === "monthly") {
    while (cur <= until) {
      const ds = fmtDate(cur);
      if (!tpl.exceptions?.includes(ds)) dates.push(ds);
      cur = new Date(cur.getFullYear(), cur.getMonth()+1, cur.getDate());
    }
  } else if (step) {
    while (cur <= until) {
      const ds = fmtDate(cur);
      if (!tpl.exceptions?.includes(ds)) dates.push(ds);
      cur = addDays(cur, step);
    }
  }
  return dates;
}

function expandBookings(bookings) {
  const flat = [];
  for (const b of bookings) {
    if (!b.recurType || b.recurType === "none") {
      flat.push(b);
    } else {
      for (const d of expandRecurring(b))
        flat.push({ ...b, date: d, _seriesId: b.id, _isSeries: true });
    }
  }
  return flat;
}

// ── Supabase row <-> app object mapping ─────────────────────────────────────────
function rowToBooking(row) {
  return {
    id: row.id, date: row.date, pitch: row.pitch, teamId: row.team_id,
    startH: row.start_h, endH: row.end_h, note: row.note || "",
    recurType: row.recur_type || "none", recurUntil: row.recur_until,
    exceptions: row.exceptions || [],
  };
}
function bookingToRow(b) {
  return {
    date: b.date, pitch: b.pitch, team_id: b.teamId || null,
    start_h: b.startH, end_h: b.endH, note: b.note || null,
    recur_type: b.recurType || "none", recur_until: b.recurUntil || null,
    exceptions: b.exceptions || [],
  };
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [bookings,    setBookings]    = useState([]);
  const [pitches,     setPitches]     = useState([]);
  const [teams,       setTeams]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [connError,   setConnError]   = useState(null);

  const [view,        setView]        = useState("week");
  const [weekStart,   setWeekStart]   = useState(getMonday(new Date()));
  const [monthDate,   setMonthDate]   = useState(new Date());
  const [activePitch, setActivePitch] = useState(0);
  const [modal,       setModal]       = useState(null);
  const [deleteModal, setDeleteModal] = useState(null);
  const [settingsTab, setSettingsTab] = useState(null);

  // ── Initial load + realtime subscriptions ────────────────────────────────────
  useEffect(() => {
    let active = true;

    async function loadAll() {
      try {
        const [{ data: p, error: pe }, { data: t, error: te }, { data: b, error: be }] = await Promise.all([
          supabase.from("pitches").select("*").order("sort_order"),
          supabase.from("teams").select("*").order("created_at"),
          supabase.from("bookings").select("*"),
        ]);
        if (pe || te || be) throw (pe || te || be);
        if (!active) return;
        setPitches(p.map(r => r.name));
        setTeams(t.map(r => ({ id:r.id, name:r.name, color:r.color })));
        setBookings(b.map(rowToBooking));
        setLoading(false);
      } catch (e) {
        console.error(e);
        if (active) { setConnError(e.message || "Verbindung zur Datenbank fehlgeschlagen"); setLoading(false); }
      }
    }
    loadAll();

    // Realtime: reload relevant table when anything changes (any user, any device)
    const channel = supabase
      .channel("public:all")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "pitches" },  loadAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "teams" },    loadAll)
      .subscribe();

    return () => { active = false; supabase.removeChannel(channel); };
  }, []);

  const teamById     = useCallback(id => teams.find(t => t.id === id), [teams]);
  const flatBookings = expandBookings(bookings);

  // ── Booking CRUD (writes go straight to Supabase; realtime refreshes UI) ──────
  async function saveBooking(data) {
    if (data.id) {
      await supabase.from("bookings").update(bookingToRow(data)).eq("id", data.id);
    } else {
      await supabase.from("bookings").insert(bookingToRow(data));
    }
    setModal(null);
  }

  async function requestDelete(eb) {
    setModal(null);
    if (eb._isSeries) {
      setDeleteModal({ booking: eb });
    } else {
      await supabase.from("bookings").delete().eq("id", eb.id);
    }
  }

  async function deleteOnlyThis(eb) {
    const tpl = bookings.find(b => b.id === eb._seriesId);
    if (!tpl) return;
    const newExceptions = [...(tpl.exceptions||[]), eb.date];
    await supabase.from("bookings").update({ exceptions: newExceptions }).eq("id", eb._seriesId);
    setDeleteModal(null);
  }

  async function deleteEntireSeries(eb) {
    await supabase.from("bookings").delete().eq("id", eb._seriesId);
    setDeleteModal(null);
  }

  function openEditModal(eb) {
    const tpl = eb._isSeries ? bookings.find(b => b.id === eb._seriesId) : eb;
    if (!tpl) return;
    setModal({ mode:"edit", booking: JSON.parse(JSON.stringify(tpl)) });
  }

  // ── Pitches / Teams CRUD ────────────────────────────────────────────────────
  async function addPitch(name) {
    await supabase.from("pitches").insert({ name, sort_order: pitches.length + 1 });
  }
  async function removePitch(name) {
    await supabase.from("pitches").delete().eq("name", name);
  }
  async function addTeam(name, color) {
    await supabase.from("teams").insert({ name, color });
  }
  async function removeTeam(id) {
    await supabase.from("teams").delete().eq("id", id);
  }

  // ── Calendar layout ──────────────────────────────────────────────────────────
  const weekDays = Array.from({ length:7 }, (_,i) => addDays(weekStart, i));
  const weekLabel= `${fmtDisplay(weekDays[0])} – ${fmtDisplay(weekDays[6])} ${weekDays[6].getFullYear()}`;
  const mYear    = monthDate.getFullYear();
  const mMonth   = monthDate.getMonth();
  const mDays    = getDaysInMonth(mYear, mMonth);
  const firstDow = (new Date(mYear, mMonth, 1).getDay() + 6) % 7;

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"system-ui", color:"#64748b" }}>
      Lade Daten …
    </div>
  );

  if (connError) return (
    <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", fontFamily:"system-ui", color:"#dc2626", padding:"2rem", textAlign:"center" }}>
      <p style={{ fontWeight:700, fontSize:18 }}>Verbindung zur Datenbank fehlgeschlagen</p>
      <p style={{ color:"#64748b", maxWidth:400 }}>{connError}</p>
      <p style={{ color:"#64748b", maxWidth:400, marginTop:8 }}>
        Prüfe, ob die Supabase-URL und der API-Key in <code>src/supabaseClient.js</code> korrekt eingetragen sind.
      </p>
    </div>
  );

  return (
    <div style={{ fontFamily:"'Inter',system-ui,sans-serif", minHeight:"100vh", background:"#f1f5f9", display:"flex", flexDirection:"column" }}>

      <header style={{ background:"#1e3a5f", color:"#fff", padding:"0 1.5rem", display:"flex", alignItems:"center", gap:"0.75rem", height:56, flexShrink:0, boxShadow:"0 2px 8px rgba(0,0,0,.25)" }}>
        <span style={{ fontSize:22 }}>⚽</span>
        <span style={{ fontWeight:700, fontSize:17, flex:1 }}>Sportgelände Belegungsplan</span>
        <span style={{ fontSize:12, background:"rgba(34,197,94,.25)", borderRadius:20, padding:"3px 10px", fontWeight:500 }}>
          🟢 Live verbunden
        </span>
        <button onClick={() => setSettingsTab(s => s ? null : "pitches")}
          style={{ background:"rgba(255,255,255,.15)", border:"none", color:"#fff", borderRadius:8, padding:"6px 14px", cursor:"pointer", fontSize:13, fontWeight:600 }}>
          ⚙ Einstellungen
        </button>
      </header>

      {settingsTab && (
        <SettingsPanel tab={settingsTab} setTab={setSettingsTab}
          pitches={pitches} onAddPitch={addPitch} onRemovePitch={removePitch}
          teams={teams} onAddTeam={addTeam} onRemoveTeam={removeTeam}
          onClose={() => setSettingsTab(null)} />
      )}

      <div style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"0.6rem 1.5rem", display:"flex", alignItems:"center", gap:"0.75rem", flexWrap:"wrap" }}>
        <div style={{ display:"flex", borderRadius:8, overflow:"hidden", border:"1px solid #cbd5e1" }}>
          {["week","month"].map(v => (
            <button key={v} onClick={() => setView(v)}
              style={{ padding:"6px 16px", border:"none", cursor:"pointer", fontWeight:600, fontSize:13,
                background:view===v?"#1e3a5f":"#fff", color:view===v?"#fff":"#475569" }}>
              {v==="week"?"Woche":"Monat"}
            </button>
          ))}
        </div>
        {view==="week" ? (
          <>
            <button onClick={() => setWeekStart(d => addDays(d,-7))} style={navBtn}>‹</button>
            <span style={{ fontWeight:600, fontSize:14, color:"#1e293b", minWidth:220, textAlign:"center" }}>{weekLabel}</span>
            <button onClick={() => setWeekStart(d => addDays(d, 7))} style={navBtn}>›</button>
            <button onClick={() => setWeekStart(getMonday(new Date()))} style={{ ...navBtn, fontSize:12, padding:"4px 10px" }}>Heute</button>
          </>
        ) : (
          <>
            <button onClick={() => setMonthDate(d => new Date(d.getFullYear(), d.getMonth()-1, 1))} style={navBtn}>‹</button>
            <span style={{ fontWeight:600, fontSize:14, color:"#1e293b", minWidth:180, textAlign:"center" }}>{MONTHS[mMonth]} {mYear}</span>
            <button onClick={() => setMonthDate(d => new Date(d.getFullYear(), d.getMonth()+1, 1))} style={navBtn}>›</button>
            <button onClick={() => setMonthDate(new Date())} style={{ ...navBtn, fontSize:12, padding:"4px 10px" }}>Heute</button>
          </>
        )}
        <div style={{ marginLeft:"auto", display:"flex", gap:6, flexWrap:"wrap" }}>
          {pitches.map((p,i) => (
            <button key={p} onClick={() => setActivePitch(i)}
              style={{ padding:"5px 14px", borderRadius:20, border:"1.5px solid", cursor:"pointer", fontSize:13, fontWeight:600,
                borderColor: activePitch===i?"#1e3a5f":"#cbd5e1",
                background:  activePitch===i?"#1e3a5f":"#fff",
                color:       activePitch===i?"#fff":"#475569" }}>
              {p}
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex:1, overflow:"auto", padding:"1rem 1.5rem" }}>
        {view==="week"
          ? <WeekGrid weekDays={weekDays} pitch={pitches[activePitch]} bookings={flatBookings} teamById={teamById}
              onCellClick={(date,hour) => setModal({ mode:"new", date:fmtDate(date), hour, pitch:pitches[activePitch] })}
              onBookingClick={openEditModal} />
          : <MonthGrid mYear={mYear} mMonth={mMonth} mDays={mDays} firstDow={firstDow}
              pitch={pitches[activePitch]} bookings={flatBookings} teamById={teamById}
              today={fmtDate(new Date())}
              onDayClick={date => setModal({ mode:"new", date, hour:10, pitch:pitches[activePitch] })}
              onBookingClick={openEditModal} />
        }
      </div>

      <div style={{ background:"#fff", borderTop:"1px solid #e2e8f0", padding:"0.5rem 1.5rem", display:"flex", gap:"1rem", flexWrap:"wrap", alignItems:"center" }}>
        <span style={{ fontSize:12, color:"#94a3b8", fontWeight:600 }}>TEAMS:</span>
        {teams.map(t => (
          <span key={t.id} style={{ display:"flex", alignItems:"center", gap:5, fontSize:13 }}>
            <span style={{ width:10, height:10, borderRadius:"50%", background:t.color, display:"inline-block" }}/>
            {t.name}
          </span>
        ))}
        <span style={{ marginLeft:"auto", fontSize:12, color:"#94a3b8" }}>🔁 = Serientermin</span>
      </div>

      {modal && (
        <BookingModal modal={modal} teams={teams} pitches={pitches}
          onSave={saveBooking} onDelete={requestDelete} onClose={() => setModal(null)} />
      )}
      {deleteModal && (
        <DeleteSeriesModal booking={deleteModal.booking} teamById={teamById}
          onDeleteThis={() => deleteOnlyThis(deleteModal.booking)}
          onDeleteAll={()  => deleteEntireSeries(deleteModal.booking)}
          onClose={() => setDeleteModal(null)} />
      )}
    </div>
  );
}

// ── Week Grid ─────────────────────────────────────────────────────────────────
function WeekGrid({ weekDays, pitch, bookings, teamById, onCellClick, onBookingClick }) {
  const todayStr = fmtDate(new Date());
  const totalH   = HOURS.length * ROW_H;

  return (
    <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,.08)", minWidth:700 }}>
      <div style={{ display:"grid", gridTemplateColumns:"56px repeat(7,1fr)", borderBottom:"2px solid #e2e8f0" }}>
        <div style={{ background:"#f8fafc" }}/>
        {weekDays.map((d,i) => {
          const isToday = fmtDate(d)===todayStr;
          return (
            <div key={i} style={{ padding:"8px 4px", textAlign:"center", background:isToday?"#eff6ff":"#f8fafc", borderLeft:"1px solid #e2e8f0" }}>
              <div style={{ fontSize:11, color:"#94a3b8", fontWeight:600 }}>{DAYS_SHORT[i]}</div>
              <div style={{ fontSize:15, fontWeight:isToday?800:600,
                background:isToday?"#1e3a5f":"transparent", color:isToday?"#fff":"#1e293b",
                borderRadius:"50%", width:28, height:28, lineHeight:"28px", margin:"2px auto 0" }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"56px repeat(7,1fr)" }}>
        <div style={{ background:"#f8fafc", borderRight:"1px solid #e2e8f0" }}>
          {HOURS.map(h => (
            <div key={h} style={{ height:ROW_H, borderBottom:"1px solid #f1f5f9", padding:"3px 8px 0 0", fontSize:11, color:"#94a3b8", textAlign:"right" }}>
              {String(h).padStart(2,"0")}:00
            </div>
          ))}
        </div>
        {weekDays.map((d,i) => {
          const dateStr    = fmtDate(d);
          const dayBookings= bookings.filter(b => b.date===dateStr && b.pitch===pitch);
          return (
            <div key={i} style={{ position:"relative", height:totalH, borderLeft:"1px solid #f1f5f9", background:dateStr===todayStr?"#fafcff":"transparent" }}>
              {HOURS.map(h => {
                const busy = dayBookings.some(b => h >= b.startH && h < b.endH);
                return (
                  <div key={h} onClick={() => !busy && onCellClick(d, h)}
                    style={{ position:"absolute", top:(h-HOURS[0])*ROW_H, left:0, right:0, height:ROW_H,
                      borderBottom:"1px solid #f1f5f9", cursor:busy?"default":"pointer", boxSizing:"border-box" }}
                    onMouseEnter={e => { if (!busy) e.currentTarget.style.background="#f0f9ff"; }}
                    onMouseLeave={e => { e.currentTarget.style.background="transparent"; }} />
                );
              })}
              {dayBookings.map(b => {
                const team   = teamById(b.teamId);
                const top    = (b.startH - HOURS[0]) * ROW_H;
                const height = (b.endH   - b.startH) * ROW_H - 2;
                return (
                  <div key={b.id+b.date} onClick={e => { e.stopPropagation(); onBookingClick(b); }}
                    style={{ position:"absolute", top, left:2, right:2, height,
                      background:team?.color||"#94a3b8", color:"#fff", borderRadius:6,
                      padding:"4px 6px", fontSize:11, fontWeight:600, cursor:"pointer",
                      boxShadow:"0 1px 4px rgba(0,0,0,.25)", overflow:"hidden", boxSizing:"border-box", zIndex:1 }}>
                    {b._isSeries && <span style={{ marginRight:2 }}>🔁</span>}
                    {team?.name||"?"}<br/>
                    <span style={{ fontWeight:400, opacity:.9 }}>{b.startH}:00–{b.endH}:00</span>
                    {b.note && <div style={{ opacity:.8, fontSize:10, marginTop:1 }}>{b.note}</div>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Month Grid ────────────────────────────────────────────────────────────────
function MonthGrid({ mYear, mMonth, mDays, firstDow, pitch, bookings, teamById, today, onDayClick, onBookingClick }) {
  const cells = [];
  for (let i=0; i<firstDow; i++) cells.push(null);
  for (let d=1; d<=mDays; d++) cells.push(d);
  while (cells.length%7!==0) cells.push(null);

  return (
    <div style={{ background:"#fff", borderRadius:12, overflow:"hidden", boxShadow:"0 1px 4px rgba(0,0,0,.08)" }}>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", background:"#f8fafc", borderBottom:"2px solid #e2e8f0" }}>
        {DAYS_LONG.map(d => (
          <div key={d} style={{ padding:"8px 4px", textAlign:"center", fontSize:12, fontWeight:700, color:"#64748b", borderLeft:"1px solid #e2e8f0" }}>
            {d.slice(0,2)}
          </div>
        ))}
      </div>
      {Array.from({ length:cells.length/7 }, (_,w) => (
        <div key={w} style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", borderBottom:"1px solid #e2e8f0" }}>
          {cells.slice(w*7, w*7+7).map((day,j) => {
            if (!day) return <div key={j} style={{ background:"#f8fafc", borderLeft:"1px solid #f1f5f9", minHeight:90 }}/>;
            const dateStr    = `${mYear}-${String(mMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
            const isToday    = dateStr===today;
            const dayBookings= bookings.filter(b => b.date===dateStr && b.pitch===pitch).sort((a,b)=>a.startH-b.startH);
            return (
              <div key={j} onClick={() => onDayClick(dateStr)}
                style={{ minHeight:90, padding:"4px 5px", borderLeft:"1px solid #f1f5f9", cursor:"pointer",
                  background:isToday?"#eff6ff":"#fff", transition:"background .1s" }}
                onMouseEnter={e => e.currentTarget.style.background = isToday?"#dbeafe":"#f8fafc"}
                onMouseLeave={e => e.currentTarget.style.background = isToday?"#eff6ff":"#fff"}>
                <div style={{ fontSize:13, fontWeight:isToday?800:500,
                  background:isToday?"#1e3a5f":"transparent", color:isToday?"#fff":"#374151",
                  borderRadius:"50%", width:22, height:22, lineHeight:"22px", textAlign:"center", marginBottom:3 }}>
                  {day}
                </div>
                {dayBookings.slice(0,3).map(b => {
                  const team = teamById(b.teamId);
                  return (
                    <div key={b.id+b.date} onClick={e => { e.stopPropagation(); onBookingClick(b); }}
                      style={{ background:team?.color||"#94a3b8", color:"#fff", borderRadius:4,
                        padding:"1px 5px", fontSize:11, fontWeight:600, marginBottom:2,
                        whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", cursor:"pointer" }}>
                      {b._isSeries&&"🔁 "}{b.startH}:00 {team?.name}
                    </div>
                  );
                })}
                {dayBookings.length>3 && <div style={{ fontSize:10, color:"#94a3b8" }}>+{dayBookings.length-3} weitere</div>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Booking Modal ─────────────────────────────────────────────────────────────
function BookingModal({ modal, teams, pitches, onSave, onDelete, onClose }) {
  const b = modal.booking || {};
  const [date,       setDate]       = useState(b.date       || modal.date  || fmtDate(new Date()));
  const [pitch,      setPitch]      = useState(b.pitch      || modal.pitch || pitches[0]);
  const [teamId,     setTeamId]     = useState(b.teamId     || teams[0]?.id || "");
  const [startH,     setStartH]     = useState(b.startH     ?? modal.hour ?? 10);
  const [endH,       setEndH]       = useState(b.endH       ?? (modal.hour ? modal.hour+1 : 11));
  const [note,       setNote]       = useState(b.note       || "");
  const [recurType,  setRecurType]  = useState(b.recurType  || "none");
  const [recurUntil, setRecurUntil] = useState(b.recurUntil || "");
  const [saving,     setSaving]     = useState(false);

  function handleRecurChange(val) {
    setRecurType(val);
    if (val !== "none" && !recurUntil) {
      const d = new Date(date || new Date());
      d.setMonth(d.getMonth()+6);
      setRecurUntil(fmtDate(d));
    }
  }

  async function handleSave() {
    if (!teamId)                              { alert("Bitte ein Team wählen.");                       return; }
    if (endH <= startH)                       { alert("Endzeit muss nach Startzeit liegen.");           return; }
    if (recurType !== "none" && !recurUntil)  { alert("Bitte ein Enddatum für die Serie angeben.");    return; }
    setSaving(true);
    await onSave({ id:b.id, date, pitch, teamId, startH, endH, note,
      recurType, recurUntil: recurType!=="none" ? recurUntil : null,
      exceptions: b.exceptions||[] });
    setSaving(false);
  }

  const isEdit   = modal.mode === "edit";
  const isSeries = b.recurType && b.recurType !== "none";

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:"#fff", borderRadius:14, padding:"1.5rem", width:"100%", maxWidth:440,
        boxShadow:"0 20px 60px rgba(0,0,0,.25)", maxHeight:"90vh", overflowY:"auto" }}>
        <h3 style={{ margin:"0 0 1.25rem", fontSize:17, color:"#1e293b", fontWeight:700 }}>
          {isEdit ? (isSeries?"🔁 Serie bearbeiten":"Buchung bearbeiten") : "Neue Buchung"}
        </h3>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.8rem" }}>
          <label style={lbl}>
            Datum {recurType!=="none" && <span style={{ color:"#6b7280", fontWeight:400 }}>(erster Termin)</span>}
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp}/>
          </label>
          <label style={lbl}>
            Platz
            <select value={pitch} onChange={e => setPitch(e.target.value)} style={inp}>
              {pitches.map(p => <option key={p}>{p}</option>)}
            </select>
          </label>
          <label style={lbl}>
            Team
            <select value={teamId} onChange={e => setTeamId(e.target.value)} style={inp}>
              <option value="">– Team wählen –</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div style={{ display:"flex", gap:"0.75rem" }}>
            <label style={{ ...lbl, flex:1 }}>
              Von
              <select value={startH} onChange={e => setStartH(Number(e.target.value))} style={inp}>
                {HOURS.map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
              </select>
            </label>
            <label style={{ ...lbl, flex:1 }}>
              Bis
              <select value={endH} onChange={e => setEndH(Number(e.target.value))} style={inp}>
                {HOURS.filter(h => h>startH).map(h => <option key={h} value={h}>{String(h).padStart(2,"0")}:00</option>)}
                <option value={23}>23:00</option>
              </select>
            </label>
          </div>
          <div style={{ background:"#f8fafc", borderRadius:10, padding:"0.85rem", border:"1px solid #e2e8f0" }}>
            <div style={{ fontSize:12, fontWeight:700, color:"#6b7280", marginBottom:"0.6rem", textTransform:"uppercase", letterSpacing:".05em" }}>
              🔁 Wiederholung
            </div>
            <label style={lbl}>
              Intervall
              <select value={recurType} onChange={e => handleRecurChange(e.target.value)} style={inp}>
                {RECUR_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {recurType !== "none" && (
              <label style={{ ...lbl, marginTop:"0.6rem" }}>
                Serie endet am
                <input type="date" value={recurUntil} onChange={e => setRecurUntil(e.target.value)} style={inp} min={date}/>
              </label>
            )}
            {recurType !== "none" && recurUntil && date && (
              <RecurrencePreview date={date} recurType={recurType} recurUntil={recurUntil}/>
            )}
          </div>
          <label style={lbl}>
            Notiz (optional)
            <input type="text" value={note} onChange={e => setNote(e.target.value)}
              placeholder="z.B. Training, Spiel, Turnier …" style={inp}/>
          </label>
        </div>
        <div style={{ display:"flex", gap:"0.5rem", marginTop:"1.5rem" }}>
          <button onClick={handleSave} disabled={saving}
            style={{ flex:1, padding:"10px", background:"#1e3a5f", color:"#fff", border:"none", borderRadius:8, fontWeight:700, fontSize:14, cursor:"pointer", opacity:saving?0.6:1 }}>
            {saving ? "Speichert…" : (isEdit ? "Speichern" : (recurType!=="none"?"Serie anlegen":"Eintragen"))}
          </button>
          {isEdit && (
            <button onClick={() => onDelete(b)}
              style={{ padding:"10px 14px", background:"#fee2e2", color:"#dc2626", border:"none", borderRadius:8, fontWeight:700, cursor:"pointer" }}>
              Löschen
            </button>
          )}
          <button onClick={onClose}
            style={{ padding:"10px 14px", background:"#f1f5f9", color:"#475569", border:"none", borderRadius:8, fontWeight:600, cursor:"pointer" }}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Recurrence Preview ────────────────────────────────────────────────────────
function RecurrencePreview({ date, recurType, recurUntil }) {
  const dates = expandRecurring({ date, recurType, recurUntil, exceptions:[] });
  const label = RECUR_OPTIONS.find(o => o.value===recurType)?.label||"";
  return (
    <div style={{ marginTop:"0.5rem", fontSize:12, color:"#6b7280", background:"#eff6ff", borderRadius:7, padding:"6px 10px", lineHeight:1.6 }}>
      <strong style={{ color:"#1e3a5f" }}>{label}</strong> · {dates.length} Termine
      {dates.length>0 && <span> · Erster: {dates[0]} · Letzter: {dates[dates.length-1]}</span>}
    </div>
  );
}

// ── Delete Series Modal ───────────────────────────────────────────────────────
function DeleteSeriesModal({ booking, teamById, onDeleteThis, onDeleteAll, onClose }) {
  const team = teamById(booking.teamId);
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.6)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:200, padding:16 }}
      onClick={e => e.target===e.currentTarget && onClose()}>
      <div style={{ background:"#fff", borderRadius:14, padding:"1.5rem", width:"100%", maxWidth:380, boxShadow:"0 20px 60px rgba(0,0,0,.3)" }}>
        <h3 style={{ margin:"0 0 0.5rem", fontSize:17, color:"#1e293b", fontWeight:700 }}>🔁 Serientermin löschen</h3>
        <p style={{ fontSize:14, color:"#64748b", margin:"0 0 1.25rem" }}>
          <strong style={{ color:team?.color }}>{team?.name}</strong> am <strong>{booking.date}</strong>, {booking.startH}–{booking.endH} Uhr auf {booking.pitch}.
        </p>
        <p style={{ fontSize:14, color:"#374151", margin:"0 0 1.25rem" }}>Möchtest du nur diesen Termin oder die gesamte Serie löschen?</p>
        <div style={{ display:"flex", flexDirection:"column", gap:"0.5rem" }}>
          <button onClick={onDeleteThis} style={{ padding:"10px", background:"#fef3c7", color:"#92400e", border:"1px solid #fcd34d", borderRadius:8, fontWeight:700, fontSize:14, cursor:"pointer" }}>
            Nur diesen Termin löschen
          </button>
          <button onClick={onDeleteAll} style={{ padding:"10px", background:"#fee2e2", color:"#dc2626", border:"1px solid #fca5a5", borderRadius:8, fontWeight:700, fontSize:14, cursor:"pointer" }}>
            Gesamte Serie löschen
          </button>
          <button onClick={onClose} style={{ padding:"10px", background:"#f1f5f9", color:"#475569", border:"none", borderRadius:8, fontWeight:600, fontSize:14, cursor:"pointer" }}>
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────
function SettingsPanel({ tab, setTab, pitches, onAddPitch, onRemovePitch, teams, onAddTeam, onRemoveTeam, onClose }) {
  const [newPitch, setNewPitch] = useState("");
  const [newTeam,  setNewTeam]  = useState("");
  const [newColor, setNewColor] = useState(TEAM_COLORS[0]);

  return (
    <div style={{ background:"#1e293b", color:"#e2e8f0", padding:"1rem 1.5rem", borderBottom:"2px solid #0f172a" }}>
      <div style={{ display:"flex", gap:8, marginBottom:"1rem" }}>
        {["pitches","teams"].map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding:"5px 14px", border:"none", borderRadius:8, cursor:"pointer", fontWeight:600, fontSize:13,
              background:tab===t?"#3b82f6":"rgba(255,255,255,.1)", color:tab===t?"#fff":"#94a3b8" }}>
            {t==="pitches"?"⬜ Plätze":"🏷 Teams"}
          </button>
        ))}
        <button onClick={onClose} style={{ marginLeft:"auto", background:"none", border:"none", color:"#94a3b8", cursor:"pointer", fontSize:18 }}>✕</button>
      </div>
      {tab==="pitches" && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:"0.5rem", alignItems:"center" }}>
          {pitches.map((p) => (
            <span key={p} style={{ background:"rgba(255,255,255,.1)", borderRadius:20, padding:"4px 12px", display:"flex", alignItems:"center", gap:6, fontSize:13 }}>
              {p}
              {pitches.length>1 && (
                <button onClick={() => onRemovePitch(p)}
                  style={{ background:"none", border:"none", color:"#f87171", cursor:"pointer", fontSize:14, lineHeight:1 }}>×</button>
              )}
            </span>
          ))}
          <input value={newPitch} onChange={e => setNewPitch(e.target.value)} placeholder="Neuer Platz …"
            onKeyDown={e => { if (e.key==="Enter"&&newPitch.trim()) { onAddPitch(newPitch.trim()); setNewPitch(""); }}}
            style={{ background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.2)", color:"#fff", borderRadius:20, padding:"4px 12px", fontSize:13, outline:"none", width:140 }}/>
          <button onClick={() => { if (newPitch.trim()) { onAddPitch(newPitch.trim()); setNewPitch(""); }}}
            style={{ background:"#3b82f6", border:"none", color:"#fff", borderRadius:20, padding:"4px 14px", cursor:"pointer", fontWeight:600, fontSize:13 }}>
            + Hinzufügen
          </button>
        </div>
      )}
      {tab==="teams" && (
        <div style={{ display:"flex", flexWrap:"wrap", gap:"0.5rem", alignItems:"center" }}>
          {teams.map(t => (
            <span key={t.id} style={{ background:t.color+"33", border:`1.5px solid ${t.color}`, borderRadius:20, padding:"4px 12px", display:"flex", alignItems:"center", gap:6, fontSize:13, color:"#fff" }}>
              <span style={{ width:8, height:8, borderRadius:"50%", background:t.color }}/>
              {t.name}
              <button onClick={() => onRemoveTeam(t.id)}
                style={{ background:"none", border:"none", color:"#f87171", cursor:"pointer", fontSize:14, lineHeight:1 }}>×</button>
            </span>
          ))}
          <input value={newTeam} onChange={e => setNewTeam(e.target.value)} placeholder="Neues Team …"
            style={{ background:"rgba(255,255,255,.1)", border:"1px solid rgba(255,255,255,.2)", color:"#fff", borderRadius:20, padding:"4px 12px", fontSize:13, outline:"none", width:130 }}/>
          <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)}
            style={{ width:32, height:28, borderRadius:8, border:"none", cursor:"pointer", background:"none" }}/>
          <button onClick={() => {
            if (newTeam.trim()) {
              onAddTeam(newTeam.trim(), newColor);
              setNewTeam(""); setNewColor(TEAM_COLORS[Math.floor(Math.random()*TEAM_COLORS.length)]);
            }
          }} style={{ background:"#3b82f6", border:"none", color:"#fff", borderRadius:20, padding:"4px 14px", cursor:"pointer", fontWeight:600, fontSize:13 }}>
            + Hinzufügen
          </button>
        </div>
      )}
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const navBtn = { background:"#f1f5f9", border:"1px solid #cbd5e1", borderRadius:6, padding:"5px 12px", cursor:"pointer", fontWeight:700, fontSize:15, color:"#475569" };
const lbl    = { display:"flex", flexDirection:"column", gap:4, fontSize:13, fontWeight:600, color:"#374151" };
const inp    = { padding:"8px 10px", borderRadius:7, border:"1px solid #d1d5db", fontSize:14, outline:"none", fontFamily:"inherit", color:"#1e293b" };
