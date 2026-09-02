"""Profiling a data file so a spec can be written against what is actually there.

An agent writing a spec without this is guessing at column names, at whether a
column is a number or a label, at how many categories there are, and at whether
x repeats per series. Every one of those guesses is a spec that fails or, worse,
a figure that renders and is wrong.

Output is JSON so it can be read straight back into a spec.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

MAX_LISTED_CATEGORIES = 25
CATEGORICAL_CEILING = 50


def _read(path: Path) -> Any:
    import pandas as pd

    suffix = path.suffix.lower()
    if suffix == ".parquet":
        return pd.read_parquet(path)
    if suffix in {".json", ".jsonl"}:
        return pd.read_json(path, lines=suffix == ".jsonl")
    return pd.read_csv(path)


def _looks_like_an_index(series: Any) -> bool:
    """An epoch or a seed is a complete run of integers starting at 0 or 1.

    Measured integers are not. An accuracy column of whole percentages runs from
    something like 52 to 72, so requiring the run to start at 0 or 1 separates
    the axis a curve travels along from the quantity being measured.
    """
    values = series.dropna()
    if values.empty or not (values % 1 == 0).all():
        return False
    low, high = int(values.min()), int(values.max())
    if low not in (0, 1):
        return False
    return values.nunique() == high - low + 1


def _role(series: Any, rows: int) -> str:
    """A guess at what the column is for, which is what a spec needs to know."""
    import pandas as pd

    distinct = series.nunique(dropna=True)
    if pd.api.types.is_numeric_dtype(series):
        if distinct <= 2:
            return "flag"
        if distinct <= CATEGORICAL_CEILING and _looks_like_an_index(series):
            return "ordinal"
        return "measure"
    if distinct <= CATEGORICAL_CEILING:
        return "category"
    return "identifier"


def profile(path: str | Path) -> dict[str, Any]:
    import pandas as pd

    path = Path(path)
    if not path.exists():
        return {"ok": False, "error": f"no such file: {path}"}

    frame = _read(path)
    rows = len(frame)
    columns: list[dict[str, Any]] = []

    for name in frame.columns:
        series = frame[name]
        entry: dict[str, Any] = {
            "name": str(name),
            "dtype": str(series.dtype),
            "role": _role(series, rows),
            "distinct": int(series.nunique(dropna=True)),
            "missing": int(series.isna().sum()),
        }
        if pd.api.types.is_numeric_dtype(series) and series.notna().any():
            entry["min"] = float(series.min())
            entry["max"] = float(series.max())
            entry["mean"] = float(series.mean())
        if (
            entry["role"] in {"category", "flag", "ordinal"}
            and entry["distinct"] <= MAX_LISTED_CATEGORIES
        ):
            entry["values"] = [
                (v.item() if hasattr(v, "item") else v) for v in series.dropna().unique().tolist()
            ]
        columns.append(entry)

    measures = [c["name"] for c in columns if c["role"] == "measure"]
    categories = [c["name"] for c in columns if c["role"] == "category"]
    # The ordinal a curve runs along has many steps. A replicate index has few,
    # so ranking by distinct count picks epoch over seed.
    ordinals = [
        c["name"] for c in sorted(columns, key=lambda c: -c["distinct"]) if c["role"] == "ordinal"
    ]

    report: dict[str, Any] = {
        "ok": True,
        "path": str(path),
        "rows": rows,
        "columns": columns,
        "column_names": [c["name"] for c in columns],
    }

    # Whether x repeats per series decides whether aggregation is needed, and it
    # is the single thing a spec most often gets wrong.
    repeats: list[dict[str, Any]] = []
    for x_name in ordinals + categories:
        for group in categories:
            if group == x_name:
                continue
            duplicated = int(frame.duplicated(subset=[x_name, group]).sum())
            if duplicated:
                repeats.append({"x": x_name, "group": group, "repeated_rows": duplicated})
    report["repeats"] = repeats[:10]

    hint: dict[str, Any] = {}
    if ordinals and measures:
        hint = {"kind": "line", "x": ordinals[0], "y": measures[0]}
    elif categories and measures:
        hint = {"kind": "bar", "x": categories[0], "y": measures[0]}
    elif len(measures) >= 2:
        hint = {"kind": "scatter", "x": measures[0], "y": measures[1]}
    if categories and hint:
        candidates = [c for c in categories if c != hint.get("x")]
        if candidates:
            hint["group"] = candidates[0]
    matching = [r for r in repeats if r["x"] == hint.get("x") and r["group"] == hint.get("group")]
    if hint and matching:
        hint["aggregation"] = "mean"
        replicate = [
            c["name"]
            for c in columns
            if c["role"] == "ordinal" and c["name"] not in {hint.get("x"), hint.get("y")}
        ]
        hint["uncertainty"] = {"kind": "ci", "over": replicate[0]} if replicate else {"kind": "std"}
        hint["note"] = (
            f"{matching[0]['repeated_rows']} rows repeat on "
            f"({hint['x']}, {hint['group']}), so aggregation is needed"
        )
    report["suggested"] = hint

    return report


def render(report: dict[str, Any]) -> str:
    return json.dumps(report, indent=2, default=str)
