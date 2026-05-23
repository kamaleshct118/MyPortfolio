import app.retriever as retriever

def generate_summary(text: str, mode: str = "project") -> str:
    """
    Generates a concise, high-impact summary from raw text for display.
    Modes:
        - "project": Generates a 2-3 sentence project summary.
        - "resume": Generates a 2-3 sentence developer profile summary.
    """
    llm = retriever.get_llm()
    if not llm:
        print("[!] No LLM client available. Using character-slice fallback for summary.")
        return text[:180].strip() + "..."
        
    if mode == "project":
        prompt = f"""You are a professional technical writer.
        Read this project README content and write a highly polished, engaging, and professional project summary.
        
        Instructions:
        1. Keep it brief: exactly 2 to 3 sentences (under 250 characters).
        2. Highlight what the project accomplishes, its primary value proposition, and the core technologies used.
        3. Do NOT use bullet points, headers, or markdown styling.
        4. Focus on clarity and high impact. Do not include markdown tags.
        
        README Content:
        {text[:5000]}
        
        Write summary:"""
    else:
        prompt = f"""You are a senior recruiter.
        Read this developer's resume content and write a highly polished, professional summary introducing them.
        
        Instructions:
        1. Keep it brief: exactly 2 to 3 sentences (under 250 characters).
        2. Highlight their core expertise, senior skills, and general experience.
        3. Do NOT use bullet points, headers, or introductory conversational text.
        
        Resume Content:
        {text[:5000]}
        
        Write summary:"""
        
    try:
        response = llm.invoke(prompt)
        response_text = response.content if hasattr(response, 'content') else response
        # Clean extra newlines or quotes
        clean_summary = response_text.replace('"', '').replace('\n', ' ').strip()
        print(f"[+] Summary generated successfully ({mode}): {clean_summary[:60]}...")
        return clean_summary
    except Exception as e:
        print(f"[!] Summary generation failed: {e}. Using fallback.")
        return text[:180].strip() + "..."
