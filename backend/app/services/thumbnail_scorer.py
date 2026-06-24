"""Gemini-powered thumbnail scoring for video ad frames.

Sends a batch of candidate frames to Gemini Flash and asks it to score each
one from 1-10 on its quality as a Facebook/Instagram video ad thumbnail.

Single API call per batch (not N calls), so cost is a fraction of a cent
per video even with 15 frames.
"""
import json
import os

try:
    from google import genai
except ImportError:
    genai = None


THUMBNAIL_SCORING_PROMPT = """You are evaluating numbered video frames for use as a Facebook/Instagram video ad thumbnail.

A GREAT ad thumbnail:
- Shows a clear, in-focus subject — especially a face with visible emotion (surprise, excitement, concern, intrigue, joy)
- High contrast + visual interest that stops the scroll in a crowded feed
- Shows the product, hero visual, or key text overlay clearly when present
- Strong composition (subject centered or rule-of-thirds, uncluttered)

A BAD ad thumbnail:
- Mid-motion blur, closed eyes, mouth caught half-open, awkward transitional gestures
- Dark, blown-out, or washed-out exposure
- Visually flat or busy / cluttered
- "In-between" moments that don't represent the video's hook

Score each numbered frame from 1.0 to 10.0 (decimals OK) for ad thumbnail quality.

Return ONLY a JSON object in this exact shape, nothing else:
{"scores": [{"frame": 1, "score": 8.5, "reason": "brief reason"}, {"frame": 2, "score": 4.2, "reason": "..."}]}"""


def score_thumbnails_with_ai(frame_paths):
    """Score a batch of video frames with Gemini Vision.

    Args:
        frame_paths: list of filesystem Path/str to JPEG frames.

    Returns:
        dict mapping str(path) -> float score (1-10). Empty dict if AI
        unavailable, API key missing, or the call fails — caller should
        fall back to non-AI ranking.
    """
    if genai is None:
        return {}
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {}
    if not frame_paths:
        return {}

    try:
        client = genai.Client(api_key=api_key)
        contents = []
        for i, path in enumerate(frame_paths):
            with open(path, "rb") as f:
                data = f.read()
            contents.append(f"Frame {i + 1}:")
            contents.append(
                genai.types.Part.from_bytes(data=data, mime_type="image/jpeg")
            )
        contents.append(THUMBNAIL_SCORING_PROMPT)

        response = client.models.generate_content(
            model="gemini-2.0-flash",
            contents=contents,
        )
        text = (response.text or "").strip()

        # Strip markdown fences if Gemini ignored the "no markdown" instruction
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()
        if text.startswith("json"):
            text = text[4:].strip()

        data = json.loads(text)
        scores = data.get("scores", [])
        result = {}
        for entry in scores:
            frame_idx = entry.get("frame")
            score = entry.get("score")
            if (
                isinstance(frame_idx, int)
                and isinstance(score, (int, float))
                and 1 <= frame_idx <= len(frame_paths)
            ):
                result[str(frame_paths[frame_idx - 1])] = float(score)
        return result
    except Exception as e:
        print(f"[thumbnail_scorer] Gemini scoring failed: {e}")
        return {}
