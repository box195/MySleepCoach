import contextlib
import hmac
import json
import os
import secrets
import threading
from datetime import datetime, timezone
from functools import wraps
from pathlib import Path

from flask import Flask, abort, jsonify, redirect, request, send_from_directory, session, url_for

from sleep_coach import run

BASE_DIR = Path(__file__).resolve().parent
DOCS_DIR = BASE_DIR / "docs"
DATA_DIR = BASE_DIR / "private_data"
DATA_PATH = DATA_DIR / "data.json"

app = Flask(__name__, static_folder=None)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "")
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=os.environ.get("SESSION_COOKIE_SECURE", "1") != "0",
)

_sync_lock = threading.Lock()
_sync_state = {
    "state": "idle",
    "started_at": None,
    "finished_at": None,
    "message": "",
}


def _require_server_config():
    missing = [name for name in ("APP_PASSWORD", "FLASK_SECRET_KEY") if not os.environ.get(name)]
    if missing:
        raise RuntimeError("Missing required server environment variables: " + ", ".join(missing))


def login_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        if not session.get("authenticated"):
            if request.path.startswith("/api/"):
                return jsonify({"error": "authentication_required"}), 401
            return redirect(url_for("login", next=request.path))
        return fn(*args, **kwargs)
    return wrapper


@app.before_request
def validate_runtime_config():
    _require_server_config()


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        supplied = request.form.get("password", "")
        expected = os.environ.get("APP_PASSWORD", "")
        if expected and hmac.compare_digest(supplied, expected):
            session.clear()
            session["authenticated"] = True
            session["csrf_token"] = secrets.token_urlsafe(32)
            target = request.args.get("next", "/")
            if not target.startswith("/") or target.startswith("//"):
                target = "/"
            return redirect(target)
        error = "비밀번호가 올바르지 않습니다."
    else:
        error = ""
    return f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MySleepCoach 로그인</title><style>body{{font-family:system-ui;background:#060911;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0}}form{{width:min(360px,85vw);padding:28px;background:#111827;border-radius:18px}}input,button{{box-sizing:border-box;width:100%;padding:14px;margin-top:12px;border-radius:10px;border:1px solid #374151}}button{{background:#10b981;color:#05130e;font-weight:800;cursor:pointer}}.err{{color:#fca5a5;min-height:1.4em}}</style></head><body><form method="post"><h1>MySleepCoach</h1><p>개인 대시보드 로그인</p><div class="err">{error}</div><input name="password" type="password" autocomplete="current-password" required autofocus><button type="submit">로그인</button></form></body></html>'''


@app.post("/logout")
@login_required
def logout():
    session.clear()
    return redirect(url_for("login"))


@app.get("/")
@login_required
def index():
    return send_from_directory(DOCS_DIR, "index.html")


@app.get("/assets/<path:name>")
@login_required
def asset(name):
    if name not in {"app.js", "style.css"}:
        abort(404)
    return send_from_directory(DOCS_DIR, name)


@app.get("/api/session")
@login_required
def api_session():
    return jsonify({"authenticated": True, "csrf_token": session["csrf_token"]})


@app.get("/api/data")
@login_required
def api_data():
    if not DATA_PATH.exists():
        return jsonify({"error": "data_not_ready"}), 404
    return send_from_directory(DATA_DIR, "data.json", max_age=0)


def _sync_worker():
    global _sync_state
    try:
        with open(os.devnull, "w", encoding="utf-8") as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink):
            run(mode="morning", send_notification=False)
        state = "success"
        message = "최신 데이터로 동기화했습니다."
    except Exception:
        app.logger.error("Sleep data sync failed")
        state = "error"
        message = "동기화에 실패했습니다. 서버 로그를 확인하세요."
    finally:
        with _sync_lock:
            _sync_state = {
                **_sync_state,
                "state": state,
                "finished_at": datetime.now(timezone.utc).isoformat(),
                "message": message,
            }


@app.post("/api/sync")
@login_required
def api_sync():
    global _sync_state
    if not hmac.compare_digest(request.headers.get("X-CSRF-Token", ""), session.get("csrf_token", "")):
        return jsonify({"error": "invalid_csrf"}), 403
    with _sync_lock:
        if _sync_state["state"] == "running":
            return jsonify(_sync_state), 409
        _sync_state = {
            "state": "running",
            "started_at": datetime.now(timezone.utc).isoformat(),
            "finished_at": None,
            "message": "데이터 동기화 중...",
        }
        threading.Thread(target=_sync_worker, daemon=True).start()
        return jsonify(_sync_state), 202


@app.get("/api/sync/status")
@login_required
def api_sync_status():
    with _sync_lock:
        return jsonify(dict(_sync_state))


if __name__ == "__main__":
    _require_server_config()
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "8000")), debug=False)
