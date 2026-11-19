"""Excel and Word reports of one stored result, built from the same tables and sentences."""

from __future__ import annotations

import io

from sensibilia.analysis.presenter import number, present

Table = tuple[str, list[str], list[list]]


def r(value, digits=3):
    return None if value is None else round(value, digits)


def tables(recipe: str, result: dict) -> list[Table]:
    if recipe == "liking-anova":
        out = []
        for q in result["questions"]:
            title = q["question"] or q["question_id"]
            out.append(
                (
                    f"Means – {title}",
                    ["Sample", "Ratings", "Mean", "SD", "95 % CI low", "95 % CI high", "Group"],
                    [
                        [
                            s["code"],
                            s["n"],
                            r(s["mean"], 2),
                            r(s["sd"], 2),
                            r(s["ci_low"], 2),
                            r(s["ci_high"], 2),
                            s["group"],
                        ]
                        for s in q["samples"]
                    ],
                )  # fmt: skip
            )
            out.append(
                (
                    f"Pairs – {title}",
                    ["Sample", "Sample", "Difference", "p", "Significant"],
                    [
                        [
                            p["a"],
                            p["b"],
                            r(p["difference"], 2),
                            r(p["p_value"], 4),
                            "yes" if p["significant"] else "no",
                        ]
                        for p in q["pairs"]
                    ],
                )  # fmt: skip
            )
            out.append(
                (
                    f"{q['test_name']} – {title}",
                    ["Source", "df", "Sum of squares", "Mean square", "Statistic", "p"],
                    [
                        [
                            t["term"],
                            r(t["df"], 2),
                            r(t["sum_sq"]),
                            r(t["mean_sq"]),
                            r(t["statistic"]),
                            r(t["p_value"], 4),
                        ]
                        for t in q["table"]
                    ],
                )  # fmt: skip
            )
        return out
    if recipe == "discrimination":
        rows = [
            ["Assessors", result["n"]],
            ["Correct", result["correct"]],
            ["Guessing probability", r(result["guessing"])],
            ["p", r(result["p_value"], 4)],
        ]
        for key, name in (("pc", "Proportion correct"), ("pd", "Proportion of discriminators"),
                          ("d_prime", "d′")):  # fmt: skip
            value = result.get(key)
            if value:
                rows.append([name, r(value["estimate"]), r(value["low"]), r(value["high"])])
        for code, count in (result.get("counts") or {}).items():
            rows.append([f"Chose {code}", count])
        return [("Discrimination", ["Measure", "Estimate", "95 % CI low", "95 % CI high"], rows)]
    if recipe == "jar-penalty":
        rows = []
        for a in result["attributes"]:
            for c in a["samples"]:
                rows.append(
                    [a["question"], c["code"], c["n"], r(c["too_little"]), r(c["just_right"]),
                     r(c["too_much"]), r(c["liking_just_right"], 2), r(c["drop_too_little"], 2),
                     r(c["drop_too_much"], 2), r(c["penalty_too_little"], 2),
                     r(c["penalty_too_much"], 2), r(c["p_too_little"], 4), r(c["p_too_much"], 4)]
                )  # fmt: skip
        return [
            (
                "Penalty analysis",
                ["Attribute", "Sample", "n", "Too little", "Just right", "Too much",
                 "Liking (JAR)", "Drop (too little)", "Drop (too much)", "Penalty (too little)",
                 "Penalty (too much)", "p (too little)", "p (too much)"],
                rows,
            )
        ]  # fmt: skip
    if recipe == "cata":
        samples = result["samples"]
        counts = [
            [a["question"], *[f"{a['counts'].get(s, 0)} {a['groups'].get(s, '')}".strip()
                              for s in samples], r(a["statistic"]), r(a["p_value"], 4)]
            for a in result["attributes"]
        ]  # fmt: skip
        out = [("Citations", ["Attribute", *samples, "Cochran's Q", "p"], counts)]
        if result.get("liking_question"):
            out.append(
                (
                    "Impact on liking",
                    ["Attribute", "Liking when checked", "Liking when not", "Impact", "p"],
                    [
                        [
                            a["question"],
                            r(a["liking_checked"], 2),
                            r(a["liking_unchecked"], 2),
                            r(a["impact"], 2),
                            r(a["impact_p"], 4),
                        ]
                        for a in result["attributes"]
                    ],
                )  # fmt: skip
            )
        return out
    if recipe == "rata":
        samples = result["samples"]

        def cell(attribute, code, key):
            return next((s[key] for s in attribute["samples"] if s["code"] == code), None)

        def mean_and_group(attribute, code):
            return f"{number(cell(attribute, code, 'mean'))} {cell(attribute, code, 'group') or ''}"

        means = [
            [a["question"], *[mean_and_group(a, s).strip() for s in samples],
             r(a["statistic"]), r(a["p_value"], 4)]
            for a in result["attributes"]
        ]  # fmt: skip
        checked = [
            [a["question"], *[r(cell(a, s, "checked")) for s in samples]]
            for a in result["attributes"]
        ]
        return [
            ("Mean ratings", ["Attribute", *samples, "F", "p"], means),
            ("Share checked", ["Attribute", *samples], checked),
        ]
    raise ValueError(recipe)


def receipt_lines(meta: dict) -> list[str]:
    job = meta["job"]
    runtime = job.get("runtime") or {}
    versions = runtime.get("versions") or {}
    return [
        f"Study: {meta['study']}  ·  Test: {meta['test']}",
        f"Data frozen: {meta['snapshot_label']} ({meta['snapshot_created_at']}), "
        f"dataset SHA-256 {meta['dataset_sha256']}",
        f"Recipe {job['recipe']} v{job['recipe_version']} (SHA-256 {job['recipe_sha256'][:16]}…), "
        f"settings {job['parameters']}",
        f"R {versions.get('R', '?')}, packages from CRAN snapshot {runtime.get('snapshot_date')}, "
        f"result SHA-256 {job['result_sha256']}",
        f"Ran by {job['staff_name']}, finished {job['finished_at']}",
    ]


def xlsx(recipe: str, result: dict, meta: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, Reference
    from openpyxl.styles import Font

    text = present(recipe, result)
    book = Workbook()
    summary = book.active
    summary.title = "Summary"
    summary.append([meta["title"]])
    summary["A1"].font = Font(bold=True, size=13)
    for heading, lines in (
        ("Answer", text["answer"]),
        ("Warnings", text["warnings"]),
        ("How to read this", text["how_to_read"]),
        ("Receipt", receipt_lines(meta)),
    ):
        if not lines:
            continue
        summary.append([])
        summary.append([heading])
        summary.cell(summary.max_row, 1).font = Font(bold=True)
        for line in lines:
            summary.append([line])
    summary.column_dimensions["A"].width = 120
    for index, (title, headers, rows) in enumerate(tables(recipe, result), 1):
        sheet = book.create_sheet(sheet_name(title, index))
        sheet.append(headers)
        for cell in sheet[1]:
            cell.font = Font(bold=True)
        for row in rows:
            sheet.append(row)
        for column in sheet.columns:
            width = max(len(str(c.value or "")) for c in column)
            sheet.column_dimensions[column[0].column_letter].width = min(max(width + 2, 8), 60)
        if recipe == "liking-anova" and title.startswith("Means") and rows:
            chart = BarChart()
            chart.title, chart.y_axis.title = title, "Mean liking"
            data = Reference(sheet, min_col=3, min_row=1, max_row=len(rows) + 1)
            chart.add_data(data, titles_from_data=True)
            chart.set_categories(Reference(sheet, min_col=1, min_row=2, max_row=len(rows) + 1))
            chart.legend = None
            sheet.add_chart(chart, "I2")
    output = io.BytesIO()
    book.save(output)
    return output.getvalue()


def sheet_name(title: str, index: int) -> str:
    cleaned = "".join(c for c in title if c not in "[]:*?/\\")
    return f"{index} {cleaned}"[:31]


def docx(recipe: str, result: dict, meta: dict, figures: dict[str, bytes]) -> bytes:
    from docx import Document
    from docx.shared import Cm, Pt

    text = present(recipe, result)
    document = Document()
    document.styles["Normal"].font.size = Pt(10)
    document.add_heading(meta["title"], level=1)
    for line in text["answer"]:
        document.add_paragraph(line)
    for name in sorted(figures):
        document.add_picture(io.BytesIO(figures[name]), width=Cm(15))
    for title, headers, rows in tables(recipe, result):
        document.add_heading(title, level=2)
        table = document.add_table(rows=1, cols=len(headers))
        table.style = "Light Grid"
        for cell, header in zip(table.rows[0].cells, headers, strict=True):
            cell.text = header
        for row in rows:
            cells = table.add_row().cells
            for cell, value in zip(cells, row, strict=False):
                cell.text = "" if value is None else str(value)
    if text["warnings"]:
        document.add_heading("Warnings", level=2)
        for line in text["warnings"]:
            document.add_paragraph(line, style="List Bullet")
    document.add_heading("How to read this", level=2)
    for line in text["how_to_read"]:
        document.add_paragraph(line)
    document.add_heading("Receipt", level=2)
    for line in receipt_lines(meta):
        paragraph = document.add_paragraph(line)
        paragraph.runs[0].font.size = Pt(8)
    output = io.BytesIO()
    document.save(output)
    return output.getvalue()
