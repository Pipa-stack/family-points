/* Family Points — puntos por cuidar de los peques.
   Sin backend: todo se guarda en localStorage. Nada hardcodeado: miembros,
   peques y reglas de puntos son editables en Ajustes. */
(() => {
  "use strict";

  const STORAGE_KEY = "family-points:v1";
  const PALETTE = [
    "var(--accent-1)", "var(--accent-2)", "var(--accent-3)",
    "var(--accent-4)", "var(--accent-5)", "var(--accent-6)",
  ];

  // ---- Estado ----------------------------------------------------------
  const uid = () => Math.random().toString(36).slice(2, 9);
  const todayISO = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD local

  function defaultState() {
    return {
      settings: { pointsPerHour: 1, dayStart: "06:00", dayEnd: "22:00", perChild: false },
      members: [
        { id: uid(), name: "Papá" },
        { id: uid(), name: "Mamá" },
      ],
      children: [{ id: uid(), name: "Peque" }],
      shifts: [],
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      const data = JSON.parse(raw);
      return normalize(data);
    } catch {
      return defaultState();
    }
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
      children: Array.isArray(s.children)
        ? s.children.map((c) => ({ id: c.id || uid(), name: String(c.name || "").slice(0, 24) || "Peque" }))
        : base.children,
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

  const numOr = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  const isTime = (v) => typeof v === "string" && /^\d{2}:\d{2}$/.test(v);
  const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

  let state = load();
  const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

  // ---- Cálculo de puntos ----------------------------------------------
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

  /** Horas válidas de un turno, recortadas al horario permitido. */
  function validHours(shift) {
    if (!isTime(shift.start) || !isTime(shift.end)) return 0;
    const winStart = toMin(state.settings.dayStart);
    const winEnd = toMin(state.settings.dayEnd);
    const s = Math.max(toMin(shift.start), winStart);
    const e = Math.min(toMin(shift.end), winEnd);
    return Math.max(0, e - s) / 60;
  }

  function shiftPoints(shift) {
    const hours = validHours(shift);
    let pts = hours * state.settings.pointsPerHour;
    if (state.settings.perChild) {
      const kids = Number.isFinite(shift.kids) && shift.kids > 0 ? shift.kids : state.children.length || 1;
      pts *= kids;
    }
    return pts;
  }

  const memberById = (id) => state.members.find((m) => m.id === id);
  const colorFor = (id) => {
    const i = state.members.findIndex((m) => m.id === id);
    return PALETTE[(i < 0 ? 0 : i) % PALETTE.length];
  };
  const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString("es-ES");

  // ---- Render: marcador ------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    for (const c of [].concat(children)) if (c != null) node.append(c);
    return node;
  };

  function renderScoreboard() {
    const board = $("#scoreboard");
    board.innerHTML = "";
    const totals = state.members.map((m) => ({
      member: m,
      points: state.shifts.filter((s) => s.memberId === m.id).reduce((a, s) => a + shiftPoints(s), 0),
    }));
    const max = Math.max(0, ...totals.map((t) => t.points));

    for (const t of totals) {
      const isLeader = max > 0 && t.points === max;
      const card = el("div", { className: "score-card" + (isLeader ? " leader" : "") });
      card.style.setProperty("--chip", colorFor(t.member.id));
      card.append(
        el("div", { className: "who" }, [
          el("span", { className: "dot" }),
          document.createTextNode(t.member.name),
        ]),
        el("div", { className: "points" }, [
          document.createTextNode(fmt(t.points)),
          el("span", { className: "unit" }, " pts"),
        ]),
        el("div", { className: "sub" }, `${state.shifts.filter((s) => s.memberId === t.member.id).length} turnos`),
      );
      if (isLeader) card.append(el("div", { className: "crown", title: "En cabeza" }, "👑"));
      board.append(card);
    }
  }

  // ---- Render: tabla ---------------------------------------------------
  function renderTable() {
    const body = $("#shifts-body");
    body.innerHTML = "";
    $("#empty-state").hidden = state.shifts.length > 0;

    // columna nº peques según ajuste
    document.querySelectorAll("[data-perchild-col]").forEach((c) => (c.hidden = !state.settings.perChild));

    for (const shift of state.shifts) {
      body.append(renderRow(shift));
    }
  }

  function renderRow(shift) {
    const tr = el("tr");

    // Fecha
    tr.append(cell(inputEl("date", shift.date, (v) => update(shift, "date", v))));

    // Miembro
    const sel = el("select", { className: "cell-select" });
    for (const m of state.members) {
      sel.append(el("option", { value: m.id, textContent: m.name, selected: m.id === shift.memberId }));
    }
    if (!shift.memberId && state.members[0]) { shift.memberId = state.members[0].id; }
    sel.value = shift.memberId;
    sel.addEventListener("change", () => update(shift, "memberId", sel.value));
    tr.append(cell(sel));

    // Entrada / salida
    tr.append(cell(inputEl("time", shift.start, (v) => update(shift, "start", v))));
    tr.append(cell(inputEl("time", shift.end, (v) => update(shift, "end", v))));

    // Nº peques (opcional)
    const kidsTd = cell(
      inputEl("number", shift.kids != null ? shift.kids : "", (v) => update(shift, "kids", v === "" ? null : Math.max(0, parseInt(v, 10) || 0)), {
        min: "0", step: "1", placeholder: String(state.children.length || 1),
      })
    );
    kidsTd.className = "col-kids";
    kidsTd.hidden = !state.settings.perChild;
    tr.append(kidsTd);

    // Nota
    tr.append(cell(inputEl("text", shift.note, (v) => update(shift, "note", v), { placeholder: "Opcional", maxLength: "120" })));

    // Horas válidas
    const hours = validHours(shift);
    tr.append(el("td", { className: "cell-valid", textContent: hours ? fmt(hours) + " h" : "—" }));

    // Puntos
    const pts = shiftPoints(shift);
    const invalid = isTime(shift.start) && isTime(shift.end) && hours === 0;
    tr.append(el("td", { className: "cell-points" + (pts === 0 ? " warn" : ""), textContent: invalid ? "0 (fuera de horario)" : fmt(pts) }));

    // Borrar
    const del = el("button", { className: "row-del", title: "Borrar turno", textContent: "🗑️" });
    del.addEventListener("click", () => {
      state.shifts = state.shifts.filter((s) => s.id !== shift.id);
      save(); renderAll();
    });
    tr.append(el("td", { className: "col-actions" }, del));

    return tr;
  }

  function cell(node) { const td = el("td"); td.append(node); return td; }

  function inputEl(type, value, onInput, extra = {}) {
    const input = el("input", Object.assign({ type, value: value ?? "", className: "cell-input" }, extra));
    input.addEventListener("change", () => onInput(input.value));
    return input;
  }

  function update(shift, key, value) {
    shift[key] = value;
    save();
    // recalcular filas + marcador sin perder el foco de edición
    renderScoreboard();
    // actualizar solo celdas calculadas de la fila afectada es más complejo;
    // un re-render completo de la tabla es barato para uso familiar.
    renderTable();
  }

  // ---- Añadir turno ----------------------------------------------------
  function addShift() {
    const last = state.shifts[state.shifts.length - 1];
    state.shifts.push({
      id: uid(),
      date: last?.date || todayISO(),
      memberId: state.members[0]?.id || "",
      start: "",
      end: "",
      kids: null,
      note: "",
    });
    save();
    renderAll();
    // enfocar la primera celda editable del nuevo turno
    const rows = $("#shifts-body").querySelectorAll("tr");
    rows[rows.length - 1]?.querySelector("input")?.focus();
  }

  // ---- Ajustes ---------------------------------------------------------
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
      const input = el("input", { type: "text", value: m.name, maxLength: "24" });
      input.addEventListener("change", () => {
        m.name = input.value.trim().slice(0, 24) || "Sin nombre";
        input.value = m.name; save(); renderScoreboard(); renderTable();
      });
      const del = el("button", { className: "row-del", textContent: "🗑️", title: "Quitar miembro" });
      del.addEventListener("click", () => {
        if (state.members.length <= 1) return toast("Debe haber al menos un miembro");
        if (state.shifts.some((s) => s.memberId === m.id) &&
            !confirm(`"${m.name}" tiene turnos apuntados. ¿Quitarlo igualmente? (sus turnos quedarán sin asignar)`)) return;
        state.members = state.members.filter((x) => x.id !== m.id);
        save(); renderAll(); renderSettings();
      });
      ul.append(el("li", {}, [dot, input, del]));
    });
  }

  function renderChildrenEditor() {
    const ul = $("#children-list");
    ul.innerHTML = "";
    state.children.forEach((c) => {
      const input = el("input", { type: "text", value: c.name, maxLength: "24" });
      input.addEventListener("change", () => {
        c.name = input.value.trim().slice(0, 24) || "Peque"; input.value = c.name; save();
      });
      const del = el("button", { className: "row-del", textContent: "🗑️", title: "Quitar peque" });
      del.addEventListener("click", () => {
        state.children = state.children.filter((x) => x.id !== c.id);
        save(); renderChildrenEditor(); renderTable();
      });
      ul.append(el("li", {}, [input, del]));
    });
  }

  // ---- Import / export -------------------------------------------------
  function exportJSON() {
    download(`family-points-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json");
    toast("Datos exportados");
  }

  function exportCSV() {
    const head = ["Fecha", "Quién se queda", "Entrada", "Salida", "Nº peques", "Horas válidas", "Puntos", "Nota"];
    const rows = state.shifts.map((s) => [
      s.date,
      memberById(s.memberId)?.name || "",
      s.start, s.end,
      state.settings.perChild ? (s.kids ?? state.children.length) : "",
      fmt(validHours(s)),
      fmt(shiftPoints(s)),
      (s.note || "").replace(/"/g, '""'),
    ]);
    const csv = [head, ...rows]
      .map((r) => r.map((c) => `"${String(c)}"`).join(";"))
      .join("\r\n");
    download(`family-points-${todayISO()}.csv`, "﻿" + csv, "text/csv");
    toast("Excel (CSV) exportado");
  }

  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = el("a", { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function importJSON(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        state = normalize(JSON.parse(reader.result));
        save(); renderAll();
        toast("Datos importados");
      } catch {
        toast("Archivo no válido");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm("Esto borrará todos los turnos y ajustes de este navegador. ¿Seguro?")) return;
    state = defaultState();
    save(); renderAll();
    toast("Reiniciado");
  }

  // ---- UI helpers ------------------------------------------------------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2200);
  }

  function updateWindowHint() {
    $("#hint-window").textContent = `${state.settings.dayStart}–${state.settings.dayEnd}`;
  }

  function renderAll() {
    updateWindowHint();
    renderScoreboard();
    renderTable();
  }

  // ---- Eventos ---------------------------------------------------------
  function bind() {
    $("#btn-add").addEventListener("click", addShift);
    $("#btn-settings").addEventListener("click", openSettings);
    $("#btn-close-settings").addEventListener("click", closeSettings);
    $("#settings-overlay").addEventListener("click", (e) => { if (e.target.id === "settings-overlay") closeSettings(); });

    $("#set-points-per-hour").addEventListener("change", (e) => {
      state.settings.pointsPerHour = numOr(e.target.value, 1); e.target.value = state.settings.pointsPerHour;
      save(); renderAll();
    });
    $("#set-day-start").addEventListener("change", (e) => {
      if (isTime(e.target.value)) state.settings.dayStart = e.target.value;
      save(); renderAll();
    });
    $("#set-day-end").addEventListener("change", (e) => {
      if (isTime(e.target.value)) state.settings.dayEnd = e.target.value;
      save(); renderAll();
    });
    $("#set-perchild").addEventListener("change", (e) => {
      state.settings.perChild = e.target.checked; save(); renderAll();
    });

    $("#btn-add-member").addEventListener("click", () => {
      const input = $("#new-member-name");
      const name = input.value.trim().slice(0, 24);
      if (!name) return;
      state.members.push({ id: uid(), name });
      input.value = ""; save(); renderAll(); renderMembersEditor();
    });
    $("#new-member-name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-add-member").click(); });

    $("#btn-add-child").addEventListener("click", () => {
      const input = $("#new-child-name");
      const name = input.value.trim().slice(0, 24);
      if (!name) return;
      state.children.push({ id: uid(), name });
      input.value = ""; save(); renderChildrenEditor(); renderTable();
    });
    $("#new-child-name").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#btn-add-child").click(); });

    $("#btn-export-json").addEventListener("click", exportJSON);
    $("#btn-export-csv").addEventListener("click", exportCSV);
    $("#btn-import-json").addEventListener("click", () => $("#file-input").click());
    $("#file-input").addEventListener("change", (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); e.target.value = ""; });
    $("#btn-reset").addEventListener("click", resetAll);

    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSettings(); });
  }

  // ---- Init ------------------------------------------------------------
  bind();
  renderAll();
})();
