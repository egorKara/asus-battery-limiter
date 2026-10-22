"use strict";
const CATALOG_URL = "./data/catalog.json";
const ISSUES_URL = "https://github.com/egorKara/asus-battery-limiter/issues/new";
let catalog = null;
const byId = (id) => document.getElementById(id);

function el(name, className, value) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (value !== undefined && value !== null) node.textContent = String(value);
  return node;
}
function dateRu(raw) {
  const date = new Date(String(raw) + "T12:00:00Z");
  return Number.isNaN(date.getTime()) ? "дата неизвестна" :
    new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}
function safeUrl(raw) {
  try {
    const url = new URL(raw);
    return (url.protocol === "https:" || url.protocol === "http:") ? url.href : null;
  } catch {
    return null;
  }
}
function sourceLink(url, label) {
  const valid = safeUrl(url);
  if (!valid) return el("span", "", "Источник не указан");
  const link = el("a", "", label);
  link.href = valid;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}
function profileReady(device) {
  const r = device.recommended_window;
  return r && r.scope === "exact_battery" &&
    Number.isInteger(r.min_percent) && Number.isInteger(r.max_percent) &&
    r.min_percent >= 0 && r.max_percent <= 100 && r.min_percent < r.max_percent &&
    device.evidence.kind === "verified" && device.capabilities.end_threshold === "yes" &&
    !!device.battery_model;
}
function capabilityText(value) {
  return ({ yes: "Да", no: "Нет", reported: "По проекту", unknown: "Неизвестно" })[value] || "Неизвестно";
}
function buildDevice(device) {
  const ready = profileReady(device);
  const card = el("article", "device-card");
  const top = el("div", "device-top");
  top.append(el("span", "device-icon", "▤"), el("span", "device-status" + (ready ? " ready" : ""), ready ? "Готовый профиль" : "Требует уточнения"));
  card.append(top);
  card.append(el("h3", "device-title", device.manufacturer + " " + device.laptop_model));
  card.append(el("p", "device-subtitle", "Батарея: " + (device.battery_model || "модель не установлена") + " · " + (device.operating_system || "ОС не указана")));
  const stats = el("div", "device-stats");
  [["Максимум", "end_threshold"], ["Минимум", "start_threshold"], ["Остановка", "pause_charging"]].forEach(([label, key]) => {
    const block = el("div", "device-stat");
    block.append(el("small", "", label), el("strong", "", capabilityText(device.capabilities[key])));
    stats.append(block);
  });
  card.append(stats);
  const range = device.recommended_window;
  const details = ready ? "Подтверждённый диапазон: " + range.min_percent + "–" + range.max_percent + "%." :
    "Индивидуальные MIN / MAX не установлены. Без доказательств рекомендации не применяются.";
  const note = el("p", "device-unknown");
  note.append(el("strong", "", ready ? "Режим 02. " : "Нужны данные. "), document.createTextNode(details));
  card.append(note);
  const footer = el("div", "device-footer");
  footer.append(el("span", "", "Источник просмотрен: " + dateRu(device.evidence.checked_at)),
    sourceLink(device.evidence.source_url, "Первичный источник ↗"));
  card.append(footer);
  return card;
}
function drawDevices() {
  if (!catalog) return;
  const query = byId("search").value.trim().toLocaleLowerCase("ru");
  const filter = byId("filter").value;
  const list = byId("catalog-list");
  list.replaceChildren();
  const matching = catalog.devices.filter((d) => {
    const searchable = [d.manufacturer, d.laptop_model, d.battery_model, d.battery_manufacturer].filter(Boolean).join(" ").toLocaleLowerCase("ru");
    const ready = profileReady(d);
    return searchable.includes(query) && (filter === "all" || (filter === "ready" ? ready : !ready));
  });
  matching.forEach((d) => list.append(buildDevice(d)));
  byId("results-summary").textContent = "Найдено записей: " + matching.length + " из " + catalog.devices.length;
  byId("catalog-empty").hidden = matching.length !== 0;
}
function drawGuidance() {
  const target = byId("guidance-list");
  target.replaceChildren();
  catalog.manufacturer_guidance.forEach((group) => {
    group.modes.forEach((mode) => {
      const card = el("article", "guidance-card");
      card.append(el("span", "overline", group.manufacturer + " · РЕЖИМ ПРОИЗВОДИТЕЛЯ"));
      card.append(el("h3", "", mode.label));
      const cap = el("div", "guidance-cap", String(mode.max_percent) + "%");
      card.append(cap);
      card.append(el("p", "", mode.description));
      card.append(sourceLink(group.source_url, "Документация производителя ↗"));
      target.append(card);
    });
  });
}
function drawCatalog(data) {
  if (!data || data.schema_version !== 1 || !Array.isArray(data.devices) || !Array.isArray(data.manufacturer_guidance) || !Array.isArray(data.references)) {
    throw new Error("Неподдерживаемый формат каталога");
  }
  catalog = data;
  byId("count-devices").textContent = data.devices.length;
  byId("count-ready").textContent = data.devices.filter(profileReady).length;
  byId("count-sources").textContent = new Set([
    ...data.devices.map((d) => d.evidence.source_url),
    ...data.manufacturer_guidance.map((g) => g.source_url),
    ...data.references.map((r) => r.url)
  ].filter(Boolean)).size;
  byId("catalog-updated").textContent = dateRu(data.updated_at);
  byId("catalog-status").textContent = "Данные из каталога проекта";
  drawDevices();
  drawGuidance();
}
async function loadCatalog() {
  try {
    const response = await fetch(CATALOG_URL, { cache: "no-cache" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    drawCatalog(await response.json());
  } catch (error) {
    byId("catalog-status").textContent = "Ошибка загрузки";
    byId("catalog-updated").textContent = "Недоступно";
    byId("count-devices").textContent = "—";
    byId("count-ready").textContent = "—";
    byId("count-sources").textContent = "—";
    byId("results-summary").textContent = "Не удалось загрузить каталог: " + error.message + ". Откройте сайт через HTTP(S), а не file://.";
    byId("catalog-empty").hidden = false;
  }
}
function optionalNumber(form, field) {
  const raw = form.elements.namedItem(field).value;
  return raw === "" ? null : Number(raw);
}
function optionalText(form, field) {
  return form.elements.namedItem(field).value.trim() || null;
}
function makeReport(form) {
  return {
    schema_version: 1,
    kind: "battery_report",
    reported_on: new Date().toISOString().slice(0, 10),
    laptop: {
      manufacturer: optionalText(form, "manufacturer"),
      model: optionalText(form, "laptop_model")
    },
    battery: {
      manufacturer: optionalText(form, "battery_manufacturer"),
      model: optionalText(form, "battery_model")
    },
    system: {
      kernel: optionalText(form, "kernel"),
      battery_device: optionalText(form, "battery_device")
    },
    capabilities: {
      end_threshold: form.elements.namedItem("end_threshold").value,
      start_threshold: form.elements.namedItem("start_threshold").value,
      pause_charging: form.elements.namedItem("pause_charging").value
    },
    recommendation: {
      min_percent: optionalNumber(form, "recommended_min"),
      max_percent: optionalNumber(form, "recommended_max"),
      status: "unverified_suggestion"
    },
    observation: {
      cycle_count: optionalNumber(form, "cycle_count"),
      energy_full_uwh: optionalNumber(form, "energy_full"),
      energy_full_design_uwh: optionalNumber(form, "energy_full_design"),
      source_url: optionalText(form, "source_url"),
      note: optionalText(form, "note")
    }
  };
}
function submitReport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = byId("form-feedback");
  feedback.textContent = "";
  if (!form.reportValidity()) return;
  const report = makeReport(form);
  const source = report.observation.source_url;
  if (source && !safeUrl(source)) {
    feedback.textContent = "Ссылка должна начинаться с http:// или https://.";
    return;
  }
  const low = report.recommendation.min_percent;
  const high = report.recommendation.max_percent;
  if ((low === null) !== (high === null)) {
    feedback.textContent = "Для диапазона заполните оба значения MIN и MAX или оставьте оба пустыми.";
    return;
  }
  if (low !== null && (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high > 100 || low >= high)) {
    feedback.textContent = "Диапазон должен быть целым: 0 ≤ MIN < MAX ≤ 100.";
    return;
  }
  if (low !== null && !source) {
    feedback.textContent = "Для предложенного диапазона MIN–MAX укажите ссылку на первоисточник.";
    return;
  }
  const full = report.observation.energy_full_uwh;
  const design = report.observation.energy_full_design_uwh;
  if ((full === null) !== (design === null)) {
    feedback.textContent = "Для сравнения ёмкости заполните оба поля или оставьте оба пустыми.";
    return;
  }
  const title = "[Батарея] " + report.laptop.manufacturer.slice(0, 60) + " " + report.laptop.model.slice(0, 90);
  const json = JSON.stringify(report, null, 2).split("\n").map((line) => "    " + line).join("\n");
  const body = "## Новые данные об аккумуляторе\n\nОтчёт пользователя, не проверен модератором. Не применять как рабочую настройку до независимой проверки.\n\n" +
    json + "\n\n### Проверка\n- [ ] Проверено название батареи и ревизия\n- [ ] Проверена работа заявленных функций на устройстве\n- [ ] Установлены первичные источники MIN / MAX, если заявлены\n- [ ] Исключены серийные номера и персональные сведения\n";
  const url = ISSUES_URL + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  if (url.length > 8000) {
    feedback.textContent = "Описание слишком длинное. Сократите примечание и ссылку.";
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
  feedback.textContent = "Заявка открыта в новой вкладке. Для публикации нажмите Submit new issue на GitHub.";
}
byId("search").addEventListener("input", drawDevices);
byId("filter").addEventListener("change", drawDevices);
byId("report-form").addEventListener("submit", submitReport);
loadCatalog();