"""Create local development settings without overwriting an existing .env.

Pass --no-password to create an .env with empty keys (no sign-in).
"""

import secrets
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
env_file = root / ".env"
try:
    with env_file.open("x", encoding="utf-8") as output:
        output.write("SENSIBILIA_DATABASE_URL=sqlite:///./data/sensibilia.db\n")
        key = "" if "--no-password" in sys.argv else secrets.token_urlsafe(48)
        output.write(f"SENSIBILIA_RESEARCHER_TOKEN={key}\n")
except FileExistsError:
    print("Existing .env retained.")
else:
    print("Created .env (credential not printed; empty with --no-password).")
