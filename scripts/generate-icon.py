"""Regenerate the local vector-style application icon. Requires Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw
import math

root = Path(__file__).resolve().parent.parent
out = root / 'build'
out.mkdir(exist_ok=True)
image = Image.new('RGBA', (1024, 1024))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, 1023, 1023), radius=285, fill='#7860D2')
for i in range(5):
    angle = i * 2 * math.pi / 5 - math.pi / 2
    x, y = 512 + math.cos(angle) * 180, 512 + math.sin(angle) * 180
    draw.ellipse((x - 162, y - 162, x + 162, y + 162), fill='white')
draw.ellipse((416, 416, 608, 608), fill='#C5B6F4')
image.resize((256, 256), Image.Resampling.LANCZOS).save(out / 'icon.png')
image.save(out / 'icon.ico', sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print('Application icons generated in build/')
