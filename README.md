# tax-lens

**个税五险一金计算器 / China salary & social-insurance calculator / 給与計算** — 输入月薪,看到手:逐月累计预扣明细、全年汇算对比,并且**每一个数字都标注法律依据**。免费、无上传、无服务器——全部计算在浏览器本地完成。

> **English** — A China salary calculator whose product *is* verifiability: cumulative-withholding month-by-month (the real payslip curve, including the bracket-jump months), annual reconciliation, and every number rendered with its legal source (IIT Law, STA Announcement 2018-61, State Council Decree 41). In-browser, free, no upload. **[Try it](https://w1977-0.github.io/tax-lens/)**
>
> **日本語** — 中国の給与・社会保険計算。毎月の源泉徴収(累積控除法)と年度汇算、すべての数字に法的根拠を明示。ブラウザ内だけで動作。**[使ってみる](https://w1977-0.github.io/tax-lens/)**


[![CI](https://github.com/w1977-0/tax-lens/actions/workflows/ci.yml/badge.svg)](https://github.com/w1977-0/tax-lens/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) ![No upload](https://img.shields.io/badge/privacy-no%20upload-green.svg)

## Why "lens"

Every tax calculator gives you a number. This one shows you **where each number comes from**: the 7-bracket table is the IIT Law's own; the basic deduction is Article 6; the month-by-month curve is the statutory cumulative-withholding method; social-insurance rates and base caps come labeled with the instruments that set them (and flagged where cities vary — you can edit every parameter on the page).

## How the math is verified

Three independent lines, all pinned in `test/taxmath.test.js`:

1. **Cross-implementation anchors** — published outputs of an independent Qt/C++ implementation (caspian-yez/china-individual-income-tax-calculator) match to the cent: ¥50,000/month with ¥9,981 monthly deductions → **¥73,148.40**; with a personal pension → **¥70,137.00**. (Developing this, the anchor test caught *my own* hand-computed bracket error — the verification works in both directions.)
2. **Bracket continuity** — at every bracket boundary, tax from the lower side equals tax from the upper side to the cent (quick-deduction consistency, all 7 brackets).
3. **Withholding ≡ annual reconciliation** — the 12 monthly withholdings must sum exactly to the annual statutory tax; the test enforces it. (A real bug was caught here during development: the naive monthly-bracket reading of STA 2018-61 over-withholds; the correct method matches cumulative income against brackets scaled ×12.)

Run them yourself with Node ≥ 18 — no dependencies, no install:

```
node --test test/taxmath.test.js
```

## Browser support

One HTML file, no build step and no bundler. Any current Chrome, Edge, Firefox or Safari will run it, on desktop or mobile; JavaScript is the only requirement. The page makes zero network requests after load and writes nothing to storage, so it also works from a local copy of `index.html` with no server.

## Data sources

| What | Source | Scope |
|---|---|---|
| Tax brackets (3%–45%), quick deductions | 个人所得税法 (2018 amendment), Art. 3, Table I | national, statutory |
| Basic deduction ¥5,000/mo (¥60,000/yr) | IIT Law Art. 6 | national, statutory |
| Cumulative withholding method + table | 税务总局公告2018年第61号 | national, statutory |
| Special additional deductions (2,000/child education & infant care, 3,000 elderly, etc.) | 国发〔2018〕41号 + 2023-08 提标通知 | national, statutory |
| Employer pension 16% | 国办发〔2019〕13号 | national default |
| Housing-fund 5%–12% | 《住房公积金管理条例》 | statutory range |
| Other social-insurance rates & base caps | **city-specific** — the page ships common defaults and lets you edit them, labeled as such | local, editable |

Last full check against the above: **2026-09**. Official primary sources are increasingly crawler-hostile; the law text was verified against two independent open-source implementations plus published test vectors. If any figure here disagrees with the statute, the statute wins — please open an issue.

## Disclaimer

Results are for reference; the binding numbers are your 个税 App and your local social-insurance office. Nothing is uploaded: the page makes zero network requests after load.

## License

MIT
