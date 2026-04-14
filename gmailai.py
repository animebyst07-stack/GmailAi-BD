#!/usr/bin/env python3
"""
GmailAi BD — точка входа.
Запуск: python gmailai.py
Termux: pkg install python && pip install -r requirements.txt && python gmailai.py
"""
import os
from app import create_app

app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    host = os.environ.get("HOST", "0.0.0.0")
    debug = os.environ.get("DEBUG", "false").lower() == "true"
    print(f"\n{'='*50}")
    print(f"  GmailAi BD — запущен")
    print(f"  Открой в браузере: http://localhost:{port}")
    print(f"{'='*50}\n")
    app.run(host=host, port=port, debug=debug)
