// taxmath.js — tax-lens core math. Zero dependencies, browser + Node.
//
// VERIFIABILITY IS THE PRODUCT. Every constant below carries its legal
// source in `src`; the UI renders these next to each number, and the test
// suite pins third-party-published anchor cases (an independent Qt/C++
// implementation's published outputs) so drift is caught.
//
// Core law: Individual Income Tax Law of the PRC (2018 amendment, in force
// since 2019-01-01) + its Implementing Regulations (State Council Decree
// No. 707) + STA Announcement 2018 No. 61 (cumulative withholding method).

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.taxmath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- annual tax table: 7 brackets, IIT Law Art. 3 (tax rate table I) ----
  // (upperBound exclusive of next bracket; quickDeduction derived per bracket)
  var ANNUAL_BRACKETS = [
    { upTo: 36000,     rate: 0.03, quick: 0,     src: "个人所得税法(2018修正)·税率表一" },
    { upTo: 144000,    rate: 0.10, quick: 2520,  src: "同上·第2级" },
    { upTo: 300000,    rate: 0.20, quick: 16920, src: "同上·第3级" },
    { upTo: 420000,    rate: 0.25, quick: 31920, src: "同上·第4级" },
    { upTo: 660000,    rate: 0.30, quick: 52920, src: "同上·第5级" },
    { upTo: 960000,    rate: 0.35, quick: 85920, src: "同上·第6级" },
    { upTo: Infinity,  rate: 0.45, quick: 181920, src: "同上·第7级" }
  ];

  // monthly table used by the cumulative withholding method (STA 2018-61)
  var WITHHOLDING_BRACKETS = [
    { upTo: 3000,    rate: 0.03, quick: 0,    src: "税务总局公告2018年第61号·预扣率表一" },
    { upTo: 12000,   rate: 0.10, quick: 210,  src: "同上·第2级" },
    { upTo: 25000,   rate: 0.20, quick: 1410, src: "同上·第3级" },
    { upTo: 35000,   rate: 0.25, quick: 2660, src: "同上·第4级" },
    { upTo: 55000,   rate: 0.30, quick: 4410, src: "同上·第5级" },
    { upTo: 80000,   rate: 0.35, quick: 7160, src: "同上·第6级" },
    { upTo: Infinity, rate: 0.45, quick: 15160, src: "同上·第7级" }
  ];

  var STANDARD_DEDUCTION_MONTHLY = 5000;   // IIT Law Art. 6: basic deduction
  var STANDARD_DEDUCTION_ANNUAL = 60000;
  var STANDARD_DEDUCTION_SRC = "个人所得税法第六条·基本减除费用 5000元/月(60000元/年)";

  // ---- special additional deductions (专项附加扣除) ----------------------
  // 国务院关于印发个人所得税专项附加扣除办法的通知(国发〔2018〕41号)
  // + 国务院关于提高三项专项附加扣除标准的通知(2023年8月31日):
  //   children education & infant care raised 1000→2000, elderly 2000→3000.
  var SPECIAL_DEDUCTIONS = {
    childrenEducation: { label: "子女教育", perMonth: 2000, src: "国发〔2018〕41号+2023提标通知·2000元/孩/月" },
    infantCare:        { label: "3岁以下婴幼儿照护", perMonth: 2000, src: "同上·2000元/孩/月" },
    continuingEd:      { label: "继续教育", perMonth: 400, src: "国发〔2018〕41号·400元/月(学历)或3600元/年(职业)" },
    housingLoan:       { label: "住房贷款利息", perMonth: 1000, src: "国发〔2018〕41号·1000元/月" },
    housingRent:       { label: "住房租金", perMonth: [1500, 1100, 800], src: "国发〔2018〕41号·1500/1100/800元/月(按城市规模)" },
    elderly:            { label: "赡养老人", perMonth: 3000, src: "2023提标通知·独生3000元/月,非独生分摊上限1500元/月" },
    seriousIllness:     { label: "大病医疗", perYear: 80000, src: "国发〔2018〕41号·年自付超1.5万部分限额8万/年" }
  };

  // ---- social insurance & housing fund (五险一金) ------------------------
  // Rates are statutorily national with local variation; the structure is
  // fixed by law, the numbers vary by city AND year. We ship a small,
  // explicitly-editable parameter set with sources, and let the user tweak.
  //
  // Legal anchors:
  //  养老: 国务院《降低社会保险费率综合方案》(国办发〔2019〕13号): 单位16%
  //  医疗/失业/工伤/生育: 各市规定
  //  公积金: 《住房公积金管理条例》: 5%-12% 双选
  var DEFAULT_CITY = {
    id: "custom",
    name: "自定义/按当地规定",
    note: "以下比例与基数上下限请按参保地当年官方公布调整",
    rates: {
      pensionEmployee:   { rate: 0.08,  src: "各地普遍执行·个人8%" },
      pensionEmployer:  { rate: 0.16,  src: "国办发〔2019〕13号·单位16%(各地曾有差异)" },
      medicalEmployee:   { rate: 0.02,  src: "各市规定·常见个人2%" },
      medicalEmployer:   { rate: 0.08,  src: "各市规定·常见单位8%-10%" },
      unemploymentEmployee: { rate: 0.005, src: "各市规定·常见个人0.5%" },
      unemploymentEmployer: { rate: 0.005, src: "各市规定·常见单位0.5%" },
      injuryEmployer:   { rate: 0.005, src: "各市规定·行业浮动0.2%-1.9%" },
      maternityEmployer:{ rate: 0.008, src: "各市规定(已并入医疗的按当地)" },
      housingFundEmployee:  { rate: 0.05, src: "《住房公积金管理条例》·5%-12%内单位选定" },
      housingFundEmployer:  { rate: 0.05, src: "同上·单位同比例" }
    },
    baseFloor: 0,      // set per city (usually = local minimum wage or 60% of avg wage)
    baseCeil: Infinity,// set per city (usually 300% of local avg wage)
    baseFloorSrc: "社保缴费基数下限·按参保地规定",
    baseCeilSrc: "社保缴费基数上限·按参保地规定"
  };

  // 社保个人缴费合计基数（医疗/养老/失业+公积金),工伤生育个人不缴
  function clampBase(monthlyWage, floor, ceil) {
    var b = monthlyWage;
    if (floor && b < floor) b = floor;
    if (ceil !== Infinity && b > ceil) b = ceil;
    return b;
  }

  function socialInsurance(monthlyWage, city, hfRate) {
    city = city || DEFAULT_CITY;
    var r = city.rates;
    hfRate = hfRate === undefined ? r.housingFundEmployee.rate : hfRate;
    var base = clampBase(monthlyWage, city.baseFloor, city.baseCeil);
    var lines = [];
    function line(name, rate, src, note) {
      var amt = base * rate;
      lines.push({ name: name, base: base, rate: rate, amount: amt, src: src, note: note || "" });
      return amt;
    }
    var employee =
      line("养老保险(个人)", r.pensionEmployee.rate, r.pensionEmployee.src) +
      line("医疗保险(个人)", r.medicalEmployee.rate, r.medicalEmployee.src) +
      line("失业保险(个人)", r.unemploymentEmployee.rate, r.unemploymentEmployee.src);
    var hf = line("住房公积金(个人)", hfRate, "《住房公积金管理条例》·5%-12%单位选定,个人同缴");
    // Employer side is a single number, not itemised lines, because none of
    // it reaches the take-home figure — breaking it out would add rows to
    // the page about money the user never sees. `lines` below is therefore
    // the employee side only, which is the side that is actually deducted.
    var employer = base * (r.pensionEmployer.rate + r.medicalEmployer.rate +
      r.unemploymentEmployer.rate + r.injuryEmployer.rate + r.maternityEmployer.rate) + base * hfRate;
    var baseNote = city.baseFloor > 0 || city.baseCeil !== Infinity
      ? "缴费基数=" + base + "(工资" + monthlyWage + "按上下限[" + (city.baseFloor || 0) + "," + (city.baseCeil === Infinity ? "∞" : city.baseCeil) + "]取值)"
      : "未设上下限,按实际工资";
    return {
      base: base, baseNote: baseNote,
      employeeMonthly: employee, employeeHousingFund: hf,
      employeeTotal: employee + hf,
      employerMonthly: employer,
      lines: lines
    };
  }

  // ---- tax on comprehensive income (annual, 汇算口径) ---------------------
  function taxFromBrackets(taxableIncome, brackets) {
    if (taxableIncome <= 0) return { tax: 0, bracket: null, effectiveRate: 0 };
    for (var i = 0; i < brackets.length; i++) {
      if (taxableIncome <= brackets[i].upTo) {
        var b = brackets[i];
        return {
          tax: taxableIncome * b.rate - b.quick,
          bracket: b,
          effectiveRate: taxableIncome > 0 ? (taxableIncome * b.rate - b.quick) / taxableIncome : 0
        };
      }
    }
    // Unreachable for a table whose top band runs to Infinity. Kept so every
    // return from this function has the same three keys.
    return { tax: 0, bracket: null, effectiveRate: 0 };
  }

  function annualTax(monthlySalary, deductionsMonthly) {
    // deductionsMonthly: social insurance + housing fund + special deductions
    var gross = monthlySalary * 12;
    var taxable = gross - STANDARD_DEDUCTION_ANNUAL - deductionsMonthly * 12;
    var r = taxFromBrackets(taxable, ANNUAL_BRACKETS);
    return {
      gross: gross,
      taxable: Math.max(0, taxable),
      tax: Math.max(0, r.tax || 0),
      bracket: r.bracket,
      effectiveRate: gross > 0 ? Math.max(0, r.tax || 0) / gross : 0
    };
  }

  // ---- cumulative withholding (累计预扣法, the payslip reality) ------------
  // STA Announcement 2018-61: each month, cumulative taxable income is
  // re-bracketed on the monthly table; tax withheld = cumulative tax - tax
  // already withheld. Monthly cash flow differs from annual average.
  // STA 2018-61: the withholding table is the monthly table "converted
  // proportionally" — cumulative annual taxable income is matched against
  // brackets scaled ×12 (quick deductions ×12), which makes the whole-year
  // sum EXACTLY equal the annual statutory tax. Using the monthly bracket
  // edges against full-year cumulatives (the naive bug) over-withholds by
  // triggering high brackets months early.
  var WITHHOLDING_ANNUALIZED = WITHHOLDING_BRACKETS.map(function (b) {
    return { upTo: b.upTo === Infinity ? Infinity : b.upTo * 12,
             rate: b.rate,
             quick: b.quick * 12,
             src: b.src + "(累计口径:级距×12)" };
  });

  function withholdingSchedule(monthlySalary, deductionsMonthly, months) {
    months = months || 12;
    var rows = [];
    var cumTaxable = 0, cumTaxPaid = 0;
    for (var m = 1; m <= months; m++) {
      cumTaxable += (monthlySalary - STANDARD_DEDUCTION_MONTHLY - deductionsMonthly);
      var r = taxFromBrackets(Math.max(0, cumTaxable), WITHHOLDING_ANNUALIZED);
      var shouldPay = Math.max(0, r.tax);
      var thisMonth = Math.max(0, shouldPay - cumTaxPaid);
      cumTaxPaid += thisMonth;
      rows.push({
        month: m,
        cumTaxable: Math.max(0, cumTaxable),
        cumTax: shouldPay,
        taxThisMonth: thisMonth,
        netThisMonth: monthlySalary - deductionsMonthly - thisMonth
      });
    }
    return rows;
  }

  function fmtCNY(v) {
    var sign = v < 0 ? "-" : "";
    v = Math.abs(v);
    return sign + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }

  return {
    ANNUAL_BRACKETS: ANNUAL_BRACKETS,
    WITHHOLDING_BRACKETS: WITHHOLDING_BRACKETS,
    STANDARD_DEDUCTION_MONTHLY: STANDARD_DEDUCTION_MONTHLY,
    STANDARD_DEDUCTION_ANNUAL: STANDARD_DEDUCTION_ANNUAL,
    STANDARD_DEDUCTION_SRC: STANDARD_DEDUCTION_SRC,
    SPECIAL_DEDUCTIONS: SPECIAL_DEDUCTIONS,
    DEFAULT_CITY: DEFAULT_CITY,
    clampBase: clampBase,
    socialInsurance: socialInsurance,
    taxFromBrackets: taxFromBrackets,
    annualTax: annualTax,
    withholdingSchedule: withholdingSchedule,
    fmtCNY: fmtCNY
  };
});
