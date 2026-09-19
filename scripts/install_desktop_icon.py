import os
import shutil

def install_desktop_entry():
    home = os.path.expanduser("~")
    apps_dir = os.path.join(home, ".local", "share", "applications")
    icons_dir = os.path.join(home, ".local", "share", "icons", "hicolor", "128x128", "apps")
    
    os.makedirs(apps_dir, exist_ok=True)
    os.makedirs(icons_dir, exist_ok=True)

    src_logo = "/media/jack/New Volume/sadow-irc/assets/logo.png"
    target_logo = os.path.join(icons_dir, "shadow-irc.png")

    if os.path.exists(src_logo):
        shutil.copyfile(src_logo, target_logo)
        print(f"✅ Installed icon to {target_logo}")

    desktop_entry_content = f"""[Desktop Entry]
Name=SHADOW-IRC
Comment=Deep Space Cosmic Network IRC Client
Exec=/media/jack/New Volume/sadow-irc/src-tauri/target/debug/shadow-irc-desktop
Icon=shadow-irc
Terminal=false
Type=Application
Categories=Network;Chat;IRC;
StartupWMClass=shadow-irc-desktop
"""

    desktop_file_path = os.path.join(apps_dir, "shadow-irc.desktop")
    with open(desktop_file_path, "w", encoding="utf-8") as f:
        f.write(desktop_entry_content)
    
    # Make executable
    os.chmod(desktop_file_path, 0o755)
    print(f"✅ Registered native desktop applet entry to {desktop_file_path}")

if __name__ == "__main__":
    install_desktop_entry()
