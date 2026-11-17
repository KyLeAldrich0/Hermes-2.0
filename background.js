// FormSense - Background Service Worker (Manifest V3)

/**
 * Global Keyboard Command Listener
 */
chrome.commands.onCommand.addListener(async (command) => {
  if (command === "solve-form") {
    triggerSolveOnActiveTab();
  }
});

/**
 * Message Listener for actions from content script or popup
 */
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Trigger from popup button
  if (request.action === "POPUP_TRIGGER_SOLVE") {
    triggerSolveOnActiveTab()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // Fetch available models for an API key
  if (request.action === "FETCH_AVAILABLE_MODELS") {
    listAvailableModels(request.apiKey)
      .then((models) => sendResponse({ success: true, models }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  // AI solve request from content script
  if (request.action === "SOLVE_FORM_QUESTIONS") {
    handleSolveQuestions(request.questions)
      .then((result) => sendResponse({ success: true, answers: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // Keep message channel open for async fetch
  }
});

/**
 * Triggers solving on the currently active Google Forms tab
 */
async function triggerSolveOnActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      throw new Error("No active tab detected.");
    }

    const tabUrl = tab.url || tab.pendingUrl || "";
    if (!tabUrl.includes("docs.google.com/forms")) {
      throw new Error("The active tab is not a Google Form (must be on docs.google.com/forms).");
    }

    // Try sending message to existing content script
    try {
      await chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_SOLVE" });
      return { success: true };
    } catch (_) {
      // Content script not loaded yet (e.g. page was opened before extension installation)
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      await new Promise((r) => setTimeout(r, 100));
      await chrome.tabs.sendMessage(tab.id, { action: "TRIGGER_SOLVE" });
      return { success: true };
    }
  } catch (error) {
    console.error("[FormSense Background]", error);
    return { success: false, error: error.message };
  }
}

/**
 * Fetches the list of active models that support generateContent for this API key
 */
async function listAvailableModels(apiKey) {
  if (!apiKey) return [];
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(endpoint);
  if (!resp.ok) {
    throw new Error(`Failed to list models: HTTP ${resp.status}`);
  }
  const data = await resp.json();
  const models = data?.models || [];
  return models
    .filter((m) => m.supportedGenerationMethods && m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""));
}

/**
 * Queries Gemini API with the extracted questions
 */
async function handleSolveQuestions(questions) {
  const config = await chrome.storage.local.get(["apiKey", "model"]);
  const apiKey = config.apiKey;
  let model = config.model || "gemini-3.8-flash";

  if (!apiKey) {
    throw new Error("API key is not configured! Click the extension icon and paste your Gemini API key.");
  }

  const prompt = `You are an expert quiz solver. You are given a list of questions extracted from a Google Form.
Analyze each question and select or provide the correct answer.

CRITICAL RULES:
1. For choice-based questions (multiple_choice, checkboxes, dropdown): You MUST select strictly from the provided 'options' list. The answer string must match the chosen option text EXACTLY.
2. For multiple_choice and dropdown: Return exactly one answer string in the "answers" array.
3. For checkboxes: Return all correct answer strings in the "answers" array.
4. For short_answer / paragraph: Return a concise, accurate answer string in the "answers" array.
5. If unsure, choose the single most plausible option.
6. Output MUST be ONLY valid JSON matching the format below, without markdown formatting.

Questions to solve:
${JSON.stringify(questions, null, 2)}

Expected JSON output format:
[
  {
    "index": 0,
    "answers": ["Exact matching option text"]
  }
]`;

  const requestBody = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  // Helper to call generateContent
  async function callGemini(selectedModel) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    return await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
  }

  let response = await callGemini(model);

  // If model is not found (404) or unsupported, dynamically discover supported models for this key
  if (!response.ok && response.status === 404) {
    console.warn(`[FormSense] Model '${model}' not found (404). Querying available models for this key...`);
    try {
      const available = await listAvailableModels(apiKey);
      console.log("[FormSense] Discovered available models:", available);

      // Prioritize flash/lite models
      const fallback =
        available.find((m) => m.includes("3.8-flash")) ||
        available.find((m) => m.includes("3.6-flash")) ||
        available.find((m) => m.includes("3.5-flash-lite")) ||
        available.find((m) => m.includes("2.5-flash")) ||
        available.find((m) => m.includes("flash")) ||
        available[0];

      if (fallback && fallback !== model) {
        console.log(`[FormSense] Retrying with available model: ${fallback}`);
        model = fallback;
        // Save the discovered working model for future requests
        chrome.storage.local.set({ model: fallback });
        response = await callGemini(fallback);
      }
    } catch (listErr) {
      console.error("[FormSense] Failed to auto-discover models:", listErr);
    }
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status} (${response.statusText})`;
    try {
      const errJson = await response.json();
      if (errJson?.error?.message) {
        errorDetail = errJson.error.message;
      }
    } catch (_) {}
    throw new Error(`Gemini API Error: ${errorDetail}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    throw new Error("No answer returned by Gemini API.");
  }

  // Parse JSON response safely
  try {
    const cleanedText = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(cleanedText);
  } catch (parseError) {
    console.error("[FormSense] JSON parse failure. Raw text:", rawText);
    throw new Error("AI returned an unparseable response format.");
  }
}
