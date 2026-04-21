const STORAGE_KEY = "teacher_mvp_data_v1";
const TEMPLATE_KEY = "oneclass_templates_v1";
const LOW_HOURS_THRESHOLD = 2;
const SLOT_START_HOUR = 7;
const SLOT_END_HOUR = 22;
const SLOT_HEIGHT = 52;

const weekdayNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const state = {
  data: loadData(),
  templates: loadTemplates(),
  pendingAttendance: null,
  currentWeekStart: startOfWeek(new Date()),
  selectedStudentId: null
};

const el = {
  studentForm: document.getElementById("studentForm"),
  classForm: document.getElementById("classForm"),
  lessonForm: document.getElementById("lessonForm"),
  lessonTypeSelect: document.getElementById("lessonTypeSelect"),
  lessonScopeSelect: document.getElementById("lessonScopeSelect"),
  lessonStudentSelect: document.getElementById("lessonStudentSelect"),
  lessonClassSelect: document.getElementById("lessonClassSelect"),
  studentTableBody: document.getElementById("studentTableBody"),
  dashboardStats: document.getElementById("dashboardStats"),
  lowHoursList: document.getElementById("lowHoursList"),
  pendingLessonList: document.getElementById("pendingLessonList"),
  scheduleGrid: document.getElementById("scheduleGrid"),
  weekLabel: document.getElementById("weekLabel"),
  prevWeekBtn: document.getElementById("prevWeekBtn"),
  nextWeekBtn: document.getElementById("nextWeekBtn"),
  todayWeekBtn: document.getElementById("todayWeekBtn"),
  studentDetail: document.getElementById("studentDetail"),
  importFileInput: document.getElementById("importFileInput")
};

bindEvents();
renderAll();

function bindEvents() {
  el.studentForm.addEventListener("submit", handleCreateStudent);
  el.classForm.addEventListener("submit", handleCreateClass);
  el.lessonForm.addEventListener("submit", handleCreateLesson);
  el.lessonTypeSelect.addEventListener("change", toggleLessonTypeFields);
  el.lessonScopeSelect.addEventListener("change", toggleLessonScopeFields);

  el.prevWeekBtn.addEventListener("click", () => {
    state.currentWeekStart = addDays(state.currentWeekStart, -7);
    renderSchedule();
  });
  el.nextWeekBtn.addEventListener("click", () => {
    state.currentWeekStart = addDays(state.currentWeekStart, 7);
    renderSchedule();
  });
  el.todayWeekBtn.addEventListener("click", () => {
    state.currentWeekStart = startOfWeek(new Date());
    renderSchedule();
  });

  // Import / export
  document.getElementById("exportJsonBtn").addEventListener("click", exportJson);
  document.getElementById("importJsonBtn").addEventListener("click", () => el.importFileInput.click());
  el.importFileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) { importJson(e.target.files[0]); e.target.value = ""; }
  });
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);

  // Template modal — stopPropagation prevents body handler from also firing
  document.getElementById("templateBtn").addEventListener("click", openTemplateModal);
  document.getElementById("templateModal").addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.id === "templateModal" || e.target.closest("#closeTemplateModal")) { closeTemplateModal(); return; }
    const applyBtn = e.target.closest("[data-apply-tpl]");
    if (applyBtn) { applyTemplate(applyBtn.dataset.applyTpl); return; }
    const deleteBtn = e.target.closest("[data-delete-tpl]");
    if (deleteBtn) { deleteTemplate(deleteBtn.dataset.deleteTpl); }
  });
  document.getElementById("saveAsTemplateBtn").addEventListener("click", saveAsTemplate);

  // Attendance modal
  document.getElementById("attendanceModal").addEventListener("click", (e) => {
    e.stopPropagation();
    if (e.target.id === "attendanceModal" || e.target.closest("#closeAttendanceModal")) { closeAttendanceModal(); return; }
    if (e.target.closest("#confirmAttendanceBtn")) { confirmAttendance(); return; }
    const attBtn = e.target.closest(".att-btn");
    if (attBtn) {
      const row = attBtn.closest(".attendance-row");
      if (row) setAttendanceStatus(row.dataset.studentId, attBtn.dataset.status, row);
    }
  });
  document.getElementById("attendanceModal").addEventListener("input", (e) => {
    const noteInput = e.target.closest(".att-note");
    if (noteInput && state.pendingAttendance) {
      const row = noteInput.closest(".attendance-row");
      if (row) state.pendingAttendance.records[row.dataset.studentId].note = e.target.value;
    }
  });

  // Escape key closes any open modal
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (!document.getElementById("attendanceModal").classList.contains("hidden")) { closeAttendanceModal(); return; }
    if (!document.getElementById("templateModal").classList.contains("hidden")) { closeTemplateModal(); }
  });

  // Global delegation
  document.body.addEventListener("click", (event) => {
    const attendBtn = event.target.closest("[data-attend-lesson]");
    if (attendBtn) { openAttendanceModal(attendBtn.dataset.attendLesson); return; }
    const viewBtn = event.target.closest("[data-view-student]");
    if (viewBtn) { state.selectedStudentId = viewBtn.dataset.viewStudent; renderStudentDetail(); return; }
    const deleteClassBtn = event.target.closest("[data-delete-class]");
    if (deleteClassBtn) { deleteClass(deleteClassBtn.dataset.deleteClass); }
  });
}

// ─── Import / Export ────────────────────────────────────────────────────────

function exportJson() {
  const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: "application/json" });
  downloadBlob(blob, `oneclass-backup-${toDateInputValue(new Date())}.json`);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed.students) || !Array.isArray(parsed.lessons) || !Array.isArray(parsed.transactions)) {
        alert("文件格式不正确，请选择 Oneclass 导出的备份文件");
        return;
      }
      if (!confirm("导入将覆盖当前所有数据，确认继续？")) return;
      state.data = {
        students: parsed.students,
        lessons: parsed.lessons,
        transactions: parsed.transactions,
        classes: Array.isArray(parsed.classes) ? parsed.classes : [],
        attendance: Array.isArray(parsed.attendance) ? parsed.attendance : []
      };
      saveData();
      renderAll();
    } catch {
      alert("文件解析失败，请确认是有效的 JSON 文件");
    }
  };
  reader.readAsText(file);
}

function exportCsv() {
  if (!state.data.transactions.length) { alert("暂无流水数据可导出"); return; }
  const headers = ["时间", "学生", "类型", "课时", "结余", "备注"];
  const rows = [...state.data.transactions]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((t) => {
      const student = getStudentById(t.studentId);
      return [
        fmtDateTime(t.createdAt),
        student?.name || "",
        txnTypeLabel(t.type),
        t.hours,
        t.balanceAfter,
        t.note || ""
      ].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",");
    });
  const csv = "﻿" + [headers.join(","), ...rows].join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), `oneclass-流水-${toDateInputValue(new Date())}.csv`);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Templates ──────────────────────────────────────────────────────────────

function openTemplateModal() {
  renderTemplateModal();
  document.getElementById("templateModal").classList.remove("hidden");
}

function closeTemplateModal() {
  document.getElementById("templateModal").classList.add("hidden");
}

function renderTemplateModal() {
  const list = document.getElementById("templateList");
  if (!state.templates.length) {
    list.innerHTML = "<p class='template-empty'>暂无模板。填写排课表单后点"将当前表单保存为模板"创建。</p>";
    return;
  }
  list.innerHTML = "";
  state.templates.forEach((tpl) => {
    const div = document.createElement("div");
    div.className = "template-item";
    div.innerHTML = `
      <div class="template-info">
        <strong>${escapeHtml(tpl.name)}</strong>
        <small>${escapeHtml(tpl.title)} · ${tpl.hours} 课时 · ${tpl.startTime}–${tpl.endTime}</small>
      </div>
      <div class="template-actions">
        <button type="button" data-apply-tpl="${tpl.id}">应用</button>
        <button type="button" class="danger" data-delete-tpl="${tpl.id}">删除</button>
      </div>
    `;
    list.appendChild(div);
  });
}

function saveAsTemplate() {
  const fd = new FormData(el.lessonForm);
  const title = String(fd.get("title") || "").trim();
  if (!title) { alert("请先在排课表单中填写课程名称"); return; }
  const name = prompt("模板名称（直接回车则使用课程名称）：", title);
  if (name === null) return;
  state.templates.push({
    id: uid("tpl"),
    name: name.trim() || title,
    title,
    hours: Number(fd.get("hours")) || 1,
    startTime: String(fd.get("startTime") || "18:00"),
    endTime: String(fd.get("endTime") || "19:00")
  });
  saveTemplates();
  renderTemplateModal();
}

function applyTemplate(id) {
  const tpl = state.templates.find((t) => t.id === id);
  if (!tpl) return;
  const set = (name, value) => { const inp = el.lessonForm.querySelector(`[name="${name}"]`); if (inp) inp.value = value; };
  set("title", tpl.title);
  set("hours", tpl.hours);
  set("startTime", tpl.startTime);
  set("endTime", tpl.endTime);
  closeTemplateModal();
}

function deleteTemplate(id) {
  if (!confirm("确认删除此模板？")) return;
  state.templates = state.templates.filter((t) => t.id !== id);
  saveTemplates();
  renderTemplateModal();
}

// ─── Class management ────────────────────────────────────────────────────────

function handleCreateClass(event) {
  event.preventDefault();
  const fd = new FormData(el.classForm);
  const name = String(fd.get("name") || "").trim();
  const studentIds = fd.getAll("studentIds");
  if (!name) { alert("请填写班级名称"); return; }
  state.data.classes.push({ id: uid("cls"), name, studentIds, createdAt: nowIso() });
  saveData();
  el.classForm.reset();
  renderAll();
  // reset dynamically rendered checkboxes (form.reset() skips them)
  document.querySelectorAll("#classStudentChecks input[type='checkbox']").forEach((cb) => { cb.checked = false; });
}

function renderClassStudentChecks() {
  const container = document.getElementById("classStudentChecks");
  if (!container) return;
  container.innerHTML = "";
  if (!state.data.students.length) {
    container.innerHTML = '<span style="color:var(--muted);font-size:12px">请先添加学生</span>';
    return;
  }
  [...state.data.students]
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    .forEach((student) => {
      const label = document.createElement("label");
      label.className = "student-check-item";
      label.innerHTML = `<input type="checkbox" name="studentIds" value="${student.id}" />${escapeHtml(student.name)}`;
      container.appendChild(label);
    });
}

function renderClasses() {
  const container = document.getElementById("classList");
  if (!container) return;
  if (!state.data.classes.length) {
    container.innerHTML = '<p class="empty-hint">暂无班级，从左侧创建</p>';
    return;
  }
  container.innerHTML = "";
  state.data.classes.forEach((cls) => {
    const students = cls.studentIds.map((id) => getStudentById(id)).filter(Boolean);
    const div = document.createElement("div");
    div.className = "class-item";
    div.innerHTML = `
      <div class="class-item-info">
        <strong>${escapeHtml(cls.name)}</strong>
        <small>${students.length} 名学生：${students.map((s) => escapeHtml(s.name)).join("、") || "暂无"}</small>
      </div>
      <button type="button" class="danger" style="padding:4px 10px;font-size:12px;flex-shrink:0" data-delete-class="${cls.id}">删除</button>
    `;
    container.appendChild(div);
  });
}

function renderClassOptions() {
  if (!el.lessonClassSelect) return;
  el.lessonClassSelect.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "请选择班级";
  el.lessonClassSelect.appendChild(def);
  state.data.classes.forEach((cls) => {
    const opt = document.createElement("option");
    opt.value = cls.id;
    opt.textContent = `${cls.name}（${cls.studentIds.length}人）`;
    el.lessonClassSelect.appendChild(opt);
  });
}

function deleteClass(id) {
  const cls = state.data.classes.find((c) => c.id === id);
  if (!cls) return;
  if (!confirm(`确认删除班级「${cls.name}」？已排课程不受影响。`)) return;
  state.data.classes = state.data.classes.filter((c) => c.id !== id);
  saveData();
  renderAll();
}

function getClassById(id) {
  return state.data.classes.find((c) => c.id === id);
}

// ─── Attendance ───────────────────────────────────────────────────────────────

function openAttendanceModal(lessonId) {
  const lesson = state.data.lessons.find((l) => l.id === lessonId);
  if (!lesson || lesson.status === "completed") return;
  renderAttendanceModal(lesson);
  document.getElementById("attendanceModal").classList.remove("hidden");
}

function closeAttendanceModal() {
  document.getElementById("attendanceModal").classList.add("hidden");
  state.pendingAttendance = null;
}

function renderAttendanceModal(lesson) {
  document.getElementById("attendanceModalTitle").textContent = lesson.title;
  document.getElementById("attendanceModalSubtitle").textContent =
    `${lesson.date} ${lesson.startTime}–${lesson.endTime} · 扣减 ${round1(lesson.hours)} 课时/人`;

  let students = [];
  if (lesson.lessonType === "group" && lesson.classId) {
    const cls = getClassById(lesson.classId);
    if (cls) students = cls.studentIds.map((id) => getStudentById(id)).filter(Boolean);
  } else {
    const student = getStudentById(lesson.studentId);
    if (student) students = [student];
  }

  state.pendingAttendance = {
    lessonId: lesson.id,
    records: Object.fromEntries(students.map((s) => [s.id, { status: "attended", note: "" }]))
  };

  const body = document.getElementById("attendanceModalBody");
  if (!students.length) {
    body.innerHTML = "<p style='color:var(--muted);text-align:center;padding:20px 0'>找不到相关学生信息</p>";
    return;
  }

  body.innerHTML = "";
  students.forEach((student) => {
    const low = student.remainingHours - lesson.hours <= LOW_HOURS_THRESHOLD;
    const row = document.createElement("div");
    row.className = "attendance-row";
    row.dataset.studentId = student.id;
    row.innerHTML = `
      <div class="attendance-row-top">
        <div>
          <strong>${escapeHtml(student.name)}</strong>
          <span style="color:${low ? "var(--danger)" : "var(--muted)"};font-size:12px;margin-left:6px">
            余 ${round1(student.remainingHours)} 课时
          </span>
        </div>
        <div class="att-btns">
          <button type="button" class="att-btn active-attended" data-status="attended">上课</button>
          <button type="button" class="att-btn" data-status="absent">请假</button>
          <button type="button" class="att-btn" data-status="other">其他</button>
        </div>
      </div>
      <input type="text" class="att-note hidden" placeholder="请填写备注说明..." />
    `;
    body.appendChild(row);
  });
}

function setAttendanceStatus(studentId, status, rowEl) {
  if (!state.pendingAttendance?.records[studentId]) return;
  state.pendingAttendance.records[studentId].status = status;
  if (status !== "other") state.pendingAttendance.records[studentId].note = "";

  rowEl.querySelectorAll(".att-btn").forEach((btn) => {
    btn.className = "att-btn";
    if (btn.dataset.status === status) btn.classList.add(`active-${status}`);
  });

  const noteInput = rowEl.querySelector(".att-note");
  if (noteInput) {
    noteInput.classList.toggle("hidden", status !== "other");
    if (status !== "other") noteInput.value = "";
  }
}

function confirmAttendance() {
  if (!state.pendingAttendance) return;
  const { lessonId, records } = state.pendingAttendance;

  for (const [studentId, record] of Object.entries(records)) {
    if (record.status === "other" && !record.note.trim()) {
      const student = getStudentById(studentId);
      alert(`请为「${student?.name || "学生"}」的"其他"状态填写备注`);
      return;
    }
  }

  const lesson = state.data.lessons.find((l) => l.id === lessonId);
  if (!lesson) { closeAttendanceModal(); return; }

  for (const [studentId, record] of Object.entries(records)) {
    const student = getStudentById(studentId);
    if (!student) continue;

    if (record.status === "attended") {
      const nextBalance = round1(student.remainingHours - lesson.hours);
      student.remainingHours = nextBalance;
      state.data.transactions.push({
        id: uid("txn"), studentId, lessonId,
        type: "deduct",
        hours: lesson.hours,
        balanceAfter: nextBalance,
        createdAt: nowIso(),
        note: `${lesson.title} ${lesson.date} ${lesson.startTime}-${lesson.endTime}`
      });
    } else {
      const noteText = record.status === "other" ? ` · ${record.note}` : "";
      state.data.transactions.push({
        id: uid("txn"), studentId, lessonId,
        type: record.status,
        hours: 0,
        balanceAfter: round1(student.remainingHours),
        createdAt: nowIso(),
        note: `[${record.status === "absent" ? "请假" : "其他"}${noteText}] ${lesson.title} ${lesson.date}`
      });
    }

    state.data.attendance.push({
      id: uid("att"), lessonId, studentId,
      status: record.status,
      note: record.note,
      hoursDeducted: record.status === "attended" ? lesson.hours : 0,
      createdAt: nowIso()
    });
  }

  lesson.status = "completed";
  lesson.completedAt = nowIso();
  state.pendingAttendance = null;

  saveData();
  closeAttendanceModal();
  renderAll();
}

// ─── Student / Lesson handlers ───────────────────────────────────────────────

function handleCreateStudent(event) {
  event.preventDefault();
  const fd = new FormData(el.studentForm);
  const name = String(fd.get("name") || "").trim();
  const contact = String(fd.get("contact") || "").trim();
  const totalHours = Number(fd.get("hours"));
  if (!name || Number.isNaN(totalHours) || totalHours < 0) { alert("请填写正确的学生信息"); return; }
  state.data.students.push({ id: uid("stu"), name, contact, totalHours, remainingHours: totalHours, createdAt: nowIso() });
  saveData();
  el.studentForm.reset();
  renderAll();
}

function handleCreateLesson(event) {
  event.preventDefault();
  const fd = new FormData(el.lessonForm);
  const scope = String(fd.get("scope") || "individual");
  const studentId = scope === "individual" ? String(fd.get("studentId") || "") : null;
  const classId = scope === "group" ? String(fd.get("classId") || "") : null;
  const title = String(fd.get("title") || "").trim();
  const type = String(fd.get("type") || "single");
  const hours = Number(fd.get("hours"));
  const startTime = String(fd.get("startTime"));
  const endTime = String(fd.get("endTime"));

  if (!title || !startTime || !endTime || Number.isNaN(hours) || hours <= 0) { alert("请完整填写课程信息"); return; }
  if (scope === "individual" && !studentId) { alert("请选择学生"); return; }
  if (scope === "group" && !classId) { alert("请选择班级"); return; }
  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) { alert("结束时间必须晚于开始时间"); return; }

  const dates = [];
  if (type === "single") {
    const date = String(fd.get("date") || "");
    if (!date) { alert("请选择上课日期"); return; }
    dates.push(date);
  } else {
    const weekday = Number(fd.get("weekday"));
    const startDate = String(fd.get("startDate") || "");
    const endDate = String(fd.get("endDate") || "");
    if (!startDate || !endDate) { alert("请填写周期课的起止日期"); return; }
    const generated = generateRecurringDates(startDate, endDate, weekday);
    if (!generated.length) { alert("周期范围内没有匹配周几的日期"); return; }
    dates.push(...generated);
  }

  for (const date of dates) {
    state.data.lessons.push({
      id: uid("les"), studentId, classId, lessonType: scope,
      title, date, startTime, endTime, hours,
      status: "scheduled", createdAt: nowIso(), completedAt: null
    });
  }

  saveData();
  el.lessonForm.reset();
  presetLessonFormDate();
  toggleLessonTypeFields();
  toggleLessonScopeFields();
  renderAll();
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderAll() {
  renderStudentOptions();
  renderStudents();
  renderClassStudentChecks();
  renderClasses();
  renderClassOptions();
  renderDashboard();
  renderSchedule();
  renderStudentDetail();
  presetLessonFormDate();
}

function renderStudentOptions() {
  el.lessonStudentSelect.innerHTML = "";
  const def = document.createElement("option");
  def.value = "";
  def.textContent = "请选择学生";
  el.lessonStudentSelect.appendChild(def);
  state.data.students.forEach((student) => {
    const opt = document.createElement("option");
    opt.value = student.id;
    opt.textContent = `${student.name}（余 ${round1(student.remainingHours)}）`;
    el.lessonStudentSelect.appendChild(opt);
  });
}

function renderStudents() {
  const students = [...state.data.students].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  el.studentTableBody.innerHTML = "";
  students.forEach((student) => {
    const tr = document.createElement("tr");
    const remaining = round1(student.remainingHours);
    const recent = getRecentCompletedLesson(student.id);
    tr.innerHTML = `
      <td>${escapeHtml(student.name)}</td>
      <td>${escapeHtml(student.contact || "-")}</td>
      <td>${round1(student.totalHours)}</td>
      <td class="${remaining <= LOW_HOURS_THRESHOLD ? "low" : ""}">${remaining}</td>
      <td>${recent ? `${recent.date} ${recent.startTime}` : "-"}</td>
      <td><button type="button" class="secondary" data-view-student="${student.id}">查看</button></td>
    `;
    el.studentTableBody.appendChild(tr);
  });
}

function renderDashboard() {
  const students = state.data.students;
  const lessons = state.data.lessons;
  const lowStudents = students.filter((s) => Number(s.remainingHours) <= LOW_HOURS_THRESHOLD);
  const completedCount = lessons.filter((l) => l.status === "completed").length;
  const scheduledCount = lessons.filter((l) => l.status !== "completed").length;

  el.dashboardStats.innerHTML = `
    <div class="stat-card"><span>学生总数</span><b>${students.length}</b></div>
    <div class="stat-card"><span>待签到</span><b>${scheduledCount}</b></div>
    <div class="stat-card"><span>已完成</span><b>${completedCount}</b></div>
  `;

  el.lowHoursList.innerHTML = "";
  if (!lowStudents.length) {
    el.lowHoursList.innerHTML = "<li>当前没有低课时学生</li>";
  } else {
    lowStudents.sort((a, b) => a.remainingHours - b.remainingHours).forEach((student) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(student.name)}</strong>：剩余 <span class="low">${round1(student.remainingHours)}</span> 课时`;
      el.lowHoursList.appendChild(li);
    });
  }

  const pending = [...lessons]
    .filter((l) => l.status !== "completed")
    .sort((a, b) => compareLessonDateTime(a, b))
    .slice(0, 8);

  el.pendingLessonList.innerHTML = "";
  if (!pending.length) {
    el.pendingLessonList.innerHTML = "<li>暂无待签到课程</li>";
  } else {
    pending.forEach((lesson) => {
      const li = document.createElement("li");
      li.innerHTML = `
        ${lesson.date} ${lesson.startTime}-${lesson.endTime} | ${escapeHtml(lesson.title)} | ${escapeHtml(getLessonDisplayName(lesson))}
        <div class="card-actions">
          <button type="button" data-attend-lesson="${lesson.id}">签到</button>
        </div>
      `;
      el.pendingLessonList.appendChild(li);
    });
  }
}

function renderSchedule() {
  const weekDates = getWeekDates(state.currentWeekStart);
  const weekEnd = addDays(state.currentWeekStart, 6);
  el.weekLabel.textContent = `${fmtDate(state.currentWeekStart)} - ${fmtDate(weekEnd)}`;
  el.scheduleGrid.innerHTML = "";

  const totalHours = SLOT_END_HOUR - SLOT_START_HOUR;
  const bodyHeight = totalHours * SLOT_HEIGHT;

  const timeCol = document.createElement("div");
  timeCol.className = "time-col";
  timeCol.innerHTML = `<div class="cell-head">时间</div>`;
  for (let h = SLOT_START_HOUR; h < SLOT_END_HOUR; h += 1) {
    const slot = document.createElement("div");
    slot.className = "time-slot";
    slot.textContent = `${pad2(h)}:00`;
    timeCol.appendChild(slot);
  }
  el.scheduleGrid.appendChild(timeCol);

  const weekLessons = state.data.lessons.filter((lesson) => isDateInWeek(lesson.date, state.currentWeekStart));

  weekDates.forEach((date) => {
    const dayLessons = weekLessons
      .filter((lesson) => lesson.date === date)
      .sort((a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

    const dayCol = document.createElement("div");
    dayCol.className = "day-col";
    dayCol.innerHTML = `<div class="cell-head">${weekdayNames[new Date(date + "T00:00:00").getDay()]}<br/>${date.slice(5)}</div>`;

    const dayBody = document.createElement("div");
    dayBody.className = "day-body";
    dayBody.style.height = `${bodyHeight}px`;

    for (let h = SLOT_START_HOUR; h < SLOT_END_HOUR; h += 1) {
      const slot = document.createElement("div");
      slot.className = "time-slot";
      dayBody.appendChild(slot);
    }

    dayLessons.forEach((lesson) => dayBody.appendChild(buildLessonCard(lesson)));
    dayCol.appendChild(dayBody);
    el.scheduleGrid.appendChild(dayCol);
  });
}

function buildLessonCard(lesson) {
  const displayName = getLessonDisplayName(lesson);
  const startMin = timeToMinutes(lesson.startTime);
  const endMin = timeToMinutes(lesson.endTime);
  const dayStart = SLOT_START_HOUR * 60;
  const top = ((startMin - dayStart) / 60) * SLOT_HEIGHT;
  const height = Math.max(((endMin - startMin) / 60) * SLOT_HEIGHT - 2, 24);

  const isCompleted = lesson.status === "completed";
  const card = document.createElement("div");
  card.className = `lesson-card ${isCompleted ? "completed" : "scheduled"}`;
  card.style.top = `${Math.max(0, top)}px`;
  card.style.height = `${height}px`;

  if (!isCompleted) card.dataset.attendLesson = lesson.id;

  card.innerHTML = `
    <strong>${escapeHtml(lesson.title)}</strong>
    <small>${escapeHtml(displayName)} | ${lesson.startTime}-${lesson.endTime}</small>
    <small>${isCompleted ? "已完成" : "点击签到"} · ${round1(lesson.hours)} 课时</small>
  `;

  return card;
}

function renderStudentDetail() {
  if (!state.selectedStudentId) {
    el.studentDetail.className = "detail-empty";
    el.studentDetail.textContent = "点击学生列表中的"查看"";
    return;
  }

  const student = getStudentById(state.selectedStudentId);
  if (!student) {
    state.selectedStudentId = null;
    el.studentDetail.className = "detail-empty";
    el.studentDetail.textContent = "学生不存在";
    return;
  }

  const lessons = state.data.lessons
    .filter((l) => l.studentId === student.id || isStudentInLesson(student.id, l))
    .sort((a, b) => compareLessonDateTime(b, a));
  const recent = getRecentCompletedLesson(student.id);
  const transactions = state.data.transactions
    .filter((t) => t.studentId === student.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  el.studentDetail.className = "";
  el.studentDetail.innerHTML = `
    <div>
      <strong>${escapeHtml(student.name)}</strong>
      <span style="margin-left:8px;color:var(--muted)">${escapeHtml(student.contact || "无联系方式")}</span>
    </div>
    <div style="margin-top:6px;">
      剩余课时：<b class="${student.remainingHours <= LOW_HOURS_THRESHOLD ? "low" : ""}">${round1(student.remainingHours)}</b>
      | 初始课时：${round1(student.totalHours)}
      | 最近上课：${recent ? `${recent.date} ${recent.startTime}-${recent.endTime}` : "暂无"}
    </div>
    <h3 style="margin-top:12px;">课时流水</h3>
    <table class="transaction-table">
      <thead>
        <tr><th>时间</th><th>类型</th><th>课时</th><th>结余</th><th>备注</th></tr>
      </thead>
      <tbody>
        ${transactions.length ? transactions.map((t) => `
          <tr>
            <td>${fmtDateTime(t.createdAt)}</td>
            <td>${txnTypeLabel(t.type)}</td>
            <td>${t.hours > 0 ? `-${round1(t.hours)}` : "—"}</td>
            <td class="${t.balanceAfter <= LOW_HOURS_THRESHOLD ? "low" : ""}">${round1(t.balanceAfter)}</td>
            <td>${escapeHtml(t.note || "-")}</td>
          </tr>
        `).join("") : `<tr><td colspan="5">暂无流水</td></tr>`}
      </tbody>
    </table>
  `;
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function toggleLessonTypeFields() {
  const type = el.lessonTypeSelect.value;
  document.querySelectorAll(".single-only").forEach((node) => {
    node.classList.toggle("hidden", type !== "single");
    node.querySelector("input")?.toggleAttribute("required", type === "single");
  });
  document.querySelectorAll(".recurring-only").forEach((node) => {
    node.classList.toggle("hidden", type !== "recurring");
    const input = node.querySelector("input");
    if (input) input.toggleAttribute("required", type === "recurring");
  });
}

function toggleLessonScopeFields() {
  const scope = el.lessonScopeSelect.value;
  document.querySelectorAll(".individual-only").forEach((node) => {
    node.classList.toggle("hidden", scope !== "individual");
    const sel = node.querySelector("select");
    if (sel) sel.toggleAttribute("required", scope === "individual");
  });
  document.querySelectorAll(".group-only").forEach((node) => {
    node.classList.toggle("hidden", scope !== "group");
    const sel = node.querySelector("select");
    if (sel) sel.toggleAttribute("required", scope === "group");
  });
}

function presetLessonFormDate() {
  const dateInput = el.lessonForm.querySelector("input[name='date']");
  const startDateInput = el.lessonForm.querySelector("input[name='startDate']");
  const endDateInput = el.lessonForm.querySelector("input[name='endDate']");
  const today = toDateInputValue(new Date());
  if (dateInput && !dateInput.value) dateInput.value = today;
  if (startDateInput && !startDateInput.value) startDateInput.value = today;
  if (endDateInput && !endDateInput.value) endDateInput.value = toDateInputValue(addDays(new Date(), 28));
}

// ─── Data helpers ─────────────────────────────────────────────────────────────

function getLessonDisplayName(lesson) {
  if (lesson.lessonType === "group" && lesson.classId) {
    const cls = getClassById(lesson.classId);
    return cls ? `[班课] ${cls.name}` : "[已删除班级]";
  }
  return getStudentById(lesson.studentId)?.name || "未知学生";
}

function txnTypeLabel(type) {
  if (type === "deduct") return "上课";
  if (type === "absent") return "请假";
  if (type === "other") return "其他";
  return escapeHtml(type);
}

function isStudentInLesson(studentId, lesson) {
  if (lesson.lessonType === "group" && lesson.classId) {
    const cls = getClassById(lesson.classId);
    return cls?.studentIds.includes(studentId) ?? false;
  }
  return lesson.studentId === studentId;
}

function generateRecurringDates(startDate, endDate, weekday) {
  const dates = [];
  let cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return dates;
  while (cursor <= end) {
    if (cursor.getDay() === weekday) dates.push(toDateInputValue(cursor));
    cursor = addDays(cursor, 1);
  }
  return dates;
}

function getRecentCompletedLesson(studentId) {
  const attendedLessonIds = new Set(
    state.data.attendance
      .filter((a) => a.studentId === studentId && a.status === "attended")
      .map((a) => a.lessonId)
  );
  return state.data.lessons
    .filter((l) => {
      if (l.status !== "completed") return false;
      // new lessons: check attendance record; legacy lessons (no attendance record): fall back to studentId match
      if (attendedLessonIds.size > 0 || state.data.attendance.some((a) => a.lessonId === l.id)) {
        return attendedLessonIds.has(l.id);
      }
      return l.studentId === studentId;
    })
    .sort((a, b) => compareLessonDateTime(b, a))[0];
}

function getStudentById(id) { return state.data.students.find((s) => s.id === id); }

function isDateInWeek(dateStr, weekStart) {
  const current = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(current.getTime())) return false;
  return current >= weekStart && current <= addDays(weekStart, 6);
}

function getWeekDates(weekStart) {
  const dates = [];
  for (let i = 0; i < 7; i += 1) dates.push(toDateInputValue(addDays(weekStart, i)));
  return dates;
}

function compareLessonDateTime(a, b) {
  return `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`, "zh-CN");
}

function timeToMinutes(time) {
  const [h, m] = String(time).split(":").map(Number);
  return h * 60 + m;
}

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return d;
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function toDateInputValue(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function fmtDate(date) { return toDateInputValue(date); }

function fmtDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return `${toDateInputValue(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function nowIso() { return new Date().toISOString(); }

function round1(num) { return Math.round((Number(num) + Number.EPSILON) * 10) / 10; }

function pad2(num) { return String(num).padStart(2, "0"); }

function uid(prefix) { return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`; }

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { students: [], lessons: [], transactions: [], classes: [], attendance: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      students: Array.isArray(parsed.students) ? parsed.students : [],
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
      classes: Array.isArray(parsed.classes) ? parsed.classes : [],
      attendance: Array.isArray(parsed.attendance) ? parsed.attendance : []
    };
  } catch {
    return { students: [], lessons: [], transactions: [], classes: [], attendance: [] };
  }
}

function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data)); }

function loadTemplates() {
  const raw = localStorage.getItem(TEMPLATE_KEY);
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function saveTemplates() { localStorage.setItem(TEMPLATE_KEY, JSON.stringify(state.templates)); }
