#!/usr/bin/env python3

import base64
import functools
import http.server
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request


FINAL_RESULT_EXPRESSION = r"""
JSON.stringify({
  complete: document.documentElement?.dataset?.testComplete || null,
  status: document.documentElement?.dataset?.testStatus || null,
  infrastructureError: document.documentElement?.dataset?.testInfrastructureError || null,
  summary: document.querySelector("#summary")?.textContent?.trim() || "",
  failedTests: Array.from(document.querySelectorAll(
    '#results > li[data-test-status="failed"]'
  )).map((item) => ({
    name: item.dataset.testName || "Unnamed test",
    error: item.querySelector("[data-test-error]")?.textContent?.trim() || ""
  }))
})
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format, *_args):
        return


class ProjectHandler(QuietHandler):
    def __init__(self, *args, project_dir, runner_script, **kwargs):
        self.runner_script = runner_script
        super().__init__(*args, directory=str(project_dir), **kwargs)

    def do_GET(self):
        if urllib.parse.urlsplit(self.path).path == "/__test-runner__/test-runner.js":
            data = self.runner_script.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


class WebSocket:
    def __init__(self, url, timeout):
        without_scheme = url.removeprefix("ws://")
        authority, path = without_scheme.split("/", 1)
        host, port_text = authority.rsplit(":", 1)
        self.socket = socket.create_connection((host, int(port_text)), timeout=timeout)
        self.socket.settimeout(timeout)

        key = base64.b64encode(secrets.token_bytes(16)).decode("ascii")
        request = (
            f"GET /{path} HTTP/1.1\r\n"
            f"Host: {authority}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            f"Origin: http://{host}:{port_text}\r\n\r\n"
        )
        self.socket.sendall(request.encode("ascii"))
        response = self._read_until(b"\r\n\r\n")
        if b" 101 " not in response.split(b"\r\n", 1)[0]:
            raise RuntimeError("Browser rejected the DevTools connection.")

    def _read_until(self, marker):
        data = bytearray()
        while marker not in data:
            chunk = self.socket.recv(4096)
            if not chunk:
                raise RuntimeError("Browser closed the DevTools connection.")
            data.extend(chunk)
        return bytes(data)

    def _read_exactly(self, length):
        data = bytearray()
        while len(data) < length:
            chunk = self.socket.recv(length - len(data))
            if not chunk:
                raise RuntimeError("Browser closed the DevTools connection.")
            data.extend(chunk)
        return bytes(data)

    def _send_frame(self, payload, opcode=1):
        mask = secrets.token_bytes(4)
        length = len(payload)
        header = bytearray([0x80 | opcode])
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header.extend(struct.pack("!H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack("!Q", length))
        masked = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
        self.socket.sendall(bytes(header) + mask + masked)

    def send_json(self, value):
        self._send_frame(json.dumps(value).encode("utf-8"))

    def receive_json(self):
        while True:
            first, second = self._read_exactly(2)
            opcode = first & 0x0F
            length = second & 0x7F
            if length == 126:
                length = struct.unpack("!H", self._read_exactly(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", self._read_exactly(8))[0]
            mask = self._read_exactly(4) if second & 0x80 else None
            payload = self._read_exactly(length)
            if mask:
                payload = bytes(value ^ mask[index % 4] for index, value in enumerate(payload))
            if opcode == 8:
                raise RuntimeError("Browser closed the DevTools connection.")
            if opcode == 9:
                self._send_frame(payload, opcode=10)
                continue
            if opcode == 1:
                return json.loads(payload.decode("utf-8"))

    def close(self):
        try:
            self._send_frame(b"", opcode=8)
        except OSError:
            pass
        self.socket.close()


class DevTools:
    def __init__(self, websocket_url, timeout):
        self.websocket = WebSocket(websocket_url, timeout)
        self.next_id = 1

    def call(self, method, params=None):
        message_id = self.next_id
        self.next_id += 1
        self.websocket.send_json({
            "id": message_id,
            "method": method,
            "params": params or {},
        })
        while True:
            response = self.websocket.receive_json()
            if response.get("id") == message_id:
                if "error" in response:
                    raise RuntimeError(response["error"].get("message", "DevTools command failed."))
                return response.get("result", {})

    def close(self):
        self.websocket.close()


def find_browser():
    configured = os.environ.get("TEST_BROWSER")
    if configured:
        configured_path = shutil.which(configured) or configured
        if os.path.isfile(configured_path) and os.access(configured_path, os.X_OK):
            return configured_path
        raise RuntimeError(f"Configured browser is not executable: {configured}")

    for name in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"):
        path = shutil.which(name)
        if path:
            return path

    for path in (
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ):
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path

    raise RuntimeError("Chrome or Chromium was not found; set TEST_BROWSER to its executable.")


def wait_for_devtools(profile_dir, process, deadline, browser_log):
    active_port_file = Path(profile_dir, "DevToolsActivePort")
    while time.monotonic() < deadline:
        if process.poll() is not None:
            details = read_log(browser_log)
            raise RuntimeError(
                f"Browser exited before DevTools became ready with code {process.returncode}."
                + (f"\n{details}" if details else "")
            )
        if active_port_file.is_file():
            lines = active_port_file.read_text(encoding="utf-8").splitlines()
            if lines:
                return int(lines[0])
        time.sleep(0.05)
    raise TimeoutError("Browser did not become ready in time.")


def find_page_websocket(port, page_url, deadline):
    endpoint = f"http://127.0.0.1:{port}/json/list"
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(endpoint, timeout=2) as response:
                targets = json.load(response)
            pages = [target for target in targets if target.get("type") == "page"]
            matching = [target for target in pages if target.get("url", "").startswith(page_url)]
            target = matching[0] if matching else (pages[0] if pages else None)
            if target and target.get("webSocketDebuggerUrl"):
                return target["webSocketDebuggerUrl"]
        except (OSError, ValueError):
            pass
        time.sleep(0.05)
    raise TimeoutError("Browser test page did not become available in time.")


def read_result(devtools, deadline):
    while time.monotonic() < deadline:
        evaluated = devtools.call("Runtime.evaluate", {
            "expression": FINAL_RESULT_EXPRESSION,
            "returnByValue": True,
        })
        value = evaluated.get("result", {}).get("value")
        if value:
            result = json.loads(value)
            if result.get("complete") == "true" and result.get("status") in ("passed", "failed"):
                return result
        time.sleep(0.05)
    raise TimeoutError("Test page did not reach a final status in time.")


def stop_process(process):
    if process is None or process.poll() is not None:
        return
    try:
        os.killpg(process.pid, signal.SIGTERM)
        process.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass


def read_log(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")[-4000:].strip()
    except OSError:
        return ""


def output(payload):
    print(json.dumps(payload, ensure_ascii=False))


def interrupt(_signal_number, _frame):
    raise KeyboardInterrupt


def main():
    signal.signal(signal.SIGTERM, interrupt)
    if hasattr(signal, "SIGHUP"):
        signal.signal(signal.SIGHUP, interrupt)

    if len(sys.argv) != 2:
        output({
            "passed": False,
            "status": "infrastructure-error",
            "summary": "Project directory argument is required.",
            "failedTests": [],
            "infrastructureError": "Project directory argument is required.",
        })
        return 2

    runner_dir = Path(__file__).resolve().parent
    project_dir = Path(sys.argv[1]).resolve()
    timeout_seconds = float(os.environ.get("TEST_TIMEOUT_SECONDS", "60"))
    page_query = os.environ.get("TEST_PAGE_QUERY", "")
    deadline = time.monotonic() + timeout_seconds

    server = None
    server_thread = None
    browser_process = None
    devtools = None

    with tempfile.TemporaryDirectory(prefix="browser-extension-tests-") as temporary:
        browser_log = Path(temporary, "browser.log")
        profile_dir = Path(temporary, "browser-profile")

        try:
            browser = find_browser()
            if not Path(project_dir, "tests", "index.html").is_file():
                raise RuntimeError(f"Test page was not found: {project_dir}/tests/index.html")

            handler = functools.partial(
                ProjectHandler,
                project_dir=project_dir,
                runner_script=Path(runner_dir, "test-runner.js"),
            )
            server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
            server_thread = threading.Thread(target=server.serve_forever, daemon=True)
            server_thread.start()

            page_url = (
                f"http://127.0.0.1:{server.server_address[1]}/tests/index.html"
                f"{page_query}"
            )
            command = [
                browser,
                "--headless=new",
                "--disable-gpu",
                "--disable-background-networking",
                "--disable-component-update",
                "--disable-default-apps",
                "--disable-dev-shm-usage",
                "--no-default-browser-check",
                "--no-first-run",
                "--remote-allow-origins=*",
                "--remote-debugging-port=0",
                f"--user-data-dir={profile_dir}",
                page_url,
            ]

            with browser_log.open("wb") as errors:
                browser_process = subprocess.Popen(
                    command,
                    stdout=subprocess.DEVNULL,
                    stderr=errors,
                    start_new_session=True,
                )

            devtools_port = wait_for_devtools(
                profile_dir, browser_process, deadline, browser_log
            )
            websocket_url = find_page_websocket(devtools_port, page_url, deadline)
            devtools = DevTools(websocket_url, max(1, deadline - time.monotonic()))
            result = read_result(devtools, deadline)

            infrastructure_error = result.get("infrastructureError")
            passed = result["status"] == "passed" and not infrastructure_error
            output({
                "passed": passed,
                "status": "infrastructure-error" if infrastructure_error else result["status"],
                "summary": result.get("summary", ""),
                "failedTests": result.get("failedTests", []),
                "infrastructureError": infrastructure_error,
                "browser": browser,
            })
            if infrastructure_error:
                return 2
            return 0 if passed else 1

        except KeyboardInterrupt:
            output({
                "passed": False,
                "status": "infrastructure-error",
                "summary": "Test execution was interrupted.",
                "failedTests": [],
                "infrastructureError": "Test execution was interrupted.",
            })
            return 130
        except Exception as error:
            details = read_log(browser_log)
            message = str(error)
            if details:
                message = f"{message}\n{details}"
            output({
                "passed": False,
                "status": "infrastructure-error",
                "summary": str(error),
                "failedTests": [],
                "infrastructureError": message,
            })
            return 2
        finally:
            if devtools is not None:
                try:
                    devtools.close()
                except OSError:
                    pass
            stop_process(browser_process)
            if server is not None:
                server.shutdown()
                server.server_close()
            if server_thread is not None:
                server_thread.join(timeout=5)


if __name__ == "__main__":
    sys.exit(main())
