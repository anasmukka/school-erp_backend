import base64
from pathlib import Path

root_dir = Path(__file__).resolve().parent.parent
logo_path = root_dir / "public" / "prestige_logo.png"
out_path = root_dir / "src" / "lib" / "schoolLogoAsset.ts"

with open(logo_path, "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")

content = f"""// Official institutional logo asset for Prestige International School
// Sourced directly from public/prestige_logo.png
export const PRESTIGE_LOGO_DATA_URL = "data:image/png;base64,{b64}";
export const PRESTIGE_LOGO_WIDTH = 1024;
export const PRESTIGE_LOGO_HEIGHT = 998;
export const PRESTIGE_LOGO_ASPECT_RATIO = 1024 / 998;
"""

with open(out_path, "w", encoding="utf-8") as out:
    out.write(content)

print(f"Generated {out_path} ({len(b64)} b64 chars)")
