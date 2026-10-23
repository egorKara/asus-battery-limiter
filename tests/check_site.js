#!/usr/bin/env node
"use strict";
// No browser or npm packages needed: emulate only DOM primitives used by the site.
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "..");
const data = JSON.parse(fs.readFileSync(path.join(root, "docs/data/catalog.json"), "utf8"));
const code = fs.readFileSync(path.join(root, "docs/app.js"), "utf8");
class E {
  constructor() { this.children = []; this.value = ""; this.validity = {badInput:false}; this.hidden = false; this.textContent = ""; this.listeners = {}; }
  append(...xs) { this.children.push(...xs); }
  setAttribute(name,value) { this[name] = value; }
  removeAttribute(name) { delete this[name]; }
  focus() { this.focused = true; }
  replaceChildren(...xs) { this.children = xs; }
  addEventListener(name,callback) { this.listeners[name] = callback; }
  dispatch(name,event) { this.listeners[name]?.(event); }
  reportValidity() { return true; }
}
const names = ["search","filter","report-form","catalog-list","catalog-empty","results-summary","count-devices",
  "count-ready","count-sources","catalog-updated","catalog-status","guidance-list","form-feedback",
  "catalog-retry","clear-search","empty-title","empty-description","reset-filters","issue-link"];
const nodes = Object.fromEntries(names.map(n => [n, new E()]));
nodes.filter.value = "all";
const document = {
  getElementById(id) { return nodes[id]; },
  createElement() { return new E(); },
  createTextNode(value) { const n = new E(); n.textContent = value; return n; }
};
const opened = [];
const context = {document, URL, URLSearchParams, window: {open: url => opened.push(url)},
  fetch: async () => ({ok: true, json: async () => data})};
vm.runInNewContext(code + "\nglobalThis.appTest = {drawCatalog,profileReady,submitReport,makeReport,safeUrl};",context);
const a = context.appTest;
a.drawCatalog(data);
assert.equal(nodes["catalog-list"].children.length,1);
assert.equal(nodes["guidance-list"].children.length,3);
assert.equal(data.manufacturer_guidance[0].modes[1].resume_below_percent,78);
assert.equal(data.manufacturer_guidance[0].modes[2].resume_below_percent,58);
assert.equal(nodes["count-ready"].textContent,0);
nodes.search.value = "not here";
a.drawCatalog(data);
assert.equal(nodes["catalog-list"].children.length,0);
assert.equal(nodes["catalog-empty"].hidden,false);
assert.equal(a.safeUrl("javascript:alert(1)"),null);
const device = JSON.parse(JSON.stringify(data.devices[0]));
device.battery_model = "TEST";
device.evidence.kind = "verified";
device.capabilities.end_threshold = "yes";
device.recommended_window = {scope:"exact_battery",min_percent:40,max_percent:80};
assert.equal(a.profileReady(device),true);
delete device.battery_model;
assert.equal(a.profileReady(device),false);
const inputs = {
  manufacturer:"ASUS",laptop_model:"UX310U",battery_manufacturer:"",battery_model:"",
  kernel:"",battery_device:"BAT0",end_threshold:"unknown",start_threshold:"unknown",
  pause_charging:"unknown",cycle_count:"",recommended_min:"",recommended_max:"",
  energy_full:"",energy_full_design:"",source_url:"",note:""
};
const form = new E();
const fields = Object.fromEntries(Object.keys(inputs).map(name => [name, new E()]));
fields.privacy = new E(); fields.privacy.checked = true;
form.elements = {namedItem: name => { const field = fields[name]; field.value = inputs[name]; return field; }};
form.querySelectorAll = () => Object.values(fields).filter(field => field["aria-invalid"] === "true");
const submit = () => a.submitReport({preventDefault(){},currentTarget:form});
submit();
assert.equal(opened.length,1);
assert.equal(nodes["issue-link"].hidden,false);
submit();
assert.equal(opened.length,1,"Repeated submit must not open duplicate tabs");
nodes["report-form"].dispatch("input",{target:fields.recommended_min});
assert.equal(nodes["issue-link"].hidden,true,"Editing hides stale draft link");
assert(new URL(opened[0]).searchParams.get("body").includes('"status": "unverified_suggestion"'));
inputs.recommended_min = "40";
submit();
assert.equal(opened.length,1,"No submission when MAX is missing");
assert.equal(fields.recommended_max["aria-invalid"],"true");
inputs.recommended_max = "80";
submit();
assert.equal(opened.length,1,"No submission without source for window");
inputs.source_url = "https://www.asus.com/support/";
submit();
assert.equal(opened.length,2,"Valid window proposed");
inputs.recommended_min = "90";
submit();
assert.equal(opened.length,2,"No reversed range");
assert.equal(fields.recommended_max["aria-invalid"],"true");
inputs.recommended_min = "40";
submit();
assert.match(nodes["form-feedback"].textContent, /Заявка подготовлена/, "Corrected MIN/MAX should pass validation");
assert.equal(fields.recommended_max["aria-invalid"],undefined,"Correcting MIN clears stale MAX error");
assert.equal(fields.recommended_max["aria-describedby"],undefined,"Correcting MIN clears stale MAX feedback association");
inputs.energy_full = "50000";
submit();
assert.equal(opened.length,2,"No submission on incomplete health measurement");
inputs.energy_full_design = "51000";
inputs.cycle_count = "2.5";
submit();
assert.equal(opened.length,2,"Non-integer cycle rejected");
inputs.cycle_count = "2";
submit();
assert.equal(opened.length,3,"Valid observation opens a draft");
inputs.cycle_count = "";
fields.cycle_count.validity = {badInput:true};
submit();
assert.equal(opened.length,3,"Native badInput must not prepare a report with null");
assert.equal(fields.cycle_count["aria-invalid"],"true","Native badInput marks the field invalid");
fields.cycle_count.validity.badInput = false;
inputs.cycle_count = "2";
fields.privacy.checked = false;
submit();
assert.equal(opened.length,3,"No submission without publication consent");
assert.equal(fields.privacy["aria-invalid"],"true");
console.log("PASS: catalog rendering, URL, form validation, safety and GitHub draft");

test("Correcting the other MIN/MAX field clears stale accessibility state", () => {
  fields.privacy.checked = true;
  inputs.recommended_min = "90";
  inputs.recommended_max = "80";
  submit();
  assert.equal(fields.recommended_max["aria-invalid"],"true");
  const before = opened.length;
  inputs.recommended_min = "40";
  nodes["report-form"].dispatch("input",{target:fields.recommended_min});
  submit();
  assert.equal(opened.length,before + 1,"Corrected range opens a draft");
  assert.equal(nodes["issue-link"].hidden,false);
  assert.equal(fields.recommended_max["aria-invalid"],undefined,"MAX is valid after correcting MIN");
  for (const field of Object.values(fields)) {
    assert.equal(field["aria-invalid"],undefined,"Successful validation clears all previous errors");
    assert.equal(field["aria-describedby"],undefined,"Successful validation clears all obsolete feedback links");
  }
});

test("Native badInput is rejected for every optional numeric field", () => {
  fields.privacy.checked = true;
  for (const name of ["cycle_count","recommended_min","recommended_max","energy_full","energy_full_design"]) {
    for (const numeric of ["cycle_count","recommended_min","recommended_max","energy_full","energy_full_design"]) inputs[numeric] = "";
    const field = fields[name];
    field.validity.badInput = true;
    nodes["report-form"].dispatch("input",{target:field});
    const before = opened.length;
    field.focused = false;
    submit();
    assert.equal(opened.length,before,"Invalid native input must not open a draft: " + name);
    assert.equal(nodes["issue-link"].hidden,true);
    assert.equal(field["aria-invalid"],"true");
    assert.equal(field["aria-describedby"],"form-feedback");
    assert.equal(field.focused,true);
    assert.match(nodes["form-feedback"].textContent,/целое число/);
    field.validity.badInput = false;
    nodes["report-form"].dispatch("input",{target:field});
    assert.equal(field["aria-invalid"],undefined,"Editing clears invalid state: " + name);
    assert.equal(field["aria-describedby"],undefined,"Editing clears stale feedback link: " + name);
    submit();
    assert.equal(opened.length,before + 1,"Genuinely empty optional fields remain allowed");
    assert.equal(field["aria-invalid"],undefined);
    assert(new URL(opened.at(-1)).searchParams.get("body").includes('"cycle_count": null'));
  }
});
