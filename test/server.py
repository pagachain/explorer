#!/usr/bin/env python3
"""Servidor local de prueba: estáticos + SPA fallback + proxy /rpc."""
import json
import os
import sys
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "public"))
RPC = "https://pagachain.com"
HOST = os.environ.get("EXPLORER_HOST", "127.0.0.1")
PORT = int(os.environ.get("EXPLORER_PORT", "8765"))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self):
        if self.path == "/rpc" or self.path.startswith("/rpc"):
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            return
        self.send_error(404)

    def do_POST(self):
        if self.path != "/rpc" and not self.path.startswith("/rpc"):
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b""
        req = urllib.request.Request(
            RPC,
            data=body,
            method="POST",
            headers={
                "Content-Type": self.headers.get("Content-Type", "application/json"),
                "Accept": "application/json",
                "User-Agent": self.headers.get("User-Agent") or "PagachainExplorerTest/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            msg = json.dumps({"error": str(e)}).encode()
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        path = self.translate_path(self.path)
        # SPA fallback for EIP-3091 routes when the file does not exist
        if not os.path.exists(path) or (os.path.isdir(path) and not os.path.exists(os.path.join(path, "index.html"))):
            if self.path.startswith(("/block/", "/tx/", "/address/", "/token/")):
                self.path = "/index.html"
        return super().send_head()


if __name__ == "__main__":
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"http://{HOST}:{PORT}", flush=True)
    httpd.serve_forever()
