import json
import re
import requests
from typing import Optional
from .database import get_db, log_activity


def get_settings():
    db = get_db()
    row = db.execute("SELECT * FROM settings WHERE id = 1").fetchone()
    if row:
        return dict(row)
    return {}


def call_ai_api(messages: list, settings: dict) -> Optional[str]:
    api_key = settings.get("api_key", "").strip()
    api_endpoint = settings.get("api_endpoint", "").strip()
    ai_model = settings.get("ai_model", "gpt-4o-mini").strip()

    if not api_key:
        return json.dumps({
            "message": "API-ключ не настроен. Перейди в Настройки и введи свой ключ.",
            "actions": []
        })

    if not api_endpoint:
        return json.dumps({
            "message": "API endpoint не настроен.",
            "actions": []
        })

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": ai_model,
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": 4096,
    }

    try:
        resp = requests.post(
            api_endpoint,
            headers=headers,
            json=payload,
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()

        content = None
        if "choices" in data and data["choices"]:
            content = data["choices"][0].get("message", {}).get("content", "")
        elif "content" in data:
            content = data["content"]
        elif "message" in data:
            content = data["message"]

        return content
    except requests.exceptions.ConnectionError:
        return json.dumps({
            "message": f"Не удалось подключиться к {api_endpoint}. Проверь endpoint в настройках.",
            "actions": []
        })
    except requests.exceptions.Timeout:
        return json.dumps({
            "message": "Время ожидания ответа от ИИ истекло (60с). Попробуй снова.",
            "actions": []
        })
    except requests.exceptions.HTTPError as e:
        code = e.response.status_code if e.response else "?"
        if code == 401:
            msg = "Неверный API-ключ (401 Unauthorized). Проверь ключ в настройках."
        elif code == 403:
            msg = "Доступ запрещён (403 Forbidden). Проверь права API-ключа."
        elif code == 429:
            msg = "Лимит запросов превышен (429 Too Many Requests). Подожди немного."
        elif code == 404:
            msg = f"Endpoint не найден (404). Проверь URL: {api_endpoint}"
        else:
            msg = f"Ошибка API: HTTP {code}."
        return json.dumps({"message": msg, "actions": []})
    except Exception as e:
        return json.dumps({"message": f"Непредвиденная ошибка: {str(e)}", "actions": []})


def parse_ai_response(raw: Optional[str]) -> dict:
    if not raw:
        return {"message": "Пустой ответ от ИИ.", "actions": []}

    cleaned = raw.strip()

    json_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', cleaned)
    if json_match:
        cleaned = json_match.group(1).strip()

    try:
        parsed = json.loads(cleaned)
        if isinstance(parsed, dict):
            parsed.setdefault("actions", [])
            return parsed
    except json.JSONDecodeError:
        pass

    json_match = re.search(r'\{[\s\S]*\}', cleaned)
    if json_match:
        try:
            parsed = json.loads(json_match.group(0))
            if isinstance(parsed, dict):
                parsed.setdefault("actions", [])
                return parsed
        except json.JSONDecodeError:
            pass

    return {"message": cleaned, "actions": []}


def execute_actions(actions: list) -> dict:
    db = get_db()
    added = 0
    updated = 0
    deleted = 0
    errors = []

    for action in actions:
        action_type = action.get("type", "").upper()

        if action_type == "ADD_ACCOUNT":
            data = action.get("data", {})
            email = (data.get("email") or "").strip()
            password = (data.get("password") or "").strip()

            if not email or not password:
                errors.append(f"Пропущен аккаунт: нет email или пароля")
                continue

            tags = data.get("tags", [])
            if isinstance(tags, str):
                try:
                    tags = json.loads(tags)
                except Exception:
                    tags = [t.strip() for t in tags.split(",") if t.strip()]

            db.execute(
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
            added += 1
            log_activity(db, "ADD", f"Добавлен: {email}")

        elif action_type == "UPDATE_ACCOUNT":
            account_id = action.get("id")
            data = action.get("data", {})

            if not account_id:
                errors.append("UPDATE_ACCOUNT: не указан id")
                continue

            fields = []
            values = []
            allowed = ["email", "password", "status", "two_factor_code",
                       "recovery_email", "recovery_phone", "notes", "tags"]

            for key in allowed:
                if key in data:
                    val = data[key]
                    if key == "tags" and isinstance(val, list):
                        val = json.dumps(val, ensure_ascii=False)
                    fields.append(f"{key} = ?")
                    values.append(val)

            if not fields:
                continue

            fields.append("updated_at = CURRENT_TIMESTAMP")
            values.append(account_id)

            db.execute(
                f"UPDATE accounts SET {', '.join(fields)} WHERE id = ?",
                values
            )
            updated += 1
            log_activity(db, "UPDATE", f"Обновлён аккаунт #{account_id}")

        elif action_type == "DELETE_ACCOUNT":
            account_id = action.get("id")
            if not account_id:
                errors.append("DELETE_ACCOUNT: не указан id")
                continue
            row = db.execute("SELECT email FROM accounts WHERE id = ?", (account_id,)).fetchone()
            db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
            deleted += 1
            email = row["email"] if row else f"#{account_id}"
            log_activity(db, "DELETE", f"Удалён: {email}")

    db.commit()
    return {"added": added, "updated": updated, "deleted": deleted, "errors": errors}


def get_db_context() -> str:
    db = get_db()
    total = db.execute("SELECT COUNT(*) FROM accounts").fetchone()[0]
    by_status = db.execute(
        "SELECT status, COUNT(*) as cnt FROM accounts GROUP BY status"
    ).fetchall()
    status_str = ", ".join(f"{r['status']}: {r['cnt']}" for r in by_status) or "нет данных"
    recent = db.execute(
        "SELECT email, status FROM accounts ORDER BY created_at DESC LIMIT 5"
    ).fetchall()
    recent_str = "; ".join(f"{r['email']} ({r['status']})" for r in recent) or "нет"

    return (
        f"[Контекст БД] Всего аккаунтов: {total}. "
        f"По статусам: {status_str}. "
        f"Последние добавленные: {recent_str}."
    )


def process_message(user_message: str) -> dict:
    db = get_db()
    settings = get_settings()
    system_prompt = settings.get("system_prompt", "")
    db_context = get_db_context()

    history = db.execute(
        "SELECT role, content FROM chat_history ORDER BY created_at DESC LIMIT 6"
    ).fetchall()
    history = list(reversed(history))

    messages = [
        {"role": "system", "content": system_prompt + "\n\n" + db_context}
    ]
    for row in history:
        messages.append({"role": row["role"], "content": row["content"]})

    messages.append({"role": "user", "content": user_message})

    raw_response = call_ai_api(messages, settings)
    parsed = parse_ai_response(raw_response)

    actions = parsed.get("actions", [])
    result = execute_actions(actions)

    db.execute(
        "INSERT INTO chat_history (role, content, actions_count) VALUES (?, ?, ?)",
        ("user", user_message, 0)
    )

    reply_text = parsed.get("message", "")
    if result["errors"]:
        reply_text += "\n\n⚠ Ошибки: " + "; ".join(result["errors"])

    db.execute(
        "INSERT INTO chat_history (role, content, actions_count) VALUES (?, ?, ?)",
        ("assistant", reply_text, len(actions))
    )
    log_activity(db, "PARSE", f"Сообщение обработано, действий: {len(actions)}")
    db.commit()

    return {
        "reply": reply_text,
        "actions": actions,
        "accounts_added": result["added"],
        "accounts_updated": result["updated"],
        "accounts_deleted": result["deleted"],
    }
