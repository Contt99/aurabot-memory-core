"""Run the host suite with the installed desktop Session SDK (no npm/downloads)."""
import argparse
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile


def extract_session_packages(archive, modules):
    # Electron ASAR: header pickle length, header JSON, contiguous file contents.
    with archive.open("rb") as f:
        _, header_length, _, json_length = struct.unpack("<4I", f.read(16))
        packages = json.loads(f.read(json_length))["files"]["dsh"]["files"]["node_modules"]
        base = 8 + header_length

        def read_file(node):
            f.seek(base + int(node["offset"]))
            return f.read(node["size"])

        def extract(node, path):
            if "files" not in node:
                path.write_bytes(read_file(node))
                return
            path.mkdir(parents=True, exist_ok=True)
            for name, child in node["files"].items():
                if name in (".", "..") or Path(name).name != name:
                    raise ValueError(f"Invalid ASAR entry: {name!r}")
                extract(child, path / name)

        seen, pending = set(), ["@deepseek-ai/dsh-session"]
        while pending:
            pkg = pending.pop()
            if pkg in seen:
                continue
            seen.add(pkg)
            node = packages
            for part in pkg.split("/"):
                node = node["files"][part]
            manifest = json.loads(read_file(node["files"]["package.json"]))
            extract(node, modules / pkg)
            pending.extend(manifest.get("dependencies", {}))
            pending.extend(manifest.get("peerDependencies", {}))
            if pkg == "@deepseek-ai/dsh-session":
                print(f"Installed {pkg} {manifest['version']}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("host_src", type=Path)
    parser.add_argument("app_asar", type=Path)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix="host-memory-sdk-") as tmp:
        modules = Path(tmp) / "node_modules"
        extract_session_packages(args.app_asar, modules)
        env = dict(os.environ, AURABOT_HOST_SRC=str(args.host_src.resolve()),
                   DSH_MODULE_ROOT=str(modules))
        suite = Path(__file__).with_name("host-memory.test.mjs")
        raise SystemExit(subprocess.run(["node", "--test", str(suite)], env=env).returncode)
