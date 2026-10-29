"""Run the overlay.js tests against a Panorama mock in Node.js (no game needed).

    python tests/run_tests.py
"""
import json, os, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS = ["test_window.js", "test_ui_states.js"]


def main():
    with open(os.path.join(ROOT, "config.json"), encoding="utf-8") as f:
        config = json.load(f)
    with open(os.path.join(ROOT, "overlay.js"), encoding="utf-8") as f:
        overlay = f.read().replace("__DD_CONFIG__", json.dumps(config, ensure_ascii=False))

    with tempfile.TemporaryDirectory() as tmp:
        built = os.path.join(tmp, "overlay.built.js")
        with open(built, "w", encoding="utf-8") as f:
            f.write(overlay)
        subprocess.run(["node", "--check", built], check=True)
        failed = 0
        for test in TESTS:
            result = subprocess.run(["node", os.path.join(ROOT, "tests", test), built])
            failed += result.returncode != 0
    if failed:
        sys.exit(f"{failed} test file(s) failed")
    print("all tests passed")


if __name__ == "__main__":
    main()
