import re
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.config import Settings

ROOT = Path(__file__).parents[2]
VALID = {
    "postgres_db": "birdography",
    "postgres_user": "birdography",
    "postgres_password": "a-real-password",
    "secret_key": "x" * 32,
}


def make(**overrides) -> Settings:
    return Settings(_env_file=None, **(VALID | overrides))


def test_accepts_real_secrets():
    assert make().secret_key == "x" * 32


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"secret_key": "x" * 31}, "SECRET_KEY must be"),
        ({"secret_key": "change-me-to-a-long-random-string"}, "SECRET_KEY must be"),  # .env.example's value
        ({"postgres_password": "change-me"}, "POSTGRES_PASSWORD must be"),
        ({"postgres_password": ""}, "POSTGRES_PASSWORD must be"),
    ],
)
def test_rejects_placeholders(overrides, message):
    with pytest.raises(ValidationError, match=message):
        make(**overrides)


def test_reports_every_problem_at_once():
    with pytest.raises(ValidationError, match="SECRET_KEY.*; POSTGRES_PASSWORD.*token_urlsafe"):
        make(secret_key="short", postgres_password="change-me")


def test_env_example_does_not_start_a_server(monkeypatch):
    """Copying .env.example without editing it must fail, not run with known secrets."""
    for name in Settings.model_fields:  # the environment outranks the file, and CI sets real values there
        monkeypatch.delenv(name.upper(), raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=ROOT / ".env.example")


@pytest.mark.parametrize("doc", ["CONTRIBUTING.md", ".env.example"])
def test_every_setting_is_documented(doc):
    text = (ROOT / doc).read_text()
    missing = [name.upper() for name in Settings.model_fields if not re.search(rf"\b{name.upper()}\b", text)]
    assert missing == [], f"{doc} does not mention {', '.join(missing)}"
