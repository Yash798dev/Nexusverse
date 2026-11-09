import os
import json
import re
from dotenv import load_dotenv
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage
from langchain_community.tools import WikipediaQueryRun
from langchain_community.utilities import WikipediaAPIWrapper
from langchain_community.tools import TavilySearchResults
load_dotenv()



wiki_wrapper=WikipediaAPIWrapper(top_k_results=2,doc_content_chars_max=1500)
wiki_tool=WikipediaQueryRun(api_wrapper=wiki_wrapper)
tools=[wiki_tool]
import os
from langchain_groq import ChatGroq

# Use env var so model updates are simple
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
GROQ_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "8192"))

llm = ChatGroq(
    model_name=GROQ_MODEL,
    max_tokens=GROQ_MAX_TOKENS
)

llm_with_tools=llm.bind_tools(tools)




def video_script_generator(user_prompt: str) :
    
        full_script_prompt = f"""You are a highly knowledgeable YouTube scriptwriter with access to research tools like Wikipedia and Tavily.
Your task is to write a detailed, engaging, and accurate YouTube video **script only** on the topic: "{user_prompt}" in 20-25 words.
🔍 Use real facts, examples, quotes, statistics, and historical context by researching the topic using tools like Wikipedia or Tavily.
📝 Structure:
- Opening Hook (0:00–0:30): Grab attention with a powerful fact or question.
- Section 1: Define the topic and explain background.
- Section 2: Dive deep into key concepts with examples and analogies.
- Section 3: Include real-world applications or case studies.
- Section 4: Discuss impact, pros and cons, future trends.
- Closing (Last 30 sec): Recap the key idea, include a CTA (like/subscribe).
🎙️ Style:
- Friendly, clear, and conversational
- No headings, timestamps, markdown, or JSON
- Only the raw spoken script text suitable for voiceover
Only return the complete script text. Do not include any notes, explanations, or metadata.
"""
        script_result = llm_with_tools.invoke([HumanMessage(content=full_script_prompt)])
        return script_result.content
        




def image_generator(user_prompt:str):
        full_image_prompt=f"""You are a highly skilled visual imagination assistant, expert in creating vivid and descriptive prompts for AI image generation tools like Midjourney, DALL·E, and Stable Diffusion.
Your task is to generate **visually rich and creative image prompts** based on a YouTube video topic provided by the user.
---
🔵 INPUT:
Topic: "{user_prompt}"
---
🔴 OUTPUT FORMAT:
Return 1-2 image prompts as a numbered list. Each image prompt should:
- Focus on **a specific moment**, **scene**, or **visual metaphor** related to the topic
- Be **detailed** and use **cinematic language**
- Include **camera angle**, **lighting**, **style**, and **objects or subjects**
- Mention **realism level** (e.g., photo-realistic, digital art, isometric, 3D render, anime style)
- Be **coherent with YouTube educational visuals**
---
📌 Constraints:
- Do NOT generate actual images, only prompts
- Do NOT add any explanation or titles, only the list of prompts
- Each prompt should be a **single line**, ~20–40 words
- Ensure variety: use different scenes, concepts, and moods
---
📍Example (if topic is "Machine Learning"):
1. A futuristic control room with holographic neural networks displayed in midair, glowing interface panels, scientists observing data streams, cinematic lighting, 3D render style, over-the-shoulder camera view
2. A humanoid robot writing mathematical equations on a transparent digital board, bokeh background, soft blue lighting, realistic sci-fi scene, front-facing shot
3. Human brain and computer chip merging into one, surrounded by binary code and glowing particles, dark background, conceptual digital art, wide angle shot
4. A timeline infographic style of AI evolution from 1950 to 2025, sketched on a chalkboard with animated figures, isometric art style
...
---
Now, based on this format, generate image prompts for the topic: **"{user_prompt}"**
"""
        image_results=llm_with_tools.invoke([HumanMessage(content=full_image_prompt)])
        return image_results.content

    