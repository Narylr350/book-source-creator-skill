#!/usr/bin/env python3
"""Compatibility wrapper for validate_source.mjs."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> int:
    script_path = Path(__file__).with_suffix(".mjs")
    result = subprocess.run(["node", str(script_path), *sys.argv[1:]], check=False)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
