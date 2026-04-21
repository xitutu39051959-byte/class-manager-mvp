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
  currentWeekStart: startOfWeek(new Date()),
  selectedStudentId: null
};

const el = {
  studentForm: document.getElementById("studentForm"),
  lessonForm: document.getElementById("lessonForm"),
  lessonTypeSelect: document.getElementById("lessonTypeSelect"),
  lessonStudentSelect: document.getElementById("lessonStudentSelect"),
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
  el.lessonForm.addEventListener("submit", handleCreateLesson);
  el.lessonTypeSelect.addEventListener("change", toggleLessonTypeFields);

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
    if (e.target.files[0]) {
      importJson(e.target.files[0]);
      e.target.value = "";
    }
  });
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);

  // Templates
  document.getElementById("templateBtn").addEventListener("click", openTemplateModal);
  document.getElementById("closeTemplateModal").addEventListener("click", closeTemplateModal);
  document.getElementById("saveAsTemplateBtn").addEventListener("click", saveAsTemplate);
  document.getElementById("templateModal").addEventListener("click", (e) => {
    if (e.target.id === "templateModal" || e.target.closest("#closeTemplateModal")) { closeTemplateModal(); return; }
    const applyBtn = e.target.closest("[data-apply-tpl]");
    if (applyBtn) { applyTemplate(applyBtn.dataset.applyTpl); return; }
    const deleteBtn = e.target.closest("[data-delete-tpl]");
    if (deleteBtn) { deleteTemplate(deleteBtn.dataset.deleteTpl); }
  });

  // Global delegation for complete / view buttons
  document.body.addEventListener("click", (event) => {
    const completeBtn = event.target.closest("[data-complete-id]");
    if (completeBtn) {
      markLessonCompleted(completeBtn.dataset.completeId);
      return;
    }
    const viewBtn = event.target.closest("[data-view-student]");
    if (viewBtn) {
      state.selectedStudentId = viewBtn.dataset.viewStudent;
      renderStudentDetail();
    }
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
        transactions: parsed.transactions
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
  if (!state.data.transactions.length) {
    alert("暂无流水数据可导出");
    return;
  }
  const headers = ["时间", "学生", "类型", "课时", "结余", "备注"];
  const rows = [...state.data.transactions]
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((t) => {
      const student = getStudentById(t.studentId);
      return [
        fmtDateTime(t.createdAt),
        student?.name || "",
        t.type === "deduct" ? "扣减" : t.type,
        t.hours,
        t.balanceAfter,
        t.note || ""
      ].map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",");
    });
  const csv = "﻿" + [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, `oneclass-流水-${toDateInputValue(new Date())}.csv`);
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
  if (!title) {
    alert("请先在排课表单中填写课程名称");
    return;
  }
  const hours = Number(fd.get("hours")) || 1;
  const startTime = String(fd.get("startTime") || "18:00");
  const endTime = String(fd.get("endTime") || "19:00");

  const name = prompt("模板名称（直接回车则使用课程名称）：", title);
  if (name === null) return;

  state.templates.push({
    id: uid("tpl"),
    name: name.trim() || title,
    title,
    hours,
    startTime,
    endTime
  });

  saveTemplates();
  renderTemplateModal();
}

function applyTemplate(id) {
  const tpl = state.templates.find((t) => t.id === id);
  if (!tpl) return;

  const set = (name, value) => {
    const input = el.lessonForm.querySelector(`[name="${name}"]`);
    if (input) input.value = value;
  };

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

// ─── Student / Lesson handlers ───────────────────────────────────────────────

function handleCreateStudent(event) {
  event.preventDefault();
  const fd = new FormData(el.studentForm);
  const name = String(fd.get("name") || "").trim();
  const contact = String(fd.get("contact") || "").trim();
  const totalHours = Number(fd.get("hours"));

  if (!name || Number.isNaN(totalHours) || totalHours < 0) {
    alert("请填写正确的学生信息");
    return;
  }

  state.data.students.push({
    id: uid("stu"),
    name,
    contact,
    totalHours,
    remainingHours: totalHours,
    createdAt: nowIso()
  });

  saveData();
  el.studentForm.reset();
  renderAll();
}

function handleCreateLesson(event) {
  event.preventDefault();
  const fd = new FormData(el.lessonForm);
  const studentId = String(fd.get("studentId") || "");
  const title = String(fd.get("title") || "").trim();
  const type = String(fd.get("type") || "single");
  const hours = Number(fd.get("hours"));
  const startTime = String(fd.get("startTime"));
  const endTime = String(fd.get("endTime"));

  if (!studentId || !title || !startTime || !endTime || Number.isNaN(hours) || hours <= 0) {
    alert("请完整填写课程信息");
    return;
  }

  if (timeToMinutes(endTime) <= timeToMinutes(startTime)) {
    alert("结束时间必须晚于开始时间");
    return;
  }

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
      id: uid("les"),
      studentId,
      title,
      date,
      startTime,
      endTime,
      hours,
      status: "scheduled",
      createdAt: nowIso(),
      completedAt: null
    });
  }

  saveData();
  el.lessonForm.reset();
  presetLessonFormDate();
  toggleLessonTypeFields();
  renderAll();
}

function markLessonCompleted(lessonId) {
  const lesson = state.data.lessons.find((it) => it.id === lessonId);
  if (!lesson || lesson.status === "completed") return;

  const student = state.data.students.find((it) => it.id === lesson.studentId);
  if (!student) return;

  const nextBalance = round1(student.remainingHours - Number(lesson.hours || 0));
  student.remainingHours = nextBalance;
  lesson.status = "completed";
  lesson.completedAt = nowIso();

  state.data.transactions.push({
    id: uid("txn"),
    studentId: student.id,
    lessonId: lesson.id,
    type: "deduct",
    hours: Number(lesson.hours || 0),
    balanceAfter: nextBalance,
    createdAt: nowIso(),
    note: `${lesson.title} ${lesson.date} ${lesson.startTime}-${lesson.endTime}`
  });

  saveData();
  renderAll();
}

// ─── Render ──────────────────────────────────────────────────────────────────

function renderAll() {
  renderStudentOptions();
  renderStudents();
  renderDashboard();
  renderSchedule();
  renderStudentDetail();
  presetLessonFormDate();
}

function renderStudentOptions() {
  el.lessonStudentSelect.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "请选择学生";
  el.lessonStudentSelect.appendChild(defaultOption);

  state.data.students.forEach((student) => {
    const option = document.createElement("option");
    option.value = student.id;
    option.textContent = `${student.name}（余 ${round1(student.remainingHours)}）`;
    el.lessonStudentSelect.appendChild(option);
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
    <div class="stat-card"><span>待上课</span><b>${scheduledCount}</b></div>
    <div class="stat-card"><span>已完成</span><b>${completedCount}</b></div>
  `;

  el.lowHoursList.innerHTML = "";
  if (!lowStudents.length) {
    el.lowHoursList.innerHTML = "<li>当前没有低课时学生</li>";
  } else {
    lowStudents
      .sort((a, b) => a.remainingHours - b.remainingHours)
      .forEach((student) => {
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
    el.pendingLessonList.innerHTML = "<li>暂无待完成课程</li>";
  } else {
    pending.forEach((lesson) => {
      const student = getStudentById(lesson.studentId);
      const li = document.createElement("li");
      li.innerHTML = `
        ${lesson.date} ${lesson.startTime}-${lesson.endTime} | ${escapeHtml(lesson.title)} | ${escapeHtml(student?.name || "未知学生")}
        <div class="card-actions">
          <button type="button" data-complete-id="${lesson.id}">标记已完成</button>
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

    dayLessons.forEach((lesson) => {
      dayBody.appendChild(buildLessonCard(lesson));
    });

    dayCol.appendChild(dayBody);
    el.scheduleGrid.appendChild(dayCol);
  });
}

function buildLessonCard(lesson) {
  const student = getStudentById(lesson.studentId);
  const startMin = timeToMinutes(lesson.startTime);
  const endMin = timeToMinutes(lesson.endTime);
  const dayStart = SLOT_START_HOUR * 60;
  const top = ((startMin - dayStart) / 60) * SLOT_HEIGHT;
  const height = Math.max(((endMin - startMin) / 60) * SLOT_HEIGHT - 2, 24);

  const card = document.createElement("div");
  card.className = `lesson-card ${lesson.status === "completed" ? "completed" : ""}`;
  card.style.top = `${Math.max(0, top)}px`;
  card.style.height = `${height}px`;

  card.innerHTML = `
    <strong>${escapeHtml(lesson.title)}</strong>
    <small>${escapeHtml(student?.name || "未知学生")} | ${lesson.startTime}-${lesson.endTime}</small>
    <small>${lesson.status === "completed" ? "已完成" : "待上课"} | 扣减 ${round1(lesson.hours)} 课时</small>
    ${lesson.status === "completed" ? "" : `<div class="card-actions"><button type="button" data-complete-id="${lesson.id}">完成</button></div>`}
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
    .filter((l) => l.studentId === student.id)
    .sort((a, b) => compareLessonDateTime(b, a));
  const recent = lessons.find((l) => l.status === "completed");
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
            <td>${t.type === "deduct" ? "扣减" : escapeHtml(t.type)}</td>
            <td>${round1(t.hours)}</td>
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
  return state.data.lessons
    .filter((l) => l.studentId === studentId && l.status === "completed")
    .sort((a, b) => compareLessonDateTime(b, a))[0];
}

function getStudentById(id) {
  return state.data.students.find((s) => s.id === id);
}

function isDateInWeek(dateStr, weekStart) {
  const current = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(current.getTime())) return false;
  const end = addDays(weekStart, 6);
  return current >= weekStart && current <= end;
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

function round1(num) {
  return Math.round((Number(num) + Number.EPSILON) * 10) / 10;
}

function pad2(num) { return String(num).padStart(2, "0"); }

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// ─── Persistence ──────────────────────────────────────────────────────────────

function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { students: [], lessons: [], transactions: [] };
  try {
    const parsed = JSON.parse(raw);
    return {
      students: Array.isArray(parsed.students) ? parsed.students : [],
      lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [],
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : []
    };
  } catch {
    return { students: [], lessons: [], transactions: [] };
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

function loadTemplates() {
  const raw = localStorage.getItem(TEMPLATE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTemplates() {
  localStorage.setItem(TEMPLATE_KEY, JSON.stringify(state.templates));
}
