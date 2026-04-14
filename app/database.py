import sqlite3
import json
from datetime import datetime
from flask import g, current_app


DEFAULT_SYSTEM_PROMPT = """Ты — умный агент по управлению базой данных Gmail-аккаунтов. 
Твоя задача — анализировать сырой текст (из магазинов аккаунтов, логов, заметок) и структурировать данные.

ВСЕГДА отвечай ТОЛЬКО в формате JSON (без markdown блоков, без ```json```, просто чистый JSON):
{
  "message": "Понятное объяснение что ты сделал и нашёл",
  "actions": [
    {
      "type": "ADD_ACCOUNT",
      "data": {
        "email": "user@gmail.com",
        "password": "Pass123",
        "status": "active",
        "two_factor_code": null,
        "recovery_email": null,
        "recovery_phone": null,
        "notes": null,
        "tags": []
      }
    }
  ]
}

Типы действий:
- ADD_ACCOUNT: добавить аккаунт (data = поля аккаунта)
- UPDATE_ACCOUNT: обновить аккаунт (нужен id, data = обновляемые поля)
- DELETE_ACCOUNT: удалить аккаунт (нужен id)
- INFO: просто ответить без изменений (actions пустой)

Статусы аккаунтов:
- active: ok, ок, active, рабочий, работает, good, норм
- sold: продан, sold, продали, куплен
- appeal: аппеляция, appeal, апелляция, заблок, временно
- banned: бан, banned, забанен, dead, мёртвый
- unknown: непонятно

Распознавай email и пароль в разных форматах:
- email:password → user@gmail.com:Pass123
- email|password → user@gmail.com|Pass123
- email;password → user@gmail.com;Pass123
- login:password (добавь @gmail.com если нет домена)
- Если формат "Name83_9" и это похоже на email+пароль — раздели логически

Если нет явных аккаунтов — отвечай через тип INFO.
Никогда не выдумывай данные. Только то, что явно есть в тексте."""


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(
            current_app.config["DB_PATH"],
            detect_types=sqlite3.PARSE_DECLTYPES,
        )
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


def close_db(e=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            email           TEXT NOT NULL,
            password        TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'active',
            two_factor_code TEXT,
            recovery_email  TEXT,
            recovery_phone  TEXT,
            notes           TEXT,
            tags            TEXT NOT NULL DEFAULT '[]',
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS chat_history (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            role            TEXT NOT NULL,
            content         TEXT NOT NULL,
            actions_count   INTEGER NOT NULL DEFAULT 0,
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS settings (
            id              INTEGER PRIMARY KEY DEFAULT 1,
            api_key         TEXT NOT NULL DEFAULT '',
            api_endpoint    TEXT NOT NULL DEFAULT 'https://api.openai.com/v1/chat/completions',
            ai_model        TEXT NOT NULL DEFAULT 'gpt-4o-mini',
            system_prompt   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activity_log (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            type            TEXT NOT NULL,
            description     TEXT NOT NULL,
            created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
    """)

    row = conn.execute("SELECT id FROM settings WHERE id = 1").fetchone()
    if not row:
        conn.execute(
            "INSERT INTO settings (id, api_key, api_endpoint, ai_model, system_prompt) VALUES (1, '', 'https://api.openai.com/v1/chat/completions', 'gpt-4o-mini', ?)",
            (DEFAULT_SYSTEM_PROMPT,)
        )

    conn.commit()
    conn.close()


def row_to_dict(row):
    if row is None:
        return None
    d = dict(row)
    if "tags" in d and isinstance(d["tags"], str):
        try:
            d["tags"] = json.loads(d["tags"])
        except Exception:
            d["tags"] = []
    return d


def log_activity(db, action_type: str, description: str):
    db.execute(
        "INSERT INTO activity_log (type, description) VALUES (?, ?)",
        (action_type, description)
    )
