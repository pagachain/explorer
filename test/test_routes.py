#!/usr/bin/env python3
"""Abre cada ruta EIP-3091 contra el RPC real y comprueba que hay datos de verdad."""
import os
import sys
import time
import subprocess
import urllib.request
import json

from playwright.sync_api import sync_playwright, expect

PAGA = "0xbfE1D53cb99f5873E3d62EfaAc4F7d0cC2f94b9A"
ADMIN = "0xF34F8d4eF363858cA5979eA41DF1b3580bb765ED"
TX = "0x4fb38ee2b9de9a8116e15eec59d4b5d956725652f9cb4d3271df2f962ed5904c"
BLOCK = "262023"
RECV = "0x6199143833cbc63039a62d6cbb3ceeaea2bdd72c"
PORT = int(os.environ.get("EXPLORER_PORT", "8765"))
BASE = f"http://127.0.0.1:{PORT}"
SHOTS = os.path.join(os.path.dirname(__file__), "shots")
os.makedirs(SHOTS, exist_ok=True)


def rpc(method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(
        "https://pagachain.com",
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 PagachainExplorerTest/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode())
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["result"]


def wait_ready(page, text=None, timeout=45_000):
    page.wait_for_selector("main#app", timeout=timeout)
    page.wait_for_function(
        """() => {
          const el = document.querySelector('main#app');
          if (!el) return false;
          const t = el.innerText || '';
          return t.length > 40 && !t.includes('Cargando…');
        }""",
        timeout=timeout,
    )
    body = page.locator("main#app").inner_text()
    if "No se pudo cargar" in body:
        raise AssertionError("ruta con error: " + body[:400])
    if text:
        if isinstance(text, str):
            text = [text]
        for t in text:
            if t.lower() not in body.lower() and t.lower() not in page.content().lower():
                # also allow formatted numbers / checksum variants
                raise AssertionError(f"no aparece {t!r} en la página:\n{body[:800]}")
    return body


def main():
    latest = int(rpc("eth_blockNumber", []), 16)
    print("latest block", latest)

    server = subprocess.Popen(
        [sys.executable, os.path.join(os.path.dirname(__file__), "server.py")],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    try:
        for _ in range(30):
            try:
                urllib.request.urlopen(BASE, timeout=1).read()
                break
            except Exception:
                time.sleep(0.2)
        else:
            raise SystemExit("el servidor de prueba no arrancó")

        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))

            # Home
            page.goto(BASE + "/", wait_until="networkidle")
            body = wait_ready(page, [str(latest)[-3:], "3690369", "Últimos bloques"])
            print("HOME ok, height visible, len", len(body))
            page.screenshot(path=os.path.join(SHOTS, "home.png"), full_page=True)

            # Block with a known PAGA transfer
            page.goto(BASE + "/block/" + BLOCK, wait_until="networkidle")
            body = wait_ready(page, ["262.023", "Transacciones"])
            print("BLOCK ok", body.split("\n")[0:3])
            page.screenshot(path=os.path.join(SHOTS, "block.png"), full_page=True)

            # Tx
            page.goto(BASE + "/tx/" + TX, wait_until="networkidle")
            body = wait_ready(page, ["Correcta", "500", "PAGA"])
            print("TX ok, has PAGA 500")
            page.screenshot(path=os.path.join(SHOTS, "tx.png"), full_page=True)

            # Address (admin treasury)
            page.goto(BASE + "/address/" + ADMIN, wait_until="networkidle")
            body = wait_ready(page, ["CENT", "PAGA", "0xF34F"])
            print("ADDRESS ok")
            page.screenshot(path=os.path.join(SHOTS, "address.png"), full_page=True)

            # Token
            page.goto(BASE + "/token/" + PAGA, wait_until="networkidle")
            body = wait_ready(page, ["Paga", "PAGA", "6", "1.873"])
            print("TOKEN ok, supply visible")
            page.screenshot(path=os.path.join(SHOTS, "token.png"), full_page=True)

            # Receiver of 500 PAGA
            page.goto(BASE + "/address/" + RECV, wait_until="networkidle")
            body = wait_ready(page, ["500", "PAGA"])
            print("ADDRESS recv ok, 500 PAGA history")
            page.screenshot(path=os.path.join(SHOTS, "address-recv.png"), full_page=True)

            # Search box: go to block 0 via UI? skip if flaky
            if errors:
                print("pageerrors:", errors)
                raise SystemExit("errores JS en el navegador")
            browser.close()
        print("ALL ROUTES OK")
    finally:
        server.terminate()
        try:
            server.wait(timeout=3)
        except Exception:
            server.kill()


if __name__ == "__main__":
    main()
