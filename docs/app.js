"use strict";
const CATALOG_URL = "./data/catalog.json";
const ISSUES_URL = "https://github.com/egorKara/asus-battery-limiter/issues/new";
let catalog = null;
let lastDraftUrl = null;
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
  top.append(el("span", "device-icon", "BAT"), el("span", "device-status" + (ready ? " ready" : ""), ready ? "Готовый профиль" : "Требует уточнения"));
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
    sourceLink(device.evidence.source_url, "Источник записи ↗"));
  card.append(footer);
  return card;
}
function drawDevices() {
  if (!catalog) return;
  const query = byId("search").value.trim().toLocaleLowerCase("ru");
  const filter = byId("filter").value;
  const list = byId("catalog-list");
  list.replaceChildren();
  byId("clear-search").hidden = query.length === 0;
  const matching = catalog.devices.filter((d) => {
    const searchable = [d.manufacturer, d.laptop_model, d.battery_model, d.battery_manufacturer].filter(Boolean).join(" ").toLocaleLowerCase("ru");
    const ready = profileReady(d);
    return searchable.includes(query) && (filter === "all" || (filter === "ready" ? ready : !ready));
  });
  matching.forEach((d) => list.append(buildDevice(d)));
  byId("results-summary").textContent = "Найдено: " + matching.length + " · Всего: " + catalog.devices.length;
  byId("catalog-empty").hidden = matching.length !== 0;
  if (!matching.length) {
    byId("empty-title").textContent = catalog.devices.length ? "Совпадений нет" : "Каталог пока пуст";
    byId("empty-description").textContent = catalog.devices.length ? "Попробуйте другой запрос или сбросьте фильтры." : "Предложите первую проверяемую запись.";
    byId("reset-filters").hidden = !catalog.devices.length || (!query && filter === "all");
  }
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
      if (Number.isInteger(mode.resume_below_percent)) {
        card.append(el("p", "guidance-resume", "Возобновление ниже " + mode.resume_below_percent + "% · не персональный MIN"));
      }
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
  byId("catalog-status").textContent = "Схема данных v" + data.schema_version;
  byId("catalog-list").setAttribute("aria-busy", "false");
  byId("catalog-retry").hidden = true;
  drawDevices();
  drawGuidance();
}
async function loadCatalog() {
  byId("catalog-retry").hidden = true;
  byId("catalog-list").setAttribute("aria-busy", "true");
  byId("results-summary").textContent = "Загрузка записей…";
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
    catalog = null;
    byId("results-summary").textContent = "Не удалось загрузить каталог. Проверьте подключение или откройте сайт через HTTP(S).";
    byId("catalog-list").replaceChildren();
    byId("guidance-list").replaceChildren();
    byId("catalog-empty").hidden = true;
    byId("catalog-retry").hidden = false;
  } finally {
    byId("catalog-list").setAttribute("aria-busy", "false");
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
function invalidate(form, name, message) {
  byId("form-feedback").textContent = message;
  const field = form.elements.namedItem(name);
  if (field) {
    field.setAttribute("aria-invalid", "true");
    field.setAttribute("aria-describedby", "form-feedback");
    field.focus();
  }
}
function submitReport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = byId("form-feedback");
  feedback.textContent = "";
  form.querySelectorAll('[aria-invalid="true"]').forEach(field => {
    field.removeAttribute("aria-invalid");
    field.removeAttribute("aria-describedby");
  });
  for (const [name, message, max] of [
    ["manufacturer", "Укажите производителя ноутбука.", 60],
    ["laptop_model", "Укажите модель ноутбука.", 100]
  ]) {
    const value = form.elements.namedItem(name).value.trim();
    if (!value || value.length > max) {
      invalidate(form, name, value ? "Слишком длинное название (не больше " + max + " символов)." : message);
      return;
    }
  }
  if (!form.elements.namedItem("privacy").checked) {
    invalidate(form, "privacy", "Подтвердите, что можете опубликовать эти сведения.");
    return;
  }
  const report = makeReport(form);
  const source = report.observation.source_url;
  if (source && !safeUrl(source)) {
    invalidate(form, "source_url", "Адрес источника должен начинаться с https:// или http://.");
    return;
  }
  const batteryName = report.system.battery_device;
  if (batteryName && !/^[A-Za-z0-9_-]+$/.test(batteryName)) {
    invalidate(form, "battery_device", "Укажите только имя в sysfs, например BAT0, без полного пути.");
    return;
  }
  for (const [name, min, max] of [
    ["cycle_count", 0, 100000],
    ["recommended_min", 0, 99],
    ["recommended_max", 1, 100],
    ["energy_full", 1, 1000000000],
    ["energy_full_design", 1, 1000000000]
  ]) {
    const field = form.elements.namedItem(name);
    const raw = field.value;
    if (field.validity?.badInput || (raw !== "" && (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max))) {
      invalidate(form, name, "Здесь нужно целое число от " + min + " до " + max + ".");
      return;
    }
  }
  const low = report.recommendation.min_percent;
  const high = report.recommendation.max_percent;
  if ((low === null) !== (high === null)) {
    invalidate(form, low === null ? "recommended_min" : "recommended_max",
      "Введите оба порога MIN и MAX или оставьте оба пустыми.");
    return;
  }
  if (low !== null && low >= high) {
    invalidate(form, "recommended_max", "MAX должен быть больше MIN.");
    return;
  }
  if (low !== null && !source) {
    invalidate(form, "source_url", "Для предлагаемого MIN–MAX добавьте ссылку на первоисточник.");
    return;
  }
  const full = report.observation.energy_full_uwh;
  const design = report.observation.energy_full_design_uwh;
  if ((full === null) !== (design === null)) {
    invalidate(form, full === null ? "energy_full" : "energy_full_design",
      "Для сравнения ёмкости укажите оба значения или оставьте оба пустыми.");
    return;
  }
  const title = "[Батарея] " + report.laptop.manufacturer + " " + report.laptop.model;
  const json = JSON.stringify(report, null, 2).split("\n").map(line => "    " + line).join("\n");
  const body = "## Новые данные об аккумуляторе\n\nОтчёт пользователя, не проверен модератором. Не применять как рабочую настройку до независимой проверки.\n\n" +
    json + "\n\n### Проверка\n- [ ] Проверено название батареи и ревизия\n- [ ] Проверена работа заявленных функций на устройстве\n- [ ] Установлены первичные источники MIN / MAX, если заявлены\n- [ ] Исключены серийные номера и персональные сведения\n";
  const url = ISSUES_URL + "?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body);
  if (url.length > 8000) {
    invalidate(form, "note", "Заявка слишком длинная. Сократите примечание.");
    return;
  }
  const link = byId("issue-link");
  link.href = url;
  link.hidden = false;
  if (lastDraftUrl !== url) {
    lastDraftUrl = url;
    window.open(url, "_blank", "noopener,noreferrer");
  }
  feedback.textContent = "Заявка подготовлена. Если вкладка не открылась, используйте ссылку ниже. Для публикации подтвердите отправку на GitHub.";
}
function rememberFilters() {
  if (!window.location || !window.history) return;
  const url = new URL(window.location.href);
  const query = byId("search").value.trim();
  const filter = byId("filter").value;
  if (query) url.searchParams.set("q", query); else url.searchParams.delete("q");
  if (filter !== "all") url.searchParams.set("filter", filter); else url.searchParams.delete("filter");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
function restoreFilters() {
  if (!window.location) return;
  const params = new URLSearchParams(window.location.search);
  byId("search").value = (params.get("q") || "").slice(0, 120);
  const filter = params.get("filter");
  if (["all", "ready", "research"].includes(filter)) byId("filter").value = filter;
}
function resetFilters() {
  byId("search").value = "";
  byId("filter").value = "all";
  rememberFilters();
  drawDevices();
  byId("search").focus();
}
byId("search").addEventListener("input", () => {
  byId("clear-search").hidden = !byId("search").value.trim();
  rememberFilters();
  drawDevices();
});
byId("filter").addEventListener("change", () => { rememberFilters(); drawDevices(); });
byId("clear-search").addEventListener("click", () => {
  byId("search").value = "";
  rememberFilters();
  drawDevices();
  byId("search").focus();
});
byId("reset-filters").addEventListener("click", resetFilters);
byId("catalog-retry").addEventListener("click", loadCatalog);
byId("report-form").addEventListener("input", event => {
  event.target.removeAttribute("aria-invalid");
  byId("form-feedback").textContent = "";
  byId("issue-link").hidden = true;
  lastDraftUrl = null;
});
byId("report-form").addEventListener("submit", submitReport);
restoreFilters();
loadCatalog();