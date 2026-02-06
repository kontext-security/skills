#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#     "pandas",
#     "datasets",
#     "pyarrow",
#     "requests",
#     "openpyxl",
# ]
# ///
"""
Dataset profiler — loads any dataset and prints a comprehensive profile.

Accepts anything: URLs, local files, HuggingFace dataset IDs.

Usage:
    uv run profile.py <source> [--config CONFIG] [--split SPLIT]

Examples:
    uv run profile.py https://huggingface.co/datasets/evalstate/mcp-clients
    uv run profile.py https://example.com/data.csv
    uv run profile.py evalstate/mcp-clients --config deduplicated --split deduplicated
    uv run profile.py ./data.csv
    uv run profile.py ./messy_data.xlsx
"""

import argparse
import json
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import pandas as pd


LOADERS = {
    ".csv": pd.read_csv,
    ".tsv": lambda f: pd.read_csv(f, sep="\t"),
    ".parquet": pd.read_parquet,
    ".pq": pd.read_parquet,
    ".json": lambda f: pd.read_json(f),
    ".ndjson": lambda f: pd.read_json(f, lines=True),
    ".jsonl": lambda f: pd.read_json(f, lines=True),
    ".xlsx": lambda f: pd.read_excel(f, engine="openpyxl"),
    ".xls": lambda f: pd.read_excel(f),
}


def download_url(url: str) -> Path:
    """Download a URL to a temp file, return the path."""
    import requests
    resp = requests.get(url, stream=True, timeout=60)
    resp.raise_for_status()

    # Guess extension from URL path or content-type
    parsed = urlparse(url)
    url_ext = Path(parsed.path).suffix.lower()

    if url_ext in LOADERS:
        ext = url_ext
    else:
        ct = resp.headers.get("content-type", "")
        ct_map = {
            "text/csv": ".csv",
            "text/tab-separated-values": ".tsv",
            "application/json": ".json",
            "application/x-ndjson": ".ndjson",
            "application/vnd.apache.parquet": ".parquet",
            "application/octet-stream": ".parquet",  # common default for parquet
        }
        ext = next((e for t, e in ct_map.items() if t in ct), ".csv")

    tmp = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
    for chunk in resp.iter_content(chunk_size=8192):
        tmp.write(chunk)
    tmp.close()
    return Path(tmp.name)


def load_data(source: str, config: str | None, split: str | None) -> pd.DataFrame:
    # 1. HuggingFace URL → extract dataset ID
    hf_match = re.match(r"https?://huggingface\.co/datasets/([^/?#]+/[^/?#]+)", source)
    if hf_match:
        source = hf_match.group(1)
        # Fall through to HF loader below

    # 2. Other URL → download and load
    elif source.startswith("http://") or source.startswith("https://"):
        path = download_url(source)
        loader = LOADERS.get(path.suffix)
        if not loader:
            # Try reading as CSV as last resort
            return pd.read_csv(path)
        return loader(path)

    # 3. Local file
    p = Path(source)
    if p.exists():
        # Try known extensions
        loader = LOADERS.get(p.suffix.lower())
        if loader:
            return loader(p)
        # Try sniffing: is it JSON lines?
        with open(p) as f:
            first_line = f.readline().strip()
        if first_line.startswith("{") or first_line.startswith("["):
            try:
                return pd.read_json(p, lines=True)
            except ValueError:
                return pd.read_json(p)
        # Default: try CSV
        return pd.read_csv(p)

    # 4. HuggingFace dataset ID (owner/name or just a name)
    from datasets import load_dataset
    kwargs = {"name": config} if config else {}
    ds = load_dataset(source, **kwargs)
    key = split or list(ds.keys())[0]
    return ds[key].to_pandas()


def try_parse_json(val: str) -> dict | list | None:
    try:
        obj = json.loads(val)
        return obj if isinstance(obj, (dict, list)) else None
    except (json.JSONDecodeError, TypeError, ValueError):
        return None


def profile(df: pd.DataFrame):
    print(f"Shape: {df.shape[0]:,} rows x {df.shape[1]} columns\n")

    print("=" * 60)
    print("COLUMN OVERVIEW")
    print("=" * 60)
    for col in df.columns:
        s = df[col]
        print(f"\n--- {col} ---")
        print(f"  dtype: {s.dtype}")
        print(f"  nulls: {s.isna().sum()} ({s.isna().mean():.1%})")
        print(f"  unique: {s.nunique():,} / {len(s):,} ({s.nunique()/len(s):.1%})")

        if pd.api.types.is_numeric_dtype(s):
            desc = s.describe()
            print(f"  min={desc['min']}, max={desc['max']}, mean={desc['mean']:.2f}, median={desc['50%']:.2f}, std={desc['std']:.2f}")

        elif pd.api.types.is_datetime64_any_dtype(s):
            print(f"  range: {s.min()} to {s.max()} ({(s.max() - s.min()).days} days)")

        elif pd.api.types.is_string_dtype(s):
            lengths = s.dropna().str.len()
            if len(lengths) > 0:
                print(f"  string lengths: min={int(lengths.min())}, max={int(lengths.max())}, mean={lengths.mean():.0f}")

            # Top values
            vc = s.value_counts()
            print(f"  top values:")
            for val, count in vc.head(5).items():
                display = str(val)[:80]
                print(f"    {display!r}: {count} ({count/len(s):.1%})")

            # Check for JSON
            sample = s.dropna().head(10)
            json_count = sum(1 for v in sample if try_parse_json(v) is not None)
            if json_count > len(sample) * 0.5:
                print(f"  [JSON DETECTED] {json_count}/{len(sample)} samples parse as JSON")
                # Find a non-empty example
                all_parsed = s.dropna().head(50)
                best = next(
                    (try_parse_json(v) for v in all_parsed
                     if try_parse_json(v) is not None and try_parse_json(v)),
                    next((try_parse_json(v) for v in all_parsed if try_parse_json(v) is not None), None)
                )
                if best and isinstance(best, dict):
                    print(f"  JSON keys: {list(best.keys())}")
                    print(f"  Example:\n    {json.dumps(best, indent=2)[:500]}")

            # Check for comma-separated lists
            comma_count = sum(1 for v in sample if "," in str(v))
            if comma_count > len(sample) * 0.3:
                item_counts = s.dropna().str.split(",").apply(len)
                print(f"  [LIST DETECTED] comma-separated, items per row: min={item_counts.min()}, max={item_counts.max()}, mean={item_counts.mean():.1f}")

    # Head
    print("\n" + "=" * 60)
    print("FIRST 5 ROWS")
    print("=" * 60)
    pd.set_option("display.max_colwidth", 80)
    pd.set_option("display.width", 200)
    print(df.head(5).to_string())

    # Numeric describe
    numeric = df.select_dtypes(include="number")
    if len(numeric.columns) > 0:
        print("\n" + "=" * 60)
        print("NUMERIC SUMMARY")
        print("=" * 60)
        print(numeric.describe().to_string())


def main():
    parser = argparse.ArgumentParser(description="Profile a dataset")
    parser.add_argument("source", help="URL, local file path, or HuggingFace dataset ID")
    parser.add_argument("--config", help="HuggingFace dataset config/subset")
    parser.add_argument("--split", help="Dataset split")
    args = parser.parse_args()

    df = load_data(args.source, args.config, args.split)
    profile(df)


if __name__ == "__main__":
    main()
