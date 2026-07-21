/* Family Points — cliente.
   Cada familia tiene un código (FAM-XXXXXXXX). El estado vive en el servidor y
   se comparte con quien tenga el enlace.

   Guardado por operación: cada turno se añade/edita/borra por separado contra
   el servidor (endpoints granulares), así dos móviles editando a la vez no se
   pisan. Las reglas/miembros/peques se guardan juntos (se editan poco). Todo
   se cachea en localStorage para arrancar rápido y aguantar cortes de red. */
(() => {
  "use strict";

  const PALETTE = ["var(--accent-1)", "var(--accent-2)", "var(--accent-3)", "var(--accent-4)", "var(--accent-5)", "var(--accent-6)"];
  const LAST_KEY = "family-points:last";
  const PERIOD_KEY = "family-points:period";
  const cacheKey = (code) => "family-points:cache:" + code;
  const meKey = (code) => "family-points:me:" + code;

  // ---- utilidades ------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const todayISO = () => new Date().toLocaleDateString("sv-SE");
  const numOr = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const isTime = (v) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
  const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("es-ES");

  const el = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      // Claves con guion (data-label, aria-label) son atributos, no propiedades.
      if (k.includes("-")) node.setAttribute(k, v);
      else node[k] = v;
    }
    for (const c of [].concat(children)) if (c != null) node.append(c);
    return node;
  };

  // ---- estado ----------------------------------------------------------
  let state = null;
  let familyCode = null;
  let lastSyncedAt = null;
  let meId = null;
  let period = localStorage.getItem(PERIOD_KEY) || "all";
  let pollTimer = null;

  // cola de guardado
  const dirtyShiftIds = new Set();
  let shiftTimer = null;
  let configTimer = null;

  function defaultState() {
    return {
      settings: { pointsPerHour: 1, dayStart: "06:00", dayEnd: "22:00", perChild: false },
      members: [{ id: uid(), name: "Papá" }, { id: uid(), name: "Mamá" }],
      children: [{ id: uid(), name: "Peque" }],
      shifts: [],
    };
  }

  function normalize(data) {
    const base = defaultState();
    const s = data && typeof data === "object" ? data : {};
    return {
      settings: {
        pointsPerHour: numOr(s.settings?.pointsPerHour, 1),
        dayStart: isTime(s.settings?.dayStart) ? s.settings.dayStart : "06:00",
        dayEnd: isTime(s.settings?.dayEnd) ? s.settings.dayEnd : "22:00",
        perChild: !!s.settings?.perChild,
      },
      members: Array.isArray(s.members) && s.members.length
        ? s.members.map((m) => ({ id: m.id || uid(), name: String(m.name || "").slice(0, 24) || "Sin nombre" }))
        : base.members,
      children: Array.isArray(s.children) ? s.children.map((c) => ({ id: c.id || uid(), name: String(c.name || "").slice(0, 24) || "Peque" })) : base.children,
      shifts: Array.isArray(s.shifts)
        ? s.shifts.map((sh) => ({
            id: sh.id || uid(),
            date: isDate(sh.date) ? sh.date : todayISO(),
            memberId: sh.memberId || "",
            start: isTime(sh.start) ? sh.start : "",
            end: isTime(sh.end) ? sh.end : "",
            kids: Number.isFinite(sh.kids) ? sh.kids : null,
            note: String(sh.note || "").slice(0, 120),
          }))
        : [],
    };
  }

  // ---- API -------------------------------------------------------------
  async function apiFetch(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) { const e = new Error("http_" + res.status); e.status = res.status; throw e; }
    return res.json();
  }
  const jsonPost = (url, body, method = "POST") => apiFetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const API = {
    create: () => apiFetch("/api/family", { method: "POST" }),
    get: (code) => apiFetch("/api/family/" + encodeURIComponent(code)),
    replace: (code, data) => jsonPost("/api/family/" + encodeURIComponent(code), { data }, "PUT"),
    saveConfig: (code, cfg) => jsonPost("/api/family/" + encodeURIComponent(code) + "/config", cfg, "PUT"),
    upsertShift: (code, shift) => jsonPost("/api/family/" + encodeURIComponent(code) + "/shifts", { shift }),
    deleteShift: (code, id) => apiFetch("/api/family/" + encodeURIComponent(code) + "/shifts/" + encodeURIComponent(id), { method: "DELETE" }),
  };

  // ---- cálculo de puntos ----------------------------------------------
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  function validHours(shift) {
    if (!isTime(shift.start) || !isTime(shift.end)) return 0;
    const s = Math.max(toMin(shift.start), toMin(state.settings.dayStart));
    const e = Math.min(toMin(shift.end), toMin(state.settings.dayEnd));
    return Math.max(0, e - s) / 60;
  }
  function shiftPoints(shift) {
    let pts = validHours(shift) * state.settings.pointsPerHour;
    if (state.settings.perChild) {
      const kids = Number.isFinite(shift.kids) && shift.kids > 0 ? shift.kids : state.children.length || 1;
      pts *= kids;
    }
    return pts;
  }
  const memberById = (id) => state.members.find((m) => m.id === id);
  const colorFor = (id) => { const i = state.members.findIndex((m) => m.id === id); return PALETTE[(i < 0 ? 0 : i) % PALETTE.length]; };

  // periodo -------------------------------------------------------------
  function weekRange(now) {
    const day = (now.getDay() + 6) % 7; // 0 = lunes
    const start = new Date(now); start.setHours(0, 0, 0, 0); start.setDate(now.getDate() - day);
    const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23, 59, 59, 999);
    return { start, end };
  }
  function inPeriod(shift) {
    if (period === "all" || !isDate(shift.date)) return true;
    const d = new Date(shift.date + "T12:00:00");
    const now = new Date();
    if (period === "month") return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (period === "week") { const { start, end } = weekRange(now); return d >= start && d <= end; }
    return true;
  }

  // ---- sincronización --------------------------------------------------
  function setSync(status) {
    const map = { saving: "Guardando…", saved: "Guardado", error: "Sin conexión" };
    const node = $("#sync-status");
    node.hidden = false;
    node.textContent = map[status] || "";
    node.className = "sync " + status;
  }
  function cacheLocal() { try { localStorage.setItem(cacheKey(familyCode), JSON.stringify(state)); } catch {} }
  const hasPending = () => dirtyShiftIds.size > 0;

  function queueShift(id) {
    cacheLocal();
    dirtyShiftIds.add(id);
    setSync("saving");
    clearTimeout(shiftTimer);
    shiftTimer = setTimeout(flushShifts, 500);
  }
  async function flushShifts() {
    const ids = [...dirtyShiftIds];
    dirtyShiftIds.clear();
    let ok = true;
    for (const id of ids) {
      const sh = state.shifts.find((s) => s.id === id);
      if (!sh) continue; // se borró antes de guardar
      try { const r = await API.upsertShift(familyCode, sh); lastSyncedAt = r.updatedAt; }
      catch { ok = false; dirtyShiftIds.add(id); }
    }
    if (ok && dirtyShiftIds.size === 0) setSync("saved");
    else { setSync("error"); clearTimeout(shiftTimer); shiftTimer = setTimeout(flushShifts, 4000); }
  }

  function queueConfig() {
    cacheLocal();
    setSync("saving");
    clearTimeout(configTimer);
    configTimer = setTimeout(flushConfig, 500);
  }
  async function flushConfig() {
    try {
      const r = await API.saveConfig(familyCode, { settings: state.settings, members: state.members, children: state.children });
      lastSyncedAt = r.updatedAt; setSync("saved");
    } catch { setSync("error"); clearTimeout(configTimer); configTimer = setTimeout(flushConfig, 4000); }
  }

  async function deleteShiftRemote(id) {
    cacheLocal(); setSync("saving");
    try { const r = await API.deleteShift(familyCode, id); lastSyncedAt = r.updatedAt; setSync("saved"); }
    catch { setSync("error"); }
  }
  async function replaceRemote() {
    cacheLocal(); setSync("saving");
    try { const r = await API.replace(familyCode, state); lastSyncedAt = r.updatedAt; setSync("saved"); }
    catch { setSync("error"); }
  }

  function startPolling() { stopPolling(); pollTimer = setInterval(poll, 6000); }
  function stopPolling() { if (pollTimer) clearInterval(pollTimer); pollTimer = null; }
  function isEditing() {
    const a = document.activeElement;
    return a && ["INPUT", "SELECT", "TEXTAREA"].includes(a.tagName) && a.closest("#app");
  }
  async function poll() {
    if (document.hidden || hasPending() || isEditing() || !familyCode) return;
    try {
      const res = await API.get(familyCode);
      if (res.updatedAt !== lastSyncedAt) {
        state = normalize(res.data);
        lastSyncedAt = res.updatedAt;
        cacheLocal();
        renderAll();
        if (!$("#settings-overlay").hidden) renderSettings();
        setSync("saved");
      }
    } catch {}
  }

  // ---- render: marcador ------------------------------------------------
  function renderPeriodControl() {
    document.querySelectorAll("#period-control button").forEach((b) => {
      b.classList.toggle("active", b.dataset.period === period);
      b.setAttribute("aria-pressed", b.dataset.period === period ? "true" : "false");
    });
  }

  function renderScoreboard() {
    const board = $("#scoreboard");
    board.innerHTML = "";
    const visible = state.shifts.filter(inPeriod);
    const totals = state.members.map((m) => {
      const mine = visible.filter((s) => s.memberId === m.id);
      return { member: m, points: mine.reduce((a, s) => a + shiftPoints(s), 0), count: mine.length };
    });
    const max = Math.max(0, ...totals.map((t) => t.points));
    for (const t of totals) {
      const isLeader = max > 0 && t.points === max;
      const isMe = t.member.id === meId;
      const card = el("div", { className: "score-card" + (isLeader ? " leader" : "") + (isMe ? " me" : "") });
      card.style.setProperty("--chip", colorFor(t.member.id));
      const who = el("div", { className: "who" }, [el("span", { className: "dot" }), document.createTextNode(t.member.name)]);
      if (isMe) who.append(el("span", { className: "me-tag" }, "· tú"));
      card.append(
        who,
        el("div", { className: "points" }, [document.createTextNode(fmt(t.points)), el("span", { className: "unit" }, " pts")]),
        el("div", { className: "sub" }, `${t.count} turnos`),
      );
      if (isLeader) card.append(el("div", { className: "crown", title: "En cabeza" }, "👑"));
      board.append(card);
    }
    renderPeriodControl();
    renderMeSelect();
  }

  function renderMeSelect() {
    const sel = $("#me-select");
    if (!sel) return;
    sel.innerHTML = "";
    sel.append(el("option", { value: "", textContent: "—" }));
    for (const m of state.members) sel.append(el("option", { value: m.id, textContent: m.name, selected: m.id === meId }));
    sel.value = meId || "";
  }

  // ---- render: tabla ---------------------------------------------------
  function renderTable() {
    const body = $("#shifts-body");
    body.innerHTML = "";
    $("#empty-state").hidden = state.shifts.length > 0;
    document.querySelectorAll("[data-perchild-col]").forEach((c) => (c.hidden = !state.settings.perChild));
    for (const shift of state.shifts) body.append(renderRow(shift));
  }

  function renderRow(shift) {
    const tr = el("tr");
    tr.append(cell("Fecha", inputEl("date", shift.date, (v) => update(shift, "date", v), { "aria-label": "Fecha" })));

    const sel = el("select", { className: "cell-select", "aria-label": "Quién se queda" });
    for (const m of state.members) sel.append(el("option", { value: m.id, textContent: m.name, selected: m.id === shift.memberId }));
    if (!shift.memberId && state.members[0]) shift.memberId = state.members[0].id;
    if (shift.memberId && !state.members.some((m) => m.id === shift.memberId)) {
      sel.append(el("option", { value: shift.memberId, textContent: "— sin asignar —", selected: true }));
    }
    sel.value = shift.memberId;
    sel.addEventListener("change", () => update(shift, "memberId", sel.value));
    tr.append(cell("Quién se queda", sel));

    tr.append(cell("Entrada", inputEl("time", shift.start, (v) => update(shift, "start", v), { "aria-label": "Hora de entrada" })));
    tr.append(cell("Salida", inputEl("time", shift.end, (v) => update(shift, "end", v), { "aria-label": "Hora de salida" })));

    const kidsTd = cell("Nº peques", inputEl("number", shift.kids != null ? shift.kids : "", (v) => update(shift, "kids", v === "" ? null : Math.max(0, parseInt(v, 10) || 0)), { min: "0", step: "1", placeholder: String(state.children.length || 1), "aria-label": "Número de peques" }));
    kidsTd.className = "col-kids";
    kidsTd.hidden = !state.settings.perChild;
    tr.append(kidsTd);

    tr.append(cell("Nota", inputEl("text", shift.note, (v) => update(shift, "note", v), { placeholder: "Opcional", maxLength: "120", "aria-label": "Nota" })));

    const hours = validHours(shift);
    tr.append(labelCell("Horas válidas", "cell-valid", hours ? fmt(hours) + " h" : "—"));

    const pts = shiftPoints(shift);
    const invalid = isTime(shift.start) && isTime(shift.end) && hours === 0;
    tr.append(labelCell("Puntos", "cell-points" + (pts === 0 ? " warn" : ""), invalid ? "0 (fuera de horario)" : fmt(pts)));

    const del = el("button", { className: "row-del", title: "Borrar turno", "aria-label": "Borrar turno", textContent: "🗑️" });
    del.addEventListener("click", () => {
      state.shifts = state.shifts.filter((s) => s.id !== shift.id);
      dirtyShiftIds.delete(shift.id);
      renderAll();
      deleteShiftRemote(shift.id);
    });
    tr.append(el("td", { className: "col-actions" }, del));
    return tr;
  }

  function cell(label, node) { const td = el("td", { "data-label": label }); td.append(node); return td; }
  function labelCell(label, cls, text) { return el("td", { className: cls, "data-label": label, textContent: text }); }
  function inputEl(type, value, onInput, extra = {}) {
    const input = el("input", Object.assign({ type, value: value ?? "", className: "cell-input" }, extra));
    input.addEventListener("change", () => onInput(input.value));
    return input;
  }
  function update(shift, key, value) { shift[key] = value; renderScoreboard(); renderTable(); queueShift(shift.id); }

  function addShift() {
    const last = state.shifts[state.shifts.length - 1];
    const sh = { id: uid(), date: last?.date || todayISO(), memberId: state.members[0]?.id || "", start: "", end: "", kids: null, note: "" };
    state.shifts.push(sh);
    renderAll();
    const rows = $("#shifts-body").querySelectorAll("tr");
    rows[rows.length - 1]?.querySelector("input")?.focus();
    queueShift(sh.id);
  }

  // ---- ajustes ---------------------------------------------------------
  function openSettings() { renderSettings(); $("#settings-overlay").hidden = false; }
  function closeSettings() { $("#settings-overlay").hidden = true; }

  function renderSettings() {
    $("#set-points-per-hour").value = state.settings.pointsPerHour;
    $("#set-day-start").value = state.settings.dayStart;
    $("#set-day-end").value = state.settings.dayEnd;
    $("#set-perchild").checked = state.settings.perChild;
    renderMembersEditor();
    renderChildrenEditor();
  }

  function renderMembersEditor() {
    const ul = $("#members-list");
    ul.innerHTML = "";
    state.members.forEach((m) => {
      const dot = el("span", { className: "dot" });
      dot.style.background = colorFor(m.id);
      const input = el("input", { type: "text", value: m.name, maxLength: "24", "aria-label": "Nombre del miembro" });
      input.addEventListener("change", () => { m.name = input.value.trim().slice(0, 24) || "Sin nombre"; input.value = m.name; queueConfig(); renderScoreboard(); renderTable(); });
      const del = el("button", { className: "row-del", textContent: "🗑️", title: "Quitar miembro", "aria-label": "Quitar miembro" });
      del.addEventListener("click", () => {
        if (state.members.length <= 1) return toast("Debe haber al menos un miembro");
        if (state.shifts.some((s) => s.memberId === m.id) && !confirm(`"${m.name}" tiene turnos apuntados. ¿Quitarlo igualmente? (esos turnos quedarán "sin asignar")`)) return;
        state.members = state.members.filter((x) => x.id !== m.id);
        if (meId === m.id) { meId = null; localStorage.removeItem(meKey(familyCode)); }
        queueConfig(); renderAll(); renderSettings();
      });
      ul.append(el("li", {}, [dot, input, del]));
    });
  }

  function renderChildrenEditor() {
    const ul = $("#children-list");
    ul.innerHTML = "";
    state.children.forEach((c) => {
      const input = el("input", { type: "text", value: c.name, maxLength: "24", "aria-label": "Nombre del peque" });
      input.addEventListener("change", () => { c.name = input.value.trim().slice(0, 24) || "Peque"; input.value = c.name; queueConfig(); });
      const del = el("button", { className: "row-del", textContent: "🗑️", title: "Quitar peque", "aria-label": "Quitar peque" });
      del.addEventListener("click", () => { state.children = state.children.filter((x) => x.id !== c.id); queueConfig(); renderChildrenEditor(); renderTable(); });
      ul.append(el("li", {}, [input, del]));
    });
  }

  // ---- import / export -------------------------------------------------
  function exportJSON() { download(`family-points-${familyCode}-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json"); toast("Datos exportados"); }

  function exportCSV() {
    const head = ["Fecha", "Quién se queda", "Entrada", "Salida", "Nº peques", "Horas válidas", "Puntos", "Nota"];
    const rows = state.shifts.map((s) => [
      s.date, memberById(s.memberId)?.name || "(sin asignar)", s.start, s.end,
      state.settings.perChild ? (s.kids ?? state.children.length) : "",
      fmt(validHours(s)), fmt(shiftPoints(s)), (s.note || "").replace(/"/g, '""'),
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c)}"`).join(";")).join("\r\n");
    download(`family-points-${familyCode}-${todayISO()}.csv`, "﻿" + csv, "text/csv");
    toast("Excel (CSV) exportado");
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importJSON(file) {
    if (!confirm("Importar REEMPLAZARÁ todos los datos actuales de esta familia. ¿Continuar?")) return;
    const reader = new FileReader();
    reader.onload = () => {
      try { state = normalize(JSON.parse(reader.result)); renderAll(); replaceRemote(); toast("Datos importados"); }
      catch { toast("Archivo no válido"); }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm("Esto vaciará los turnos y ajustes de ESTA familia para todos. ¿Seguro?")) return;
    state = defaultState(); renderAll(); replaceRemote(); toast("Familia vaciada");
  }

  // ---- flujo de familia (gate) ----------------------------------------
  function codeFromUrl() {
    const m = location.pathname.match(/\/f\/([^/]+)/i);
    if (m) return decodeURIComponent(m[1]).toUpperCase();
    const q = new URLSearchParams(location.search).get("f");
    return q ? q.toUpperCase() : null;
  }

  function showGate(errorMsg) {
    stopPolling();
    $("#app").hidden = true;
    $("#gate").hidden = false;
    $("#btn-settings").hidden = true;
    $("#btn-home").hidden = true;
    $("#sync-status").hidden = true;
    const err = $("#gate-error");
    err.hidden = !errorMsg;
    if (errorMsg) err.textContent = errorMsg;
    // Botón para volver a la última familia (si la hay), así ver el inicio no pierde nada.
    const last = localStorage.getItem(LAST_KEY);
    const ret = $("#gate-return");
    ret.hidden = !last;
    if (last) ret.textContent = "↩︎ Volver a mi familia (" + last + ")";
  }

  function showApp() {
    $("#gate").hidden = true;
    $("#app").hidden = false;
    $("#btn-settings").hidden = false;
    $("#btn-home").hidden = false;
    $("#fb-code").textContent = familyCode;
    updateWindowHint();
    renderAll();
  }

  function activate(code, data, updatedAt) {
    familyCode = code;
    state = normalize(data);
    lastSyncedAt = updatedAt;
    meId = localStorage.getItem(meKey(familyCode));
    dirtyShiftIds.clear();
    localStorage.setItem(LAST_KEY, familyCode);
    cacheLocal();
    history.replaceState(null, "", "/f/" + familyCode);
    showApp();
    startPolling();
    setSync("saved");
  }

  async function createFamily() {
    try { const res = await API.create(); activate(res.code, res.data, res.updatedAt); toast("Familia creada: " + res.code); }
    catch { showGate("No se pudo crear la familia. ¿Hay conexión?"); }
  }

  async function enterFamily(code, opts = {}) {
    code = String(code || "").trim().toUpperCase();
    if (!code) return showGate();
    try { const res = await API.get(code); activate(res.code, res.data, res.updatedAt); }
    catch (err) {
      if (err.status === 404) return showGate(opts.silent ? null : `No encontramos la familia "${code}". Revisa el código.`);
      const cached = localStorage.getItem(cacheKey(code));
      if (cached) {
        familyCode = code; state = normalize(JSON.parse(cached)); lastSyncedAt = null; meId = localStorage.getItem(meKey(code));
        history.replaceState(null, "", "/f/" + familyCode);
        showApp(); startPolling(); setSync("error");
        return;
      }
      showGate(opts.silent ? null : "Sin conexión. Inténtalo de nuevo.");
    }
  }

  // Ir al inicio (para ver la animación) SIN olvidar la familia: se guarda en
  // LAST_KEY para poder volver con un botón.
  function leaveFamily() {
    stopPolling();
    familyCode = null; state = null; lastSyncedAt = null; meId = null; dirtyShiftIds.clear();
    history.replaceState(null, "", "/");
    $("#gate-code").value = "";
    showGate();
  }

  async function copyLink() {
    const url = location.origin + "/f/" + familyCode;
    try { await navigator.clipboard.writeText(url); toast("Enlace copiado 👍"); }
    catch { window.prompt("Copia el enlace de tu familia:", url); }
  }

  // ---- helpers UI ------------------------------------------------------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }
  function updateWindowHint() { $("#hint-window").textContent = `${state.settings.dayStart}–${state.settings.dayEnd}`; }
  function renderAll() { updateWindowHint(); renderScoreboard(); renderTable(); }

  // ---- eventos ---------------------------------------------------------
  function bind() {
    $("#gate-create").addEventListener("click", createFamily);
    $("#gate-return").addEventListener("click", () => { const c = localStorage.getItem(LAST_KEY); if (c) enterFamily(c); });
    $("#gate-join").addEventListener("submit", (e) => { e.preventDefault(); enterFamily($("#gate-code").value); });

    $("#btn-home").addEventListener("click", leaveFamily);
    $("#btn-copy-link").addEventListener("click", copyLink);
    $("#btn-leave").addEventListener("click", leaveFamily);
    $("#me-select").addEventListener("change", (e) => {
      meId = e.target.value || null;
      if (meId) localStorage.setItem(meKey(familyCode), meId); else localStorage.removeItem(meKey(familyCode));
      renderScoreboard();
    });

    $("#period-control").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-period]");
      if (!b) return;
      period = b.dataset.period;
      localStorage.setItem(PERIOD_KEY, period);
      renderScoreboard();
    });

    $("#btn-add").addEventListener("click", addShift);
    $("#btn-settings").addEventListener("click", openSettings);
    $("#btn-close-settings").addEventListener("click", closeSettings);
    $("#settings-overlay").addEventListener("click", (e) => { if (e.target.id === "settings-overlay") closeSettings(); });

    $("#set-points-per-hour").addEventListener("change", (e) => { state.settings.pointsPerHour = numOr(e.target.value, 1); e.target.value = state.settings.pointsPerHour; queueConfig(); renderAll(); });
    $("#set-day-start").addEventListener("change", (e) => { if (isTime(e.target.value)) state.settings.dayStart = e.target.value; queueConfig(); renderAll(); });
    $("#set-day-end").addEventListener("change", (e) => { if (isTime(e.target.value)) state.settings.dayEnd = e.target.value; queueConfig(); renderAll(); });
    $("#set-perchild").addEventListener("change", (e) => { state.settings.perChild = e.target.checked; queueConfig(); renderAll(); });

    $("#btn-add-member").addEventListener("click", () => {
      const input = $("#new-member-name"); const name = input.value.trim().slice(0, 24);
      if (!name) return;
      state.members.push({ id: uid(), name }); input.value = ""; queueConfig(); renderAll(); renderMembersEditor();
    });
    $("#new-member-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#btn-add-member").click(); } });

    $("#btn-add-child").addEventListener("click", () => {
      const input = $("#new-child-name"); const name = input.value.trim().slice(0, 24);
      if (!name) return;
      state.children.push({ id: uid(), name }); input.value = ""; queueConfig(); renderChildrenEditor(); renderTable();
    });
    $("#new-child-name").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); $("#btn-add-child").click(); } });

    $("#btn-export-json").addEventListener("click", exportJSON);
    $("#btn-export-csv").addEventListener("click", exportCSV);
    $("#btn-import-json").addEventListener("click", () => $("#file-input").click());
    $("#file-input").addEventListener("change", (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; });
    $("#btn-reset").addEventListener("click", resetAll);

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings(); });
    window.addEventListener("online", () => { if (familyCode && hasPending()) flushShifts(); });
  }

  // ---- init ------------------------------------------------------------
  async function boot() {
    bind();
    const code = codeFromUrl() || localStorage.getItem(LAST_KEY);
    if (code) await enterFamily(code, { silent: true });
    else showGate();
  }

  boot();
})();
