import base64
import http.server
import json
import os
import pathlib
import socket
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request


repo = pathlib.Path(__file__).resolve().parent.parent
binary = pathlib.Path(os.environ["CADDY_BIN"]).resolve()
dist = pathlib.Path(os.environ["DIST_DIR"]).resolve()
requests = []
challenge = base64.b64encode(json.dumps({"x402Version": 2, "accepts": []}).encode()).decode()
receipt = base64.b64encode(json.dumps({"success": True, "network": "eip155:196", "transaction": "synthetic-fixture"}).encode()).decode()


class Fixture(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        requests.append({"headers": dict(self.headers), "body": body.decode()})
        paid = self.headers.get("payment-signature") == "synthetic-fixture"
        data = b'{"opportunities":[],"synthetic":true}' if paid else b"{}"
        self.send_response(200 if paid else 402)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("PAYMENT-RESPONSE" if paid else "PAYMENT-REQUIRED", receipt if paid else challenge)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"error":{"code":"NOT_FOUND"}}')

    def log_message(self, *_args):
        pass


def port():
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


api = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
thread = threading.Thread(target=api.serve_forever, daemon=True)
thread.start()
webport, aliasport, healthport = port(), port(), port()
env = os.environ.copy()
env.update({
    "SITE_ADDRESS": f"http://127.0.0.1:{webport}",
    "WWW_SITE_ADDRESS": f"http://127.0.0.1:{aliasport}",
    "CANONICAL_ORIGIN": f"http://127.0.0.1:{webport}",
})
checks = []
process = None


def check(path, expected=200, method="GET", headers=None, body=None, mime=None):
    request = urllib.request.Request(
        f"http://127.0.0.1:{webport}{path}", headers=headers or {}, data=body, method=method,
    )
    try:
        response = urllib.request.urlopen(request, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        data = response.read()
        assert response.status == expected, (path, method, response.status, data[:150])
        if mime:
            assert response.headers.get("Content-Type", "").startswith(mime), (path, response.headers.get("Content-Type"))
        if method == "HEAD":
            assert not data, (path, "HEAD returned a body")
        checks.append({"path": path, "method": method, "status": response.status, "mime": response.headers.get("Content-Type")})
        return response.headers, data


try:
    with tempfile.TemporaryDirectory(prefix="unmet-discovery-") as directory:
        temp = pathlib.Path(directory)
        config = (repo / "docker/Caddyfile").read_text()
        config = config.replace("root * /srv", "root * " + str(dist))
        config = config.replace("api:8787", f"127.0.0.1:{api.server_port}")
        config = config.replace("http://:8090", f"http://127.0.0.1:{healthport}")
        config_path = temp / "Caddyfile"
        config_path.write_text(config)
        subprocess.run([str(binary), "validate", "--config", str(config_path), "--adapter", "caddyfile"], env=env, check=True, capture_output=True)
        log_path = temp / "caddy.log"
        with log_path.open("w") as log:
            process = subprocess.Popen([str(binary), "run", "--config", str(config_path), "--adapter", "caddyfile"], env=env, stdout=log, stderr=log)
            for _ in range(100):
                if process.poll() is not None:
                    raise RuntimeError(log_path.read_text())
                with socket.socket() as sock:
                    if sock.connect_ex(("127.0.0.1", webport)) == 0:
                        break
                time.sleep(0.05)
            else:
                raise TimeoutError("Caddy did not start")

            for path, mime in [
                ("/robots.txt", "text/plain"), ("/sitemap.xml", "text/xml"),
                ("/.well-known/api-catalog", "application/linkset+json"),
                ("/openapi.json", "application/vnd.oai.openapi+json"),
                ("/api.md", "text/markdown"), ("/payment.md", "text/markdown"),
            ]:
                for method in ["GET", "HEAD"]:
                    check(path, method=method, mime=mime)
            for path in ["/.well-known/unknown-unmet-audit", "/.well-known/oauth-authorization-server", "/.well-known/mcp/server-card.json"]:
                for method in ["GET", "HEAD"]:
                    check(path, expected=404, method=method, headers={"Accept": "text/markdown"})
            headers, _ = check("/", mime="text/html")
            assert 'rel="api-catalog"' in headers.get("Link", "")
            for path in ["/docs", "/market", "/market/1", "/create-demand", "/analytics"]:
                check(path, mime="text/html")

            headers = {"Content-Type": "application/json", "Accept": "text/markdown", "X-Forwarded-For": "198.51.100.44", "CF-Connecting-IP": "198.51.100.45", "X-Request-ID": "untrusted-fixture-id"}
            response, body = check("/v1/opportunities", 402, "POST", headers, b"{}", "application/json")
            assert response["PAYMENT-REQUIRED"] == challenge and body == b"{}" and response["Cache-Control"] == "no-store"
            headers["PAYMENT-SIGNATURE"] = "synthetic-fixture"
            response, body = check("/v1/opportunities", 200, "POST", headers, b"{}", "application/json")
            assert response["PAYMENT-RESPONSE"] == receipt and response["Cache-Control"] == "no-store"
            assert json.loads(body)["synthetic"] and len(requests) == 2
            assert all(item["headers"].get("X-Forwarded-For") == "127.0.0.1" and not item["headers"].get("X-Request-Id") for item in requests), requests
            assert requests[1]["headers"].get("Payment-Signature") == "synthetic-fixture"
            print(json.dumps({"checks": len(checks), "payment_headers_preserved": True, "api_json_preserved": True, "no_proxy_retries": True, "forwarded_ip_replaced": True}, indent=2))
finally:
    if process is not None and process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=8)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
    api.shutdown()
    api.server_close()
    thread.join(timeout=5)
    for listening_port in [webport, aliasport, healthport, api.server_port]:
        with socket.socket() as sock:
            assert sock.connect_ex(("127.0.0.1", listening_port)) != 0, ("port still listening", listening_port)
