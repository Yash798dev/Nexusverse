"""
agents/clip_utils.py — Shared open_clip model/embedding helpers.

Centralized so agents.image_generation, agents.stock_videos, and agents.qa_agent
all reuse the same loaded CLIP model within a job's process instead of each
loading their own copy (matters on a 6GB card).
"""

_model = None
_preprocess = None
_tokenizer = None


def load_clip():
    global _model, _preprocess, _tokenizer
    if _model is not None:
        return _model, _preprocess, _tokenizer
    import open_clip

    model, _, preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
    tokenizer = open_clip.get_tokenizer("ViT-B-32")
    model.eval()
    _model, _preprocess, _tokenizer = model, preprocess, tokenizer
    return model, preprocess, tokenizer


def embed_text(text: str):
    import torch

    model, _, tokenizer = load_clip()
    with torch.no_grad():
        feats = model.encode_text(tokenizer([text[:300]]))
        feats /= feats.norm(dim=-1, keepdim=True)
    return feats


def embed_image(image):
    import torch

    model, preprocess, _ = load_clip()
    with torch.no_grad():
        tensor = preprocess(image).unsqueeze(0)
        feats = model.encode_image(tensor)
        feats /= feats.norm(dim=-1, keepdim=True)
    return feats


def score_image_prompt(image, prompt: str) -> float:
    text_feats = embed_text(prompt)
    image_feats = embed_image(image)
    return (image_feats @ text_feats.T).item()
