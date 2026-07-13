#!/usr/bin/env python3
"""
OAS Stone Engraving — Pricing Engine v0.1
ระบบคำนวณราคาป้ายหิน (รันในเครื่องเท่านั้น)
"""

import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = Path(__file__).parent
RULES_PATH = BASE_DIR / "data" / "legacy_python_pricing_rules.json"
JOBS_PATH  = BASE_DIR / "data" / "legacy_python_sample_jobs.json"


def load_json(path: Path) -> dict | list:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def count_chars(text: str) -> int:
    return len(text.replace(" ", ""))


def calculate(job: dict, rules: dict) -> dict:
    w  = job["width_cm"]
    h  = job["height_cm"]
    sqcm = w * h

    stone_rate   = rules["stone_types"][job["stone_type"]]["price_per_sqcm"]
    thick_mult   = rules["thickness_multiplier"][job["thickness"]]
    stone_cost   = sqcm * stone_rate * thick_mult

    num_chars    = count_chars(job.get("text", ""))
    eng_min      = rules["engraving"]["minimum_charge"]
    eng_ppc      = rules["engraving"]["price_per_char"]
    engraving_cost = max(num_chars * eng_ppc, eng_min)

    paint_key    = job.get("paint", "none")
    paint_ppc    = rules["paint"][paint_key]["price_per_char"]
    paint_cost   = num_chars * paint_ppc

    base_cost    = rules["base"][job.get("base", "none")]["price"]
    install_cost = rules["installation"][job.get("installation", "none")]["price"]
    delivery_cost= rules["delivery"][job.get("delivery", "pickup")]["price"]

    breakdown = {
        "หินดิบ ({}x{}cm, {})".format(w, h, job["thickness"]): round(stone_cost, 2),
        "แกะสลัก ({} ตัวอักษร)".format(num_chars):             round(engraving_cost, 2),
        "สี ({})".format(rules["paint"][paint_key]["name"]):    round(paint_cost, 2),
        "ฐาน ({})".format(rules["base"][job.get("base","none")]["name"]):            base_cost,
        "ติดตั้ง ({})".format(rules["installation"][job.get("installation","none")]["name"]): install_cost,
        "ขนส่ง ({})".format(rules["delivery"][job.get("delivery","pickup")]["name"]):        delivery_cost,
    }

    total = sum(breakdown.values())
    return {"breakdown": breakdown, "total": round(total, 2)}


def print_quote(job: dict, result: dict) -> None:
    sep = "─" * 52
    print(f"\n{'═'*52}")
    print(f"  {job['job_id']} — {job['description']}")
    print(sep)
    for label, amount in result["breakdown"].items():
        print(f"  {label:<36} {amount:>8,.0f} บาท")
    print(sep)
    print(f"  {'ราคารวม (ประมาณ)':<36} {result['total']:>8,.0f} บาท")
    print(f"{'═'*52}\n")


def main() -> None:
    rules = load_json(RULES_PATH)

    if len(sys.argv) > 1 and sys.argv[1] == "--job":
        job_file = Path(sys.argv[2])
        jobs = load_json(job_file)
        if isinstance(jobs, dict):
            jobs = [jobs]
    else:
        jobs = load_json(JOBS_PATH)

    print("\n OAS Stone Engraving — ใบเสนอราคาหยาบ v0.1")

    for job in jobs:
        result = calculate(job, rules)
        print_quote(job, result)


if __name__ == "__main__":
    main()
