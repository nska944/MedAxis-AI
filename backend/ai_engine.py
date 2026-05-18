import os
import json
from openai import OpenAI
from typing import Dict, Any

def get_openai_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise ValueError("OPENAI_API_KEY environment variable is missing.")
    # Render Free has a 30s request timeout — keep OpenAI well under that.
    return OpenAI(api_key=api_key, max_retries=1, timeout=22.0)


# Cap input we send to the model so a 50-page PDF can't blow past Render's 30s limit.
# 12K chars ≈ 3K tokens — well under gpt-4o-mini's 128K context, but bounds latency.
_MAX_INPUT_CHARS = 12000

def _truncate(text: str, limit: int = _MAX_INPUT_CHARS) -> str:
    if not text or len(text) <= limit:
        return text or ""
    head = int(limit * 0.7)
    tail = limit - head - 30
    return text[:head] + "\n…[truncated for analysis]…\n" + text[-tail:]

def analyze_blood_report(raw_text: str) -> Dict[str, Any]:
    """
    Sends the ENTIRE extracted PDF text to GPT-4o-mini for comprehensive
    medical analysis. No rule-based heuristics — the AI reads the full report
    and extracts all relevant lab values, flags abnormalities, and provides
    clinical recommendations.
    """
    try:
        client = get_openai_client()

        system_prompt = """You are an expert clinical pathologist AI assistant. You are given the full text extracted from a patient's blood test / lab report PDF.

Your job is to:
1. **Extract ALL lab values** found in the report — not just a few. Include the test name, measured value, unit, reference range (if present), and whether it is Normal, Low, or High.
2. **Provide a comprehensive clinical summary** that explains what the results mean in plain language a patient can understand, while being medically accurate.
3. **Identify any abnormal values** and explain their clinical significance.
4. **Assess overall risk level** as Low, Moderate, or High based on number and severity of abnormalities.
5. **Provide actionable lifestyle and dietary recommendations** based on the findings.
6. **Suggest any follow-up tests** if warranted by the results.

You MUST return ONLY a raw JSON object with this exact schema:
{
  "risk_level": "Low" | "Moderate" | "High",
  "clinical_summary": "A comprehensive 3-5 sentence clinical summary of all findings.",
  "abnormal_values": [
    {
      "test": "Test Name",
      "value": "Measured Value with unit",
      "reference_range": "Normal range",
      "status": "High" | "Low",
      "significance": "Brief clinical explanation"
    }
  ],
  "all_values": [
    {
      "test": "Test Name",
      "value": "Measured Value",
      "unit": "Unit",
      "status": "Normal" | "High" | "Low"
    }
  ],
  "lifestyle_recommendations": ["Recommendation 1", "Recommendation 2", ...],
  "follow_up_tests": ["Test 1", "Test 2", ...],
  "medication_suggestions": "Any medication dosage suggestions based on clinical guidelines, or 'None required' if all normal."
}

Be thorough. Extract EVERY test value you can find in the text. Do not skip any. If you cannot determine a reference range, use standard medical reference ranges."""

        user_prompt = f"Here is the text extracted from a patient's blood test report PDF. Analyze it thoroughly:\n\n---BEGIN REPORT---\n{_truncate(raw_text)}\n---END REPORT---"

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1,
            max_tokens=1500,                       # bounded response → bounded latency
            response_format={"type": "json_object"}
        )

        raw_json_str = response.choices[0].message.content
        if not raw_json_str:
            raise ValueError("Empty response from OpenAI.")

        ai_response = json.loads(raw_json_str)

        return {
            "risk_level": ai_response.get("risk_level", "Unknown"),
            "clinical_summary": ai_response.get("clinical_summary", "No summary available."),
            "abnormal_values": ai_response.get("abnormal_values", []),
            "all_values": ai_response.get("all_values", []),
            "lifestyle_recommendations": ai_response.get("lifestyle_recommendations", []),
            "follow_up_tests": ai_response.get("follow_up_tests", []),
            "medication_suggestions": ai_response.get("medication_suggestions", "None required.")
        }

    except json.JSONDecodeError as e:
        print(f"AI Engine Error: Failed to parse JSON: {e}")
        return _fallback_response("Failed to parse AI response.")
    except Exception as e:
        print(f"AI Engine Error: {e}")
        return _fallback_response(f"AI analysis failed: {str(e)}")

def _fallback_response(error_msg: str) -> Dict[str, Any]:
    return {
        "risk_level": "Unknown",
        "clinical_summary": error_msg,
        "abnormal_values": [],
        "all_values": [],
        "lifestyle_recommendations": [],
        "follow_up_tests": [],
        "medication_suggestions": "Unable to determine."
    }

# Keep backward compatibility for manual lab entry
def analyze_lab_values(lab_summary: str) -> Dict[str, Any]:
    """Legacy function for manual lab value analysis. Delegates to the new comprehensive analyzer."""
    return analyze_blood_report(lab_summary)

def analyze_prescription(raw_text: str) -> Dict[str, Any]:
    """
    Analyzes an uploaded prescription (image, pdf, txt) using GPT-4o-mini.
    Provides a simple summary, severity indicator, comparison, and recommendations.
    """
    try:
        client = get_openai_client()

        system_prompt = """You are an expert, empathetic medical AI assistant. You have been given the transcribed text of a patient's medical prescription.
Your job is to read it carefully and return a JSON object explaining the patient's condition and prescribed treatment in very simple, easy-to-understand language.

You MUST return ONLY a raw JSON object with this exact schema:
{
  "summary": "A brief, highly readable summary of what this prescription is for and how to take the medications. Avoid medical jargon.",
  "severity": "Low" | "Moderate" | "High",
  "comparison": "A recognizable comparison or analogy for the condition (e.g., 'similar to a mild vitamin deficiency' or 'like a common seasonal allergy').",
  "recommendations": ["Recommendation 1", "Recommendation 2", ...],
  "medicines": ["Medicine Name 1 (dosage if available)", "Medicine Name 2 (dosage if available)", ...]
}

For the `medicines` field, list every distinct medication or supplement mentioned in the prescription. Include the dosage if it appears right next to the name (e.g. 'Amoxicillin 500mg'). If no dosage is mentioned, just use the name. Do NOT include instructions like 'once daily' in the medicine name.
Focus on clarity and providing actionable advice based on the prescribed medication."""

        user_prompt = f"Here is the text extracted from the prescription:\n\n---BEGIN PRESCRIPTION---\n{_truncate(raw_text, 6000)}\n---END PRESCRIPTION---"

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.1,
            max_tokens=900,
            response_format={"type": "json_object"}
        )

        raw_json_str = response.choices[0].message.content
        if not raw_json_str:
            raise ValueError("Empty response from OpenAI.")

        ai_response = json.loads(raw_json_str)

        return {
            "summary": ai_response.get("summary", "Could not generate summary."),
            "severity": ai_response.get("severity", "Unknown"),
            "comparison": ai_response.get("comparison", "No comparison available."),
            "recommendations": ai_response.get("recommendations", []),
            "medicines": ai_response.get("medicines", [])
        }

    except json.JSONDecodeError as e:
        print(f"AI Engine Error (Prescription): Failed to parse JSON: {e}")
        return _fallback_rx_response("Failed to parse AI response.")
    except Exception as e:
        print(f"AI Engine Error (Prescription): {e}")
        return _fallback_rx_response(f"AI analysis failed: {str(e)}")

def _fallback_rx_response(error_msg: str) -> Dict[str, Any]:
    return {
        "summary": error_msg,
        "severity": "Unknown",
        "comparison": "Unable to determine.",
        "recommendations": []
    }
