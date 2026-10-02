import shutil
import base64
from pathlib import Path

src = Path(r"C:\Users\Anas Pc\.gemini\antigravity\brain\223d6371-f8d0-47b7-ad36-d6497f911a87\.user_uploaded\media_1790868347737.png")
dest_public = Path("public/cbse_logo.png")
dest_ts = Path("src/lib/cbseLogoAsset.ts")

shutil.copyfile(src, dest_public)
print(f"Copied to {dest_public} ({dest_public.stat().st_size} bytes)")

with open(src, "rb") as f:
    b64 = base64.b64encode(f.read()).decode("utf-8")

ts_content = f"""// Official CBSE logo asset for Prestige International School official academic documents
// Sourced directly from official CBSE authority asset (public/cbse_logo.png)
export const CBSE_LOGO_DATA_URL = "data:image/png;base64,{b64}";
export const CBSE_LOGO_WIDTH = 148;
export const CBSE_LOGO_HEIGHT = 148;
export const CBSE_LOGO_ASPECT_RATIO = 1.0;
"""

with open(dest_ts, "w", encoding="utf-8") as f:
    f.write(ts_content)

print(f"Generated {dest_ts} ({len(b64)} b64 chars)")
