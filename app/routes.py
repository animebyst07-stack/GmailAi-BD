import json
from flask import Blueprint, jsonify, request, render_template, abort
from .database import get_db, close_db, row_to_dict, log_activity
from .agent import process_message

main = Blueprint("main", __name__)


def register_routes(app):
    app.teardown_appcontext(close_db)
    app.register_blueprint(main)


@main.route("/")
def index():
    return render_template("index.html")


@main.route("/api/accounts", methods=["GET"])
def list_accounts():
    db = get_db()
    status = request.args.get("status", "").strip()
    search = request.args.get("search", "").strip()
    tag = request.args.get("tag", "").strip()
    limit = int(request.args.get("limit", 100))
    offset = int(request.args.get("offset", 0))

    query = "SELECT * FROM accounts WHERE 1=1"
    params = []

    if status:
        query += " AND status = ?"
        params.append(status)

    if search:
        query += " AND (email LIKE ? OR password LIKE ? OR notes LIKE ?)"
        like = f"%{search}%"
        params += [like, like, like]

    if tag:
        query += " AND tags LIKE ?"
        params.append(f'%"{tag}"%')

    query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
    params += [limit, offset]

    rows = db.execute(query, params).fetchall()
    total_query = "SELECT COUNT(*) FROM accounts WHERE 1=1"
    total_params = params[:-2]
    total = db.execute(total_query, total_params).fetchone()[0]

    return jsonify({
        "accounts": [row_to_dict(r) for r in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    })


@main.route("/api/accounts", methods=["POST"])
def create_account():
    db = get_db()
    data = request.get_json() or {}

    email = (data.get("email") or "").strip()
    password = (data.get("password") or "").strip()

    if not email or not password:
        return jsonify({"error": "email и password обязательны"}), 400

    tags = data.get("tags", [])
    if isinstance(tags, str):
        try:
            tags = json.loads(tags)
        except Exception:
            tags = [t.strip() for t in tags.split(",") if t.strip()]

    cursor = db.execute(
        """INSERT INTO accounts
           (email, password, status, two_factor_code, recovery_email, recovery_phone, notes, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            email,
            password,
            data.get("status", "active"),
            data.get("two_factor_code"),
            data.get("recovery_email"),
            data.get("recovery_phone"),
            data.get("notes"),
            json.dumps(tags, ensure_ascii=False),
        )
    )
    log_activity(db, "ADD", f"Добавлен вручную: {email}")
    db.commit()

    row = db.execute("SELECT * FROM accounts WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@main.route("/api/accounts/bulk", methods=["POST"])
def create_accounts_bulk():
    db = get_db()
    data = request.get_json() or {}
    accounts_data = data.get("accounts", [])
    created = []

    for acc in accounts_data:
        email = (acc.get("email") or "").strip()
        password = (acc.get("password") or "").strip()
        if not email or not password:
            continue
        tags = acc.get("tags", [])
        if isinstance(tags, str):
            try:
                tags = json.loads(tags)
            except Exception:
                tags = []
        cursor = db.execute(
            """INSERT INTO accounts
               (email, password, status, two_factor_code, recovery_email, recovery_phone, notes, tags)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                email, password,
                acc.get("status", "active"),
                acc.get("two_factor_code"),
                acc.get("recovery_email"),
                acc.get("recovery_phone"),
                acc.get("notes"),
                json.dumps(tags, ensure_ascii=False),
            )
        )
        created.append(cursor.lastrowid)
        log_activity(db, "ADD", f"Bulk добавлен: {email}")

    db.commit()
    rows = db.execute(
        f"SELECT * FROM accounts WHERE id IN ({','.join('?' * len(created))})",
        created
    ).fetchall() if created else []

    return jsonify({"created": len(created), "accounts": [row_to_dict(r) for r in rows]}), 201


@main.route("/api/accounts/<int:account_id>", methods=["GET"])
def get_account(account_id):
    db = get_db()
    row = db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if not row:
        return jsonify({"error": "Аккаунт не найден"}), 404
    return jsonify(row_to_dict(row))


@main.route("/api/accounts/<int:account_id>", methods=["PATCH"])
def update_account(account_id):
    db = get_db()
    row = db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if not row:
        return jsonify({"error": "Аккаунт не найден"}), 404

    data = request.get_json() or {}
    allowed = ["email", "password", "status", "two_factor_code",
               "recovery_email", "recovery_phone", "notes", "tags"]

    fields = []
    values = []
    for key in allowed:
        if key in data:
            val = data[key]
            if key == "tags" and isinstance(val, list):
                val = json.dumps(val, ensure_ascii=False)
            fields.append(f"{key} = ?")
            values.append(val)

    if not fields:
        return jsonify(row_to_dict(row))

    fields.append("updated_at = CURRENT_TIMESTAMP")
    values.append(account_id)

    db.execute(f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?", values)
    log_activity(db, "UPDATE", f"Обновлён аккаунт #{account_id}")
    db.commit()

    updated = db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)).fetchone()
    return jsonify(row_to_dict(updated))


@main.route("/api/accounts/<int:account_id>", methods=["DELETE"])
def delete_account(account_id):
    db = get_db()
    row = db.execute("SELECT email FROM accounts WHERE id = ?", (account_id,)).fetchone()
    if not row:
        return jsonify({"error": "Аккаунт не найден"}), 404
    db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    log_activity(db, "DELETE", f"Удалён: {row['email']}")
    db.commit()
    return "", 204


@main.route("/api/accounts/bulk-delete", methods=["POST"])
def delete_accounts_bulk():
    db = get_db()
    data = request.get_json() or {}
    ids = data.get("ids", [])
    if not ids:
        return "", 204
    db.execute(
        f"DELETE FROM accounts WHERE id IN ({','.join('?' * len(ids))})",
        ids
    )
    log_activity(db, "DELETE", f"Bulk удалено: {len(ids)} аккаунтов")
    db.commit()
    return "", 204


@main.route("/api/chat", methods=["POST"])
def chat():
    data = request.get_json() or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "Пустое сообщение"}), 400

    result = process_message(message)
    return jsonify(result)


@main.route("/api/chat/history", methods=["GET"])
def chat_history():
    db = get_db()
    limit = int(request.args.get("limit", 50))
    rows = db.execute(
        "SELECT * FROM chat_history ORDER BY created_at DESC LIMIT ?",
        (limit,)
    ).fetchall()
    return jsonify([dict(r) for r in reversed(rows)])


@main.route("/api/chat/history", methods=["DELETE"])
def clear_chat():
    db = get_db()
    db.execute("DELETE FROM chat_history")
    db.commit()
    return "", 204


@main.route("/api/settings", methods=["GET"])
def get_settings():
    db = get_db()
    row = db.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    d = dict(row) if row else {}
    masked = {**d, "api_key": "***" if d.get("api_key") else ""}
    return jsonify(masked)


@main.route("/api/settings", methods=["PUT"])
def update_settings():
    db = get_db()
    data = request.get_json() or {}
    allowed = ["api_key", "api_endpoint", "ai_model", "system_prompt"]
    fields = []
    values = []
    for key in allowed:
        if key in data:
            fields.append(f"{key} = ?")
            values.append(data[key])
    if fields:
        values.append(1)
        db.execute(f"UPDATE settings SET {', '.join(fields)} WHERE id = ?", values)
        db.commit()
    row = db.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    d = dict(row) if row else {}
    masked = {**d, "api_key": "***" if d.get("api_key") else ""}
    return jsonify(masked)


@main.route("/api/settings/api-key", methods=["GET"])
def get_api_key_raw():
    db = get_db()
    row = db.execute("SELECT api_key FROM settings WHERE id = 1").fetchone()
    return jsonify({"api_key": row["api_key"] if row else ""})


@main.route("/api/dashboard/stats", methods=["GET"])
def dashboard_stats():
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    active = db.execute("SELECT COUNT(*) FROM accounts WHERE status = 'active'").fetchone()[0]
    sold = db.execute("SELECT COUNT(*) FROM accounts WHERE status = 'sold'").fetchone()[0]
    appeal = db.execute("SELECT COUNT(*) FROM accounts WHERE status = 'appeal'").fetchone()[0]
    banned = db.execute("SELECT COUNT(*) FROM accounts WHERE status = 'banned'").fetchone()[0]
    recent = db.execute(
        "SELECT COUNT(*) FROM accounts WHERE created_at >= datetime('now', '-7 days')"
    ).fetchone()[0]

    all_tags = db.execute("SELECT tags FROM accounts WHERE tags != '[]'").fetchall()
    tag_set = set()
    for row in all_tags:
        try:
            tags = json.loads(row["tags"])
            tag_set.update(tags)
        except Exception:
            pass

    return jsonify({
        "total_accounts": total,
        "active_accounts": active,
        "sold_accounts": sold,
        "appeal_accounts": appeal,
        "banned_accounts": banned,
        "recently_added": recent,
        "unique_tags": len(tag_set),
    })


@main.route("/api/dashboard/recent", methods=["GET"])
def recent_activity():
    db = get_db()
    limit = int(request.args.get("limit", 15))
    rows = db.execute(
        "SELECT * FROM activity_log ORDER BY created_at DESC LIMIT ?",
        (limit,)
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@main.route("/api/dashboard/status-breakdown", methods=["GET"])
def status_breakdown():
    db = get_db()
    rows = db.execute(
        "SELECT status, COUNT(*) as count FROM accounts GROUP BY status ORDER BY count DESC"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@main.route("/api/tags", methods=["GET"])
def get_all_tags():
    db = get_db()
    rows = db.execute("SELECT tags FROM accounts WHERE tags != '[]'").fetchall()
    tag_set = set()
    for row in rows:
        try:
            tags = json.loads(row["tags"])
            tag_set.update(tags)
        except Exception:
            pass
    return jsonify(sorted(list(tag_set)))
