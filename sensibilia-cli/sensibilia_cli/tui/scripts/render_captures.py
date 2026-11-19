"""Render native OpenTUI cell captures to review PNGs. Developer helper; needs Pillow."""

import json
import unicodedata
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

folder = Path(__file__).resolve().parents[3] / "docs" / "tui"
fonts = [
    Path("C:/Windows/Fonts/consola.ttf"),
    Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
]
font_path = next(path for path in fonts if path.is_file())
font = ImageFont.truetype(str(font_path), 20)
symbol_path = Path("C:/Windows/Fonts/seguisym.ttf")
symbols = ImageFont.truetype(str(symbol_path), 20) if symbol_path.is_file() else font
cell_width, cell_height = round(font.getlength("M")), 24
for filename in folder.glob("*.json"):
    capture = json.loads(filename.read_text(encoding="utf-8"))
    picture = Image.new("RGB", (capture["cols"] * cell_width, capture["rows"] * cell_height))
    draw = ImageDraw.Draw(picture)
    for row, line in enumerate(capture["lines"]):
        column = 0
        for span in line["spans"]:
            x, y = column * cell_width, row * cell_height
            draw.rectangle(
                (x, y, x + span["width"] * cell_width, y + cell_height),
                fill=tuple(span["bg"][:3]),
            )
            offset = 0
            for character in span["text"]:
                draw.text(
                    (x + offset * cell_width, y),
                    character,
                    font=symbols if character in "▶↑↓" else font,
                    fill=tuple(span["fg"][:3]),
                )
                offset += (
                    0
                    if unicodedata.combining(character)
                    else (2 if unicodedata.east_asian_width(character) in {"W", "F"} else 1)
                )
            column += span["width"]
    picture.save(filename.with_suffix(".png"))
    print(filename.with_suffix(".png").name)
