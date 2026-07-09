#!/usr/bin/env python3
"""将国家税务总局出口退税率文库 DBF/FPT 转换为前端可读 JSON。

仅使用 Python 标准库，不需要安装第三方包。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from pathlib import Path


def read_dbf(path: Path):
    data = path.read_bytes()
    _, _, _, _, record_count, header_length, record_length = struct.unpack_from("<BBBBIHH", data, 0)
    fields = []
    descriptor_offset = 32
    field_offset = 1
    while data[descriptor_offset] != 0x0D:
        descriptor = data[descriptor_offset : descriptor_offset + 32]
        name = descriptor[:11].split(b"\0", 1)[0].decode("ascii")
        field_type = chr(descriptor[11])
        length = descriptor[16]
        fields.append((name, field_type, length, field_offset))
        field_offset += length
        descriptor_offset += 32

    for index in range(record_count):
        start = header_length + index * record_length
        record = data[start : start + record_length]
        if record[:1] == b"*":
            continue
        row = {}
        for name, field_type, length, offset in fields:
            raw = record[offset : offset + length]
            if field_type == "M":
                row[name] = int.from_bytes(raw, "little")
            else:
                row[name] = raw.decode("gb18030", "replace").strip()
        yield row


def read_memo(fpt_data: bytes, block_size: int, pointer: int) -> str:
    if not pointer:
        return ""
    offset = pointer * block_size
    length = int.from_bytes(fpt_data[offset + 4 : offset + 8], "big")
    return fpt_data[offset + 8 : offset + 8 + length].decode("gb18030", "replace").strip("\0 ")


def date_text(value: str) -> str | None:
    value = value.strip()
    if len(value) != 8 or not value.isdigit():
        return None
    return f"{value[:4]}-{value[4:6]}-{value[6:]}"


def number(value: str):
    value = value.strip()
    if not value:
        return None
    result = float(value)
    return int(result) if result.is_integer() else result


def number_list(value: str):
    values = [number(item) for item in value.split(",") if item.strip()]
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--coverage-from", default="20260101")
    args = parser.parse_args()

    std_dbf = args.input_dir / "stdcm.dbf"
    std_fpt = args.input_dir / "STDCM.FPT"
    cmcode_dbf = args.input_dir / "cmcode.DBF"

    fpt_data = std_fpt.read_bytes()
    block_size = int.from_bytes(fpt_data[6:8], "big")
    commodities = []
    commodity_names = {}
    for row in read_dbf(std_dbf):
        code = row["CODE"]
        if not code:
            continue
        name = read_memo(fpt_data, block_size, row["NAME"])
        commodity_names[code] = name
        commodities.append({
            "code": code,
            "goods_name": name,
            "unit": row["UNIT"],
        })

    rates = []
    for row in read_dbf(cmcode_dbf):
        code = row["CODE"]
        if not code or row["END_DATE"] < args.coverage_from:
            continue
        rates.append({
            "code": code,
            "goods_name": commodity_names.get(code) or row["NAME"],
            "unit": row["UNIT"],
            "tax_rates": number_list(row["ZSSL_SET"]),
            "refund_rate": number(row["TSL"]),
            "effective_from": date_text(row["ST_DATE"]),
            "effective_to": date_text(row["END_DATE"]),
            "special_flag": row["TSFLAG"] or None,
        })

    commodities.sort(key=lambda item: item["code"])
    rates.sort(key=lambda item: (item["code"], item["effective_from"] or ""))
    archive_hash = hashlib.sha256(args.archive.read_bytes()).hexdigest()
    output = {
        "metadata": {
            "version": "2026B",
            "data_type": "official_export_refund_rate_library",
            "source": "国家税务总局江苏省税务局",
            "source_url": "https://jiangsu.chinatax.gov.cn/art/2026/6/9/art_15956_1748230.html",
            "published_at": "2026-06-09",
            "coverage_from": date_text(args.coverage_from),
            "archive_sha256": archive_hash,
            "rate_record_count": len(rates),
            "commodity_record_count": len(commodities),
        },
        "rates": rates,
        "commodities": commodities,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps(output["metadata"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
