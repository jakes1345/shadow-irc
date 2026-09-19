import os
import math
from PIL import Image, ImageDraw, ImageFilter

def create_cosmic_icon(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    
    # 1. Dark cosmic void background with radial gradient
    bg = Image.new("RGBA", (size, size), (3, 0, 8, 255))
    draw_bg = ImageDraw.Draw(bg)
    
    cx, cy = size / 2, size / 2
    max_r = size * 0.48
    
    # Draw cosmic nebula glow layers
    nebula_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    neb_draw = ImageDraw.Draw(nebula_layer)
    
    # Violet outer nebula
    for r in range(int(max_r), 0, -2):
        factor = r / max_r
        alpha = int((1.0 - factor) * 180)
        # Gradient colors from violet to cyan to deep space
        color = (
            int(138 * (1 - factor) + 10 * factor),
            int(40 * (1 - factor) + 0 * factor),
            int(255 * (1 - factor) + 40 * factor),
            alpha
        )
        neb_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)
        
    # Cyan core glow
    cyan_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    cyan_draw = ImageDraw.Draw(cyan_layer)
    cyan_r = size * 0.35
    for r in range(int(cyan_r), 0, -2):
        factor = r / cyan_r
        alpha = int((1.0 - factor) * 220)
        color = (0, int(240 * (1 - factor)), int(255 * (1 - factor)), alpha)
        cyan_draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)

    # Blur nebula layers for ultra-smooth cosmic atmosphere
    nebula_layer = nebula_layer.filter(ImageFilter.GaussianBlur(radius=size * 0.04))
    cyan_layer = cyan_layer.filter(ImageFilter.GaussianBlur(radius=size * 0.03))

    bg = Image.alpha_composite(bg, nebula_layer)
    bg = Image.alpha_composite(bg, cyan_layer)

    # 2. Draw Event Horizon Black Hole Core
    core_layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    core_draw = ImageDraw.Draw(core_layer)
    
    # Accretion Ring glow
    ring_r = size * 0.28
    for i in range(12):
        r = ring_r + (i - 6) * (size * 0.006)
        alpha = int(255 - abs(i - 6) * 35)
        color = (0, 240, 255, alpha)
        core_draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=max(1, int(size * 0.008)))
        
    # Black Hole Shadow
    bh_r = size * 0.22
    core_draw.ellipse([cx - bh_r, cy - bh_r, cx + bh_r, cy + bh_r], fill=(2, 1, 6, 255))
    
    # Quantum Orbit Ring (tilted ellipse effect)
    ring_draw = ImageDraw.Draw(core_layer)
    rw, rh = size * 0.40, size * 0.16
    for step in range(360):
        rad = math.radians(step)
        x = cx + rw * math.cos(rad)
        y = cy + rh * math.sin(rad)
        # rotate angle
        rot_angle = math.radians(-30)
        nx = cx + (x - cx) * math.cos(rot_angle) - (y - cy) * math.sin(rot_angle)
        ny = cy + (x - cx) * math.sin(rot_angle) + (y - cy) * math.cos(rot_angle)
        
        dot_r = max(1.0, size * 0.012)
        alpha = int(150 + 105 * math.sin(rad))
        ring_draw.ellipse([nx - dot_r, ny - dot_r, nx + dot_r, ny + dot_r], fill=(138, 43, 226, alpha))

    final_img = Image.alpha_composite(bg, core_layer)
    return final_img

def main():
    icons_dir = "/media/jack/New Volume/sadow-irc/src-tauri/icons"
    os.makedirs(icons_dir, exist_ok=True)

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

    base_icon = create_cosmic_icon(512)

    for filename, sz in sizes.items():
        out_path = os.path.join(icons_dir, filename)
        if sz == 512:
            base_icon.save(out_path, "PNG")
        else:
            resized = base_icon.resize((sz, sz), Image.Resampling.LANCZOS)
            resized.save(out_path, "PNG")
        print(f"Generated {out_path} ({sz}x{sz})")

if __name__ == "__main__":
    main()
