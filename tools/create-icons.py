"""Recreate the app's simple typographic icons (requires Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 44)
image = Image.new('RGB', (512, 512), '#235b48')
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((144, 118, 368, 394), radius=26, fill='#f5f5ee')
for word, y in zip(['der', 'die', 'das'], [174, 252, 330]):
    draw.text((256, y), word, font=font, anchor='mm', fill='#235b48')
for size in [180, 192, 512]:
    image.resize((size, size), Image.Resampling.LANCZOS).save(Path('icons') / f'icon-{size}.png')
