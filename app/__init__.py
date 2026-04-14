import os
from flask import Flask
from .database import init_db
from .routes import register_routes


def create_app():
    app = Flask(
        __name__,
        template_folder="templates",
        static_folder="static",
    )
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "gmailai-bd-secret-2026")

    db_path = os.environ.get("DB_PATH", "gmailai.db")
    app.config["DB_PATH"] = db_path

    init_db(db_path)
    register_routes(app)

    return app
