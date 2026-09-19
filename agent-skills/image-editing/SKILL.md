---
name: image-editing
description: Guidance for generating, editing, cropping, and presenting image assets through the available Magica image tools.
---

Use this skill when the user asks to create, modify, crop, resize, or refine an image.

Prefer `gpt_image_2` for image creation from text. Prefer `crop_image` only when the user has supplied an image URL or a previous tool result produced an image URL.

When cropping, keep rectangles explicit and complete. If exact pixels are unknown, use percent coordinates. Return concise progress text and let tool result blocks carry generated image URLs.
