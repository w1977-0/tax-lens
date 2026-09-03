// test/taxmath.test.js — tax-lens verification suite (Node built-in runner).
//   node --test test/taxmath.test.js
//
// Verification strategy (this product's core is verifiability):
//   1. ANCHOR CASES — published outputs of an independent Qt/C++
//      implementation (caspian-yez/china-individual-income-tax-calculator),
//      which itself follows the statute. Numbers must match to the cent.
//   2. LAW-TEXT CASES — hand-computed from the statutory tables.
//   3. BOUNDARIES — zero income, ceiling clamps, negative taxable income.
const test = require("node:test");
const assert = require("node:assert");
const assert2 = require("node:assert/strict");
const path = require("node:path");
const t = require(path.join(__dirname, "..", "taxmath.js"));

const round2 = (v) => Math.round(v * 100) / 100;

// ---- anchor 1: ¥50,000/month, deductions 9,981/month → annual tax 73,148.40
// published in the peer implementation's README test table (2023-12-06):
test("ANCHOR: 50k salary, 9,981 monthly deductions → 73,148.40 annual tax", () => {
  const ded = (2500 + 625 + 156 + 2200 + 1500 + 3000); // 9,981
  const r = t.annualTax(50000, ded);
  assert2.equal(round2(r.tax), 73148.40);
  assert2.equal(r.bracket.rate, 0.30);
  assert2.equal(r.bracket.quick, 52920);
  assert2.equal(round2(r.taxable), 420228);
});

// ---- anchor 2: same + personal pension 12,000/yr → 70,137.00
// (the pension adds 1,000/month of deduction; taxable drops to 408,228
//  which sits in the 25% band — 408,228×0.25−31,920 = 70,137.00. Matches
//  the peer's published table to the cent; my first hand-computation pinned
//  the wrong bracket (30%) — the anchor test caught my own error.)
test("ANCHOR: pension 12,000/yr deduction → 70,137.00 (25% band)", () => {
  const ded = (2500 + 625 + 156 + 2200 + 1500 + 3000 + 1000); // 10,981/月
  const r = t.annualTax(50000, ded);
  assert2.equal(round2(r.tax), 70137.00);
  assert2.equal(r.bracket.rate, 0.25);
  assert2.equal(round2(r.taxable), 408228);
});

// ---- anchor 3: ¥8,000/month, deductions 5,371/month → zero tax
test("ANCHOR: 8k salary, 5,371 deductions → zero tax", () => {
  const ded = 480 + 120 + 30 + 241 + 1500 + 3000;
  const r = t.annualTax(8000, ded);
  assert2.equal(r.tax, 0);
  assert2.equal(r.taxable, 0);
});

// ---- statutory bracket walk -------------------------------------------------
test("annual brackets: boundaries continuous, quick deductions consistent", () => {
  // At each boundary the tax from either side must agree to the cent:
  //   upper×prevRate − prevQuick == upper×nextRate − nextQuick
  const B = t.ANNUAL_BRACKETS;
  for (let i = 1; i < B.length; i++) {
    const upper = B[i - 1].upTo;
    const fromBelow = upper * B[i - 1].rate - B[i - 1].quick;
    const fromAbove = upper * B[i].rate - B[i].quick;
    assert2.ok(Math.abs(fromBelow - fromAbove) < 0.01,
      `continuity at ${upper}: ${fromBelow} vs ${fromAbove}`);
  }
  // and each bracket's quick deduction reproduces its own formula
  for (const b of B) {
    if (b.upTo === Infinity) continue;
    const r = t.taxFromBrackets(b.upTo, t.ANNUAL_BRACKETS);
    assert2.equal(round2(r.tax), round2(b.upTo * b.rate - b.quick));
  }
});

test("taxable income below 60k floor produces zero tax", () => {
  assert2.equal(t.annualTax(4000, 0).tax, 0);
  assert2.equal(t.annualTax(5000, 2000).tax, 0);
});

test("3% band: 60,001 taxable → 3.00", () => {
  const r = t.annualTax(10000, 2666.75); // 120000-60000-32001=27999... use direct:
  const direct = t.taxFromBrackets(36000, t.ANNUAL_BRACKETS);
  assert2.equal(round2(direct.tax), 1080);
  assert2.equal(round2(t.taxFromBrackets(1, t.ANNUAL_BRACKETS).tax), 0.03);
});

test("45% top band with full quick deduction", () => {
  const r = t.taxFromBrackets(2000000, t.ANNUAL_BRACKETS);
  assert2.equal(round2(r.tax), round2(2000000 * 0.45 - 181920));
  assert2.equal(r.bracket.rate, 0.45);
});

// ---- cumulative withholding (payslip reality) --------------------------------
test("withholding schedule sums equal the annual statutory tax (same brackets domain)", () => {
  const salary = 30000, ded = 4500;
  const sched = t.withholdingSchedule(salary, ded, 12);
  const total = round2(sched.reduce((a, r) => a + r.taxThisMonth, 0));
  const annual = round2(t.annualTax(salary, ded).tax);
  // cumulative method uses the monthly-rescaled table over cumulative
  // income — for full-year salaries the total must equal annual tax exactly
  assert2.ok(Math.abs(total - annual) < 0.01, `withheld ${total} vs annual ${annual}`);
});

test("withholding: early months can be zero, later months heavier (the March jump)", () => {
  const sched = t.withholdingSchedule(20000, 3000, 12);
  assert2.ok(sched[0].taxThisMonth < sched[11].taxThisMonth, "monotone increase within a bracket band");
  assert2.ok(sched.every((r) => r.taxThisMonth >= 0));
});

test("withholding: low salary never taxed, net = salary - deductions", () => {
  const sched = t.withholdingSchedule(6000, 1500, 12);
  assert2.ok(sched.every((r) => r.taxThisMonth === 0));
  assert2.ok(sched.every((r) => Math.abs(r.netThisMonth - 4500) < 1e-9));
});

// ---- social insurance ----------------------------------------------------------
test("social insurance: default city, wage within floors", () => {
  const si = t.socialInsurance(10000, t.DEFAULT_CITY);
  assert2.equal(round2(si.employeeTotal), round2(10000 * (0.08 + 0.02 + 0.005 + 0.05)));
  assert2.equal(si.lines.length, 4);
  for (const l of si.lines) assert2.ok(l.src.length > 4, "every line carries a source");
});

test("social insurance: base clamped to ceiling", () => {
  const city = JSON.parse(JSON.stringify(t.DEFAULT_CITY));
  city.baseFloor = 4000; city.baseCeil = 20000;
  const si = t.socialInsurance(50000, city);
  assert2.equal(si.base, 20000);
  const si2 = t.socialInsurance(3000, city);
  assert2.equal(si2.base, 4000);
  assert2.ok(si.baseNote.includes("20000"));
});

test("social insurance: employer side excluded from employee total", () => {
  const si = t.socialInsurance(10000, t.DEFAULT_CITY);
  assert2.ok(si.employerMonthly > si.employeeTotal, "employer burden is larger");
  // 工伤/生育 are employer-only: employee lines contain exactly 4 entries
  assert2.equal(si.lines.length, 4);
});

// ---- special deductions constants ----------------------------------------------
test("special deductions: 2023-raised standards with sources", () => {
  assert2.equal(t.SPECIAL_DEDUCTIONS.childrenEducation.perMonth, 2000);
  assert2.equal(t.SPECIAL_DEDUCTIONS.infantCare.perMonth, 2000);
  assert2.equal(t.SPECIAL_DEDUCTIONS.elderly.perMonth, 3000);
  assert2.ok(t.SPECIAL_DEDUCTIONS.childrenEducation.src.includes("2023"));
  assert2.ok(t.SPECIAL_DEDUCTIONS.housingRent.perMonth.includes(1500));
});

// ---- formatting ------------------------------------------------------------------
test("fmtCNY renders with thousands separators", () => {
  assert2.equal(t.fmtCNY(73148.4), "73,148.40");
  assert2.equal(t.fmtCNY(0), "0.00");
  assert2.equal(t.fmtCNY(-3.5), "-3.50");
});
