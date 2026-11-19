from pathlib import Path

from pydantic import SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SENSIBILIA_", env_file=".env", extra="ignore")

    root: Path = Path(__file__).resolve().parents[2]
    assets_directory: Path | None = None
    database_url: str = "sqlite:///./data/sensibilia.db"
    # An empty key means no sign-in is required for that role.
    researcher_token: SecretStr = SecretStr("")
    researcher_token_file: Path | None = None
    # None disables the serving routes; an empty key opens them without a password.
    operator_token: SecretStr | None = None
    operator_token_file: Path | None = None
    # Background runner for the optional analysis add-on. Tests turn it off and
    # run jobs directly; the add-on itself is found through SENSIBILIA_ANALYSIS_RUNTIME.
    analysis_runner: bool = True
    # This computer's address on the laboratory network, detected by the launchers. Pairing
    # links use it when staff open the researcher pages on the server itself (localhost).
    lan_address: str = ""

    @model_validator(mode="after")
    def separate_roles(self):
        if (
            self.operator_token
            and self.researcher_token.get_secret_value()
            and self.operator_token.get_secret_value() == self.researcher_token.get_secret_value()
        ):
            raise ValueError("Operator and researcher credentials must differ")
        return self

    @model_validator(mode="before")
    @classmethod
    def read_secret_file(cls, values):
        values = dict(values)
        for role in ("researcher", "operator"):
            key, file_key = role + "_token", role + "_token_file"
            if values.get(file_key):
                if values.get(key):
                    raise ValueError("Configure a role token or its secret file, not both")
                try:
                    values[key] = Path(values[file_key]).read_text(encoding="utf-8").strip()
                except OSError:
                    raise ValueError("Cannot read role credential file") from None
        return values
