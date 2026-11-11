from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PLACEHOLDER = "change-me"  # what .env.example ships with; copying it unedited must not start a server
MIN_SECRET_KEY = 32


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../.env"), extra="ignore")

    postgres_db: str
    postgres_user: str
    postgres_password: str
    postgres_host: str = "localhost"
    postgres_port: int = 5432
    upload_dir: str = "data/photos"
    secret_key: str
    session_days: int = 30
    session_max_days: int = 90
    secure_cookies: bool = False
    allow_registration: bool = False
    trash_days: int = 30
    exiftool_path: str = "exiftool"
    max_upload_mb: int = 40
    max_raw_upload_mb: int = 70
    # Above this size, previews and thumbnails are generated after the response instead of before it.
    background_derivatives_mb: int = 20

    @model_validator(mode="after")
    def no_placeholder_secrets(self):
        problems = []
        if len(self.secret_key) < MIN_SECRET_KEY or PLACEHOLDER in self.secret_key:
            problems.append(f"SECRET_KEY must be a random string of at least {MIN_SECRET_KEY} characters")
        if not self.postgres_password or PLACEHOLDER in self.postgres_password:
            problems.append("POSTGRES_PASSWORD must be set to a real password")
        if problems:
            hint = 'generate values with: python -c "import secrets; print(secrets.token_urlsafe(32))"'
            raise ValueError("; ".join(problems) + f" ({hint})")
        return self

    @property
    def database_url(self) -> str:
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )


settings = Settings()
