"""Profiling has to be right, because a spec is written from what it reports.

The failure that matters most is missing that x repeats per series, because the
resulting figure renders happily and draws a sawtooth.
"""

from __future__ import annotations

import json

import pytest

from graphunslopify.cli import main
from graphunslopify.describe import profile


@pytest.fixture
def training(tmp_path):
    path = tmp_path / "training.csv"
    rows = ["model,seed,epoch,accuracy,note"]
    for model in ("baseline", "ours"):
        for seed in range(3):
            for epoch in range(1, 11):
                score = 50 + epoch * 2.3 + seed * 0.7
                rows.append(f"{model},{seed},{epoch},{score:.3f},run-{model}-{seed}-{epoch}")
    path.write_text("\n".join(rows) + "\n", encoding="utf8")
    return path


def test_a_missing_file_is_reported_not_raised(tmp_path):
    report = profile(tmp_path / "nope.csv")
    assert report["ok"] is False
    assert "no such file" in report["error"]


def test_columns_are_given_a_role(training):
    roles = {c["name"]: c["role"] for c in profile(training)["columns"]}
    assert roles["model"] == "category"
    assert roles["epoch"] == "ordinal"
    assert roles["accuracy"] == "measure"
    assert roles["note"] == "identifier"


def test_small_category_sets_list_their_values(training):
    columns = {c["name"]: c for c in profile(training)["columns"]}
    assert set(columns["model"]["values"]) == {"baseline", "ours"}
    assert "values" not in columns["note"]


def test_numeric_columns_carry_their_range(training):
    accuracy = next(c for c in profile(training)["columns"] if c["name"] == "accuracy")
    assert accuracy["min"] == pytest.approx(52.3)
    assert accuracy["max"] == pytest.approx(74.4)


def test_repeated_x_per_series_is_reported(training):
    report = profile(training)
    pairs = {(r["x"], r["group"]) for r in report["repeats"]}
    assert ("epoch", "model") in pairs


def test_the_suggestion_picks_the_curve_axis_not_the_replicate(training):
    suggested = profile(training)["suggested"]
    assert suggested["x"] == "epoch"
    assert suggested["y"] == "accuracy"
    assert suggested["group"] == "model"


def test_the_suggestion_asks_for_aggregation_when_x_repeats(training):
    suggested = profile(training)["suggested"]
    assert suggested["aggregation"] == "mean"
    assert suggested["uncertainty"]["over"] == "seed"
    assert "repeat" in suggested["note"]


def test_no_aggregation_is_suggested_when_nothing_repeats(tmp_path):
    path = tmp_path / "clean.csv"
    rows = ["model,epoch,accuracy"]
    for model in ("a", "b"):
        for epoch in range(1, 6):
            rows.append(f"{model},{epoch},{epoch * 3.5:.2f}")
    path.write_text("\n".join(rows) + "\n", encoding="utf8")

    suggested = profile(path)["suggested"]
    assert "aggregation" not in suggested


def test_the_cli_prints_json(training, capsys):
    assert main(["describe", str(training)]) == 0
    parsed = json.loads(capsys.readouterr().out)
    assert parsed["ok"] is True
    assert "epoch" in parsed["column_names"]


def test_the_cli_reports_a_missing_file_without_crashing(tmp_path, capsys):
    assert main(["describe", str(tmp_path / "absent.csv")]) == 1
    assert json.loads(capsys.readouterr().out)["ok"] is False
