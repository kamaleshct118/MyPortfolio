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
        prompt = f"""You are the developer whose resume is provided below.
        Write an ultra-compelling, high-impact first-person introduction of yourself (using "I", "my", "me") targeted at recruiters, based strictly on the uploaded resume details.
        
        Instructions:
        1. Write strictly in the FIRST PERSON (e.g., "I am a Fullstack Developer...", "I specialize in...", "My core expertise lies in...").
        2. Identify your primary developer title (e.g., Fullstack, Software, Backend, or AI Engineer) and core technical stack (e.g. React/Node, Python/FastAPI, or Java/Spring Boot) SOLELY from the uploaded resume.
        3. Make it highly attractive to recruiters by emphasizing:
           - Your core engineering strengths and primary tools found in the resume.
           - Your problem-solving drive and ability to deliver production-grade applications that resolve real-world bottlenecks.
        4. Do NOT hallucinate or include any skills, projects, or technical tools that are NOT explicitly mentioned in the resume.
        5. Keep it brief: exactly 3 to 4 concise sentences (approximately 300-380 characters) so it fits beautifully in the Developer Overview without vertical compression.
        6. Start directly with the first-person introduction. Do NOT include conversational greetings, meta-comments, markdown quotes, or headers.
        
        Resume Content:
        {text[:6000]}
        
        Write your professional first-person introduction:"""
        
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
