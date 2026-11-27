#!/usr/bin/env python3
"""API auth check: calls every operation of an OpenAPI 3 document without credentials and reports the ones that do not
answer 401/403, i.e. the endpoints anyone can reach without logging in.

Framework-agnostic: it only needs the OpenAPI JSON (file or URL) and the base URL of a running deployment. Standard
library only, Python 3.9+.

Requests carry no credentials, use ids that should not exist (0, the nil UUID) and an empty JSON body: a protected
endpoint rejects them before running any logic. An endpoint that is really open may still act on them (a webhook, for
instance), so list the endpoints that are public on purpose in the allowlist: they are reported but never called.

usage: api_auth_check.py --spec openapi.json --base-url https://app.example.com [--allowlist FILE] [--methods GET]
       api_auth_check.py --self-test
"""

import argparse
import json
import os
import re
import sys
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

HTTP_METHODS = ("get", "post", "put", "patch", "delete")
BODY_METHODS = {"POST", "PUT", "PATCH"}
NIL_UUID = "00000000-0000-0000-0000-000000000000"
USER_AGENT = "api-auth-check"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Report a redirect (e.g. to a login page) as such, instead of following it to a 200."""

    def redirect_request(self, *args, **kwargs):
        return None


OPENER = urllib.request.build_opener(NoRedirect)


def load_json(source):
    if source.startswith(("http://", "https://")):
        with OPENER.open(urllib.request.Request(source, headers={"User-Agent": USER_AGENT}), timeout=30) as resp:
            return json.load(resp)
    with open(source) as f:
        return json.load(f)


def load_allowlist(path):
    """Lines 'METHOD /path  # reason'; blank lines and comment lines are ignored."""
    allowed = {}
    if path:
        with open(path) as f:
            for raw in f:
                line, _, reason = raw.partition("#")
                if line.strip():
                    method, route = line.split()
                    allowed[(method.upper(), route)] = reason.strip()
    return allowed


def resolve_ref(spec, obj):
    while "$ref" in obj:  # '#/components/parameters/name'
        node = spec
        for part in obj["$ref"].lstrip("#/").split("/"):
            node = node[part]
        obj = node
    return obj


def sample_value(param, overrides):
    if param["name"] in overrides:
        return overrides[param["name"]]
    schema = param.get("schema", {})
    if schema.get("format") == "uuid":
        return NIL_UUID
    if schema.get("enum"):
        return str(schema["enum"][0])
    return "0"  # an id that does not exist, and it fits most route constraints (int, slug, generic string)


def operations(spec, methods, overrides):
    """(METHOD, path as in the spec, URL with sample path parameters)"""
    for path, item in spec.get("paths", {}).items():
        shared = item.get("parameters", [])
        for method in HTTP_METHODS:
            if method not in item or method.upper() not in methods:
                continue
            url = path
            for param in (resolve_ref(spec, p) for p in shared + item[method].get("parameters", [])):
                if param.get("in") == "path":
                    url = url.replace(
                        "{" + param["name"] + "}", urllib.parse.quote(sample_value(param, overrides), safe="")
                    )
            yield method.upper(), path, re.sub(r"\{[^}/]+\}", "0", url)  # path parameters the spec does not declare


def probe(base_url, method, url, timeout):
    data = b"{}" if method in BODY_METHODS else None
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    if data:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(base_url.rstrip("/") + url, data=data, method=method, headers=headers)
    try:
        with OPENER.open(request, timeout=timeout) as resp:
            return resp.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError) as e:
        return f"error: {getattr(e, 'reason', e)}"


def report(called, exposed, errors, allowed, stale):
    if exposed or errors:
        head = f"### ❌ API auth check: {len(exposed)} of {called} operations answer without authentication"
        head += f", {len(errors)} requests failed" if errors else ""
    else:
        head = f"### ✅ API auth check: all {called} operations require authentication"
    lines = [head]
    if allowed:
        lines += ["", "Public on purpose (not called): " + ", ".join(f"`{m} {p}`" for (m, p), _ in allowed)]
    if stale:
        lines += ["", "Allowlist entries not in the spec, to remove: " + ", ".join(f"`{m} {p}`" for m, p in stale)]
    if exposed or errors:
        hint = " (path parameters may not match the route: set them with --param)"
        lines += ["", "| Method | Path | Response |", "| --- | --- | --- |"]
        lines += [f"| {m} | `{p}` | {s}{hint if s == 404 else ''} |" for m, p, s in exposed]
        lines += [f"| {m} | `{p}` | {e} |" for m, p, e in errors]
    text = "\n".join(lines) + "\n"
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(text)
    if os.environ.get("GITHUB_ACTIONS"):
        for m, p, s in exposed:
            print(f"::error::{m} {p} answers {s} without authentication")


def run(args):
    spec = load_json(args.spec)
    allowlist = load_allowlist(args.allowlist)
    methods = {m.strip().upper() for m in args.methods.split(",")}
    reject = {int(s) for s in args.reject_status.split(",")}
    overrides = dict(p.split("=", 1) for p in args.param)
    ops = list(operations(spec, methods, overrides))

    exposed, errors, allowed = [], [], []
    for method, path, url in ops:
        if (method, path) in allowlist:
            allowed.append(((method, path), allowlist[method, path]))
        elif args.dry_run:
            print(method, url)
        else:
            status = probe(args.base_url, method, url, args.timeout)
            if isinstance(status, str):
                errors.append((method, path, status))
            elif status not in reject:
                exposed.append((method, path, status))
    if args.dry_run:
        return 0
    stale = sorted(k for k in allowlist if k[0] in methods and k not in {(m, p) for m, p, _ in ops})
    report(len(ops) - len(allowed), exposed, errors, allowed, stale)
    return 1 if exposed or errors else 0


def self_test():
    """Fake API: a protected route, an open one, a redirect to login, an allowlisted webhook that must not be called."""
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def _answer(self):
            calls.append((self.command, self.path))
            code = 401 if self.path.startswith("/protected/") else 302 if self.path == "/redirect" else 200
            self.send_response(code)
            self.send_header("Location", "/login")
            self.end_headers()

        do_GET = do_POST = do_DELETE = _answer

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    spec = {
        "paths": {
            "/protected/{id}": {
                "get": {"parameters": [{"name": "id", "in": "path", "schema": {"type": "integer"}}]},
                "delete": {},
            },
            "/open": {"post": {}},
            "/redirect": {"get": {}},
            "/webhook": {"post": {}},
        }
    }
    with tempfile.TemporaryDirectory() as tmp:
        spec_path, allow_path = os.path.join(tmp, "spec.json"), os.path.join(tmp, "allow.txt")
        json.dump(spec, open(spec_path, "w"))
        open(allow_path, "w").write("# public on purpose\nPOST /webhook  # called by a third party\n")
        args = argparse.Namespace(
            spec=spec_path,
            base_url=f"http://127.0.0.1:{server.server_port}",
            allowlist=allow_path,
            methods="GET,POST,PUT,PATCH,DELETE",
            reject_status="401,403",
            param=[],
            timeout=5,
            dry_run=False,
        )
        os.environ.pop("GITHUB_STEP_SUMMARY", None)
        assert run(args) == 1
    server.shutdown()
    assert ("GET", "/protected/0") in calls and ("DELETE", "/protected/0") in calls, calls
    assert ("POST", "/open") in calls and ("GET", "/redirect") in calls, calls
    assert not any(path == "/webhook" for _, path in calls), "allowlisted endpoint was called"
    print("self-test ok")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--spec", help="OpenAPI 3 JSON document: file path or URL")
    parser.add_argument("--base-url", help="URL the spec paths are appended to, e.g. https://app.example.com")
    parser.add_argument("--allowlist", help="file of 'METHOD /path  # reason' lines: public on purpose, never called")
    parser.add_argument("--methods", default="GET,POST,PUT,PATCH,DELETE", help="methods to call (default: all)")
    parser.add_argument("--reject-status", default="401,403", help="statuses meaning 'authentication required'")
    parser.add_argument("--param", action="append", default=[], metavar="NAME=VALUE", help="value for a path parameter")
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--dry-run", action="store_true", help="print the requests without sending them")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        return self_test()
    if not args.spec or not args.base_url:
        parser.error("--spec and --base-url are required")
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
