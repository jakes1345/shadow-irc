import os
import shutil
from PIL import Image

def main():
    master_path = "/home/jack/.gemini/antigravity-ide/brain/51c547e0-df61-411b-b8a4-a920c58a0626/shadow_irc_cosmic_logo_1789859509066.png"
    
    # Destination directories
    assets_dir = "/media/jack/New Volume/sadow-irc/assets"
    desktop_dir = "/media/jack/New Volume/sadow-irc/src-desktop"
    tauri_icons_dir = "/media/jack/New Volume/sadow-irc/src-tauri/icons"

    os.makedirs(assets_dir, exist_ok=True)
    os.makedirs(desktop_dir, exist_ok=True)
    os.makedirs(tauri_icons_dir, exist_ok=True)

    # Open Master Image
    master_img = Image.open(master_path).convert("RGBA")

    # 1. Save master logo.png in assets & src-desktop
    master_img.save(os.path.join(assets_dir, "logo.png"), "PNG")
    master_img.save(os.path.join(desktop_dir, "logo.png"), "PNG")

    # 2. Resize for Tauri icons
    sizes = {
        "icon.png": 512,
        "32x32.png": 32,
        "128x128.png": 128,
        "128x128@2x.png": 256,
        "Square30x30Logo.png": 30,
        "Square44x44Logo.png": 44,
        "Square71x71Logo.png": 71,
        "Square89x89Logo.png": 89,
        "Square150x150Logo.png": 150,
        "Square310x310Logo.png": 310,
        "StoreLogo.png": 50,
    }

    for filename, sz in sizes.items():
        out_path = os.path.join(tauri_icons_dir, filename)
        resized = master_img.resize((sz, sz), Image.Resampling.LANCZOS)
        resized.save(out_path, "PNG")
        print(f"Processed {out_path} ({sz}x{sz})")

    print("Master Logo Processing Complete!")

if __name__ == "__main__":
    main()
